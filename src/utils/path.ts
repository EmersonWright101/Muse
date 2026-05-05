/**
 * Global data path management.
 *
 * Users can configure a custom root directory in General Settings.
 * If not set, defaults to {appLocalDataDir}/muse.
 *
 * Sub-folders:
 *   conversations/  — chat data
 *   travel_notes/   — travel markdown files
 *   assistants.json — AI assistants
 *   stats-cache.json — statistics cache
 */

import { appLocalDataDir } from '@tauri-apps/api/path'
import { readDir, mkdir, copyFile, remove, exists, stat } from '@tauri-apps/plugin-fs'

const LS_DATA_PATH_KEY = 'muse-data-path'

// Only these entries are owned by the app and safe to migrate / delete
const APP_ENTRIES = new Set([
  'conversations',
  'travel_notes',
  'home_posters',
  'todos',
  'assistants.json',
  'stats-cache.json',
  'copilot-stats.json',
  'poster-stats.json',
])

let _cachedRoot: string | null = null

export function getDataRoot(): string | null {
  const custom = localStorage.getItem(LS_DATA_PATH_KEY)
  if (custom) return custom.replace(/[/\\]+$/, '')
  return _cachedRoot
}

export function setDataRoot(path: string | null): void {
  if (path) {
    localStorage.setItem(LS_DATA_PATH_KEY, path.replace(/[/\\]+$/, ''))
  } else {
    localStorage.removeItem(LS_DATA_PATH_KEY)
  }
}

export async function resolveDataRoot(): Promise<string> {
  const custom = getDataRoot()
  if (custom) return custom
  if (!_cachedRoot) {
    const base = await appLocalDataDir()
    _cachedRoot = base.replace(/[/\\]+$/, '') + '/muse'
  }
  return _cachedRoot
}

export async function getDefaultDataRoot(): Promise<string> {
  const base = await appLocalDataDir()
  return base.replace(/[/\\]+$/, '') + '/muse'
}

export async function conversationsDir(): Promise<string> {
  return `${await resolveDataRoot()}/conversations`
}

export async function travelNotesDir(): Promise<string> {
  return `${await resolveDataRoot()}/travel_notes`
}

export async function homePostersDir(): Promise<string> {
  return `${await resolveDataRoot()}/home_posters`
}

export async function tmpDir(): Promise<string> {
  return `${await resolveDataRoot()}/tmp`
}

export async function cleanupTmpDir(maxAgeDays = 7): Promise<void> {
  const dir = await tmpDir()
  if (!(await exists(dir))) return

  const now = Date.now()
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000

  const entries = await readDir(dir)
  for (const entry of entries) {
    if (!entry.isFile) continue
    const filePath = `${dir}/${entry.name}`
    try {
      const meta = await stat(filePath)
      const mtime = meta.mtime instanceof Date ? meta.mtime.getTime() : Number(meta.mtime)
      if (mtime && now - mtime > maxAgeMs) {
        await remove(filePath)
      }
    } catch { /* ignore individual file errors */ }
  }
}

// ─── Safety helpers ──────────────────────────────────────────────────────────

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

function isSafeToDelete(root: string): boolean {
  const n = normalizePath(root)
  // Never delete root or system directories
  if (n === '' || n === '/') return false
  if (n === '/Users' || n === '/home') return false
  if (n === '/Applications' || n === '/System' || n === '/Library') return false
  if (n === '/Volumes' || n === '/private') return false
  // Never delete a user home directory
  if (/^\/Users\/[^/]+$/.test(n)) return false
  if (/^\/home\/[^/]+$/.test(n)) return false
  return true
}

function wouldCauseCycle(oldRoot: string, newRoot: string): boolean {
  const oldN = normalizePath(oldRoot)
  const newN = normalizePath(newRoot)
  return newN === oldN || newN.startsWith(oldN + '/')
}

// ─── Data migration ──────────────────────────────────────────────────────────

async function copyAppEntries(src: string, dest: string): Promise<void> {
  if (!(await exists(dest))) {
    await mkdir(dest, { recursive: true })
  }
  const entries = await readDir(src)
  for (const entry of entries) {
    if (!APP_ENTRIES.has(entry.name)) continue
    if (entry.name === '.DS_Store') continue
    const srcPath = `${src}/${entry.name}`
    const destPath = `${dest}/${entry.name}`
    if (entry.isDirectory) {
      await copyRecursive(srcPath, destPath)
    } else if (entry.isFile) {
      await copyFile(srcPath, destPath)
    }
  }
}

async function copyRecursive(src: string, dest: string): Promise<void> {
  if (!(await exists(dest))) {
    await mkdir(dest, { recursive: true })
  }
  const entries = await readDir(src)
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue
    const srcPath = `${src}/${entry.name}`
    const destPath = `${dest}/${entry.name}`
    if (entry.isDirectory) {
      await copyRecursive(srcPath, destPath)
    } else if (entry.isFile) {
      await copyFile(srcPath, destPath)
    }
  }
}

async function removeAppEntries(root: string): Promise<void> {
  const entries = await readDir(root)
  for (const entry of entries) {
    if (!APP_ENTRIES.has(entry.name)) continue
    const p = `${root}/${entry.name}`
    try {
      await remove(p, { recursive: true })
    } catch {
      // ignore individual removal failures
    }
  }
}

export async function migrateData(oldRoot: string, newRoot: string): Promise<void> {
  if (oldRoot === newRoot) return
  if (!(await exists(oldRoot))) return

  if (!isSafeToDelete(oldRoot)) {
    throw new Error('Unsafe path: refusing to migrate from ' + oldRoot)
  }
  if (wouldCauseCycle(oldRoot, newRoot)) {
    throw new Error('New path cannot be inside the old path')
  }

  try {
    // Only copy entries that belong to the app
    await copyAppEntries(oldRoot, newRoot)
    // Only remove entries that belong to the app
    await removeAppEntries(oldRoot)
  } catch (e) {
    console.error('Migration failed:', e)
    throw e
  }
}
