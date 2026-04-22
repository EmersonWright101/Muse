/**
 * WebDAV Sync Store  (v2)
 *
 * Remote layout:
 *   {base}/
 *     manifest.enc                   ← per-module change-detection timestamps
 *     settings/
 *       ai_settings.enc
 *     assistants/
 *       list.enc
 *     conversations/
 *       index.enc
 *       {id}.enc
 *
 * Manifest schema:
 *   { version: 2, modules: { [moduleId]: ISO } }
 *
 * ── Merge strategy ──────────────────────────────────────────────────────────
 *   aiSettings   : per-provider union, newer updatedAt wins; activeProviderId last-write-wins
 *   assistants   : per-item union, newer updatedAt (fallback createdAt) wins
 *   conversations: per-message union by ID (newer timestamp wins);
 *                  conversation metadata → newer updatedAt wins
 *
 * ── Change detection (per module) ────────────────────────────────────────────
 *   Before syncing, manifest.enc is fetched (single lightweight request).
 *   For each module:
 *     localChanged  = localModuleTs(mod) > record.syncedAt
 *     remoteChanged = manifest.modules[mod] > record.remoteTs[mod]
 *   Module is skipped when !localChanged && !remoteChanged.
 *   All modules up-to-date → status = 'uptodate', zero data transferred.
 *
 * ── Local module timestamps ────────────────────────────────────────────────
 *   aiSettings    : LS_MODIFIED_AT_KEY   (written by aiSettings store)
 *   assistants    : 'muse-ts-assistants'  (written by storage.saveAssistant / deleteAssistant)
 *   conversations : 'muse-ts-conversations' (written by storage.saveConversation / deleteConversation)
 *
 * ── Incremental sync ─────────────────────────────────────────────────────────
 *   - Per-module: entire module skipped when neither side changed (manifest-based).
 *   - Conversations: each conversation is its own .enc file; only changed ones are
 *     transferred. Index is only re-uploaded when local state actually changed.
 *   - ensureRemoteDirs: MKCOL calls are skipped after the first successful sync
 *     this session (session flag _dirsVerified).
 *   - Tombstones: remote .enc files are only deleted for NEW tombstones (not
 *     previously seen ones), avoiding redundant DELETE requests every sync.
 */

import { reactive, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  listConversations, loadConversation, saveConversation, deleteConversation,
  listAssistants, saveAssistant, deleteAssistant,
  getDeletedAssistants, applyRemoteDeletedAssistants,
  getDeletedConversations, applyRemoteDeletedConversations,
  type ConversationMeta, type Conversation, type ChatMessage, type Assistant,
  type MessageVariant,
} from '../utils/storage'
import { encryptData, decryptData }    from '../utils/crypto'
import { webdavGet, webdavPut, webdavMkcol, webdavPing, webdavDelete } from '../utils/webdav'
import {
  useAiSettingsStore, LS_MODIFIED_AT_KEY, DEBOUNCE_MS,
  getDeletedProviders, applyRemoteDeletedProviders,
  type AIProvider,
} from './aiSettings'
import { useAssistantsStore } from './assistants'
import { useChatStore } from './chat'
import { LS_MODIFIED_AT_KEY as LS_CHAT_SETTINGS_MODIFIED_AT_KEY } from './chatSettings'
import {
  listTravelNotes, loadTravelNote, saveTravelNote, deleteTravelNote,
  getDeletedTravelNotes, applyRemoteDeletedTravelNotes,
  type TravelNote, type TravelNoteMeta,
} from '../utils/travelStorage'

const SYNC_CONFIG_LS_KEY = 'muse-webdav-sync-config'
const SYNC_RECORD_LS_KEY = 'muse-sync-record'

// ─── Module registry ─────────────────────────────────────────────────────────
// Add new modules here when you add new app modules.

