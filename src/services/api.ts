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

async function parseError(resp: { status: number; statusText: string; json: () => Promise<unknown> }): Promise<ApiError> {
  let msg = resp.statusText
  try { msg = ((await resp.json()) as { detail?: string }).detail ?? msg } catch { /* ignore */ }
  return new ApiError(resp.status, msg)
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

export async function apiPut(path: string, body: unknown): Promise<void> {
  if (!isBackendConfigured()) return
  const resp = await tauriFetch(`${baseUrl()}${path}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw await parseError(resp)
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  if (!isBackendConfigured()) throw new ApiError(0, 'No backend configured')
  const resp = await tauriFetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw await parseError(resp)
  return resp.json() as Promise<T>
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

export async function apiDelete(path: string): Promise<void> {
  if (!isBackendConfigured()) return
  const resp = await tauriFetch(`${baseUrl()}${path}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!resp.ok) throw await parseError(resp)
}
