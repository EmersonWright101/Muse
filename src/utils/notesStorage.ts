/**
 * Notes file-based storage.
 *
 * Each note is a Markdown file with YAML frontmatter.
 *
 * Frontmatter schema:
 *   id       : string (matches filename without .md)
 *   title    : string
 *   groupId  : string
 *   date     : string (ISO date)
 *   cover    : string (emoji or empty)
 *   tags     : string (comma-separated)
 *   createdAt: string (ISO)
 *   updatedAt: string (ISO)
 *
 * Example:
 *   ---
 *   id: abc-123
 *   title: My Note
 *   groupId: group-1
 *   date: 2024-03-15
 *   cover: 📝
 *   tags: idea,draft
 *   createdAt: 2024-03-15T10:00:00.000Z
 *   updatedAt: 2024-03-15T10:00:00.000Z
 *   ---
 *
 *   正文内容...
 */

import {
  readTextFile,
  writeTextFile,
  writeFile,
  readFile,
  exists,
  mkdir,
  remove,
  rename,
  readDir,
} from '@tauri-apps/plugin-fs'
import { ref } from 'vue'
import { notesDir } from './path'
import { apiPost, apiPut, apiDelete, apiPostForm, apiGetBinary, apiGet, isBackendConfigured } from '../services/api'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'

export interface NoteItem {
  id: string
  title: string
  groupId: string
  tags: string[]
  cover: string
  date: string
  content: string
  createdAt?: string
  updatedAt?: string
  deletedAt?: string
}

export interface NoteMeta {
  id: string
  title: string
  groupId: string
  tags: string[]
  cover: string
  date: string
  preview: string
  updatedAt: string
}

export interface NoteGroup {
  id: string
  name: string
  sortOrder: number
  createdAt?: string
  updatedAt?: string
}

export interface NoteTrashMeta extends NoteMeta {
  deletedAt: string
}

// ─── Frontmatter helpers ─────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { meta: Partial<NoteItem>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!match) {
    return { meta: { content: raw }, body: raw }
  }
  const yamlBlock = match[1]
  const body = match[2].trimStart()
  const meta: Partial<NoteItem> = { content: raw }

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const key = line.slice(0, colonIdx).trim()
    const val = line.slice(colonIdx + 1).trim()
    switch (key) {
      case 'id':        meta.id = val; break
      case 'title':     meta.title = val; break
      case 'groupId':   meta.groupId = val; break
      case 'date':      meta.date = val; break
      case 'cover':     meta.cover = val; break
      case 'tags':      meta.tags = val ? val.split(',').map(t => t.trim()).filter(Boolean) : []; break
      case 'createdAt': meta.createdAt = val; break
      case 'updatedAt': meta.updatedAt = val; break
      case 'deletedAt': meta.deletedAt = val; break
    }
  }
  if (!meta.tags) meta.tags = []
  return { meta, body }
}

function stringifyFrontmatter(note: NoteItem): string {
  const lines = [
    '---',
    `id: ${note.id}`,
    `title: ${note.title}`,
    `groupId: ${note.groupId ?? ''}`,
    `date: ${note.date}`,
    `cover: ${note.cover || ''}`,
    `tags: ${(note.tags ?? []).join(',')}`,
  ]
  if (note.createdAt) lines.push(`createdAt: ${note.createdAt}`)
  if (note.updatedAt) lines.push(`updatedAt: ${note.updatedAt}`)
  if (note.deletedAt) lines.push(`deletedAt: ${note.deletedAt}`)
  lines.push('---', '', note.content.replace(/^---[\s\S]*?---\s*\n?/, '').trimStart())
  return lines.join('\n')
}

function buildPreview(body: string): string {
  const firstLine = body.split('\n').find(l => l.trim()) ?? ''
  return firstLine.slice(0, 80).trim()
}

const LS_DELETED_NOTES_KEY = 'muse-deleted-notes'

export function getDeletedNotes(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_DELETED_NOTES_KEY) ?? '{}') } catch { return {} }
}

export function applyRemoteDeletedNotes(remote: Record<string, string>) {
  const local = getDeletedNotes()
  let changed = false
  for (const [id, ts] of Object.entries(remote)) {
    if (!local[id] || ts > local[id]) { local[id] = ts; changed = true }
  }
  if (changed) localStorage.setItem(LS_DELETED_NOTES_KEY, JSON.stringify(local))
}

