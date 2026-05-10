/**
 * Ebook Store
 * Books, reading progress, annotations, and reading sessions.
 * Local-first (localStorage + Tauri FS) with optional backend sync.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { readFile, writeFile, mkdir, exists, remove, copyFile, readTextFile, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs'
import { ebooksDir, resolveDataRoot } from '../utils/path'
import { apiGet, apiPut, apiPutBinary, apiGetBinary, apiDelete, isBackendConfigured } from '../services/api'

// ─── Ebook Copilot usage tracking ────────────────────────────────────────────

export interface EbookCopilotDailyStat {
  inputTokens: number
  outputTokens: number
  costUsd: number
  requests: number
}

export async function recordEbookCopilotUsage(inputTokens: number, outputTokens: number, costUsd: number): Promise<void> {
  try {
    const path = `${await resolveDataRoot()}/ebook-copilot-stats.json`
    let stats: Record<string, EbookCopilotDailyStat> = {}
    try { if (await exists(path)) stats = JSON.parse(await readTextFile(path)) } catch {}
    const date = new Date().toISOString().slice(0, 10)
    const s = stats[date] ?? { inputTokens: 0, outputTokens: 0, costUsd: 0, requests: 0 }
    s.inputTokens  += inputTokens ?? 0
    s.outputTokens += outputTokens ?? 0
    s.costUsd      += costUsd ?? 0
    s.requests     += 1
    stats[date] = s
    await writeTextFile(path, JSON.stringify(stats))
  } catch { /* non-critical */ }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReadStatus = 'reading' | 'want_to_read' | 'finished' | null

export interface Collection {
  id: string
  name: string
  createdAt: number
}

export interface Book {
  id: string
  title: string
  author: string
  cover: string | null       // base64 data URL thumbnail
  filePath: string           // relative to ebooksDir: "{id}.epub"
  fileSize: number
  format: 'epub'
  language: string
  publisher: string
  description: string
  addedAt: number
  lastReadAt: number | null
  totalProgress: number      // 0–100
  readStatus: ReadStatus
  collectionIds: string[]    // belongs to these collections
}

export interface ReadingProgress {
  bookId: string
  cfi: string                // EPUB CFI location
  chapterHref: string
  percentage: number
  updatedAt: number
}

export interface BookAnnotation {
  id: string
  bookId: string
  cfi: string                // EPUB CFI range
  text: string               // selected/highlighted text
  type: 'highlight' | 'underline' | 'note'
  color: string              // 'yellow' | 'green' | 'blue' | 'pink'
  note: string
  chapterTitle: string
  createdAt: number
  updatedAt: number
}

export interface ReadingSession {
  id: string
  bookId: string
  date: string               // YYYY-MM-DD
  duration: number           // seconds
  startedAt: number
}

export interface CopilotVariant {
  id: string
  content: string
  model?: string
  providerId?: string
  error?: boolean
  mediaOutputs?: Array<{ mimeType: string; data?: string; url?: string }>
}

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  model?: string
  providerId?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    costUsd?: number
    durationMs?: number
  }
  error?: boolean
  webSearchCount?: number
  variants?: CopilotVariant[]
  mediaOutputs?: Array<{ mimeType: string; data?: string; url?: string }>
}

export interface CopilotSession {
  id: string
  bookId: string
  createdAt: number
  updatedAt: number
  messages: CopilotMessage[]
}

export interface ReaderSettings {
  fontSize: number           // px, 12–32
  fontFamily: string         // 'system' | 'serif' | 'sans' | 'mono'
  theme: 'light' | 'sepia' | 'dark'
  lineHeight: number         // 1.2–2.5
  margin: number             // 20–80 px
  scrollMode: boolean        // true = scroll, false = paginated
  spread: 'none' | 'always'  // single vs double-page layout (paginated only)
}

export type TtsVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'

export interface TtsSettings {
  enabled:    boolean
  providerId: string   // references an AIProvider.id from aiSettings
  modelId:    string   // references an AIModel.id within that provider (must have audio: true)
  voice:      string   // voice id, e.g. "Ryan" — sourced from /v1/models or custom input
  speed:      number   // 0.25 – 4.0
}

export interface BookTtsJobState {
  status:         'idle' | 'running' | 'paused' | 'complete' | 'error'
  totalChunks:    number
  doneChunks:     number
  currentChapter: number
  totalChapters:  number
  lastActivity:   number
  phase:          'idle' | 'extracting' | 'scanning' | 'generating'
  errorMsg?:      string
}

export interface TtsPlaybackPos {
  spineIdx: number
  chunkIdx: number
  href:     string   // epub href of the chapter, for navigation
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const LS_BOOKS          = 'muse-ebook-books'
const LS_PROGRESS       = 'muse-ebook-progress'
const LS_ANNOTATIONS    = 'muse-ebook-annotations'
const LS_SESSIONS       = 'muse-ebook-sessions'
const LS_SETTINGS       = 'muse-ebook-settings'
const LS_COLLECTIONS    = 'muse-ebook-collections'
const LS_COPILOT        = 'muse-ebook-copilot'
const LS_TTS_SETTINGS   = 'muse-ebook-tts-settings'
const LS_TTS_JOBS       = 'muse-ebook-tts-jobs'
const LS_TTS_PLAYBACK   = 'muse-ebook-tts-playback'

function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback } catch { return fallback }
}

