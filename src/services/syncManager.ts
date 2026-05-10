/**
 * Startup sync orchestrator.
 *
 * On app launch (when backend is configured):
 * 1. Pull all settings in one request → apply to each store
 * 2. Sync assistants
 * 3. Sync chat conversation list (merge remote into local index)
 * 4. Sync home settings & posters
 * 5. Sync travel notes list (merge remote into local)
 * 6. Detect first-time use → migrate local data to backend
 *
 * All operations are best-effort and non-blocking — failures are silently
 * swallowed so the app boots even when offline.
 */

import { apiGet, apiDelete, apiPost, apiPut, isBackendConfigured } from './api'
import { setSyncState, beginSyncOp, endSyncOp, failSyncOp, setSyncModule } from '../stores/syncStatus'
import {
  fetchConvListFromServer,
  fetchConvFromServer,
  migrateConvsToServer,
  pushConvToServer,
  restoreConvOnServer,
  trashConvOnServer,
} from './chatSync'
import {
  readTextFile, writeTextFile, exists, mkdir,
} from '@tauri-apps/plugin-fs'
import { conversationsDir } from '../utils/path'
import type { ConversationMeta, Conversation } from '../utils/storage'
import {
  saveConversationLocalOnly,
  mergeConversation,
  trashConversation,
  listTrashedConversations,
  restoreConversationFromTrash,
} from '../utils/storage'
import type { TravelNote, TravelNoteMeta, TravelTrashMeta } from '../utils/travelStorage'
import {
  saveTravelNote, listTravelNotes, loadTravelNote,
  listTrashItems, moveNoteToTrash, restoreNoteFromTrash,
  cacheTravelImagesForContent, uploadReferencedTravelImages,
} from '../utils/travelStorage'
import { useEbookStore } from '../stores/ebook'

// ─── Lazy store accessors (avoid circular init) ──────────────────────────────

async function getTodoStore() {
  const { useTodoStore } = await import('../stores/todo')
  return useTodoStore()
}
async function getAiStore() {
  const { useAiSettingsStore } = await import('../stores/aiSettings')
  return useAiSettingsStore()
}
async function getChatSettingsStore() {
  const { useChatSettingsStore } = await import('../stores/chatSettings')
  return useChatSettingsStore()
}
async function getWebSearchStore() {
  const { useWebSearchStore } = await import('../stores/webSearch')
  return useWebSearchStore()
}
async function getAssistantsStore() {
  const { useAssistantsStore } = await import('../stores/assistants')
  return useAssistantsStore()
}
async function getPrivateAssistantStore() {
  const { useAssistantStore } = await import('../stores/assistant')
  return useAssistantStore()
}
async function getPrivateAssistantSettingsStore() {
  const { useAssistantSettingsStore } = await import('../stores/assistantSettings')
  return useAssistantSettingsStore()
}
async function getTravelCopilotStore() {
  const { useTravelCopilotStore } = await import('../stores/travelCopilot')
  return useTravelCopilotStore()
}
async function getPaperCopilotStore() {
  const { usePaperCopilotStore } = await import('../stores/paperCopilot')
  return usePaperCopilotStore()
}
async function getHomeStore() {
  const { useHomeStore } = await import('../stores/home')
  return useHomeStore()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function atomicWrite(path: string, content: string) {
  const tmp = `${path}.tmp`
  await writeTextFile(tmp, content)
  const { rename } = await import('@tauri-apps/plugin-fs')
  await rename(tmp, path)
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    if (!(await exists(path))) return null
    return JSON.parse(await readTextFile(path)) as T
  } catch { return null }
}

function pickRemote<T>(obj: Record<string, unknown>, camel: string, snake: string, fallback?: T): T {
  return (obj[camel] ?? obj[snake] ?? fallback) as T
}

function normalizeRemoteConvMeta(rm: Record<string, unknown>) {
  return {
    id:          pickRemote<string>(rm, 'id', 'id', ''),
    title:       pickRemote<string>(rm, 'title', 'title', ''),
    createdAt:   pickRemote<string>(rm, 'createdAt', 'created_at', ''),
    updatedAt:   pickRemote<string>(rm, 'updatedAt', 'updated_at', ''),
    model:       pickRemote<string>(rm, 'model', 'model', ''),
    providerId:  pickRemote<string>(rm, 'providerId', 'provider_id', ''),
    pinned:      pickRemote<boolean>(rm, 'pinned', 'pinned', false),
    assistantId: pickRemote<string | null>(rm, 'assistantId', 'assistant_id', null),
    trashedAt:   pickRemote<string | null>(rm, 'trashedAt', 'trashed_at', null),
  }
}

