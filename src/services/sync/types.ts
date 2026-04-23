/**
 * SyncModule interface — every app module that wants to sync registers itself
 * with the central sync service via this contract.
 *
 * The service is responsible for:
 *   • scheduling & orchestration (manifest, timestamps, auto-sync)
 *   • providing common WebDAV + crypto helpers via SyncContext
 *
 * The module is responsible for:
 *   • deciding whether local data changed (getLocalTimestamp)
 *   • performing its own bidirectional sync (sync)
 *   • refreshing its UI after sync (onSynced)
 */

export interface SyncContext {
  /** Encryption / decryption password (re-uses the WebDAV password). */
  password: string

  /** Download a remote encrypted file and decrypt it. Returns *fallback* on 404 or corruption. */
  getEncrypted<T>(path: string, fallback: T): Promise<T>

  /** Encrypt *data* and upload it to *path*. Throws on HTTP error. */
  putEncrypted(path: string, data: unknown): Promise<void>

  /** DELETE a remote resource. Silently ignores 404. */
  webdavDelete(path: string): Promise<void>

  /** Raw GET. Returns `{ ok: false, body: '' }` on 404. */
  webdavGet(path: string): Promise<{ ok: boolean; body: string }>

  /** Decrypt a raw encrypted body. */
  decrypt(body: string): Promise<string>

  /** Resolve a filename against the configured remote base path. */
  rp(filename: string): string

  /** Update the visible progress text in the UI. */
  setProgress(text: string): void
}

export interface SyncModule {
  /** Unique module id — used in the manifest and local sync record. */
  id: string

  /** Remote directory names this module needs (e.g. ['settings', 'conversations']).
   *  The sync service creates them with MKCOL before the first module sync. */
  remoteDirs: string[]

  /** ISO timestamp of the last local modification. */
  getLocalTimestamp(): string | Promise<string>

  /**
   * Perform bidirectional sync for this module.
   *
   * @param ctx          Common helpers (WebDAV + crypto).
   * @param localChanged true when the local data was modified since the last
   *                     successful sync. When false the module should still
   *                     *pull* remote changes, but can skip the *push* step.
   */
  sync(ctx: SyncContext, localChanged: boolean): Promise<void>

  /** Called after *all* modules have finished syncing successfully.
   *  Use this to reload store data so the UI reflects synced changes. */
  onSynced?(): Promise<void>
}
