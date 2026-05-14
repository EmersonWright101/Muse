/**
 * Sync manager built on top of syncEngine (manifest-based protocol).
 *
 * Registers SyncModules for all data domains and orchestrates sync.
 * No merge/dedup/conflict logic lives here — everything is delegated
 * to the backend via syncEngine.
 */

import {
  registerSyncModule,
  syncModule as _syncModule,
  clearSyncState,
} from './syncEngine'
import { drainOfflineQueue } from './offlineQueue'
import { syncAllToolHistories } from './toolsSync'
import type { SyncModule } from './syncEngine'
import { isBackendConfigured, getServerApiKey, apiPut } from './api'
import {
  beginSyncOp,
  endSyncOp,
  failSyncOp,
  setSyncModule,
  setSyncAction,
  addSyncAction,
  removeSyncAction,
} from '../stores/syncStatus'
import { recordSyncTimestamp } from '../utils/syncTimestamp'
import type { Conversation, Assistant } from '../utils/storage'

function safeIso(val: any, fallback: string): string {
  if (!val) return fallback
  const d = new Date(val)
  return isNaN(d.getTime()) ? fallback : d.toISOString()
}
import type { TodoData } from '../utils/todoStorage'
import type { TravelNote } from '../utils/travelStorage'
import type { NoteItem } from '../utils/notesStorage'
import { loadTodos, saveTodos } from '../utils/todoStorage'
import { listTravelNotes, loadTravelNote, saveTravelNote } from '../utils/travelStorage'
import { listNotes, loadNote, saveNote } from '../utils/notesStorage'
import { useTodoStore } from '../stores/todo'
import { useTravelStore } from '../stores/travel'
import { useNotesStore } from '../stores/notes'

// ─── Settings module ─────────────────────────────────────────────────────────
//
// Each settings category is an independent SyncItem: { id, value, updatedAt, _version }
// This enables per-category LWW conflict resolution and avoids sending the full settings
// blob on every sync. Sensitive fields (API keys) are encrypted in serialize() which runs
// BEFORE the changeset is computed, closing the plaintext-key-in-transit security hole.

interface SettingsState {
  ai?: any
  chat?: any
  webSearch?: any
  home?: any
  general?: any
  profile?: any
  chatUi?: any
  privateAssistant?: any
  travelCopilot?: any
  notesCopilot?: any
  paperCopilot?: any
  statistics?: any
  ebookTts?: any
}

// Map category IDs to existing modified-at localStorage keys where available
const _SETTINGS_TS_KEYS: Record<string, string> = {
  chat: 'muse-chat-settings-modified-at',
  webSearch: 'muse-web-search-settings-modified-at',
  travelCopilot: 'muse-travel-copilot-modified-at',
  notesCopilot: 'muse-notes-copilot-modified-at',
}

function _getSettingsCategoryTs(id: string): string {
  const key = _SETTINGS_TS_KEYS[id] ?? `muse-sync-settings-ts-${id}`
  return localStorage.getItem(key) ?? new Date(0).toISOString()
}

function _setSettingsCategoryTs(id: string, ts: string): void {
  const key = _SETTINGS_TS_KEYS[id] ?? `muse-sync-settings-ts-${id}`
  localStorage.setItem(key, ts)
}

