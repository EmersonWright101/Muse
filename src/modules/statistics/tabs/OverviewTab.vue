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
const topModels = computed(() =>
  [...stats.modelStats].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 5)
)
const topModelsTotal = computed(() => topModels.value.reduce((s, m) => s + m.totalTokens, 0) || 1)

const sortOptions: { key: SortBy; label: string }[] = [
  { key: 'tokens', label: 'Token' },
  { key: 'cost', label: '花费' },
  { key: 'requests', label: '请求' },
]

/* ─── Provider cards ────────────────────────────────────────── */
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

/* ─── Trend mini chart ──────────────────────────────────────── */
const trendData = computed(() => stats.dailyStatsAll.slice(-30))
const trendMax = computed(() => Math.max(...trendData.value.map(d => d.totalTokens), 1))

/* ─── Meta ──────────────────────────────────────────────────── */
const activeDays = computed(() => stats.dailyStatsAll.length)
const startedAt = computed(() => {
  const all = stats.dailyStatsAll
  if (!all.length) return '-'
  return all[0].date
})

/* ─── Token time distribution ───────────────────────────────── */
const daily = computed(() => stats.dailyStats)
const maxDaily = computed(() => Math.max(...daily.value.map(d => d.totalTokens), 1))
const maxModelTokens = computed(() => Math.max(...stats.filteredSortedModelStats.map(m => m.totalTokens), 1))

const CHART_HEIGHT = 320
const ICON_MIN_PX = 18
const iconThreshold = ICON_MIN_PX / CHART_HEIGHT

/* ─── Ranking ───────────────────────────────────────────────── */
const keyMap: Record<string, keyof typeof stats.modelStats[number]> = { tokens: 'totalTokens', cost: 'cost', requests: 'requests' }
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

const monthLabels = computed(() => {
  const labels: { text: string; index: number }[] = []
  const seen = new Set<string>()
  weeks.value.forEach((w, wi) => {
    const mid = w.days[3]
    if (!mid) return
    const month = mid.date.slice(0, 7)
    if (!seen.has(month)) {
      seen.add(month)
      labels.push({ text: `${+mid.date.slice(5, 7)}月`, index: wi })
    }
  })
  return labels
})

const dayLabels = ['日', '一', '二', '三', '四', '五', '六']