function buildTrashExpiry(deletedAt: string): string | null {
  const days = parseInt(localStorage.getItem('muse-trash-retention-days') ?? '30') || 30
  if (days <= 0) return null
  return new Date(new Date(deletedAt).getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

// ─── Chat conversation list merge ─────────────────────────────────────────────

async function syncChatList() {
  const remote = await fetchConvListFromServer(true)
  if (!remote) return

  const dir = await conversationsDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const indexPath = `${dir}/index.json`

  let localIndex = (await readJsonFile<ConversationMeta[]>(indexPath)) ?? []
  const localIds = new Set(localIndex.map(m => m.id))
  const remoteMetas = (remote as unknown as Array<Record<string, unknown>>).map(normalizeRemoteConvMeta)

  // Apply remote trash state first so deleted conversations do not reappear locally.
  for (const rm of remoteMetas) {
    if (!rm.trashedAt || !localIds.has(rm.id)) continue
    const localMeta = localIndex.find(m => m.id === rm.id)
    if (localMeta && localMeta.updatedAt > rm.trashedAt) {
      const localConv = await readJsonFile<Conversation>(`${dir}/${rm.id}.json`)
      if (localConv) {
        restoreConvOnServer(rm.id).catch(() => {})
        pushConvToServer(localConv).catch(() => {})
      }
      continue
    }
    await trashConversation(rm.id, { sync: false, deletedAt: rm.trashedAt }).catch(() => {})
  }

  localIndex = (await readJsonFile<ConversationMeta[]>(indexPath)) ?? []
  const localTrash = await listTrashedConversations()
  const localTrashMap = new Map(localTrash.map(m => [m.id, m]))
  const activeRemote = remoteMetas.filter(rm => !rm.trashedAt)

  // Add missing remote entries, and reconcile newer records for existing entries.
  let changed = false
  for (const rm of activeRemote) {
    const trashedLocal = localTrashMap.get(rm.id)
    if (trashedLocal) {
      if (trashedLocal.deletedAt >= rm.updatedAt) {
        trashConvOnServer(rm.id, trashedLocal.deletedAt, buildTrashExpiry(trashedLocal.deletedAt)).catch(() => {})
        continue
      }
      await restoreConversationFromTrash(rm.id).catch(() => {})
      localIndex = (await readJsonFile<ConversationMeta[]>(indexPath)) ?? []
    }

    const localMeta = localIndex.find(m => m.id === rm.id)
    if (!localMeta) {
      localIndex.unshift({
        id:          rm.id,
        title:       rm.title,
        createdAt:   rm.createdAt,
        updatedAt:   rm.updatedAt,
        preview:     '',
        model:       rm.model,
        providerId:  rm.providerId,
        pinned:      rm.pinned,
        assistantId: rm.assistantId ?? undefined,
      })
      changed = true
      // Fetch and cache full conversation content for offline access.
      // Only save if the server returns real messages — a conversation with no messages
      // indicates the server may not have fully stored it yet (preliminary push race).
      // Leaving the file absent lets loadConversation retry on demand.
      const remoteConv = await fetchConvFromServer(rm.id)
      if (remoteConv && remoteConv.messages.some((m: { content?: string; mediaOutputs?: unknown[] }) => m.content?.trim() || m.mediaOutputs?.length)) {
        await saveConversationLocalOnly(remoteConv)
      }
      continue
    }

    const localConv = await readJsonFile<Conversation>(`${dir}/${rm.id}.json`)
    if (!localConv) {
      const remoteConv = await fetchConvFromServer(rm.id)
      if (remoteConv && remoteConv.messages.some((m: { content?: string; mediaOutputs?: unknown[] }) => m.content?.trim() || m.mediaOutputs?.length)) {
        await saveConversationLocalOnly(remoteConv)
      }
      continue
    }

    if (rm.updatedAt > localMeta.updatedAt) {
      const remoteConv = await fetchConvFromServer(rm.id)
      if (!remoteConv) continue
      const { merged, localChanged, remoteChanged } = mergeConversation(localConv, remoteConv)
      if (localChanged) await saveConversationLocalOnly(merged)
      if (remoteChanged) pushConvToServer(merged).catch(() => {})
    } else if (localMeta.updatedAt > rm.updatedAt) {
      // Local is newer — push to server. But if local still has the default title while
      // server has a real AI-generated title, prefer the server title to avoid overwriting it.
      const DEFAULT_TITLE = '新对话'
      if (localConv.title === DEFAULT_TITLE && rm.title && rm.title !== DEFAULT_TITLE) {
        const remoteConv = await fetchConvFromServer(rm.id)
        if (remoteConv) {
          const fixed = { ...localConv, title: remoteConv.title }
          await saveConversationLocalOnly(fixed)
          pushConvToServer(fixed).catch(() => {})
          continue
        }
      }
      pushConvToServer(localConv).catch(() => {})
    }
  }
  if (changed) await atomicWrite(indexPath, JSON.stringify(localIndex, null, 2))

  // Push local conversations not on remote (covers first-time migration + failed-upload retry)
  localIndex = (await readJsonFile<ConversationMeta[]>(indexPath)) ?? []
  const remoteIds = new Set(remoteMetas.map(r => r.id))
  for (const trashed of localTrash) {
    if (!remoteIds.has(trashed.id)) {
      trashConvOnServer(trashed.id, trashed.deletedAt, buildTrashExpiry(trashed.deletedAt)).catch(() => {})
    }
  }
  const localOnly = localIndex.filter(m => !remoteIds.has(m.id))
  if (localOnly.length > 0) {
    const localConvs: Conversation[] = []
    for (const meta of localOnly) {
      const convPath = `${dir}/${meta.id}.json`
      const conv = await readJsonFile<Conversation>(convPath)
      if (conv) localConvs.push(conv)
    }
    if (activeRemote.length === 0) {
      migrateConvsToServer(localConvs).catch(() => {})
    } else {
      for (const conv of localConvs) pushConvToServer(conv).catch(() => {})
    }
  }
}

// ─── Travel notes list merge ──────────────────────────────────────────────────

interface NormalizedRemoteTravelMeta {
  id: string
  title: string
  lat: number
  lng: number
  categoryL1: string
  categoryL2: string
  tags: string[]
  rating: number
  date: string
  cover: string
  status: 'visited' | 'upcoming'
  updatedAt: string
  deletedAt: string | null
}

function normalizeTravelTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'string') return raw.split(',').map(t => t.trim()).filter(Boolean)
  return []
}

