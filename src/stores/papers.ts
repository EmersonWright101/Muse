import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { writeFile, mkdir, exists, remove } from '@tauri-apps/plugin-fs'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { getBackendConfig, setBackendConfig } from '../utils/backendConfig'
import { tmpDir } from '../utils/path'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaperConfig {
  llm_provider: string
  llm_model: string
  llm_api_key: string
  llm_base_url: string
  llm_max_tokens: number
  llm_temperature: number
  arxiv_categories: string[]
  max_results: number
  interested_topics: string[]
  analysis_prompt: string
  scheduler_enabled: boolean
  scheduler_hour: number
  scheduler_minute: number
  scheduler_timezone: string
  auto_analyze: boolean
  relevance_threshold: number
  updated_at: string | null
}

export interface Paper {
  id: string
  title: string
  abstract: string
  authors: string[]
  categories: string[]
  primary_category: string
  published_at: string
  updated_at_source: string | null
  comment: string | null
  journal_ref: string | null
  doi: string | null
  source_url: string
  pdf_url: string
  analyzed: boolean
  relevance_score: number | null
  relevance_reason: string | null
  key_contributions: string[]
  ai_summary: string | null
  analyzed_at: string | null
  pdf_downloaded: boolean
  crawled_at: string
  fetch_date: string
  source: string
  good?: boolean | null
  tags?: string[]
  matched_tags?: string[]
  upvotes?: number | null
  read?: boolean
  favorite?: boolean
  deleted?: boolean
  deleted_at?: string | null
}

export interface CrawlJob {
  id: number
  started_at: string
  finished_at: string | null
  status: 'running' | 'done' | 'failed'
  categories: string[]
  papers_fetched: number
  papers_new: number
  papers_analyzed: number
  error_message: string | null
  triggered_by: string
  source?: string
}

export interface SchedulerStatus {
  enabled: boolean
  hour: number
  minute: number
  timezone: string
  next_run: string | null
  is_running: boolean
}

export interface PaperStats {
  total_papers: number
  analyzed_papers: number
  pdfs_stored: number
  last_crawl_at: string | null
  last_crawl_status: string | null
}

export interface PaperDashboard {
  total_papers: number
  total_ever_crawled: number
  analyzed_papers: number
  unanalyzed_papers: number
  good_papers: number
  pdfs_stored: number
  pdf_bytes: number
  db_size_bytes: number
  total_tokens_input: number
  total_tokens_output: number
  total_tokens: number
  api_requests_count: number
  cost_usd: number
}

export interface PaperSourceStat {
  source: string
  total: number
  analyzed: number
  last_crawl_at: string | null
  last_crawl_status: string | null
}

export interface PaperAnalysisProvider {
  id: number
  name: string
  model: string
  base_url: string
  price_input_usd_per_m: number
  price_output_usd_per_m: number
}

export interface PaperStatistics {
  dashboard: PaperDashboard
  sources: PaperSourceStat[]
  analysis_provider: PaperAnalysisProvider
  last_crawl_source: string | null
}

