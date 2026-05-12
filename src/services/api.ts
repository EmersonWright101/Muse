/**
 * Central HTTP client for the Muse backend API.
 *
 * All requests are authenticated with the configured backend API key.
 * Returns null / silently no-ops when no backend is configured.
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { getBackendConfig } from '../utils/backendConfig'
export { getBackendConfig }

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export function isBackendConfigured(): boolean {
  return !!(getBackendConfig()?.url)
}

export function getServerApiKey(): string {
  return getBackendConfig()?.apiKey ?? ''
}

function baseUrl(): string {
  return getBackendConfig()?.url ?? ''
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'Authorization': `Bearer ${getServerApiKey()}`, ...extra }
}

// ─── 请求级别锁（避免同一路径的重复请求）──────────────────────────────────────

const _requestLocks = new Map<string, AbortController>()

async function parseError(resp: { status: number; statusText: string; json: () => Promise<unknown> }): Promise<ApiError> {
  let msg = resp.statusText
  try {
    const body = await resp.json() as { detail?: unknown }
    if (body.detail !== undefined) {
      msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    }
  } catch { /* ignore */ }
  return new ApiError(resp.status, msg)
}

// ─── Conflict retry helpers ──────────────────────────────────────────────────

const MAX_CONFLICT_RETRIES = 3
const CONFLICT_BACKOFF_MS = [1000, 2000, 4000]

const MAX_RETRIES = 3
const RETRY_BACKOFF_MS = [1000, 2000, 4000]

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function showConflictToast(message: string): void {
  const toast = document.createElement('div')
  toast.textContent = message
  toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(51,51,51,0.95);color:#fff;padding:10px 20px;border-radius:8px;z-index:99999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:none;white-space:nowrap;'
  document.body.appendChild(toast)
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease'
    toast.style.opacity = '0'
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

/**
 * Generic retry wrapper for transient API errors (network failures, 5xx, 429).
 */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  options?: {
    maxRetries?: number
    delays?: number[]
    shouldRetry?: (err: ApiError) => boolean
    onRetry?: (err: ApiError, attempt: number) => void
  }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES
  const delays = options?.delays ?? RETRY_BACKOFF_MS
  const shouldRetry = options?.shouldRetry ?? ((err: ApiError) => err.status === 0 || err.status >= 500 || err.status === 429)

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await attempt()
    } catch (e) {
      if (e instanceof ApiError && shouldRetry(e) && i < maxRetries) {
        const delay = delays[i] ?? delays[delays.length - 1] ?? 4000
        if (options?.onRetry) {
          options.onRetry(e, i + 1)
        }
        await sleep(delay)
        continue
      }
      throw e
    }
  }
  throw new ApiError(0, 'Retry failed after maximum retries')
}

/**
 * Retry an API operation with exponential backoff when a 409 Conflict is received.
 * The caller should provide an `onConflict` callback that re-fetches the remote
 * resource and returns the merged body (for PUT/POST) or simply refreshes state
 * (for DELETE).
 *
 * Now composes with withRetry so callers also get transient-error retries.
 */
export async function withConflictRetry<T>(
  attempt: () => Promise<T>,
  onConflict?: () => Promise<void>,
): Promise<T> {
  for (let i = 0; i <= MAX_CONFLICT_RETRIES; i++) {
    try {
      return await attempt()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && onConflict && i < MAX_CONFLICT_RETRIES) {
        await sleep(CONFLICT_BACKOFF_MS[i] ?? 4000)
        await onConflict()
        continue
      }
      throw e
    }
  }
  showConflictToast('同步冲突，请刷新')
  throw new ApiError(409, 'Conflict resolution failed after maximum retries')
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function apiGet<T>(path: string): Promise<T | null> {
  if (!isBackendConfigured()) return null
  try {
    const resp = await tauriFetch(`${baseUrl()}${path}`, {
      headers: authHeaders({ 'Content-Type': 'application/json' }),
    })
    if (!resp.ok) throw await parseError(resp)
    return resp.json() as Promise<T>
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(0, String(e))
  }
}

