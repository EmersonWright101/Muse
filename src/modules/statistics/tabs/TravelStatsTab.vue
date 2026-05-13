<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileText, Image, Star, Trash2 } from 'lucide-vue-next'
import { apiGet } from '../../../services/api'
import { resolveImageUrl, initImageAssetBase } from '../../../utils/imageAsset'
import EmptyState from '../components/EmptyState.vue'

const { t } = useI18n()

interface TravelStats {
  total_notes: number
  total_images: number
  total_content_bytes: number
  total_image_bytes: number
  trashed_notes: number
  avg_rating: number
  category_distribution: Record<string, number>
  province_distribution: Record<string, number>
  status_distribution: Record<string, number>
  rating_distribution: Record<string, number>
  notes_by_month: Array<{ month: string; count: number }>
  top_tags: Array<{ tag: string; count: number }>
  recent_notes: Array<{
    id: string
    title: string
    date: string
    rating: number
    cover: string
    status: string
  }>
}

const data = ref<TravelStats | null>(null)
const loading = ref(false)
const hasData = computed(() => !!data.value && data.value.total_notes > 0)
const hoveredSlice = ref<string | null>(null)
const hoveredBar = ref<{ month: string; count: number } | null>(null)

async function load() {
  loading.value = true
  try {
    const res = await apiGet<TravelStats>('/api/statistics/travel')
    data.value = res
  } catch {
    data.value = null
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await initImageAssetBase()
  load()
})

/* ─── Helpers ─────────────────────────────────────────────────── */
function fmt(n: number): string {
  return n.toLocaleString()
}

/* ─── KPI ─────────────────────────────────────────────────────── */
const kpiCards = computed(() => {
  const d = data.value
  if (!d) return []
  return [
    { label: t('statistics.travelStats.totalNotes'), value: fmt(d.total_notes), icon: FileText, hero: true },
    { label: t('statistics.travelStats.totalImages'), value: fmt(d.total_images), icon: Image, hero: false },
    { label: t('statistics.travelStats.avgRating'), value: d.avg_rating.toFixed(1), icon: Star, hero: false },
    { label: t('statistics.travelStats.trashedNotes'), value: fmt(d.trashed_notes), icon: Trash2, hero: false },
  ]
})

/* ─── Pie charts ──────────────────────────────────────────────── */
const countryPie = computed(() => {
  const dist = data.value?.category_distribution ?? {}
  return buildPieSlices(dist)
})

const provincePie = computed(() => {
  const dist = data.value?.province_distribution ?? {}
  return buildPieSlices(dist)
})

