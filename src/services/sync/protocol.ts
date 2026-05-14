/**
 * Unified sync protocol types — shared across all sync modules.
 *
 * All modules use the same request/response shape:
 *
 * Request:  POST /api/sync/{module}
 *   { since, changes: { upserts, deletes }, manifest? }
 *
 * Response:
 *   { mergedItems, deletedIds, tombstones, syncedAt, serverChanges }
 *
 * The legacy response shape { merged, tombstones, syncedAt } is still handled
 * in syncEngine.ts for backward compatibility with older server versions.
 */

/** Every entity in the sync system carries these fields. */
export interface SyncItem {
  id: string
  _version?: number
  updatedAt?: string
  deletedAt?: string
  [key: string]: unknown
}

export interface Tombstone {
  id: string
  tableName: string
  deletedAt: string
}

export interface Changeset {
  upserts: SyncItem[]
  deletes: Array<{ id: string; deletedAt: string }>
}

/** Lightweight manifest entry — only metadata, no payload. */
export interface ManifestItem {
  id: string
  updatedAt?: string
  _version?: number
}

/** Unified request body for POST /api/sync/{module}. */
export interface SyncRequest {
  since: string | null
  changes: Changeset
  /** Present for manifest-based modules; absent for legacy full-state modules. */
  manifest?: ManifestItem[]
}

/** Unified response from POST /api/sync/{module}. */
export interface SyncResponse {
  /** Items the client should upsert locally. */
  mergedItems: SyncItem[]
  /** IDs the client should delete locally. */
  deletedIds: string[]
  tombstones: Tombstone[]
  syncedAt: string
  serverChanges: Changeset
}

/** Per-category settings item sent to / received from server. */
export interface SettingsSyncItem extends SyncItem {
  /** The actual settings data for this category. */
  value: Record<string, unknown>
}