function normalizeRemoteTravelMeta(raw: Record<string, unknown>): NormalizedRemoteTravelMeta {
  const status = pickRemote<string>(raw, 'status', 'status', 'visited')
  return {
    id:         pickRemote<string>(raw, 'id', 'id', ''),
    title:      pickRemote<string>(raw, 'title', 'title', ''),
    lat:        Number(pickRemote<number>(raw, 'lat', 'lat', 0)) || 0,
    lng:        Number(pickRemote<number>(raw, 'lng', 'lng', 0)) || 0,
    categoryL1: pickRemote<string>(raw, 'categoryL1', 'category_l1', ''),
    categoryL2: pickRemote<string>(raw, 'categoryL2', 'category_l2', ''),
    tags:       normalizeTravelTags(pickRemote<unknown>(raw, 'tags', 'tags', [])),
    rating:     Number(pickRemote<number>(raw, 'rating', 'rating', 0)) || 0,
    date:       pickRemote<string>(raw, 'date', 'date', new Date().toISOString().slice(0, 10)),
    cover:      pickRemote<string>(raw, 'cover', 'cover', ''),
    status:     status === 'upcoming' ? 'upcoming' : 'visited',
    updatedAt:  pickRemote<string>(raw, 'updatedAt', 'updated_at', ''),
    deletedAt:  pickRemote<string | null>(raw, 'deletedAt', 'deleted_at', null),
  }
}

async function fetchFullTravelNote(id: string): Promise<TravelNote | null> {
  const full = await apiGet<Record<string, unknown>>(`/api/travel/notes/${id}`)
  if (!full) return null
  const meta = normalizeRemoteTravelMeta(full)
  return {
    ...meta,
    content:   pickRemote<string>(full, 'content', 'content', ''),
    updatedAt: meta.updatedAt,
    deletedAt: meta.deletedAt ?? undefined,
  }
}

