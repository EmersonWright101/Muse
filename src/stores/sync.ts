/**
 * WebDAV Sync Store
 *
 * Syncs AI settings and all conversation history to a WebDAV server.
 * Every remote file is encrypted with AES-256-GCM; key derived from WebDAV password.
 *
 * ── Merge strategy ──────────────────────────────────────────────────────────
 * AI Settings  : per-provider merge using each provider's own updatedAt.
 *                Non-conflicting changes (different providers) are always merged.
 *                Same provider modified on both sides → newer updatedAt wins.
 *                activeProviderId uses overall settings timestamp.
 *
 * Conversations: per-message union merge using message ID.
 *                Messages only on one side → added to the other.
 *                Same message ID on both sides → newer timestamp wins.
 *                Conversation metadata (title, model, etc.) → newer updatedAt wins.
 */

import { reactive, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  listConversations, loadConversation, saveConversation,
  type ConversationMeta, type Conversation, type ChatMessage,
} from '../utils/storage'
import { encryptData, decryptData }    from '../utils/crypto'
import { webdavGet, webdavPut, webdavMkcol, webdavPing } from '../utils/webdav'
import { useAiSettingsStore, LS_MODIFIED_AT_KEY, type AIProvider } from './aiSettings'

const SYNC_CONFIG_LS_KEY = 'muse-webdav-sync-config'

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

// ─── Merge helpers ────────────────────────────────────────────────────────────

type RemoteProvider = {
  id: string; name?: string; type?: AIProvider['type']; builtIn?: boolean;
  apiKey?: string; baseUrl?: string; enabled?: boolean;
  selectedModelId?: string; customModels?: AIProvider['models']; updatedAt?: string;
}

