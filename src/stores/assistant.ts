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
  const papersViewMode = ref<'papers' | 'chat'>('papers')

  // Active paper for sidebar → main scroll sync
  const activePaperId = ref<string | null>(null)

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

  async function syncFromServer() {
    if (!isBackendConfigured()) return
    try {
      const remote = await apiGet<RemoteAssistantConversation[]>('/api/private-assistant/conversations?include_deleted=true')
      if (!remote) return
      let activeRemote = remote.filter(r => !remoteDeletedAt(r)).map(remoteToLocal).filter(c => c.id)
      let trashRemote = remote.filter(r => remoteDeletedAt(r)).map(r => ({
        ...remoteToLocal(r),
        deletedAt: remoteDeletedAt(r)!,
      })).filter(c => c.id)

      const localActiveMap = new Map(_conversations.value.map(c => [c.id, c]))
      const localTrashMap = new Map(trashedConversations.value.map(c => [c.id, c]))

      activeRemote = activeRemote.filter(rc => {
        const localTrash = localTrashMap.get(rc.id)
        if (!localTrash) return true
        if (localTrash.deletedAt >= rc.updatedAt) {
          trashConversationRemote(rc.id, localTrash.deletedAt).catch(() => {})
          return false
        }
        localTrashMap.delete(rc.id)
        return true
      })

      trashRemote = trashRemote.filter(rt => {
        const localActive = localActiveMap.get(rt.id)
        if (localActive && localActive.updatedAt > rt.deletedAt) {
          restoreConversationRemote(rt.id).catch(() => {})
          pushConversation(localActive).catch(() => {})
          return false
        }
        return true
      })

      if (activeRemote.length === 0 && trashRemote.length === 0 && _conversations.value.length > 0) {
        for (const c of _conversations.value) pushConversation(c).catch(() => {})
        for (const c of localTrashMap.values()) trashConversationRemote(c.id, c.deletedAt).catch(() => {})
        return
      }

      const remoteIds = new Set([...activeRemote, ...trashRemote].map(c => c.id))
      for (const local of _conversations.value) {
        if (!remoteIds.has(local.id)) pushConversation(local).catch(() => {})
      }
      for (const localTrash of localTrashMap.values()) {
        if (!remoteIds.has(localTrash.id)) trashConversationRemote(localTrash.id, localTrash.deletedAt).catch(() => {})
      }

      const activeMap = new Map(_conversations.value.map(c => [c.id, c]))
      for (const rc of activeRemote) {
        const lc = activeMap.get(rc.id)
        activeMap.set(rc.id, !lc || rc.updatedAt >= lc.updatedAt ? rc : lc)
      }
      _conversations.value = [...activeMap.values()].filter(c => !trashRemote.some(t => t.id === c.id))

      const trashMap = new Map(localTrashMap)
      for (const rt of trashRemote) trashMap.set(rt.id, rt)
      trashedConversations.value = [...trashMap.values()]

      persist()
      persistTrash()
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
