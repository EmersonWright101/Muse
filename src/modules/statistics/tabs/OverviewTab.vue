<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStatisticsStore, getModelColor, getModelLogoUrl, type SortBy } from '../../../stores/statistics'
import ModelIcon from '../components/ModelIcon.vue'
import EmptyState from '../components/EmptyState.vue'
import TimeRangeSelector from '../components/TimeRangeSelector.vue'

const stats = useStatisticsStore()
const activeTab = ref<'time' | 'model' | 'rank'>('time')

function fmt(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtBig(n: number): string {
  return n.toLocaleString()
}

/* ─── KPI cards ─────────────────────────────────────────────── */
const kpiCards = computed(() => {
  const all = stats.dailyStatsAll
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const d7 = new Date(today); d7.setDate(d7.getDate() - 6)
  const tok7 = all.filter(d => new Date(d.date + 'T00:00:00') >= d7).reduce((s, d) => s + d.totalTokens, 0)

  const d30 = new Date(today); d30.setDate(d30.getDate() - 29)
  const tok30 = all.filter(d => new Date(d.date + 'T00:00:00') >= d30).reduce((s, d) => s + d.totalTokens, 0)

  const avg = all.length ? stats.totalTokens / all.length : 0
  const monthReq = all.filter(d => new Date(d.date + 'T00:00:00') >= d30).reduce((s, d) => s + d.requests, 0)

  return [
    { label: '7天 Token', value: fmt(tok7), sub: '近7天' },
    { label: '30天 Token', value: fmt(tok30), sub: '近30天' },
    { label: '日均 Token', value: fmt(avg), sub: '平均值' },
    { label: '本月请求', value: String(monthReq), sub: '对话次数' },
  ]
})

/* ─── Top models with sort ──────────────────────────────────── */
const keyMap: Record<string, 'totalTokens' | 'cost' | 'requests'> = {
  tokens: 'totalTokens',
  cost: 'cost',
  requests: 'requests',
}

const sortOptions: { key: SortBy; label: string }[] = [
  { key: 'tokens', label: 'Token' },
  { key: 'cost', label: '花费' },
  { key: 'requests', label: '请求' },
]

const topModels = computed(() => {
  const key = keyMap[stats.sortBy]
  return [...stats.modelStats].sort((a, b) => b[key] - a[key]).slice(0, 5)
})
const topModelsTotal = computed(() => {
  const key = keyMap[stats.sortBy]
  return topModels.value.reduce((s, m) => s + m[key], 0) || 1
})

function getTopModelPct(m: typeof stats.modelStats[number]): string {
  return ((m[keyMap[stats.sortBy]] / topModelsTotal.value) * 100).toFixed(1)
}

/* ─── Provider pie chart ───────────────────────────────────── */
const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']

const providerStats = computed(() => {
  const map = new Map<string, { tokens: number; models: Set<string> }>()
  for (const m of stats.modelStats) {
    const existing = map.get(m.provider)
    if (existing) {
      existing.tokens += m.totalTokens
      existing.models.add(m.modelId)
    } else {
      map.set(m.provider, { tokens: m.totalTokens, models: new Set([m.modelId]) })
    }
  }
  const total = stats.totalTokens || 1
  return Array.from(map.entries())
    .map(([name, { tokens, models }]) => ({
      name,
      pct: ((tokens / total) * 100).toFixed(1),
      tokens,
      modelCount: models.size,
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)
})

function describeDonutArc(
  cx: number, cy: number, outerR: number, innerR: number,
  startAngle: number, endAngle: number,
) {
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  const ox1 = cx + outerR * Math.cos(startAngle)
  const oy1 = cy + outerR * Math.sin(startAngle)
  const ox2 = cx + outerR * Math.cos(endAngle)
  const oy2 = cy + outerR * Math.sin(endAngle)
  const ix1 = cx + innerR * Math.cos(startAngle)
  const iy1 = cy + innerR * Math.sin(startAngle)
  const ix2 = cx + innerR * Math.cos(endAngle)
  const iy2 = cy + innerR * Math.sin(endAngle)
  return `M ${ox1} ${oy1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1} Z`
}

const pieData = computed(() => {
  const list = providerStats.value
  if (!list.length) return []
  const total = list.reduce((s, p) => s + p.tokens, 0) || 1
  let startAngle = -Math.PI / 2
  return list.map((p, i) => {
    const angle = (p.tokens / total) * Math.PI * 2
    const endAngle = startAngle + angle
    const d = describeDonutArc(50, 50, 38, 22, startAngle, endAngle)
    const item = {
      name: p.name,
      pct: p.pct,
      tokens: p.tokens,
      modelCount: p.modelCount,
      color: PIE_COLORS[i % PIE_COLORS.length],
      d,
    }
    startAngle = endAngle
    return item
  })
})

/* ─── Meta ──────────────────────────────────────────────────── */
const activeDays = computed(() => stats.dailyStatsAll.filter(d => d.totalTokens > 0).length)

/* ─── Trend mini chart ──────────────────────────────────────── */
const trendData = computed(() => stats.dailyStatsAll.slice(-30))
const trendMax = computed(() => Math.max(...trendData.value.map(d => d.totalTokens), 1))

const TREND_W = 800
const TREND_H = 120
const TREND_PAD = 16

const linePath = computed(() => {
  const data = trendData.value
  if (data.length < 2) return ''
  const stepX = (TREND_W - TREND_PAD * 2) / (data.length - 1)
  const chartH = TREND_H - TREND_PAD * 2
  const points = data.map((d, i) => {
    const x = TREND_PAD + i * stepX
    const y = TREND_PAD + chartH - (d.totalTokens / trendMax.value) * chartH
    return `${x},${y}`
  })
  return `M ${points.join(' L ')}`
})

const areaPath = computed(() => {
  const data = trendData.value
  if (data.length < 2) return ''
  const stepX = (TREND_W - TREND_PAD * 2) / (data.length - 1)
  const chartH = TREND_H - TREND_PAD * 2
  const points = data.map((d, i) => {
    const x = TREND_PAD + i * stepX
    const y = TREND_PAD + chartH - (d.totalTokens / trendMax.value) * chartH
    return `${x},${y}`
  })
  const firstX = TREND_PAD
  const lastX = TREND_PAD + (data.length - 1) * stepX
  const bottomY = TREND_H - TREND_PAD
  return `M ${firstX},${bottomY} L ${points.join(' L ')} L ${lastX},${bottomY} Z`
})

/* ─── Trend hover ────────────────────────────────────────────── */
const trendChartRef = ref<HTMLElement | null>(null)
const trendHover = ref<{ idx: number } | null>(null)

const hoverPoint = computed(() => {
  if (!trendHover.value || trendData.value.length < 2) return null
  const { idx } = trendHover.value
  const d = trendData.value[idx]
  const stepX = (TREND_W - TREND_PAD * 2) / (trendData.value.length - 1)
  const chartH = TREND_H - TREND_PAD * 2
  const x = TREND_PAD + idx * stepX
  const y = TREND_PAD + chartH - (d.totalTokens / trendMax.value) * chartH
  return { x, y, d, pct: (x / TREND_W) * 100 }
})

function onTrendMouseMove(e: MouseEvent) {
  const el = trendChartRef.value
  if (!el || trendData.value.length < 2) return
  const rect = el.getBoundingClientRect()
  const relX = (e.clientX - rect.left) / rect.width
  const n = trendData.value.length
  const idx = Math.max(0, Math.min(n - 1, Math.round(relX * (n - 1))))
  trendHover.value = { idx }
}

function onTrendMouseLeave() {
  trendHover.value = null
}

/* ─── Token time distribution ───────────────────────────────── */
const daily = computed(() => stats.dailyStats)
const maxDaily = computed(() => Math.max(...daily.value.map(d => d.totalTokens), 1))
const maxModelTokens = computed(() => Math.max(...stats.filteredSortedModelStats.map(m => m.totalTokens), 1))

const CHART_HEIGHT = 320
const ICON_MIN_PX = 18
const iconThreshold = ICON_MIN_PX / CHART_HEIGHT

/* ─── Ranking ───────────────────────────────────────────────── */
const ranked = computed(() => stats.filteredRankedModels)
const maxRankValue = computed(() => {
  const key = keyMap[stats.sortBy]
  return Math.max(...stats.filteredModelStats.map(m => m[key] as number), 1)
})

/* ─── Heatmap ───────────────────────────────────────────────── */
const weeks = computed(() => {
  const all = stats.dailyStatsAll
  if (!all.length) return []
  const map = new Map<string, number>()
  for (const d of all) map.set(d.date, d.totalTokens)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const firstDate = new Date(all[0].date + 'T00:00:00')
  const startSunday = new Date(firstDate)
  startSunday.setDate(startSunday.getDate() - startSunday.getDay())

  const weeksArr: { days: { date: string; tokens: number; level: number }[] }[] = []
  let currentWeek: { date: string; tokens: number; level: number }[] = []

  for (let d = new Date(startSunday); d < firstDate; d.setDate(d.getDate() + 1)) {
    currentWeek.push({ date: d.toISOString().slice(0, 10), tokens: 0, level: 0 })
  }

  for (let d = new Date(firstDate); d <= today; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10)
    const tokens = map.get(dateStr) || 0
    const level = tokens === 0 ? 0 : tokens < 1000 ? 1 : tokens < 10000 ? 2 : tokens < 100000 ? 3 : 4
    currentWeek.push({ date: dateStr, tokens, level })
    if (d.getDay() === 6) {
      weeksArr.push({ days: currentWeek })
      currentWeek = []
    }
  }

  if (currentWeek.length > 0) {
    const lastDay = currentWeek[currentWeek.length - 1]
    const d = new Date(lastDay.date + 'T00:00:00')
    while (d.getDay() !== 6) {
      d.setDate(d.getDate() + 1)
      currentWeek.push({ date: d.toISOString().slice(0, 10), tokens: 0, level: 0 })
    }
    weeksArr.push({ days: currentWeek })
  }
  return weeksArr
})

const dayLabels = ['日', '一', '二', '三', '四', '五', '六']

/* Month label per week-column: show month name at the first week a new month appears */
const monthColLabels = computed(() => {
  const seen = new Set<string>()
  return weeks.value.map((w) => {
    const firstOfMonth = w.days.find(d => d.date.slice(8) === '01')
    if (firstOfMonth) {
      const key = firstOfMonth.date.slice(0, 7)
      if (!seen.has(key)) { seen.add(key); return `${+firstOfMonth.date.slice(5, 7)}月` }
    }
    // Fallback: show month of the first real day in the week if it's a new month
    const firstReal = w.days.find(d => d.tokens >= 0 && d.date)
    if (firstReal) {
      const key = firstReal.date.slice(0, 7)
      if (!seen.has(key)) { seen.add(key); return `${+firstReal.date.slice(5, 7)}月` }
    }
    return ''
  })
})
</script>

<template>
  <div class="overview-tab">
    <template v-if="stats.isLoading">
      <div class="loading-state">加载中…</div>
    </template>
    <template v-else-if="!stats.hasData">
      <EmptyState />
    </template>
    <template v-else>
      <!-- Header -->
      <div class="tab-header">
        <h2 class="tab-title">数据概览</h2>
        <TimeRangeSelector />
      </div>

      <!-- KPI row -->
      <div class="kpi-row">
        <div v-for="card in kpiCards" :key="card.label" class="kpi-card">
          <div class="kpi-value">{{ card.value }}</div>
          <div class="kpi-label">{{ card.label }}</div>
          <div class="kpi-sub">{{ card.sub }}</div>
        </div>
      </div>

      <!-- Dashboard body -->
      <div class="dashboard-body">

        <!-- Row 1: Top models (left 1/2) + Hero total (right 1/2) -->
        <div class="dash-row-top">
          <div class="dash-section">
            <div class="dash-section-header">
              <div class="dash-section-title">Top 模型</div>
              <div class="sort-bar">
                <button
                  v-for="opt in sortOptions"
                  :key="opt.key"
                  class="sort-btn"
                  :class="{ active: stats.sortBy === opt.key }"
                  @click="stats.setSortBy(opt.key)"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
            <div class="top-model-list">
              <div
                v-for="(m, idx) in topModels"
                :key="m.modelId"
                class="top-model-item"
              >
                <span class="top-model-rank">{{ idx + 1 }}</span>
                <ModelIcon :model-id="m.modelId" :size="18" />
                <span class="top-model-name">{{ m.modelName }}</span>
                <span class="top-model-pct">{{ getTopModelPct(m) }}%</span>
              </div>
            </div>
          </div>

          <div class="hero-block">
            <div class="hero-label">TOTAL TOKENS</div>
            <div class="hero-value">{{ fmtBig(stats.totalTokens) }}</div>
            <div class="hero-cost">{{ stats.formatCost(stats.totalCost) }}</div>
            <div class="hero-divider" />
            <div class="hero-metrics">
              <div class="hero-metric">
                <div class="hero-metric-value">{{ stats.totalRequests }}</div>
                <div class="hero-metric-label">请求</div>
              </div>
              <div class="hero-metric">
                <div class="hero-metric-value">{{ stats.modelStats.length }}</div>
                <div class="hero-metric-label">模型</div>
              </div>
              <div class="hero-metric">
                <div class="hero-metric-value">{{ activeDays }}</div>
                <div class="hero-metric-label">活跃天</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Row 2: Provider pie (1/3) + Heatmap (2/3) -->
        <div class="pie-heatmap-row">

          <!-- Provider pie chart -->
          <div class="dash-section pie-section">
            <div class="dash-section-title" style="margin-bottom: 16px;">供应商分布</div>
            <div v-if="pieData.length" class="pie-chart-wrap">
              <svg viewBox="0 0 100 100" class="pie-svg">
                <path
                  v-for="slice in pieData"
                  :key="slice.name"
                  :d="slice.d"
                  :fill="slice.color"
                />
              </svg>
              <div class="pie-legend">
                <div
                  v-for="slice in pieData"
                  :key="slice.name"
                  class="pie-legend-item"
                >
                  <div class="pie-legend-dot" :style="{ background: slice.color }" />
                  <div class="pie-legend-text">
                    <div class="pie-legend-name">{{ slice.name }}</div>
                    <div class="pie-legend-pct">{{ slice.pct }}% · {{ slice.modelCount }} 个模型</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Activity heatmap (GitHub style: weeks = columns, days = rows) -->
          <div class="dash-section heatmap-section">
            <div class="dash-section-title" style="margin-bottom: 12px;">活动热力图</div>
            <div class="heatmap-wrap">
              <!-- Month labels row (one per week-column) -->
              <div class="heatmap-months-row">
                <div class="heatmap-day-spacer"></div>
                <div class="heatmap-month-labels">
                  <span
                    v-for="(label, wi) in monthColLabels"
                    :key="wi"
                    class="heatmap-month-col"
                  >{{ label }}</span>
                </div>
              </div>
              <!-- Grid: 7 day-rows × n-week columns -->
              <div class="heatmap-main">
                <div class="heatmap-day-labels">
                  <span v-for="dl in dayLabels" :key="dl" class="heatmap-day-label">{{ dl }}</span>
                </div>
                <div class="heatmap-grid-github">
                  <div v-for="di in 7" :key="di" class="heatmap-row-github">
                    <div
                      v-for="(w, wi) in weeks"
                      :key="wi"
                      class="heatmap-cell"
                      :class="`level-${w.days[di - 1]?.level ?? 0}`"
                      :title="`${w.days[di - 1]?.date ?? ''}: ${(w.days[di - 1]?.tokens ?? 0).toLocaleString()} tokens`"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Row 3: Trend chart (full width) -->
        <div class="dash-section trend-section">
          <div class="dash-section-title">使用趋势（30天）</div>
          <div
            class="trend-chart"
            ref="trendChartRef"
            @mousemove="onTrendMouseMove"
            @mouseleave="onTrendMouseLeave"
          >
            <svg
              :viewBox="`0 0 ${TREND_W} ${TREND_H}`"
              class="trend-svg"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="rgba(34,63,121,0.15)" />
                  <stop offset="100%" stop-color="rgba(34,63,121,0)" />
                </linearGradient>
              </defs>
              <path v-if="areaPath" :d="areaPath" fill="url(#trendGrad)" />
              <path
                v-if="linePath"
                :d="linePath"
                fill="none"
                stroke="#223F79"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <!-- Hover vertical line -->
              <line
                v-if="hoverPoint"
                :x1="hoverPoint.x" :y1="TREND_PAD"
                :x2="hoverPoint.x" :y2="TREND_H - TREND_PAD"
                stroke="rgba(34,63,121,0.25)"
                stroke-width="1.5"
                stroke-dasharray="4 3"
              />
              <!-- Data point circles -->
              <circle
                v-for="(d, i) in trendData"
                :key="i"
                :cx="TREND_PAD + i * ((TREND_W - TREND_PAD * 2) / (trendData.length - 1 || 1))"
                :cy="TREND_PAD + (TREND_H - TREND_PAD * 2) - (d.totalTokens / trendMax) * (TREND_H - TREND_PAD * 2)"
                :r="trendHover?.idx === i ? 5 : 3.5"
                :fill="trendHover?.idx === i ? '#223F79' : '#ffffff'"
                :stroke="'#223F79'"
                :stroke-width="trendHover?.idx === i ? 0 : 2"
              />
            </svg>

            <!-- Hover tooltip -->
            <div
              v-if="hoverPoint"
              class="trend-tooltip"
              :style="{ left: `${hoverPoint.pct}%` }"
            >
              <div class="trend-tip-date">{{ hoverPoint.d.date }}</div>
              <div class="trend-tip-val">{{ hoverPoint.d.totalTokens.toLocaleString() }} tokens</div>
            </div>

            <div class="trend-dates">
              <span
                v-for="d in trendData"
                :key="d.date"
                class="trend-date"
              >{{ d.date.slice(5) }}</span>
            </div>
          </div>
        </div>

      </div>

      <!-- AI Usage section with tabs -->
      <div class="ai-usage-section">
        <div class="ai-usage-header">
          <h3 class="ai-usage-title">AI 用量</h3>
          <div class="bottom-tab-bar">
            <button
              class="bottom-tab-btn"
              :class="{ active: activeTab === 'time' }"
              @click="activeTab = 'time'"
            >
              按时间分布
            </button>
            <button
              class="bottom-tab-btn"
              :class="{ active: activeTab === 'model' }"
              @click="activeTab = 'model'"
            >
              按模型分布
            </button>
            <button
              class="bottom-tab-btn"
              :class="{ active: activeTab === 'rank' }"
              @click="activeTab = 'rank'"
            >
              排行榜
            </button>
          </div>
        </div>

        <!-- Tab: Time distribution -->
        <div v-if="activeTab === 'time'" class="section-card">
          <div class="col-chart">
            <div v-for="d in daily" :key="d.date" class="col-item">
              <div class="col-stack">
                <div class="col-track">
                  <div
                    v-for="m in d.models"
                    :key="m.modelId"
                    class="col-segment"
                    :style="{
                      height: maxDaily ? `${(m.totalTokens / maxDaily) * 100}%` : '0%',
                      background: getModelColor(m.modelId),
                    }"
                  >
                    <img
                      v-if="maxDaily && (m.totalTokens / maxDaily) >= iconThreshold && getModelLogoUrl(m.modelId)"
                      :src="getModelLogoUrl(m.modelId)!"
                      class="segment-icon"
                      alt=""
                    />
                    <div class="segment-tooltip">
                      <div class="tip-title">{{ m.modelName }}</div>
                      <div class="tip-line">Total: {{ fmt(m.totalTokens) }}</div>
                      <div class="tip-line">In: {{ fmt(m.inputTokens) }} / Out: {{ fmt(m.outputTokens) }}</div>
                    </div>
                  </div>
                </div>
                <div class="col-overlay">
                  <div
                    class="col-value"
                    :style="{ bottom: `calc(${(d.totalTokens / maxDaily) * 100}% + 6px)` }"
                  >{{ fmt(d.totalTokens) }}</div>
                </div>
              </div>
              <div class="col-label">{{ d.date.slice(5) }}</div>
            </div>
          </div>
        </div>

        <!-- Tab: Model distribution -->
        <div v-if="activeTab === 'model'" class="section-card">
          <div class="model-list">
            <div v-for="m in stats.filteredSortedModelStats" :key="m.modelId" class="model-row">
              <ModelIcon :model-id="m.modelId" :size="24" />
              <div class="model-info">
                <span class="model-name">{{ m.modelName }}</span>
                <span class="model-provider">{{ m.provider }}</span>
              </div>
              <div class="model-bar-wrap">
                <div class="model-bar-track">
                  <div
                    class="model-bar-fill"
                    :style="{
                      width: `${(m.totalTokens / maxModelTokens) * 100}%`,
                      background: getModelColor(m.modelId),
                    }"
                  />
                </div>
              </div>
              <div class="model-num">{{ fmt(m.totalTokens) }}</div>
            </div>
          </div>
        </div>

        <!-- Tab: Ranking -->
        <div v-if="activeTab === 'rank'" class="section-card">
          <div v-if="ranked.length === 0" class="no-range-data">
            该时间段暂无数据，尝试切换其他时间范围
          </div>
          <div v-else class="rank-list">
            <div v-for="m in ranked" :key="m.modelId" class="rank-item">
              <ModelIcon :model-id="m.modelId" :size="32" />
              <div class="rank-info">
                <div class="rank-name-row">
                  <span class="rank-name">{{ m.modelName }}</span>
                  <span class="rank-provider">{{ m.provider }}</span>
                </div>
                <div class="rank-bar-track">
                  <div
                    class="rank-bar-fill"
                    :style="{
                      width: `${((m[keyMap[stats.sortBy]] as number) / maxRankValue) * 100}%`,
                      background: getModelColor(m.modelId),
                    }"
                  />
                </div>
              </div>
              <div class="rank-stats">
                <div class="rank-stat">
                  <span class="stat-num">{{ fmt(m.totalTokens) }}</span>
                  <span class="stat-label">Tokens</span>
                </div>
                <div class="rank-stat">
                  <span class="stat-num">{{ stats.formatCost(m.cost) }}</span>
                  <span class="stat-label">花费</span>
                </div>
                <div class="rank-stat">
                  <span class="stat-num">{{ fmt(m.requests) }}</span>
                  <span class="stat-label">请求</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.overview-tab {
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.loading-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #8e8e93;
  padding: 60px;
}

