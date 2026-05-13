/**
 * Travel Notes file-based storage.
 *
 * Each note is a Markdown file with YAML frontmatter.
 *
 * Frontmatter schema:
 *   title      : string
 *   lat        : number
 *   lng        : number
 *   categoryL1 : string  (primary category / 一级分类)
 *   categoryL2 : string  (secondary category / 二级分类)
 *   category   : string  (legacy alias = categoryL2, kept for sync compat)
 *   rating     : number (1-5)
 *   date       : string (ISO date)
 *   cover      : string (emoji or empty)
 *   status     : 'visited' | 'upcoming' (default 'visited')
 *
 * Example:
 *   ---
 *   title: 日本·东京
 *   lat: 35.6762
 *   lng: 139.6503
 *   categoryL1: 城市
 *   categoryL2: 景点
 *   category: 景点
 *   rating: 5
 *   date: 2024-03-15
 *   cover: 🗼
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
import { travelNotesDir } from './path'
import { apiPost, apiPut, apiDelete, apiPostForm, apiGetBinary, apiGet, isBackendConfigured } from '../services/api'

export interface TravelNoteMeta {
  id: string        // filename without .md
  title: string
  lat: number
  lng: number
  categoryL1: string // primary category / 一级分类
  categoryL2: string // secondary category / 二级分类
  tags: string[]    // free-form tags / 标签
  rating: number
  date: string
  cover: string
  status: 'visited' | 'upcoming'
  preview: string   // first line of body
  updatedAt: string // file mtime approx (we use date for sort)
}

export interface TravelNote {
  id: string
  title: string
  lat: number
  lng: number
  categoryL1: string
  categoryL2: string
  tags: string[]
  rating: number
  date: string
  cover: string
  status: 'visited' | 'upcoming'
  content: string // raw markdown including frontmatter
  createdAt?: string
  updatedAt?: string
  deletedAt?: string // only set for trash items
}

export interface TravelTrashMeta extends TravelNoteMeta {
  deletedAt: string
}

// ─── Frontmatter helpers ─────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { meta: Partial<TravelNote>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!match) {
    return { meta: { content: raw }, body: raw }
  }
  const yamlBlock = match[1]
  const body = match[2].trimStart()
  const meta: Partial<TravelNote> = { content: raw }
  let legacyCategory = ''

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const key = line.slice(0, colonIdx).trim()
    const val = line.slice(colonIdx + 1).trim()
    switch (key) {
      case 'title':      meta.title = val; break
      case 'lat':        meta.lat = parseFloat(val); break
      case 'lng':        meta.lng = parseFloat(val); break
      case 'categoryL1': meta.categoryL1 = val; break
      case 'categoryL2': meta.categoryL2 = val; break
      case 'category':   legacyCategory = val; break  // old field → migrate to L2
      case 'tags':       meta.tags = val ? val.split(',').map(t => t.trim()).filter(Boolean) : []; break
      case 'rating':     meta.rating = parseFloat(val); break
      case 'date':       meta.date = val; break
      case 'cover':      meta.cover = val; break
      case 'status':     meta.status = val as 'visited' | 'upcoming'; break
      case 'createdAt':  meta.createdAt = val; break
      case 'updatedAt':  meta.updatedAt = val; break
      case 'deletedAt':  meta.deletedAt = val; break
    }
  }
  // Migrate old single-category field to L2 if L2 not explicitly set
  if (!meta.categoryL2 && legacyCategory) meta.categoryL2 = legacyCategory
  if (!meta.categoryL1) meta.categoryL1 = ''
  if (!meta.categoryL2) meta.categoryL2 = ''
  if (!meta.tags) meta.tags = []
  return { meta, body }
}

function stringifyFrontmatter(note: TravelNote): string {
  const lines = [
    '---',
    `title: ${note.title}`,
    `lat: ${note.lat}`,
    `lng: ${note.lng}`,
    `categoryL1: ${note.categoryL1 ?? ''}`,
    `categoryL2: ${note.categoryL2 ?? ''}`,
    `category: ${note.categoryL2 ?? ''}`,  // legacy compat for sync
    `tags: ${(note.tags ?? []).join(',')}`,
    `rating: ${note.rating}`,
    `date: ${note.date}`,
    `cover: ${note.cover || ''}`,
    `status: ${note.status || 'visited'}`,
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

const LS_DELETED_TRAVEL_KEY = 'muse-deleted-travel-notes'

export function getDeletedTravelNotes(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_DELETED_TRAVEL_KEY) ?? '{}') } catch { return {} }
}

export function applyRemoteDeletedTravelNotes(remote: Record<string, string>) {
  const local = getDeletedTravelNotes()
  let changed = false
  for (const [id, ts] of Object.entries(remote)) {
    if (!local[id] || ts > local[id]) { local[id] = ts; changed = true }
  }
  if (changed) localStorage.setItem(LS_DELETED_TRAVEL_KEY, JSON.stringify(local))
}

const TRAVEL_EMOJIS = [
  '📍','🗺️','✈️','🧳','🏔️','🌊','🏖️','🏕️','🚂','🚗','🛵','🚲',
  '🧭','🌏','🌍','🌎','🗽','🏯','🏰','⛩️','🌉','🌁','🏙️','🌅',
  '🌄','🌠','🎑','🏞️','🌲','🌳','🌵','🌴','🌺','🌻','🌹','🌷',
  '🌼','🍂','🍁','❄️','☃️','⛄','🌨️','🌩️','⛈️','🌤️','☀️','🌈',
  '🐚','🦀','🐠','🐡','🦈','🐬','🐳','🦭','🐋',
]

export function randomTravelEmoji(): string {
  return TRAVEL_EMOJIS[Math.floor(Math.random() * TRAVEL_EMOJIS.length)]
}

export function extractFirstImage(body: string): string | null {
  const m = body.match(/!\[.*?\]\((.*?)\)/)
  return m ? m[1] : null
}

export function extractTravelImageFilenames(content: string): string[] {
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

export async function cacheTravelImagesForContent(content: string): Promise<void> {
  await Promise.all(extractTravelImageFilenames(content).map(filename => fetchAndCacheTravelImage(filename)))
}

// In-memory guard to avoid re-uploading the same image in the same app session.
const _uploadedImages = new Set<string>()

export async function uploadReferencedTravelImages(noteId: string, content: string): Promise<void> {
  if (!isBackendConfigured()) return
  const dir = await travelNotesDir()
  await Promise.all(extractTravelImageFilenames(content).map(async filename => {
    const cacheKey = `${noteId}:${filename}`
    if (_uploadedImages.has(cacheKey)) return
    try {
      const path = `${dir}/images/${filename}`
      if (!(await exists(path))) return
      const data = await readFile(path)
      await uploadTravelImage(filename, noteId, data, mimeFromFilename(filename))
      _uploadedImages.add(cacheKey)
    } catch { /* ignore individual image failures */ }
  }))
}