const NOTE_EMOJIS = [
  '📝','📓','📔','📕','📗','📘','📙','📚','📖','🗒️',
  '✏️','🖊️','🖋️','✒️','🖌️','🖍️','💡','🔖','📌','📍',
  '📎','🗂️','📁','📂','🗃️','📊','📈','📉','🗞️','📰',
]

export function randomNoteEmoji(): string {
  return NOTE_EMOJIS[Math.floor(Math.random() * NOTE_EMOJIS.length)]
}

export function extractFirstImage(body: string): string | null {
  const m = body.match(/!\[.*?\]\((.*?)\)/)
  return m ? m[1] : null
}

export function extractNoteImageFilenames(content: string): string[] {
  const filenames = new Set<string>()
  const re = /!\[[^\]]*]\((?:\.\/)?images\/([^)\s]+)(?:\s+"[^"]*")?\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    if (m[1]) filenames.add(decodeURIComponent(m[1]))
  }
  return [...filenames]
}

function mimeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'avif') return 'image/avif'
  return 'image/png'
}

export async function cacheNoteImagesForContent(content: string): Promise<void> {
  await Promise.all(extractNoteImageFilenames(content).map(filename => fetchAndCacheNoteImage(filename)))
}

// In-memory guard to avoid re-uploading the same image in the same app session.
const _uploadedImages = new Set<string>()

export async function uploadReferencedNoteImages(note: NoteItem): Promise<void> {
  if (!isBackendConfigured()) return
  const dir = await notesDir()
  await Promise.all(extractNoteImageFilenames(note.content).map(async filename => {
    const cacheKey = `${note.id}:${filename}`
    if (_uploadedImages.has(cacheKey)) return
    try {
      const path = `${dir}/images/${filename}`
      if (!(await exists(path))) return
      const data = await readFile(path)
      await uploadNoteImage(filename, note.id, data, mimeFromFilename(filename))
      _uploadedImages.add(cacheKey)
    } catch { /* ignore individual image failures */ }
  }))
}

// ─── File helpers ────────────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  const d = await notesDir()
  if (!(await exists(d))) await mkdir(d, { recursive: true })
}

function notePath(id: string): Promise<string> {
  return notesDir().then(d => `${d}/${id}.md`)
}

// ─── Groups ──────────────────────────────────────────────────────────────────

const GROUPS_FILENAME = '.groups.json'

export async function loadGroups(): Promise<NoteGroup[]> {
  const dir = await notesDir()
  const path = `${dir}/${GROUPS_FILENAME}`
  try {
    if (!(await exists(path))) return []
    const raw = await readTextFile(path)
    const groups = JSON.parse(raw) as NoteGroup[]
    return Array.isArray(groups) ? groups : []
  } catch { return [] }
}

export async function listGroups(): Promise<NoteGroup[]> {
  return loadGroups()
}