async function syncTravelList() {
  try {
    const remoteRaw = await apiGet<Array<Record<string, unknown>>>('/api/travel/notes?include_deleted=true')
    if (!remoteRaw) return

    const remote = remoteRaw.map(normalizeRemoteTravelMeta).filter(r => r.id)
    const remoteIds = new Set(remote.map(r => r.id))
    const activeRemote = remote.filter(r => !r.deletedAt)
    const deletedRemote = remote.filter(r => r.deletedAt)

    const localMetas = await listTravelNotes()
    const localMap = new Map<string, TravelNoteMeta>(localMetas.map(n => [n.id, n]))
    const localTrash = await listTrashItems()
    const localTrashMap = new Map<string, TravelTrashMeta>(localTrash.map(n => [n.id, n]))

    // Remote trash → local trash, unless the local active note is newer.
    for (const rm of deletedRemote) {
      try {
        const local = localMap.get(rm.id)
        if (!local) continue
        if (!rm.deletedAt || local.updatedAt > rm.deletedAt) {
          const note = await loadTravelNote(rm.id)
          if (note) {
            await apiPost(`/api/travel/notes/${rm.id}/restore`, {}).catch(() => {})
            await saveTravelNote(note, { preserveUpdatedAt: true })
          }
        } else {
          await moveNoteToTrash(rm.id, { sync: false, deletedAt: rm.deletedAt })
        }
      } catch { /* skip this note, continue with others */ }
    }

    // Remote active → local, local trash conflict handling, or local newer → remote.
    for (const rm of activeRemote) {
      try {
        const trashedLocal = localTrashMap.get(rm.id)
        if (trashedLocal) {
          if (trashedLocal.deletedAt >= rm.updatedAt) {
            apiDelete(`/api/travel/notes/${rm.id}`).catch(() => {})
            continue
          }
          await restoreNoteFromTrash(rm.id, { sync: false }).catch(() => {})
        }

        const local = localMap.get(rm.id)
        if (!local || rm.updatedAt > local.updatedAt || trashedLocal) {
          const full = await fetchFullTravelNote(rm.id)
          if (!full) continue
          await saveTravelNote(full, { sync: false, preserveUpdatedAt: true })
          cacheTravelImagesForContent(full.content).catch(() => {})
        } else if (local.updatedAt > rm.updatedAt) {
          const note = await loadTravelNote(rm.id)
          if (!note) continue
          await saveTravelNote(note, { preserveUpdatedAt: true })
          uploadReferencedTravelImages(note.id, note.content).catch(() => {})
        }
      } catch { /* skip this note, continue with others */ }
    }

    // Local active notes absent from all remote records → push.
    for (const meta of localMetas) {
      if (remoteIds.has(meta.id)) continue
      try {
        const note = await loadTravelNote(meta.id)
        if (!note) continue
        await saveTravelNote(note, { preserveUpdatedAt: true })
        uploadReferencedTravelImages(note.id, note.content).catch(() => {})
      } catch { /* skip this note, continue with others */ }
    }

    // Local trash absent remotely → keep server tombstone if possible.
    for (const item of localTrash) {
      if (remoteIds.has(item.id)) continue
      apiDelete(`/api/travel/notes/${item.id}`).catch(() => {})
    }
  } catch { /* ignore */ }
}

// ─── General settings sync ────────────────────────────────────────────────────

interface GeneralSettings {
  locale?: string
  currency?: string
  trashRetentionDays?: number
}

function applyGeneralSettings(s: GeneralSettings) {
  if (s.locale) {
    localStorage.setItem('muse-locale', s.locale)
    // i18n locale will be picked up on next load; for live update the UI layer handles it
  }
  if (s.currency) {
    localStorage.setItem('muse-currency', s.currency)
  }
  if (s.trashRetentionDays !== undefined) {
    localStorage.setItem('muse-trash-retention-days', String(s.trashRetentionDays))
  }
}

export function buildGeneralSettings(): GeneralSettings {
  return {
    locale:            localStorage.getItem('muse-locale') ?? 'zh-CN',
    currency:          localStorage.getItem('muse-currency') ?? 'cny',
    trashRetentionDays: parseInt(localStorage.getItem('muse-trash-retention-days') ?? '30') || 30,
  }
}

function buildProfileSettings() {
  return { avatar: localStorage.getItem('muse-user-avatar') }
}

