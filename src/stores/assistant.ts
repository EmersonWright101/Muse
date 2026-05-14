import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiGet, apiPost, apiPut, apiDelete, isBackendConfigured } from '../services/api'

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface AssistantConversation {
  id: string
  title: string
  preview: string
  messages: AssistantMessage[]
  createdAt: string
  updatedAt: string
  pinned: boolean
  contextCutoffMsgId?: string
  contextCutoffPoints?: string[]
}

interface TrashedConv extends AssistantConversation {
  deletedAt: string
}

type RemoteAssistantConversation = Partial<AssistantConversation> & {
  created_at?: string
  updated_at?: string
  context_cutoff_msg_id?: string | null
  context_cutoff_points?: string[]
  deletedAt?: string | null
  deleted_at?: string | null
}

const LS_CONVS  = 'assistant-conversations'
const LS_TRASH  = 'assistant-trash'
const TRASH_TTL = 30 * 24 * 60 * 60 * 1000

function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? '') } catch { return fallback }
}
function save(key: string, val: unknown) {
  localStorage.setItem(key, JSON.stringify(val))
}

function remoteToLocal(raw: RemoteAssistantConversation): AssistantConversation {
  return {
    id:                  raw.id ?? '',
    title:               raw.title ?? '新对话',
    preview:             raw.preview ?? '',
    messages:            raw.messages ?? [],
    createdAt:           raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
    updatedAt:           raw.updatedAt ?? raw.updated_at ?? new Date().toISOString(),
    pinned:              raw.pinned ?? false,
    contextCutoffMsgId:  raw.contextCutoffMsgId ?? raw.context_cutoff_msg_id ?? undefined,
    contextCutoffPoints: raw.contextCutoffPoints ?? raw.context_cutoff_points ?? undefined,
  }
}

function remoteDeletedAt(raw: RemoteAssistantConversation): string | null {
  return raw.deletedAt ?? raw.deleted_at ?? null
}

function toServerBody(conv: AssistantConversation, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    id:                     conv.id,
    title:                  conv.title,
    preview:                conv.preview,
    messages:               conv.messages,
    created_at:             conv.createdAt,
    updated_at:             conv.updatedAt,
    pinned:                 conv.pinned,
    context_cutoff_msg_id:  conv.contextCutoffMsgId ?? null,
    context_cutoff_points:  conv.contextCutoffPoints ?? [],
    ...extra,
  }
}