/** Merge two message arrays by ID; for the same ID keep the newer timestamp. */
function mergeMessages(local: ChatMessage[], remote: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>()
  for (const msg of local)  map.set(msg.id, msg)
  for (const msg of remote) {
    const existing = map.get(msg.id)
    if (!existing || msg.timestamp > existing.timestamp) map.set(msg.id, msg)
  }
  return [...map.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

/** Merge two versions of the same conversation. Returns merged + whether it differs from local. */
function mergeConversation(
  local: Conversation,
  remote: Conversation,
): { merged: Conversation; localChanged: boolean; remoteChanged: boolean } {
  const messages    = mergeMessages(local.messages, remote.messages)
  const newerIsRemote = remote.updatedAt > local.updatedAt
  const base        = newerIsRemote ? remote : local
  const updatedAt   = newerIsRemote ? remote.updatedAt : local.updatedAt

  const merged: Conversation = { ...base, messages, updatedAt }

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

  watch(() => ({ ...config }), (v) => localStorage.setItem(SYNC_CONFIG_LS_KEY, JSON.stringify(v)))

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function dav() {
    return { serverUrl: config.serverUrl, username: config.username, password: config.password }
  }

  function remotePath(filename: string): string {
    const base = config.remotePath.replace(/^\/+|\/+$/g, '')
    return `/${base}/${filename}`
  }

  async function ensureRemoteDir() {
    const base = config.remotePath.replace(/^\/+|\/+$/g, '')
    await webdavMkcol(dav(), `/${base}/`)
    await webdavMkcol(dav(), `/${base}/conversations/`)
  }

  // ─── AI Settings sync ────────────────────────────────────────────────────

  async function syncAiSettings() {
    status.progress   = '同步 AI 设置…'
    const aiStore     = useAiSettingsStore()
    const localTs     = localStorage.getItem(LS_MODIFIED_AT_KEY) ?? new Date(0).toISOString()

    function toRemoteProvider(p: AIProvider): RemoteProvider {
      return {
        id:              p.id,
        name:            p.name,
        type:            p.type,
        builtIn:         p.builtIn,
        apiKey:          p.apiKey,
        baseUrl:         p.baseUrl,
        enabled:         p.enabled,
        selectedModelId: p.selectedModelId,
        customModels:    p.type === 'custom' ? p.models : undefined,
        updatedAt:       p.updatedAt ?? new Date(0).toISOString(),
      }
    }

    const localData = {
      timestamp:        localTs,
      providers:        aiStore.providers.map(toRemoteProvider),
      activeProviderId: aiStore.activeProviderId,
    }

    const path   = remotePath('ai_settings.enc')
    const remote = await webdavGet(dav(), path)

    if (!remote.ok) {
      const enc = await encryptData(JSON.stringify(localData), config.password)
      await webdavPut(dav(), path, enc)
      return
    }

    let remoteData: typeof localData
    try {
      const plain = await decryptData(remote.body, config.password)
      remoteData  = JSON.parse(plain)
    } catch {
      const enc = await encryptData(JSON.stringify(localData), config.password)
      await webdavPut(dav(), path, enc)
      return
    }

    const remoteProviderMap = new Map<string, RemoteProvider>(
      (remoteData.providers ?? []).map((p: RemoteProvider) => [p.id, p]),
    )
    const localProviderMap = new Map<string, RemoteProvider>(
      localData.providers.map(p => [p.id, p]),
    )

    // Apply remote-newer providers to local
    for (const [id, rp] of remoteProviderMap) {
      const lp = localProviderMap.get(id)
      if (!lp || (rp.updatedAt ?? '') > (lp.updatedAt ?? '')) {
        aiStore.importProvider(rp)
      }
    }

    // activeProviderId: overall last-write-wins
    if ((remoteData.timestamp ?? '') > localTs && remoteData.activeProviderId) {
      aiStore.setActiveProvider(remoteData.activeProviderId)
    }

    // Upload merged state (union of all providers, each at its winning version)
    const mergedData = {
      timestamp:        new Date().toISOString(),
      providers:        aiStore.providers.map(toRemoteProvider),
      activeProviderId: aiStore.activeProviderId,
    }
    // Also include any remote-only providers not yet in local store
    for (const [id, rp] of remoteProviderMap) {
      if (!localProviderMap.has(id) && !mergedData.providers.find(p => p.id === id)) {
        mergedData.providers.push(rp)
      }
    }

    const enc = await encryptData(JSON.stringify(mergedData), config.password)
    await webdavPut(dav(), path, enc)
  }

  // ─── Conversation sync ───────────────────────────────────────────────────

  async function syncConversations() {
    status.progress = '同步对话历史…'

    const localList = await listConversations()
    const idxPath   = remotePath('conversations/index.enc')
    const idxResp   = await webdavGet(dav(), idxPath)

    let remoteList: ConversationMeta[] = []
    if (idxResp.ok) {
      try {
        const plain = await decryptData(idxResp.body, config.password)
        remoteList  = JSON.parse(plain)
      } catch { /* use empty */ }
    }

    const localIds  = new Set(localList.map(c => c.id))
    const remoteIds = new Set(remoteList.map(c => c.id))

    // Download remote-only conversations
    for (const meta of remoteList) {
      if (localIds.has(meta.id)) continue
      const resp = await webdavGet(dav(), remotePath(`conversations/${meta.id}.enc`))
      if (!resp.ok) continue
      try {
        const conv = JSON.parse(await decryptData(resp.body, config.password)) as Conversation
        await saveConversation(conv)
      } catch { /* skip */ }
    }

    // Upload local-only conversations
    for (const meta of localList) {
      if (remoteIds.has(meta.id)) continue
      const conv = await loadConversation(meta.id)
      if (!conv) continue
      const enc = await encryptData(JSON.stringify(conv), config.password)
      await webdavPut(dav(), remotePath(`conversations/${meta.id}.enc`), enc)
    }

    // Merge conversations that exist on both sides
    for (const localMeta of localList) {
      const remoteMeta = remoteList.find(r => r.id === localMeta.id)
      if (!remoteMeta) continue
      if (localMeta.updatedAt === remoteMeta.updatedAt) continue  // identical

      const localConv = await loadConversation(localMeta.id)
      if (!localConv) continue

      const remoteResp = await webdavGet(dav(), remotePath(`conversations/${localMeta.id}.enc`))
      if (!remoteResp.ok) {
        // Remote file missing but index says it exists — upload local
        if (localMeta.updatedAt > remoteMeta.updatedAt) {
          const enc = await encryptData(JSON.stringify(localConv), config.password)
          await webdavPut(dav(), remotePath(`conversations/${localMeta.id}.enc`), enc)
        }
        continue
      }

      try {
        const remoteConv = JSON.parse(
          await decryptData(remoteResp.body, config.password),
        ) as Conversation

        const { merged, localChanged, remoteChanged } = mergeConversation(localConv, remoteConv)

        if (localChanged)  await saveConversation(merged)
        if (remoteChanged) {
          const enc = await encryptData(JSON.stringify(merged), config.password)
          await webdavPut(dav(), remotePath(`conversations/${localMeta.id}.enc`), enc)
        }
      } catch {
        // Fallback: simple last-write-wins
        if (localMeta.updatedAt > remoteMeta.updatedAt) {
          const enc = await encryptData(JSON.stringify(localConv), config.password)
          await webdavPut(dav(), remotePath(`conversations/${localMeta.id}.enc`), enc)
        }
      }
    }

    // Upload merged index
    const mergedIndex = await listConversations()
    const enc = await encryptData(JSON.stringify(mergedIndex), config.password)
    await webdavPut(dav(), idxPath, enc)
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
      status.state     = 'error'
      status.lastError = '同步未启用。'
      return
    }
    if (!config.serverUrl || !config.username || !config.password) {
      status.state     = 'error'
      status.lastError = '同步配置不完整（缺少服务器地址、用户名或密码）。'
      return
    }

    _syncInProgress  = true
    status.state     = 'syncing'
    status.lastError = null

    try {
      status.progress = '准备远端目录…'
      await ensureRemoteDir()

      await syncAiSettings()
      await syncConversations()

      const syncedAt    = new Date().toISOString()
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