// ─── File helpers ────────────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  const d = await travelNotesDir()
  if (!(await exists(d))) await mkdir(d, { recursive: true })
}

function notePath(id: string): Promise<string> {
  return travelNotesDir().then(d => `${d}/${id}.md`)
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function listTravelNotes(): Promise<TravelNoteMeta[]> {
  const dir = await travelNotesDir()
  if (!(await exists(dir))) return []
  const entries = await readDir(dir)
  const notes: TravelNoteMeta[] = []

  for (const entry of entries) {
    if (!entry.name?.endsWith('.md')) continue
    const id = entry.name.slice(0, -3)
    try {
      const raw = await readTextFile(`${dir}/${entry.name}`)
      const { meta, body } = parseFrontmatter(raw)
      const cover = extractFirstImage(body) || meta.cover || randomTravelEmoji()
      notes.push({
        id,
        title: meta.title ?? id,
        lat: meta.lat ?? 0,
        lng: meta.lng ?? 0,
        categoryL1: meta.categoryL1 ?? '',
        categoryL2: meta.categoryL2 ?? '',
        tags: meta.tags ?? [],
        rating: meta.rating ?? 0,
        date: meta.date ?? new Date().toISOString().slice(0, 10),
        cover,
        status: meta.status ?? 'visited',
        preview: buildPreview(body),
        updatedAt: meta.updatedAt ?? meta.date ?? new Date().toISOString(),
      })
    } catch {
      // skip malformed files
    }
  }

  return notes.sort((a, b) => b.date.localeCompare(a.date))
}

export async function loadTravelNote(id: string): Promise<TravelNote | null> {
  try {
    const path = await notePath(id)
    if (!(await exists(path))) return null
    const raw = await readTextFile(path)
    cacheTravelImagesForContent(raw).catch(() => {})
    const { meta, body } = parseFrontmatter(raw)
    const cover = extractFirstImage(body) || meta.cover || randomTravelEmoji()
    return {
      id,
      title: meta.title ?? id,
      lat: meta.lat ?? 0,
      lng: meta.lng ?? 0,
      categoryL1: meta.categoryL1 ?? '',
      categoryL2: meta.categoryL2 ?? '',
      tags: meta.tags ?? [],
      rating: meta.rating ?? 0,
      date: meta.date ?? new Date().toISOString().slice(0, 10),
      cover,
      status: meta.status ?? 'visited',
      content: raw,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt ?? meta.date ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export async function saveTravelNote(
  note: TravelNote,
  opts: { sync?: boolean; preserveUpdatedAt?: boolean } = {},
): Promise<void> {
  await ensureDir()
  const path = await notePath(note.id)
  if (!opts.preserveUpdatedAt) note.updatedAt = new Date().toISOString()

  // Read old content to detect whether image references actually changed.
  let oldContent = ''
  try { if (await exists(path)) oldContent = await readTextFile(path) } catch { /* ignore */ }
  const oldImages = extractTravelImageFilenames(oldContent)
  const newImages = extractTravelImageFilenames(note.content)
  const imagesChanged =
    oldImages.length !== newImages.length ||
    !oldImages.every(img => newImages.includes(img))

  const tmp = `${path}.tmp`
  await writeTextFile(tmp, stringifyFrontmatter(note))
  await rename(tmp, path)
  localStorage.setItem('muse-ts-travel-notes', new Date().toISOString())

  if (opts.sync !== false && isBackendConfigured()) {
    // Upsert: try PUT, fall back to POST on 404
    apiPut(`/api/travel/notes/${note.id}`, {
      title:       note.title,
      content:     note.content,
      date:        note.date,
      lat:         note.lat,
      lng:         note.lng,
      category_l1: note.categoryL1,
      category_l2: note.categoryL2,
      tags:        note.tags ?? [],
      rating:      note.rating,
      cover:       note.cover,
      status:      note.status ?? 'visited',
      updated_at:  note.updatedAt,
    }, {
      onConflict: async () => {
        const remote = await apiGet<TravelNote>(`/api/travel/notes/${note.id}`)
        if (!remote) {
          return {
            title:       note.title,
            content:     note.content,
            date:        note.date,
            lat:         note.lat,
            lng:         note.lng,
            category_l1: note.categoryL1,
            category_l2: note.categoryL2,
            tags:        note.tags ?? [],
            rating:      note.rating,
            cover:       note.cover,
            status:      note.status ?? 'visited',
            updated_at:  note.updatedAt,
          }
        }
        return {
          title:       note.title || remote.title,
          content:     note.content || remote.content,
          date:        note.date || remote.date,
          lat:         note.lat ?? remote.lat,
          lng:         note.lng ?? remote.lng,
          category_l1: note.categoryL1 || remote.categoryL1,
          category_l2: note.categoryL2 || remote.categoryL2,
          tags:        note.tags ?? remote.tags ?? [],
          rating:      note.rating ?? remote.rating,
          cover:       note.cover || remote.cover,
          status:      note.status || remote.status,
          updated_at:  new Date().toISOString(),
        }
      },
    }).catch(async (e: { status?: number }) => {
      if (e?.status === 404) {
        await apiPost('/api/travel/notes', {
          id:          note.id,
          title:       note.title,
          content:     note.content,
          date:        note.date,
          lat:         note.lat,
          lng:         note.lng,
          category_l1: note.categoryL1,
          category_l2: note.categoryL2,
          tags:        note.tags ?? [],
          rating:      note.rating,
          cover:       note.cover,
          status:      note.status ?? 'visited',
          updated_at:  note.updatedAt,
        }).catch(() => {})
      }
    })
    // Only upload images when the image references actually changed.
    if (imagesChanged) {
      uploadReferencedTravelImages(note.id, note.content).catch(() => {})
    }
  }
}

export async function deleteTravelNoteLocalOnly(id: string, deletedAt?: string): Promise<void> {
  try {
    const path = await notePath(id)
    if (await exists(path)) await remove(path)
  } catch { /* ignore */ }
  const map = getDeletedTravelNotes()
  map[id] = deletedAt ?? new Date().toISOString()
  localStorage.setItem(LS_DELETED_TRAVEL_KEY, JSON.stringify(map))
  localStorage.setItem('muse-ts-travel-notes', new Date().toISOString())
}

export async function deleteTravelNote(id: string, opts: { sync?: boolean; deletedAt?: string } = {}): Promise<void> {
  await deleteTravelNoteLocalOnly(id, opts.deletedAt)
  if (opts.sync !== false) apiDelete(`/api/travel/notes/${id}`).catch(() => {})
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
  const dir = await travelNotesDir()
  return `${dir}/trash`
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
    const note = await loadTravelNote(id)
    if (note) {
      note.deletedAt = deletedAt
      const tmp = `${dstPath}.tmp`
      await writeTextFile(tmp, stringifyFrontmatter(note))
      await rename(tmp, dstPath)
    }
    await remove(srcPath)
  }

  const map = getDeletedTravelNotes()
  map[id] = deletedAt
  localStorage.setItem(LS_DELETED_TRAVEL_KEY, JSON.stringify(map))
  localStorage.setItem('muse-ts-travel-notes', new Date().toISOString())
  if (opts.sync !== false) apiDelete(`/api/travel/notes/${id}`).catch(() => {})
}

/** List all notes currently in the trash folder. */
export async function listTrashItems(): Promise<TravelTrashMeta[]> {
  const dir = await trashDir()
  if (!(await exists(dir))) return []
  const entries = await readDir(dir)
  const items: TravelTrashMeta[] = []

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
        lat: meta.lat ?? 0,
        lng: meta.lng ?? 0,
        categoryL1: meta.categoryL1 ?? '',
        categoryL2: meta.categoryL2 ?? '',
        tags: meta.tags ?? [],
        rating: meta.rating ?? 0,
        date: meta.date ?? '',
        cover,
        status: meta.status ?? 'visited',
        preview: buildPreview(body),
        updatedAt: meta.updatedAt ?? '',
        deletedAt: meta.deletedAt ?? new Date().toISOString(),
      })
    } catch { /* skip malformed */ }
  }

  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

