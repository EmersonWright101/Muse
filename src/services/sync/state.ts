/**
 * File-based sync state storage.
 *
 * Replaces localStorage for sync cursors (since timestamps) and tombstone caches.
 * localStorage can be cleared accidentally; file storage is more durable and not
 * subject to browser storage quotas or privacy-mode restrictions.
 *
 * Layout inside {dataDir}/sync/:
 *   cursors.json     — { [module]: ISO timestamp }
 *   tombstones/
 *     [module].json  — { [id]: ISO timestamp }
 *
 * Falls back to localStorage when file I/O fails (e.g. first run before data dir exists).
 */

import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs'
import { resolveDataRoot } from '../../utils/path'

const SYNC_DIR = 'sync'
const CURSORS_FILE = 'cursors.json'
const TOMBSTONES_SUBDIR = 'tombstones'

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _syncDir(): Promise<string> {
  const root = await resolveDataRoot()
  const dir = `${root}/${SYNC_DIR}`
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

async function _tombstonesDir(): Promise<string> {
  const dir = await _syncDir()
  const sub = `${dir}/${TOMBSTONES_SUBDIR}`
  if (!(await exists(sub))) await mkdir(sub, { recursive: true })
  return sub
}

async function _readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    if (!(await exists(path))) return fallback
    return JSON.parse(await readTextFile(path)) as T
  } catch {
    return fallback
  }
}

async function _writeJson(path: string, data: unknown): Promise<void> {
  await writeTextFile(path, JSON.stringify(data, null, 2))
}

// ─── Sync cursors (since timestamps) ─────────────────────────────────────────

let _cursorsCache: Record<string, string> | null = null

async function _loadCursors(): Promise<Record<string, string>> {
  if (_cursorsCache) return _cursorsCache
  try {
    const dir = await _syncDir()
    const data = await _readJson<Record<string, string>>(`${dir}/${CURSORS_FILE}`, {})
    // Merge with any values still in localStorage (migration path)
    const lsKeys = Object.keys(localStorage)
      .filter(k => k.startsWith('muse-sync-since-'))
    for (const k of lsKeys) {
      const module = k.replace('muse-sync-since-', '')
      if (!data[module]) {
        const val = localStorage.getItem(k)
        if (val) data[module] = val
      }
    }
    _cursorsCache = data
    return data
  } catch {
    // Fallback: read from localStorage
    const result: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith('muse-sync-since-')) {
        const module = k.replace('muse-sync-since-', '')
        result[module] = localStorage.getItem(k) ?? ''
      }
    }
    _cursorsCache = result
    return result
  }
}

async function _saveCursors(cursors: Record<string, string>): Promise<void> {
  _cursorsCache = cursors
  try {
    const dir = await _syncDir()
    await _writeJson(`${dir}/${CURSORS_FILE}`, cursors)
    // Clean up localStorage mirrors
    for (const module of Object.keys(cursors)) {
      localStorage.removeItem(`muse-sync-since-${module}`)
    }
  } catch {
    // Fallback: keep in localStorage
    for (const [module, ts] of Object.entries(cursors)) {
      localStorage.setItem(`muse-sync-since-${module}`, ts)
    }
  }
}

export async function getSyncCursor(module: string): Promise<string | null> {
  const cursors = await _loadCursors()
  return cursors[module] ?? localStorage.getItem(`muse-sync-since-${module}`)
}

export async function setSyncCursor(module: string, ts: string): Promise<void> {
  const cursors = await _loadCursors()
  cursors[module] = ts
  await _saveCursors(cursors)
}

export async function clearSyncCursor(module: string): Promise<void> {
  const cursors = await _loadCursors()
  delete cursors[module]
  await _saveCursors(cursors)
  localStorage.removeItem(`muse-sync-since-${module}`)
}

// ─── Tombstone cache ──────────────────────────────────────────────────────────

export async function getTombstonesFromState(module: string): Promise<Record<string, string>> {
  try {
    const dir = await _tombstonesDir()
    const data = await _readJson<Record<string, string>>(`${dir}/${module}.json`, {})
    if (Object.keys(data).length > 0) return data
    // Migrate from localStorage
    const ls = _lsGetTombstones(module)
    if (Object.keys(ls).length > 0) {
      await setTombstonesToState(module, ls)
      localStorage.removeItem(`muse-sync-tombstones-${module}`)
    }
    return ls
  } catch {
    return _lsGetTombstones(module)
  }
}

export async function setTombstonesToState(module: string, map: Record<string, string>): Promise<void> {
  try {
    const dir = await _tombstonesDir()
    await _writeJson(`${dir}/${module}.json`, map)
  } catch {
    localStorage.setItem(`muse-sync-tombstones-${module}`, JSON.stringify(map))
  }
}

function _lsGetTombstones(module: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(`muse-sync-tombstones-${module}`) || '{}')
  } catch {
    return {}
  }
}

// ─── Full state clear (force re-sync) ────────────────────────────────────────

export async function clearAllSyncState(module: string): Promise<void> {
  await clearSyncCursor(module)
  localStorage.removeItem(`muse-sync-state-${module}`)
  localStorage.removeItem(`muse-sync-manifest-${module}`)
  localStorage.removeItem(`muse-sync-tombstones-${module}`)
  try {
    const dir = await _tombstonesDir()
    const { remove, exists: fsExists } = await import('@tauri-apps/plugin-fs')
    const p = `${dir}/${module}.json`
    if (await fsExists(p)) await remove(p)
  } catch { /* ignore */ }
}
