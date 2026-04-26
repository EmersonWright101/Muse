import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { listConversations, loadConversation, type ChatMessage, type Conversation, type ConversationMeta } from '../utils/storage'
import { useAiSettingsStore } from './aiSettings'
import { resolveDataRoot } from '../utils/path'
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs'
import type { CopilotDailyStat } from './travelCopilot'
import { loadPosterStatsFile } from './home'

async function loadCopilotStatsFile(): Promise<Record<string, CopilotDailyStat>> {
  try {
    const path = `${await resolveDataRoot()}/copilot-stats.json`
    if (!(await exists(path))) return {}
    return JSON.parse(await readTextFile(path)) as Record<string, CopilotDailyStat>
  } catch { return {} }
}

export type TimeRange = 'today' | 'week' | 'month' | 'year'
export type SortBy = 'tokens' | 'cost' | 'requests' | 'provider' | 'name'
export type Currency = 'usd' | 'cny'

const EXCHANGE_RATE = 7

export interface DailyModelStat {
  modelId: string
  modelName: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  uploadsMB: number
  downloadsMB: number
  cost: number
  requests: number
}

export interface ModelStat {
  modelId: string
  modelName: string
  provider: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  uploadsMB: number
  downloadsMB: number
  cost: number
  requests: number
}

export interface DailyStat {
  date: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  uploadsMB: number
  downloadsMB: number
  cost: number
  requests: number
  models: DailyModelStat[]
}

export const MODEL_COLORS = [
  '#A8D8EA', '#FCBAD3', '#FFEAA7', '#B4F8C8', '#FBE7C6',
  '#AA96DA', '#A0E7E5', '#FFAEBC', '#D4A5A5', '#A0E6DE',
  '#C7CEEA', '#FFDAB9', '#E2F0CB', '#FDCB6E', '#FFDAC1',
]

export function getModelColor(modelId: string): string {
  let hash = 0
  for (const c of modelId) hash = (hash * 31 + c.charCodeAt(0)) & 0xFFFF
  return MODEL_COLORS[hash % MODEL_COLORS.length]
}

const modelSvgModules = import.meta.glob<{ default: string }>('/src/assets/models/*.svg', { eager: true })