async function _collectRawSettingsState(): Promise<SettingsState> {
  const [
    { useAiSettingsStore },
    { useChatSettingsStore },
    { useWebSearchStore },
    { useHomeStore },
    { useAssistantSettingsStore },
    { useTravelCopilotStore },
    { useNotesCopilotStore },
    { usePaperCopilotStore },
    { useStatisticsStore },
    { useEbookStore },
  ] = await Promise.all([
    import('../stores/aiSettings'),
    import('../stores/chatSettings'),
    import('../stores/webSearch'),
    import('../stores/home'),
    import('../stores/assistantSettings'),
    import('../stores/travelCopilot'),
    import('../stores/notesCopilot'),
    import('../stores/paperCopilot'),
    import('../stores/statistics'),
    import('../stores/ebook'),
  ])

  const aiStore = useAiSettingsStore()
  const chatStore = useChatSettingsStore()
  const webSearchStore = useWebSearchStore()
  const homeStore = useHomeStore()
  const assistantSettingsStore = useAssistantSettingsStore()
  const travelCopilotStore = useTravelCopilotStore()
  const notesCopilotStore = useNotesCopilotStore()
  const paperCopilotStore = usePaperCopilotStore()
  const statisticsStore = useStatisticsStore()
  const ebookStore = useEbookStore()

  const { listWebSearchProviders } = await import('../services/webSearch')
  const providerApiKeys: Record<string, string> = {}
  const providerNumResults: Record<string, number> = {}
  for (const { id } of listWebSearchProviders()) {
    providerApiKeys[id] = await webSearchStore.getApiKey(id)
    providerNumResults[id] = webSearchStore.getNumResults(id)
  }

  return {
    ai: {
      activeProviderId: aiStore.activeProviderId,
      providers: aiStore.providers.map((p: any) => ({
        id: p.id,
        type: p.type,
        name: p.name,
        baseUrl: p.baseUrl,
        models: p.models,
        enabled: p.enabled,
        selectedModelId: p.selectedModelId,
        builtIn: p.builtIn,
        updatedAt: p.updatedAt,
        apiKey: p.apiKey,
      })),
      defaultProviderId: aiStore.defaultProviderId,
      defaultModelId: aiStore.defaultModelId,
      ebookDefaultProviderId: aiStore.ebookDefaultProviderId,
      ebookDefaultModelId: aiStore.ebookDefaultModelId,
      paperDefaultProviderId: aiStore.paperDefaultProviderId,
      paperDefaultModelId: aiStore.paperDefaultModelId,
      titleGenProviderId: aiStore.titleGenProviderId,
      titleGenModelId: aiStore.titleGenModelId,
    },
    chat: {
      titleGenProviderId: chatStore.titleGenProviderId,
      titleGenModelId: chatStore.titleGenModelId,
      titleGenPrompt: chatStore.titleGenPrompt,
      temperature: chatStore.temperature,
      maxTokens: chatStore.maxTokens,
    },
    webSearch: {
      enabled: webSearchStore.enabled,
      activeProviderId: webSearchStore.activeProviderId,
      providerApiKeys,
      providerNumResults,
      exaSearchType: webSearchStore.exaSearchType,
    },
    home: { ...homeStore.settings, animals: homeStore.animals },
    general: {
      locale: localStorage.getItem('muse-locale') ?? 'zh-CN',
      currency: localStorage.getItem('muse-currency') ?? 'cny',
      trashRetentionDays: parseInt(localStorage.getItem('muse-trash-retention-days') ?? '30') || 30,
    },
    profile: {
      avatar: localStorage.getItem('muse-user-avatar'),
    },
    chatUi: {
      variantLayout: JSON.parse(localStorage.getItem('muse-variant-layout') ?? '{}'),
    },
    privateAssistant: {
      providerId: assistantSettingsStore.providerId,
      modelId: assistantSettingsStore.modelId,
      titleGenProviderId: assistantSettingsStore.titleGenProviderId,
      titleGenModelId: assistantSettingsStore.titleGenModelId,
      titleGenPrompt: assistantSettingsStore.titleGenPrompt,
    },
    travelCopilot: {
      enabled: travelCopilotStore.enabled,
      providerId: travelCopilotStore.providerId,
      modelId: travelCopilotStore.modelId,
      completionWords: travelCopilotStore.completionWords,
      triggerDelay: travelCopilotStore.triggerDelay,
      contextChars: travelCopilotStore.contextChars,
    },
    notesCopilot: {
      enabled: notesCopilotStore.enabled,
      providerId: notesCopilotStore.providerId,
      modelId: notesCopilotStore.modelId,
      completionWords: notesCopilotStore.completionWords,
      triggerDelay: notesCopilotStore.triggerDelay,
      contextChars: notesCopilotStore.contextChars,
    },
    paperCopilot: {
      defaultContextMode: paperCopilotStore.defaultContextMode,
    },
    statistics: {
      currency: statisticsStore.currency,
    },
    ebookTts: ebookStore.ttsSettings,
  }
}

/** Convert raw SettingsState into an array of per-category SyncItems. */
async function getSettingsItemsState(): Promise<any[]> {
  const state = await _collectRawSettingsState()
  return (Object.entries(state) as [string, any][])
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([id, value]) => ({
      id,
      value,
      updatedAt: _getSettingsCategoryTs(id),
      _version: 0,
    }))
}

async function getSettingsItemsManifest(): Promise<{ id: string; updatedAt?: string; _version?: number }[]> {
  const items = await getSettingsItemsState()
  return items.map(i => ({ id: i.id, updatedAt: i.updatedAt, _version: i._version }))
}

/** Apply a single settings category item to the appropriate store(s). */
async function _applySettingsItem(item: { id: string; value: any; updatedAt?: string }): Promise<void> {
  const { id, value } = item
  if (!value) return
  await applySettingsState({ [id]: value } as SettingsState)
  if (item.updatedAt) _setSettingsCategoryTs(id, item.updatedAt)
}

async function applyIncrementalSettingsItemsState(mergedItems: any[], _deletedIds: string[]): Promise<void> {
  for (const item of mergedItems) {
    await _applySettingsItem(item)
  }
}

/** Encrypt sensitive fields in each category item before computing changeset / sending to server. */
async function serializeSettingsItems(items: any[]): Promise<any[]> {
  const srvKey = getServerApiKey()
  if (!srvKey) return items
  const { encryptForServer } = await import('../utils/crypto')

  return Promise.all(items.map(async (item: any) => {
    if (item.id === 'ai' && item.value?.providers) {
      return {
        ...item,
        value: {
          ...item.value,
          providers: await Promise.all(
            item.value.providers.map(async (p: any) => ({
              ...p,
              apiKeyEnc: p.apiKey ? await encryptForServer(p.apiKey, srvKey).catch(() => '') : '',
              apiKey: undefined,
            })),
          ),
        },
      }
    }
    if (item.id === 'webSearch' && item.value?.providerApiKeys) {
      const { listWebSearchProviders } = await import('../services/webSearch')
      const providers: Record<string, any> = {}
      for (const { id } of listWebSearchProviders()) {
        const plainKey = item.value.providerApiKeys[id] ?? ''
        providers[id] = {
          apiKeyEnc: plainKey ? await encryptForServer(plainKey, srvKey).catch(() => '') : '',
          numResults: item.value.providerNumResults?.[id] ?? 5,
          ...(id === 'exa' ? { exaSearchType: item.value.exaSearchType ?? 'auto' } : {}),
        }
      }
      return {
        ...item,
        value: {
          enabled: item.value.enabled,
          activeProviderId: item.value.activeProviderId,
          providers,
        },
      }
    }
    return item
  }))
}