/** Restore a note from trash back to the notes folder. Removes its tombstone. */
export async function restoreNoteFromTrash(id: string, opts: { sync?: boolean } = {}): Promise<void> {
  const dir = await trashDir()
  const srcPath = `${dir}/${id}.md`
  if (!(await exists(srcPath))) return

  const raw = await readTextFile(srcPath)
  const { meta } = parseFrontmatter(raw)

  const note: TravelNote = {
    id,
    title: meta.title ?? id,
    lat: meta.lat ?? 0,
    lng: meta.lng ?? 0,
    categoryL1: meta.categoryL1 ?? '',
    categoryL2: meta.categoryL2 ?? '',
    tags: meta.tags ?? [],
    rating: meta.rating ?? 0,
    date: meta.date ?? new Date().toISOString().slice(0, 10),
    cover: meta.cover ?? '',
    status: meta.status ?? 'visited',
    content: raw,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    // deletedAt intentionally omitted — restored note has no deletedAt
  }

  await ensureDir()
  const dstPath = await notePath(id)
  const tmp = `${dstPath}.tmp`
  await writeTextFile(tmp, stringifyFrontmatter(note))
  await rename(tmp, dstPath)
  await remove(srcPath)

  const tombstones = getDeletedTravelNotes()
  delete tombstones[id]
  localStorage.setItem(LS_DELETED_TRAVEL_KEY, JSON.stringify(tombstones))
  localStorage.setItem('muse-ts-travel-notes', new Date().toISOString())
  if (opts.sync !== false) apiPost(`/api/travel/notes/${id}/restore`, {}).catch(() => {})
}

