/**
 * HTTP client for the remote Todo backend.
 *
 * When a backend URL is configured the store uses this instead of local files.
 * All requests carry a Bearer token so the backend can authenticate them.
 *
 * API base: {url}/api/todo
 */

import { getBackendConfig, setBackendConfig } from './backendConfig'
import type { TodoTask, TodoProject } from './todoStorage'

// ─── Config (shared with papers backend) ─────────────────────────────────────

export interface TodoApiConfig {
  url:    string   // base server URL, e.g. "http://localhost:3000"
  apiKey: string   // Bearer token; may be empty for dev
}

export function getApiConfig(): TodoApiConfig | null {
  return getBackendConfig()
}

export function setApiConfig(cfg: TodoApiConfig | null): void {
  setBackendConfig(cfg)
}

// ─── Low-level fetch ──────────────────────────────────────────────────────────

function buildHeaders(cfg: TodoApiConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.apiKey) h['Authorization'] = `Bearer ${cfg.apiKey}`
  return h
}

async function apiFetch<T>(
  cfg: TodoApiConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${cfg.url}/api/todo${path}`, {
    method,
    headers: buildHeaders(cfg),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[${method} ${path}] HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const ct = res.headers.get('content-type') ?? ''
  return ct.includes('application/json') ? res.json() : ({} as T)
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function pingApi(cfg: TodoApiConfig): Promise<{ ok: boolean; message: string }> {
  try {
    await apiFetch(cfg, 'GET', '/ping')
    return { ok: true, message: '连接成功' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

// ─── Full data load ────────────────────────────────────────────────────────────

export interface TodoRemoteData {
  projects: TodoProject[]
  tasks:    TodoTask[]
}

export async function apiLoadAll(cfg: TodoApiConfig): Promise<TodoRemoteData> {
  return apiFetch<TodoRemoteData>(cfg, 'GET', '/data')
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function apiCreateProject(cfg: TodoApiConfig, p: TodoProject): Promise<TodoProject> {
  return apiFetch<TodoProject>(cfg, 'POST', '/projects', p)
}

export async function apiUpdateProject(cfg: TodoApiConfig, p: TodoProject): Promise<void> {
  return apiFetch(cfg, 'PUT', `/projects/${p.id}`, p)
}

export async function apiDeleteProject(cfg: TodoApiConfig, id: string): Promise<void> {
  return apiFetch(cfg, 'DELETE', `/projects/${id}`)
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function apiCreateTask(cfg: TodoApiConfig, t: TodoTask): Promise<TodoTask> {
  return apiFetch<TodoTask>(cfg, 'POST', '/tasks', t)
}

export async function apiUpdateTask(cfg: TodoApiConfig, t: TodoTask): Promise<void> {
  return apiFetch(cfg, 'PUT', `/tasks/${t.id}`, t)
}

export async function apiDeleteTask(cfg: TodoApiConfig, id: string): Promise<void> {
  return apiFetch(cfg, 'DELETE', `/tasks/${id}`)
}
