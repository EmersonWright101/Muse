import { reactive } from 'vue'

export type SyncState = 'idle' | 'syncing' | 'done' | 'not_configured'

export const syncStatus = reactive({
  state: 'idle' as SyncState,
  lastSyncAt: null as string | null,
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

/** Call when a backend operation finishes. Shows 'done' only when all ops complete. */
export function endSyncOp() {
  _activeOps = Math.max(0, _activeOps - 1)
  if (_activeOps === 0 && syncStatus.state === 'syncing') {
    syncStatus.state = 'done'
    syncStatus.lastSyncAt = new Date().toISOString()
  }
}
