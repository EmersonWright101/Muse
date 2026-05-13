/**
 * 统一同步引擎
 *
 * 职责：
 * 1. 收集本地变更（与上次同步状态对比）
 * 2. 上传 changeset 到后端
 * 3. 接收合并结果
 * 4. 用合并结果替换本地状态
 *
 * 原则：前端不做任何合并/去重/冲突解决，只负责收集变更和展示结果。
 */

import { apiPost, isBackendConfigured, ApiError } from './api'
import { enqueueOffline } from './offlineQueue'
import { readTextFile, writeTextFile, exists, mkdir, remove } from '@tauri-apps/plugin-fs'
import { resolveDataRoot } from '../utils/path'

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export interface Changeset {
  upserts: any[]
  deletes: Array<{ id: string; deletedAt: string }>
}

export interface LightweightItem {
  id: string
  updatedAt?: string
  _version?: number
}

export interface SyncRequest {
  clientState?: any
  manifest?: LightweightItem[]
  changes: Changeset
  since: string | null
}

export interface SyncResponse {
  merged?: any
  mergedItems?: any[]
  deletedIds?: string[]
  tombstones: Array<{ id: string; tableName: string; deletedAt: string }>
  syncedAt: string
  serverChanges: Changeset
}

export interface SyncModule<T> {
  name: string
  /** 获取当前完整状态 */
  getState: () => Promise<T> | T
  /** 获取当前轻量清单（id + updatedAt + _version）用于 manifest 模式 */
  getManifest?: () => Promise<LightweightItem[]> | LightweightItem[]
  /** 获取上次同步的状态（默认从 localStorage 读取） */
  getLastSyncedState: () => T | null
  /** 保存同步后的完整状态 */
  applyState: (state: T) => Promise<void>
  /** 增量保存同步后的状态（仅覆盖变化的 + 删除标记的） */
  applyIncrementalState?: (mergedItems: T, deletedIds: string[]) => Promise<void>
  /** 序列化（可返回 Promise，例如需要上传附件） */
  serialize: (state: T) => any | Promise<any>
  /** 反序列化（可返回 Promise，例如需要下载附件） */
  deserialize: (raw: any) => T | Promise<T>
  /** 可选：自定义 changeset 计算（用于非数组数据如 settings） */
  computeChangeset?: (current: T, previous: T | null) => Changeset
}

// ─── 模块注册表 ──────────────────────────────────────────────────────────────

const _modules = new Map<string, SyncModule<any>>()

export function registerSyncModule<T>(module: SyncModule<T>) {
  _modules.set(module.name, module)
}

export function getRegisteredModules(): string[] {
  return Array.from(_modules.keys())
}

// ─── 模块级同步锁 ─────────────────────────────────────────────────────────────

const _syncLocks = new Map<string, Promise<void>>()

function acquireSyncLock(moduleName: string): () => void {
  let resolveLock: () => void
  const lockPromise = new Promise<void>(resolve => { resolveLock = resolve })
  _syncLocks.set(moduleName, lockPromise)
  return () => {
    resolveLock()
    _syncLocks.delete(moduleName)
  }
}

// ─── 重试配置 ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3
const RETRY_DELAYS_MS = [1000, 2000, 4000]

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// ─── Changeset 计算 ──────────────────────────────────────────────────────────

/**
 * 计算数组类型数据的 changeset。
 * 已存在于 tombstones 中的删除不会重复上报。
 */
export function computeChangeset<T extends { id: string; updatedAt?: string }>(
  current: T[],
  previous: T[],
  tombstones?: Record<string, string>,
): Changeset {
  const prevMap = new Map(previous.map(p => [p.id, p]))
  const currMap = new Map(current.map(c => [c.id, c]))

  const upserts: T[] = []
  const deletes: Array<{ id: string; deletedAt: string }> = []

  for (const [id, curr] of currMap) {
    const prev = prevMap.get(id)
    if (!prev || JSON.stringify(prev) !== JSON.stringify(curr)) {
      upserts.push(curr)
    }
  }

  for (const [id] of prevMap) {
    if (!currMap.has(id)) {
      // 如果该 id 已被服务器确认删除（tombstone），不再重复上报
      if (tombstones?.[id]) continue
      deletes.push({ id, deletedAt: new Date().toISOString() })
    }
  }

  return { upserts, deletes }
}

/**
 * 从已同步的完整状态中提取轻量清单。
 */
function extractManifestFromState(state: any): LightweightItem[] {
  if (!Array.isArray(state)) return []
  return state.map((item: any) => ({
    id: item.id,
    updatedAt: item.updatedAt,
    _version: item._version,
  }))
}

/**
 * 基于轻量清单（manifest）计算 changeset。
 * 对比 currentManifest 和 previousManifest 的 updatedAt / _version，
 * 仅对真正变化的项收集完整数据。
 */
