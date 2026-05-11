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
import { setSyncState, beginSyncOp, endSyncOp, failSyncOp, setSyncModule, setSyncAction, addSyncAction, removeSyncAction } from '../stores/syncStatus'
import {
  fetchConvListFromServer,
  fetchConvFromServer,
  mergeConversationsByContent,
  migrateConvsToServer,
  pushConvToServer,
  restoreConvOnServer,
  trashConvOnServer,
} from './chatSync'
import { syncAllToolHistories, pushAllToolHistories } from './toolsSync'
import { syncRemoveBgModels } from '../modules/tools/Media/RemoveBg/modelSync'
import {
  readTextFile, writeTextFile, exists, mkdir, remove,
} from '@tauri-apps/plugin-fs'
import { conversationsDir, travelNotesDir } from '../utils/path'
import type { ConversationMeta, Conversation } from '../utils/storage'
import {
  saveConversationLocalOnly,
  mergeConversation,
  trashConversation,
  listTrashedConversations,
  restoreConversationFromTrash,
} from '../utils/storage'
import type { TravelNote, TravelTrashMeta } from '../utils/travelStorage'
import {
  saveTravelNote, listTravelNotes, loadTravelNote,
  listTrashItems, moveNoteToTrash, restoreNoteFromTrash,
  cacheTravelImagesForContent,
  noteFingerprint, extractTravelImageFilenames,
} from '../utils/travelStorage'
import { useEbookStore } from '../stores/ebook'
import { useTodoStore } from '../stores/todo'

// ─── Lazy store accessors (avoid circular init) ──────────────────────────────

function getTodoStore() {
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
async function getStatisticsStore() {
  const { useStatisticsStore } = await import('../stores/statistics')
  return useStatisticsStore()
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
  addSyncAction('正在从服务器拉取远程对话列表与元数据…')
  const remote = await fetchConvListFromServer(true)
  removeSyncAction('正在从服务器拉取远程对话列表与元数据…')
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

  const DEFAULT_TITLE = '新对话'

  // ── Title-based deduplication merge ──────────────────────────────────────────
  addSyncAction('正在按标题去重并合并本地与远程对话内容…')
  const titleGroups = new Map<string, { local: ConversationMeta[]; remote: typeof activeRemote }>()
  for (const meta of localIndex) {
    if (meta.title === DEFAULT_TITLE) continue
    const g = titleGroups.get(meta.title) ?? { local: [], remote: [] }
    g.local.push(meta)
    titleGroups.set(meta.title, g)
  }
  for (const rm of activeRemote) {
    if (rm.title === DEFAULT_TITLE) continue
    const g = titleGroups.get(rm.title) ?? { local: [], remote: [] }
    g.remote.push(rm)
    titleGroups.set(rm.title, g)
  }

  let changed = false
  const dedupedRemoteIds = new Set<string>()

  for (const [title, group] of titleGroups) {
    if (group.local.length + group.remote.length < 2) continue

    const [localResults, remoteResults] = await Promise.all([
      Promise.all(group.local.map(meta => readJsonFile<Conversation>(`${dir}/${meta.id}.json`))),
      Promise.all(group.remote.map(rm => fetchConvFromServer(rm.id))),
    ])
    const localConvs = localResults.filter((c): c is Conversation => !!c)
    const remoteConvs = remoteResults.filter((c): c is Conversation => !!c)

    const mergedList = mergeConversationsByContent(localConvs, remoteConvs)
    const merged = mergedList.find(c => c.title === title)
    if (!merged) continue

    const canonicalId = merged.id

    for (const meta of group.local) {
      if (meta.id === canonicalId) continue
      try {
        const p = `${dir}/${meta.id}.json`
        if (await exists(p)) await remove(p)
      } catch { /* ignore */ }
    }

    for (const rm of group.remote) {
      if (rm.id === canonicalId) continue
      const now = new Date().toISOString()
      trashConvOnServer(rm.id, now, buildTrashExpiry(now)).catch(() => {})
      dedupedRemoteIds.add(rm.id)
    }

    localIndex = localIndex.filter(m => {
      if (m.title !== title) return true
      return m.id === canonicalId
    })
    const idx = localIndex.findIndex(m => m.id === canonicalId)
    if (idx >= 0) {
      localIndex[idx] = { ...localIndex[idx], updatedAt: merged.updatedAt }
    } else {
      localIndex.unshift({
        id: canonicalId,
        title: merged.title,
        createdAt: merged.createdAt,
        updatedAt: merged.updatedAt,
        preview: '',
        model: merged.model,
        providerId: merged.providerId,
        pinned: merged.pinned,
        assistantId: merged.assistantId,
      })
    }

    await atomicWrite(`${dir}/${canonicalId}.json`, JSON.stringify(merged, null, 2))
    pushConvToServer(merged).catch(() => {})
    changed = true
  }

  removeSyncAction('正在按标题去重并合并本地与远程对话内容…')
  if (changed) await atomicWrite(indexPath, JSON.stringify(localIndex, null, 2))

  addSyncAction('正在将本地独有对话及消息历史上传到服务器…')
  const remainingRemote = activeRemote.filter(rm => !dedupedRemoteIds.has(rm.id))

  // Add missing remote entries, and reconcile newer records for existing entries.
  for (const rm of remainingRemote) {
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
    const localConvs = (await Promise.all(
      localOnly.map(meta => readJsonFile<Conversation>(`${dir}/${meta.id}.json`))
    )).filter((c): c is Conversation => !!c)
    if (activeRemote.length === 0) {
      migrateConvsToServer(localConvs).catch(() => {})
    } else {
      for (const conv of localConvs) pushConvToServer(conv).catch(() => {})
    }
  }
  removeSyncAction('正在将本地独有对话及消息历史上传到服务器…')
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
    createdAt: pickRemote<string | undefined>(full, 'createdAt', 'created_at', undefined),
  }
}