const MOD_AI        = 'aiSettings'    as const
const MOD_AST       = 'assistants'    as const
const MOD_CONV      = 'conversations' as const
const MOD_CHAT_SET  = 'chatSettings'  as const
const MOD_TRAVEL    = 'travelNotes'   as const
const ALL_MODS = [MOD_AI, MOD_AST, MOD_CONV, MOD_CHAT_SET, MOD_TRAVEL] as const
type ModuleId  = typeof ALL_MODS[number]

// ─── Config ──────────────────────────────────────────────────────────────────

export interface SyncConfig {
  enabled:                 boolean;
  serverUrl:               string;
  username:                string;
  password:                string;
  remotePath:              string;
  autoSyncIntervalMinutes: number;
}

export type SyncState = 'idle' | 'syncing' | 'success' | 'error' | 'uptodate';

export interface SyncStatus {
  state:      SyncState;
  lastSyncAt: string | null;
  lastError:  string | null;
  progress:   string;
}

const DEFAULT_CONFIG: SyncConfig = {
  enabled:                 false,
  serverUrl:               'https://dav.jianguoyun.com/dav/',
  username:                '',
  password:                '',
  remotePath:              'MuseApp',
  autoSyncIntervalMinutes: 0,
}

function loadConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_LS_KEY)
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG }
}

// ─── Manifest & local sync record ────────────────────────────────────────────

interface SyncManifest {
  version: 2;
  modules: Partial<Record<ModuleId, string>>; // moduleId → ISO updatedAt on remote
}

interface LocalSyncRecord {
  syncedAt:  string;                            // when we last completed a full sync
  remoteTs:  Partial<Record<ModuleId, string>>; // remote manifest state at last sync
}