export function computeLightweightChangeset<T extends { id: string }>(
  currentManifest: LightweightItem[],
  previousManifest: LightweightItem[],
  currentFullItems: T[],
  tombstones?: Record<string, string>,
): { manifest: LightweightItem[]; changes: Changeset } {
  const prevMap = new Map(previousManifest.map(p => [p.id, p]))
  const fullMap = new Map(currentFullItems.map(c => [c.id, c]))

  const upserts: T[] = []
  const deletes: Array<{ id: string; deletedAt: string }> = []

  for (const curr of currentManifest) {
    const prev = prevMap.get(curr.id)
    let changed = !prev || prev.updatedAt !== curr.updatedAt
    if (!changed && prev!._version !== undefined && curr._version !== undefined && prev!._version !== curr._version) {
      changed = true
    }
    if (changed) {
      const full = fullMap.get(curr.id)
      if (full) upserts.push(full)
    }
  }

  for (const [id] of prevMap) {
    if (!currentManifest.find(m => m.id === id)) {
      if (tombstones?.[id]) continue
      deletes.push({ id, deletedAt: new Date().toISOString() })
    }
  }

  return { manifest: currentManifest, changes: { upserts, deletes } }
}

/**
 * 计算对象类型数据的 changeset。
 * 将整个对象作为一个 upsert 项（id 固定为 __root__）。
 */
export function computeObjectChangeset<T extends Record<string, any>>(
  current: T,
  previous: T | null,
): Changeset {
  if (!previous || JSON.stringify(current) !== JSON.stringify(previous)) {
    return { upserts: [{ id: '__root__', ...current }], deletes: [] }
  }
  return { upserts: [], deletes: [] }
}

// ─── 主同步函数 ──────────────────────────────────────────────────────────────