/** Decrypt sensitive fields when receiving items from server. */
async function deserializeSettingsItems(raw: any): Promise<any[]> {
  const items: any[] = Array.isArray(raw) ? raw : (raw?.items ?? [])
  if (items.length === 0) return []

  const srvKey = getServerApiKey()
  if (!srvKey) return items
  const { decryptFromServer } = await import('../utils/crypto')

  return Promise.all(items.map(async (item: any) => {
    if (item.id === 'ai' && item.value?.providers) {
      return {
        ...item,
        value: {
          ...item.value,
          providers: await Promise.all(
            item.value.providers.map(async (p: any) => {
              let apiKey = p.apiKey || ''
              if (p.apiKeyEnc) {
                try { apiKey = await decryptFromServer(p.apiKeyEnc, srvKey) } catch { /* ignore */ }
              }
              return { ...p, apiKey, apiKeyEnc: undefined }
            }),
          ),
        },
      }
    }
    if (item.id === 'webSearch' && item.value?.providers) {
      const providerApiKeys: Record<string, string> = {}
      const providerNumResults: Record<string, number> = {}
      let exaSearchType = 'auto'
      for (const [pid, pv] of Object.entries(item.value.providers as Record<string, any>)) {
        if (pv.apiKeyEnc && srvKey) {
          try { providerApiKeys[pid] = await decryptFromServer(pv.apiKeyEnc, srvKey) } catch { providerApiKeys[pid] = '' }
        }
        providerNumResults[pid] = pv.numResults ?? 5
        if (pid === 'exa' && pv.exaSearchType) exaSearchType = pv.exaSearchType
      }
      return {
        ...item,
        value: {
          enabled: item.value.enabled,
          activeProviderId: item.value.activeProviderId,
          providerApiKeys,
          providerNumResults,
          exaSearchType,
        },
      }
    }
    return item
  }))
}

async function applySettingsState(state: SettingsState): Promise<void> {
  if (state.ai) {
    const { useAiSettingsStore } = await import('../stores/aiSettings')
    const store = useAiSettingsStore()
    await store.syncFromServer(state as any)
  }

  if (state.chat) {
    const { useChatSettingsStore } = await import('../stores/chatSettings')
    const store = useChatSettingsStore()
    if (state.chat.titleGenProviderId !== undefined) store.titleGenProviderId = state.chat.titleGenProviderId
    if (state.chat.titleGenModelId !== undefined) store.titleGenModelId = state.chat.titleGenModelId
    if (state.chat.titleGenPrompt !== undefined) store.titleGenPrompt = state.chat.titleGenPrompt
    if (state.chat.temperature !== undefined) store.temperature = state.chat.temperature
    if (state.chat.maxTokens !== undefined) store.maxTokens = state.chat.maxTokens
    localStorage.setItem('muse-chat-settings', JSON.stringify({
      titleGenProviderId: store.titleGenProviderId,
      titleGenModelId: store.titleGenModelId,
      titleGenPrompt: store.titleGenPrompt,
      temperature: store.temperature,
      maxTokens: store.maxTokens,
    }))
  }

  if (state.webSearch) {
    const { useWebSearchStore } = await import('../stores/webSearch')
    const store = useWebSearchStore()
    if (state.webSearch.enabled !== undefined) store.enabled = state.webSearch.enabled
    if (state.webSearch.activeProviderId !== undefined) store.activeProviderId = state.webSearch.activeProviderId
    if (state.webSearch.exaSearchType) store.exaSearchType = state.webSearch.exaSearchType

    if (state.webSearch.providerApiKeys || state.webSearch.providerNumResults) {
      const { encryptLocal } = await import('../utils/crypto')
      const { listWebSearchProviders } = await import('../services/webSearch')
      const providers: Record<string, any> = {}
      for (const { id } of listWebSearchProviders()) {
        const plainKey = state.webSearch.providerApiKeys?.[id] ?? ''
        providers[id] = {
          apiKeyEnc: plainKey ? await encryptLocal(plainKey).catch(() => '') : '',
          numResults: state.webSearch.providerNumResults?.[id] ?? 5,
          ...(id === 'exa' ? { exaSearchType: state.webSearch.exaSearchType ?? 'auto' } : {}),
        }
      }
      localStorage.setItem('muse-web-search-settings', JSON.stringify({
        enabled: store.enabled,
        activeProviderId: store.activeProviderId,
        providers,
      }))
      store.reload()
    }
  }

  if (state.home) {
    const { useHomeStore } = await import('../stores/home')
    const store = useHomeStore()
    const { animals, ...settingsOnly } = state.home
    if (animals) store.animals = animals
    Object.assign(store.settings, settingsOnly)
    localStorage.setItem('muse-home-settings', JSON.stringify({ ...store.settings, animals: store.animals }))
  }

  if (state.general) {
    if (state.general.locale) localStorage.setItem('muse-locale', state.general.locale)
    if (state.general.currency) localStorage.setItem('muse-currency', state.general.currency)
    if (state.general.trashRetentionDays !== undefined) localStorage.setItem('muse-trash-retention-days', String(state.general.trashRetentionDays))
  }

  if (state.profile) {
    if (state.profile.avatar) localStorage.setItem('muse-user-avatar', state.profile.avatar)
    else if (state.profile.avatar === null) localStorage.removeItem('muse-user-avatar')
  }

  if (state.chatUi) {
    localStorage.setItem('muse-variant-layout', JSON.stringify(state.chatUi.variantLayout ?? {}))
  }

  if (state.privateAssistant) {
    const { useAssistantSettingsStore } = await import('../stores/assistantSettings')
    const store = useAssistantSettingsStore()
    if (state.privateAssistant.providerId !== undefined) store.providerId = state.privateAssistant.providerId
    if (state.privateAssistant.modelId !== undefined) store.modelId = state.privateAssistant.modelId
    if (state.privateAssistant.titleGenProviderId !== undefined) store.titleGenProviderId = state.privateAssistant.titleGenProviderId
    if (state.privateAssistant.titleGenModelId !== undefined) store.titleGenModelId = state.privateAssistant.titleGenModelId
    if (state.privateAssistant.titleGenPrompt !== undefined) store.titleGenPrompt = state.privateAssistant.titleGenPrompt
    localStorage.setItem('assistant-settings', JSON.stringify({
      providerId: store.providerId,
      modelId: store.modelId,
      titleGenProviderId: store.titleGenProviderId,
      titleGenModelId: store.titleGenModelId,
      titleGenPrompt: store.titleGenPrompt,
    }))
  }

  if (state.travelCopilot) {
    const { useTravelCopilotStore } = await import('../stores/travelCopilot')
    const store = useTravelCopilotStore()
    const payload = {
      enabled: state.travelCopilot.enabled ?? store.enabled,
      providerId: state.travelCopilot.providerId ?? store.providerId,
      modelId: state.travelCopilot.modelId ?? store.modelId,
      completionWords: state.travelCopilot.completionWords ?? store.completionWords,
      triggerDelay: state.travelCopilot.triggerDelay ?? store.triggerDelay,
      contextChars: state.travelCopilot.contextChars ?? store.contextChars,
    }
    localStorage.setItem('muse-travel-copilot', JSON.stringify(payload))
    store.reload()
  }

  if (state.notesCopilot) {
    const { useNotesCopilotStore } = await import('../stores/notesCopilot')
    const store = useNotesCopilotStore()
    const payload = {
      enabled: state.notesCopilot.enabled ?? store.enabled,
      providerId: state.notesCopilot.providerId ?? store.providerId,
      modelId: state.notesCopilot.modelId ?? store.modelId,
      completionWords: state.notesCopilot.completionWords ?? store.completionWords,
      triggerDelay: state.notesCopilot.triggerDelay ?? store.triggerDelay,
      contextChars: state.notesCopilot.contextChars ?? store.contextChars,
    }
    localStorage.setItem('muse-notes-copilot', JSON.stringify(payload))
    store.reload()
  }

  if (state.paperCopilot) {
    const { usePaperCopilotStore } = await import('../stores/paperCopilot')
    const store = usePaperCopilotStore()
    if (state.paperCopilot.defaultContextMode) {
      store.defaultContextMode = state.paperCopilot.defaultContextMode
      store.contextMode = state.paperCopilot.defaultContextMode
      localStorage.setItem('paperCopilot.defaultContextMode', state.paperCopilot.defaultContextMode)
    }
  }

  if (state.statistics) {
    const { useStatisticsStore } = await import('../stores/statistics')
    const store = useStatisticsStore()
    if (state.statistics.currency) {
      store.currency = state.statistics.currency
      localStorage.setItem('muse-currency', state.statistics.currency)
    }
  }

  if (state.ebookTts) {
    const { useEbookStore } = await import('../stores/ebook')
    const store = useEbookStore()
    store.ttsSettings = state.ebookTts
    localStorage.setItem('muse-ebook-tts-settings', JSON.stringify(state.ebookTts))
  }
}

