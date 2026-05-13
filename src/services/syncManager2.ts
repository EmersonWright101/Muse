/**
 * New sync manager built on top of syncEngine.
 *
 * Registers SyncModules for all data domains and orchestrates sync.
 * No merge/dedup/conflict logic lives here — everything is delegated
 * to the backend via syncEngine.
 */

import {
  registerSyncModule,
  syncModule as _syncModule,
  computeObjectChangeset,
  getLastSyncedState,
  clearSyncState,
} from './syncEngine'
import { drainOfflineQueue } from './offlineQueue'
import type { SyncModule } from './syncEngine'
import { isBackendConfigured, getServerApiKey } from './api'
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

async function getSettingsState(): Promise<SettingsState> {
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

  // WebSearch: collect plaintext API keys via store helpers
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

async function applySettingsState(state: SettingsState): Promise<void> {
  if (state.ai) {
    const { useAiSettingsStore } = await import('../stores/aiSettings')
    const store = useAiSettingsStore()
    if (state.ai.activeProviderId !== undefined) store.activeProviderId = state.ai.activeProviderId
    if (state.ai.providers) store.providers = state.ai.providers
    if (state.ai.defaultProviderId !== undefined) store.defaultProviderId = state.ai.defaultProviderId
    if (state.ai.defaultModelId !== undefined) store.defaultModelId = state.ai.defaultModelId
    if (state.ai.ebookDefaultProviderId !== undefined) store.ebookDefaultProviderId = state.ai.ebookDefaultProviderId
    if (state.ai.ebookDefaultModelId !== undefined) store.ebookDefaultModelId = state.ai.ebookDefaultModelId
    if (state.ai.paperDefaultProviderId !== undefined) store.paperDefaultProviderId = state.ai.paperDefaultProviderId
    if (state.ai.paperDefaultModelId !== undefined) store.paperDefaultModelId = state.ai.paperDefaultModelId
    if (state.ai.titleGenProviderId !== undefined) store.titleGenProviderId = state.ai.titleGenProviderId
    if (state.ai.titleGenModelId !== undefined) store.titleGenModelId = state.ai.titleGenModelId
    await store.flush()
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
    localStorage.setItem('muse-chat-settings-modified-at', new Date().toISOString())
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
      localStorage.setItem('muse-web-search-settings-modified-at', new Date().toISOString())
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
    localStorage.setItem('muse-travel-copilot-modified-at', new Date().toISOString())
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
    localStorage.setItem('muse-notes-copilot-modified-at', new Date().toISOString())
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

async function serializeSettingsState(state: SettingsState): Promise<any> {
  const srvKey = getServerApiKey()
  if (!srvKey) return state

  const { encryptForServer } = await import('../utils/crypto')
  const serialized: any = { ...state }

  if (state.ai?.providers) {
    serialized.ai = {
      ...state.ai,
      providers: await Promise.all(
        state.ai.providers.map(async (p: any) => ({
          ...p,
          apiKeyEnc: p.apiKey ? await encryptForServer(p.apiKey, srvKey).catch(() => '') : '',
          apiKey: undefined,
        })),
      ),
    }
  }

  if (state.webSearch?.providerApiKeys) {
    const { listWebSearchProviders } = await import('../services/webSearch')
    const providers: Record<string, any> = {}
    for (const { id } of listWebSearchProviders()) {
      const plainKey = state.webSearch.providerApiKeys[id] ?? ''
      providers[id] = {
        apiKeyEnc: plainKey ? await encryptForServer(plainKey, srvKey).catch(() => '') : '',
        numResults: state.webSearch.providerNumResults?.[id] ?? 5,
        ...(id === 'exa' ? { exaSearchType: state.webSearch.exaSearchType ?? 'auto' } : {}),
      }
    }
    serialized.webSearch = {
      enabled: state.webSearch.enabled,
      activeProviderId: state.webSearch.activeProviderId,
      providers,
    }
  }

  return serialized
}

async function deserializeSettingsState(raw: any): Promise<SettingsState> {
  if (Array.isArray(raw)) raw = raw[0]
  const srvKey = getServerApiKey()
  if (!srvKey) return raw

  const { decryptFromServer } = await import('../utils/crypto')
  const deserialized: any = { ...raw }

  if (raw.ai?.providers) {
    deserialized.ai = {
      ...raw.ai,
      providers: await Promise.all(
        raw.ai.providers.map(async (p: any) => {
          let apiKey = ''
          if (p.apiKeyEnc) {
            try { apiKey = await decryptFromServer(p.apiKeyEnc, srvKey) } catch { /* ignore */ }
          }
          return { ...p, apiKey, apiKeyEnc: undefined }
        }),
      ),
    }
  }

  if (raw.webSearch?.providers) {
    const providerApiKeys: Record<string, string> = {}
    const providerNumResults: Record<string, number> = {}
    let exaSearchType = 'auto'
    for (const [id, pv] of Object.entries(raw.webSearch.providers)) {
      if ((pv as any).apiKeyEnc && srvKey) {
        try { providerApiKeys[id] = await decryptFromServer((pv as any).apiKeyEnc, srvKey) } catch { providerApiKeys[id] = '' }
      }
      providerNumResults[id] = (pv as any).numResults ?? 5
      if (id === 'exa' && (pv as any).exaSearchType) exaSearchType = (pv as any).exaSearchType
    }
    deserialized.webSearch = {
      enabled: raw.webSearch.enabled,
      activeProviderId: raw.webSearch.activeProviderId,
      providerApiKeys,
      providerNumResults,
      exaSearchType,
    }
  }

  return deserialized
}

const settingsModule: SyncModule<SettingsState> = {
  name: 'settings',
  getState: getSettingsState,
  getLastSyncedState: () => getLastSyncedState('settings') as SettingsState | null,
  applyState: applySettingsState,
  serialize: serializeSettingsState,
  deserialize: deserializeSettingsState,
  computeChangeset: computeObjectChangeset,
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

async function applyChatState(state: Conversation[]): Promise<void> {
  const { saveConversationLocalOnly } = await import('../utils/storage')
  const { useChatStore } = await import('../stores/chat')

  for (const conv of state) {
    await saveConversationLocalOnly(conv)
  }

  useChatStore().loadList()
}

async function applyIncrementalChatState(mergedItems: Conversation[], deletedIds: string[]): Promise<void> {
  const { saveConversationLocalOnly, deleteConversationLocalOnly } = await import('../utils/storage')
  const { useChatStore } = await import('../stores/chat')

  for (const conv of mergedItems) {
    await saveConversationLocalOnly(conv)
  }

  for (const id of deletedIds) {
    await deleteConversationLocalOnly(id)
  }

  useChatStore().loadList()
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
  getLastSyncedState: () => getLastSyncedState('chat') as Conversation[] | null,
  applyState: applyChatState,
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

async function applyTodoState(state: any[]): Promise<void> {
  const projects = state
    .filter((item: any) => item.id?.startsWith('project:'))
    .map((item: any) => ({ ...item, id: item.id.replace('project:', '') }))
  const tasks = state
    .filter((item: any) => item.id?.startsWith('task:'))
    .map((item: any) => ({ ...item, id: item.id.replace('task:', '') }))
  const data: TodoData = { version: 1, projects, tasks }
  await saveTodos(data)
  const store = useTodoStore()
  store.projects = projects
  store.tasks = tasks
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
  getLastSyncedState: () => getLastSyncedState('todo') as any[] | null,
  applyState: applyTodoState,
  applyIncrementalState: applyIncrementalTodoState,
  serialize: (state) => state,
  deserialize: (raw) => {
    const items = Array.isArray(raw) ? raw : raw?.items ?? []
    return items
  },
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
    ...store.books.map((b: any) => ({ id: `book:${b.id}`, updatedAt: new Date(b.updatedAt || b.addedAt).toISOString() })),
    ...Object.values(store.progress).map((p: any) => ({ id: `progress:${p.bookId}`, updatedAt: new Date(p.updatedAt).toISOString() })),
    ...store.annotations.map((a: any) => ({ id: `annotation:${a.id}`, updatedAt: new Date(a.updatedAt).toISOString() })),
    ...store.sessions.map((s: any) => ({ id: `session:${s.id}`, updatedAt: new Date(s.startedAt).toISOString() })),
    ...store.collections.map((c: any) => ({ id: `collection:${c.id}`, updatedAt: new Date(c.updatedAt || c.createdAt).toISOString() })),
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

async function applyEbookState(state: any[]): Promise<void> {
  const { useEbookStore } = await import('../stores/ebook')
  const store = useEbookStore()

  const books = state.filter((i: any) => i.id?.startsWith('book:')).map((i: any) => ({ ...i, id: i.id.replace('book:', '') }))
  const progressEntries = state.filter((i: any) => i.id?.startsWith('progress:')).map((i: any) => [i.bookId, { ...i, id: i.id.replace('progress:', '') }])
  const annotations = state.filter((i: any) => i.id?.startsWith('annotation:')).map((i: any) => ({ ...i, id: i.id.replace('annotation:', '') }))
  const sessions = state.filter((i: any) => i.id?.startsWith('session:')).map((i: any) => ({ ...i, id: i.id.replace('session:', '') }))
  const collections = state.filter((i: any) => i.id?.startsWith('collection:')).map((i: any) => ({ ...i, id: i.id.replace('collection:', '') }))

  store.books = books
  store.progress = Object.fromEntries(progressEntries)
  store.annotations = annotations
  store.sessions = sessions
  store.collections = collections

  localStorage.setItem('muse-ebook-books', JSON.stringify(books))
  localStorage.setItem('muse-ebook-progress', JSON.stringify(Object.fromEntries(progressEntries)))
  localStorage.setItem('muse-ebook-annotations', JSON.stringify(annotations))
  localStorage.setItem('muse-ebook-sessions', JSON.stringify(sessions))
  localStorage.setItem('muse-ebook-collections', JSON.stringify(collections))

  // Apply meta items
  for (const item of state.filter((i: any) => i.id?.startsWith('meta:'))) {
    const key = item.key
    if (key === 'copilotSessions') store.copilotSessions = item.value || []
    else if (key === 'ttsPlaybackPos') store.ttsPlaybackPos = item.value || {}
    else if (key === 'ttsSettings') store.ttsSettings = item.value || {}
    else if (key === 'settings') store.settings = item.value || {}
  }
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
  getLastSyncedState: () => getLastSyncedState('ebook') as any[] | null,
  applyState: applyEbookState,
  applyIncrementalState: applyIncrementalEbookState,
  serialize: (state) => state,
  deserialize: (raw) => {
    const items = Array.isArray(raw) ? raw : raw?.items ?? []
    return items
  },
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

async function applyTravelState(state: TravelNote[]): Promise<void> {
  for (const note of state) {
    await saveTravelNote(note, { sync: false })
  }
  useTravelStore().loadList()
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
  getLastSyncedState: () => getLastSyncedState('travel') as TravelNote[] | null,
  applyState: applyTravelState,
  applyIncrementalState: applyIncrementalTravelState,
  serialize: (state) => state,
  deserialize: (raw) => {
    const items = Array.isArray(raw) ? raw : raw?.items ?? []
    return items as TravelNote[]
  },
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

async function applyNotesState(state: any[]): Promise<void> {
  const { saveGroups } = await import('../utils/notesStorage')
  const groups = state
    .filter((i: any) => i.id?.startsWith('group:'))
    .map((i: any) => ({ ...i, id: i.id.replace('group:', '') }))
  const notes = state
    .filter((i: any) => i.id?.startsWith('note:'))
    .map((i: any) => ({ ...i, id: i.id.replace('note:', '') }))

  await saveGroups(groups)
  for (const note of notes) {
    await saveNote(note, { sync: false })
  }
  useNotesStore().loadList()
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
  getLastSyncedState: () => getLastSyncedState('notes') as any[] | null,
  applyState: applyNotesState,
  applyIncrementalState: applyIncrementalNotesState,
  serialize: (state) => state,
  deserialize: (raw) => {
    const items = Array.isArray(raw) ? raw : raw?.items ?? []
    return items
  },
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

async function applyAssistantsState(state: Assistant[]): Promise<void> {
  const { saveAssistant } = await import('../utils/storage')
  const { useAssistantsStore } = await import('../stores/assistants')
  for (const a of state) {
    await saveAssistant(a)
  }
  useAssistantsStore().assistants = state
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
  getLastSyncedState: () => getLastSyncedState('assistants') as Assistant[] | null,
  applyState: applyAssistantsState,
  applyIncrementalState: applyIncrementalAssistantsState,
  serialize: (state) => state,
  deserialize: (raw) => {
    const items = Array.isArray(raw) ? raw : raw?.items ?? []
    return items as Assistant[]
  },
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

/**
 * Try the new sync protocol first, with fallback to the old one.
 * Respects localStorage flag `muse-use-new-sync`.
 */
export async function tryNewSync(force = false): Promise<void> {
  const useNew = localStorage.getItem('muse-use-new-sync') === 'true' || force
  if (!useNew) {
    const { syncAllFromServer } = await import('./syncManager')
    return syncAllFromServer(force)
  }

  try {
    await syncAllFromServer(force)
  } catch (err) {
    console.error('[Sync] New sync protocol failed, falling back to old:', err)
    const { syncAllFromServer } = await import('./syncManager')
    return syncAllFromServer(force)
  }
}