export const useAssistantStore = defineStore('assistant', () => {
  const _conversations   = ref<AssistantConversation[]>(load(LS_CONVS, []))
  const trashedConversations = ref<TrashedConv[]>(load(LS_TRASH, []))
  const activeConvId     = ref<string | null>(null)
  const isStreaming      = ref(false)
  const streamingText    = ref('')
  const streamingConvIds = ref<Set<string>>(new Set())
  const batchMode        = ref(false)
  const selectedConvIds  = ref<Set<string>>(new Set())
  const previewTrashedConv = ref<AssistantConversation | null>(null)

  // Papers view mode (shared between sidebar & main)
  const papersViewMode = ref<'papers' | 'chat' | 'summary'>('papers')

  // Active paper for sidebar → main scroll sync
  const activePaperId = ref<string | null>(null)

  // Active summary report
  const activeReportId = ref<string | null>(null)

  const conversations = computed(() =>
    [..._conversations.value].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    }),
  )

  const activeConv = computed(() =>
    _conversations.value.find(c => c.id === activeConvId.value) ?? null,
  )

  function persist()      { save(LS_CONVS, _conversations.value) }
  function persistTrash() { save(LS_TRASH, trashedConversations.value) }

  async function pushConversation(conv: AssistantConversation) {
    if (!isBackendConfigured()) return
    const body = toServerBody(conv, { deleted_at: null })
    await apiPost('/api/private-assistant/conversations', body).catch(async (e: { status?: number }) => {
      if (e?.status === 400 || e?.status === 409 || e?.status === 422) {
        await apiPut(`/api/private-assistant/conversations/${conv.id}`, body).catch(() => {})
      }
    })
  }

  async function trashConversationRemote(id: string, deletedAt: string) {
    if (!isBackendConfigured()) return
    await apiPut(`/api/private-assistant/conversations/${id}`, { deleted_at: deletedAt }).catch(() => {})
  }

  async function restoreConversationRemote(id: string) {
    if (!isBackendConfigured()) return
    await apiPost(`/api/private-assistant/conversations/${id}/restore`, {}).catch(() => {})
  }

  async function deleteConversationRemote(id: string) {
    if (!isBackendConfigured()) return
    await apiDelete(`/api/private-assistant/conversations/${id}`).catch(() => {})
  }

  function getFingerprint(conv: AssistantConversation): string {
    const firstUserMsg = conv.messages.find(m => m.role === 'user')
    const firstUserContent = firstUserMsg?.content ?? ''
    if (conv.title === '新对话') return firstUserContent
    return `${conv.title}|${firstUserContent}`
  }

  async function syncFromServer() {
    if (!isBackendConfigured()) return
    try {
      const remote = await apiGet<RemoteAssistantConversation[]>('/api/private-assistant/conversations?include_deleted=true')
      if (!remote) return

      const activeRemote = remote.filter(r => !remoteDeletedAt(r)).map(remoteToLocal).filter(c => c.id)
      const trashRemote = remote.filter(r => remoteDeletedAt(r)).map(r => ({
        ...remoteToLocal(r),
        deletedAt: remoteDeletedAt(r)!,
      })).filter(c => c.id)

      type ConvWithOrigin = (AssistantConversation | TrashedConv) & { _isRemote: boolean }
      const all: ConvWithOrigin[] = [
        ..._conversations.value.map(c => ({ ...c, _isRemote: false as const })),
        ...trashedConversations.value.map(c => ({ ...c, _isRemote: false as const })),
        ...activeRemote.map(c => ({ ...c, _isRemote: true as const })),
        ...trashRemote.map(c => ({ ...c, _isRemote: true as const })),
      ]

      const groups = new Map<string, ConvWithOrigin[]>()
      for (const conv of all) {
        const fp = getFingerprint(conv)
        if (!groups.has(fp)) groups.set(fp, [])
        groups.get(fp)!.push(conv)
      }

      const mergedActive: AssistantConversation[] = []
      const mergedTrash: TrashedConv[] = []
      const remoteIdsToDelete: string[] = []
      const localIdReplacements = new Map<string, string>()
      const remoteCanonicalIds = new Set<string>()

      for (const group of groups.values()) {
        const ids = group.map(c => c.id).sort()
        const canonicalId = ids[0]
        const hasRemote = group.some(c => c._isRemote)
        const canonicalIsRemote = group.find(c => c.id === canonicalId)!._isRemote

        if (hasRemote) {
          remoteIdsToDelete.push(...group.filter(c => c._isRemote && c.id !== canonicalId).map(c => c.id))
          if (canonicalIsRemote) remoteCanonicalIds.add(canonicalId)
        }

        for (const c of group.filter(c => !c._isRemote && c.id !== canonicalId)) {
          localIdReplacements.set(c.id, canonicalId)
        }

        const messageMap = new Map<string, AssistantMessage>()
        for (const conv of group) {
          for (const msg of conv.messages) {
            const existing = messageMap.get(msg.id)
            if (!existing || new Date(msg.createdAt) >= new Date(existing.createdAt)) {
              messageMap.set(msg.id, { ...msg })
            }
          }
        }
        const mergedMessages = [...messageMap.values()].sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )

        const updatedAt = group.map(c => c.updatedAt).sort().reverse()[0]
        const createdAt = group.map(c => c.createdAt).sort()[0]
        const pinned = group.some(c => c.pinned)

        const deletedAts = group
          .filter(c => 'deletedAt' in c && c.deletedAt)
          .map(c => (c as TrashedConv).deletedAt)
        const deletedAt = deletedAts.length > 0 ? deletedAts.sort().reverse()[0] : undefined

        const canonicalConv = group.find(c => c.id === canonicalId)!

        const base: AssistantConversation = {
          id: canonicalId,
          title: canonicalConv.title,
          preview: canonicalConv.preview,
          messages: mergedMessages,
          createdAt,
          updatedAt,
          pinned,
          contextCutoffMsgId: canonicalConv.contextCutoffMsgId,
          contextCutoffPoints: canonicalConv.contextCutoffPoints,
        }

        if (deletedAt) {
          mergedTrash.push({ ...base, deletedAt })
        } else {
          mergedActive.push(base)
        }
      }

      if (activeConvId.value && localIdReplacements.has(activeConvId.value)) {
        const newId = localIdReplacements.get(activeConvId.value)!
        activeConvId.value = mergedActive.some(c => c.id === newId) ? newId : (mergedActive[0]?.id ?? null)
      }
      const nextStreaming = new Set<string>()
      for (const id of streamingConvIds.value) {
        nextStreaming.add(localIdReplacements.get(id) ?? id)
      }
      streamingConvIds.value = nextStreaming
      const nextSelected = new Set<string>()
      for (const id of selectedConvIds.value) {
        nextSelected.add(localIdReplacements.get(id) ?? id)
      }
      selectedConvIds.value = nextSelected
      if (previewTrashedConv.value && localIdReplacements.has(previewTrashedConv.value.id)) {
        const newId = localIdReplacements.get(previewTrashedConv.value.id)!
        previewTrashedConv.value = mergedTrash.find(c => c.id === newId) ?? null
      }

      _conversations.value = mergedActive
      trashedConversations.value = mergedTrash
      persist()
      persistTrash()

      for (const id of remoteIdsToDelete) {
        deleteConversationRemote(id).catch(() => {})
      }

      for (const conv of mergedActive) {
        if (!remoteCanonicalIds.has(conv.id)) {
          pushConversation(conv).catch(() => {})
        }
      }
      for (const conv of mergedTrash) {
        if (!remoteCanonicalIds.has(conv.id)) {
          trashConversationRemote(conv.id, conv.deletedAt).catch(() => {})
        }
      }
    } catch { /* ignore */ }
  }

  function newConversation() {
    const now = new Date().toISOString()
    const conv: AssistantConversation = {
      id: crypto.randomUUID(),
      title: '新对话',
      preview: '',
      messages: [],
      createdAt: now,
      updatedAt: now,
      pinned: false,
    }
    _conversations.value.unshift(conv)
    activeConvId.value = conv.id
    batchMode.value = false
    persist()
    pushConversation(conv).catch(() => {})
  }

  function openConversation(id: string) {
    activeConvId.value = id
  }

  async function renameConversation(id: string, title: string) {
    const conv = _conversations.value.find(c => c.id === id)
    if (conv) {
      conv.title = title
      conv.updatedAt = new Date().toISOString()
      persist()
      pushConversation(conv).catch(() => {})
    }
  }

  // Placeholder send — replace with backend call later
  async function sendMessage(text: string) {
    const conv = activeConv.value
    if (!conv || !text.trim()) return

    const userMsg: AssistantMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }
    conv.messages.push(userMsg)
    conv.preview = text.slice(0, 60)
    conv.updatedAt = new Date().toISOString()
    if (conv.title === '新对话' && conv.messages.length === 1) {
      conv.title = text.length > 20 ? text.slice(0, 20) + '…' : text
    }
    persist()

    isStreaming.value = true
    streamingConvIds.value = new Set([...streamingConvIds.value, conv.id])
    await new Promise(r => setTimeout(r, 800))
    conv.messages.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '私人助手功能开发中，敬请期待。',
      createdAt: new Date().toISOString(),
    })
    conv.updatedAt = new Date().toISOString()
    isStreaming.value = false
    const next = new Set(streamingConvIds.value)
    next.delete(conv.id)
    streamingConvIds.value = next
    persist()
    pushConversation(conv).catch(() => {})
  }

  function stopStreaming() {
    isStreaming.value = false
    streamingConvIds.value = new Set()
  }

  function deleteOne(id: string) {
    const conv = _conversations.value.find(c => c.id === id)
    if (!conv) return
    const deletedAt = new Date().toISOString()
    trashedConversations.value.unshift({ ...conv, deletedAt })
    _conversations.value = _conversations.value.filter(c => c.id !== id)
    if (activeConvId.value === id) activeConvId.value = _conversations.value[0]?.id ?? null
    persist(); persistTrash()
    trashConversationRemote(id, deletedAt).catch(() => {})
  }

  function deleteBatch() {
    const deletedAt = new Date().toISOString()
    selectedConvIds.value.forEach(id => {
      const conv = _conversations.value.find(c => c.id === id)
      if (conv) {
        trashedConversations.value.unshift({ ...conv, deletedAt })
        trashConversationRemote(id, deletedAt).catch(() => {})
      }
    })
    _conversations.value = _conversations.value.filter(c => !selectedConvIds.value.has(c.id))
    if (activeConvId.value && selectedConvIds.value.has(activeConvId.value)) {
      activeConvId.value = _conversations.value[0]?.id ?? null
    }
    selectedConvIds.value = new Set()
    batchMode.value = false
    persist(); persistTrash()
  }

  function toggleBatchMode()  { batchMode.value = !batchMode.value; selectedConvIds.value = new Set() }
  function toggleSelect(id: string) {
    const next = new Set(selectedConvIds.value)
    next.has(id) ? next.delete(id) : next.add(id)
    selectedConvIds.value = next
  }
  function selectAll()       { selectedConvIds.value = new Set(_conversations.value.map(c => c.id)) }
  function clearSelection()  { selectedConvIds.value = new Set(); batchMode.value = false }
  function togglePin(id: string) {
    const conv = _conversations.value.find(c => c.id === id)
    if (conv) {
      conv.pinned = !conv.pinned
      conv.updatedAt = new Date().toISOString()
      persist()
      pushConversation(conv).catch(() => {})
    }
  }
  function clearContext() {
    const conv = activeConv.value
    const last = conv?.messages.at(-1)
    if (!conv || !last) return
    if (!conv.contextCutoffPoints) conv.contextCutoffPoints = []
    if (conv.contextCutoffMsgId && !conv.contextCutoffPoints.includes(conv.contextCutoffMsgId)) {
      conv.contextCutoffPoints.push(conv.contextCutoffMsgId)
      conv.contextCutoffMsgId = undefined
    }
    if (!conv.contextCutoffPoints.includes(last.id)) conv.contextCutoffPoints.push(last.id)
    conv.updatedAt = new Date().toISOString()
    persist()
    pushConversation(conv).catch(() => {})
  }
  function removeContextCutoff(msgId: string) {
    const conv = activeConv.value
    if (!conv) return
    if (conv.contextCutoffPoints) {
      conv.contextCutoffPoints = conv.contextCutoffPoints.filter(id => id !== msgId)
    }
    conv.updatedAt = new Date().toISOString()
    persist()
    pushConversation(conv).catch(() => {})
  }
  function restoreFromTrash(id: string) {
    const item = trashedConversations.value.find(c => c.id === id)
    if (!item) return
    const { deletedAt: _, ...restored } = item
    _conversations.value.unshift(restored)
    trashedConversations.value = trashedConversations.value.filter(c => c.id !== id)
    persist(); persistTrash()
    restoreConversationRemote(id).catch(() => {})
  }
  function clearAllTrash() {
    for (const c of trashedConversations.value) deleteConversationRemote(c.id).catch(() => {})
    trashedConversations.value = []
    persistTrash()
  }
  function permanentDeleteOne(id: string) {
    trashedConversations.value = trashedConversations.value.filter(c => c.id !== id)
    persistTrash()
    deleteConversationRemote(id).catch(() => {})
  }
  function openTrashPreview(id: string) {
    previewTrashedConv.value = trashedConversations.value.find(c => c.id === id) ?? null
  }
  function closeTrashPreview() { previewTrashedConv.value = null }

  // Purge expired trash on init
  const _now = Date.now()
  trashedConversations.value = trashedConversations.value.filter(
    c => _now - new Date(c.deletedAt).getTime() < TRASH_TTL,
  )
  persistTrash()
  syncFromServer().catch(() => {})

  return {
    conversations,
    trashedConversations,
    activeConvId,
    activeConv,
    isStreaming,
    streamingText,
    streamingConvIds,
    batchMode,
    selectedConvIds,
    previewTrashedConv,
    papersViewMode,
    activePaperId,
    activeReportId,
    newConversation,
    openConversation,
    renameConversation,
    sendMessage,
    stopStreaming,
    deleteOne,
    deleteBatch,
    toggleBatchMode,
    toggleSelect,
    selectAll,
    clearSelection,
    togglePin,
    clearContext,
    removeContextCutoff,
    restoreFromTrash,
    clearAllTrash,
    permanentDeleteOne,
    openTrashPreview,
    closeTrashPreview,
    syncFromServer,
  }
})