const settingsModule: SyncModule<any[]> = {
  name: 'settings',
  getState: getSettingsItemsState,
  getManifest: getSettingsItemsManifest,
  applyIncrementalState: applyIncrementalSettingsItemsState,
  serialize: serializeSettingsItems,
  deserialize: deserializeSettingsItems,
}

// ─── Chat module ─────────────────────────────────────────────────────────────

async function getChatState(): Promise<Conversation[]> {
  const { listConversations, loadConversation } = await import('../utils/storage')
  const metas = await listConversations()
  const convs = await Promise.all(metas.map(m => loadConversation(m.id)))
  return convs.filter((c): c is Conversation => !!c)
}

async function getChatManifest(): Promise<{ id: string; updatedAt?: string; _version?: number }[]> {
  const { listConversations } = await import('../utils/storage')
  const metas = await listConversations()
  return metas.map(m => ({ id: m.id, updatedAt: m.updatedAt }))
}

async function applyIncrementalChatState(mergedItems: Conversation[], deletedIds: string[]): Promise<void> {
  const { saveConversationLocalOnly, deleteConversationLocalOnly, saveConversationToTrashLocalOnly } = await import('../utils/storage')
  const { useChatStore } = await import('../stores/chat')

  for (const conv of mergedItems) {
    if (!conv.id) continue
    if (!conv.title && (!conv.messages || conv.messages.length === 0)) continue
    if (!conv.title) conv.title = '新对话'
    if (conv.trashedAt) {
      await saveConversationToTrashLocalOnly(conv, conv.trashedAt)
    } else {
      await saveConversationLocalOnly(conv)
    }
  }

  for (const id of deletedIds) {
    await deleteConversationLocalOnly(id)
  }

  useChatStore().loadList()
}

