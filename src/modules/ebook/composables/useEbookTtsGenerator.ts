/**
 * Background TTS pre-generation for entire ebooks.
 *
 * Flow:
 *   1. Load the EPUB → extract text from every spine item
 *   2. Split each chapter into fixed-size chunks (user-configurable)
 *   3. For each chunk: check Tauri FS for an existing WAV file
 *      (ebook-tts/{bookId}/{chapterIdx}_{partIdx}.wav)
 *   4. Generate missing chunks via POST /audio/speech → save to FS → upload to backend
 *
 * Resume: on restart, re-extract chapters, re-split with the current chunkSize, then
 *         list the ebook-tts/{bookId}/ directory to find which files already exist.
 *         Only missing chunks are generated, so partial runs continue seamlessly.
 *
 * The composable is effectively a singleton — _controllers is module-level so active
 * jobs survive component mount/unmount cycles within a session.
 */

// @ts-ignore – epubjs ships its own typedefs but they can be incomplete
import ePub from 'epubjs'
import { readDir, writeFile, mkdir, exists, readTextFile } from '@tauri-apps/plugin-fs'
import { BaseDirectory } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useEbookStore } from '../../../stores/ebook'
import { useAiSettingsStore } from '../../../stores/aiSettings'
import { apiPutBinary, apiGetBinary, isBackendConfigured } from '../../../services/api'
import { beginSyncOp, endSyncOp } from '../../../stores/syncStatus'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChunkRef { chapterIdx: number; partIdx: number; text: string }
interface JobControl { shouldStop: boolean }

// ─── Module-level singleton state ─────────────────────────────────────────────
// Survives component remounts so background generation continues uninterrupted.

const _controllers = new Map<string, JobControl>()

// ─── FS helpers ───────────────────────────────────────────────────────────────

function fsPath(bookId: string, chapterIdx: number, partIdx: number): string {
  return `ebook-tts/${bookId}/${chapterIdx}_${partIdx}.wav`
}

function manifestPath(bookId: string, chapterIdx: number): string {
  return `ebook-tts/${bookId}/${chapterIdx}.json`
}

/** List all generated WAV filenames for a book in one FS call. */
async function listDoneFiles(bookId: string): Promise<Set<string>> {
  try {
    const entries = await readDir(`ebook-tts/${bookId}`, { baseDir: BaseDirectory.AppData })
    return new Set(
      entries
        .map(e => e.name ?? '')
        .filter(n => n.endsWith('.wav')),
    )
  } catch { return new Set() }
}

async function saveWav(bookId: string, chapterIdx: number, partIdx: number, data: Uint8Array): Promise<void> {
  await mkdir(`ebook-tts/${bookId}`, { baseDir: BaseDirectory.AppData, recursive: true })
  await writeFile(fsPath(bookId, chapterIdx, partIdx), data, { baseDir: BaseDirectory.AppData })
}

async function uploadToBackend(
  bookId: string, chapterIdx: number, partIdx: number, data: Uint8Array,
): Promise<void> {
  if (!isBackendConfigured()) return
  try {
    await apiPutBinary(
      `/api/ebook/tts/${encodeURIComponent(bookId)}/${chapterIdx}/${partIdx}`,
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      'audio/wav',
    )
  } catch { /* non-critical */ }
}

async function fetchFromBackend(bookId: string, chapterIdx: number, partIdx: number): Promise<Uint8Array | null> {
  if (!isBackendConfigured()) return null
  try {
    const result = await apiGetBinary(`/api/ebook/tts/${encodeURIComponent(bookId)}/${chapterIdx}/${partIdx}`)
    if (!result) {
      console.warn(`[TTS] fetchFromBackend returned null: bookId=${bookId}, chapter=${chapterIdx}, part=${partIdx}`)
    }
    return result
  } catch (err) {
    console.error(`[TTS] fetchFromBackend failed: bookId=${bookId}, chapter=${chapterIdx}, part=${partIdx}`, err)
    return null
  }
}

// ─── Text extraction ──────────────────────────────────────────────────────────

