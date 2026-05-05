import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

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

const LS_CONVS  = 'assistant-conversations'
const LS_TRASH  = 'assistant-trash'
const TRASH_TTL = 30 * 24 * 60 * 60 * 1000

function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? '') } catch { return fallback }
}
function save(key: string, val: unknown) {
  localStorage.setItem(key, JSON.stringify(val))
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
  }

  function openConversation(id: string) {
    activeConvId.value = id
  }

  async function renameConversation(id: string, title: string) {
    const conv = _conversations.value.find(c => c.id === id)
    if (conv) { conv.title = title; persist() }
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
  }

  function stopStreaming() {
    isStreaming.value = false
    streamingConvIds.value = new Set()
  }

  function deleteOne(id: string) {
    const conv = _conversations.value.find(c => c.id === id)
    if (!conv) return
    trashedConversations.value.unshift({ ...conv, deletedAt: new Date().toISOString() })
    _conversations.value = _conversations.value.filter(c => c.id !== id)
    if (activeConvId.value === id) activeConvId.value = _conversations.value[0]?.id ?? null
    persist(); persistTrash()
  }

  function deleteBatch() {
    selectedConvIds.value.forEach(id => {
      const conv = _conversations.value.find(c => c.id === id)
      if (conv) trashedConversations.value.unshift({ ...conv, deletedAt: new Date().toISOString() })
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
    if (conv) { conv.pinned = !conv.pinned; persist() }
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
    persist()
  }
  function removeContextCutoff(msgId: string) {
    const conv = activeConv.value
    if (!conv) return
    if (conv.contextCutoffPoints) {
      conv.contextCutoffPoints = conv.contextCutoffPoints.filter(id => id !== msgId)
    }
    persist()
  }
  function restoreFromTrash(id: string) {
    const item = trashedConversations.value.find(c => c.id === id)
    if (!item) return
    const { deletedAt: _, ...restored } = item
    _conversations.value.unshift(restored)
    trashedConversations.value = trashedConversations.value.filter(c => c.id !== id)
    persist(); persistTrash()
  }
  function clearAllTrash()        { trashedConversations.value = []; persistTrash() }
  function permanentDeleteOne(id: string) {
    trashedConversations.value = trashedConversations.value.filter(c => c.id !== id)
    persistTrash()
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
  }
})