/** Remove locally saved conversations that have no title and no messages (server junk). */
async function purgeEmptyChatConversations(): Promise<void> {
  try {
    const { listConversations, loadConversation, deleteConversationLocalOnly } = await import('../utils/storage')
    const { useChatStore } = await import('../stores/chat')
    const metas = await listConversations()
    const junkIds: string[] = []
    for (const meta of metas) {
      if (meta.title && meta.title.trim()) continue
      const full = await loadConversation(meta.id)
      const hasContent = full?.messages?.some(m => m.role !== 'system' && m.content?.trim())
      if (!hasContent) junkIds.push(meta.id)
    }
    for (const id of junkIds) await deleteConversationLocalOnly(id)
    if (junkIds.length > 0) {
      console.log(`[Sync] Purged ${junkIds.length} empty no-title conversations`)
      useChatStore().loadList()
    }
  } catch (err) {
    console.warn('[Sync] purgeEmptyChatConversations failed:', err)
  }
}

async function serializeChatState(state: Conversation[]): Promise<any> {
  const { prepareConvForServer } = await import('./chatSync')
  return await Promise.all(state.map(c => prepareConvForServer(c)))
}

async function deserializeChatState(raw: any): Promise<Conversation[]> {
  const { restoreConvFromServer } = await import('./chatSync')
  const items = Array.isArray(raw) ? raw : raw?.items ?? []
  if (!Array.isArray(items)) return []
  return await Promise.all(items.map((c: Conversation) => restoreConvFromServer(c)))
}

const chatModule: SyncModule<Conversation[]> = {
  name: 'chat',
  getState: getChatState,
  getManifest: getChatManifest,
  applyIncrementalState: applyIncrementalChatState,
  serialize: serializeChatState,
  deserialize: deserializeChatState,
}

// ─── Todo module ─────────────────────────────────────────────────────────────

async function getTodoState(): Promise<any[]> {
  const data = await loadTodos()
  return [
    ...data.projects.map(p => ({ ...p, id: `project:${p.id}`, _type: 'project' })),
    ...data.tasks.map(t => ({ ...t, id: `task:${t.id}`, _type: 'task' })),
  ]
}

async function getTodoManifest(): Promise<{ id: string; updatedAt?: string }[]> {
  const data = await loadTodos()
  return [
    ...data.projects.map(p => ({ id: `project:${p.id}`, updatedAt: p.updatedAt })),
    ...data.tasks.map(t => ({ id: `task:${t.id}`, updatedAt: t.updatedAt })),
  ]
}

async function applyIncrementalTodoState(mergedItems: any[], deletedIds: string[]): Promise<void> {
  const current = await loadTodos()
  const currentProjectMap = new Map(current.projects.map(p => [p.id, p]))
  const currentTaskMap = new Map(current.tasks.map(t => [t.id, t]))

  for (const item of mergedItems) {
    if (item.id?.startsWith('project:')) {
      const id = item.id.replace('project:', '')
      currentProjectMap.set(id, { ...item, id })
    } else if (item.id?.startsWith('task:')) {
      const id = item.id.replace('task:', '')
      currentTaskMap.set(id, { ...item, id })
    }
  }

  for (const id of deletedIds) {
    if (id.startsWith('project:')) {
      currentProjectMap.delete(id.replace('project:', ''))
    } else if (id.startsWith('task:')) {
      currentTaskMap.delete(id.replace('task:', ''))
    }
  }

  const data: TodoData = {
    version: 1,
    projects: Array.from(currentProjectMap.values()),
    tasks: Array.from(currentTaskMap.values()),
  }
  await saveTodos(data)
  const store = useTodoStore()
  store.projects = data.projects
  store.tasks = data.tasks
}

const todoModule: SyncModule<any[]> = {
  name: 'todo',
  getState: getTodoState,
  getManifest: getTodoManifest,
  applyIncrementalState: applyIncrementalTodoState,
  serialize: (state) => state,
  deserialize: (raw) => Array.isArray(raw) ? raw : [],
}

// ─── Ebook module ────────────────────────────────────────────────────────────

async function getEbookState(): Promise<any[]> {
  const { useEbookStore } = await import('../stores/ebook')
  const store = useEbookStore()
  const now = new Date().toISOString()
  const coreItems = [
    ...store.books.map((b: any) => ({ ...b, id: `book:${b.id}`, _type: 'book' })),
    ...Object.values(store.progress).map((p: any) => ({ ...p, id: `progress:${p.bookId}`, _type: 'progress' })),
    ...store.annotations.map((a: any) => ({ ...a, id: `annotation:${a.id}`, _type: 'annotation' })),
    ...store.sessions.map((s: any) => ({ ...s, id: `session:${s.id}`, _type: 'session' })),
    ...store.collections.map((c: any) => ({ ...c, id: `collection:${c.id}`, _type: 'collection' })),
  ]
  const metaItems = [
    { id: 'meta:copilotSessions', _type: 'meta', key: 'copilotSessions', value: store.copilotSessions, updatedAt: now },
    { id: 'meta:ttsPlaybackPos', _type: 'meta', key: 'ttsPlaybackPos', value: store.ttsPlaybackPos, updatedAt: now },
    { id: 'meta:ttsSettings', _type: 'meta', key: 'ttsSettings', value: store.ttsSettings, updatedAt: now },
    { id: 'meta:settings', _type: 'meta', key: 'settings', value: store.settings, updatedAt: now },
  ]
  return [...coreItems, ...metaItems]
}

