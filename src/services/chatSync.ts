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

import { apiPost, apiPut, apiGet, apiPostForm, apiGetBinary, isBackendConfigured } from './api'
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
    // AI-generated image outputs
    if (msg.mediaOutputs) {
      for (const mo of msg.mediaOutputs as Array<Record<string, unknown>>) {
        const data = mo.data as string | undefined
        if (data) {
          const mime = (mo.mimeType as string) || 'image/png'
          const id = await uploadBinary(data, `${msg.id}_output.png`, mime, conv.id, msg.id)
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
              const id = await uploadBinary(data, `${msg.id}_variant.png`, mime, conv.id, msg.id)
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
}

interface RemoteConv extends RemoteConvMeta {
  messages: ChatMessage[]
}

/**
 * Push a single conversation to the server.
 * Extracts attachments first, then PUT the clean JSON.
 */
export async function pushConvToServer(conv: Conversation): Promise<void> {
  if (!isBackendConfigured()) return
  try {
    const cleaned = await prepareConvForServer(conv)
    const body = {
      id:           cleaned.id,
      title:        cleaned.title,
      provider_id:  cleaned.providerId,
      model:        cleaned.model,
      pinned:       cleaned.pinned ?? false,
      assistant_id: cleaned.assistantId ?? null,
      messages:     cleaned.messages,
      created_at:   cleaned.createdAt,
      updated_at:   cleaned.updatedAt,
      trashed_at:   null,
      expiry_at:    null,
    }
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
    await apiPut(`/api/chat/conversations/${cleaned.id}`, {
      title:        cleaned.title,
      provider_id:  cleaned.providerId,
      model:        cleaned.model,
      pinned:       cleaned.pinned ?? false,
      assistant_id: cleaned.assistantId ?? null,
      messages:     cleaned.messages,
      updated_at:   cleaned.updatedAt,
    })
  } catch { /* ignore */ }
}

/**
 * Fetch full conversation from server and restore inline binary data.
 */
export async function fetchConvFromServer(id: string): Promise<Conversation | null> {
  if (!isBackendConfigured()) return null
  try {
    const remote = await apiGet<RemoteConv>(`/api/chat/conversations/${id}`)
    if (!remote) return null
    const conv: Conversation = {
      id:           remote.id,
      title:        remote.title,
      providerId:   remote.providerId,
      model:        remote.model,
      pinned:       remote.pinned,
      assistantId:  remote.assistantId ?? undefined,
      createdAt:    remote.createdAt,
      updatedAt:    remote.updatedAt,
      messages:     remote.messages ?? [],
    }
    return restoreConvFromServer(conv)
  } catch {
    return null
  }
}

/**
 * Fetch conversation list metadata from server.
 */
export async function fetchConvListFromServer(): Promise<RemoteConvMeta[] | null> {
  if (!isBackendConfigured()) return null
  try {
    return apiGet<RemoteConvMeta[]>('/api/chat/conversations')
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
        id:           cleaned.id,
        title:        cleaned.title,
        provider_id:  cleaned.providerId,
        model:        cleaned.model,
        pinned:       cleaned.pinned ?? false,
        assistant_id: cleaned.assistantId ?? null,
        messages:     cleaned.messages,
        created_at:   cleaned.createdAt,
        updated_at:   cleaned.updatedAt,
        trashed_at:   null,
        expiry_at:    null,
      }
    }),
  )
  await apiPost('/api/chat/conversations/batch', batch).catch(() => {})
}
