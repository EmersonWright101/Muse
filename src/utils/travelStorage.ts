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
  exists,
  mkdir,
  remove,
  rename,
  readDir,
} from '@tauri-apps/plugin-fs'
import { travelNotesDir } from './path'

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
  content: string // raw markdown including frontmatter
  updatedAt?: string
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
      case 'updatedAt':  meta.updatedAt = val; break
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
  ]
  if (note.updatedAt) lines.push(`updatedAt: ${note.updatedAt}`)
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
      content: raw,
      updatedAt: meta.updatedAt ?? meta.date ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export async function saveTravelNote(note: TravelNote): Promise<void> {
  await ensureDir()
  const path = await notePath(note.id)
  note.updatedAt = new Date().toISOString()
  const tmp = `${path}.tmp`
  await writeTextFile(tmp, stringifyFrontmatter(note))
  await rename(tmp, path)
  localStorage.setItem('muse-ts-travel-notes', new Date().toISOString())
}

export async function deleteTravelNote(id: string): Promise<void> {
  try {
    const path = await notePath(id)
    if (await exists(path)) await remove(path)
  } catch { /* ignore */ }
  const map = getDeletedTravelNotes()
  map[id] = new Date().toISOString()
  localStorage.setItem(LS_DELETED_TRAVEL_KEY, JSON.stringify(map))
  localStorage.setItem('muse-ts-travel-notes', new Date().toISOString())
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

export async function deleteAttachment(filename: string): Promise<void> {
  const dir = await travelNotesDir()
  const filePath = `${dir}/images/${filename}`
  try {
    if (await exists(filePath)) await remove(filePath)
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
    content: '',
  }
}

/** Rebuild the content field with current metadata so that frontmatter is updated. */
export function rebuildContent(note: TravelNote): string {
  return stringifyFrontmatter(note)
}

// ─── Sync module ─────────────────────────────────────────────────────────────

import { syncService } from '../services/sync'
import type { SyncModule } from '../services/sync/types'

const MOD_TRAVEL = 'travelNotes'

interface TravelPayload {
  list: TravelNoteMeta[]
  deletedTravelNotes: Record<string, string>
}

const travelSyncModule: SyncModule = {
  id: MOD_TRAVEL,
  remoteDirs: ['travel'],
  getLocalTimestamp() {
    return localStorage.getItem('muse-ts-travel-notes') ?? new Date(0).toISOString()
  },
  async sync(ctx, localChanged) {
    ctx.setProgress('同步旅行日记…')
    const localList = await listTravelNotes()
    const idxPath = ctx.rp('travel/index.enc')

    const raw = await ctx.getEncrypted<TravelPayload | null>(idxPath, { list: [], deletedTravelNotes: {} })
    const remotePayload: TravelPayload = raw ?? { list: [], deletedTravelNotes: {} }

    applyRemoteDeletedTravelNotes(remotePayload.deletedTravelNotes ?? {})
    const mergedDeleted = getDeletedTravelNotes()

    function isDeleted(id: string): boolean {
      return !!mergedDeleted[id]
    }

    const remoteList = remotePayload.list
    const localIds = new Set(localList.map(n => n.id))
    const remoteIds = new Set(remoteList.map(n => n.id))
    const remoteTombstones = new Set(Object.keys(remotePayload.deletedTravelNotes ?? {}))

    let indexChanged = false

    // ① Apply tombstones
    for (const meta of localList) {
      if (isDeleted(meta.id)) await deleteTravelNote(meta.id)
    }
    for (const [id] of Object.entries(mergedDeleted)) {
      if (!remoteTombstones.has(id)) {
        await ctx.webdavDelete(ctx.rp(`travel/${id}.enc`))
        indexChanged = true
      }
    }

    // ② Download notes that only exist on remote
    for (const meta of remoteList) {
      if (localIds.has(meta.id)) continue
      if (isDeleted(meta.id)) continue
      const resp = await ctx.webdavGet(ctx.rp(`travel/${meta.id}.enc`))
      if (!resp.ok) continue
      try {
        const note = JSON.parse(await ctx.decrypt(resp.body)) as TravelNote
        if (!isDeleted(note.id)) await saveTravelNote(note)
      } catch { /* skip corrupt */ }
    }

    // ③ Upload notes that only exist locally
    if (localChanged) {
      for (const meta of localList) {
        if (remoteIds.has(meta.id)) continue
        if (isDeleted(meta.id)) continue
        const note = await loadTravelNote(meta.id)
        if (!note) continue
        await ctx.putEncrypted(ctx.rp(`travel/${meta.id}.enc`), note)
        indexChanged = true
      }
    }

    // ④ Merge notes that exist on both sides (newer updatedAt wins)
    for (const localMeta of localList) {
      if (isDeleted(localMeta.id)) continue
      const remoteMeta = remoteList.find(r => r.id === localMeta.id)
      if (!remoteMeta) continue

      const localNote = await loadTravelNote(localMeta.id)
      if (!localNote) continue
      const localUpdatedAt = localNote.updatedAt ?? localMeta.updatedAt ?? new Date(0).toISOString()
      const remoteUpdatedAt = remoteMeta.updatedAt ?? new Date(0).toISOString()

      if (remoteUpdatedAt > localUpdatedAt) {
        const resp = await ctx.webdavGet(ctx.rp(`travel/${localMeta.id}.enc`))
        if (resp.ok) {
          try {
            const remoteNote = JSON.parse(await ctx.decrypt(resp.body)) as TravelNote
            await saveTravelNote(remoteNote)
          } catch { /* skip */ }
        }
      } else if (localChanged && localUpdatedAt > remoteUpdatedAt) {
        await ctx.putEncrypted(ctx.rp(`travel/${localMeta.id}.enc`), localNote)
        indexChanged = true
      }
    }

    if (!localChanged && !indexChanged) return

    const finalList = await listTravelNotes()
    await ctx.putEncrypted(idxPath, {
      list: finalList,
      deletedTravelNotes: mergedDeleted,
    } satisfies TravelPayload)
  },
}

syncService.register(travelSyncModule)