async function getEbookManifest(): Promise<{ id: string; updatedAt?: string }[]> {
  const { useEbookStore } = await import('../stores/ebook')
  const store = useEbookStore()
  const now = new Date().toISOString()
  const manifest = [
    ...store.books.map((b: any) => ({ id: `book:${b.id}`, updatedAt: safeIso(b.updatedAt || b.addedAt, now) })),
    ...Object.values(store.progress).map((p: any) => ({ id: `progress:${p.bookId}`, updatedAt: safeIso(p.updatedAt, now) })),
    ...store.annotations.map((a: any) => ({ id: `annotation:${a.id}`, updatedAt: safeIso(a.updatedAt, now) })),
    ...store.sessions.map((s: any) => ({ id: `session:${s.id}`, updatedAt: safeIso(s.startedAt, now) })),
    ...store.collections.map((c: any) => ({ id: `collection:${c.id}`, updatedAt: safeIso(c.updatedAt || c.createdAt, now) })),
    { id: 'meta:copilotSessions', updatedAt: now },
    { id: 'meta:ttsPlaybackPos', updatedAt: now },
    { id: 'meta:ttsSettings', updatedAt: now },
    { id: 'meta:settings', updatedAt: now },
  ]
  // Include cached TTS audio metadata from localStorage
  try {
    const ttsAudioCache = JSON.parse(localStorage.getItem('muse-ebook-tts-audio-meta') || '{}')
    for (const [, items] of Object.entries(ttsAudioCache)) {
      for (const item of items as any[]) {
        manifest.push({ id: item.id, updatedAt: item.updatedAt })
      }
    }
  } catch { /* ignore */ }
  return manifest
}

async function applyIncrementalEbookState(mergedItems: any[], deletedIds: string[]): Promise<void> {
  const { useEbookStore } = await import('../stores/ebook')
  const store = useEbookStore()

  for (const item of mergedItems) {
    if (item.id?.startsWith('book:')) {
      const id = item.id.replace('book:', '')
      const idx = store.books.findIndex((b: any) => b.id === id)
      if (idx >= 0) store.books[idx] = { ...item, id }
      else store.books.push({ ...item, id })
    } else if (item.id?.startsWith('progress:')) {
      store.progress[item.bookId] = { ...item, id: item.id.replace('progress:', '') }
    } else if (item.id?.startsWith('annotation:')) {
      const id = item.id.replace('annotation:', '')
      const idx = store.annotations.findIndex((a: any) => a.id === id)
      if (idx >= 0) store.annotations[idx] = { ...item, id }
      else store.annotations.push({ ...item, id })
    } else if (item.id?.startsWith('session:')) {
      const id = item.id.replace('session:', '')
      const idx = store.sessions.findIndex((s: any) => s.id === id)
      if (idx >= 0) store.sessions[idx] = { ...item, id }
      else store.sessions.push({ ...item, id })
    } else if (item.id?.startsWith('collection:')) {
      const id = item.id.replace('collection:', '')
      const idx = store.collections.findIndex((c: any) => c.id === id)
      if (idx >= 0) store.collections[idx] = { ...item, id }
      else store.collections.push({ ...item, id })
    } else if (item.id?.startsWith('meta:')) {
      const key = item.key
      if (key === 'copilotSessions') store.copilotSessions = item.value || []
      else if (key === 'ttsPlaybackPos') store.ttsPlaybackPos = item.value || {}
      else if (key === 'ttsSettings') store.ttsSettings = item.value || {}
      else if (key === 'settings') store.settings = item.value || {}
    }
  }

  for (const id of deletedIds) {
    if (id.startsWith('book:')) store.books = store.books.filter((b: any) => b.id !== id.replace('book:', ''))
    else if (id.startsWith('progress:')) delete store.progress[id.replace('progress:', '')]
    else if (id.startsWith('annotation:')) store.annotations = store.annotations.filter((a: any) => a.id !== id.replace('annotation:', ''))
    else if (id.startsWith('session:')) store.sessions = store.sessions.filter((s: any) => s.id !== id.replace('session:', ''))
    else if (id.startsWith('collection:')) store.collections = store.collections.filter((c: any) => c.id !== id.replace('collection:', ''))
    else if (id.startsWith('meta:')) {
      const key = id.replace('meta:', '')
      if (key === 'copilotSessions') store.copilotSessions = []
      else if (key === 'ttsPlaybackPos') store.ttsPlaybackPos = {}
      else if (key === 'ttsSettings') store.ttsSettings = { ...store.ttsSettings }
      else if (key === 'settings') store.settings = { ...store.settings }
    }
  }

  localStorage.setItem('muse-ebook-books', JSON.stringify(store.books))
  localStorage.setItem('muse-ebook-progress', JSON.stringify(store.progress))
  localStorage.setItem('muse-ebook-annotations', JSON.stringify(store.annotations))
  localStorage.setItem('muse-ebook-sessions', JSON.stringify(store.sessions))
  localStorage.setItem('muse-ebook-collections', JSON.stringify(store.collections))
  localStorage.setItem('muse-ebook-copilot-sessions', JSON.stringify(store.copilotSessions))
  localStorage.setItem('muse-ebook-tts-positions', JSON.stringify(store.ttsPlaybackPos))
  localStorage.setItem('muse-ebook-tts-settings', JSON.stringify(store.ttsSettings))
  localStorage.setItem('muse-ebook-settings', JSON.stringify(store.settings))

  // Cache TTS audio metadata from server
  const ttsAudioItems = mergedItems.filter((i: any) => i.id?.startsWith('ttsAudio:'))
  if (ttsAudioItems.length > 0 || deletedIds.some((id: string) => id.startsWith('ttsAudio:'))) {
    try {
      const existingCache = JSON.parse(localStorage.getItem('muse-ebook-tts-audio-meta') || '{}')
      for (const item of ttsAudioItems) {
        const bookId = item.bookId
        if (!existingCache[bookId]) existingCache[bookId] = []
        const idx = existingCache[bookId].findIndex((x: any) => x.id === item.id)
        if (idx >= 0) existingCache[bookId][idx] = item
        else existingCache[bookId].push(item)
      }
      for (const id of deletedIds) {
        if (!id.startsWith('ttsAudio:')) continue
        const parts = id.replace('ttsAudio:', '').split(':')
        const bookId = parts[0]
        if (existingCache[bookId]) {
          existingCache[bookId] = existingCache[bookId].filter((x: any) => x.id !== id)
          if (existingCache[bookId].length === 0) delete existingCache[bookId]
        }
      }
      localStorage.setItem('muse-ebook-tts-audio-meta', JSON.stringify(existingCache))
    } catch { /* ignore */ }
  }
}

