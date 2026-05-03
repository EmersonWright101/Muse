import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getBackendConfig, setBackendConfig } from '../utils/backendConfig'

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
  source?: string
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
  last_crawl_source: string | null
}

export interface PaperSource {
  source: string
  total: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const PAPERS_CHANNEL_ID = '__arxiv_push__'

export const DEFAULT_ANALYSIS_PROMPT =
  '根据以下感兴趣的主题：{topics}\n\n请分析论文：\n标题：{title}\n作者：{authors}\n摘要：{abstract}\n\n请给出相关度评分（0-10）、评分理由、关键贡献（3-5条）和中文摘要。'

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

  // Backend config state
  const config       = ref<Partial<PaperConfig>>({})
  const configLoaded = ref(false)

  // Push channel papers
  const pushPapers     = ref<Paper[]>([])
  const pushDate       = ref(new Date().toISOString().slice(0, 10))
  const pushTotal      = ref(0)
  const isFetchingPush = ref(false)
  const pushError      = ref('')

  // Per-paper analyzing state
  const analyzingIds = ref<Set<string>>(new Set())

  // Crawl state
  const isCrawling  = ref(false)
  const crawlJobs   = ref<CrawlJob[]>([])

  // Sources
  const sources        = ref<PaperSource[]>([])
  const selectedSource = ref<string | null>(null)

  // Stats & Scheduler
  const stats     = ref<PaperStats | null>(null)
  const scheduler = ref<SchedulerStatus | null>(null)

  // Toast notification
  const toast = ref<{ msg: string; type: 'ok' | 'err' | 'info' } | null>(null)

  // ─── Connection ──────────────────────────────────────────────────────────────

  function persistConn() {
    setBackendConfig({ url: baseUrl.value, apiKey: apiKey.value })
  }

  // ─── HTTP ────────────────────────────────────────────────────────────────────

  function makeHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${apiKey.value}`, 'Content-Type': 'application/json' }
  }

  async function apiFetch(path: string, init: RequestInit = {}) {
    return fetch(`${baseUrl.value}/api/papers${path}`, {
      ...init,
      headers: { ...makeHeaders(), ...(init.headers as Record<string, string> ?? {}) },
    })
  }

  function showToast(msg: string, type: 'ok' | 'err' | 'info' = 'info') {
    toast.value = { msg, type }
    setTimeout(() => { toast.value = null }, 3500)
  }

  // ─── Config ──────────────────────────────────────────────────────────────────

  async function fetchConfig() {
    if (!isConfigured.value) return
    try {
      const r = await apiFetch('/config')
      if (r.ok) { config.value = await r.json(); configLoaded.value = true }
    } catch { /* ignore */ }
  }

  async function saveConfig(partial: Partial<PaperConfig>): Promise<boolean> {
    if (!isConfigured.value) return false
    try {
      const r = await apiFetch('/config', { method: 'PUT', body: JSON.stringify(partial) })
      if (r.ok) { config.value = await r.json(); showToast('配置已保存', 'ok'); return true }
      showToast('保存失败：' + r.status, 'err')
    } catch { showToast('网络错误', 'err') }
    return false
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
    if (date) pushDate.value = date
    isFetchingPush.value = true
    pushError.value = ''
    const p = new URLSearchParams({
      page: '1',
      page_size: '50',
      sort_by: 'relevance_score',
      sort_order: 'desc',
      fetch_date: pushDate.value,
    })
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

  // ─── Analyze ─────────────────────────────────────────────────────────────────

  async function analyzePaper(id: string): Promise<boolean> {
    if (!isConfigured.value) return false
    const ids = new Set(analyzingIds.value); ids.add(id); analyzingIds.value = ids
    try {
      const r = await apiFetch(`/papers/${id}/analyze`, { method: 'POST' })
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

  async function downloadPdf(id: string) {
    if (!isConfigured.value) return
    try {
      const r = await apiFetch(`/papers/${id}/pdf`, { method: 'POST' })
      if (r.ok) {
        const idx = pushPapers.value.findIndex(p => p.id === id)
        if (idx >= 0) pushPapers.value[idx] = { ...pushPapers.value[idx], pdf_downloaded: true }
        showToast('PDF 已下载到服务器', 'ok')
      } else showToast('PDF 下载失败', 'err')
    } catch { showToast('网络错误', 'err') }
  }

  async function openPdf(id: string) {
    try {
      const r = await apiFetch(`/papers/${id}/pdf`)
      if (r.ok) {
        const blob = await r.blob()
        const url  = URL.createObjectURL(blob)
        window.open(url, '_blank')
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      } else showToast('PDF 暂不可用', 'err')
    } catch { showToast('网络错误', 'err') }
  }

  // ─── Stats & Scheduler ───────────────────────────────────────────────────────

  async function fetchStats() {
    if (!isConfigured.value) return
    try {
      const r = await apiFetch('/stats')
      if (r.ok) stats.value = await r.json()
    } catch { /* ignore */ }
  }

  async function fetchScheduler() {
    if (!isConfigured.value) return
    try {
      const r = await apiFetch('/scheduler/status')
      if (r.ok) scheduler.value = await r.json()
    } catch { /* ignore */ }
  }

  return {
    baseUrl, apiKey, isConfigured, persistConn,
    config, configLoaded, fetchConfig, saveConfig,
    sources, selectedSource, fetchSources,
    pushPapers, pushDate, pushTotal, isFetchingPush, pushError, fetchPushPapers,
    analyzingIds, analyzePaper, analyzeAll,
    isCrawling, crawlNow, crawlJobs, fetchCrawlJobs,
    downloadPdf, openPdf,
    stats, fetchStats,
    scheduler, fetchScheduler,
    toast,
  }
})