/** Permanently delete a note from trash (tombstone already set by moveNoteToTrash). */
export async function permanentlyDeleteFromTrash(id: string, opts: { sync?: boolean } = {}): Promise<void> {
  const dir = await trashDir()
  const path = `${dir}/${id}.md`
  try {
    if (await exists(path)) await remove(path)
  } catch { /* ignore */ }
  if (opts.sync !== false) apiDelete(`/api/travel/notes/${id}`).catch(() => {})
}

/** Delete all expired trash items based on retention setting. */
export async function purgeExpiredTrash(retentionDays: number): Promise<void> {
  if (retentionDays <= 0) return
  const items = await listTrashItems()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)
  for (const item of items) {
    if (new Date(item.deletedAt) < cutoff) {
      await permanentlyDeleteFromTrash(item.id)
    }
  }
}

export async function listCategoriesL1(): Promise<string[]> {
  const notes = await listTravelNotes()
  const set = new Set<string>()
  for (const n of notes) if (n.categoryL1) set.add(n.categoryL1)
  return Array.from(set).sort()
}

export async function listCategoriesL2(): Promise<string[]> {
  const notes = await listTravelNotes()
  const set = new Set<string>()
  for (const n of notes) if (n.categoryL2) set.add(n.categoryL2)
  return Array.from(set).sort()
}