const ebookModule: SyncModule<any[]> = {
  name: 'ebook',
  getState: getEbookState,
  getManifest: getEbookManifest,
  applyIncrementalState: applyIncrementalEbookState,
  serialize: (state) => state,
  deserialize: (raw) => Array.isArray(raw) ? raw : [],
}

// ─── Travel module ───────────────────────────────────────────────────────────

async function getTravelState(): Promise<TravelNote[]> {
  const metas = await listTravelNotes()
  const notes = await Promise.all(metas.map(m => loadTravelNote(m.id)))
  return notes.filter((n): n is TravelNote => !!n)
}

async function getTravelManifest(): Promise<{ id: string; updatedAt?: string }[]> {
  const metas = await listTravelNotes()
  return metas.map(m => ({ id: m.id, updatedAt: m.updatedAt }))
}

async function applyIncrementalTravelState(mergedItems: TravelNote[], deletedIds: string[]): Promise<void> {
  const { deleteTravelNoteLocalOnly } = await import('../utils/travelStorage')
  for (const note of mergedItems) {
    await saveTravelNote(note, { sync: false })
  }
  for (const id of deletedIds) {
    await deleteTravelNoteLocalOnly(id)
  }
  useTravelStore().loadList()
}

const travelModule: SyncModule<TravelNote[]> = {
  name: 'travel',
  getState: getTravelState,
  getManifest: getTravelManifest,
  applyIncrementalState: applyIncrementalTravelState,
  serialize: (state) => state,
  deserialize: (raw) => (Array.isArray(raw) ? raw : []) as TravelNote[],
}

// ─── Notes module ────────────────────────────────────────────────────────────

async function getNotesState(): Promise<any[]> {
  const { loadGroups } = await import('../utils/notesStorage')
  const groups = await loadGroups()
  const groupItems = groups.map(g => ({
    id: `group:${g.id}`,
    _type: 'group',
    name: g.name,
    sortOrder: g.sortOrder,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    _version: (g as any)._version ?? 0,
  }))

  const metas = await listNotes()
  const notes = await Promise.all(metas.map(m => loadNote(m.id)))
  const noteItems = notes.filter((n): n is NoteItem => !!n).map(n => ({
    id: `note:${n.id}`,
    _type: 'note',
    groupId: n.groupId,
    title: n.title,
    content: n.content,
    tags: n.tags,
    cover: n.cover,
    date: n.date,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    _version: (n as any)._version ?? 0,
  }))

  return [...groupItems, ...noteItems]
}

async function getNotesManifest(): Promise<{ id: string; updatedAt?: string; _version?: number }[]> {
  const { loadGroups } = await import('../utils/notesStorage')
  const groups = await loadGroups()
  const metas = await listNotes()
  return [
    ...groups.map(g => ({ id: `group:${g.id}`, updatedAt: g.updatedAt, _version: (g as any)._version ?? 0 })),
    ...metas.map(m => ({ id: `note:${m.id}`, updatedAt: m.updatedAt, _version: (m as any)._version ?? 0 })),
  ]
}

async function applyIncrementalNotesState(mergedItems: any[], deletedIds: string[]): Promise<void> {
  const { deleteNoteLocalOnly, loadGroups, saveGroups } = await import('../utils/notesStorage')
  const currentGroups = await loadGroups()
  const groupMap = new Map(currentGroups.map(g => [g.id, g]))

  for (const item of mergedItems) {
    if (item.id?.startsWith('group:')) {
      const id = item.id.replace('group:', '')
      groupMap.set(id, { ...item, id })
    } else if (item.id?.startsWith('note:')) {
      const id = item.id.replace('note:', '')
      const note = { ...item, id }
      await saveNote(note, { sync: false, preserveUpdatedAt: true })
    }
  }

  for (const id of deletedIds) {
    if (id.startsWith('group:')) {
      groupMap.delete(id.replace('group:', ''))
    } else if (id.startsWith('note:')) {
      await deleteNoteLocalOnly(id.replace('note:', ''))
    }
  }

  await saveGroups(Array.from(groupMap.values()))
  useNotesStore().loadList()
}

const notesModule: SyncModule<any[]> = {
  name: 'notes',
  getState: getNotesState,
  getManifest: getNotesManifest,
  applyIncrementalState: applyIncrementalNotesState,
  serialize: (state) => state,
  deserialize: (raw) => Array.isArray(raw) ? raw : [],
}

// ─── Assistants module ───────────────────────────────────────────────────────

async function getAssistantsState(): Promise<Assistant[]> {
  const { listAssistants } = await import('../utils/storage')
  return await listAssistants()
}