.tab-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.tab-title {
  font-size: 18px;
  font-weight: 700;
  color: #1c1c1e;
  margin: 0;
}

/* ─── KPI row ──────────────────────────────────────────────── */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

.kpi-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.15s, transform 0.15s;
}
.kpi-card:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.kpi-value {
  font-size: 20px;
  font-weight: 700;
  color: #1c1c1e;
  line-height: 1.2;
}
.kpi-label {
  font-size: 12px;
  color: #8e8e93;
  margin-top: 4px;
}
.kpi-sub {
  font-size: 11px;
  color: #aeaeb2;
  margin-top: 2px;
}

/* ─── Dashboard body ───────────────────────────────────────── */
.dashboard-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Row 1: top-models (1/2) + hero (1/2) */
.dash-row-top {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

/* Row 2: pie (1/3) + heatmap (2/3) */
.pie-heatmap-row {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 16px;
  align-items: stretch;
}

.dash-section {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 18px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

.dash-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.dash-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #1c1c1e;
}

.sort-bar {
  display: flex;
  gap: 4px;
}

.sort-btn {
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #ffffff;
  font-size: 11px;
  color: #8e8e93;
  cursor: pointer;
  transition: all 0.12s;
}

.sort-btn:hover {
  background: rgba(0, 0, 0, 0.03);
}

.sort-btn.active {
  background: rgba(34, 63, 121, 0.10);
  border-color: rgba(34, 63, 121, 0.18);
  color: #223F79;
  font-weight: 500;
}

.top-model-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.top-model-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.top-model-rank {
  width: 18px;
  text-align: center;
  color: #8e8e93;
  font-weight: 600;
  font-size: 12px;
}

.top-model-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #3c3c43;
  font-weight: 500;
}

