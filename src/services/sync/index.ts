/**
 * Sync Service — central registry & orchestrator.
 *
 * Responsibilities:
 *   1. Maintain a registry of SyncModules (any module can call register()).
 *   2. Read / write the remote manifest (per-module change-detection).
 *   3. Run the sync loop: detect changes → ensure dirs → sync each module →
 *      update manifest → return result.
 *   4. The caller (Pinia store) decides when to persist the local record.
 */

import { encryptData, decryptData } from '../../utils/crypto'
import {
  webdavGet,
  webdavPut,
  webdavMkcol,
  webdavDelete,
  type WebDAVOptions,
} from '../../utils/webdav'
import type { SyncModule, SyncContext } from './types'

// LocalStorage keys
const SYNC_RECORD_LS_KEY = 'muse-sync-record'

// Manifest types
export interface SyncManifest {
  version: 2
  modules: Record<string, string>
}

export interface LocalSyncRecord {
  syncedAt: string
  remoteTs: Record<string, string>
}

export interface SyncResult {
  state: 'success' | 'uptodate'
  syncedAt: string
  remoteTs: Record<string, string>
  moduleIds: string[]
}

class SyncService {
  private modules: SyncModule[] = []
  private _dirsVerified = false

  register(module: SyncModule): void {
    if (this.modules.some(m => m.id === module.id)) {
      console.warn(`[sync] module "${module.id}" already registered, skipping`)
      return
    }
    this.modules.push(module)
  }

  getModules(): readonly SyncModule[] {
    return this.modules
  }

  loadSyncRecord(): LocalSyncRecord {
    try {
      const raw = localStorage.getItem(SYNC_RECORD_LS_KEY)
      if (raw) return JSON.parse(raw)
    } catch { /* ignore */ }
    return { syncedAt: new Date(0).toISOString(), remoteTs: {} }
  }

  saveSyncRecord(r: LocalSyncRecord): void {
    localStorage.setItem(SYNC_RECORD_LS_KEY, JSON.stringify(r))
  }

  async fetchManifest(dav: WebDAVOptions, password: string, rp: (f: string) => string): Promise<SyncManifest> {
    const fallback: SyncManifest = { version: 2, modules: {} }
    const resp = await webdavGet(dav, rp('manifest.enc'))
    if (!resp.ok) return fallback
    try {
      const parsed = JSON.parse(await decryptData(resp.body, password))
      if (parsed && typeof parsed.modules === 'object' && parsed.modules !== null) {
        return parsed as SyncManifest
      }
    } catch { /* ignore */ }
    return fallback
  }

  async pushManifest(
    dav: WebDAVOptions,
    password: string,
    rp: (f: string) => string,
    modules: Record<string, string>,
  ): Promise<void> {
    const body = await encryptData(JSON.stringify({ version: 2, modules } satisfies SyncManifest), password)
    const res = await webdavPut(dav, rp('manifest.enc'), body)
    if (!res.ok) throw new Error(`上传 manifest 失败：HTTP ${res.status}`)
  }

  async ensureRemoteDirs(dav: WebDAVOptions, remotePath: string): Promise<void> {
    if (this._dirsVerified) return
    const base = remotePath.replace(/^\/+|\/+$/, '')
    const dirs = new Set<string>()
    for (const mod of this.modules) {
      for (const d of mod.remoteDirs) {
        dirs.add(d.replace(/^\/+|\/+$/, ''))
      }
    }
    await webdavMkcol(dav, `/${base}/`)
    for (const dir of dirs) {
      await webdavMkcol(dav, `/${base}/${dir}/`)
    }
    this._dirsVerified = true
  }

  createContext(
    dav: WebDAVOptions,
    password: string,
    rp: (f: string) => string,
    setProgress: (text: string) => void,
  ): SyncContext {
    return {
      password,
      getEncrypted: async <T>(path: string, fallback: T): Promise<T> => {
        const resp = await webdavGet(dav, path)
        if (!resp.ok) return fallback
        try {
          return JSON.parse(await decryptData(resp.body, password)) as T
        } catch {
          return fallback
        }
      },
      putEncrypted: async (path: string, data: unknown): Promise<void> => {
        const body = await encryptData(JSON.stringify(data), password)
        const res = await webdavPut(dav, path, body)
        if (!res.ok) throw new Error(`上传失败 ${path}：HTTP ${res.status}`)
      },
      webdavDelete: async (path: string): Promise<void> => {
        await webdavDelete(dav, path)
      },
      webdavGet: async (path: string): Promise<{ ok: boolean; body: string }> => {
        return webdavGet(dav, path)
      },
      decrypt: async (body: string): Promise<string> => {
        return decryptData(body, password)
      },
      rp,
      setProgress,
    }
  }

  async syncNow(params: {
    dav: WebDAVOptions
    password: string
    remotePath: string
    setProgress: (text: string) => void
  }): Promise<SyncResult> {
    const { dav, password, remotePath } = params
    const rp = (filename: string) => {
      const base = remotePath.replace(/^\/+|\/+$/, '')
      return `/${base}/${filename}`
    }

    params.setProgress('检查远端变更…')

    const remoteManifest = await this.fetchManifest(dav, password, rp)
    const record = this.loadSyncRecord()

    type ModInfo = { mod: SyncModule; localChanged: boolean }
    const toSync: ModInfo[] = []
    for (const mod of this.modules) {
      const remoteModTs = remoteManifest.modules[mod.id] ?? new Date(0).toISOString()
      const lastRemoteTs = record.remoteTs[mod.id] ?? new Date(0).toISOString()
      const localTs = await mod.getLocalTimestamp()
      const localChanged = localTs > record.syncedAt
      const remoteChanged = remoteModTs > lastRemoteTs
      if (!localChanged && !remoteChanged) continue
      toSync.push({ mod, localChanged })
    }

    if (toSync.length === 0) {
      params.setProgress('')
      return { state: 'uptodate', syncedAt: new Date().toISOString(), remoteTs: remoteManifest.modules, moduleIds: [] }
    }

    params.setProgress('准备远端目录…')
    await this.ensureRemoteDirs(dav, remotePath)

    const ctx = this.createContext(dav, password, rp, params.setProgress)
    const now = new Date().toISOString()
    const newRemoteTs: Record<string, string> = { ...remoteManifest.modules }

    for (const { mod, localChanged } of toSync) {
      await mod.sync(ctx, localChanged)
      newRemoteTs[mod.id] = now
    }

    await this.pushManifest(dav, password, rp, newRemoteTs)

    const syncedAt = new Date().toISOString()
    params.setProgress('')

    return {
      state: 'success',
      syncedAt,
      remoteTs: newRemoteTs,
      moduleIds: toSync.map(m => m.mod.id),
    }
  }
}

export const syncService = new SyncService()
