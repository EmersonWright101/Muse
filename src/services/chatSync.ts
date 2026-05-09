/**
 * Chat backend sync helpers.
 *
 * Handles the conversion between local conversation format (with inline base64)
 * and the server format (binary attachments stored separately via /api/chat/attachments).
 *
 * Local format:  attachments[].data = base64 string
 *                mediaOutputs[].data = base64 string
 *
 * Server format: attachments[].attachmentId = "<uuid>" (data field removed)
 *                mediaOutputs[].attachmentId = "<uuid>" (data field removed)
 */

import { apiPost, apiPut, apiGet, apiPostForm, apiGetBinary, apiDelete, isBackendConfigured } from './api'
import type { Conversation, ChatMessage } from '../utils/storage'

interface AttachmentUploadResult { id: string }

async function uploadBinary(
  base64: string,
  filename: string,
  mimeType: string,
  conversationId: string,
  messageId: string,
): Promise<string | null> {
  try {
    const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const form = new FormData()
    form.append('file', new Blob([binary], { type: mimeType }), filename)
    form.append('conversation_id', conversationId)
    form.append('message_id', messageId)
    const result = await apiPostForm<AttachmentUploadResult>('/api/chat/attachments', form)
    return result.id
  } catch {
    return null
  }
}

async function fetchBinaryAsBase64(attachmentId: string): Promise<string | null> {
  const binary = await apiGetBinary(`/api/chat/attachments/${attachmentId}`)
  if (!binary) return null
  let bin = ''
  for (let i = 0; i < binary.length; i += 8192) {
    bin += String.fromCharCode(...Array.from(binary.subarray(i, i + 8192)))
  }
  return btoa(bin)
}

/**
 * Prepare a conversation for server storage:
 * - Extracts all inline base64 binary data from messages
 * - Uploads each binary to /api/chat/attachments
 * - Replaces data fields with attachmentId references
 * Returns a deep clone of the conversation with no inline binary data.
 */
export async function prepareConvForServer(conv: Conversation): Promise<Conversation> {
  const cleaned = JSON.parse(JSON.stringify(conv)) as Conversation

  for (const msg of cleaned.messages) {
    // User attachments with inline data
    if (msg.attachments) {
      for (const att of msg.attachments as unknown as Array<Record<string, unknown>>) {
        const data = att.data as string | undefined
        if (data) {
          const mime = (att.mimeType as string) || 'application/octet-stream'
          const id = await uploadBinary(data, (att.name as string) || (att.id as string), mime, conv.id, msg.id)
          if (id) {
            att.attachmentId = id
            delete att.data
          }
        }
      }
    }
    // AI-generated media outputs (images, audio, video)
    if (msg.mediaOutputs) {
      for (const mo of msg.mediaOutputs as Array<Record<string, unknown>>) {
        const data = mo.data as string | undefined
        if (data) {
          const mime = (mo.mimeType as string) || 'image/png'
          const ext  = mime.split('/')[1]?.split(';')[0] ?? 'bin'
          const id = await uploadBinary(data, `${msg.id}_output.${ext}`, mime, conv.id, msg.id)
          if (id) {
            mo.attachmentId = id
            delete mo.data
          }
        }
      }
    }
    // Variants
    if (msg.variants) {
      for (const v of msg.variants) {
        if (v.mediaOutputs) {
          for (const mo of v.mediaOutputs as Array<Record<string, unknown>>) {
            const data = mo.data as string | undefined
            if (data) {
              const mime = (mo.mimeType as string) || 'image/png'
              const ext  = mime.split('/')[1]?.split(';')[0] ?? 'bin'
              const id = await uploadBinary(data, `${msg.id}_variant.${ext}`, mime, conv.id, msg.id)
              if (id) {
                mo.attachmentId = id
                delete mo.data
              }
            }
          }
        }
      }
    }
  }

  return cleaned
}