export async function syncModule(moduleName: string): Promise<boolean> {
  if (!isBackendConfigured()) return false

  // 检查是否有正在进行的同步
  const existing = _syncLocks.get(moduleName)
  if (existing) {
    console.log(`[SyncEngine] ${moduleName} sync already in progress, waiting...`)
    await existing
    return true // 等待完成后视为成功
  }

  const releaseLock = acquireSyncLock(moduleName)

  try {
    const mod = _modules.get(moduleName)
    if (!mod) {
      console.error(`[SyncEngine] Unknown module: ${moduleName}`)
      return false
    }

    // 1. 获取当前状态和上次同步状态
    const currentState = await mod.getState()
    const previousState = mod.getLastSyncedState()
    const since = localStorage.getItem(`muse-sync-since-${moduleName}`)
    const tombstones = await getTombstones(moduleName)

    // 判断是否使用 manifest 模式
    const supportsManifest = !!mod.getManifest && !!mod.applyIncrementalState
    let manifest: LightweightItem[] | undefined
    let changes: Changeset
    let requestBody: SyncRequest

    if (supportsManifest) {
      // Manifest 模式：构建轻量清单，仅收集变化的完整数据
      manifest = await mod.getManifest!()
      // Use the saved manifest from last sync (not previousState which is never written for manifest path)
      const previousManifest = getLastSyncedManifest(moduleName) ?? []
      const lightweightResult = computeLightweightChangeset(
        manifest,
        previousManifest,
        Array.isArray(currentState) ? currentState : [currentState] as any,
        tombstones,
      )
      changes = lightweightResult.changes

      // 仅序列化变化的 upserts
      const serializedUpserts = Array.isArray(currentState)
        ? await mod.serialize(changes.upserts as any)
        : changes.upserts

      requestBody = {
        manifest: lightweightResult.manifest,
        changes: { upserts: serializedUpserts, deletes: changes.deletes },
        since,
      }
    } else {
      // 传统模式：序列化完整状态
      const changeset = mod.computeChangeset
        ? mod.computeChangeset(currentState, previousState)
        : computeChangeset(
            Array.isArray(currentState) ? currentState : [currentState],
            Array.isArray(previousState) ? previousState : [],
            tombstones,
          )
      changes = changeset
      requestBody = {
        clientState: await mod.serialize(currentState),
        changes,
        since,
      }
    }

    // 2. 发送同步请求（带指数退避重试）
    let lastError: unknown
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await apiPost<SyncResponse>(`/api/sync/${moduleName}`, requestBody)

        if (!response) {
          console.warn(`[SyncEngine] ${moduleName} sync returned null`)
          return false
        }

        // 3. 应用合并结果到本地
        if (supportsManifest && response.mergedItems !== undefined) {
          // 增量 apply：仅覆盖变化的 + 删除标记的
          const mergedItems = await mod.deserialize(response.mergedItems)
          await mod.applyIncrementalState!(mergedItems, response.deletedIds || [])
          // 保存 manifest 快照用于下次对比
          if (manifest) saveLastSyncedManifest(moduleName, manifest)
        } else {
          // 全量 apply（向后兼容）
          const mergedRaw = unwrapMergedResponse(response.merged, moduleName)
          const mergedState = await mod.deserialize(mergedRaw)
          await mod.applyState(mergedState)
          saveLastSyncedState(moduleName, mergedRaw)
        }

        // 4. 保存 tombstones（记录服务器确认已删除的 ID）
        if (response.tombstones && response.tombstones.length > 0) {
          const existing = await getTombstones(moduleName)
          for (const t of response.tombstones) {
            existing[t.id] = t.deletedAt
          }
          await setTombstones(moduleName, existing)
        }

        // 5. 记录同步时间
        localStorage.setItem(`muse-sync-since-${moduleName}`, response.syncedAt)

        return true
      } catch (err) {
        lastError = err
        const isNetworkError = err instanceof ApiError && err.status === 0
        if (isNetworkError) {
          // 网络错误：入队离线队列，静默处理（用户无感知）
          enqueueOffline(moduleName)
          console.warn(`[SyncEngine] ${moduleName} network error, queued for retry`)
          return false
        }
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS_MS[attempt] ?? 4000
          console.warn(
            `[SyncEngine] ${moduleName} sync attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
          )
          await sleep(delay)
        }
      }
    }

    console.error(
      `[SyncEngine] ${moduleName} sync failed after ${MAX_RETRIES + 1} attempts:`,
      lastError,
    )
    throw lastError
  } finally {
    releaseLock()
  }
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

const OBJECT_MODULES = new Set(['settings', 'todo', 'ebook'])

function unwrapMergedResponse(raw: any, moduleName: string): any {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.items)) {
    return OBJECT_MODULES.has(moduleName) ? raw.items[0] : raw.items
  }
  return raw
}

const TOMBSTONES_DIR = 'sync-tombstones'

async function getTombstonesDir(): Promise<string> {
  const root = await resolveDataRoot()
  const dir = `${root}/${TOMBSTONES_DIR}`
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

async function readTombstonesFile(module: string): Promise<Record<string, string>> {
  try {
    const dir = await getTombstonesDir()
    const path = `${dir}/${module}.json`
    if (!(await exists(path))) return {}
    const raw = await readTextFile(path)
    return JSON.parse(raw) as Record<string, string>
  } catch {
    // 降级到 localStorage
    return getLocalTombstones(module)
  }
}

async function writeTombstonesFile(module: string, map: Record<string, string>): Promise<void> {
  try {
    const dir = await getTombstonesDir()
    const path = `${dir}/${module}.json`
    await writeTextFile(path, JSON.stringify(map, null, 2))
  } catch {
    // 降级到 localStorage
    setLocalTombstones(module, map)
  }
}

export async function getTombstones(module: string): Promise<Record<string, string>> {
  // 优先从磁盘读取，如果不存在则从 localStorage 读取并迁移到磁盘
  const disk = await readTombstonesFile(module)
  if (Object.keys(disk).length > 0) return disk

  // 从 localStorage 迁移
  const local = getLocalTombstones(module)
  if (Object.keys(local).length > 0) {
    await writeTombstonesFile(module, local)
    localStorage.removeItem(`muse-sync-tombstones-${module}`)
  }
  return local
}

export async function setTombstones(module: string, map: Record<string, string>): Promise<void> {
  await writeTombstonesFile(module, map)
}

export function getLocalTombstones(module: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(`muse-sync-tombstones-${module}`) || '{}')
  } catch {
    return {}
  }
}

export function setLocalTombstones(module: string, map: Record<string, string>) {
  localStorage.setItem(`muse-sync-tombstones-${module}`, JSON.stringify(map))
}

export function saveLastSyncedState(module: string, state: any) {
  localStorage.setItem(`muse-sync-state-${module}`, JSON.stringify(state))
}

export function getLastSyncedState(module: string): any | null {
  try {
    return JSON.parse(localStorage.getItem(`muse-sync-state-${module}`) || 'null')
  } catch {
    return null
  }
}

export function saveLastSyncedManifest(module: string, manifest: LightweightItem[]) {
  localStorage.setItem(`muse-sync-manifest-${module}`, JSON.stringify(manifest))
}

export function getLastSyncedManifest(module: string): LightweightItem[] | null {
  try {
    return JSON.parse(localStorage.getItem(`muse-sync-manifest-${module}`) || 'null')
  } catch {
    return null
  }
}

/** 清除某个模块的同步状态（用于强制全量同步） */
export async function clearSyncState(module: string): Promise<void> {
  localStorage.removeItem(`muse-sync-since-${module}`)
  localStorage.removeItem(`muse-sync-state-${module}`)
  localStorage.removeItem(`muse-sync-manifest-${module}`)
  localStorage.removeItem(`muse-sync-tombstones-${module}`)

  try {
    const dir = await getTombstonesDir()
    const path = `${dir}/${module}.json`
    if (await exists(path)) await remove(path)
  } catch {
    // ignore FS errors
  }
}