export function getModelLogoUrl(modelId: string): string | null {
  const mid = modelId.toLowerCase()
  for (const [path, mod] of Object.entries(modelSvgModules)) {
    const name = path.replace(/^.*\//, '').replace(/\.svg$/, '')
    if (mid.includes(name)) return mod.default
  }
  return null
}

// ─── Stats cache (incremental aggregation) ───────────────────────────────────

const CACHE_VERSION = 1

interface CachedConvStat {
  updatedAt: string
  modelStats: ModelStat[]
  dailyStats: DailyStat[]
}

interface StatsCache {
  version: number
  conversations: Record<string, CachedConvStat>
}

async function getStatsCachePath(): Promise<string> {
  return `${await resolveDataRoot()}/stats-cache.json`
}

async function readStatsCache(): Promise<StatsCache | null> {
  try {
    const path = await getStatsCachePath()
    if (!(await exists(path))) return null
    const raw = await readTextFile(path)
    const parsed = JSON.parse(raw) as StatsCache
    if (parsed.version !== CACHE_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

async function writeStatsCache(cache: StatsCache): Promise<void> {
  try {
    const path = await getStatsCachePath()
    const dataDir = path.slice(0, path.lastIndexOf('/'))
    if (!(await exists(dataDir))) await mkdir(dataDir, { recursive: true })
    await writeTextFile(path, JSON.stringify(cache, null, 2))
  } catch {
    // Silently ignore cache write failures
  }
}

function getEffectiveUsage(msg: ChatMessage) {
  let usage = msg.usage
  if (!usage && msg.variants && msg.activeVariantIdx != null && msg.activeVariantIdx > 0) {
    const variant = msg.variants[msg.activeVariantIdx - 1]
    usage = variant?.usage
  }
  if (!usage) return null
  return {
    inputTokens: usage.inputTokens || 0,
    outputTokens: usage.outputTokens || 0,
    cost: usage.costUsd || 0,
  }
}

function base64ToBytes(b64: string): number {
  return Math.floor(b64.length * 0.75)
}

export const useStatisticsStore = defineStore('statistics', () => {
  const timeRange = ref<TimeRange>('week')
  const sortBy = ref<SortBy>('tokens')
  const currency = ref<Currency>('cny')
  const isLoading = ref(false)
  const modelStats = ref<ModelStat[]>([])
  const dailyStatsAll = ref<DailyStat[]>([])

  const ai = useAiSettingsStore()

  const totalTokens = computed(() => modelStats.value.reduce((s, m) => s + m.totalTokens, 0))
  const totalInputTokens = computed(() => modelStats.value.reduce((s, m) => s + m.inputTokens, 0))
  const totalOutputTokens = computed(() => modelStats.value.reduce((s, m) => s + m.outputTokens, 0))
  const totalUploads = computed(() => modelStats.value.reduce((s, m) => s + m.uploadsMB, 0))
  const totalDownloads = computed(() => modelStats.value.reduce((s, m) => s + m.downloadsMB, 0))
  const totalCost = computed(() => modelStats.value.reduce((s, m) => s + m.cost, 0))
  const totalRequests = computed(() => modelStats.value.reduce((s, m) => s + m.requests, 0))

  const hasData = computed(() => modelStats.value.length > 0 && totalRequests.value > 0)

  function getModelDisplayName(modelId: string): string {
    for (const p of ai.providers) {
      for (const m of p.models) {
        if (m.id === modelId) return m.name
      }
    }
    return modelId
  }

  function getProviderDisplayName(providerId: string, modelId?: string): string {
    const p = ai.providers.find(p => p.id === providerId)
    if (p?.name && !/^provider_\d+$/.test(p.name)) return p.name
    // 如果 provider 不存在或 name 是 auto-generated ID，尝试推断
    if (modelId?.includes('/')) return 'OpenRouter'
    if (p?.baseUrl) {
      if (p.baseUrl.includes('openrouter')) return 'OpenRouter'
      if (p.baseUrl.includes('siliconflow')) return 'SiliconFlow'
    }
    // 自动生成的 provider ID 默认推断为 OpenRouter（最常见场景）
    if (/^provider_\d+$/.test(providerId)) return 'OpenRouter'
    return p?.name || providerId
  }

  const dailyStats = computed(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let cutoff = new Date(today)
    if (timeRange.value === 'today') cutoff = today
    else if (timeRange.value === 'week') cutoff.setDate(cutoff.getDate() - 6)
    else if (timeRange.value === 'month') cutoff.setDate(cutoff.getDate() - 29)
    else if (timeRange.value === 'year') cutoff.setMonth(cutoff.getMonth() - 11)

    const filtered = dailyStatsAll.value.filter(d => {
      const dt = new Date(d.date + 'T00:00:00')
      return dt >= cutoff
    })

    if (timeRange.value === 'year') {
      const monthMap = new Map<string, DailyStat>()
      for (const d of filtered) {
        const month = d.date.slice(0, 7)
        const existing = monthMap.get(month)
        if (existing) {
          existing.inputTokens += d.inputTokens
          existing.outputTokens += d.outputTokens
          existing.totalTokens += d.totalTokens
          existing.uploadsMB += d.uploadsMB
          existing.downloadsMB += d.downloadsMB
          existing.cost += d.cost
          existing.requests += d.requests
          // 合并 models
          for (const dm of d.models) {
            const em = existing.models.find(m => m.modelId === dm.modelId)
            if (em) {
              em.inputTokens += dm.inputTokens
              em.outputTokens += dm.outputTokens
              em.totalTokens += dm.totalTokens
              em.uploadsMB += dm.uploadsMB
              em.downloadsMB += dm.downloadsMB
              em.cost += dm.cost
              em.requests += dm.requests
            } else {
              existing.models.push({ ...dm })
            }
          }
        } else {
          monthMap.set(month, {
            ...d,
            date: month,
            models: d.models.map(m => ({ ...m })),
          })
        }
      }
      return Array.from(monthMap.values()).map(m => ({
        ...m,
        models: m.models.sort((a, b) => b.totalTokens - a.totalTokens),
      })).sort((a, b) => a.date.localeCompare(b.date))
    }

    return filtered.map(d => ({
      ...d,
      models: d.models.sort((a, b) => b.totalTokens - a.totalTokens),
    })).sort((a, b) => a.date.localeCompare(b.date))
  })

  const sortedModelStats = computed(() => {
    const list = [...modelStats.value]
    const numKeyMap: Record<string, keyof ModelStat> = { tokens: 'totalTokens', cost: 'cost', requests: 'requests' }
    const key = numKeyMap[sortBy.value]
    if (key) {
      return list.sort((a, b) => (b[key] as number) - (a[key] as number))
    }
    if (sortBy.value === 'provider') {
      return list.sort((a, b) => a.provider.localeCompare(b.provider))
    }
    if (sortBy.value === 'name') {
      return list.sort((a, b) => a.modelName.localeCompare(b.modelName))
    }
    return list
  })

  const rankedModels = computed(() => {
    return sortedModelStats.value.map((m, idx) => ({ ...m, rank: idx + 1 }))
  })

  // ─── Time-filtered model stats (for ranking & model distribution) ───────────

  function getCutoffDate(range: TimeRange): Date {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let cutoff = new Date(today)
    if (range === 'today') cutoff = today
    else if (range === 'week') cutoff.setDate(cutoff.getDate() - 6)
    else if (range === 'month') cutoff.setDate(cutoff.getDate() - 29)
    else if (range === 'year') cutoff.setMonth(cutoff.getMonth() - 11)
    return cutoff
  }

  const filteredModelStats = computed(() => {
    const cutoff = getCutoffDate(timeRange.value)
    const modelMap = new Map<string, ModelStat>()
    const infoMap = new Map(modelStats.value.map(m => [m.modelId, { provider: m.provider, modelName: m.modelName }]))

    for (const d of dailyStatsAll.value) {
      const dt = new Date(d.date + 'T00:00:00')
      if (dt < cutoff) continue

      for (const dm of d.models) {
        const existing = modelMap.get(dm.modelId)
        if (existing) {
          existing.inputTokens += dm.inputTokens
          existing.outputTokens += dm.outputTokens
          existing.totalTokens += dm.totalTokens
          existing.uploadsMB += dm.uploadsMB
          existing.downloadsMB += dm.downloadsMB
          existing.cost += dm.cost
          existing.requests += dm.requests
        } else {
          const info = infoMap.get(dm.modelId)
          modelMap.set(dm.modelId, {
            modelId: dm.modelId,
            modelName: dm.modelName || info?.modelName || getModelDisplayName(dm.modelId),
            provider: info?.provider || getProviderDisplayName('unknown', dm.modelId),
            inputTokens: dm.inputTokens,
            outputTokens: dm.outputTokens,
            totalTokens: dm.totalTokens,
            uploadsMB: dm.uploadsMB,
            downloadsMB: dm.downloadsMB,
            cost: dm.cost,
            requests: dm.requests,
          })
        }
      }
    }

    return Array.from(modelMap.values()).filter(m => m.requests > 0)
  })

  const filteredSortedModelStats = computed(() => {
    const list = [...filteredModelStats.value]
    const numKeyMap: Record<string, keyof ModelStat> = { tokens: 'totalTokens', cost: 'cost', requests: 'requests' }
    const key = numKeyMap[sortBy.value]
    if (key) {
      return list.sort((a, b) => (b[key] as number) - (a[key] as number))
    }
    if (sortBy.value === 'provider') {
      return list.sort((a, b) => a.provider.localeCompare(b.provider))
    }
    if (sortBy.value === 'name') {
      return list.sort((a, b) => a.modelName.localeCompare(b.modelName))
    }
    return list
  })

  const filteredRankedModels = computed(() => {
    return filteredSortedModelStats.value.map((m, idx) => ({ ...m, rank: idx + 1 }))
  })

  const filteredTotalCost = computed(() => filteredModelStats.value.reduce((s, m) => s + m.cost, 0))
  const filteredTotalRequests = computed(() => filteredModelStats.value.reduce((s, m) => s + m.requests, 0))

  function aggregateConversation(conv: Conversation, meta: ConversationMeta): CachedConvStat {
    const modelMap = new Map<string, ModelStat>()
    const dailyMap = new Map<string, DailyStat>()
    const dailyModelMap = new Map<string, Map<string, DailyModelStat>>()

    for (const msg of conv.messages) {
      const usage = getEffectiveUsage(msg)
      const date = msg.timestamp.slice(0, 10)
      const modelId = msg.model || conv.model || meta.model || 'unknown'
      const providerId = msg.providerId || conv.providerId || meta.providerId || 'unknown'

      if (!modelMap.has(modelId)) {
        modelMap.set(modelId, {
          modelId,
          modelName: getModelDisplayName(modelId),
          provider: getProviderDisplayName(providerId, modelId),
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          uploadsMB: 0,
          downloadsMB: 0,
          cost: 0,
          requests: 0,
        })
      }
      const ms = modelMap.get(modelId)!

      if (!dailyMap.has(date)) {
        dailyMap.set(date, {
          date,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          uploadsMB: 0,
          downloadsMB: 0,
          cost: 0,
          requests: 0,
          models: [],
        })
      }
      const ds = dailyMap.get(date)!

      if (!dailyModelMap.has(date)) dailyModelMap.set(date, new Map())
      const dmMap = dailyModelMap.get(date)!
      if (!dmMap.has(modelId)) {
        dmMap.set(modelId, {
          modelId,
          modelName: getModelDisplayName(modelId),
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          uploadsMB: 0,
          downloadsMB: 0,
          cost: 0,
          requests: 0,
        })
      }
      const dms = dmMap.get(modelId)!

      if (usage) {
        ms.inputTokens += usage.inputTokens
        ms.outputTokens += usage.outputTokens
        ms.totalTokens += usage.inputTokens + usage.outputTokens
        ms.cost += usage.cost
        ms.requests += 1

        ds.inputTokens += usage.inputTokens
        ds.outputTokens += usage.outputTokens
        ds.totalTokens += usage.inputTokens + usage.outputTokens
        ds.cost += usage.cost
        ds.requests += 1

        dms.inputTokens += usage.inputTokens
        dms.outputTokens += usage.outputTokens
        dms.totalTokens += usage.inputTokens + usage.outputTokens
        dms.cost += usage.cost
        dms.requests += 1
      }

      if (msg.attachments) {
        for (const att of msg.attachments) {
          let bytes = 0
          if (typeof att.size === 'number') bytes = att.size
          else if (att.data) bytes = base64ToBytes(att.data)
          const mb = bytes / (1024 * 1024)
          ms.uploadsMB += mb
          ds.uploadsMB += mb
          dms.uploadsMB += mb
        }
      }

      if (msg.mediaOutputs) {
        for (const mo of msg.mediaOutputs) {
          if (mo.data) {
            const mb = base64ToBytes(mo.data) / (1024 * 1024)
            ms.downloadsMB += mb
            ds.downloadsMB += mb
            dms.downloadsMB += mb
          }
        }
      }
    }

    const dailyArr: DailyStat[] = []
    for (const [date, stat] of dailyMap) {
      const dmMap = dailyModelMap.get(date)
      const models = dmMap ? Array.from(dmMap.values()) : []
      dailyArr.push({ ...stat, models: models.sort((a, b) => b.totalTokens - a.totalTokens) })
    }

    return {
      updatedAt: meta.updatedAt,
      modelStats: Array.from(modelMap.values()).filter(m => m.requests > 0),
      dailyStats: dailyArr.filter(d => d.requests > 0 || d.models.length > 0),
    }
  }

  function mergeCachedStats(cachedConvs: CachedConvStat[]): { modelStats: ModelStat[], dailyStatsAll: DailyStat[] } {
    const modelMap = new Map<string, ModelStat>()
    const dailyMap = new Map<string, DailyStat>()
    const dailyModelMap = new Map<string, Map<string, DailyModelStat>>()

    for (const cc of cachedConvs) {
      for (const m of cc.modelStats) {
        const existing = modelMap.get(m.modelId)
        if (existing) {
          existing.inputTokens += m.inputTokens
          existing.outputTokens += m.outputTokens
          existing.totalTokens += m.totalTokens
          existing.uploadsMB += m.uploadsMB
          existing.downloadsMB += m.downloadsMB
          existing.cost += m.cost
          existing.requests += m.requests
        } else {
          modelMap.set(m.modelId, { ...m })
        }
      }

      for (const d of cc.dailyStats) {
        let ds = dailyMap.get(d.date)
        if (!ds) {
          ds = {
            date: d.date,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            uploadsMB: 0,
            downloadsMB: 0,
            cost: 0,
            requests: 0,
            models: [],
          }
          dailyMap.set(d.date, ds)
        }
        ds.inputTokens += d.inputTokens
        ds.outputTokens += d.outputTokens
        ds.totalTokens += d.totalTokens
        ds.uploadsMB += d.uploadsMB
        ds.downloadsMB += d.downloadsMB
        ds.cost += d.cost
        ds.requests += d.requests

        const dmMap = dailyModelMap.get(d.date) ?? new Map<string, DailyModelStat>()
        dailyModelMap.set(d.date, dmMap)

        for (const dm of d.models) {
          const existing = dmMap.get(dm.modelId)
          if (existing) {
            existing.inputTokens += dm.inputTokens
            existing.outputTokens += dm.outputTokens
            existing.totalTokens += dm.totalTokens
            existing.uploadsMB += dm.uploadsMB
            existing.downloadsMB += dm.downloadsMB
            existing.cost += dm.cost
            existing.requests += dm.requests
          } else {
            dmMap.set(dm.modelId, { ...dm })
          }
        }
      }
    }

    const dailyArr: DailyStat[] = []
    for (const [date, stat] of dailyMap) {
      const dmMap = dailyModelMap.get(date)
      const models = dmMap ? Array.from(dmMap.values()) : []
      dailyArr.push({ ...stat, models: models.sort((a, b) => b.totalTokens - a.totalTokens) })
    }

    return {
      modelStats: Array.from(modelMap.values()).filter(m => m.requests > 0),
      dailyStatsAll: dailyArr.filter(d => d.requests > 0 || d.models.length > 0).sort((a, b) => a.date.localeCompare(b.date)),
    }
  }

  async function loadStats() {
    isLoading.value = true
    try {
      const metas = await listConversations()
      const cache = await readStatsCache()
      const newCache: StatsCache = { version: CACHE_VERSION, conversations: {} }
      const cachedConvs: CachedConvStat[] = []

      const toReload: ConversationMeta[] = []
      for (const meta of metas) {
        const cached = cache?.conversations[meta.id]
        if (cached && cached.updatedAt === meta.updatedAt) {
          newCache.conversations[meta.id] = cached
          cachedConvs.push(cached)
        } else {
          toReload.push(meta)
        }
      }

      // Parallel load changed conversations
      const reloadResults = await Promise.all(
        toReload.map(async meta => {
          const conv = await loadConversation(meta.id)
          if (!conv) return null
          const agg = aggregateConversation(conv, meta)
          newCache.conversations[meta.id] = agg
          return agg
        })
      )

      for (const r of reloadResults) {
        if (r) cachedConvs.push(r)
      }

      const merged = mergeCachedStats(cachedConvs)

      // Refresh display names in case AI settings changed since cache was written
      for (const m of merged.modelStats) {
        m.modelName = getModelDisplayName(m.modelId)
        m.provider = getProviderDisplayName(m.provider, m.modelId)
      }
      for (const d of merged.dailyStatsAll) {
        for (const m of d.models) {
          m.modelName = getModelDisplayName(m.modelId)
        }
      }

      // Merge copilot stats as a virtual "copilot" model entry
      const copilotDailyStats = await loadCopilotStatsFile()
      const COPILOT_MODEL_ID = '__copilot__'
      let copilotTotal: ModelStat | undefined
      for (const [date, cs] of Object.entries(copilotDailyStats)) {
        if (!cs.requests) continue
        if (!copilotTotal) {
          copilotTotal = { modelId: COPILOT_MODEL_ID, modelName: 'Copilot (写作助手)', provider: 'Travel Notes', inputTokens: 0, outputTokens: 0, totalTokens: 0, uploadsMB: 0, downloadsMB: 0, cost: 0, requests: 0 }
        }
        copilotTotal.inputTokens  += cs.inputTokens
        copilotTotal.outputTokens += cs.outputTokens
        copilotTotal.totalTokens  += cs.inputTokens + cs.outputTokens
        copilotTotal.cost         += cs.costUsd
        copilotTotal.requests     += cs.requests

        // Inject into daily stats
        let ds = merged.dailyStatsAll.find(d => d.date === date)
        if (!ds) {
          ds = { date, inputTokens: 0, outputTokens: 0, totalTokens: 0, uploadsMB: 0, downloadsMB: 0, cost: 0, requests: 0, models: [] }
          merged.dailyStatsAll.push(ds)
          merged.dailyStatsAll.sort((a, b) => a.date.localeCompare(b.date))
        }
        ds.inputTokens  += cs.inputTokens
        ds.outputTokens += cs.outputTokens
        ds.totalTokens  += cs.inputTokens + cs.outputTokens
        ds.cost         += cs.costUsd
        ds.requests     += cs.requests
        const existing = ds.models.find(m => m.modelId === COPILOT_MODEL_ID)
        if (existing) {
          existing.inputTokens  += cs.inputTokens
          existing.outputTokens += cs.outputTokens
          existing.totalTokens  += cs.inputTokens + cs.outputTokens
          existing.cost         += cs.costUsd
          existing.requests     += cs.requests
        } else {
          ds.models.push({ modelId: COPILOT_MODEL_ID, modelName: 'Copilot (写作助手)', inputTokens: cs.inputTokens, outputTokens: cs.outputTokens, totalTokens: cs.inputTokens + cs.outputTokens, uploadsMB: 0, downloadsMB: 0, cost: cs.costUsd, requests: cs.requests })
        }
      }
      if (copilotTotal) merged.modelStats.push(copilotTotal)

      // Merge poster stats as a virtual "poster" model entry
      const posterDailyStats = await loadPosterStatsFile()
      const POSTER_MODEL_ID = '__poster__'
      let posterTotal: ModelStat | undefined
      for (const [date, ps] of Object.entries(posterDailyStats)) {
        if (!ps.requests) continue
        if (!posterTotal) {
          posterTotal = { modelId: POSTER_MODEL_ID, modelName: '动物海报 (AI 生成)', provider: 'Home', inputTokens: 0, outputTokens: 0, totalTokens: 0, uploadsMB: 0, downloadsMB: 0, cost: 0, requests: 0 }
        }
        posterTotal.cost     += ps.costUsd
        posterTotal.requests += ps.requests

        let ds = merged.dailyStatsAll.find(d => d.date === date)
        if (!ds) {
          ds = { date, inputTokens: 0, outputTokens: 0, totalTokens: 0, uploadsMB: 0, downloadsMB: 0, cost: 0, requests: 0, models: [] }
          merged.dailyStatsAll.push(ds)
          merged.dailyStatsAll.sort((a, b) => a.date.localeCompare(b.date))
        }
        ds.cost     += ps.costUsd
        ds.requests += ps.requests
        const existing = ds.models.find(m => m.modelId === POSTER_MODEL_ID)
        if (existing) {
          existing.cost     += ps.costUsd
          existing.requests += ps.requests
        } else {
          ds.models.push({ modelId: POSTER_MODEL_ID, modelName: '动物海报 (AI 生成)', inputTokens: 0, outputTokens: 0, totalTokens: 0, uploadsMB: 0, downloadsMB: 0, cost: ps.costUsd, requests: ps.requests })
        }
      }
      if (posterTotal) merged.modelStats.push(posterTotal)

      modelStats.value = merged.modelStats
      dailyStatsAll.value = merged.dailyStatsAll

      await writeStatsCache(newCache)
    } finally {
      isLoading.value = false
    }
  }

  function setTimeRange(range: TimeRange) {
    timeRange.value = range
  }

  function setSortBy(by: SortBy) {
    sortBy.value = by
  }

  function setCurrency(c: Currency) {
    currency.value = c
  }

  function formatCost(amountUsd: number): string {
    const value = currency.value === 'cny' ? amountUsd * EXCHANGE_RATE : amountUsd
    const symbol = currency.value === 'cny' ? '¥' : '$'
    return `${symbol}${value.toFixed(3)}`
  }

  return {
    timeRange,
    sortBy,
    currency,
    isLoading,
    modelStats,
    dailyStats,
    dailyStatsAll,
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    totalUploads,
    totalDownloads,
    totalCost,
    totalRequests,
    hasData,
    sortedModelStats,
    rankedModels,
    filteredModelStats,
    filteredSortedModelStats,
    filteredRankedModels,
    filteredTotalCost,
    filteredTotalRequests,
    loadStats,
    setTimeRange,
    setSortBy,
    setCurrency,
    formatCost,
  }
})
