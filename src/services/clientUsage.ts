/**
 * Client usage tracking — pushes usage metrics to the backend.
 * Backend endpoints: GET/PUT/POST /api/client-usage/{key}
 */

import { apiGet, apiPut } from './api'

export async function getClientUsage<T = unknown>(key: string): Promise<T | null> {
  try {
    const resp = await apiGet<{ key: string; value: T }>(`/api/client-usage/${encodeURIComponent(key)}`)
    return resp?.value ?? null
  } catch { return null }
}

export async function setClientUsage(key: string, value: unknown): Promise<void> {
  await apiPut(`/api/client-usage/${encodeURIComponent(key)}`, {
    value,
    updated_at: new Date().toISOString(),
  }).catch(() => {})
}

export async function incrementClientUsage(key: string, amount = 1): Promise<number | null> {
  try {
    const { apiPost } = await import('./api')
    const resp = await apiPost<{ key: string; value: number }>(`/api/client-usage/${encodeURIComponent(key)}/increment?amount=${amount}`, {})
    return resp?.value ?? null
  } catch { return null }
}