.top-model-pct {
  color: #8e8e93;
  font-weight: 600;
  font-size: 12px;
}

/* ─── Hero block ───────────────────────────────────────────── */
.hero-block {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 22px 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.hero-label {
  font-size: 12px;
  color: #8e8e93;
  letter-spacing: 0.08em;
}

.hero-value {
  font-size: 40px;
  font-weight: 800;
  color: #1c1c1e;
  line-height: 1.1;
  word-break: break-all;
}

.hero-cost {
  font-size: 16px;
  color: #34c759;
  font-weight: 600;
}

.hero-divider {
  width: 100%;
  height: 1px;
  background: rgba(0, 0, 0, 0.06);
  margin: 8px 0 4px;
}

.hero-metrics {
  display: flex;
  width: 100%;
  justify-content: space-around;
  gap: 8px;
}

.hero-metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.hero-metric-value {
  font-size: 16px;
  font-weight: 700;
  color: #1c1c1e;
}

.hero-metric-label {
  font-size: 11px;
  color: #8e8e93;
}

/* ─── Provider pie ─────────────────────────────────────────── */
.pie-section {
  display: flex;
  flex-direction: column;
  min-height: 200px;
}

.pie-chart-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  flex: 1;
  padding: 4px 0;
}

.pie-svg {
  width: 120px;
  height: 120px;
  flex-shrink: 0;
}