export async function saveGroups(groups: NoteGroup[]): Promise<void> {
  await ensureDir()
  const dir = await notesDir()
  const path = `${dir}/${GROUPS_FILENAME}`
  await writeTextFile(path, JSON.stringify(groups, null, 2))
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function listNotes(): Promise<NoteMeta[]> {
  const dir = await notesDir()
  if (!(await exists(dir))) return []
  const entries = await readDir(dir)
  const notes: NoteMeta[] = []

  for (const entry of entries) {
    if (!entry.name?.endsWith('.md')) continue
    const id = entry.name.slice(0, -3)
    try {
      const raw = await readTextFile(`${dir}/${entry.name}`)
      const { meta, body } = parseFrontmatter(raw)
      const cover = extractFirstImage(body) || meta.cover || randomNoteEmoji()
      notes.push({
        id,
        title: meta.title ?? id,
        groupId: meta.groupId ?? '',
        tags: meta.tags ?? [],
        cover,
        date: meta.date ?? new Date().toISOString().slice(0, 10),
        preview: buildPreview(body),
        updatedAt: meta.updatedAt ?? meta.date ?? new Date().toISOString(),
      })
    } catch {
      // skip malformed files
    }
  }

  return notes.sort((a, b) => b.date.localeCompare(a.date))
}

export async function loadNote(id: string): Promise<NoteItem | null> {
  try {
    const path = await notePath(id)
    if (!(await exists(path))) return null
    const raw = await readTextFile(path)
    cacheNoteImagesForContent(raw).catch(() => {})
    const { meta, body } = parseFrontmatter(raw)
    const cover = extractFirstImage(body) || meta.cover || randomNoteEmoji()
    return {
      id,
      title: meta.title ?? id,
      groupId: meta.groupId ?? '',
      tags: meta.tags ?? [],
      cover,
      date: meta.date ?? new Date().toISOString().slice(0, 10),
      content: raw,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt ?? meta.date ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export async function saveNote(
  note: NoteItem,
  opts: { sync?: boolean; oldId?: string; preserveUpdatedAt?: boolean } = {},
): Promise<void> {
  await ensureDir()
  const path = await notePath(note.id)
  if (!opts.preserveUpdatedAt) note.updatedAt = new Date().toISOString()

  // Read old content to detect whether image references actually changed.
  let oldContent = ''
  const oldPath = opts.oldId ? await notePath(opts.oldId) : path
  try { if (await exists(oldPath)) oldContent = await readTextFile(oldPath) } catch { /* ignore */ }
  const oldImages = extractNoteImageFilenames(oldContent)
  const newImages = extractNoteImageFilenames(note.content)
  const imagesChanged =
    oldImages.length !== newImages.length ||
    !oldImages.every(img => newImages.includes(img))

  const tmp = `${path}.tmp`
  await writeTextFile(tmp, stringifyFrontmatter(note))
  await rename(tmp, path)

  if (opts.oldId && opts.oldId !== note.id) {
    try {
      const oldFile = await notePath(opts.oldId)
      if (await exists(oldFile)) await remove(oldFile)
    } catch { /* ignore */ }
  }

  localStorage.setItem('muse-ts-notes', new Date().toISOString())

  if (opts.sync !== false && isBackendConfigured()) {
    apiPut(`/api/notes/${note.id}`, {
      title: note.title,
      content: note.content,
      date: note.date,
      group_id: note.groupId,
      tags: note.tags ?? [],
      cover: note.cover,
      updated_at: note.updatedAt,
    }, {
      onConflict: async () => {
        const remote = await apiGet<NoteItem>(`/api/notes/${note.id}`)
        if (!remote) {
          return {
            title: note.title,
            content: note.content,
            date: note.date,
            group_id: note.groupId,
            tags: note.tags ?? [],
            cover: note.cover,
            updated_at: note.updatedAt,
          }
        }
        return {
          title: note.title || remote.title,
          content: note.content || remote.content,
          date: note.date || remote.date,
          group_id: note.groupId || remote.groupId,
          tags: note.tags ?? remote.tags ?? [],
          cover: note.cover || remote.cover,
          updated_at: new Date().toISOString(),
        }
      },
    }).catch(async (e: { status?: number }) => {
      if (e?.status === 404) {
        await apiPost('/api/notes', {
          id: note.id,
          title: note.title,
          content: note.content,
          date: note.date,
          group_id: note.groupId,
          tags: note.tags ?? [],
          cover: note.cover,
          updated_at: note.updatedAt,
        }).catch(() => {})
      }
    })
    if (imagesChanged) {
      uploadReferencedNoteImages(note).catch(() => {})
    }
  }
}

export async function deleteNoteLocalOnly(id: string, deletedAt?: string): Promise<void> {
  const note = await loadNote(id)
  if (note) {
    const images = extractNoteImageFilenames(note.content)
    for (const img of images) {
      await deleteAttachment(img).catch(() => {})
    }
  }
  try {
    const path = await notePath(id)
    if (await exists(path)) await remove(path)
  } catch { /* ignore */ }
  const map = getDeletedNotes()
  map[id] = deletedAt ?? new Date().toISOString()
  localStorage.setItem(LS_DELETED_NOTES_KEY, JSON.stringify(map))
  localStorage.setItem('muse-ts-notes', new Date().toISOString())
}

export async function deleteNote(id: string, opts: { sync?: boolean; deletedAt?: string } = {}): Promise<void> {
  await deleteNoteLocalOnly(id, opts.deletedAt)
  if (opts.sync !== false) apiDelete(`/api/notes/${id}`).catch(() => {})
}

// ─── Trash ───────────────────────────────────────────────────────────────────

const LS_TRASH_RETENTION = 'muse-trash-retention-days'

export function getTrashRetentionDays(): number {
  return parseInt(localStorage.getItem(LS_TRASH_RETENTION) ?? '30') || 30
}

export function setTrashRetentionDays(days: number): void {
  localStorage.setItem(LS_TRASH_RETENTION, String(days))
  localStorage.setItem('muse-trash-retention-modified-at', new Date().toISOString())
}

async function trashDir(): Promise<string> {
  const dir = await notesDir()
  return `${dir}/.trash`
}

async function ensureTrashDir(): Promise<void> {
  const d = await trashDir()
  if (!(await exists(d))) await mkdir(d, { recursive: true })
}

/** Move a note to the trash folder. Adds a tombstone to prevent sync re-download. */
export async function moveNoteToTrash(
  id: string,
  opts: { sync?: boolean; deletedAt?: string } = {},
): Promise<void> {
  const srcPath = await notePath(id)
  const deletedAt = opts.deletedAt ?? new Date().toISOString()

  if (await exists(srcPath)) {
    await ensureTrashDir()
    const trash = await trashDir()
    const dstPath = `${trash}/${id}.md`
    const note = await loadNote(id)
    if (note) {
      note.deletedAt = deletedAt
      const tmp = `${dstPath}.tmp`
      await writeTextFile(tmp, stringifyFrontmatter(note))
      await rename(tmp, dstPath)
    }
    await remove(srcPath)
  }

  const map = getDeletedNotes()
  map[id] = deletedAt
  localStorage.setItem(LS_DELETED_NOTES_KEY, JSON.stringify(map))
  localStorage.setItem('muse-ts-notes', new Date().toISOString())
  if (opts.sync !== false) apiDelete(`/api/notes/${id}`).catch(() => {})
}

/** List all notes currently in the trash folder. */
export async function listTrashItems(): Promise<NoteTrashMeta[]> {
  const dir = await trashDir()
  if (!(await exists(dir))) return []
  const entries = await readDir(dir)
  const items: NoteTrashMeta[] = []

  for (const entry of entries) {
    if (!entry.name?.endsWith('.md')) continue
    const id = entry.name.slice(0, -3)
    try {
      const raw = await readTextFile(`${dir}/${entry.name}`)
      const { meta, body } = parseFrontmatter(raw)
      const cover = extractFirstImage(body) || meta.cover || '🗑️'
      items.push({
        id,
        title: meta.title ?? id,
        groupId: meta.groupId ?? '',
        tags: meta.tags ?? [],
        cover,
        date: meta.date ?? '',
        preview: buildPreview(body),
        updatedAt: meta.updatedAt ?? '',
        deletedAt: meta.deletedAt ?? new Date().toISOString(),
      })
    } catch { /* skip malformed */ }
  }

  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Restore a note from trash back to the notes folder. Removes its tombstone. */
export async function restoreNoteFromTrash(id: string, opts: { sync?: boolean } = {}): Promise<void> {
  const dir = await trashDir()
  const srcPath = `${dir}/${id}.md`
  if (!(await exists(srcPath))) return

  const raw = await readTextFile(srcPath)
  const { meta } = parseFrontmatter(raw)

  const note: NoteItem = {
    id,
    title: meta.title ?? id,
    groupId: meta.groupId ?? '',
    tags: meta.tags ?? [],
    cover: meta.cover ?? '',
    date: meta.date ?? new Date().toISOString().slice(0, 10),
    content: raw,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  }

  await ensureDir()
  const dstPath = await notePath(id)
  const tmp = `${dstPath}.tmp`
  await writeTextFile(tmp, stringifyFrontmatter(note))
  await rename(tmp, dstPath)
  await remove(srcPath)

  const tombstones = getDeletedNotes()
  delete tombstones[id]
  localStorage.setItem(LS_DELETED_NOTES_KEY, JSON.stringify(tombstones))
  localStorage.setItem('muse-ts-notes', new Date().toISOString())
  if (opts.sync !== false) apiPost(`/api/notes/${id}/restore`, {}).catch(() => {})
}

/** Permanently delete a note from trash (tombstone already set by moveNoteToTrash). */
export async function permanentlyDeleteFromTrash(id: string, opts: { sync?: boolean } = {}): Promise<void> {
  const dir = await trashDir()
  const path = `${dir}/${id}.md`
  try {
    if (await exists(path)) await remove(path)
  } catch { /* ignore */ }
  if (opts.sync !== false) apiDelete(`/api/notes/${id}`).catch(() => {})
}

/** Delete all expired trash items based on retention setting. */
export async function purgeExpiredTrash(retentionDays: number): Promise<void> {
  if (retentionDays <= 0) return
  const dir = await trashDir()
  if (!(await exists(dir))) return
  const entries = await readDir(dir)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)
  for (const entry of entries) {
    if (!entry.name?.endsWith('.md')) continue
    try {
      const raw = await readTextFile(`${dir}/${entry.name}`)
      const { meta } = parseFrontmatter(raw)
      const deletedAt = meta.deletedAt ?? meta.updatedAt ?? new Date().toISOString()
      if (new Date(deletedAt) < cutoff) {
        await permanentlyDeleteFromTrash(entry.name.slice(0, -3))
      }
    } catch { /* skip malformed */ }
  }
}

/** Returns filenames (not paths) of image attachments not referenced in any note. */
export async function scanUnusedAttachments(): Promise<string[]> {
  const dir = await notesDir()
  const imgDir = `${dir}/images`
  if (!(await exists(imgDir))) return []

  const imgEntries = await readDir(imgDir)
  const IMAGE_EXTS = /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?)$/i
  const imageFiles = imgEntries
    .filter(e => e.name && !e.isDirectory && IMAGE_EXTS.test(e.name))
    .map(e => e.name!)

  if (imageFiles.length === 0) return []

  const noteEntries = await readDir(dir)
  let allContent = ''
  for (const entry of noteEntries) {
    if (!entry.name?.endsWith('.md')) continue
    try {
      const content = await readTextFile(`${dir}/${entry.name}`)
      allContent += content
    } catch { /* skip */ }
  }

  return imageFiles.filter(filename => !allContent.includes(filename))
}

export async function deleteAttachment(filename: string): Promise<void> {
  const dir = await notesDir()
  const filePath = `${dir}/images/${filename}`
  try {
    if (await exists(filePath)) await remove(filePath)
  } catch { /* ignore */ }
  apiDelete(`/api/notes/images/${encodeURIComponent(filename)}`).catch(() => {})
}

/**
 * Upload a note image to the backend and return its filename.
 * The local file is read from filePath; this is a background push.
 */
export async function uploadNoteImage(
  filename: string,
  noteId: string,
  data: Uint8Array,
  mimeType: string,
): Promise<void> {
  if (!isBackendConfigured()) return
  try {
    const form = new FormData()
    form.append('file', new Blob([data], { type: mimeType }), filename)
    form.append('note_id', noteId)
    await apiPostForm('/api/notes/images', form)
  } catch { /* ignore */ }
}

/**
 * Fetch a note image from the backend and save it locally.
 * Used when local file is missing (e.g., on a new device).
 */
export async function fetchAndCacheNoteImage(filename: string): Promise<void> {
  if (!isBackendConfigured()) return
  try {
    const dir = await notesDir()
    const imgDir = `${dir}/images`
    const localPath = `${imgDir}/${filename}`
    if (await exists(localPath)) return
    const binary = await apiGetBinary(`/api/notes/images/${encodeURIComponent(filename)}`)
    if (!binary) return
    if (!(await exists(imgDir))) await mkdir(imgDir, { recursive: true })
    await writeFile(localPath, binary)
  } catch { /* ignore */ }
}

export function createEmptyNote(): NoteItem {
  const now = new Date().toISOString()
  const date = now.slice(0, 10)
  return {
    id: crypto.randomUUID(),
    title: '',
    groupId: '',
    tags: [],
    cover: randomNoteEmoji(),
    date,
    content: '',
    createdAt: now,
  }
}

/** Rebuild the content field with current metadata so that frontmatter is updated. */
export function rebuildContent(note: NoteItem): string {
  return stringifyFrontmatter(note)
}

/** Resolve an image path to a displayable URL. */
export const notesImageBaseDir = ref('')

export async function initNotesImageAssetBase() {
  if (notesImageBaseDir.value) return
  notesImageBaseDir.value = await notesDir()
  try { await invoke('allow_asset_directory', { path: notesImageBaseDir.value }) } catch { /* ignore */ }
}

export function resolveNoteImageUrl(src: string): string {
  if (!src) return src
  if (src.startsWith('http')) return src
  const baseDir = notesImageBaseDir.value
  if (baseDir) {
    if (src.startsWith('/')) {
      return convertFileSrc(src)
    }
    return convertFileSrc(`${baseDir}/${src}`)
  }
  return src
}

export { notesDir } from './path'
