const LS_KEY = 'muse-backend-config'

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
}