.pie-legend {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.pie-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pie-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pie-legend-name {
  font-size: 11px;
  color: #3c3c43;
  font-weight: 500;
}

.pie-legend-pct {
  font-size: 10px;
  color: #8e8e93;
}

/* ─── Heatmap (GitHub style: weeks = columns, days = rows) ─── */
.heatmap-section {
  min-height: 200px;
  display: flex;
  flex-direction: column;
}

.heatmap-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 4px;
  flex: 1;
}

.heatmap-months-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.heatmap-day-spacer {
  width: 20px;
  flex-shrink: 0;
}

.heatmap-month-labels {
  display: flex;
  gap: 3px;
}

.heatmap-month-col {
  width: 14px;
  font-size: 10px;
  color: #8e8e93;
  text-align: center;
  white-space: nowrap;
  overflow: visible;
  flex-shrink: 0;
}

.heatmap-main {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.heatmap-day-labels {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 20px;
  flex-shrink: 0;
  padding-top: 1px;
}

.heatmap-day-label {
  height: 14px;
  font-size: 10px;
  color: #aeaeb2;
  line-height: 14px;
  text-align: right;
}

.heatmap-grid-github {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.heatmap-row-github {
  display: flex;
  gap: 3px;
}

.heatmap-cell {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: #ebedf0;
  transition: transform 0.1s;
  cursor: pointer;
  flex-shrink: 0;
}

.heatmap-cell:hover {
  transform: scale(1.25);
  outline: 1px solid rgba(0, 0, 0, 0.2);
  z-index: 1;
}

.level-1 { background: #a8d5ba; }
.level-2 { background: #5cb85c; }
.level-3 { background: #2e7d32; }
.level-4 { background: #1b5e20; }

/* ─── Trend chart ──────────────────────────────────────────── */
.trend-section {
  padding: 18px;
}

.trend-chart {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 4px;
  cursor: crosshair;
}

.trend-svg {
  width: 100%;
  height: 120px;
  overflow: visible;
}

.trend-tooltip {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  background: #1c1c1e;
  color: #fff;
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.trend-tip-date {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.65);
  margin-bottom: 2px;
}

.trend-tip-val {
  font-weight: 600;
  font-size: 13px;
}

.trend-dates {
  display: flex;
  justify-content: space-between;
  padding: 0 4px;
}

.trend-date {
  font-size: 10px;
  color: #aeaeb2;
  white-space: nowrap;
}

/* ─── AI Usage section ─────────────────────────────────────── */
.ai-usage-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ai-usage-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.ai-usage-title {
  font-size: 16px;
  font-weight: 700;
  color: #1c1c1e;
  margin: 0;
  padding: 10px 0;
}

.bottom-tab-bar {
  display: flex;
  align-items: center;
  gap: 4px;
}

.bottom-tab-btn {
  padding: 10px 18px;
  font-size: 13px;
  color: #8e8e93;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all 0.12s;
  user-select: none;
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
}

.bottom-tab-btn:hover {
  color: #3c3c43;
}

.bottom-tab-btn.active {
  color: #223F79;
  font-weight: 500;
  border-bottom-color: #223F79;
}

/* ─── Section cards (shared) ───────────────────────────────── */
.section-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  overflow: visible;
}

/* ─── Time distribution col chart ──────────────────────────── */
.col-chart {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 320px;
  padding-bottom: 24px;
}

.col-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.col-stack {
  position: relative;
  width: 100%;
  height: 280px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.col-track {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 5px;
}

.col-segment {
  width: 100%;
  position: relative;
  min-height: 2px;
  transition: filter 0.15s;
}

.col-segment:hover {
  filter: brightness(1.1);
}

.segment-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 14px;
  height: 14px;
  opacity: 0.9;
}

.segment-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: #1c1c1e;
  color: #fff;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
  z-index: 10;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.segment-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: #1c1c1e;
}

.col-segment:hover .segment-tooltip {
  opacity: 1;
}

.tip-title {
  font-weight: 600;
  margin-bottom: 2px;
}

.tip-line {
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
}

.col-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
}

.col-value {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  font-weight: 600;
  color: #8e8e93;
  white-space: nowrap;
}

.col-label {
  font-size: 10px;
  color: #aeaeb2;
  white-space: nowrap;
}

/* ─── Model distribution list ──────────────────────────────── */
.model-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.model-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.model-info {
  width: 160px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-name {
  font-size: 13px;
  font-weight: 500;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-provider {
  font-size: 11px;
  color: #8e8e93;
}

.model-bar-wrap {
  flex: 1;
  min-width: 0;
}

.model-bar-track {
  height: 8px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
  overflow: hidden;
}

.model-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.6s ease;
}

.model-num {
  width: 80px;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
  color: #3c3c43;
  font-variant-numeric: tabular-nums;
}

/* ─── Ranking ──────────────────────────────────────────────── */
.no-range-data {
  text-align: center;
  padding: 40px;
  color: #8e8e93;
  font-size: 14px;
}

.rank-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rank-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
}

.rank-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rank-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rank-name {
  font-size: 14px;
  font-weight: 500;
  color: #1c1c1e;
}

.rank-provider {
  font-size: 11px;
  color: #8e8e93;
}

.rank-bar-track {
  height: 6px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 3px;
  overflow: hidden;
}

.rank-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.6s ease;
}

.rank-stats {
  display: flex;
  gap: 16px;
  flex-shrink: 0;
}

.rank-stat {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  min-width: 60px;
}

.stat-num {
  font-size: 13px;
  font-weight: 600;
  color: #1c1c1e;
  font-variant-numeric: tabular-nums;
}

.stat-label {
  font-size: 10px;
  color: #8e8e93;
}
</style>