/**
 * Restore inline binary data in a conversation fetched from the server.
 * Finds all attachmentId references and fetches the binary from /api/chat/attachments/:id.
 */
export async function restoreConvFromServer(conv: Conversation): Promise<Conversation> {
  for (const msg of conv.messages) {
    if (msg.attachments) {
      for (const att of msg.attachments as unknown as Array<Record<string, unknown>>) {
        const attId = att.attachmentId as string | undefined
        if (attId && !att.data) {
          const b64 = await fetchBinaryAsBase64(attId)
          if (b64) att.data = b64
        }
      }
    }
    if (msg.mediaOutputs) {
      for (const mo of msg.mediaOutputs as Array<Record<string, unknown>>) {
        const attId = mo.attachmentId as string | undefined
        if (attId && !mo.data) {
          const b64 = await fetchBinaryAsBase64(attId)
          if (b64) mo.data = b64
        }
      }
    }
    if (msg.variants) {
      for (const v of msg.variants) {
        if (v.mediaOutputs) {
          for (const mo of v.mediaOutputs as Array<Record<string, unknown>>) {
            const attId = mo.attachmentId as string | undefined
            if (attId && !mo.data) {
              const b64 = await fetchBinaryAsBase64(attId)
              if (b64) mo.data = b64
            }
          }
        }
      }
    }
  }
  return conv
}

interface RemoteConvMeta {
  id: string
  title: string
  providerId: string
  model: string
  pinned: boolean
  assistantId: string | null
  createdAt: string
  updatedAt: string
  trashedAt: string | null
  expiryAt: string | null
  contextCutoffMsgId?: string | null
  contextCutoffPoints?: string[]
  titleGenerated?: boolean
  defaultProviderId?: string | null
  defaultModelId?: string | null
}

interface RemoteConv extends RemoteConvMeta {
  messages: ChatMessage[]
}

function remoteValue<T>(obj: Record<string, unknown>, camel: string, snake: string, fallback?: T): T {
  return (obj[camel] ?? obj[snake] ?? fallback) as T
}

function remoteMetaToConversation(remote: RemoteConv): Conversation {
  const r = remote as unknown as Record<string, unknown>
  return {
    id:                  remoteValue<string>(r, 'id', 'id', ''),
    title:               remoteValue<string>(r, 'title', 'title', ''),
    providerId:          remoteValue<string>(r, 'providerId', 'provider_id', ''),
    model:               remoteValue<string>(r, 'model', 'model', ''),
    pinned:              remoteValue<boolean>(r, 'pinned', 'pinned', false),
    assistantId:         remoteValue<string | null>(r, 'assistantId', 'assistant_id', null) ?? undefined,
    createdAt:           remoteValue<string>(r, 'createdAt', 'created_at', ''),
    updatedAt:           remoteValue<string>(r, 'updatedAt', 'updated_at', ''),
    messages:            remoteValue<ChatMessage[]>(r, 'messages', 'messages', []) ?? [],
    contextCutoffMsgId:  remoteValue<string | null>(r, 'contextCutoffMsgId', 'context_cutoff_msg_id', null) ?? undefined,
    contextCutoffPoints: remoteValue<string[] | undefined>(r, 'contextCutoffPoints', 'context_cutoff_points', undefined),
    titleGenerated:      remoteValue<boolean | undefined>(r, 'titleGenerated', 'title_generated', undefined),
    defaultProviderId:   remoteValue<string | null>(r, 'defaultProviderId', 'default_provider_id', null) ?? undefined,
    defaultModelId:      remoteValue<string | null>(r, 'defaultModelId', 'default_model_id', null) ?? undefined,
  }
}