async function syncTravelList() {
  try {
    addSyncAction('正在从服务器拉取远程旅行笔记列表与完整内容…')
    const remoteRaw = await apiGet<Array<Record<string, unknown>>>('/api/travel/notes?include_deleted=true')
    removeSyncAction('正在从服务器拉取远程旅行笔记列表与完整内容…')
    if (!remoteRaw) return

    const remoteAll = remoteRaw.map(normalizeRemoteTravelMeta).filter(r => r.id)
    const remoteIds = new Set(remoteAll.map(r => r.id))
    const activeRemote = remoteAll.filter(r => !r.deletedAt)
    const deletedRemote = remoteAll.filter(r => r.deletedAt)

    // Load full local notes with content in parallel
    const localMetas = await listTravelNotes()
    const localNotes = (await Promise.all(
      localMetas.map(meta => loadTravelNote(meta.id))
    )).filter((n): n is TravelNote => !!n)
    const localTrash = await listTrashItems()
    const localTrashMap = new Map<string, TravelTrashMeta>(localTrash.map(n => [n.id, n]))

    // Remote trash → local trash, unless the local active note is newer.
    for (const rm of deletedRemote) {
      try {
        const local = localNotes.find(n => n.id === rm.id)
        if (!local) continue
        if (!rm.deletedAt || local.updatedAt! > rm.deletedAt) {
          await apiPost(`/api/travel/notes/${rm.id}/restore`, {}).catch(() => {})
          await saveTravelNote(local, { preserveUpdatedAt: true })
        } else {
          await moveNoteToTrash(rm.id, { sync: false, deletedAt: rm.deletedAt })
        }
      } catch { /* skip this note, continue with others */ }
    }

    // Refresh local notes after possible trash operations
    const currentLocalNotes = (await Promise.all(
      (await listTravelNotes()).map(meta => loadTravelNote(meta.id))
    )).filter((n): n is TravelNote => !!n)

    // Fetch full content for all active remote notes in parallel
    const remoteNotes = (await Promise.all(
      activeRemote.map(rm => fetchFullTravelNote(rm.id))
    )).filter((n): n is TravelNote => !!n)

    // ── Content-based deduplication merge ──────────────────────────────────────
    addSyncAction('正在按内容指纹去重并合并本地与远程旅行笔记…')
    const groups = new Map<string, { local: TravelNote[]; remote: TravelNote[] }>()
    for (const note of currentLocalNotes) {
      const fp = noteFingerprint(note)
      const g = groups.get(fp) ?? { local: [], remote: [] }
      g.local.push(note)
      groups.set(fp, g)
    }
    for (const note of remoteNotes) {
      const fp = noteFingerprint(note)
      const g = groups.get(fp) ?? { local: [], remote: [] }
      g.remote.push(note)
      groups.set(fp, g)
    }

    for (const [, group] of groups) {
      const hasLocal = group.local.length > 0
      const hasRemote = group.remote.length > 0

      if (hasLocal && hasRemote) {
        // Same fingerprint → merge into canonical note
        const allNotes = [...group.local, ...group.remote]
        const canonicalId = allNotes.map(n => n.id).sort()[0]
        const canonicalNote = allNotes.find(n => n.id === canonicalId)!
        const mergedNote: TravelNote = { ...canonicalNote }

        // updatedAt → latest
        const updatedAts = allNotes.map(n => n.updatedAt).filter((v): v is string => !!v)
        if (updatedAts.length) {
          mergedNote.updatedAt = updatedAts.sort()[updatedAts.length - 1]
        }

        // createdAt → earliest
        const createdAts = allNotes.map(n => n.createdAt).filter((v): v is string => !!v)
        if (createdAts.length) {
          mergedNote.createdAt = createdAts.sort()[0]
        }

        // Images: union of referenced image filenames
        const allImages = new Set<string>()
        for (const n of allNotes) {
          for (const img of extractTravelImageFilenames(n.content)) {
            allImages.add(img)
          }
        }
        const canonicalImages = new Set(extractTravelImageFilenames(mergedNote.content))
        let mergedContent = mergedNote.content
        for (const img of allImages) {
          if (!canonicalImages.has(img)) {
            mergedContent += `\n\n![image](images/${img})`
          }
        }
        mergedNote.content = mergedContent

        // Save canonical note locally and push to server only if something actually changed
        const canonicalContent = canonicalNote.content
        const contentChanged = mergedNote.content !== canonicalContent || mergedNote.updatedAt !== canonicalNote.updatedAt
        if (contentChanged) {
          await saveTravelNote(mergedNote, { preserveUpdatedAt: true })
        }
        cacheTravelImagesForContent(mergedNote.content).catch(() => {})

        // Delete duplicate local files
        for (const n of group.local) {
          if (n.id === canonicalId) continue
          try {
            const dir = await travelNotesDir()
            const path = `${dir}/${n.id}.md`
            if (await exists(path)) await remove(path)
          } catch { /* ignore */ }
        }

        // Delete duplicate remote notes on server
        for (const n of group.remote) {
          if (n.id === canonicalId) continue
          apiDelete(`/api/travel/notes/${n.id}`).catch(() => {})
        }
      } else if (hasLocal && !hasRemote) {
        // Fingerprint only in local → push to server
        for (const note of group.local) {
          await saveTravelNote(note, { preserveUpdatedAt: true })
        }
      } else if (!hasLocal && hasRemote) {
        // Fingerprint only in remote → add to local
        for (const note of group.remote) {
          try {
            const trashedLocal = localTrashMap.get(note.id)
            if (trashedLocal) {
              if (trashedLocal.deletedAt >= note.updatedAt!) {
                apiDelete(`/api/travel/notes/${note.id}`).catch(() => {})
                continue
              }
              await restoreNoteFromTrash(note.id, { sync: false }).catch(() => {})
            }
            await saveTravelNote(note, { sync: false, preserveUpdatedAt: true })
            cacheTravelImagesForContent(note.content).catch(() => {})
          } catch { /* skip this note */ }
        }
      }
    }

    removeSyncAction('正在按内容指纹去重并合并本地与远程旅行笔记…')
    // Local trash absent remotely → keep server tombstone if possible.
    const currentLocalTrash = await listTrashItems()
    for (const item of currentLocalTrash) {
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
    setSyncAction('正在同步设置…')
    const allSettings = await apiGet<Record<string, unknown>>('/api/settings')
    const [aiStore, chatSettingsStore, webSearchStore, homeStore, privateAssistantSettings, travelCopilotStore, paperCopilotStore, statisticsStore] = await Promise.all([
      getAiStore(),
      getChatSettingsStore(),
      getWebSearchStore(),
      getHomeStore(),
      getPrivateAssistantSettingsStore(),
      getTravelCopilotStore(),
      getPaperCopilotStore(),
      getStatisticsStore(),
    ])
    const ebookStore = useEbookStore()
    if (allSettings && (allSettings.ai || allSettings.chat || allSettings.webSearch || allSettings.home || allSettings.general || allSettings.privateAssistant || allSettings.travelCopilot || allSettings.paperCopilot || allSettings.profile || allSettings.chatUi || allSettings.statistics || allSettings.ebookTts)) {
      // Backend has settings → apply them
      setSyncAction('正在同步 AI 提供商与模型配置（含 API 密钥加密）…')
      await aiStore.syncFromServer(allSettings)
      setSyncAction('正在同步聊天界面与标题生成模型配置…')
      await chatSettingsStore.syncFromServer(allSettings)
      setSyncAction('正在同步网络搜索提供商与模型配置…')
      await webSearchStore.syncFromServer(allSettings)
      setSyncAction('正在同步主页快捷入口与海报配置…')
      await homeStore.syncFromServer(allSettings)
      setSyncAction('正在同步私人助手的默认模型与参数配置…')
      await privateAssistantSettings.syncFromServer(allSettings)
      setSyncAction('正在同步旅行助手的默认模型与开关状态…')
      await travelCopilotStore.syncFromServer(allSettings)
      setSyncAction('正在同步论文助手的默认模型与开关状态…')
      await paperCopilotStore.syncFromServer(allSettings)
      setSyncAction('正在同步统计数据与货币单位设置…')
      await statisticsStore.syncFromServer(allSettings)
      if (allSettings.general) {
        setSyncAction('正在同步通用设置（界面语言 / 货币单位 / 回收站保留天数）…')
        applyGeneralSettings(allSettings.general as GeneralSettings)
      }
      if (allSettings.profile) {
        setSyncAction('正在同步用户个人资料（头像）…')
        const avatar = (allSettings.profile as { avatar?: unknown }).avatar
        if (typeof avatar === 'string') localStorage.setItem('muse-user-avatar', avatar)
        else if (avatar === null) localStorage.removeItem('muse-user-avatar')
      }
      if (allSettings.chatUi && typeof (allSettings.chatUi as { variantLayout?: unknown }).variantLayout === 'object') {
        setSyncAction('正在同步聊天变体布局设置（标签页 / 横向）…')
        localStorage.setItem('muse-variant-layout', JSON.stringify((allSettings.chatUi as { variantLayout: unknown }).variantLayout))
      }
      // Sync ebook TTS settings independently
      setSyncAction('正在同步电子书朗读设置（TTS 提供商 / 音色 / 语速 / 模型）…')
      await ebookStore.syncTtsSettingsFromServer()
    } else if (allSettings) {
      // Backend returned {} (first time) → push all local settings to backend
      setSyncAction('首次同步：正在推送 AI 提供商与模型配置（含 API 密钥加密）…')
      aiStore.pushToServer().catch(() => {})
      setSyncAction('首次同步：正在推送聊天界面与标题生成模型配置…')
      chatSettingsStore.pushToServer().catch(() => {})
      setSyncAction('首次同步：正在推送网络搜索提供商与模型配置…')
      webSearchStore.pushToServer().catch(() => {})
      setSyncAction('首次同步：正在推送主页快捷入口与海报配置…')
      homeStore.pushToServer()
      setSyncAction('首次同步：正在推送私人助手默认模型与参数配置…')
      privateAssistantSettings.pushToServer().catch(() => {})
      setSyncAction('首次同步：正在推送旅行助手默认模型与开关状态…')
      travelCopilotStore.pushToServer().catch(() => {})
      setSyncAction('首次同步：正在推送论文助手默认模型与开关状态…')
      paperCopilotStore.pushToServer().catch(() => {})
      setSyncAction('首次同步：正在推送统计数据与货币单位设置…')
      statisticsStore.pushToServer().catch(() => {})
      pushGeneralSettings().catch(() => {})
      pushProfileSettings().catch(() => {})
      pushChatUiSettings().catch(() => {})
      // Push ebook library (settings, books, progress, etc.) since it uses its own endpoint
      ebookStore.pushToServer().catch(() => {})
      ebookStore.pushTtsSettingsToServer().catch(() => {})
      // Push tool histories (first-time migration)
      pushAllToolHistories().catch(() => {})
    }
  } catch (err) {
    console.error('[Sync] Settings sync failed:', err)
    firstErr ??= err
  }

  // 2. Sync assistants
  try {
    setSyncModule('助手')
    setSyncAction('正在同步助手列表、系统提示词与参数配置…')
    const assistantsStore = await getAssistantsStore()
    await assistantsStore.syncFromServer()
  } catch (err) {
    console.error('[Sync] Assistants sync failed:', err)
    firstErr ??= err
  }

  try {
    setSyncModule('私人助手')
    setSyncAction('正在同步私人助手对话记录与消息历史…')
    const privateAssistantStore = await getPrivateAssistantStore()
    await privateAssistantStore.syncFromServer()
  } catch (err) {
    console.error('[Sync] Private assistants sync failed:', err)
    firstErr ??= err
  }

  // 3+4+5+6+7. Chat list + travel notes + todo + ebook + tools (parallel)
  setSyncModule(null)
  setSyncAction(null)
  addSyncAction('正在同步对话列表、消息内容与阅读进度…')
  addSyncAction('正在同步旅行笔记、地图标记、图片与分类标签…')
  addSyncAction('正在同步待办事项列表、分类与完成状态…')
  addSyncAction('正在同步书库、阅读进度、批注与收藏分类…')
  addSyncAction('正在同步各工具的使用历史记录…')
  addSyncAction('正在同步 RemoveBg AI 模型权重文件…')
  const todoStore = getTodoStore()
  const ebookStore = useEbookStore()
  const parallelResults = await Promise.allSettled([
    syncChatList().then(async () => {
      removeSyncAction('正在同步对话列表、消息内容与阅读进度…')
      // After updating local index.json, tell the chat store to reload its in-memory list
      // so the UI immediately shows synced titles and conversation order.
      try {
        const { useChatStore } = await import('../stores/chat')
        useChatStore().loadList()
      } catch { /* non-critical */ }
    }).catch((err) => { removeSyncAction('正在同步对话列表、消息内容与阅读进度…'); throw err }),
    syncTravelList().then(() => removeSyncAction('正在同步旅行笔记、地图标记、图片与分类标签…')).catch((err) => { removeSyncAction('正在同步旅行笔记、地图标记、图片与分类标签…'); throw err }),
    todoStore.load().then(() => removeSyncAction('正在同步待办事项列表、分类与完成状态…')).catch((err) => { removeSyncAction('正在同步待办事项列表、分类与完成状态…'); throw err }),
    ebookStore.syncFromServer().then(() => removeSyncAction('正在同步书库、阅读进度、批注与收藏分类…')).catch((err) => { removeSyncAction('正在同步书库、阅读进度、批注与收藏分类…'); throw err }),
    syncAllToolHistories().then(() => removeSyncAction('正在同步各工具的使用历史记录…')).catch((err) => { removeSyncAction('正在同步各工具的使用历史记录…'); throw err }),
    syncRemoveBgModels().then(() => removeSyncAction('正在同步 RemoveBg AI 模型权重文件…')).catch((err) => { removeSyncAction('正在同步 RemoveBg AI 模型权重文件…'); throw err }),
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