/** Returns filenames (not paths) of image attachments not referenced in any note. */
export async function scanUnusedAttachments(): Promise<string[]> {
  const dir = await travelNotesDir()
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

const LS_DELETED_IMAGES_KEY = 'muse-travel-deleted-images'

function getPendingImageDeletions(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_DELETED_IMAGES_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch { /* ignore */ }
  return new Set()
}

function addPendingImageDeletion(filename: string): void {
  const pending = getPendingImageDeletions()
  pending.add(filename)
  localStorage.setItem(LS_DELETED_IMAGES_KEY, JSON.stringify(Array.from(pending)))
}

export function clearPendingImageDeletions(): void {
  localStorage.removeItem(LS_DELETED_IMAGES_KEY)
}

export async function deleteAttachment(filename: string): Promise<void> {
  const dir = await travelNotesDir()
  const filePath = `${dir}/images/${filename}`
  try {
    if (await exists(filePath)) await remove(filePath)
  } catch { /* ignore */ }
  addPendingImageDeletion(filename)
  apiDelete(`/api/travel/images/${encodeURIComponent(filename)}`).catch(() => {})
}

/**
 * Upload a travel note image to the backend and return its filename.
 * The local file is written first; this is a background push.
 */
export async function uploadTravelImage(
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
    await apiPostForm('/api/travel/images', form)
  } catch { /* ignore */ }
}

/**
 * Fetch a travel image from the backend and save it locally.
 * Used when local file is missing (e.g., on a new device).
 */
export async function fetchAndCacheTravelImage(filename: string): Promise<void> {
  if (!isBackendConfigured()) return
  try {
    const dir = await travelNotesDir()
    const imgDir = `${dir}/images`
    const localPath = `${imgDir}/${filename}`
    if (await exists(localPath)) return
    const binary = await apiGetBinary(`/api/travel/images/${encodeURIComponent(filename)}`)
    if (!binary) return
    if (!(await exists(imgDir))) await mkdir(imgDir, { recursive: true })
    await writeFile(localPath, binary)
  } catch { /* ignore */ }
}

export function newNoteId(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export function createEmptyNote(): TravelNote {
  const now = new Date().toISOString()
  const date = now.slice(0, 10)
  return {
    id: newNoteId(),
    title: '新笔记',
    lat: 0,
    lng: 0,
    categoryL1: '',
    categoryL2: '',
    tags: [],
    rating: 0,
    date,
    cover: randomTravelEmoji(),
    status: 'visited',
    content: '',
    createdAt: now,
  }
}

/** Rebuild the content field with current metadata so that frontmatter is updated. */
export function rebuildContent(note: TravelNote): string {
  return stringifyFrontmatter(note)
}

/** Content fingerprint for deduplication: title + first 200 chars of markdown. */
export function noteFingerprint(note: TravelNote): string {
  return `${note.title}|${note.content.slice(0, 200)}`
}