function nodeToText(doc: Document): string {
  const body = doc.querySelector('body')
  if (!body) return ''
  const clone = body.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script,style,[aria-hidden="true"]').forEach(el => el.remove())
  const text = clone.innerText ?? clone.textContent ?? ''
  // Preserve newlines (paragraph boundaries) but collapse horizontal whitespace
  return text.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

async function extractChapters(
  bookId: string,
): Promise<Array<{ chapterIdx: number; text: string }>> {
  const store = useEbookStore()
  const book = store.books.find(b => b.id === bookId)
  if (!book) return []
  const fileData = await store.readBookFile(book)
  if (!fileData) return []

  const epubBook = ePub(fileData)
  await epubBook.ready

  const result: Array<{ chapterIdx: number; text: string }> = []
  const spineItems: unknown[] = (epubBook.spine as unknown as { items: unknown[] })?.items ?? []
  // Access the zip archive directly to avoid epubjs's CSS-replacement hooks,
  // which fail when there's no rendition (this.resources.replaceCss error).
  const archive = (epubBook as unknown as {
    archive?: { getText: (url: string) => Promise<string | undefined> }
  }).archive

  for (let i = 0; i < spineItems.length; i++) {
    const item = spineItems[i] as { url?: string; href?: string }
    try {
      const url = item.url || item.href || ''
      if (!url) continue
      const html = archive ? await archive.getText(url) : undefined
      if (!html) continue
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const text = nodeToText(doc)
      if (text.length > 10) result.push({ chapterIdx: i, text })
    } catch { /* skip failed chapters */ }
  }

  try { (epubBook as { destroy?: () => void }).destroy?.() } catch {}
  return result
}

// ─── Text splitting ───────────────────────────────────────────────────────────

// Safety cap: paragraphs longer than this are split at sentence boundaries.
const MAX_PARA_CHARS = 500

function splitByParagraphs(text: string): string[] {
  const paragraphs = text
    .split(/\n+/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0)

  const result: string[] = []
  for (const para of paragraphs) {
    if (para.length <= MAX_PARA_CHARS) {
      result.push(para)
    } else {
      // Oversized paragraph: cut at sentence boundaries
      let remaining = para
      while (remaining.length > MAX_PARA_CHARS) {
        let cutAt = -1
        for (const sep of ['。', '！', '？', '…', '. ', '! ', '? ']) {
          const pos = remaining.lastIndexOf(sep, MAX_PARA_CHARS)
          if (pos > MAX_PARA_CHARS * 0.3) { cutAt = pos + sep.length; break }
        }
        if (cutAt <= 0) cutAt = MAX_PARA_CHARS
        result.push(remaining.slice(0, cutAt).trim())
        remaining = remaining.slice(cutAt).trim()
      }
      if (remaining) result.push(remaining)
    }
  }
  return result.filter(c => c.length > 0)
}

// ─── TTS API call ─────────────────────────────────────────────────────────────

async function callTts(
  text: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  voice: string,
  speed: number,
): Promise<Uint8Array | null> {
  try {
    const resp = await tauriFetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        input: text,
        ...(voice ? { voice } : {}),
        speed,
      }),
    })
    if (!resp.ok) return null
    const buf = await resp.arrayBuffer()
    return new Uint8Array(buf)
  } catch { return null }
}

// ─── Composable ───────────────────────────────────────────────────────────────

