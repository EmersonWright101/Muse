const LS_KEY            = 'muse-backend-config'
const LS_MODIFIED_AT_KEY = 'muse-backend-config-modified-at'

export interface BackendConfig {
  url: string
  apiKey: string
}

function migrateOldConfig(): BackendConfig | null {
  try {
    const arxiv = JSON.parse(localStorage.getItem('arxiv-connection') ?? '{}')
    let url = (arxiv.baseUrl as string)?.trim()
    let apiKey = (arxiv.apiKey as string) ?? ''
    if (!url) {
      url = localStorage.getItem('muse-todo-api-url')?.trim() ?? ''
      apiKey = localStorage.getItem('muse-todo-api-key') ?? ''
    }
    if (!url) return null
    // Strip legacy endpoint suffixes so we can append them in code
    url = url
      .replace(/\/api\/arxiv\/?$/, '')
      .replace(/\/api\/todo\/?$/, '')
      .replace(/\/+$/, '')
    return { url, apiKey }
  } catch {
    return null
  }
}

export function getBackendConfig(): BackendConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const v = JSON.parse(raw)
      const url = (v.url as string)?.trim()
      if (url) return { url: url.replace(/\/+$/, ''), apiKey: (v.apiKey as string) ?? '' }
    }
    const migrated = migrateOldConfig()
    if (migrated) {
      localStorage.setItem(LS_KEY, JSON.stringify(migrated))
    }
    return migrated
  } catch {
    return null
  }
}

export function setBackendConfig(cfg: BackendConfig | null): void {
  if (cfg?.url.trim()) {
    localStorage.setItem(LS_KEY, JSON.stringify({
      url: cfg.url.trim().replace(/\/+$/, ''),
      apiKey: cfg.apiKey.trim(),
    }))
  } else {
    localStorage.removeItem(LS_KEY)
  }
  localStorage.setItem(LS_MODIFIED_AT_KEY, new Date().toISOString())
}

// ─── Sync module ─────────────────────────────────────────────────────────────

import { syncService } from '../services/sync'
import type { SyncModule } from '../services/sync/types'

interface RemoteBackendConfig {
  url:      string
  apiKey:   string
  __syncTs: string
}

const backendConfigSyncModule: SyncModule = {
  id:         'backendConfig',
  remoteDirs: ['settings'],
  getLocalTimestamp() {
    return localStorage.getItem(LS_MODIFIED_AT_KEY) ?? new Date(0).toISOString()
  },
  async sync(ctx, localChanged) {
    ctx.setProgress('同步后端连接配置…')
    const path      = ctx.rp('settings/backend_config.enc')
    const local     = getBackendConfig()
    const remoteData = await ctx.getEncrypted<RemoteBackendConfig | null>(path, null)

    if (!remoteData) {
      if (localChanged && local) {
        await ctx.putEncrypted(path, { ...local, __syncTs: new Date().toISOString() })
      }
      return
    }

    const localTs  = await this.getLocalTimestamp()
    const remoteTs = remoteData.__syncTs ?? new Date(0).toISOString()

    if (remoteTs > localTs) {
      const { __syncTs: _, ...data } = remoteData
      // Write directly — bypasses setBackendConfig() so the modified-at timestamp is NOT bumped
      if (data.url?.trim()) {
        localStorage.setItem(LS_KEY, JSON.stringify({
          url:    data.url.trim().replace(/\/+$/, ''),
          apiKey: data.apiKey?.trim() ?? '',
        }))
      } else {
        localStorage.removeItem(LS_KEY)
      }
    }

    if (!localChanged) return
    await ctx.putEncrypted(path, { ...(local ?? { url: '', apiKey: '' }), __syncTs: new Date().toISOString() })
  },
  async onSynced() {
    const { usePapersStore } = await import('../stores/papers')
    usePapersStore().reloadConn()
  },
}

syncService.register(backendConfigSyncModule)
