/**
 * 全局离线同步队列
 *
 * 原理：
 * 1. 当 syncModule() 因网络错误（status === 0）失败时，将操作入队
 * 2. 监听网络恢复事件（online event + 定时 ping）
 * 3. 网络恢复后，按 FIFO 顺序排空队列
 * 4. 队列持久化到 localStorage，应用重启后保留
 */

import { syncModule } from './syncEngine'

export interface QueuedOperation {
  id: string           // 唯一标识，用于去重
  module: string       // 模块名
  timestamp: number    // 入队时间
  retryCount: number   // 重试次数
  lastError?: string   // 上次错误信息
}

const LS_QUEUE_KEY = 'muse-offline-sync-queue'
const MAX_RETRIES = 10
const PING_INTERVAL_MS = 30000  // 30秒检测一次网络
const PING_URL = 'https://www.google.com/generate_204'

let _queue: QueuedOperation[] = []
let _pingTimer: ReturnType<typeof setInterval> | null = null
let _isDraining = false

// ─── localStorage 持久化 ─────────────────────────────────────────────────────

function loadQueue(): QueuedOperation[] {
  try {
    const raw = localStorage.getItem(LS_QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch { /* ignore */ }
  return []
}

function saveQueue(): void {
  try {
    localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(_queue))
  } catch {
    console.warn('[OfflineQueue] Failed to persist queue')
  }
}

function ensureLoaded(): void {
  if (_queue.length === 0) {
    _queue = loadQueue()
  }
}

// ─── 队列操作 ─────────────────────────────────────────────────────────────────

/**
 * 将模块同步操作入队。同一模块在短时间内多次入队时会合并（去重）。
 */
export function enqueueOffline(module: string): void {
  ensureLoaded()

  const existingIndex = _queue.findIndex(op => op.module === module)
  const now = Date.now()

  if (existingIndex !== -1) {
    // 合并：更新已存在的同模块操作
    const existing = _queue[existingIndex]
    existing.timestamp = now
    existing.retryCount = 0
    existing.lastError = undefined
    // 移到队尾以保持 FIFO 顺序
    _queue.splice(existingIndex, 1)
    _queue.push(existing)
  } else {
    _queue.push({
      id: `${module}-${now}-${Math.random().toString(36).slice(2, 8)}`,
      module,
      timestamp: now,
      retryCount: 0,
    })
  }

  saveQueue()
  console.log(`[OfflineQueue] Enqueued ${module}, queue size: ${_queue.length}`)
}

/**
 * 根据操作 ID 移除指定操作。
 */
export function dequeueOffline(opId: string): void {
  ensureLoaded()
  _queue = _queue.filter(op => op.id !== opId)
  saveQueue()
}

/**
 * 获取当前队列副本。
 */
export function getOfflineQueue(): QueuedOperation[] {
  ensureLoaded()
  return [..._queue]
}

/**
 * 清空队列。
 */
export function clearOfflineQueue(): void {
  _queue = []
  saveQueue()
  console.log('[OfflineQueue] Queue cleared')
}

// ─── 网络状态检测 ─────────────────────────────────────────────────────────────

function isOnline(): boolean {
  return navigator.onLine
}

async function pingNetwork(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    await fetch(PING_URL, { method: 'HEAD', mode: 'no-cors', signal: controller.signal })
    clearTimeout(timeout)
    return true
  } catch {
    return false
  }
}

async function checkNetworkAndDrain(): Promise<void> {
  if (!isOnline()) return
  const reachable = await pingNetwork()
  if (reachable && _queue.length > 0 && !_isDraining) {
    console.log('[OfflineQueue] Network reachable, draining queue...')
    await drainOfflineQueue()
  }
}

/**
 * 启动网络监听（online 事件 + 定时 ping）。
 */
export function startNetworkMonitor(): void {
  if (_pingTimer) return
  _pingTimer = setInterval(() => {
    checkNetworkAndDrain().catch(console.error)
  }, PING_INTERVAL_MS)
  console.log('[OfflineQueue] Network monitor started')
}

/**
 * 停止网络监听。
 */
export function stopNetworkMonitor(): void {
  if (_pingTimer) {
    clearInterval(_pingTimer)
    _pingTimer = null
    console.log('[OfflineQueue] Network monitor stopped')
  }
}

// ─── 排空队列 ─────────────────────────────────────────────────────────────────

function showFailureToast(message: string): void {
  const toast = document.createElement('div')
  toast.textContent = message
  toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#ff3b30;color:#fff;padding:10px 20px;border-radius:8px;z-index:99999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:none;white-space:nowrap;'
  document.body.appendChild(toast)
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease'
    toast.style.opacity = '0'
    setTimeout(() => toast.remove(), 300)
  }, 4000)
}

/**
 * 按 FIFO 顺序排空离线队列。每个模块顺序执行，避免并发冲突。
 */
export async function drainOfflineQueue(): Promise<void> {
  ensureLoaded()

  if (_queue.length === 0) return
  if (_isDraining) {
    console.log('[OfflineQueue] Drain already in progress, skipping')
    return
  }

  _isDraining = true
  console.log(`[OfflineQueue] Draining ${_queue.length} operations...`)

  // 按入队顺序复制一份，避免迭代过程中被修改
  const ops = [..._queue]

  for (const op of ops) {
    // 跳过已被移除的操作
    if (!_queue.find(q => q.id === op.id)) continue

    try {
      console.log(`[OfflineQueue] Retrying ${op.module} (attempt ${op.retryCount + 1})`)
      const success = await syncModule(op.module)

      if (success) {
        // 同步成功，移除操作
        _queue = _queue.filter(q => q.id !== op.id)
        saveQueue()
        console.log(`[OfflineQueue] ${op.module} synced successfully`)
      } else {
        // syncModule 返回 false（非网络错误导致），可能是配置问题
        op.retryCount++
        op.lastError = 'syncModule returned false'
        if (op.retryCount >= MAX_RETRIES) {
          _queue = _queue.filter(q => q.id !== op.id)
          saveQueue()
          console.error(`[OfflineQueue] ${op.module} exceeded max retries, removed from queue`)
          showFailureToast(`同步失败：${op.module} 操作已超过最大重试次数`)
        } else {
          saveQueue()
        }
      }
    } catch (err) {
      op.retryCount++
      op.lastError = err instanceof Error ? err.message : String(err)

      if (op.retryCount >= MAX_RETRIES) {
        _queue = _queue.filter(q => q.id !== op.id)
        saveQueue()
        console.error(`[OfflineQueue] ${op.module} exceeded max retries:`, err)
        showFailureToast(`同步失败：${op.module} 操作已超过最大重试次数`)
      } else {
        saveQueue()
        console.warn(`[OfflineQueue] ${op.module} retry ${op.retryCount}/${MAX_RETRIES} failed:`, err)
      }
    }
  }

  _isDraining = false
  console.log(`[OfflineQueue] Drain complete. Remaining: ${_queue.length}`)
}
