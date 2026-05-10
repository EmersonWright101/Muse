import { reactive } from 'vue'

export type SyncState = 'idle' | 'syncing' | 'done' | 'error' | 'not_configured'

export const syncStatus = reactive({
  state: 'idle' as SyncState,
  currentModule: null as string | null,
  currentAction: null as string | null,
  lastSyncAt: null as string | null,
  lastError: null as string | null,
})

const _activeActions = new Set<string>()

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

/** Set a detailed action description (e.g. '正在拉取对话列表…'). */
export function setSyncAction(action: string | null) {
  if (action) {
    _activeActions.add(action)
  } else {
    _activeActions.clear()
  }
  syncStatus.currentAction = action
}

/** Add an active action to the set. */
export function addSyncAction(action: string) {
  _activeActions.add(action)
  updateActiveAction()
}

/** Remove an active action from the set. */
export function removeSyncAction(action: string) {
  _activeActions.delete(action)
  updateActiveAction()
}

function updateActiveAction() {
  const actions = Array.from(_activeActions)
  if (actions.length === 0) {
    syncStatus.currentAction = null
  } else if (actions.length === 1) {
    syncStatus.currentAction = actions[0]
  } else {
    syncStatus.currentAction = actions.join(' / ')
  }
}

/** Call when a backend operation finishes successfully. Shows 'done' only when all ops complete. */
export function endSyncOp() {
  _activeOps = Math.max(0, _activeOps - 1)
  if (_activeOps === 0 && syncStatus.state === 'syncing') {
    syncStatus.state = 'done'
    syncStatus.currentModule = null
    syncStatus.currentAction = null
    _activeActions.clear()
    syncStatus.lastSyncAt = new Date().toISOString()
  }
}

/** Call when a backend operation fails. Immediately shows 'error'. */
export function failSyncOp(err?: unknown) {
  _activeOps = Math.max(0, _activeOps - 1)
  syncStatus.state = 'error'
  syncStatus.currentModule = null
  syncStatus.currentAction = null
  _activeActions.clear()
  syncStatus.lastError = err instanceof Error ? err.message : String(err ?? 'Unknown error')
}