function loadSyncRecord(): LocalSyncRecord {
  try {
    const raw = localStorage.getItem(SYNC_RECORD_LS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { syncedAt: new Date(0).toISOString(), remoteTs: {} }
}

function saveSyncRecord(r: LocalSyncRecord) {
  localStorage.setItem(SYNC_RECORD_LS_KEY, JSON.stringify(r))
}

/** Last time the given module's data was written locally. */
function localModuleTs(mod: ModuleId): string {
  if (mod === MOD_AI)       return localStorage.getItem(LS_MODIFIED_AT_KEY) ?? new Date(0).toISOString()
  if (mod === MOD_CHAT_SET) return localStorage.getItem(LS_CHAT_SETTINGS_MODIFIED_AT_KEY) ?? new Date(0).toISOString()
  return localStorage.getItem(`muse-ts-${mod}`) ?? new Date(0).toISOString()
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

type RemoteProvider = {
  id: string; name?: string; type?: AIProvider['type']; builtIn?: boolean;
  apiKey?: string; baseUrl?: string; enabled?: boolean;
  selectedModelId?: string; customModels?: AIProvider['models']; updatedAt?: string;
}

function mergeVariants(
  local?: MessageVariant[], remote?: MessageVariant[],
): MessageVariant[] | undefined {
  if (!local?.length && !remote?.length) return undefined
  if (!remote?.length) return local
  if (!local?.length)  return remote
  const map = new Map<string, MessageVariant>()
  for (const v of local)  map.set(v.id, v)
  for (const v of remote) { if (!map.has(v.id)) map.set(v.id, v) }
  return [...map.values()]
}

function mergeMessages(local: ChatMessage[], remote: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>()
  for (const msg of local) map.set(msg.id, msg)
  for (const msg of remote) {
    const existing = map.get(msg.id)
    if (!existing) {
      map.set(msg.id, msg)
    } else {
      // Timestamp decides the winner; always union-merge variants from both sides
      const base     = msg.timestamp > existing.timestamp ? msg : existing
      const variants = mergeVariants(existing.variants, msg.variants)
      map.set(msg.id, variants ? { ...base, variants } : base)
    }
  }
  return [...map.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

function mergeConversation(
  local: Conversation, remote: Conversation,
): { merged: Conversation; localChanged: boolean; remoteChanged: boolean } {
  const messages      = mergeMessages(local.messages, remote.messages)
  const newerIsRemote = remote.updatedAt > local.updatedAt
  const base          = newerIsRemote ? remote : local
  const merged: Conversation = { ...base, messages }

  const localChanged  = messages.length !== local.messages.length
    || merged.updatedAt !== local.updatedAt
    || merged.title    !== local.title
  const remoteChanged = messages.length !== remote.messages.length
    || merged.updatedAt !== remote.updatedAt
    || merged.title    !== remote.title

  return { merged, localChanged, remoteChanged }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSyncStore = defineStore('sync', () => {
  const config = reactive<SyncConfig>(loadConfig())
  const status = reactive<SyncStatus>({
    state:      'idle',
    lastSyncAt: localStorage.getItem('muse-webdav-last-at'),
    lastError:  null,
    progress:   '',
  })

  let _syncInProgress = false
  let _autoSyncTimer: ReturnType<typeof setInterval> | null = null
  // Skip MKCOL calls after first successful directory creation this session
  let _dirsVerified = false

  watch(() => ({ ...config }), v => localStorage.setItem(SYNC_CONFIG_LS_KEY, JSON.stringify(v)))

  // ─── Low-level helpers ───────────────────────────────────────────────────

  function dav() {
    return { serverUrl: config.serverUrl, username: config.username, password: config.password }
  }

  function rp(filename: string): string {
    const base = config.remotePath.replace(/^\/+|\/+$/g, '')
    return `/${base}/${filename}`
  }

  async function ensureRemoteDirs() {
    if (_dirsVerified) return
    const base = config.remotePath.replace(/^\/+|\/+$/g, '')
    await webdavMkcol(dav(), `/${base}/`)
    await webdavMkcol(dav(), `/${base}/settings/`)
    await webdavMkcol(dav(), `/${base}/assistants/`)
    await webdavMkcol(dav(), `/${base}/conversations/`)
    await webdavMkcol(dav(), `/${base}/travel/`)
    _dirsVerified = true
  }

  async function getEncrypted<T>(path: string, fallback: T): Promise<T> {
    const resp = await webdavGet(dav(), path)
    if (!resp.ok) return fallback
    try {
      return JSON.parse(await decryptData(resp.body, config.password)) as T
    } catch {
      return fallback
    }
  }

  async function putEncrypted(path: string, data: unknown) {
    const body = await encryptData(JSON.stringify(data), config.password)
    const res  = await webdavPut(dav(), path, body)
    if (!res.ok) throw new Error(`上传失败 ${path}：HTTP ${res.status}`)
  }

  // ─── Manifest ────────────────────────────────────────────────────────────

  async function fetchManifest(): Promise<SyncManifest> {
    const fallback: SyncManifest = { version: 2, modules: {} }
    const resp = await webdavGet(dav(), rp('manifest.enc'))
    if (!resp.ok) return fallback
    try {
      const parsed = JSON.parse(await decryptData(resp.body, config.password))
      if (parsed && typeof parsed.modules === 'object' && parsed.modules !== null) {
        return parsed as SyncManifest
      }
    } catch { /* ignore */ }
    return fallback
  }

  async function pushManifest(modules: Partial<Record<ModuleId, string>>) {
    await putEncrypted(rp('manifest.enc'), { version: 2, modules } as SyncManifest)
  }

  // ─── Module: AI Settings ─────────────────────────────────────────────────

  /**
   * @param localChanged  true when local data was modified since the last sync.
   *                      When false (pull-only), we skip the remote write to avoid
   *                      needlessly re-uploading data that the remote already has.
   */
  async function syncAiSettings(localChanged: boolean) {
    status.progress = '同步 AI 设置…'
    const aiStore   = useAiSettingsStore()
    const localTs   = localModuleTs(MOD_AI)

    function toRemote(p: AIProvider): RemoteProvider {
      return {
        id: p.id, name: p.name, type: p.type, builtIn: p.builtIn,
        apiKey: p.apiKey, baseUrl: p.baseUrl, enabled: p.enabled,
        selectedModelId: p.selectedModelId,
        customModels: p.type === 'custom' ? p.models : undefined,
        updatedAt: p.updatedAt ?? new Date(0).toISOString(),
      }
    }

    const localDeleted = getDeletedProviders()
    const localData = {
      timestamp: localTs,
      providers: aiStore.providers.map(toRemote),
      activeProviderId: aiStore.activeProviderId,
      deletedProviders: localDeleted,
    }

    const path = rp('settings/ai_settings.enc')
    const remoteData = await getEncrypted<typeof localData | null>(path, null)

    if (!remoteData) {
      // First ever sync — only upload if local has user-configured data.
      if (localChanged) await putEncrypted(path, localData)
      return
    }

    // Merge tombstones from both sides so all devices eventually know about deletions
    const remoteDeleted: Record<string, string> = remoteData.deletedProviders ?? {}
    applyRemoteDeletedProviders(remoteDeleted)
    const mergedDeleted = getDeletedProviders()

    // A provider is considered deleted if any tombstone is newer than its updatedAt
    function isDeleted(p: RemoteProvider): boolean {
      const ts = mergedDeleted[p.id]
      return !!ts && ts > (p.updatedAt ?? new Date(0).toISOString())
    }

    const remoteMap = new Map<string, RemoteProvider>(
      (remoteData.providers ?? []).filter((p: RemoteProvider) => !isDeleted(p)).map((p: RemoteProvider) => [p.id, p]),
    )
    const localMap = new Map<string, RemoteProvider>(localData.providers.map(p => [p.id, p]))

    // Apply remote-newer providers to local store (skip tombstoned ones)
    for (const [id, rp_] of remoteMap) {
      const lp = localMap.get(id)
      if (!lp || (rp_.updatedAt ?? '') > (lp.updatedAt ?? '')) aiStore.importProvider(rp_)
    }

    // Remove locally any provider that has a valid tombstone
    for (const [id, ts] of Object.entries(mergedDeleted)) {
      const p = aiStore.providers.find(p => p.id === id)
      if (p && ts > (p.updatedAt ?? new Date(0).toISOString())) aiStore.removeProvider(id)
    }

    // activeProviderId: overall last-write-wins
    if ((remoteData.timestamp ?? '') > localTs && remoteData.activeProviderId) {
      aiStore.setActiveProvider(remoteData.activeProviderId)
    }

    // Only push to remote if local had changes worth uploading
    if (!localChanged) return

    // Build merged provider list — exclude tombstoned providers
    const mergedProviders = aiStore.providers.map(toRemote)
    for (const [id, rp_] of remoteMap) {
      if (!localMap.has(id) && !mergedProviders.find(p => p.id === id)) {
        mergedProviders.push(rp_)
      }
    }

    await putEncrypted(path, {
      timestamp: new Date().toISOString(),
      providers: mergedProviders,
      activeProviderId: aiStore.activeProviderId,
      deletedProviders: mergedDeleted,
    })
  }

  // ─── Module: Assistants ──────────────────────────────────────────────────

  interface AssistantsPayload {
    list:             Assistant[];
    deletedAssistants: Record<string, string>;
  }

  /**
   * @param localChanged  when false, skips the remote write (pull-only sync).
   */
  async function syncAssistants(localChanged: boolean) {
    status.progress = '同步助手配置…'
    const localList = await listAssistants()
    const path      = rp('assistants/list.enc')

    // Support old format (bare array) and new format (payload object)
    const raw = await getEncrypted<AssistantsPayload | Assistant[]>(path, { list: [], deletedAssistants: {} })
    const remotePayload: AssistantsPayload = Array.isArray(raw)
      ? { list: raw, deletedAssistants: {} }
      : raw

    // Merge tombstones from both sides
    applyRemoteDeletedAssistants(remotePayload.deletedAssistants ?? {})
    const mergedDeleted = getDeletedAssistants()

    function isDeleted(a: Assistant): boolean {
      const ts = mergedDeleted[a.id]
      return !!ts && ts > (a.updatedAt ?? a.createdAt)
    }

    // Union merge live assistants; newer updatedAt (fallback createdAt) wins per item
    const merged = new Map<string, Assistant>()
    for (const a of localList)           if (!isDeleted(a)) merged.set(a.id, a)
    for (const a of remotePayload.list)  if (!isDeleted(a)) {
      const local = merged.get(a.id)
      if (!local || (a.updatedAt ?? a.createdAt) > (local.updatedAt ?? local.createdAt)) {
        merged.set(a.id, a)
      }
    }

    const mergedList = [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    // Apply changes to local storage
    for (const a of mergedList) {
      const local = localList.find(l => l.id === a.id)
      if (!local || (a.updatedAt ?? a.createdAt) > (local.updatedAt ?? local.createdAt)) {
        await saveAssistant(a)
      }
    }
    // Remove locally any assistant covered by a valid tombstone
    for (const local of localList) {
      if (isDeleted(local)) await deleteAssistant(local.id)
    }

    // Reload assistants store so the UI reflects synced data immediately
    await useAssistantsStore().load()

    // Only push to remote if local had changes
    if (!localChanged) return

    await putEncrypted(path, { list: mergedList, deletedAssistants: mergedDeleted } satisfies AssistantsPayload)
  }

  // ─── Module: Conversations ───────────────────────────────────────────────

  interface ConversationsPayload {
    list:               ConversationMeta[];
    deletedConversations: Record<string, string>;
  }

  /**
   * @param localChanged  when false, individual conversation files and the index
   *                      are only uploaded if they were merged with new remote data.
   */
  async function syncConversations(localChanged: boolean) {
    status.progress = '同步对话历史…'

    const localList = await listConversations()
    const idxPath   = rp('conversations/index.enc')

    // Support old format (bare array) and new format (payload object)
    const raw = await getEncrypted<ConversationsPayload | ConversationMeta[]>(idxPath, { list: [], deletedConversations: {} })
    const remotePayload: ConversationsPayload = Array.isArray(raw)
      ? { list: raw, deletedConversations: {} }
      : raw

    // Merge tombstones from both sides
    applyRemoteDeletedConversations(remotePayload.deletedConversations ?? {})
    const mergedDeleted = getDeletedConversations()

    function isDeleted(id: string, updatedAt: string): boolean {
      const ts = mergedDeleted[id]
      return !!ts && ts > updatedAt
    }

    const remoteList = remotePayload.list
    const localIds   = new Set(localList.map(c => c.id))
    const remoteIds  = new Set(remoteList.map(c => c.id))
    // Tombstones already recorded on remote — used to avoid redundant DELETE calls
    const remoteTombstones = new Set(Object.keys(remotePayload.deletedConversations ?? {}))

    // Track whether the remote index or .enc files were actually modified
    let indexChanged = false

    // ① Apply tombstones: delete locally + delete remote .enc file (NEW tombstones only)
    for (const meta of localList) {
      if (isDeleted(meta.id, meta.updatedAt)) await deleteConversation(meta.id)
    }
    for (const [id] of Object.entries(mergedDeleted)) {
      // Only send DELETE if this tombstone is new (not already on remote)
      if (!remoteTombstones.has(id)) {
        await webdavDelete(dav(), rp(`conversations/${id}.enc`))
        indexChanged = true
      }
    }

    // ② Download conversations that only exist on remote (and are not tombstoned)
    for (const meta of remoteList) {
      if (localIds.has(meta.id)) continue
      if (isDeleted(meta.id, meta.updatedAt)) continue
      const resp = await webdavGet(dav(), rp(`conversations/${meta.id}.enc`))
      if (!resp.ok) continue
      try {
        const conv = JSON.parse(await decryptData(resp.body, config.password)) as Conversation
        if (!isDeleted(conv.id, conv.updatedAt)) await saveConversation(conv)
      } catch { /* skip corrupt remote entry */ }
    }

    // ③ Upload conversations that only exist locally (and are not tombstoned)
    //    Only runs when local has changes to push.
    if (localChanged) {
      for (const meta of localList) {
        if (remoteIds.has(meta.id)) continue
        if (isDeleted(meta.id, meta.updatedAt)) continue
        const conv = await loadConversation(meta.id)
        if (!conv) continue
        await putEncrypted(rp(`conversations/${meta.id}.enc`), conv)
        indexChanged = true
      }
    }

    // ④ Merge conversations that exist on both sides but differ (skip tombstoned)
    for (const localMeta of localList) {
      if (isDeleted(localMeta.id, localMeta.updatedAt)) continue
      const remoteMeta = remoteList.find(r => r.id === localMeta.id)
      if (!remoteMeta || localMeta.updatedAt === remoteMeta.updatedAt) continue

      const localConv = await loadConversation(localMeta.id)
      if (!localConv) continue

      const convPath   = rp(`conversations/${localMeta.id}.enc`)
      const remoteResp = await webdavGet(dav(), convPath)

      if (!remoteResp.ok) {
        if (localChanged && localMeta.updatedAt > remoteMeta.updatedAt) {
          await putEncrypted(convPath, localConv)
          indexChanged = true
        }
        continue
      }

      try {
        const remoteConv = JSON.parse(
          await decryptData(remoteResp.body, config.password),
        ) as Conversation
        const { merged, localChanged: convLocalChanged, remoteChanged: convRemoteChanged } = mergeConversation(localConv, remoteConv)
        if (convLocalChanged)  await saveConversation(merged)
        if (convRemoteChanged && localChanged) {
          await putEncrypted(convPath, merged)
          indexChanged = true
        }
      } catch {
        if (localChanged && localMeta.updatedAt > remoteMeta.updatedAt) {
          await putEncrypted(convPath, localConv)
          indexChanged = true
        }
      }
    }

    // Reload conversations list in UI so newly synced conversations appear immediately
    await useChatStore().loadList()

    // ⑤ Only upload index if local changes were pushed or tombstones were propagated
    if (!localChanged && !indexChanged) return

    // Prune tombstones older than 6 months, then upload refreshed index
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
    for (const [id, ts] of Object.entries(mergedDeleted)) {
      if (ts < sixMonthsAgo) delete mergedDeleted[id]
    }
    localStorage.setItem('muse-deleted-conversations', JSON.stringify(mergedDeleted))

    const finalIndex = await listConversations()
    await putEncrypted(idxPath, {
      list: finalIndex,
      deletedConversations: mergedDeleted,
    } satisfies ConversationsPayload)
  }

  // ─── Module: Chat Settings ─────────────────────────────────────────────────

  async function syncChatSettings(localChanged: boolean) {
    status.progress = '同步对话设置…'
    const path = rp('settings/chat_settings.enc')
    const raw = localStorage.getItem('muse-chat-settings')
    const localData = raw ? JSON.parse(raw) : {}

    const remoteData = await getEncrypted<Record<string, unknown> | null>(path, null)

    if (!remoteData) {
      if (localChanged && Object.keys(localData).length > 0) {
        await putEncrypted(path, localData)
      }
      return
    }

    // Merge: remote timestamp wins (simple last-write-wins for settings)
    const localTs = localModuleTs(MOD_CHAT_SET)
    const remoteTs = (remoteData as Record<string, unknown> & { __syncTs?: string }).__syncTs ?? new Date(0).toISOString()

    if (remoteTs > localTs) {
      localStorage.setItem('muse-chat-settings', JSON.stringify(remoteData))
    }

    if (!localChanged) return
    await putEncrypted(path, { ...localData, __syncTs: new Date().toISOString() })
  }

  // ─── Module: Travel Notes ──────────────────────────────────────────────────

  interface TravelPayload {
    list: TravelNoteMeta[];
    deletedTravelNotes: Record<string, string>;
  }

  async function syncTravelNotes(localChanged: boolean) {
    status.progress = '同步旅行日记…'
    const localList = await listTravelNotes()
    const idxPath   = rp('travel/index.enc')

    const raw = await getEncrypted<TravelPayload | null>(idxPath, { list: [], deletedTravelNotes: {} })
    const remotePayload: TravelPayload = raw ?? { list: [], deletedTravelNotes: {} }

    applyRemoteDeletedTravelNotes(remotePayload.deletedTravelNotes ?? {})
    const mergedDeleted = getDeletedTravelNotes()

    function isDeleted(id: string): boolean {
      const ts = mergedDeleted[id]
      if (!ts) return false
      return true
    }

    const remoteList = remotePayload.list
    const localIds   = new Set(localList.map(n => n.id))
    const remoteIds  = new Set(remoteList.map(n => n.id))
    const remoteTombstones = new Set(Object.keys(remotePayload.deletedTravelNotes ?? {}))

    let indexChanged = false

    // ① Apply tombstones
    for (const meta of localList) {
      if (isDeleted(meta.id)) await deleteTravelNote(meta.id)
    }
    for (const [id] of Object.entries(mergedDeleted)) {
      if (!remoteTombstones.has(id)) {
        await webdavDelete(dav(), rp(`travel/${id}.enc`))
        indexChanged = true
      }
    }

    // ② Download notes that only exist on remote
    for (const meta of remoteList) {
      if (localIds.has(meta.id)) continue
      if (isDeleted(meta.id)) continue
      const resp = await webdavGet(dav(), rp(`travel/${meta.id}.enc`))
      if (!resp.ok) continue
      try {
        const note = JSON.parse(await decryptData(resp.body, config.password)) as TravelNote
        if (!isDeleted(note.id)) await saveTravelNote(note)
      } catch { /* skip corrupt */ }
    }

    // ③ Upload notes that only exist locally
    if (localChanged) {
      for (const meta of localList) {
        if (remoteIds.has(meta.id)) continue
        if (isDeleted(meta.id)) continue
        const note = await loadTravelNote(meta.id)
        if (!note) continue
        await putEncrypted(rp(`travel/${meta.id}.enc`), note)
        indexChanged = true
      }
    }

    // ④ Merge notes that exist on both sides (newer updatedAt wins)
    for (const localMeta of localList) {
      if (isDeleted(localMeta.id)) continue
      const remoteMeta = remoteList.find(r => r.id === localMeta.id)
      if (!remoteMeta) continue

      const localNote = await loadTravelNote(localMeta.id)
      if (!localNote) continue
      const localUpdatedAt = localNote.updatedAt ?? localMeta.updatedAt ?? new Date(0).toISOString()
      const remoteUpdatedAt = remoteMeta.updatedAt ?? new Date(0).toISOString()

      if (remoteUpdatedAt > localUpdatedAt) {
        const resp = await webdavGet(dav(), rp(`travel/${localMeta.id}.enc`))
        if (resp.ok) {
          try {
            const remoteNote = JSON.parse(await decryptData(resp.body, config.password)) as TravelNote
            await saveTravelNote(remoteNote)
          } catch { /* skip */ }
        }
      } else if (localChanged && localUpdatedAt > remoteUpdatedAt) {
        await putEncrypted(rp(`travel/${localMeta.id}.enc`), localNote)
        indexChanged = true
      }
    }

    if (!localChanged && !indexChanged) return

    // Upload index with lightweight metadata only (no content)
    const finalList = await listTravelNotes()
    await putEncrypted(idxPath, {
      list: finalList,
      deletedTravelNotes: mergedDeleted,
    } satisfies TravelPayload)
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  async function testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!config.serverUrl || !config.username || !config.password) {
      return { ok: false, message: '请先填写服务器地址、用户名和密码。' }
    }
    return webdavPing(dav())
  }

  async function syncNow(): Promise<void> {
    if (_syncInProgress) return
    if (!config.enabled) {
      status.state = 'error'; status.lastError = '同步未启用。'; return
    }
    if (!config.serverUrl || !config.username || !config.password) {
      status.state = 'error'
      status.lastError = '同步配置不完整（缺少服务器地址、用户名或密码）。'
      return
    }

    _syncInProgress  = true
    status.state     = 'syncing'
    status.lastError = null
    status.progress  = '检查远端变更…'

    try {
      // ① Fetch remote manifest — single lightweight request
      const remoteManifest = await fetchManifest()
      const record         = loadSyncRecord()

      // ② Decide which modules need syncing and whether local has changes to push
      type ModSyncInfo = { mod: ModuleId; localChanged: boolean }
      const toSync: ModSyncInfo[] = ALL_MODS.flatMap(mod => {
        const remoteModTs  = remoteManifest.modules[mod] ?? new Date(0).toISOString()
        const lastRemoteTs = record.remoteTs[mod]        ?? new Date(0).toISOString()
        const localChanged  = localModuleTs(mod) > record.syncedAt
        const remoteChanged = remoteModTs > lastRemoteTs
        if (!localChanged && !remoteChanged) return []
        return [{ mod, localChanged }]
      })

      if (toSync.length === 0) {
        status.state      = 'uptodate'
        status.lastSyncAt = new Date().toISOString()
        status.progress   = ''
        _syncInProgress   = false
        return
      }

      // ③ Ensure remote directory tree exists (only when work is needed)
      status.progress = '准备远端目录…'
      await ensureRemoteDirs()

      // ④ Sync each changed module
      const newRemoteTs: Partial<Record<ModuleId, string>> = { ...remoteManifest.modules }
      const now = new Date().toISOString()

      for (const { mod, localChanged } of toSync) {
        if (mod === MOD_AI)        await syncAiSettings(localChanged)
        if (mod === MOD_AST)       await syncAssistants(localChanged)
        if (mod === MOD_CONV)      await syncConversations(localChanged)
        if (mod === MOD_CHAT_SET)  await syncChatSettings(localChanged)
        if (mod === MOD_TRAVEL)    await syncTravelNotes(localChanged)
        newRemoteTs[mod] = now
      }

      // ⑤ Write updated manifest so other devices see the new timestamps
      await pushManifest(newRemoteTs)

      // ⑥ Wait for any debounced store persists before capturing syncedAt,
      //    so the timestamps are ordered correctly.
      await new Promise(r => setTimeout(r, DEBOUNCE_MS + 50))

      // ⑦ Persist local sync record
      const syncedAt = new Date().toISOString()
      saveSyncRecord({ syncedAt, remoteTs: newRemoteTs as Record<ModuleId, string> })

      status.state      = 'success'
      status.lastSyncAt = syncedAt
      status.progress   = ''
      localStorage.setItem('muse-webdav-last-at', syncedAt)
    } catch (e: unknown) {
      status.state     = 'error'
      status.lastError = e instanceof Error ? e.message : String(e)
      status.progress  = ''
    } finally {
      _syncInProgress = false
    }
  }

  // ─── Auto-sync ───────────────────────────────────────────────────────────

  function stopAutoSync() {
    if (_autoSyncTimer !== null) { clearInterval(_autoSyncTimer); _autoSyncTimer = null }
  }

  function startAutoSync(mins: number) {
    stopAutoSync()
    if (mins <= 0) return
    _autoSyncTimer = setInterval(() => { if (config.enabled) syncNow() }, mins * 60_000)
  }

  watch(
    () => ({ enabled: config.enabled, interval: config.autoSyncIntervalMinutes }),
    ({ enabled, interval }) => {
      if (enabled && interval > 0) startAutoSync(interval)
      else stopAutoSync()
    },
    { immediate: true },
  )

  return { config, status, testConnection, syncNow }
})
