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
import { loadTodos, saveTodos } from '../utils/todoStorage'
import { listTravelNotes, loadTravelNote, saveTravelNote } from '../utils/travelStorage'
import { useTodoStore } from '../stores/todo'
import { useTravelStore } from '../stores/travel'
import { useEbookStore } from '../stores/ebook'

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

async function applyChatState(state: Conversation[]): Promise<void> {
  const { saveConversationLocalOnly } = await import('../utils/storage')
  const { useChatStore } = await import('../stores/chat')

  for (const conv of state) {
    await saveConversationLocalOnly(conv)
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
  getLastSyncedState: () => getLastSyncedState('chat') as Conversation[] | null,
  applyState: applyChatState,
  serialize: serializeChatState,
  deserialize: deserializeChatState,
}

// ─── Todo module ─────────────────────────────────────────────────────────────

async function getTodoState(): Promise<TodoData> {
  return await loadTodos()
}

async function applyTodoState(state: TodoData): Promise<void> {
  await saveTodos(state)
  const store = useTodoStore()
  store.projects = state.projects
  store.tasks = state.tasks
}

const todoModule: SyncModule<TodoData> = {
  name: 'todo',
  getState: getTodoState,
  getLastSyncedState: () => getLastSyncedState('todo') as TodoData | null,
  applyState: applyTodoState,
  serialize: (state) => state,
  deserialize: (raw) => {
    if (Array.isArray(raw)) raw = raw[0]
    return raw as TodoData
  },
}

// ─── Ebook module ────────────────────────────────────────────────────────────

async function getEbookState(): Promise<any> {
  const store = useEbookStore()
  return {
    books: store.books,
    progress: store.progress,
    annotations: store.annotations,
    sessions: store.sessions,
    collections: store.collections,
    settings: store.settings,
    // Heavy fields omitted from the sync protocol to avoid oversized payloads:
    // - copilotSessions: contains full message history and can be very large.
    // - ttsJobStates: ephemeral TTS generation state.
    // These should be synced independently or not at all.
    ttsPlaybackPos: store.ttsPlaybackPos,
    ttsSettings: store.ttsSettings,
  }
}

async function applyEbookState(state: any): Promise<void> {
  const store = useEbookStore()

  // Apply state in batches to avoid UI blocking with large datasets
  const keys: string[] = ['books', 'progress', 'annotations', 'sessions', 'collections', 'settings', 'ttsPlaybackPos', 'ttsSettings']
  const BATCH_SIZE = 3

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE)
    for (const key of batch) {
      if (state[key] !== undefined) {
        ;(store as any)[key] = state[key]
      }
    }
    if (i + BATCH_SIZE < keys.length) {
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
  }

  const storageMap: Record<string, string> = {
    books: 'muse-ebook-books',
    progress: 'muse-ebook-progress',
    annotations: 'muse-ebook-annotations',
    sessions: 'muse-ebook-sessions',
    collections: 'muse-ebook-collections',
    settings: 'muse-ebook-settings',
    ttsSettings: 'muse-ebook-tts-settings',
    ttsPlaybackPos: 'muse-ebook-tts-playback',
  }

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE)
    for (const key of batch) {
      const lsKey = storageMap[key]
      if (lsKey && state[key] !== undefined) {
        localStorage.setItem(lsKey, JSON.stringify(state[key]))
      }
    }
    if (i + BATCH_SIZE < keys.length) {
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
  }
}

const ebookModule: SyncModule<any> = {
  name: 'ebook',
  getState: getEbookState,
  getLastSyncedState: () => getLastSyncedState('ebook'),
  applyState: applyEbookState,
  serialize: (state) => state,
  deserialize: (raw) => {
    if (Array.isArray(raw)) raw = raw[0]
    return raw
  },
}

// ─── Travel module ───────────────────────────────────────────────────────────

async function getTravelState(): Promise<TravelNote[]> {
  const metas = await listTravelNotes()
  const notes = await Promise.all(metas.map(m => loadTravelNote(m.id)))
  return notes.filter((n): n is TravelNote => !!n)
}

async function applyTravelState(state: TravelNote[]): Promise<void> {
  for (const note of state) {
    await saveTravelNote(note, { sync: false })
  }
  useTravelStore().loadList()
}

const travelModule: SyncModule<TravelNote[]> = {
  name: 'travel',
  getState: getTravelState,
  getLastSyncedState: () => getLastSyncedState('travel') as TravelNote[] | null,
  applyState: applyTravelState,
  serialize: (state) => state,
  deserialize: (raw) => {
    const items = Array.isArray(raw) ? raw : raw?.items ?? []
    return items as TravelNote[]
  },
}

// ─── Assistants module ───────────────────────────────────────────────────────

async function getAssistantsState(): Promise<Assistant[]> {
  const { listAssistants } = await import('../utils/storage')
  return await listAssistants()
}

async function applyAssistantsState(state: Assistant[]): Promise<void> {
  const { saveAssistant } = await import('../utils/storage')
  const { useAssistantsStore } = await import('../stores/assistants')
  for (const a of state) {
    await saveAssistant(a)
  }
  useAssistantsStore().assistants = state
}

const assistantsModule: SyncModule<Assistant[]> = {
  name: 'assistants',
  getState: getAssistantsState,
  getLastSyncedState: () => getLastSyncedState('assistants') as Assistant[] | null,
  applyState: applyAssistantsState,
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

  const modules = ['settings', 'assistants', 'chat', 'todo', 'ebook', 'travel']
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