async function getAssistantsManifest(): Promise<{ id: string; updatedAt?: string }[]> {
  const { listAssistants } = await import('../utils/storage')
  const list = await listAssistants()
  return list.map(a => ({ id: a.id, updatedAt: a.updatedAt }))
}

async function applyIncrementalAssistantsState(mergedItems: Assistant[], deletedIds: string[]): Promise<void> {
  const { saveAssistant, deleteAssistantLocalOnly, listAssistants } = await import('../utils/storage')
  const { useAssistantsStore } = await import('../stores/assistants')
  for (const a of mergedItems) {
    await saveAssistant(a)
  }
  for (const id of deletedIds) {
    await deleteAssistantLocalOnly(id)
  }
  useAssistantsStore().assistants = await listAssistants()
}

const assistantsModule: SyncModule<Assistant[]> = {
  name: 'assistants',
  getState: getAssistantsState,
  getManifest: getAssistantsManifest,
  applyIncrementalState: applyIncrementalAssistantsState,
  serialize: (state) => state,
  deserialize: (raw) => (Array.isArray(raw) ? raw : []) as Assistant[],
}

// ─── Registration ────────────────────────────────────────────────────────────

function registerAllModules() {
  registerSyncModule(settingsModule)
  registerSyncModule(chatModule)
  registerSyncModule(todoModule)
  registerSyncModule(ebookModule)
  registerSyncModule(travelModule)
  registerSyncModule(notesModule)
  registerSyncModule(assistantsModule)
}

// Ensure modules are registered once
registerAllModules()

// ─── 全局同步锁 ──────────────────────────────────────────────────────────────

let _syncAllInProgress = false

// ─── Orchestration ───────────────────────────────────────────────────────────

export async function syncAllFromServer(force = false): Promise<void> {
  if (_syncAllInProgress) {
    console.log('[Sync2] Already in progress, skipping')
    return
  }
  _syncAllInProgress = true

  if (!isBackendConfigured()) {
    setSyncAction(null)
    _syncAllInProgress = false
    return
  }

  beginSyncOp()

  const modules = ['settings', 'assistants', 'chat', 'todo', 'ebook', 'travel', 'notes']
  let firstErr: unknown

  if (force) {
    for (const m of modules) await clearSyncState(m)
  }

  try {
    for (const moduleName of modules) {
      try {
        setSyncModule(
          moduleName === 'settings' ? '设置'
            : moduleName === 'assistants' ? '助手'
            : moduleName === 'chat' ? '对话'
            : moduleName === 'todo' ? '待办'
            : moduleName === 'ebook' ? '电子书'
            : moduleName === 'travel' ? '旅行笔记'
            : moduleName === 'notes' ? '笔记'
            : moduleName,
        )
        addSyncAction(`正在同步 ${moduleName}…`)
        await _syncModule(moduleName)
        recordSyncTimestamp(moduleName, new Date().toISOString())
        removeSyncAction(`正在同步 ${moduleName}…`)
      } catch (err) {
        console.error(`[SyncManager2] ${moduleName} sync failed:`, err)
        firstErr ??= err
        removeSyncAction(`正在同步 ${moduleName}…`)
      }
    }

    // Clean up junk conversations (no title + no content) accumulated from server.
    purgeEmptyChatConversations().catch(() => {})

    // Tools sync uses individual PUT endpoints (not manifest-based), run separately.
    try {
      setSyncModule('工具')
      addSyncAction('正在同步工具历史记录…')
      await syncAllToolHistories()
      removeSyncAction('正在同步工具历史记录…')
    } catch (err) {
      console.error('[SyncManager2] tools sync failed:', err)
      firstErr ??= err
      removeSyncAction('正在同步工具历史记录…')
    }

    setSyncModule(null)
    setSyncAction(null)

    if (firstErr) {
      failSyncOp(firstErr)
    } else {
      endSyncOp()
    }
  } finally {
    _syncAllInProgress = false
  }

  // 排空离线队列（网络恢复后重试之前失败的同步）
  try {
    await drainOfflineQueue()
  } catch (err) {
    console.error('[SyncManager2] Failed to drain offline queue:', err)
  }
}

/**
 * Force a full sync by clearing local timestamps and syncing everything.
 */
export async function forceSyncAll(): Promise<void> {
  await syncAllFromServer(true)
}

export async function tryNewSync(force = false): Promise<void> {
  await syncAllFromServer(force)
}

// ─── Settings push helpers ────────────────────────────────────────────────────
// Called from settings UI components whenever a value changes, to push just
// the changed key-group to the server without triggering a full sync.

export async function pushGeneralSettings(): Promise<void> {
  await apiPut('/api/settings/general', {
    value: {
      locale:            localStorage.getItem('muse-locale') ?? 'zh-CN',
      currency:          localStorage.getItem('muse-currency') ?? 'cny',
      trashRetentionDays: parseInt(localStorage.getItem('muse-trash-retention-days') ?? '30') || 30,
    },
  }).catch(() => {})
}

export async function pushProfileSettings(): Promise<void> {
  await apiPut('/api/settings/profile', {
    value: { avatar: localStorage.getItem('muse-user-avatar') },
  }).catch(() => {})
}

export async function pushChatUiSettings(): Promise<void> {
  try {
    const variantLayout = JSON.parse(localStorage.getItem('muse-variant-layout') ?? '{}')
    await apiPut('/api/settings/chatUi', { value: { variantLayout } }).catch(() => {})
  } catch { /* ignore malformed JSON */ }
}
