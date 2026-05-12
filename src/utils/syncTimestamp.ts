/**
 * Module-level sync timestamp tracking.
 *
 * Modules call recordSyncTimestamp() after a successful sync.
 * syncManager flushes pending timestamps to localStorage in syncAllFromServer.
 */

const _pendingSyncTs: Record<string, string> = {}

export function recordSyncTimestamp(module: string, ts: string) {
  _pendingSyncTs[module] = ts
}

export function getPendingSyncTimestamps(): Record<string, string> {
  return { ..._pendingSyncTs }
}

export function clearPendingSyncTimestamps() {
  for (const key of Object.keys(_pendingSyncTs)) {
    delete _pendingSyncTs[key]
  }
}

export function getLocalSyncTs(module: string): string | null {
  return localStorage.getItem(`muse-sync-ts-${module}`)
}

export function setLocalSyncTs(module: string, ts: string) {
  localStorage.setItem(`muse-sync-ts-${module}`, ts)
}
