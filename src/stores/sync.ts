/**
 * WebDAV Sync Store (v3 — registry-based)
 *
 * This Pinia store is a thin wrapper around the central syncService.
 * It owns:
 *   • user-visible config & status (reactive)
 *   • auto-sync timer
 *   • testConnection / syncNow entry points
 *
 * Actual per-module sync logic lives in each module's own file, registered
 * via syncService.register().
 */

import { reactive, watch } from 'vue'
import { defineStore } from 'pinia'
import { webdavPing } from '../utils/webdav'
import { syncService } from '../services/sync'
import { DEBOUNCE_MS } from './aiSettings'

const SYNC_CONFIG_LS_KEY = 'muse-webdav-sync-config'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SyncConfig {
  enabled: boolean
  serverUrl: string
  username: string
  password: string
  remotePath: string
  autoSyncIntervalMinutes: number
}

export type SyncState = 'idle' | 'syncing' | 'success' | 'error' | 'uptodate'

export interface SyncStatus {
  state: SyncState
  lastSyncAt: string | null
  lastError: string | null
  progress: string
}

const DEFAULT_CONFIG: SyncConfig = {
  enabled: false,
  serverUrl: 'https://dav.jianguoyun.com/dav/',
  username: '',
  password: '',
  remotePath: 'MuseApp',
  autoSyncIntervalMinutes: 0,
}

function loadConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_LS_KEY)
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG }
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useSyncStore = defineStore('sync', () => {
  const config = reactive<SyncConfig>(loadConfig())
  const status = reactive<SyncStatus>({
    state: 'idle',
    lastSyncAt: localStorage.getItem('muse-webdav-last-at'),
    lastError: null,
    progress: '',
  })

  let _syncInProgress = false
  let _autoSyncTimer: ReturnType<typeof setInterval> | null = null

  watch(() => ({ ...config }), v => localStorage.setItem(SYNC_CONFIG_LS_KEY, JSON.stringify(v)))

  function dav() {
    return { serverUrl: config.serverUrl, username: config.username, password: config.password }
  }

  async function testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!config.serverUrl || !config.username || !config.password) {
      return { ok: false, message: '请先填写服务器地址、用户名和密码。' }
    }
    return webdavPing(dav())
  }

  async function syncNow(): Promise<void> {
    if (_syncInProgress) return
    if (!config.enabled) {
      status.state = 'error'
      status.lastError = '同步未启用。'
      return
    }
    if (!config.serverUrl || !config.username || !config.password) {
      status.state = 'error'
      status.lastError = '同步配置不完整（缺少服务器地址、用户名或密码）。'
      return
    }

    _syncInProgress = true
    status.state = 'syncing'
    status.lastError = null
    status.progress = ''

    try {
      const result = await syncService.syncNow({
        dav: dav(),
        password: config.password,
        remotePath: config.remotePath,
        setProgress: (text) => { status.progress = text },
      })

      if (result.state === 'uptodate') {
        status.state = 'uptodate'
        status.progress = ''
        _syncInProgress = false
        return
      }

      // Wait for any debounced store persists before capturing syncedAt
      // so the timestamps are ordered correctly.
      await new Promise(r => setTimeout(r, DEBOUNCE_MS + 50))

      syncService.saveSyncRecord({ syncedAt: result.syncedAt, remoteTs: result.remoteTs })

      status.state = 'success'
      status.lastSyncAt = result.syncedAt
      status.progress = ''
      localStorage.setItem('muse-webdav-last-at', result.syncedAt)

      // Notify synced modules so they can refresh UI
      for (const mod of syncService.getModules()) {
        if (result.moduleIds.includes(mod.id) && mod.onSynced) {
          try { await mod.onSynced() } catch (e) {
            console.warn(`[sync] onSynced failed for ${mod.id}:`, e)
          }
        }
      }
    } catch (e: unknown) {
      status.state = 'error'
      status.lastError = e instanceof Error ? e.message : String(e)
      status.progress = ''
    } finally {
      _syncInProgress = false
    }
  }

  // ─── Auto-sync ─────────────────────────────────────────────────────────────

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