function buildChatUiSettings() {
  try {
    return { variantLayout: JSON.parse(localStorage.getItem('muse-variant-layout') ?? '{}') as Record<string, 'tab' | 'horizontal'> }
  } catch {
    return { variantLayout: {} as Record<string, 'tab' | 'horizontal'> }
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function syncAllFromServer(): Promise<void> {
  if (!isBackendConfigured()) {
    setSyncState('not_configured')
    return
  }
  let firstErr: unknown = undefined
  beginSyncOp()
  try {
    // 1. Pull all settings in one request
    setSyncModule('设置')
    const allSettings = await apiGet<Record<string, unknown>>('/api/settings')
    const [aiStore, chatSettingsStore, webSearchStore, homeStore, privateAssistantSettings, travelCopilotStore, paperCopilotStore] = await Promise.all([
      getAiStore(),
      getChatSettingsStore(),
      getWebSearchStore(),
      getHomeStore(),
      getPrivateAssistantSettingsStore(),
      getTravelCopilotStore(),
      getPaperCopilotStore(),
    ])
    if (allSettings && (allSettings.ai || allSettings.chat || allSettings.webSearch || allSettings.home || allSettings.general || allSettings.privateAssistant || allSettings.travelCopilot || allSettings.paperCopilot || allSettings.profile || allSettings.chatUi)) {
      // Backend has settings → apply them
      await aiStore.syncFromServer(allSettings)
      await chatSettingsStore.syncFromServer(allSettings)
      await webSearchStore.syncFromServer(allSettings)
      await homeStore.syncFromServer(allSettings)
      await privateAssistantSettings.syncFromServer(allSettings)
      await travelCopilotStore.syncFromServer(allSettings)
      await paperCopilotStore.syncFromServer(allSettings)
      if (allSettings.general) {
        applyGeneralSettings(allSettings.general as GeneralSettings)
      }
      if (allSettings.profile) {
        const avatar = (allSettings.profile as { avatar?: unknown }).avatar
        if (typeof avatar === 'string') localStorage.setItem('muse-user-avatar', avatar)
        else if (avatar === null) localStorage.removeItem('muse-user-avatar')
      }
      if (allSettings.chatUi && typeof (allSettings.chatUi as { variantLayout?: unknown }).variantLayout === 'object') {
        localStorage.setItem('muse-variant-layout', JSON.stringify((allSettings.chatUi as { variantLayout: unknown }).variantLayout))
      }
    } else if (allSettings) {
      // Backend returned {} (first time) → push all local settings to backend
      aiStore.pushToServer().catch(() => {})
      chatSettingsStore.pushToServer().catch(() => {})
      webSearchStore.pushToServer().catch(() => {})
      homeStore.pushToServer()
      privateAssistantSettings.pushToServer().catch(() => {})
      travelCopilotStore.pushToServer().catch(() => {})
      paperCopilotStore.pushToServer().catch(() => {})
      pushGeneralSettings().catch(() => {})
      pushProfileSettings().catch(() => {})
      pushChatUiSettings().catch(() => {})
      // Push ebook library (settings, books, progress, etc.) since it uses its own endpoint
      useEbookStore().pushToServer().catch(() => {})
    }
  } catch (err) {
    console.error('[Sync] Settings sync failed:', err)
    firstErr ??= err
  }

  // 2. Sync assistants
  try {
    setSyncModule('助手')
    const assistantsStore = await getAssistantsStore()
    await assistantsStore.syncFromServer()
  } catch (err) {
    console.error('[Sync] Assistants sync failed:', err)
    firstErr ??= err
  }

  try {
    setSyncModule('私人助手')
    const privateAssistantStore = await getPrivateAssistantStore()
    await privateAssistantStore.syncFromServer()
  } catch (err) {
    console.error('[Sync] Private assistants sync failed:', err)
    firstErr ??= err
  }

  // 3+4+5+6. Chat list + travel notes + todo + ebook (parallel)
  setSyncModule('对话 / 旅行 / Todo / 图书')
  const todoStore = await getTodoStore()
  const ebookStore = useEbookStore()
  const parallelResults = await Promise.allSettled([
    syncChatList().then(async () => {
      // After updating local index.json, tell the chat store to reload its in-memory list
      // so the UI immediately shows synced titles and conversation order.
      try {
        const { useChatStore } = await import('../stores/chat')
        useChatStore().loadList()
      } catch { /* non-critical */ }
    }),
    syncTravelList(),
    todoStore.load(),
    ebookStore.syncFromServer(),
  ])
  for (const result of parallelResults) {
    if (result.status === 'rejected') {
      console.error('[Sync] Parallel sync task failed:', result.reason)
      firstErr ??= result.reason
    }
  }

  if (firstErr) {
    failSyncOp(firstErr)
  } else {
    endSyncOp()
  }
}

/**
 * Push general settings (locale, currency, trashRetentionDays) to the server.
 * Call this from GeneralSettings.vue whenever any of these values change.
 */
export async function pushGeneralSettings(): Promise<void> {
  await apiPut('/api/settings/general', { value: buildGeneralSettings() }).catch(() => {})
}

export async function pushProfileSettings(): Promise<void> {
  await apiPut('/api/settings/profile', { value: buildProfileSettings() }).catch(() => {})
}

export async function pushChatUiSettings(): Promise<void> {
  await apiPut('/api/settings/chatUi', { value: buildChatUiSettings() }).catch(() => {})
}
