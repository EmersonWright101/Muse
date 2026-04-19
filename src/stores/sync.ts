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
 */

import { reactive, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  listConversations, loadConversation, saveConversation,
  listAssistants, saveAssistant,
  type ConversationMeta, type Conversation, type ChatMessage, type Assistant,
  type MessageVariant,
} from '../utils/storage'
import { encryptData, decryptData }    from '../utils/crypto'
import { webdavGet, webdavPut, webdavMkcol, webdavPing } from '../utils/webdav'
import {
  useAiSettingsStore, LS_MODIFIED_AT_KEY,
  getDeletedProviders, applyRemoteDeletedProviders,
  type AIProvider,
} from './aiSettings'

const SYNC_CONFIG_LS_KEY = 'muse-webdav-sync-config'
const SYNC_RECORD_LS_KEY = 'muse-sync-record'

// ─── Module registry ─────────────────────────────────────────────────────────
// Add new modules here when you add new app modules.

const MOD_AI   = 'aiSettings'    as const
const MOD_AST  = 'assistants'    as const
const MOD_CONV = 'conversations' as const
const ALL_MODS = [MOD_AI, MOD_AST, MOD_CONV] as const
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
  const key = mod === MOD_AI ? LS_MODIFIED_AT_KEY : `muse-ts-${mod}`
  return localStorage.getItem(key) ?? new Date(0).toISOString()
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
    const base = config.remotePath.replace(/^\/+|\/+$/g, '')
    await webdavMkcol(dav(), `/${base}/`)
    await webdavMkcol(dav(), `/${base}/settings/`)
    await webdavMkcol(dav(), `/${base}/assistants/`)
    await webdavMkcol(dav(), `/${base}/conversations/`)
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
    await webdavPut(dav(), path, await encryptData(JSON.stringify(data), config.password))
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

  async function syncAiSettings() {
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
      await putEncrypted(path, localData)
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

  async function syncAssistants() {
    status.progress = '同步助手配置…'
    const localList = await listAssistants()
    const path      = rp('assistants/list.enc')
    const remoteList = await getEncrypted<Assistant[]>(path, [])

    // Union merge by id; newer updatedAt (fallback createdAt) wins per item
    const merged = new Map<string, Assistant>()
    for (const a of localList)  merged.set(a.id, a)
    for (const a of remoteList) {
      const local = merged.get(a.id)
      if (!local || (a.updatedAt ?? a.createdAt) > (local.updatedAt ?? local.createdAt)) {
        merged.set(a.id, a)
      }
    }

    const mergedList = [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    // Write remote-newer items to local storage
    for (const a of mergedList) {
      const local = localList.find(l => l.id === a.id)
      if (!local || (a.updatedAt ?? a.createdAt) > (local.updatedAt ?? local.createdAt)) {
        await saveAssistant(a)
      }
    }

    await putEncrypted(path, mergedList)
  }

  // ─── Module: Conversations ───────────────────────────────────────────────

  async function syncConversations() {
    status.progress = '同步对话历史…'

    const localList  = await listConversations()
    const idxPath    = rp('conversations/index.enc')
    const remoteList = await getEncrypted<ConversationMeta[]>(idxPath, [])

    const localIds  = new Set(localList.map(c => c.id))
    const remoteIds = new Set(remoteList.map(c => c.id))

    // ① Download conversations that only exist on remote
    for (const meta of remoteList) {
      if (localIds.has(meta.id)) continue
      const resp = await webdavGet(dav(), rp(`conversations/${meta.id}.enc`))
      if (!resp.ok) continue
      try {
        const conv = JSON.parse(await decryptData(resp.body, config.password)) as Conversation
        await saveConversation(conv)
      } catch { /* skip corrupt remote entry */ }
    }

    // ② Upload conversations that only exist locally
    for (const meta of localList) {
      if (remoteIds.has(meta.id)) continue
      const conv = await loadConversation(meta.id)
      if (!conv) continue
      await putEncrypted(rp(`conversations/${meta.id}.enc`), conv)
    }

    // ③ Merge conversations that exist on both sides but differ
    for (const localMeta of localList) {
      const remoteMeta = remoteList.find(r => r.id === localMeta.id)
      if (!remoteMeta || localMeta.updatedAt === remoteMeta.updatedAt) continue

      const localConv = await loadConversation(localMeta.id)
      if (!localConv) continue

      const convPath   = rp(`conversations/${localMeta.id}.enc`)
      const remoteResp = await webdavGet(dav(), convPath)

      if (!remoteResp.ok) {
        // Remote file missing but index says it exists → upload local if newer
        if (localMeta.updatedAt > remoteMeta.updatedAt) {
          await putEncrypted(convPath, localConv)
        }
        continue
      }

      try {
        const remoteConv = JSON.parse(
          await decryptData(remoteResp.body, config.password),
        ) as Conversation
        const { merged, localChanged, remoteChanged } = mergeConversation(localConv, remoteConv)
        if (localChanged)  await saveConversation(merged)
        if (remoteChanged) await putEncrypted(convPath, merged)
      } catch {
        // Fallback: simple last-write-wins
        if (localMeta.updatedAt > remoteMeta.updatedAt) {
          await putEncrypted(convPath, localConv)
        }
      }
    }

    // ④ Upload refreshed index
    const finalIndex = await listConversations()
    await putEncrypted(idxPath, finalIndex)
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

      // ② Decide which modules need syncing
      const toSync = ALL_MODS.filter(mod => {
        const remoteModTs  = remoteManifest.modules[mod] ?? new Date(0).toISOString()
        const lastRemoteTs = record.remoteTs[mod]        ?? new Date(0).toISOString()
        const localChanged  = localModuleTs(mod) > record.syncedAt
        const remoteChanged = remoteModTs > lastRemoteTs
        return localChanged || remoteChanged
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

      for (const mod of toSync) {
        if (mod === MOD_AI)   await syncAiSettings()
        if (mod === MOD_AST)  await syncAssistants()
        if (mod === MOD_CONV) await syncConversations()
        newRemoteTs[mod] = now
      }

      // ⑤ Write updated manifest so other devices see the new timestamps
      await pushManifest(newRemoteTs)

      // ⑥ Persist local sync record
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
