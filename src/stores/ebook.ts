/**
 * Ebook Store
 * Books, reading progress, annotations, and reading sessions.
 * Local-first (localStorage + Tauri FS) with optional backend sync.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { readFile, writeFile, mkdir, exists, remove, copyFile, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
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
  chunkSize:  number   // chars per audio segment for pre-generation, >10, default 30
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
  chunkSize:  30,
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
  const ttsJobStates = ref<Record<string, BookTtsJobState>>(_rawTtsJobs)

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
  }

  interface EbookLibraryResponse {
    value: EbookServerPayload
    storageUsed?: number
  }

  async function pushToServer(): Promise<void> {
    if (!isBackendConfigured()) return
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
    }
    await apiPut('/api/ebook/library', { value: payload }).catch(() => {})
  }

  async function syncFromServer(): Promise<void> {
    if (!isBackendConfigured()) return
    try {
      const remote = await apiGet<EbookLibraryResponse>('/api/ebook/library')
      if (!remote?.value) {
        await pushToServer()
        return
      }
      const r = remote.value
      // Merge books: remote wins for existing, add missing
      const localIds = new Set(books.value.map(b => b.id))
      for (const rb of r.books ?? []) {
        if (!localIds.has(rb.id)) {
          books.value.push(rb)
          // Note: book file is not synced (too large) — user re-imports on new device
        } else {
          const idx = books.value.findIndex(b => b.id === rb.id)
          if (idx >= 0 && rb.lastReadAt && rb.lastReadAt > (books.value[idx].lastReadAt ?? 0)) {
            books.value[idx] = { ...books.value[idx], ...rb, filePath: books.value[idx].filePath }
          }
        }
      }
      // Merge progress (remote wins if newer)
      for (const [bid, rp] of Object.entries(r.progress ?? {})) {
        const lp = progress.value[bid]
        if (!lp || rp.updatedAt > lp.updatedAt) {
          progress.value[bid] = rp
        }
      }
      // Merge annotations (add missing)
      const localAnnIds = new Set(annotations.value.map(a => a.id))
      for (const ra of r.annotations ?? []) {
        if (!localAnnIds.has(ra.id)) annotations.value.push(ra)
      }
      // Merge reading sessions (add missing by id)
      const localSessIds = new Set(sessions.value.map(s => s.id))
      for (const rs of r.sessions ?? []) {
        if (!localSessIds.has(rs.id)) sessions.value.push(rs)
      }
      if (sessions.value.length > MAX_SESSIONS) {
        sessions.value = sessions.value.slice(-MAX_SESSIONS)
      }
      // Merge collections
      const localColIds = new Set(collections.value.map(c => c.id))
      for (const rc of r.collections ?? []) {
        if (!localColIds.has(rc.id)) collections.value.push(rc)
      }
      // Merge copilot sessions (add missing by id, remote wins if newer)
      const localCpIds = new Set(copilotSessions.value.map(s => s.id))
      for (const rc of r.copilotSessions ?? []) {
        if (!localCpIds.has(rc.id)) {
          copilotSessions.value.push(rc)
        } else {
          const idx = copilotSessions.value.findIndex(s => s.id === rc.id)
          if (idx >= 0 && rc.updatedAt > copilotSessions.value[idx].updatedAt) {
            copilotSessions.value[idx] = rc
          }
        }
      }
      if (r.ttsSettings) {
        ttsSettings.value = { ...DEFAULT_TTS_SETTINGS, ...r.ttsSettings }
        save(LS_TTS_SETTINGS, ttsSettings.value)
      }
      if (r.settings) {
        settings.value = normalizeSettings(r.settings)
        save(LS_SETTINGS, settings.value)
      }
      if (r.ttsJobStates) {
        ttsJobStates.value = { ...ttsJobStates.value, ...r.ttsJobStates }
        save(LS_TTS_JOBS, ttsJobStates.value)
      }
      storageUsed.value = remote.storageUsed ?? 0
      save(LS_BOOKS, books.value)
      save(LS_PROGRESS, progress.value)
      save(LS_ANNOTATIONS, annotations.value)
      save(LS_SESSIONS, sessions.value)
      save(LS_COLLECTIONS, collections.value)
      save(LS_COPILOT, copilotSessions.value)
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
    ttsJobStates, updateTtsJob, getTtsJob,
    // Copilot
    saveCopilotSession, getCopilotSessions, deleteCopilotSession,
    // Sync
    pushToServer, syncFromServer,
  }
})
