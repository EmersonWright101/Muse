import { reactive } from 'vue'

export type SyncState = 'idle' | 'syncing' | 'done' | 'not_configured'

export const syncStatus = reactive({
  state: 'idle' as SyncState,
  lastSyncAt: null as string | null,
})

export function setSyncState(state: SyncState) {
  syncStatus.state = state
  if (state === 'done') {
    syncStatus.lastSyncAt = new Date().toISOString()
  }
}