function buildPieSlices(dist: Record<string, number>) {
  const entries = Object.entries(dist).filter(([, v]) => v > 0)
  if (!entries.length) return []
  const total = entries.reduce((s, [, v]) => s + v, 0)
  const colors = ['#3B5BA5', '#52BA6F', '#E4983D', '#9B6CF0', '#20BDB8', '#F0A830', '#E85D75', '#6B8E23', '#FF6B9D', '#5DADE2']
  let acc = 0
  return entries.sort((a, b) => b[1] - a[1]).map(([name, count], i) => {
    const pct = count / total
    const start = acc
    acc += pct
    return {
      name,
      count,
      pct: Math.round(pct * 100),
      color: colors[i % colors.length],
      d: describeArc(50, 50, 40, start * 360 - 90, acc * 360 - 90),
    }
  })
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const startRad = (startAngle * Math.PI) / 180
  const endRad = (endAngle * Math.PI) / 180
  const x1 = cx + r * Math.cos(startRad)
  const y1 = cy + r * Math.sin(startRad)
  const x2 = cx + r * Math.cos(endRad)
  const y2 = cy + r * Math.sin(endRad)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`
}

/* ─── Rating bars ─────────────────────────────────────────────── */
const ratingItems = computed(() => {
  const d = data.value?.rating_distribution ?? {}
  const max = Math.max(...Array.from({ length: 5 }, (_, i) => d[String(i + 1)] ?? 0), 1)
  return Array.from({ length: 5 }, (_, i) => {
    const key = String(i + 1)
    const count = d[key] ?? 0
    return { stars: i + 1, count, pct: (count / max) * 100 }
  }).reverse()
})

/* ─── Top tags ────────────────────────────────────────────────── */
const tagItems = computed(() => {
  return (data.value?.top_tags ?? []).slice(0, 10)
})

const TAG_COLORS = ['#223F79', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#6366f1']

/* ─── Notes by month chart ────────────────────────────────────── */
const CHART_W = 800
const CHART_H = 160
const CHART_PAD = 20

const monthData = computed(() => {
  return (data.value?.notes_by_month ?? []).slice(-12)
})

const monthMax = computed(() => Math.max(...monthData.value.map(d => d.count), 1))

const monthBars = computed(() => {
  const list = monthData.value
  if (!list.length) return []
  const n = list.length
  const barW = n > 0 ? (CHART_W - CHART_PAD * 2) / n * 0.6 : 0
  const step = n > 1 ? (CHART_W - CHART_PAD * 2) / (n - 1) : 0
  return list.map((d, i) => {
    const h = (d.count / monthMax.value) * (CHART_H - CHART_PAD * 2)
    const x = CHART_PAD + i * step - barW / 2
    const y = CHART_H - CHART_PAD - h
    return { x, y, w: barW, h, count: d.count, month: d.month }
  })
})

const monthLinePath = computed(() => {
  const list = monthData.value
  if (list.length < 2) return ''
  const step = (CHART_W - CHART_PAD * 2) / (list.length - 1)
  const chartH = CHART_H - CHART_PAD * 2
  const points = list.map((d, i) => {
    const x = CHART_PAD + i * step
    const y = CHART_PAD + chartH - (d.count / monthMax.value) * chartH
    return `${x},${y}`
  })
  return `M ${points.join(' L ')}`
})

const monthAreaPath = computed(() => {
  const line = monthLinePath.value
  if (!line) return ''
  const list = monthData.value
  const step = (CHART_W - CHART_PAD * 2) / (list.length - 1)
  const firstX = CHART_PAD
  const lastX = CHART_PAD + (list.length - 1) * step
  const bottomY = CHART_H - CHART_PAD
  return `M ${firstX},${bottomY} ${line.replace('M', 'L')} L ${lastX},${bottomY} Z`
})

/* ─── Recent notes ────────────────────────────────────────────── */
const recentNotes = computed(() => {
  return (data.value?.recent_notes ?? []).slice(0, 5)
})

function statusLabel(s: string): string {
  return s === 'visited' ? t('travel.visited') : t('travel.upcoming')
}

function statusClass(s: string): string {
  return s === 'visited' ? 'status-visited' : 'status-upcoming'
}

function isImagePath(str: string): boolean {
  return str.startsWith('http') || str.startsWith('/') || str.includes('.')
}
</script>

<template>
  <div class="travel-stats-tab">
    <template v-if="loading">
      <div class="loading-state">{{ t('common.loading') }}</div>
    </template>
    <template v-else-if="!hasData">
      <EmptyState />
    </template>
    <template v-else>
      <div class="tab-header">
        <h2 class="tab-title">{{ t('statistics.travelStats.title') }}</h2>
      </div>

      <!-- KPI Row -->
      <div class="kpi-row">
        <div
          v-for="(card, idx) in kpiCards"
          :key="card.label"
          class="kpi-card"
          :class="{ 'kpi-hero': idx === 0 }"
        >
          <div class="kpi-icon">
            <component :is="card.icon" :size="18" />
          </div>
          <div class="kpi-value">{{ card.value }}</div>
          <div class="kpi-label">{{ card.label }}</div>
        </div>
      </div>

      <!-- Row 2: Country + Province pie charts -->
      <div class="dash-row">
        <div class="dash-card">
          <div class="dash-title">{{ t('statistics.travelStats.countryDistribution') }}</div>
          <div v-if="!countryPie.length" class="no-data">{{ t('statistics.travelStats.noData') }}</div>
          <div v-else class="pie-wrap" style="position: relative;">
            <svg viewBox="0 0 100 100" class="pie-svg">
              <path
                v-for="slice in countryPie"
                :key="slice.name"
                :d="slice.d"
                :fill="slice.color"
                class="pie-slice"
                :class="{ dimmed: hoveredSlice && hoveredSlice !== slice.name }"
                @mouseenter="hoveredSlice = slice.name"
                @mouseleave="hoveredSlice = null"
              />
            </svg>
            <div class="pie-legend">
              <div
                v-for="slice in countryPie"
                :key="slice.name"
                class="pie-legend-item"
                :class="{ dimmed: hoveredSlice && hoveredSlice !== slice.name }"
                @mouseenter="hoveredSlice = slice.name"
                @mouseleave="hoveredSlice = null"
              >
                <div class="pie-legend-dot" :style="{ background: slice.color }" />
                <div class="pie-legend-text">
                  <div class="pie-legend-name">{{ slice.name }}</div>
                  <div class="pie-legend-pct">{{ slice.pct }}% · {{ fmt(slice.count) }}</div>
                </div>
              </div>
            </div>
            <div v-if="hoveredSlice && countryPie.find(s => s.name === hoveredSlice)" class="chart-tooltip">
              <template v-for="slice in countryPie" :key="slice.name">
                <div v-if="slice.name === hoveredSlice">
                  <div class="tooltip-name">{{ slice.name }}</div>
                  <div class="tooltip-value">{{ slice.pct }}% · {{ fmt(slice.count) }}</div>
                </div>
              </template>
            </div>
          </div>
        </div>

        <div class="dash-card">
          <div class="dash-title">{{ t('statistics.travelStats.provinceDistribution') }}</div>
          <div v-if="!provincePie.length" class="no-data">{{ t('statistics.travelStats.noData') }}</div>
          <div v-else class="pie-wrap" style="position: relative;">
            <svg viewBox="0 0 100 100" class="pie-svg">
              <path
                v-for="slice in provincePie"
                :key="slice.name"
                :d="slice.d"
                :fill="slice.color"
                class="pie-slice"
                :class="{ dimmed: hoveredSlice && hoveredSlice !== slice.name }"
                @mouseenter="hoveredSlice = slice.name"
                @mouseleave="hoveredSlice = null"
              />
            </svg>
            <div class="pie-legend">
              <div
                v-for="slice in provincePie"
                :key="slice.name"
                class="pie-legend-item"
                :class="{ dimmed: hoveredSlice && hoveredSlice !== slice.name }"
                @mouseenter="hoveredSlice = slice.name"
                @mouseleave="hoveredSlice = null"
              >
                <div class="pie-legend-dot" :style="{ background: slice.color }" />
                <div class="pie-legend-text">
                  <div class="pie-legend-name">{{ slice.name }}</div>
                  <div class="pie-legend-pct">{{ slice.pct }}% · {{ fmt(slice.count) }}</div>
                </div>
              </div>
            </div>
            <div v-if="hoveredSlice && provincePie.find(s => s.name === hoveredSlice)" class="chart-tooltip">
              <template v-for="slice in provincePie" :key="slice.name">
                <div v-if="slice.name === hoveredSlice">
                  <div class="tooltip-name">{{ slice.name }}</div>
                  <div class="tooltip-value">{{ slice.pct }}% · {{ fmt(slice.count) }}</div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Row 3: Rating + Tags -->
      <div class="dash-row">
        <div class="dash-card">
          <div class="dash-title">{{ t('statistics.travelStats.ratingDistribution') }}</div>
          <div class="rating-chart">
            <div
              v-for="item in ratingItems"
              :key="item.stars"
              class="rating-col"
              @mouseenter="hoveredSlice = 'rating-' + item.stars"
              @mouseleave="hoveredSlice = null"
            >
              <div class="rating-count">{{ fmt(item.count) }}</div>
              <div class="rating-bars">
                <div class="rating-track">
                  <div
                    class="rating-fill"
                    :class="{ highlighted: hoveredSlice === 'rating-' + item.stars }"
                    :style="{ height: `${item.pct}%` }"
                  />
                </div>
              </div>
              <div class="rating-stars">
                <span v-for="s in item.stars" :key="s" class="star-icon">★</span>
              </div>
              <div v-if="hoveredSlice === 'rating-' + item.stars" class="chart-tooltip bar-tooltip">
                <div class="tooltip-name">{{ item.stars }} ★</div>
                <div class="tooltip-value">{{ fmt(item.count) }} notes</div>
              </div>
            </div>
          </div>
        </div>

        <div class="dash-card">
          <div class="dash-title">{{ t('statistics.travelStats.topTags') }}</div>
          <div class="tag-list">
            <div
              v-for="(tag, idx) in tagItems"
              :key="tag.tag"
              class="tag-chip"
              :style="{
                background: `${TAG_COLORS[idx % TAG_COLORS.length]}15`,
                color: TAG_COLORS[idx % TAG_COLORS.length],
                borderColor: `${TAG_COLORS[idx % TAG_COLORS.length]}30`,
              }"
            >
              <span class="tag-name">{{ tag.tag }}</span>
              <span class="tag-count">{{ tag.count }}</span>
            </div>
          </div>
          <div v-if="!tagItems.length" class="no-data">{{ t('statistics.travelStats.noTags') }}</div>
        </div>
      </div>

      <!-- Row 4: Notes by month -->
      <div class="dash-card full-width">
        <div class="dash-title">{{ t('statistics.travelStats.notesByMonth') }}</div>
        <div class="month-chart">
          <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" class="month-svg" preserveAspectRatio="none">
            <defs>
              <linearGradient id="monthGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="rgba(34,63,121,0.15)" />
                <stop offset="100%" stop-color="rgba(34,63,121,0)" />
              </linearGradient>
            </defs>
            <path v-if="monthAreaPath" :d="monthAreaPath" fill="url(#monthGrad)" />
            <path
              v-if="monthLinePath"
              :d="monthLinePath"
              fill="none"
              stroke="#223F79"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <circle
              v-for="(bar, i) in monthBars"
              :key="i"
              :cx="CHART_PAD + i * ((CHART_W - CHART_PAD * 2) / (monthData.length - 1 || 1))"
              :cy="CHART_PAD + (CHART_H - CHART_PAD * 2) - (bar.count / monthMax) * (CHART_H - CHART_PAD * 2)"
              r="4"
              fill="#ffffff"
              stroke="#223F79"
              stroke-width="2"
              class="month-dot"
              :class="{ 'dot-highlighted': hoveredBar && hoveredBar.month === bar.month }"
              @mouseenter="hoveredBar = bar"
              @mouseleave="hoveredBar = null"
            />
          </svg>
          <div v-if="hoveredBar" class="chart-tooltip month-tooltip">
            <div class="tooltip-name">{{ hoveredBar.month }}</div>
            <div class="tooltip-value">{{ fmt(hoveredBar.count) }} notes</div>
          </div>
          <div class="month-labels">
            <span
              v-for="bar in monthBars"
              :key="bar.month"
              class="month-label"
            >{{ bar.month.slice(5) }}</span>
          </div>
        </div>
      </div>

      <!-- Row 5: Recent notes -->
      <div class="dash-card full-width">
        <div class="dash-title">{{ t('statistics.travelStats.recentNotes') }}</div>
        <div class="recent-list">
          <div v-for="note in recentNotes" :key="note.id" class="recent-item">
            <div class="recent-cover">
              <img v-if="isImagePath(note.cover)" :src="resolveImageUrl(note.cover)" class="recent-img" />
              <span v-else>{{ note.cover || '📷' }}</span>
            </div>
            <div class="recent-info">
              <div class="recent-title">{{ note.title || t('statistics.travelStats.untitled') }}</div>
              <div class="recent-meta">
                <span class="recent-date">{{ note.date }}</span>
                <span class="recent-stars">
                  <span v-for="s in note.rating" :key="s" class="star-gold">★</span>
                </span>
              </div>
            </div>
            <span class="recent-status" :class="statusClass(note.status)">
              {{ statusLabel(note.status) }}
            </span>
          </div>
        </div>
        <div v-if="!recentNotes.length" class="no-data">{{ t('statistics.travelStats.noRecentNotes') }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.travel-stats-tab {
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
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
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kpi-card:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.kpi-hero {
  background: linear-gradient(135deg, #223F79 0%, #2a4d94 100%);
  color: #ffffff;
  border: none;
}
.kpi-hero .kpi-icon { color: rgba(255, 255, 255, 0.75); }
.kpi-hero .kpi-value { color: #ffffff; }
.kpi-hero .kpi-label { color: rgba(255, 255, 255, 0.7); }

.kpi-icon {
  color: #223F79;
  display: flex;
  align-items: center;
}

.kpi-value {
  font-size: 22px;
  font-weight: 700;
  color: #1c1c1e;
  line-height: 1.2;
}

.kpi-label {
  font-size: 12px;
  color: #8e8e93;
}

/* ─── Dash rows ────────────────────────────────────────────── */
.dash-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.dash-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  min-height: 200px;
}

.dash-card.full-width {
  grid-column: 1 / -1;
}

.dash-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  margin-bottom: 16px;
}

/* ─── Pie / Donut ──────────────────────────────────────────── */
.pie-wrap, .donut-wrap {
  display: flex;
  align-items: center;
  gap: 20px;
  flex: 1;
}

.pie-svg, .donut-svg {
  width: 120px;
  height: 120px;
  flex-shrink: 0;
}

.pie-legend, .donut-legend {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.pie-legend-item, .donut-legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pie-legend-dot, .donut-legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pie-legend-text, .donut-legend-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pie-legend-name, .donut-legend-name {
  font-size: 12px;
  color: #3c3c43;
  font-weight: 500;
}

.pie-legend-pct, .donut-legend-pct {
  font-size: 11px;
  color: #8e8e93;
}

/* ─── Donut ────────────────────────────────────────────────── */
.donut-wrap {
  display: flex;
  align-items: center;
  gap: 20px;
  flex: 1;
}

.donut-svg {
  width: 120px;
  height: 120px;
  flex-shrink: 0;
}

.donut-legend {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.donut-legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.donut-legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.donut-legend-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.donut-legend-name {
  font-size: 12px;
  color: #3c3c43;
  font-weight: 500;
}

.donut-legend-pct {
  font-size: 11px;
  color: #8e8e93;
}

/* ─── Rating chart ─────────────────────────────────────────── */
.rating-chart {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 24px;
  flex: 1;
  padding: 8px 0;
}

.rating-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 1;
  max-width: 60px;
}

.rating-count {
  font-size: 11px;
  color: #8e8e93;
  font-weight: 600;
  min-height: 14px;
}

.rating-bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  width: 100%;
  height: 120px;
}

.rating-track {
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 6px 6px 4px 4px;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
}

.rating-fill {
  width: 100%;
  background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 100%);
  border-radius: 6px 6px 0 0;
  transition: height 0.4s ease;
}

.rating-stars {
  display: flex;
  gap: 1px;
  font-size: 12px;
  color: #f59e0b;
}

.star-icon {
  line-height: 1;
}

/* ─── Tags ─────────────────────────────────────────────────── */
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-content: flex-start;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid;
  font-size: 12px;
  font-weight: 500;
  transition: transform 0.12s;
}
.tag-chip:hover {
  transform: translateY(-1px);
}

.tag-name {
  font-weight: 500;
}

.tag-count {
  font-size: 10px;
  opacity: 0.8;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 5px;
  border-radius: 4px;
}

/* ─── Month chart ──────────────────────────────────────────── */
.month-chart {
  padding: 4px 0 0;
}

.month-svg {
  width: 100%;
  height: 160px;
  display: block;
}

.month-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  padding: 0 4px;
}

.month-label {
  font-size: 11px;
  color: #8e8e93;
  flex: 1;
  text-align: center;
}

/* ─── Recent notes ─────────────────────────────────────────── */
.recent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: #f9f9f9;
  border-radius: 10px;
  transition: background 0.12s;
}
.recent-item:hover {
  background: #f3f3f5;
}

.recent-cover {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.recent-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.recent-title {
  font-size: 14px;
  font-weight: 500;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.recent-date {
  color: #8e8e93;
}

.recent-stars {
  display: flex;
  gap: 1px;
  color: #f59e0b;
  font-size: 11px;
}

.star-gold {
  line-height: 1;
}

.recent-status {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  flex-shrink: 0;
}

.status-visited {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.status-upcoming {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.no-data {
  font-size: 13px;
  color: #8e8e93;
  text-align: center;
  padding: 20px 0;
}

/* Chart hover interactions */
.pie-wrap { position: relative; }

.pie-slice {
  transition: opacity 0.2s ease, transform 0.25s ease;
  transform-origin: center;
  cursor: pointer;
}
.pie-slice:hover {
  transform: scale(1.04);
}
.pie-slice.dimmed {
  opacity: 0.3;
}

.pie-legend-item {
  transition: opacity 0.2s ease;
  cursor: pointer;
}
.pie-legend-item.dimmed {
  opacity: 0.35;
}

.chart-tooltip {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(28, 28, 30, 0.92);
  backdrop-filter: blur(12px);
  color: #fff;
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 12px;
  pointer-events: none;
  z-index: 10;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  text-align: center;
  min-width: 80px;
}
.tooltip-name { font-weight: 600; margin-bottom: 2px; }
.tooltip-value { font-size: 11px; opacity: 0.85; }

.rating-col { position: relative; cursor: pointer; }
.rating-fill {
  transition: height 0.4s ease, filter 0.2s ease;
}
.rating-fill.highlighted {
  filter: brightness(1.15);
}

.bar-tooltip {
  top: auto;
  bottom: calc(100% + 4px);
  transform: translateX(-50%);
  left: 50%;
}

.month-chart { position: relative; }
.month-dot {
  transition: r 0.2s ease, stroke-width 0.2s ease;
  cursor: pointer;
}
.month-dot:hover, .month-dot.dot-highlighted {
  r: 6;
  stroke-width: 3;
}
.month-tooltip {
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
}

/* Responsive */
@media (max-width: 840px) {
  .kpi-row {
    grid-template-columns: repeat(2, 1fr);
  }
  .dash-row {
    grid-template-columns: 1fr;
  }
}
</style>
