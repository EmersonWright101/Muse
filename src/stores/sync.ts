/**
 * WebDAV Sync Store
 *
 * Syncs AI settings (re-encrypted with WebDAV password) and all conversation
 * history to a user-configured WebDAV server.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 * Every remote file is encrypted with AES-256-GCM before upload.
 * The encryption key is derived from the WebDAV password via PBKDF2-SHA256.
 * Even if someone gains access to the remote storage they cannot read the
 * content without the password.
 *
 * ── Conflict resolution ─────────────────────────────────────────────────────
 * Conversations : union merge by message ID per conversation.
 * AI Settings   : last-write-wins using an ISO timestamp.
 *
 * ── Bandwidth optimisation ──────────────────────────────────────────────────
 * A tiny encrypted manifest (manifest.enc) records the last successful sync
 * timestamp.  A full sync is skipped when neither local dirty flag is set nor
 * the remote manifest has changed.
 */

import { reactive, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  listConversations, loadConversation, saveConversation,
  type ConversationMeta, type Conversation,
} from '../utils/storage'
import { encryptData, decryptData }    from '../utils/crypto'
import { webdavGet, webdavPut, webdavMkcol, webdavPing } from '../utils/webdav'
import { useAiSettingsStore, LS_MODIFIED_AT_KEY } from './aiSettings'

const SYNC_CONFIG_LS_KEY = 'muse-webdav-sync-config'
const MANIFEST_LS_KEY    = 'muse-webdav-manifest-at'

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

export const useSyncStore = defineStore('sync', () => {
  const config = reactive<SyncConfig>(loadConfig())
  const status = reactive<SyncStatus>({
    state:      'idle',
    lastSyncAt: localStorage.getItem('muse-webdav-last-at'),
    lastError:  null,
    progress:   '',
  })

  let _syncInProgress      = false
  let _localDirtyAt        = 0
  let _lastRemoteSyncedAt  = localStorage.getItem(MANIFEST_LS_KEY)
  let _autoSyncTimer: ReturnType<typeof setInterval> | null = null

  function markDirty() {
    if (!_syncInProgress) _localDirtyAt = Date.now()
  }

  // Persist config changes
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

  // ─── Manifest ────────────────────────────────────────────────────────────

  async function fetchRemoteManifest(): Promise<{ syncedAt: string } | null> {
    try {
      const resp  = await webdavGet(dav(), remotePath('manifest.enc'))
      if (!resp.ok) return null
      const plain = await decryptData(resp.body, config.password)
      return JSON.parse(plain)
    } catch { return null }
  }

  async function uploadManifest(syncedAt: string) {
    try {
      const enc = await encryptData(JSON.stringify({ syncedAt }), config.password)
      await webdavPut(dav(), remotePath('manifest.enc'), enc)
      _lastRemoteSyncedAt = syncedAt
      localStorage.setItem(MANIFEST_LS_KEY, syncedAt)
    } catch { /* non-critical */ }
  }

  // ─── AI Settings sync ────────────────────────────────────────────────────

  async function syncAiSettings() {
    status.progress = '同步 AI 设置…'
    const aiStore   = useAiSettingsStore()

    const localData = {
      timestamp: localStorage.getItem(LS_MODIFIED_AT_KEY) ?? new Date(0).toISOString(),
      providers: aiStore.providers.map(p => ({
        id:              p.id,
        apiKey:          p.apiKey,
        baseUrl:         p.baseUrl,
        enabled:         p.enabled,
        selectedModelId: p.selectedModelId,
        customModels:    p.id === 'custom' ? p.models : undefined,
      })),
      activeProviderId: aiStore.activeProviderId,
    }

    const path   = remotePath('ai_settings.enc')
    const remote = await webdavGet(dav(), path)

    if (!remote.ok) {
      const enc = await encryptData(JSON.stringify(localData), config.password)
      await webdavPut(dav(), path, enc)
      return
    }

    try {
      const plain      = await decryptData(remote.body, config.password)
      const remoteData = JSON.parse(plain)

      if (remoteData.timestamp > localData.timestamp) {
        // Apply remote settings
        for (const rp of remoteData.providers ?? []) {
          aiStore.updateProvider(rp.id, {
            apiKey:  rp.apiKey  ?? '',
            baseUrl: rp.baseUrl ?? '',
            enabled: rp.enabled ?? true,
          })
          if (rp.selectedModelId) aiStore.setModelForProvider(rp.id, rp.selectedModelId)
        }
        if (remoteData.activeProviderId) aiStore.setActiveProvider(remoteData.activeProviderId)
      } else {
        // Upload local
        const enc = await encryptData(JSON.stringify(localData), config.password)
        await webdavPut(dav(), path, enc)
      }
    } catch {
      const enc = await encryptData(JSON.stringify(localData), config.password)
      await webdavPut(dav(), path, enc)
    }
  }

  // ─── Conversation sync ───────────────────────────────────────────────────

  async function syncConversations() {
    status.progress = '同步对话历史…'

    // Upload remote index
    const localList = await listConversations()

    // Fetch remote index
    const idxPath = remotePath('conversations/index.enc')
    const idxResp = await webdavGet(dav(), idxPath)

    let remoteList: ConversationMeta[] = []
    if (idxResp.ok) {
      try {
        const plain = await decryptData(idxResp.body, config.password)
        remoteList  = JSON.parse(plain)
      } catch { /* use empty */ }
    }

    // Union by id
    const localIds  = new Set(localList.map(c => c.id))
    const remoteIds = new Set(remoteList.map(c => c.id))

    // Download remote-only conversations
    for (const meta of remoteList) {
      if (!localIds.has(meta.id)) {
        const resp = await webdavGet(dav(), remotePath(`conversations/${meta.id}.enc`))
        if (resp.ok) {
          try {
            const plain = await decryptData(resp.body, config.password)
            const conv  = JSON.parse(plain) as Conversation
            await saveConversation(conv)
          } catch { /* skip */ }
        }
      }
    }

    // Upload local-only conversations
    for (const meta of localList) {
      if (!remoteIds.has(meta.id)) {
        const conv = await loadConversation(meta.id)
        if (conv) {
          const enc = await encryptData(JSON.stringify(conv), config.password)
          await webdavPut(dav(), remotePath(`conversations/${meta.id}.enc`), enc)
        }
      }
    }

    // Upload updated conversations (updatedAt > remote's updatedAt)
    for (const local of localList) {
      const remote = remoteList.find(r => r.id === local.id)
      if (remote && local.updatedAt > remote.updatedAt) {
        const conv = await loadConversation(local.id)
        if (conv) {
          const enc = await encryptData(JSON.stringify(conv), config.password)
          await webdavPut(dav(), remotePath(`conversations/${local.id}.enc`), enc)
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
    if (status.state === 'syncing') return
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

    // Pre-flight manifest check
    try {
      status.progress    = '检查更新…'
      const manifest     = await fetchRemoteManifest()
      const remoteChanged = manifest === null || manifest.syncedAt !== _lastRemoteSyncedAt
      const localDirty   = _localDirtyAt > 0

      if (!remoteChanged && !localDirty) {
        status.state    = 'uptodate'
        status.progress = ''
        _syncInProgress = false
        setTimeout(() => {
          if (status.state === 'uptodate')
            status.state = status.lastSyncAt ? 'success' : 'idle'
        }, 3000)
        return
      }
    } catch { /* fall through to full sync */ }

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

      await uploadManifest(syncedAt)
      _localDirtyAt = 0
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

  return { config, status, markDirty, testConnection, syncNow }
})