function conversationToServerBody(cleaned: Conversation, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    id:                     cleaned.id,
    title:                  cleaned.title,
    provider_id:            cleaned.providerId,
    model:                  cleaned.model,
    pinned:                 cleaned.pinned ?? false,
    assistant_id:           cleaned.assistantId ?? null,
    messages:               cleaned.messages,
    created_at:             cleaned.createdAt,
    updated_at:             cleaned.updatedAt,
    context_cutoff_msg_id:  cleaned.contextCutoffMsgId ?? null,
    context_cutoff_points:  cleaned.contextCutoffPoints ?? [],
    title_generated:        cleaned.titleGenerated ?? false,
    default_provider_id:    cleaned.defaultProviderId ?? null,
    default_model_id:       cleaned.defaultModelId ?? null,
    ...extra,
  }
}

/**
 * Push a single conversation to the server.
 * Extracts attachments first, then PUT the clean JSON.
 */
export async function pushConvToServer(conv: Conversation): Promise<void> {
  if (!isBackendConfigured()) return
  try {
    const cleaned = await prepareConvForServer(conv)
    const body = conversationToServerBody(cleaned, { trashed_at: null, expiry_at: null })
    await apiPost<{ id: string }>('/api/chat/conversations', body).catch(async (e: { status?: number }) => {
      // Already exists → fallback to PUT
      if (e?.status === 409 || e?.status === 422 || e?.status === 400) {
        const { apiPut } = await import('./api')
        await apiPut(`/api/chat/conversations/${cleaned.id}`, body).catch(() => {})
      }
    })
  } catch { /* ignore */ }
}

/**
 * Update an existing conversation on the server.
 */
export async function updateConvOnServer(conv: Conversation): Promise<void> {
  if (!isBackendConfigured()) return
  try {
    const cleaned = await prepareConvForServer(conv)
    await apiPut(`/api/chat/conversations/${cleaned.id}`, conversationToServerBody(cleaned))
  } catch { /* ignore */ }
}

export async function trashConvOnServer(id: string, trashedAt: string, expiryAt: string | null = null): Promise<void> {
  if (!isBackendConfigured()) return
  await apiPut(`/api/chat/conversations/${id}`, {
    trashed_at: trashedAt,
    expiry_at:  expiryAt,
  }).catch(() => {})
}

export async function restoreConvOnServer(id: string): Promise<void> {
  if (!isBackendConfigured()) return
  await apiPost(`/api/chat/conversations/${id}/restore`, {}).catch(() => {})
}

export async function deleteConvOnServer(id: string): Promise<void> {
  if (!isBackendConfigured()) return
  await apiDelete(`/api/chat/conversations/${id}`).catch(() => {})
}

/**
 * Fetch full conversation from server and restore inline binary data.
 */
export async function fetchConvFromServer(id: string): Promise<Conversation | null> {
  if (!isBackendConfigured()) return null
  try {
    const remote = await apiGet<RemoteConv>(`/api/chat/conversations/${id}`)
    if (!remote) return null
    const conv = remoteMetaToConversation(remote)
    return restoreConvFromServer(conv)
  } catch {
    return null
  }
}

/**
 * Fetch conversation list metadata from server.
 */
export async function fetchConvListFromServer(includeDeleted = false): Promise<RemoteConvMeta[] | null> {
  if (!isBackendConfigured()) return null
  try {
    const path = includeDeleted ? '/api/chat/conversations?include_deleted=true' : '/api/chat/conversations'
    return apiGet<RemoteConvMeta[]>(path)
  } catch {
    return null
  }
}

/**
 * Batch-migrate all local conversations to the server.
 * Only runs once (detects empty server).
 */
export async function migrateConvsToServer(localConvs: Conversation[]): Promise<void> {
  if (!isBackendConfigured() || localConvs.length === 0) return
  const batch = await Promise.all(
    localConvs.map(async conv => {
      const cleaned = await prepareConvForServer(conv)
      return {
        ...conversationToServerBody(cleaned),
        trashed_at: null,
        expiry_at:  null,
      }
    }),
  )
  await apiPost('/api/chat/conversations/batch', batch).catch(() => {})
}