const monthRowLabels = computed(() => {
  const labels: { text: string; show: boolean }[] = []
  const seen = new Set<string>()
  weeks.value.forEach((w) => {
    const mid = w.days[3]
    if (!mid) {
      labels.push({ text: '', show: false })
      return
    }
    const month = mid.date.slice(0, 7)
    if (!seen.has(month)) {
      seen.add(month)
      labels.push({ text: `${+mid.date.slice(5, 7)}月`, show: true })
    } else {
      labels.push({ text: '', show: false })
    }
  })
  return labels
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

      <!-- Main dashboard body -->
      <div class="dashboard-body">
        <!-- Left column -->
        <div class="dash-left">
          <!-- Top models with sort -->
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
                <span class="top-model-pct">
                  {{ ((m.totalTokens / topModelsTotal) * 100).toFixed(1) }}%
                </span>
              </div>
            </div>
          </div>

          <!-- Heatmap (compact, placed in left column) -->
          <div class="dash-section heatmap-section">
            <div class="dash-section-title">活动热力图</div>
            <div class="heatmap-wrap">
              <!-- Header: corner + day labels -->
              <div class="heatmap-header">
                <div class="corner-spacer" />
                <div class="day-header-row">
                  <span v-for="label in dayLabels" :key="label" class="day-header">{{ label }}</span>
                </div>
              </div>
              <!-- Body: month labels + grid -->
              <div class="heatmap-body">
                <div class="month-labels-col">
                  <span
                    v-for="(m, i) in monthRowLabels"
                    :key="i"
                    class="month-label-row"
                  >{{ m.show ? m.text : '' }}</span>
                </div>
                <div class="heatmap-grid">
                  <div
                    v-for="(w, wi) in weeks"
                    :key="wi"
                    class="heatmap-week"
                  >
                    <div
                      v-for="(day, di) in w.days"
                      :key="di"
                      class="heatmap-cell"
                      :class="`level-${day.level}`"
                      :title="`${day.date}: ${day.tokens.toLocaleString()} tokens`"
                    />
                  </div>
                </div>
              </div>
              <div class="heatmap-legend">
                <span class="legend-label">少</span>
                <div class="legend-cell level-0" />
                <div class="legend-cell level-1" />
                <div class="legend-cell level-2" />
                <div class="legend-cell level-3" />
                <div class="legend-cell level-4" />
                <span class="legend-label">多</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Right column -->
        <div class="dash-right">
          <div class="hero-block">
            <div class="hero-label">TOTAL TOKENS</div>
            <div class="hero-value">{{ fmtBig(stats.totalTokens) }}</div>
            <div class="hero-cost">{{ stats.formatCost(stats.totalCost) }}</div>
          </div>

          <div class="provider-row">
            <div
              v-for="p in providerStats"
              :key="p.name"
              class="provider-card"
            >
              <div class="provider-name">{{ p.name }}</div>
              <div class="provider-pct">{{ p.pct }}%</div>
              <div class="provider-sub">{{ p.modelCount }} 个模型</div>
            </div>
          </div>

          <div class="dash-section">
            <div class="dash-section-title">使用趋势（30天）</div>
            <div class="trend-chart">
              <div
                v-for="d in trendData"
                :key="d.date"
                class="trend-col"
              >
                <div class="trend-bar-wrap">
                  <div
                    class="trend-bar"
                    :style="{ height: `${(d.totalTokens / trendMax) * 100}%` }"
                  />
                </div>
                <div class="trend-date">{{ d.date.slice(5) }}</div>
              </div>
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
  min-height: 100%;
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

/* ─── Body grid ────────────────────────────────────────────── */
.dashboard-body {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 20px;
}

/* ─── Left column ──────────────────────────────────────────── */
.dash-left {
  display: flex;
  flex-direction: column;
  gap: 12px;
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

/* ─── Heatmap (compact, inside left column) ────────────────── */
.heatmap-section {
  padding: 14px;
}

.heatmap-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.heatmap-header {
  display: flex;
  gap: 4px;
}

.corner-spacer {
  width: 28px;
  flex-shrink: 0;
}

.day-header-row {
  display: flex;
  gap: 2px;
}

.day-header {
  width: 10px;
  font-size: 8px;
  color: #aeaeb2;
  text-align: center;
  line-height: 10px;
}

.heatmap-body {
  display: flex;
  gap: 4px;
}

.month-labels-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 28px;
  flex-shrink: 0;
}

.month-label-row {
  height: 10px;
  font-size: 9px;
  color: #8e8e93;
  line-height: 10px;
  text-align: right;
}

.heatmap-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.heatmap-week {
  display: flex;
  gap: 2px;
}

.heatmap-cell {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: #ebedf0;
  transition: transform 0.1s;
  cursor: pointer;
}
.heatmap-cell:hover {
  transform: scale(1.3);
  outline: 1px solid rgba(0,0,0,0.2);
  z-index: 1;
}

.level-1 { background: #a8d5ba; }
.level-2 { background: #5cb85c; }
.level-3 { background: #2e7d32; }
.level-4 { background: #1b5e20; }

.heatmap-legend {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 4px;
  padding-left: 32px;
}

.legend-label {
  font-size: 9px;
  color: #8e8e93;
}

.legend-cell {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

/* ─── Right column ─────────────────────────────────────────── */
.dash-right {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hero-block {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 28px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  text-align: center;
}

.hero-label {
  font-size: 12px;
  color: #8e8e93;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
}

.hero-value {
  font-size: 42px;
  font-weight: 800;
  color: #1c1c1e;
  line-height: 1.1;
  word-break: break-all;
}

.hero-cost {
  font-size: 16px;
  color: #34c759;
  font-weight: 600;
  margin-top: 8px;
}

/* Provider cards */
.provider-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.provider-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.15s;
}
.provider-card:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

.provider-name {
  font-size: 12px;
  color: #8e8e93;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.provider-pct {
  font-size: 22px;
  font-weight: 700;
  color: #1c1c1e;
  margin-top: 6px;
}

.provider-sub {
  font-size: 11px;
  color: #aeaeb2;
  margin-top: 2px;
}

/* Trend chart */
.trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 120px;
  padding-bottom: 20px;
  position: relative;
}

.trend-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.trend-bar-wrap {
  width: 100%;
  height: 100px;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 3px 3px 0 0;
  overflow: hidden;
}

.trend-bar {
  width: 100%;
  background: #223F79;
  opacity: 0.85;
  border-radius: 3px 3px 0 0;
  transition: height 0.4s ease;
  min-height: 2px;
}
.trend-bar:hover {
  opacity: 1;
}

.trend-date {
  font-size: 9px;
  color: #aeaeb2;
  white-space: nowrap;
  transform: rotate(-35deg);
  transform-origin: top center;
  margin-top: 2px;
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
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
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
  color: rgba(255,255,255,0.7);
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
