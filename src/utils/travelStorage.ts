/**
 * Travel Notes file-based storage.
 *
 * Each note is a Markdown file with YAML frontmatter.
 *
 * Frontmatter schema:
 *   title    : string
 *   lat      : number
 *   lng      : number
 *   category : string
 *   rating   : number (1-5)
 *   date     : string (ISO date)
 *   cover    : string (emoji or empty)
 *
 * Example:
 *   ---
 *   title: 日本·东京
 *   lat: 35.6762
 *   lng: 139.6503
 *   category: 城市游
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
  readDir,
} from '@tauri-apps/plugin-fs'
import { travelNotesDir } from './path'

export interface TravelNoteMeta {
  id: string        // filename without .md
  title: string
  lat: number
  lng: number
  category: string
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
  category: string
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

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const key = line.slice(0, colonIdx).trim()
    const val = line.slice(colonIdx + 1).trim()
    switch (key) {
      case 'title': meta.title = val; break
      case 'lat': meta.lat = parseFloat(val); break
      case 'lng': meta.lng = parseFloat(val); break
      case 'category': meta.category = val; break
      case 'rating': meta.rating = parseFloat(val); break
      case 'date': meta.date = val; break
      case 'cover': meta.cover = val; break
    }
  }
  return { meta, body }
}

function stringifyFrontmatter(note: TravelNote): string {
  const lines = [
    '---',
    `title: ${note.title}`,
    `lat: ${note.lat}`,
    `lng: ${note.lng}`,
    `category: ${note.category}`,
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
        category: meta.category ?? '未分类',
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
      category: meta.category ?? '未分类',
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
  await writeTextFile(path, stringifyFrontmatter(note))
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

export async function listCategories(): Promise<string[]> {
  const notes = await listTravelNotes()
  const set = new Set<string>()
  for (const n of notes) if (n.category) set.add(n.category)
  return Array.from(set).sort()
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
    category: '未分类',
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