function save(key: string, val: unknown) {
  localStorage.setItem(key, JSON.stringify(val))
}

function uuid(): string {
  return crypto.randomUUID()
}

function uint8ToArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  fontFamily: 'serif',
  theme: 'light',
  lineHeight: 1.8,
  margin: 40,
  scrollMode: false,   // paginated by default: one page at a time
  spread: 'none',
}

const DEFAULT_TTS_SETTINGS: TtsSettings = {
  enabled:    true,
  providerId: '',
  modelId:    '',
  voice:      '',
  speed:      1.0,
}

function normalizeSettings(raw: Partial<ReaderSettings>): ReaderSettings {
  const merged = { ...DEFAULT_SETTINGS, ...raw } as ReaderSettings
  if ((merged.theme as string) === 'paper') merged.theme = 'sepia'
  if (!['light', 'sepia', 'dark'].includes(merged.theme)) merged.theme = 'light'
  return merged
}

// Keep at most this many sessions (≈ 2 years of daily reading)
const MAX_SESSIONS = 1000
const MAX_COPILOT_SESSIONS_PER_BOOK = 20

// ─── Store ────────────────────────────────────────────────────────────────────

export const useEbookStore = defineStore('ebook', () => {
  const books           = ref<Book[]>(load(LS_BOOKS, []))
  const progress        = ref<Record<string, ReadingProgress>>(load(LS_PROGRESS, {}))
  const annotations     = ref<BookAnnotation[]>(load(LS_ANNOTATIONS, []))
  const sessions        = ref<ReadingSession[]>(load(LS_SESSIONS, []))
  const settings        = ref<ReaderSettings>(normalizeSettings(load(LS_SETTINGS, {})))
  const collections     = ref<Collection[]>(load(LS_COLLECTIONS, []))
  const copilotSessions = ref<CopilotSession[]>(load(LS_COPILOT, []))
  const ttsSettings     = ref<TtsSettings>({ ...DEFAULT_TTS_SETTINGS, ...load<Partial<TtsSettings>>(LS_TTS_SETTINGS, {}) })
  const storageUsed     = ref<number>(0)
  let _serverPushTimer: ReturnType<typeof setTimeout> | null = null

  // Normalize any "running" job back to "paused" in case the app was closed mid-generation
  const _rawTtsJobs = load<Record<string, BookTtsJobState>>(LS_TTS_JOBS, {})
  for (const job of Object.values(_rawTtsJobs)) {
    if (job.status === 'running') job.status = 'paused'
    if (job.phase  === 'extracting' || job.phase === 'scanning' || job.phase === 'generating') job.phase = 'idle'
  }
  const ttsJobStates   = ref<Record<string, BookTtsJobState>>(_rawTtsJobs)
  const ttsPlaybackPos = ref<Record<string, TtsPlaybackPos>>(load<Record<string, TtsPlaybackPos>>(LS_TTS_PLAYBACK, {}))

  // Active book & view
  const activeBookId = ref<string | null>(null)
  const activeBook   = computed(() => books.value.find(b => b.id === activeBookId.value) ?? null)

  // Current reading session start time (tracks time-in-book)
  let _sessionStart = 0
  let _sessionBookId = ''

  // ─── Book file I/O ──────────────────────────────────────────────────────────

  async function getEbooksDir(): Promise<string> {
    const dir = await ebooksDir()
    if (!(await exists(dir))) await mkdir(dir, { recursive: true })
    return dir
  }

  async function readBookFile(book: Book): Promise<ArrayBuffer | null> {
    try {
      const dir = await getEbooksDir()
      const localPath = `${dir}/${book.filePath}`
      if (await exists(localPath)) {
        const bytes = await readFile(localPath)
        return uint8ToArrayBuffer(bytes)
      }
      if (isBackendConfigured()) {
        const remote = await apiGetBinary(`/api/ebook/books/${book.id}/file`)
        if (remote) {
          await writeFile(localPath, remote)
          return uint8ToArrayBuffer(remote)
        }
      }
      return null
    } catch { return null }
  }

  async function importBookFile(srcPath: string, bookId: string): Promise<boolean> {
    try {
      const dir = await getEbooksDir()
      await copyFile(srcPath, `${dir}/${bookId}.epub`)
      if (isBackendConfigured()) {
        const bytes = await readFile(srcPath)
        apiPutBinary(
          `/api/ebook/books/${bookId}/file`,
          uint8ToArrayBuffer(bytes),
          'application/epub+zip',
        ).catch(() => {})
      }
      return true
    } catch { return false }
  }

  async function deleteBookFile(book: Book): Promise<void> {
    try {
      const dir = await getEbooksDir()
      const p = `${dir}/${book.filePath}`
      if (await exists(p)) await remove(p)
    } catch { /* ignore */ }
    apiDelete(`/api/ebook/books/${book.id}/file`).catch(() => {})
  }

  function schedulePushToServer() {
    if (!isBackendConfigured()) return
    if (_serverPushTimer) clearTimeout(_serverPushTimer)
    _serverPushTimer = setTimeout(() => {
      _serverPushTimer = null
      pushToServer().catch(() => {})
    }, 800)
  }

  // ─── Library management ─────────────────────────────────────────────────────

  function addBook(meta: Omit<Book, 'addedAt' | 'lastReadAt' | 'totalProgress'>): Book {
    const book: Book = {
      ...meta,
      addedAt: Date.now(),
      lastReadAt: null,
      totalProgress: 0,
    }
    books.value.unshift(book)
    save(LS_BOOKS, books.value)
    pushToServer().catch(() => {})
    return book
  }

  function updateBook(id: string, patch: Partial<Book>) {
    const idx = books.value.findIndex(b => b.id === id)
    if (idx < 0) return
    books.value[idx] = { ...books.value[idx], ...patch }
    save(LS_BOOKS, books.value)
    schedulePushToServer()
  }

  async function removeBook(id: string) {
    const book = books.value.find(b => b.id === id)
    if (!book) return
    await deleteBookFile(book)
    books.value = books.value.filter(b => b.id !== id)
    delete progress.value[id]
    annotations.value = annotations.value.filter(a => a.bookId !== id)
    sessions.value = sessions.value.filter(s => s.bookId !== id)
    save(LS_BOOKS, books.value)
    save(LS_PROGRESS, progress.value)
    save(LS_ANNOTATIONS, annotations.value)
    save(LS_SESSIONS, sessions.value)
    pushToServer().catch(() => {})
  }

  function setActiveBook(id: string | null) {
    if (activeBookId.value && activeBookId.value !== id) {
      commitSession()
    }
    activeBookId.value = id
    if (id) {
      _sessionStart = Date.now()
      _sessionBookId = id
    updateBook(id, { lastReadAt: Date.now() })
    }
  }

  // ─── Reading progress ────────────────────────────────────────────────────────

  function saveProgress(bookId: string, cfi: string, chapterHref: string, percentage: number) {
    progress.value[bookId] = { bookId, cfi, chapterHref, percentage, updatedAt: Date.now() }
    updateBook(bookId, { totalProgress: Math.round(percentage) })
    save(LS_PROGRESS, progress.value)
    schedulePushToServer()
  }

  function getProgress(bookId: string): ReadingProgress | null {
    return progress.value[bookId] ?? null
  }

  // ─── Annotations ─────────────────────────────────────────────────────────────

  function addAnnotation(ann: Omit<BookAnnotation, 'id' | 'createdAt' | 'updatedAt'>): BookAnnotation {
    const now = Date.now()
    const full: BookAnnotation = { ...ann, id: uuid(), createdAt: now, updatedAt: now }
    annotations.value.push(full)
    save(LS_ANNOTATIONS, annotations.value)
    pushToServer().catch(() => {})
    return full
  }

  function updateAnnotation(id: string, patch: Partial<Pick<BookAnnotation, 'note' | 'color'>>) {
    const idx = annotations.value.findIndex(a => a.id === id)
    if (idx < 0) return
    annotations.value[idx] = { ...annotations.value[idx], ...patch, updatedAt: Date.now() }
    save(LS_ANNOTATIONS, annotations.value)
    pushToServer().catch(() => {})
  }

  function removeAnnotation(id: string) {
    annotations.value = annotations.value.filter(a => a.id !== id)
    save(LS_ANNOTATIONS, annotations.value)
    pushToServer().catch(() => {})
  }

  function getAnnotations(bookId: string): BookAnnotation[] {
    return annotations.value.filter(a => a.bookId === bookId)
  }

  // ─── Reading sessions ─────────────────────────────────────────────────────────

  function commitSession() {
    if (!_sessionBookId || !_sessionStart) return
    const duration = Math.round((Date.now() - _sessionStart) / 1000)
    if (duration < 10) { _sessionStart = 0; _sessionBookId = ''; return }
    const date = new Date().toISOString().slice(0, 10)
    sessions.value.push({
      id: uuid(),
      bookId: _sessionBookId,
      date,
      duration,
      startedAt: _sessionStart,
    })
    // Keep trimmed
    if (sessions.value.length > MAX_SESSIONS) {
      sessions.value = sessions.value.slice(-MAX_SESSIONS)
    }
    save(LS_SESSIONS, sessions.value)
    _sessionStart = 0
    _sessionBookId = ''
    pushToServer().catch(() => {})
  }

  /** Returns { 'YYYY-MM-DD': totalMinutes } for the last N days. */
  function getSessionHeatmap(days = 365): Record<string, number> {
    const cutoff = Date.now() - days * 86400_000
    const map: Record<string, number> = {}
    for (const s of sessions.value) {
      if (s.startedAt < cutoff) continue
      map[s.date] = (map[s.date] ?? 0) + Math.round(s.duration / 60)
    }
    return map
  }

  function getTotalReadingMinutes(): number {
    return Math.round(sessions.value.reduce((sum, s) => sum + s.duration, 0) / 60)
  }

  function getCurrentStreak(): number {
    const today = new Date().toISOString().slice(0, 10)
    const heatmap = getSessionHeatmap(365)
    let streak = 0
    let d = new Date()
    while (true) {
      const key = d.toISOString().slice(0, 10)
      if (!heatmap[key] && key !== today) break
      if (heatmap[key]) streak++
      d.setDate(d.getDate() - 1)
      if (streak > 365) break
    }
    return streak
  }

  function getTodayReadingMinutes(): number {
    const today = new Date().toISOString().slice(0, 10)
    return Math.round(
      sessions.value
        .filter(s => s.date === today)
        .reduce((sum, s) => sum + s.duration, 0) / 60
    )
  }

  function getWeeklyAvgMinutes(): number {
    const heatmap = getSessionHeatmap(365)
    const entries = Object.entries(heatmap).filter(([, v]) => v > 0)
    if (entries.length === 0) return 0
    const total = entries.reduce((sum, [, v]) => sum + v, 0)
    return Math.round(total / entries.length)
  }

  function getMonthlyAvgMinutes(): number {
    const heatmap = getSessionHeatmap(365)
    const entries = Object.entries(heatmap).filter(([, v]) => v > 0)
    if (entries.length === 0) return 0
    const total = entries.reduce((sum, [, v]) => sum + v, 0)
    // Sort dates to find first reading day
    const dates = entries.map(([d]) => d).sort()
    const firstDate = new Date(dates[0])
    const now = new Date()
    const daysDiff = Math.max(1, Math.round((now.getTime() - firstDate.getTime()) / 86400_000))
    return Math.round(total / daysDiff)
  }

  function getYearlyAvgMinutes(): number {
    const heatmap = getSessionHeatmap(365)
    const entries = Object.entries(heatmap).filter(([, v]) => v > 0)
    if (entries.length === 0) return 0
    const total = entries.reduce((sum, [, v]) => sum + v, 0)
    const dates = entries.map(([d]) => d).sort()
    const firstDate = new Date(dates[0])
    const now = new Date()
    const daysDiff = Math.max(1, Math.round((now.getTime() - firstDate.getTime()) / 86400_000))
    return Math.round(total / daysDiff)
  }

  // ─── Collections ─────────────────────────────────────────────────────────────

  function addCollection(name: string): Collection {
    const col: Collection = { id: uuid(), name, createdAt: Date.now() }
    collections.value.push(col)
    save(LS_COLLECTIONS, collections.value)
    pushToServer().catch(() => {})
    return col
  }

  function removeCollection(id: string) {
    collections.value = collections.value.filter(c => c.id !== id)
    books.value.forEach(b => {
      b.collectionIds = b.collectionIds.filter(cid => cid !== id)
    })
    save(LS_COLLECTIONS, collections.value)
    save(LS_BOOKS, books.value)
    pushToServer().catch(() => {})
  }

  function setBookCollection(bookId: string, collectionId: string, add: boolean) {
    const idx = books.value.findIndex(b => b.id === bookId)
    if (idx < 0) return
    const ids = books.value[idx].collectionIds ?? []
    books.value[idx].collectionIds = add
      ? [...new Set([...ids, collectionId])]
      : ids.filter(id => id !== collectionId)
    save(LS_BOOKS, books.value)
    schedulePushToServer()
  }

  function setReadStatus(bookId: string, status: ReadStatus) {
    updateBook(bookId, { readStatus: status })
    pushToServer().catch(() => {})
  }

  // ─── Reader settings ──────────────────────────────────────────────────────────

  function updateSettings(patch: Partial<ReaderSettings>) {
    settings.value = normalizeSettings({ ...settings.value, ...patch })
    save(LS_SETTINGS, settings.value)
    pushToServer().catch(() => {})
  }

  function updateTtsSettings(patch: Partial<TtsSettings>) {
    ttsSettings.value = { ...ttsSettings.value, ...patch }
    save(LS_TTS_SETTINGS, ttsSettings.value)
    pushToServer().catch(() => {})
  }

  // ─── TTS generation job state ─────────────────────────────────────────────

  const _defaultJob = (): BookTtsJobState => ({
    status: 'idle', totalChunks: 0, doneChunks: 0,
    currentChapter: 0, totalChapters: 0, lastActivity: 0, phase: 'idle',
  })

  function updateTtsJob(bookId: string, patch: Partial<BookTtsJobState>) {
    ttsJobStates.value[bookId] = {
      ...(_defaultJob()),
      ...(ttsJobStates.value[bookId] ?? {}),
      ...patch,
      lastActivity: Date.now(),
    }
    // Persist only on terminal/stable state changes (not every chunk update)
    if (patch.status === 'paused' || patch.status === 'complete' || patch.status === 'error') {
      save(LS_TTS_JOBS, ttsJobStates.value)
      schedulePushToServer()
    }
  }

  function getTtsJob(bookId: string): BookTtsJobState | null {
    return ttsJobStates.value[bookId] ?? null
  }

  // ─── TTS playback position ────────────────────────────────────────────────────

  function setTtsPlaybackPos(bookId: string, pos: TtsPlaybackPos) {
    ttsPlaybackPos.value[bookId] = pos
    save(LS_TTS_PLAYBACK, ttsPlaybackPos.value)
  }

  function getTtsPlaybackPos(bookId: string): TtsPlaybackPos | null {
    return ttsPlaybackPos.value[bookId] ?? null
  }

  async function clearAudiobook(bookId: string): Promise<void> {
    // Clear local state
    delete ttsJobStates.value[bookId]
    save(LS_TTS_JOBS, ttsJobStates.value)
    delete ttsPlaybackPos.value[bookId]
    save(LS_TTS_PLAYBACK, ttsPlaybackPos.value)
    // Delete local audio files (AppData/ebook-tts/{bookId}/)
    try {
      const ttsDir = `ebook-tts/${bookId}`
      if (await exists(ttsDir, { baseDir: BaseDirectory.AppData })) {
        await remove(ttsDir, { baseDir: BaseDirectory.AppData, recursive: true })
      }
    } catch { /* ignore */ }
    // Delete server-side audio chunks and manifests
    await apiDelete(`/api/ebook/tts/${bookId}`).catch(() => {})
    // Push cleared job state so other devices also see no audiobook
    await pushToServer().catch(() => {})
  }

  // ─── Copilot sessions ────────────────────────────────────────────────────────

  function saveCopilotSession(session: CopilotSession) {
    const idx = copilotSessions.value.findIndex(s => s.id === session.id)
    if (idx >= 0) {
      copilotSessions.value[idx] = session
    } else {
      copilotSessions.value.push(session)
    }
    // Trim oldest sessions per book beyond the cap
    const bookSessions = copilotSessions.value
      .filter(s => s.bookId === session.bookId)
      .sort((a, b) => a.updatedAt - b.updatedAt)
    while (bookSessions.length > MAX_COPILOT_SESSIONS_PER_BOOK) {
      const oldest = bookSessions.shift()!
      copilotSessions.value = copilotSessions.value.filter(s => s.id !== oldest.id)
    }
    save(LS_COPILOT, copilotSessions.value)
    pushToServer().catch(() => {})
  }

  function getCopilotSessions(bookId: string): CopilotSession[] {
    return copilotSessions.value
      .filter(s => s.bookId === bookId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  function deleteCopilotSession(id: string) {
    copilotSessions.value = copilotSessions.value.filter(s => s.id !== id)
    save(LS_COPILOT, copilotSessions.value)
    pushToServer().catch(() => {})
  }

  // ─── Backend sync ─────────────────────────────────────────────────────────────

  interface EbookServerPayload {
    books: Book[]
    progress: Record<string, ReadingProgress>
    annotations: BookAnnotation[]
    sessions: ReadingSession[]
    collections: Collection[]
    copilotSessions: CopilotSession[]
    settings?: ReaderSettings
    ttsSettings?: TtsSettings
    ttsJobStates?: Record<string, BookTtsJobState>
    copilotStats?: Record<string, EbookCopilotDailyStat>
    ttsPlaybackPos?: Record<string, TtsPlaybackPos>
  }

  interface EbookLibraryResponse {
    value: EbookServerPayload
    storageUsed?: number
  }

  async function pushToServer(): Promise<void> {
    if (!isBackendConfigured()) return
    // Load ebook copilot stats from disk (written by recordEbookCopilotUsage)
    let copilotStats: Record<string, EbookCopilotDailyStat> | undefined
    try {
      const statsPath = `${await resolveDataRoot()}/ebook-copilot-stats.json`
      if (await exists(statsPath)) {
        copilotStats = JSON.parse(await readTextFile(statsPath)) as Record<string, EbookCopilotDailyStat>
      }
    } catch { /* non-critical */ }
    const payload: EbookServerPayload = {
      books: books.value,
      progress: progress.value,
      annotations: annotations.value,
      sessions: sessions.value,
      collections: collections.value,
      copilotSessions: copilotSessions.value,
      settings: settings.value,
      ttsSettings: ttsSettings.value,
      ttsJobStates: ttsJobStates.value,
      copilotStats,
      ttsPlaybackPos: ttsPlaybackPos.value,
    }
    await apiPut('/api/ebook/library', { value: payload }).catch(() => {})
  }

  /** Upload a book's EPUB file from local FS to the server (best-effort). */
  async function pushBookFileToServer(book: Book): Promise<void> {
    if (!isBackendConfigured()) return
    try {
      const dir = await getEbooksDir()
      const localPath = `${dir}/${book.filePath}`
      if (!(await exists(localPath))) return
      const bytes = await readFile(localPath)
      await apiPutBinary(
        `/api/ebook/books/${book.id}/file`,
        uint8ToArrayBuffer(bytes),
        'application/epub+zip',
      )
    } catch { /* non-critical */ }
  }

  // ─── Merge helpers ─────────────────────────────────────────────────────────────

  function bookFingerprint(b: Book): string {
    return `${b.title}|${b.author}|${b.filePath}`
  }

  function readStatusRank(s: ReadStatus): number {
    if (s === 'finished') return 3
    if (s === 'reading') return 2
    if (s === 'want_to_read') return 1
    return 0
  }

  function collectionFingerprint(c: Collection): string {
    return c.name
  }

  function annotationFingerprint(a: BookAnnotation): string {
    return `${a.chapterTitle}|${a.text}|${a.note}`
  }

  function sessionFingerprint(s: ReadingSession): string {
    return `${s.bookId}|${s.startedAt}`
  }

  function mergeBooks(local: Book, remote: Book): Book {
    const keptId = local.id < remote.id ? local.id : remote.id
    return {
      ...remote,
      ...local,
      id: keptId,
      filePath: local.filePath,
      lastReadAt: Math.max(local.lastReadAt ?? 0, remote.lastReadAt ?? 0) || null,
      totalProgress: Math.max(local.totalProgress, remote.totalProgress),
      readStatus: readStatusRank(local.readStatus) >= readStatusRank(remote.readStatus) ? local.readStatus : remote.readStatus,
      collectionIds: [...new Set([...(local.collectionIds ?? []), ...(remote.collectionIds ?? [])])],
    }
  }

  async function syncFromServer(): Promise<void> {
    if (!isBackendConfigured()) return
    try {
      const remote = await apiGet<EbookLibraryResponse>('/api/ebook/library')
      if (!remote?.value) {
        await pushToServer()
        // First-time sync: also push all local book files so other devices can download them
        for (const b of books.value) {
          pushBookFileToServer(b).catch(() => {})
        }
        return
      }
      const r = remote.value

      // Work with plain copies to avoid mid-merge reactivity side-effects
      let localBooks: Book[] = JSON.parse(JSON.stringify(books.value))
      const remoteBooks: Book[] = JSON.parse(JSON.stringify(r.books ?? []))
      let localCollections: Collection[] = JSON.parse(JSON.stringify(collections.value))
      const remoteCollections: Collection[] = JSON.parse(JSON.stringify(r.collections ?? []))
      let localAnnotations: BookAnnotation[] = JSON.parse(JSON.stringify(annotations.value))
      const remoteAnnotations: BookAnnotation[] = JSON.parse(JSON.stringify(r.annotations ?? []))
      let localSessions: ReadingSession[] = JSON.parse(JSON.stringify(sessions.value))
      const remoteSessions: ReadingSession[] = JSON.parse(JSON.stringify(r.sessions ?? []))
      let localProgress: Record<string, ReadingProgress> = JSON.parse(JSON.stringify(progress.value))
      const remoteProgress: Record<string, ReadingProgress> = JSON.parse(JSON.stringify(r.progress ?? {}))
      let localCopilot: CopilotSession[] = JSON.parse(JSON.stringify(copilotSessions.value))
      const remoteCopilot: CopilotSession[] = JSON.parse(JSON.stringify(r.copilotSessions ?? []))

      // ─── 1. Merge collections by name ──────────────────────────────────────────
      const collectionIdRemap = new Map<string, string>()
      const mergedCollections: Collection[] = []
      const localColByName = new Map<string, Collection>()
      for (const c of localCollections) localColByName.set(collectionFingerprint(c), c)

      for (const rc of remoteCollections) {
        const fp = collectionFingerprint(rc)
        const lc = localColByName.get(fp)
        if (lc) {
          const keptId = lc.id < rc.id ? lc.id : rc.id
          const discardedId = lc.id < rc.id ? rc.id : lc.id
          if (keptId !== discardedId) {
            collectionIdRemap.set(discardedId, keptId)
          }
          if (!mergedCollections.find(c => c.id === keptId)) {
            mergedCollections.push(keptId === lc.id ? lc : rc)
          }
        } else {
          mergedCollections.push(rc)
        }
      }
      for (const lc of localCollections) {
        if (!mergedCollections.find(c => c.id === lc.id)) {
          mergedCollections.push(lc)
        }
      }

      // Apply collection remapping to books
      function remapCollectionIds(ids: string[]): string[] {
        return [...new Set(ids.map(id => collectionIdRemap.get(id) ?? id))]
      }
      for (const b of localBooks) b.collectionIds = remapCollectionIds(b.collectionIds ?? [])
      for (const b of remoteBooks) b.collectionIds = remapCollectionIds(b.collectionIds ?? [])

      // ─── 2. Merge books by fingerprint ─────────────────────────────────────────
      const bookIdRemap = new Map<string, string>()
      const mergedBooks: Book[] = []
      const localBookByFp = new Map<string, Book>()
      for (const b of localBooks) localBookByFp.set(bookFingerprint(b), b)

      for (const rb of remoteBooks) {
        const fp = bookFingerprint(rb)
        const lb = localBookByFp.get(fp)
        if (lb) {
          const merged = mergeBooks(lb, rb)
          if (merged.id !== lb.id) bookIdRemap.set(lb.id, merged.id)
          if (merged.id !== rb.id) bookIdRemap.set(rb.id, merged.id)
          const idx = localBooks.indexOf(lb)
          if (idx >= 0) localBooks[idx] = merged
          if (!mergedBooks.find(b => b.id === merged.id)) {
            mergedBooks.push(merged)
          }
        } else {
          if (!mergedBooks.find(b => b.id === rb.id)) {
            mergedBooks.push(rb)
          }
        }
      }
      for (const lb of localBooks) {
        if (!mergedBooks.find(b => b.id === lb.id)) {
          mergedBooks.push(lb)
        }
      }

      function remapBookId(id: string): string {
        return bookIdRemap.get(id) ?? id
      }

      // ─── 3. Merge progress ─────────────────────────────────────────────────────
      const mergedProgress: Record<string, ReadingProgress> = {}
      for (const [bid, lp] of Object.entries(localProgress)) {
        const newId = remapBookId(bid)
        mergedProgress[newId] = { ...lp, bookId: newId }
      }
      for (const [bid, rp] of Object.entries(remoteProgress)) {
        const newId = remapBookId(bid)
        const lp = mergedProgress[newId]
        if (!lp || rp.percentage > lp.percentage || (rp.percentage === lp.percentage && rp.updatedAt > lp.updatedAt)) {
          mergedProgress[newId] = { ...rp, bookId: newId }
        }
      }

      // ─── 4. Merge annotations ──────────────────────────────────────────────────
      const annByFp = new Map<string, BookAnnotation>()
      for (const la of localAnnotations) {
        const newBookId = remapBookId(la.bookId)
        const fp = annotationFingerprint({ ...la, bookId: newBookId })
        const existing = annByFp.get(fp)
        if (!existing || la.id < existing.id) {
          annByFp.set(fp, { ...la, bookId: newBookId })
        }
      }
      for (const ra of remoteAnnotations) {
        const newBookId = remapBookId(ra.bookId)
        const fp = annotationFingerprint({ ...ra, bookId: newBookId })
        const existing = annByFp.get(fp)
        if (!existing || ra.id < existing.id) {
          annByFp.set(fp, { ...ra, bookId: newBookId })
        }
      }
      const mergedAnnotations = Array.from(annByFp.values())

      // ─── 5. Merge sessions ─────────────────────────────────────────────────────
      const sessByFp = new Map<string, ReadingSession>()
      for (const ls of localSessions) {
        const newBookId = remapBookId(ls.bookId)
        const fp = sessionFingerprint({ ...ls, bookId: newBookId })
        const existing = sessByFp.get(fp)
        if (!existing || ls.id < existing.id) {
          sessByFp.set(fp, { ...ls, bookId: newBookId })
        }
      }
      for (const rs of remoteSessions) {
        const newBookId = remapBookId(rs.bookId)
        const fp = sessionFingerprint({ ...rs, bookId: newBookId })
        const existing = sessByFp.get(fp)
        if (!existing || rs.id < existing.id) {
          sessByFp.set(fp, { ...rs, bookId: newBookId })
        }
      }
      const mergedSessions = Array.from(sessByFp.values())
      if (mergedSessions.length > MAX_SESSIONS) {
        mergedSessions.sort((a, b) => a.startedAt - b.startedAt)
        mergedSessions.splice(0, mergedSessions.length - MAX_SESSIONS)
      }

      // ─── 6. Merge copilot sessions (by id, remote wins if newer) ───────────────
      const mergedCopilot: CopilotSession[] = [...localCopilot]
      const localCpById = new Map(mergedCopilot.map((s, i) => [s.id, i]))
      for (const rc of remoteCopilot) {
        const remapped = { ...rc, bookId: remapBookId(rc.bookId) }
        const idx = localCpById.get(remapped.id)
        if (idx === undefined) {
          mergedCopilot.push(remapped)
        } else if (remapped.updatedAt > mergedCopilot[idx].updatedAt) {
          mergedCopilot[idx] = remapped
        }
      }

      // ─── 7. Remap activeBookId if needed ───────────────────────────────────────
      if (activeBookId.value && bookIdRemap.has(activeBookId.value)) {
        activeBookId.value = bookIdRemap.get(activeBookId.value)!
      }

      // ─── 8. Update state and persist ───────────────────────────────────────────
      books.value = mergedBooks
      collections.value = mergedCollections
      progress.value = mergedProgress
      annotations.value = mergedAnnotations
      sessions.value = mergedSessions
      copilotSessions.value = mergedCopilot

      save(LS_BOOKS, books.value)
      save(LS_COLLECTIONS, collections.value)
      save(LS_PROGRESS, progress.value)
      save(LS_ANNOTATIONS, annotations.value)
      save(LS_SESSIONS, sessions.value)
      save(LS_COPILOT, copilotSessions.value)

      // Pre-download EPUB files for newly discovered remote books.
      // Use the remote book ID to request the file (so the server can locate it),
      // but save to the local filePath (so the merged book record stays consistent).
      const remoteBookMap = new Map(remoteBooks.map(b => [bookFingerprint(b), b]))
      for (const b of mergedBooks) {
        const fp = bookFingerprint(b)
        const remoteBook = remoteBookMap.get(fp)
        if (remoteBook) {
          const downloadTarget: Book =
            remoteBook.id === b.id ? b : { ...remoteBook, filePath: b.filePath }
          readBookFile(downloadTarget).catch(() => {})
        }
      }

      // Push books that exist locally but are missing from the server
      const localOnlyBooks = localBooks.filter(lb => !remoteBooks.some(rb => bookFingerprint(rb) === bookFingerprint(lb)))
      if (localOnlyBooks.length > 0) {
        pushToServer().catch(() => {})
        for (const b of localOnlyBooks) pushBookFileToServer(b).catch(() => {})
      }

      // Settings (remote wins)
      if (r.ttsSettings) {
        ttsSettings.value = { ...DEFAULT_TTS_SETTINGS, ...r.ttsSettings }
        save(LS_TTS_SETTINGS, ttsSettings.value)
      }
      if (r.settings) {
        settings.value = normalizeSettings(r.settings)
        save(LS_SETTINGS, settings.value)
      }
      if (r.ttsJobStates && typeof r.ttsJobStates === 'object') {
        const remappedJobs: Record<string, BookTtsJobState> = {}
        for (const [key, val] of Object.entries({ ...ttsJobStates.value, ...r.ttsJobStates })) {
          remappedJobs[remapBookId(key)] = val
        }
        ttsJobStates.value = remappedJobs
        save(LS_TTS_JOBS, ttsJobStates.value)
      }
      // Merge ebook copilot daily stats (take max for each date)
      if (r.copilotStats && typeof r.copilotStats === 'object') {
        try {
          const statsPath = `${await resolveDataRoot()}/ebook-copilot-stats.json`
          let localStats: Record<string, EbookCopilotDailyStat> = {}
          try { if (await exists(statsPath)) localStats = JSON.parse(await readTextFile(statsPath)) } catch {}
          for (const [date, remote] of Object.entries(r.copilotStats)) {
            const local = localStats[date]
            if (!local) {
              localStats[date] = remote
            } else {
              localStats[date] = {
                inputTokens:  Math.max(local.inputTokens, remote.inputTokens),
                outputTokens: Math.max(local.outputTokens, remote.outputTokens),
                costUsd:      Math.max(local.costUsd, remote.costUsd),
                requests:     Math.max(local.requests, remote.requests),
              }
            }
          }
          await writeTextFile(statsPath, JSON.stringify(localStats))
        } catch { /* non-critical */ }
      }
      // Merge TTS playback positions (local wins per book, with remapping)
      if (r.ttsPlaybackPos && typeof r.ttsPlaybackPos === 'object') {
        const remappedPlayback: Record<string, TtsPlaybackPos> = {}
        for (const [key, val] of Object.entries({ ...r.ttsPlaybackPos, ...ttsPlaybackPos.value })) {
          remappedPlayback[remapBookId(key)] = val
        }
        ttsPlaybackPos.value = remappedPlayback
        save(LS_TTS_PLAYBACK, ttsPlaybackPos.value)
      }
      storageUsed.value = remote.storageUsed ?? 0
    } catch { /* ignore */ }
  }

  return {
    // State
    books, progress, annotations, sessions, settings, collections,
    copilotSessions,
    activeBookId, activeBook,
    // Library
    addBook, updateBook, removeBook, setActiveBook,
    // File I/O
    readBookFile, importBookFile,
    // Progress
    saveProgress, getProgress,
    // Annotations
    addAnnotation, updateAnnotation, removeAnnotation, getAnnotations,
    // Sessions
    commitSession, getSessionHeatmap, getTotalReadingMinutes, getCurrentStreak,
    getTodayReadingMinutes, getWeeklyAvgMinutes, getMonthlyAvgMinutes, getYearlyAvgMinutes,
    // Collections & status
    addCollection, removeCollection, setBookCollection, setReadStatus,
    // Settings
    updateSettings,
    ttsSettings, updateTtsSettings,
    storageUsed,
    // TTS generation jobs
    ttsJobStates, updateTtsJob, getTtsJob, clearAudiobook,
    // TTS playback position
    ttsPlaybackPos, setTtsPlaybackPos, getTtsPlaybackPos,
    // Copilot
    saveCopilotSession, getCopilotSessions, deleteCopilotSession,
    // Sync
    pushToServer, syncFromServer,
  }
})