export async function apiPostBinary(path: string, body: unknown): Promise<ArrayBuffer | null> {
  if (!isBackendConfigured()) return null
  try {
    const resp = await tauriFetch(`${baseUrl()}${path}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    if (!resp.ok) return null
    return resp.arrayBuffer()
  } catch {
    return null
  }
}

export async function apiGetBinary(path: string): Promise<Uint8Array | null> {
  if (!isBackendConfigured()) return null
  try {
    const resp = await tauriFetch(`${baseUrl()}${path}`, { headers: authHeaders() })
    if (!resp.ok) return null
    return new Uint8Array(await resp.arrayBuffer())
  } catch {
    return null
  }
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

export async function apiPutBinary(path: string, data: ArrayBuffer, contentType = 'audio/mpeg'): Promise<void> {
  if (!isBackendConfigured()) return
  const resp = await tauriFetch(`${baseUrl()}${path}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': contentType }),
    body: data,
  })
  if (!resp.ok) throw await parseError(resp)
}

export async function apiPut(path: string, body: unknown, options?: { onConflict?: () => Promise<unknown> }): Promise<void> {
  if (!isBackendConfigured()) return

  const lockKey = `PUT:${path}`
  const oldController = _requestLocks.get(lockKey)
  if (oldController) {
    oldController.abort()
  }
  const controller = new AbortController()
  _requestLocks.set(lockKey, controller)

  let currentBody = body
  try {
    return await withRetry(async () => {
      return withConflictRetry(async () => {
        const resp = await tauriFetch(`${baseUrl()}${path}`, {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(currentBody),
          signal: controller.signal,
        })
        if (!resp.ok) throw await parseError(resp)
      }, options ? async () => { currentBody = await options.onConflict!() } : undefined)
    }, {
      shouldRetry: (err) => err.status === 0 || err.status >= 500 || err.status === 429,
      onRetry: (err, attempt) => console.warn(`[API] PUT ${path} retry ${attempt}/${MAX_RETRIES}: ${err.status} ${err.message}`),
    })
  } finally {
    if (_requestLocks.get(lockKey) === controller) {
      _requestLocks.delete(lockKey)
    }
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function apiPost<T>(path: string, body: unknown, options?: { onConflict?: () => Promise<unknown> }): Promise<T> {
  if (!isBackendConfigured()) throw new ApiError(0, 'No backend configured')
  let currentBody = body
  return withRetry(async () => {
    return withConflictRetry(async () => {
      const resp = await tauriFetch(`${baseUrl()}${path}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(currentBody),
      })
      if (!resp.ok) throw await parseError(resp)
      return resp.json() as Promise<T>
    }, options ? async () => { currentBody = await options.onConflict!() } : undefined)
  }, {
    shouldRetry: (err) => err.status === 0 || err.status >= 500 || err.status === 429,
    onRetry: (err, attempt) => console.warn(`[API] POST ${path} retry ${attempt}/${MAX_RETRIES}: ${err.status} ${err.message}`),
  })
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  if (!isBackendConfigured()) throw new ApiError(0, 'No backend configured')
  const resp = await tauriFetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (!resp.ok) throw await parseError(resp)
  return resp.json() as Promise<T>
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function apiDelete(path: string, options?: { onConflict?: () => Promise<void> }): Promise<void> {
  if (!isBackendConfigured()) return
  return withRetry(async () => {
    return withConflictRetry(async () => {
      const resp = await tauriFetch(`${baseUrl()}${path}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!resp.ok) throw await parseError(resp)
    }, options?.onConflict)
  }, {
    shouldRetry: (err) => err.status === 0 || err.status >= 500 || err.status === 429,
    onRetry: (err, attempt) => console.warn(`[API] DELETE ${path} retry ${attempt}/${MAX_RETRIES}: ${err.status} ${err.message}`),
  })
}