export interface PaperSource {
  source: string
  total: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const PAPERS_CHANNEL_ID = '__arxiv_push__'

// ─── Store ────────────────────────────────────────────────────────────────────

function loadConn() {
  const c = getBackendConfig()
  return { baseUrl: c?.url ?? '', apiKey: c?.apiKey ?? '' }
}

export const usePapersStore = defineStore('papers', () => {
  const c = loadConn()
  const baseUrl = ref(c.baseUrl)
  const apiKey  = ref(c.apiKey)

  const isConfigured = computed(() => !!baseUrl.value)


  // Push channel papers
  const pushPapers     = ref<Paper[]>([])
  const pushDate       = ref(new Date().toISOString().slice(0, 10))
  const pushTotal      = ref(0)
  const isFetchingPush = ref(false)
  const pushError      = ref('')

  // Time range mode
  const pushMode     = ref<'today' | '1d' | '1w' | '1m' | 'custom'>('today')
  const pushDateFrom = ref(new Date().toISOString().slice(0, 10))
  const pushDateTo   = ref(new Date().toISOString().slice(0, 10))

  // Per-paper analyzing state
  const analyzingIds = ref<Set<string>>(new Set())

  // Per-paper download progress (server-side download)
  interface DownloadProgress {
    status: string
    downloaded: number
    total: number
    percent: number
  }
  const downloadProgress = ref<Map<string, DownloadProgress>>(new Map())

  // Per-paper fetch progress (client-side fetch from server)
  interface PdfFetchProgress {
    status: 'fetching' | 'done' | 'error'
    downloaded: number
    total: number
    percent: number
  }
  const pdfFetchProgress = ref<Map<string, PdfFetchProgress>>(new Map())

  // Crawl state
  const isCrawling  = ref(false)
  const crawlJobs   = ref<CrawlJob[]>([])

  // Sources
  const sources        = ref<PaperSource[]>([])
  const selectedSource = ref<string | null>(null)

  // Stats & Scheduler
  const stats     = ref<PaperStats | null>(null)
  const scheduler = ref<SchedulerStatus | null>(null)

  // Paper statistics (/api/papers/statistics)
  const paperStatistics = ref<PaperStatistics | null>(null)
  const isFetchingPaperStats = ref(false)
  const paperStatsError = ref('')

  // Trash / Recently deleted
  const deletedPapers     = ref<Paper[]>([])
  const isFetchingDeleted = ref(false)
  const deletedError      = ref('')

  // Toast notification
  const toast = ref<{ msg: string; type: 'ok' | 'err' | 'info' } | null>(null)

  // ─── Connection ──────────────────────────────────────────────────────────────

  function persistConn() {
    setBackendConfig({ url: baseUrl.value, apiKey: apiKey.value })
  }

  function reloadConn() {
    const c = loadConn()
    baseUrl.value = c.baseUrl
    apiKey.value  = c.apiKey
  }

  // ─── HTTP ────────────────────────────────────────────────────────────────────

  function makeHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${apiKey.value}`, 'Content-Type': 'application/json' }
  }

  async function apiFetch(path: string, init: RequestInit = {}) {
    return tauriFetch(`${baseUrl.value}/api/papers${path}`, {
      ...init,
      headers: { ...makeHeaders(), ...(init.headers as Record<string, string> ?? {}) },
    })
  }

  function showToast(msg: string, type: 'ok' | 'err' | 'info' = 'info') {
    toast.value = { msg, type }
    setTimeout(() => { toast.value = null }, 3500)
  }

  // ─── Push papers ─────────────────────────────────────────────────────────────

  async function fetchSources() {
    if (!isConfigured.value) return
    try {
      const r = await apiFetch('/sources')
      if (r.ok) sources.value = await r.json()
    } catch { /* ignore */ }
  }

  async function fetchPushPapers(date?: string) {
    if (!isConfigured.value) return
    if (date) { pushDate.value = date; pushMode.value = 'today' }
    isFetchingPush.value = true
    pushError.value = ''
    const p = new URLSearchParams({
      page: '1',
      page_size: '100',
      sort_by: 'relevance_score',
      sort_order: 'desc',
    })
    if (pushMode.value === 'today') {
      p.set('fetch_date', pushDate.value)
    } else if (pushMode.value === 'custom') {
      if (pushDateFrom.value) p.set('date_from', pushDateFrom.value)
      if (pushDateTo.value)   p.set('date_to',   pushDateTo.value)
    } else {
      p.set('time_range', pushMode.value)
    }
    if (selectedSource.value) p.set('source', selectedSource.value)
    try {
      const r = await apiFetch(`/papers?${p}`)
      if (r.ok) {
        const d = await r.json()
        pushPapers.value = d.papers ?? []
        pushTotal.value  = d.total  ?? 0
      } else {
        pushError.value = `获取论文失败 (${r.status})`
      }
    } catch {
      pushError.value = '网络错误，请检查后端连接'
    } finally {
      isFetchingPush.value = false
    }
  }

  async function selectSource(source: string | null) {
    selectedSource.value = source
    await fetchPushPapers()
  }

  async function fetchDeletedPapers() {
    if (!isConfigured.value) return
    isFetchingDeleted.value = true
    deletedError.value = ''
    try {
      const r = await apiFetch('/papers?include_deleted=true')
      if (r.ok) {
        const d = await r.json()
        deletedPapers.value = (d.papers ?? []).filter((p: Paper) => p.deleted)
      } else {
        deletedError.value = `获取回收站失败 (${r.status})`
      }
    } catch {
      deletedError.value = '网络错误'
    } finally {
      isFetchingDeleted.value = false
    }
  }

  async function softDeletePaper(paperId: string, source = 'arxiv') {
    if (!isConfigured.value) return
    try {
      const r = await apiFetch(`/papers/${paperId}/deleted?deleted=true&source=${source}`, { method: 'PUT' })
      if (r.ok) {
        const idx = pushPapers.value.findIndex(p => p.id === paperId)
        if (idx >= 0) pushPapers.value.splice(idx, 1)
        showToast('已移入回收站', 'info')
        fetchDeletedPapers()
      } else showToast('删除失败', 'err')
    } catch { showToast('网络错误', 'err') }
  }

  async function restorePaper(paperId: string, source = 'arxiv') {
    if (!isConfigured.value) return
    try {
      const r = await apiFetch(`/papers/${paperId}/deleted?deleted=false&source=${source}`, { method: 'PUT' })
      if (r.ok) {
        const idx = deletedPapers.value.findIndex(p => p.id === paperId)
        if (idx >= 0) deletedPapers.value.splice(idx, 1)
        await fetchPushPapers()
        showToast('已恢复', 'ok')
      } else showToast('恢复失败', 'err')
    } catch { showToast('网络错误', 'err') }
  }

  // Toggle: clicking the same value again cancels it (→ null); clicking the opposite switches.
  async function togglePaperGood(paperId: string, value: boolean, source = 'arxiv') {
    if (!isConfigured.value) return
    const paper = pushPapers.value.find(p => p.id === paperId)
    const cancel = paper?.good === value
    try {
      if (cancel) {
        const r = await apiFetch(`/papers/${paperId}/good?source=${source}`, { method: 'DELETE' })
        if (r.ok) {
          const idx = pushPapers.value.findIndex(p => p.id === paperId)
          if (idx >= 0) pushPapers.value[idx] = { ...pushPapers.value[idx], good: null }
        }
      } else {
        const r = await apiFetch(`/papers/${paperId}/good?good=${value}&source=${source}`, { method: 'PUT' })
        if (r.ok) {
          const updated: Paper = await r.json()
          const idx = pushPapers.value.findIndex(p => p.id === paperId)
          if (idx >= 0) pushPapers.value[idx] = updated
        }
      }
    } catch { /* ignore */ }
  }

  async function markRead(paperId: string, source = 'arxiv') {
    if (!isConfigured.value) return
    const paper = pushPapers.value.find(p => p.id === paperId)
    if (paper?.read) return
    try {
      const r = await apiFetch(`/papers/${paperId}/read?read=true&source=${source}`, { method: 'PUT' })
      if (r.ok) {
        const updated: Paper = await r.json()
        const idx = pushPapers.value.findIndex(p => p.id === paperId)
        if (idx >= 0) pushPapers.value[idx] = updated
      }
    } catch { /* ignore */ }
  }

  async function toggleFavorite(paperId: string, source = 'arxiv') {
    if (!isConfigured.value) return
    const paper = pushPapers.value.find(p => p.id === paperId)
    const isFav = paper?.favorite ?? false
    try {
      if (isFav) {
        const r = await apiFetch(`/papers/${paperId}/favorite?source=${source}`, { method: 'DELETE' })
        if (r.ok) {
          const idx = pushPapers.value.findIndex(p => p.id === paperId)
          if (idx >= 0) pushPapers.value[idx] = { ...pushPapers.value[idx], favorite: false }
        }
      } else {
        const r = await apiFetch(`/papers/${paperId}/favorite?favorite=true&source=${source}`, { method: 'PUT' })
        if (r.ok) {
          const updated: Paper = await r.json()
          const idx = pushPapers.value.findIndex(p => p.id === paperId)
          if (idx >= 0) pushPapers.value[idx] = updated
        }
      }
    } catch { /* ignore */ }
  }

  // ─── Analyze ─────────────────────────────────────────────────────────────────

  async function analyzePaper(id: string, source = 'arxiv'): Promise<boolean> {
    if (!isConfigured.value) return false
    const ids = new Set(analyzingIds.value); ids.add(id); analyzingIds.value = ids
    try {
      const r = await apiFetch(`/papers/${id}/analyze?source=${source}`, { method: 'POST' })
      if (r.ok) {
        const updated: Paper = await r.json()
        const idx = pushPapers.value.findIndex(p => p.id === id)
        if (idx >= 0) pushPapers.value[idx] = updated
        showToast('AI 分析完成', 'ok')
        return true
      }
      showToast('分析失败：' + r.status, 'err')
    } catch { showToast('网络错误', 'err') }
    finally {
      const ids2 = new Set(analyzingIds.value); ids2.delete(id); analyzingIds.value = ids2
    }
    return false
  }

  async function analyzeAll(opts?: { paper_ids?: string[]; force?: boolean }) {
    if (!isConfigured.value) return
    try {
      const r = await apiFetch('/analyze', { method: 'POST', body: JSON.stringify(opts ?? {}) })
      if (r.ok) showToast('批量分析已在后台运行', 'info')
      else showToast('分析请求失败', 'err')
    } catch { showToast('网络错误', 'err') }
  }

  // ─── Crawl ────────────────────────────────────────────────────────────────────

  async function crawlNow(opts?: {
    categories?: string[]
    date_from?: string
    date_to?: string
    max_results?: number
    auto_analyze?: boolean
  }) {
    if (!isConfigured.value) return
    isCrawling.value = true
    try {
      const r = await apiFetch('/crawl', { method: 'POST', body: JSON.stringify(opts ?? {}) })
      if (r.ok) showToast('爬取任务已在后台启动', 'info')
      else showToast('爬取请求失败：' + r.status, 'err')
    } catch { showToast('网络错误', 'err') }
    finally { isCrawling.value = false }
  }

  async function fetchCrawlJobs(limit = 20) {
    if (!isConfigured.value) return
    try {
      const r = await apiFetch(`/crawl/jobs?limit=${limit}`)
      if (r.ok) crawlJobs.value = await r.json()
    } catch { /* ignore */ }
  }

  // ─── PDF ─────────────────────────────────────────────────────────────────────

  async function downloadPdf(id: string, source = 'arxiv') {
    if (!isConfigured.value) return

    const setProgress = (data: DownloadProgress) => {
      const m = new Map(downloadProgress.value); m.set(id, data); downloadProgress.value = m
    }
    const clearProgress = () => {
      const m = new Map(downloadProgress.value); m.delete(id); downloadProgress.value = m
    }

    setProgress({ status: 'downloading', downloaded: 0, total: 0, percent: 0 })
    try {
      const sseRes = await tauriFetch(
        `${baseUrl.value}/api/papers/papers/${id}/pdf/progress?source=${source}`,
        { headers: makeHeaders() },
      )

      if (!sseRes.ok || !sseRes.body) {
        const r = await apiFetch(`/papers/${id}/pdf?source=${source}`, { method: 'POST' })
        clearProgress()
        if (r.ok) {
          const idx = pushPapers.value.findIndex(p => p.id === id)
          if (idx >= 0) pushPapers.value[idx] = { ...pushPapers.value[idx], pdf_downloaded: true }
          showToast('PDF 已下载到服务器', 'ok')
        } else showToast('PDF 下载失败', 'err')
        return
      }

      // Fire download POST — no await, backend handles it
      apiFetch(`/papers/${id}/pdf?source=${source}`, { method: 'POST' }).catch(() => {})

      const reader = (sseRes.body as ReadableStream<Uint8Array>).getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data: DownloadProgress = JSON.parse(line.slice(6))
            setProgress(data)
            if (data.status === 'done') {
              clearProgress()
              const idx = pushPapers.value.findIndex(p => p.id === id)
              if (idx >= 0) pushPapers.value[idx] = { ...pushPapers.value[idx], pdf_downloaded: true }
              showToast('PDF 已下载', 'ok')
              return
            }
            if (data.status === 'error') {
              clearProgress()
              showToast('PDF 下载失败', 'err')
              return
            }
          } catch { /* ignore malformed events */ }
        }
      }
      clearProgress()
    } catch { clearProgress(); showToast('网络错误', 'err') }
  }

  const pdfPreviewUrl = ref<string | null>(null)

  async function openPdf(id: string, source = 'arxiv') {
    const setProgress = (data: PdfFetchProgress) => {
      const m = new Map(pdfFetchProgress.value); m.set(id, data); pdfFetchProgress.value = m
    }
    const clearProgress = () => {
      const m = new Map(pdfFetchProgress.value); m.delete(id); pdfFetchProgress.value = m
    }

    try {
      const dir = await tmpDir()
      if (!(await exists(dir))) await mkdir(dir, { recursive: true })
      // Register directory in asset protocol scope
      try { await invoke('allow_asset_directory', { path: dir }) } catch { /* ignore */ }

      const filePath = `${dir}/${id}_${source}.pdf`
      // If already cached locally, reuse it
      if (await exists(filePath)) {
        pdfPreviewUrl.value = convertFileSrc(filePath)
        return
      }

      setProgress({ status: 'fetching', downloaded: 0, total: 0, percent: 0 })

      const r = await tauriFetch(
        `${baseUrl.value}/api/papers/papers/${id}/pdf?source=${source}`,
        { headers: makeHeaders() },
      )
      if (!r.ok) { clearProgress(); showToast('PDF 暂不可用', 'err'); return }

      const contentLength = +(r.headers.get('content-length') ?? 0)
      const reader = (r.body as ReadableStream<Uint8Array> | null)?.getReader()
      if (!reader) { clearProgress(); showToast('无法读取 PDF', 'err'); return }

      const chunks: Uint8Array[] = []
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value)
          received += value.length
          const percent = contentLength > 0 ? Math.round((received / contentLength) * 100) : 0
          setProgress({ status: 'fetching', downloaded: received, total: contentLength, percent })
        }
      }

      // Merge chunks
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
      const allBytes = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        allBytes.set(chunk, offset)
        offset += chunk.length
      }

      await writeFile(filePath, allBytes)
      clearProgress()
      pdfPreviewUrl.value = convertFileSrc(filePath)
    } catch { clearProgress(); showToast('网络错误', 'err') }
  }

  async function deletePdf(id: string, source = 'arxiv') {
    if (!isConfigured.value) return
    try {
      const r = await apiFetch(`/papers/${id}/pdf?source=${source}`, { method: 'DELETE' })
      if (r.ok || r.status === 404) {
        // Also remove local cached PDF
        try {
          const dir = await tmpDir()
          const filePath = `${dir}/${id}_${source}.pdf`
          if (await exists(filePath)) await remove(filePath)
        } catch { /* ignore local cleanup errors */ }
        const idx = pushPapers.value.findIndex(p => p.id === id)
        if (idx >= 0) pushPapers.value[idx] = { ...pushPapers.value[idx], pdf_downloaded: false }
        showToast('PDF 已删除', 'ok')
      } else {
        showToast('删除 PDF 失败', 'err')
      }
    } catch { showToast('网络错误', 'err') }
  }

  function closePdfPreview() {
    pdfPreviewUrl.value = null
  }

  // ─── Stats & Scheduler ───────────────────────────────────────────────────────

  async function fetchStats() {
    if (!isConfigured.value) return
    try {
      const r = await apiFetch('/stats')
      if (r.ok) stats.value = await r.json()
    } catch { /* ignore */ }
  }

  async function fetchPaperStatistics() {
    if (!isConfigured.value) return
    isFetchingPaperStats.value = true
    paperStatsError.value = ''
    try {
      const r = await apiFetch('/statistics')
      if (r.ok) {
        paperStatistics.value = await r.json()
      } else {
        paperStatsError.value = `获取统计失败 (${r.status})`
      }
    } catch {
      paperStatsError.value = '网络错误'
    } finally {
      isFetchingPaperStats.value = false
    }
  }

  async function fetchScheduler() {
    if (!isConfigured.value) return
    try {
      const r = await apiFetch('/scheduler/status')
      if (r.ok) scheduler.value = await r.json()
    } catch { /* ignore */ }
  }

  async function pingBackend(): Promise<boolean> {
    if (!isConfigured.value) return false
    try {
      const r = await apiFetch('/ping')
      return r.ok
    } catch { return false }
  }

  return {
    baseUrl, apiKey, isConfigured, persistConn, reloadConn,
    sources, selectedSource, fetchSources, selectSource,
    pushPapers, pushDate, pushTotal, isFetchingPush, pushError, fetchPushPapers,
    pushMode, pushDateFrom, pushDateTo,
    togglePaperGood, markRead, toggleFavorite,
    analyzingIds, analyzePaper, analyzeAll,
    isCrawling, crawlNow, crawlJobs, fetchCrawlJobs,
    downloadPdf, downloadProgress, openPdf, pdfFetchProgress, pdfPreviewUrl, closePdfPreview, deletePdf,
    stats, fetchStats,
    paperStatistics, isFetchingPaperStats, paperStatsError, fetchPaperStatistics,
    scheduler, fetchScheduler, pingBackend,
    deletedPapers, isFetchingDeleted, deletedError, fetchDeletedPapers, softDeletePaper, restorePaper,
    toast,
  }
})
