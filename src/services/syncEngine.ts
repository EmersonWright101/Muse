/**
 * 统一同步引擎
 *
 * 职责：
 * 1. 收集本地变更（基于 manifest 对比）
 * 2. 上传 changeset + manifest 到后端
 * 3. 接收合并结果（mergedItems + deletedIds）
 * 4. 用合并结果增量更新本地状态
 *
 * 原则：前端不做任何合并/去重/冲突解决，只负责收集变更和展示结果。
 * 所有模块均使用 manifest-based 协议，无 legacy 全量同步路径。
 */

import { apiPost, isBackendConfigured, ApiError } from './api'
import { enqueueOffline } from './offlineQueue'
import {
  getSyncCursor,
  setSyncCursor,
  getTombstonesFromState,
  setTombstonesToState,
  clearAllSyncState,
} from './sync/state'

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
  manifest: LightweightItem[]
  changes: Changeset
  since: string | null
}

export interface SyncResponse {
  mergedItems: any[]
  deletedIds: string[]
  tombstones: Array<{ id: string; tableName: string; deletedAt: string }>
  syncedAt: string
  serverChanges: Changeset
}

export interface SyncModule<T> {
  name: string
  /** 获取当前完整状态 */
  getState: () => Promise<T> | T
  /** 获取当前轻量清单（id + updatedAt + _version） */
  getManifest: () => Promise<LightweightItem[]> | LightweightItem[]
  /** 增量保存同步后的状态（仅覆盖变化的 + 删除标记的） */
  applyIncrementalState: (mergedItems: T, deletedIds: string[]) => Promise<void>
  /** 序列化（可返回 Promise，例如需要上传附件或加密） */
  serialize: (state: T) => any | Promise<any>
  /** 反序列化（可返回 Promise，例如需要下载附件或解密） */
  deserialize: (raw: any) => T | Promise<T>
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

// ─── Changeset 计算工具 ───────────────────────────────────────────────────────

/**
 * 基于轻量清单（manifest）计算 changeset。
 * 对比 currentManifest 和 previousManifest，仅对真正变化的项收集完整数据。
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

// ─── 主同步函数 ──────────────────────────────────────────────────────────────

export async function syncModule(moduleName: string): Promise<boolean> {
  if (!isBackendConfigured()) return false

  const existing = _syncLocks.get(moduleName)
  if (existing) {
    console.log(`[SyncEngine] ${moduleName} sync already in progress, waiting...`)
    await existing
    return true
  }

  const releaseLock = acquireSyncLock(moduleName)

  try {
    const mod = _modules.get(moduleName)
    if (!mod) {
      console.error(`[SyncEngine] Unknown module: ${moduleName}`)
      return false
    }

    // 1. 获取清单、游标和 tombstones
    const currentState = await mod.getState()
    const since = await getSyncCursor(moduleName)
    const tombstones = await getTombstonesFromState(moduleName)

    const manifest = await mod.getManifest()
    const previousManifest = getLastSyncedManifest(moduleName) ?? []
    const { changes } = computeLightweightChangeset(
      manifest,
      previousManifest,
      Array.isArray(currentState) ? currentState : [currentState] as any,
      tombstones,
    )

    // 2. 序列化（加密等）仅作用于 upserts
    const serializedUpserts = Array.isArray(currentState)
      ? await mod.serialize(changes.upserts as any)
      : changes.upserts

    const requestBody: SyncRequest = {
      manifest,
      changes: { upserts: serializedUpserts, deletes: changes.deletes },
      since,
    }

    // 3. 发送同步请求（带指数退避重试）
    let lastError: unknown
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await apiPost<SyncResponse>(`/api/sync/${moduleName}`, requestBody)

        if (!response) {
          console.warn(`[SyncEngine] ${moduleName} sync returned null`)
          return false
        }

        // 4. 增量应用合并结果
        const mergedItems = await mod.deserialize(response.mergedItems ?? [])
        await mod.applyIncrementalState(mergedItems, response.deletedIds ?? [])
        saveLastSyncedManifest(moduleName, manifest)

        // 5. 保存 tombstones
        if (response.tombstones && response.tombstones.length > 0) {
          const existing = await getTombstonesFromState(moduleName)
          for (const t of response.tombstones) {
            existing[t.id] = t.deletedAt
          }
          await setTombstonesToState(moduleName, existing)
        }

        // 6. 记录同步游标
        await setSyncCursor(moduleName, response.syncedAt)

        return true
      } catch (err) {
        lastError = err
        const isNetworkError = err instanceof ApiError && err.status === 0
        if (isNetworkError) {
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

// ─── Manifest 快照（localStorage） ───────────────────────────────────────────

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

// ─── Tombstone re-exports（向后兼容别名） ─────────────────────────────────────

export {
  getTombstonesFromState as getTombstones,
  setTombstonesToState as setTombstones,
} from './sync/state'

/** 清除某个模块的同步状态（用于强制全量同步） */
export async function clearSyncState(module: string): Promise<void> {
  await clearAllSyncState(module)
  localStorage.removeItem(`muse-sync-manifest-${module}`)
}