export function useEbookTtsGenerator() {
  const ebookStore  = useEbookStore()
  const aiStore     = useAiSettingsStore()

  /** Start or resume generation for a book. Safe to call when already running — it's a no-op. */
  async function startGeneration(bookId: string): Promise<void> {
    if (_controllers.has(bookId)) return   // already running

    const ts       = ebookStore.ttsSettings
    const provider = aiStore.providers.find(p => p.id === ts.providerId)
    if (!provider) return

    const ctrl: JobControl = { shouldStop: false }
    _controllers.set(bookId, ctrl)

    ebookStore.updateTtsJob(bookId, {
      status: 'running', phase: 'extracting',
      totalChunks: 0, doneChunks: 0, currentChapter: 0, totalChapters: 0,
    })

    try {
      // ── Phase 1: extract text ─────────────────────────────────────────────
      const chapters = await extractChapters(bookId)
      if (ctrl.shouldStop) { _finish(bookId, 'paused'); return }
      if (chapters.length === 0) {
        ebookStore.updateTtsJob(bookId, {
          status: 'error', phase: 'idle',
          errorMsg: '无法提取文本，请确认文件为有效 EPUB',
        })
        _controllers.delete(bookId)
        return
      }

      // ── Phase 2: build full chunk list + save manifests ───────────────────
      const allChunks: ChunkRef[] = []
      for (const ch of chapters) {
        const texts = splitByParagraphs(ch.text)
        // Save manifest with chunk texts for highlighting during playback
        await saveManifest(bookId, ch.chapterIdx, texts).catch(() => {})
        texts.forEach((text, partIdx) => {
          allChunks.push({ chapterIdx: ch.chapterIdx, partIdx, text })
        })
      }
      const total = allChunks.length
      ebookStore.updateTtsJob(bookId, {
        phase: 'scanning', totalChunks: total, totalChapters: chapters.length,
      })

      if (ctrl.shouldStop) { _finish(bookId, 'paused'); return }

      // ── Phase 3: scan FS for already-done chunks (one readDir call) ────────
      const doneFiles = await listDoneFiles(bookId)
      let done = allChunks.filter(c => doneFiles.has(`${c.chapterIdx}_${c.partIdx}.wav`)).length
      ebookStore.updateTtsJob(bookId, { phase: 'generating', doneChunks: done })

      // ── Phase 4: generate missing chunks ─────────────────────────────────
      for (const chunk of allChunks) {
        if (ctrl.shouldStop) break
        if (doneFiles.has(`${chunk.chapterIdx}_${chunk.partIdx}.wav`)) continue

        ebookStore.updateTtsJob(bookId, { currentChapter: chunk.chapterIdx })

        const wav = await callTts(
          chunk.text,
          provider.baseUrl, provider.apiKey,
          ts.modelId, ts.voice, ts.speed,
        )
        if (ctrl.shouldStop) break

        if (wav) {
          await saveWav(bookId, chunk.chapterIdx, chunk.partIdx, wav)
          doneFiles.add(`${chunk.chapterIdx}_${chunk.partIdx}.wav`)
          done++
          ebookStore.updateTtsJob(bookId, { doneChunks: done })
          // Upload to backend and show sync icon while in-flight
          beginSyncOp()
          uploadToBackend(bookId, chunk.chapterIdx, chunk.partIdx, wav)
            .catch(() => {})
            .finally(() => endSyncOp())
        }
      }

      _finish(bookId, done >= total && !ctrl.shouldStop ? 'complete' : 'paused')
    } catch (e) {
      ebookStore.updateTtsJob(bookId, {
        status: 'error', phase: 'idle',
        errorMsg: e instanceof Error ? e.message : String(e),
      })
      _controllers.delete(bookId)
    }
  }

  function _finish(bookId: string, status: 'paused' | 'complete') {
    _controllers.delete(bookId)
    ebookStore.updateTtsJob(bookId, { status, phase: 'idle' })
  }

  /** Signal the running loop to stop after the current chunk. */
  function pauseGeneration(bookId: string) {
    const ctrl = _controllers.get(bookId)
    if (ctrl) { ctrl.shouldStop = true }
    else { ebookStore.updateTtsJob(bookId, { status: 'paused', phase: 'idle' }) }
  }

  /** Re-scan the FS to recount done chunks (e.g. after a partial run). */
  async function rescanProgress(bookId: string): Promise<void> {
    const chapters  = await extractChapters(bookId)
    const doneFiles = await listDoneFiles(bookId)
    let total = 0
    let done  = 0
    for (const ch of chapters) {
      splitByParagraphs(ch.text).forEach((_, pi) => {
        total++
        if (doneFiles.has(`${ch.chapterIdx}_${pi}.wav`)) done++
      })
    }
    ebookStore.updateTtsJob(bookId, {
      totalChunks: total, doneChunks: done, totalChapters: chapters.length,
      status: done >= total && total > 0 ? 'complete' : 'paused',
    })
  }

  function isRunning(bookId: string): boolean { return _controllers.has(bookId) }

  /** Save chunk text manifest for a chapter. */
  async function saveManifest(bookId: string, chapterIdx: number, texts: string[]): Promise<void> {
    await mkdir(`ebook-tts/${bookId}`, { baseDir: BaseDirectory.AppData, recursive: true })
    await writeFile(
      manifestPath(bookId, chapterIdx),
      new TextEncoder().encode(JSON.stringify({ chunks: texts })),
      { baseDir: BaseDirectory.AppData },
    )
  }

  /** Load chunk texts for a chapter. */
  async function getChapterChunkTexts(bookId: string, chapterIdx: number): Promise<string[]> {
    try {
      const path = manifestPath(bookId, chapterIdx)
      if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) return []
      const data = await readTextFile(path, { baseDir: BaseDirectory.AppData })
      const parsed = JSON.parse(data) as { chunks?: string[] }
      return parsed.chunks ?? []
    } catch { return [] }
  }

  /** Load a pre-generated chunk audio as an object URL (caller must revoke). */
  async function getChunkUrl(bookId: string, chapterIdx: number, partIdx: number): Promise<string | null> {
    const path = fsPath(bookId, chapterIdx, partIdx)
    try {
      const localExists = await exists(path, { baseDir: BaseDirectory.AppData })
      if (!localExists) {
        console.log(`[TTS] Local chunk missing, fetching from backend: ${path}`)
        const remote = await fetchFromBackend(bookId, chapterIdx, partIdx)
        if (!remote) return null
        await saveWav(bookId, chapterIdx, partIdx, remote)
        console.log(`[TTS] Downloaded and saved: ${path} (${remote.byteLength} bytes)`)
      }
      const { readFile } = await import('@tauri-apps/plugin-fs')
      const data = await readFile(path, { baseDir: BaseDirectory.AppData })
      return URL.createObjectURL(new Blob([data], { type: 'audio/wav' }))
    } catch (err) {
      console.error(`[TTS] getChunkUrl failed: ${path}`, err)
      return null
    }
  }

  /** Return all pre-generated part URLs for a chapter (caller must revoke each). */
  async function getChapterAudioUrls(bookId: string, chapterIdx: number): Promise<string[]> {
    const urls: string[] = []
    for (let partIdx = 0; ; partIdx++) {
      const url = await getChunkUrl(bookId, chapterIdx, partIdx)
      if (!url) break
      urls.push(url)
    }
    return urls
  }

  return { startGeneration, pauseGeneration, rescanProgress, isRunning, getChunkUrl, getChapterAudioUrls, getChapterChunkTexts }
}
