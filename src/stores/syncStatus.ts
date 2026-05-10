import { reactive } from 'vue'

export type SyncState = 'idle' | 'syncing' | 'done' | 'error' | 'not_configured'

export const syncStatus = reactive({
  state: 'idle' as SyncState,
  currentModule: null as string | null,
  lastSyncAt: null as string | null,
  lastError: null as string | null,
})

let _activeOps = 0

export function setSyncState(state: SyncState) {
  syncStatus.state = state
  if (state === 'done') {
    syncStatus.lastSyncAt = new Date().toISOString()
  }
}

/** Call before any backend operation. Immediately shows 'syncing'. */
export function beginSyncOp() {
  _activeOps++
  if (syncStatus.state !== 'not_configured') {
    syncStatus.state = 'syncing'
  }
}

/** Set the currently syncing module name (e.g. '对话', '旅行笔记'). */
export function setSyncModule(name: string | null) {
  syncStatus.currentModule = name
}

/** Call when a backend operation finishes successfully. Shows 'done' only when all ops complete. */
export function endSyncOp() {
  _activeOps = Math.max(0, _activeOps - 1)
  if (_activeOps === 0 && syncStatus.state === 'syncing') {
    syncStatus.state = 'done'
    syncStatus.currentModule = null
    syncStatus.lastSyncAt = new Date().toISOString()
  }
}

/** Call when a backend operation fails. Immediately shows 'error'. */
export function failSyncOp(err?: unknown) {
  _activeOps = Math.max(0, _activeOps - 1)
  syncStatus.state = 'error'
  syncStatus.currentModule = null
  syncStatus.lastError = err instanceof Error ? err.message : String(err ?? 'Unknown error')
}
