<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Bot, MessageSquare, FileText, Star, Heart,
  ThumbsUp, ThumbsDown, BookOpen, Trash2, Clock,
  Sparkles,
} from 'lucide-vue-next'
import { apiGet } from '../../../services/api'
import EmptyState from '../components/EmptyState.vue'
import SummaryPushTab from './SummaryPushTab.vue'

const { t } = useI18n()

interface AssistantStats {
  papers: {
    total_papers: number
    read_papers: number
    unread_papers: number
    good_papers: number
    bad_papers: number
    unrated_papers: number
    favorite_papers: number
    analyzed_papers: number
    unanalyzed_papers: number
    today_papers: number
    week_papers: number
    month_papers: number
    source_distribution: Record<string, number>
    analysis_distribution: { analyzed: number; unanalyzed: number }
    read_distribution: { read: number; unread: number }
    rating_distribution: { good: number; bad: number; unrated: number }
    favorite_distribution: { favorited: number; unfavorited: number }
    recent_papers: Array<{
      id: string
      title: string
      source: string
      published_at: string
      read: number
      good: number | null
      favorite: number
      analyzed: number
      relevance_score: number | null
    }>
    daily_stats: Array<{
      date: string
      total: number
      unread: number
      read_only: number
      favorite: number
      bad: number
      good: number
    }>
  }
  chat: {
    total_conversations: number
    trashed_conversations: number
    today_conversations: number
    week_conversations: number
    month_conversations: number
    total_messages: number
    conversations_per_assistant: Array<{
      assistant_id: string
      assistant_name: string
      count: number
      color?: string
    }>
    recent_conversations: Array<{
      id: string
      assistant_name: string
      updated_at: string
    }>
    model_distribution: Record<string, number>
  }
}

const data = ref<AssistantStats | null>(null)
const loading = ref(false)
const activeSubTab = ref<'papers' | 'chat' | 'summary'>('papers')
const hoveredDay = ref<string | null>(null)
const hoveredSlice = ref<string | null>(null)

const subTabs = [
  { id: 'papers' as const, label: t('statistics.assistantStats.papersTab') },
  { id: 'chat' as const, label: t('statistics.assistantStats.chatTab') },
  { id: 'summary' as const, label: '总结推送' },
]

async function load() {
  loading.value = true
  try {
    data.value = await apiGet<AssistantStats>('/api/statistics/assistants')
  } catch {
    data.value = null
  } finally {
    loading.value = false
  }
}

onMounted(load)

/* ─── KPI cards ─────────────────────────────────────────────── */
const paperKpiCards = computed(() => {
  if (!data.value) return []
  const p = data.value.papers
  return [
    { label: t('statistics.assistantStats.totalPapers'), value: p.total_papers, icon: FileText, accent: true },
    { label: t('statistics.assistantStats.readPapers'), value: p.read_papers, icon: BookOpen, accent: false },
    { label: t('statistics.assistantStats.goodPapers'), value: p.good_papers, icon: ThumbsUp, accent: false },
    { label: t('statistics.assistantStats.favoritePapers'), value: p.favorite_papers, icon: Heart, accent: false },
  ]
})

const chatKpiCards = computed(() => {
  if (!data.value) return []
  const c = data.value.chat
  return [
    { label: t('statistics.assistantStats.totalConversations'), value: c.total_conversations, icon: MessageSquare, accent: true },
    { label: t('statistics.assistantStats.totalMessages'), value: c.total_messages, icon: Bot, accent: false },
    { label: t('statistics.assistantStats.trashedConversations'), value: c.trashed_conversations, icon: Trash2, accent: false },
  ]
})

/* ─── Donut helpers ─────────────────────────────────────────── */
const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']

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

function makePieData(record: Record<string, number>, colors = PIE_COLORS) {
  const entries = Object.entries(record).filter(([, v]) => v > 0)
  if (!entries.length) return []
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1
  let startAngle = -Math.PI / 2
  return entries.map(([name, count], i) => {
    const angle = (count / total) * Math.PI * 2
    const endAngle = startAngle + angle
    const d = describeDonutArc(50, 50, 38, 22, startAngle, endAngle)
    const item = {
      name,
      count,
      pct: ((count / total) * 100).toFixed(1),
      color: colors[i % colors.length],
      d,
    }
    startAngle = endAngle
    return item
  })
}

/* ─── Papers distributions ──────────────────────────────────── */
const sourcePie = computed(() => makePieData(data.value?.papers.source_distribution ?? {}))

const analysisPie = computed(() => {
  const p = data.value?.papers
  if (!p) return []
  return makePieData({
    [t('statistics.assistantStats.analyzedPapers')]: p.analyzed_papers,
    [t('statistics.assistantStats.unanalyzedPapers')]: p.unanalyzed_papers,
  }, ['#3b82f6', '#d1d5db'])
})

const readPie = computed(() => {
  const p = data.value?.papers
  if (!p) return []
  return makePieData({
    [t('statistics.assistantStats.readPapers')]: p.read_papers,
    [t('statistics.assistantStats.unreadPapers')]: p.unread_papers,
  }, ['#10b981', '#d1d5db'])
})

const favoritePie = computed(() => {
  const p = data.value?.papers
  if (!p) return []
  return makePieData({
    [t('statistics.assistantStats.favoritePapers')]: p.favorite_papers,
    [t('statistics.assistantStats.unreadPapers')]: p.total_papers - p.favorite_papers,
  }, ['#f59e0b', '#d1d5db'])
})

const ratingBars = computed(() => {
  const p = data.value?.papers
  if (!p) return []
  const total = p.total_papers || 1
  return [
    { label: t('statistics.assistantStats.goodPapers'), count: p.good_papers, color: '#10b981' },
    { label: t('statistics.assistantStats.badPapers'), count: p.bad_papers, color: '#ef4444' },
    { label: t('statistics.assistantStats.unratedPapers'), count: p.unrated_papers, color: '#9ca3af' },
  ].map(item => ({ ...item, pct: ((item.count / total) * 100).toFixed(1) }))
})

const dailyStats = computed(() => data.value?.papers?.daily_stats ?? [])

const maxDailyTotal = computed(() => {
  const vals = dailyStats.value.map(d => d.total)
  return vals.length ? Math.max(...vals) : 1
})

// Format date like "3/15"
function fmtDailyDate(dateStr: string): string {
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? dateStr : `${d.getMonth() + 1}/${d.getDate()}`
}

const recentPapers = computed(() => (data.value?.papers.recent_papers ?? []).slice(0, 5))

/* ─── Chat distributions ────────────────────────────────────── */
const chatTrend = computed(() => {
  const c = data.value?.chat
  if (!c) return []
  const max = Math.max(c.today_conversations, c.week_conversations, c.month_conversations, 1)
  return [
    { label: t('statistics.assistantStats.todayConversations'), value: c.today_conversations },
    { label: t('statistics.assistantStats.weekConversations'), value: c.week_conversations },
    { label: t('statistics.assistantStats.monthConversations'), value: c.month_conversations },
  ].map(item => ({ ...item, height: (item.value / max) * 100 }))
})

const maxConversationCount = computed(() => {
  if (!data.value?.chat.conversations_per_assistant.length) return 1
  return Math.max(...data.value.chat.conversations_per_assistant.map(a => a.count), 1)
})

const modelPie = computed(() => makePieData(data.value?.chat.model_distribution ?? {}))

const recentConversations = computed(() => (data.value?.chat.recent_conversations ?? []).slice(0, 5))

/* ─── Time formatting ───────────────────────────────────────── */
function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return t('statistics.assistantStats.justNow')
  if (minutes < 60) return t('statistics.assistantStats.minutesAgo', { n: minutes })
  if (hours < 24) return t('statistics.assistantStats.hoursAgo', { n: hours })
  if (days < 7) return t('statistics.assistantStats.daysAgo', { n: days })
  return d.toLocaleDateString()
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
</script>

<template>
  <div class="assistant-stats-tab">
    <template v-if="loading">
      <div class="loading-state">{{ t('common.loading') }}</div>
    </template>
    <template v-else-if="!data">
      <EmptyState />
    </template>
    <template v-else>
      <!-- Sub tabs -->
      <div class="sub-tabs">
        <button
          v-for="tab in subTabs"
          :key="tab.id"
          class="sub-tab"
          :class="{ active: activeSubTab === tab.id }"
          @click="activeSubTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- ═════════════════ Paper Push ════════════════════════ -->
      <template v-if="activeSubTab === 'papers'">
        <!-- Row 1: KPI -->
        <div class="kpi-row four">
          <div
            v-for="card in paperKpiCards"
            :key="card.label"
            class="kpi-card"
            :class="{ accent: card.accent }"
          >
            <div class="kpi-icon">
              <component :is="card.icon" :size="18" />
            </div>
            <div class="kpi-value">{{ card.value }}</div>
            <div class="kpi-label">{{ card.label }}</div>
          </div>
        </div>

        <!-- Row 2: source + analysis -->
        <div class="dash-row">
          <div class="dash-card">
            <div class="dash-section-title">{{ t('statistics.assistantStats.sourceDistribution') }}</div>
            <div v-if="!sourcePie.length" class="no-data">{{ t('statistics.assistantStats.noData') }}</div>
            <div v-else class="pie-wrap" style="position: relative;">
              <svg viewBox="0 0 100 100" class="pie-svg">
                <path
                  v-for="slice in sourcePie"
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
                  v-for="slice in sourcePie"
                  :key="slice.name"
                  class="pie-legend-item"
                  :class="{ dimmed: hoveredSlice && hoveredSlice !== slice.name }"
                  @mouseenter="hoveredSlice = slice.name"
                  @mouseleave="hoveredSlice = null"
                >
                  <div class="pie-legend-dot" :style="{ background: slice.color }" />
                  <div class="pie-legend-text">
                    <div class="pie-legend-name">{{ slice.name }}</div>
                    <div class="pie-legend-pct">{{ slice.pct }}% · {{ slice.count }}</div>
                  </div>
                </div>
              </div>
              <div v-if="hoveredSlice && sourcePie.find(s => s.name === hoveredSlice)" class="chart-tooltip">
                <template v-for="slice in sourcePie" :key="slice.name">
                  <div v-if="slice.name === hoveredSlice">
                    <div class="tooltip-name">{{ slice.name }}</div>
                    <div class="tooltip-value">{{ slice.pct }}% · {{ slice.count }}</div>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <div class="dash-card">
            <div class="dash-section-title">{{ t('statistics.assistantStats.analysisDistribution') }}</div>
            <div v-if="!analysisPie.length" class="no-data">{{ t('statistics.assistantStats.noData') }}</div>
            <div v-else class="pie-wrap" style="position: relative;">
              <svg viewBox="0 0 100 100" class="pie-svg">
                <path
                  v-for="slice in analysisPie"
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
                  v-for="slice in analysisPie"
                  :key="slice.name"
                  class="pie-legend-item"
                  :class="{ dimmed: hoveredSlice && hoveredSlice !== slice.name }"
                  @mouseenter="hoveredSlice = slice.name"
                  @mouseleave="hoveredSlice = null"
                >
                  <div class="pie-legend-dot" :style="{ background: slice.color }" />
                  <div class="pie-legend-text">
                    <div class="pie-legend-name">{{ slice.name }}</div>
                    <div class="pie-legend-pct">{{ slice.pct }}% · {{ slice.count }}</div>
                  </div>
                </div>
              </div>
              <div v-if="hoveredSlice && analysisPie.find(s => s.name === hoveredSlice)" class="chart-tooltip">
                <template v-for="slice in analysisPie" :key="slice.name">
                  <div v-if="slice.name === hoveredSlice">
                    <div class="tooltip-name">{{ slice.name }}</div>
                    <div class="tooltip-value">{{ slice.pct }}% · {{ slice.count }}</div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- Row 3: read + rating + favorite -->
        <div class="dash-row three">
          <div class="dash-card">
            <div class="dash-section-title">{{ t('statistics.assistantStats.readDistribution') }}</div>
            <div v-if="!readPie.length" class="no-data">{{ t('statistics.assistantStats.noData') }}</div>
            <div v-else class="pie-wrap center" style="position: relative;">
              <svg viewBox="0 0 100 100" class="pie-svg small">
                <path
                  v-for="slice in readPie"
                  :key="slice.name"
                  :d="slice.d"
                  :fill="slice.color"
                  class="pie-slice"
                  :class="{ dimmed: hoveredSlice && hoveredSlice !== slice.name }"
                  @mouseenter="hoveredSlice = slice.name"
                  @mouseleave="hoveredSlice = null"
                />
              </svg>
              <div class="pie-legend compact">
                <div
                  v-for="slice in readPie"
                  :key="slice.name"
                  class="pie-legend-item"
                  :class="{ dimmed: hoveredSlice && hoveredSlice !== slice.name }"
                  @mouseenter="hoveredSlice = slice.name"
                  @mouseleave="hoveredSlice = null"
                >
                  <div class="pie-legend-dot" :style="{ background: slice.color }" />
                  <div class="pie-legend-text">
                    <div class="pie-legend-name">{{ slice.name }}</div>
                    <div class="pie-legend-pct">{{ slice.pct }}% · {{ slice.count }}</div>
                  </div>
                </div>
              </div>
              <div v-if="hoveredSlice && readPie.find(s => s.name === hoveredSlice)" class="chart-tooltip">
                <template v-for="slice in readPie" :key="slice.name">
                  <div v-if="slice.name === hoveredSlice">
                    <div class="tooltip-name">{{ slice.name }}</div>
                    <div class="tooltip-value">{{ slice.pct }}% · {{ slice.count }}</div>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <div class="dash-card">
            <div class="dash-section-title">{{ t('statistics.assistantStats.ratingDistribution') }}</div>
            <div v-if="!ratingBars.length" class="no-data">{{ t('statistics.assistantStats.noData') }}</div>
            <div v-else class="rating-bars">
              <div
                v-for="bar in ratingBars"
                :key="bar.label"
                class="rating-bar"
                @mouseenter="hoveredSlice = 'rating-' + bar.label"
                @mouseleave="hoveredSlice = null"
              >
                <div class="rating-bar-header">
                  <span class="rating-bar-label">{{ bar.label }}</span>
                  <span class="rating-bar-count">{{ bar.count }}</span>
                </div>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :class="{ highlighted: hoveredSlice === 'rating-' + bar.label }"
                    :style="{ width: `${bar.pct}%`, background: bar.color }"
                  />
                </div>
                <div v-if="hoveredSlice === 'rating-' + bar.label" class="chart-tooltip bar-tooltip">
                  <div class="tooltip-name">{{ bar.label }}</div>
                  <div class="tooltip-value">{{ bar.count }} ({{ bar.pct }}%)</div>
                </div>
              </div>
            </div>
          </div>

          <div class="dash-card">
            <div class="dash-section-title">{{ t('statistics.assistantStats.favoriteDistribution') }}</div>
            <div v-if="!favoritePie.length" class="no-data">{{ t('statistics.assistantStats.noData') }}</div>
            <div v-else class="pie-wrap center" style="position: relative;">
              <svg viewBox="0 0 100 100" class="pie-svg small">
                <path
                  v-for="slice in favoritePie"
                  :key="slice.name"
                  :d="slice.d"
                  :fill="slice.color"
                  class="pie-slice"
                  :class="{ dimmed: hoveredSlice && hoveredSlice !== slice.name }"
                  @mouseenter="hoveredSlice = slice.name"
                  @mouseleave="hoveredSlice = null"
                />
              </svg>
              <div class="pie-legend compact">
                <div
                  v-for="slice in favoritePie"
                  :key="slice.name"
                  class="pie-legend-item"
                  :class="{ dimmed: hoveredSlice && hoveredSlice !== slice.name }"
                  @mouseenter="hoveredSlice = slice.name"
                  @mouseleave="hoveredSlice = null"
                >
                  <div class="pie-legend-dot" :style="{ background: slice.color }" />
                  <div class="pie-legend-text">
                    <div class="pie-legend-name">{{ slice.name }}</div>
                    <div class="pie-legend-pct">{{ slice.pct }}% · {{ slice.count }}</div>
                  </div>
                </div>
              </div>
              <div v-if="hoveredSlice && favoritePie.find(s => s.name === hoveredSlice)" class="chart-tooltip">
                <template v-for="slice in favoritePie" :key="slice.name">
                  <div v-if="slice.name === hoveredSlice">
                    <div class="tooltip-name">{{ slice.name }}</div>
                    <div class="tooltip-value">{{ slice.pct }}% · {{ slice.count }}</div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- Row 4: Daily stacked bar chart -->
        <div class="dash-card full-width">
          <div class="dash-section-title">近 30 天每日论文状态</div>
          <div v-if="!dailyStats.length" class="no-data">{{ t('statistics.assistantStats.noData') }}</div>
          <div v-else class="daily-chart">
            <div class="daily-chart-bars">
              <div
                v-for="day in dailyStats"
                :key="day.date"
                class="daily-bar-wrap"
                @mouseenter="hoveredDay = day.date"
                @mouseleave="hoveredDay = null"
              >
                <div class="daily-bar-track">
                  <!-- Stacked from bottom to top: unread, read_only, favorite, bad, good -->
                  <div
                    class="daily-bar-segment unread"
                    :style="{ height: `${(day.unread / maxDailyTotal) * 100}%` }"
                  />
                  <div
                    class="daily-bar-segment read-only"
                    :style="{ height: `${(day.read_only / maxDailyTotal) * 100}%` }"
                  />
                  <div
                    class="daily-bar-segment favorite"
                    :style="{ height: `${(day.favorite / maxDailyTotal) * 100}%` }"
                  />
                  <div
                    class="daily-bar-segment bad"
                    :style="{ height: `${(day.bad / maxDailyTotal) * 100}%` }"
                  />
                  <div
                    class="daily-bar-segment good"
                    :style="{ height: `${(day.good / maxDailyTotal) * 100}%` }"
                  />
                </div>
                <div class="daily-bar-label">{{ fmtDailyDate(day.date) }}</div>
                <!-- Tooltip -->
                <div v-if="hoveredDay === day.date" class="daily-tooltip">
                  <div class="tooltip-date">{{ day.date }}</div>
                  <div class="tooltip-row"><span class="dot good" /> 点赞 {{ day.good }}</div>
                  <div class="tooltip-row"><span class="dot bad" /> 踩 {{ day.bad }}</div>
                  <div class="tooltip-row"><span class="dot favorite" /> 收藏 {{ day.favorite }}</div>
                  <div class="tooltip-row"><span class="dot read-only" /> 已读 {{ day.read_only }}</div>
                  <div class="tooltip-row"><span class="dot unread" /> 未读 {{ day.unread }}</div>
                  <div class="tooltip-total">总计 {{ day.total }}</div>
                </div>
              </div>
            </div>
            <!-- Legend -->
            <div class="daily-legend">
              <div class="daily-legend-item"><span class="dot good" /> 点赞</div>
              <div class="daily-legend-item"><span class="dot bad" /> 踩</div>
              <div class="daily-legend-item"><span class="dot favorite" /> 收藏</div>
              <div class="daily-legend-item"><span class="dot read-only" /> 已读</div>
              <div class="daily-legend-item"><span class="dot unread" /> 未读</div>
            </div>
          </div>
        </div>

        <!-- Row 5: recent papers -->
        <div class="dash-card full-width">
          <div class="dash-section-title">{{ t('statistics.assistantStats.recentPapers') }}</div>
          <div v-if="!recentPapers.length" class="no-data">{{ t('statistics.assistantStats.noData') }}</div>
          <div v-else class="paper-list">
            <div v-for="paper in recentPapers" :key="paper.id" class="paper-item">
              <div class="paper-source">{{ paper.source }}</div>
              <div class="paper-title">{{ paper.title }}</div>
              <div class="paper-date">{{ fmtDate(paper.published_at) }}</div>
              <div class="paper-indicators">
                <span class="indicator" :class="{ active: paper.read }">
                  <BookOpen :size="12" />
                </span>
                <span v-if="paper.good === 1" class="indicator good">
                  <ThumbsUp :size="12" />
                </span>
                <span v-else-if="paper.good === 0" class="indicator bad">
                  <ThumbsDown :size="12" />
                </span>
                <span v-else class="indicator muted">
                  <Star :size="12" />
                </span>
                <span class="indicator" :class="{ active: paper.favorite }">
                  <Heart :size="12" />
                </span>
              </div>
              <div v-if="paper.relevance_score != null" class="paper-score">
                {{ paper.relevance_score }}
              </div>
              <div v-if="paper.analyzed" class="paper-analyzed">
                <Sparkles :size="12" />
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ═════════════════ Summary Push ════════════════════════ -->
      <template v-if="activeSubTab === 'summary'">
        <SummaryPushTab />
      </template>

      <!-- ═════════════════ Smart Answer ════════════════════════ -->
      <template v-if="activeSubTab === 'chat'">
        <!-- Row 1: KPI -->
        <div class="kpi-row three">
          <div
            v-for="card in chatKpiCards"
            :key="card.label"
            class="kpi-card"
            :class="{ accent: card.accent }"
          >
            <div class="kpi-icon">
              <component :is="card.icon" :size="18" />
            </div>
            <div class="kpi-value">{{ card.value }}</div>
            <div class="kpi-label">{{ card.label }}</div>
          </div>
        </div>

        <!-- Row 2: trend + assistant distribution -->
        <div class="dash-row">
          <div class="dash-card">
            <div class="dash-section-title">{{ t('statistics.assistantStats.conversationTrend') }}</div>
            <div v-if="!chatTrend.length" class="no-data">{{ t('statistics.assistantStats.noData') }}</div>
            <div v-else class="trend-bars">
              <div
                v-for="item in chatTrend"
                :key="item.label"
                class="trend-bar-item"
                @mouseenter="hoveredSlice = 'trend-' + item.label"
                @mouseleave="hoveredSlice = null"
              >
                <div class="trend-bar-track">
                  <div
                    class="trend-bar-fill"
                    :class="{ highlighted: hoveredSlice === 'trend-' + item.label }"
                    :style="{ height: `${item.height}%` }"
                  />
                </div>
                <div class="trend-bar-value">{{ item.value }}</div>
                <div class="trend-bar-label">{{ item.label }}</div>
                <div v-if="hoveredSlice === 'trend-' + item.label" class="chart-tooltip bar-tooltip">
                  <div class="tooltip-name">{{ item.label }}</div>
                  <div class="tooltip-value">{{ item.value }}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="dash-card">
            <div class="dash-section-title">{{ t('statistics.assistantStats.conversationsPerAssistant') }}</div>
            <div v-if="!data.chat.conversations_per_assistant.length" class="no-data">{{ t('statistics.assistantStats.noData') }}</div>
            <div v-else class="bar-list">
              <div
                v-for="item in data.chat.conversations_per_assistant"
                :key="item.assistant_id"
                class="bar-item"
                @mouseenter="hoveredSlice = 'assistant-' + item.assistant_id"
                @mouseleave="hoveredSlice = null"
              >
                <div class="bar-info">
                  <span class="bar-name">{{ item.assistant_name }}</span>
                  <span class="bar-count">{{ item.count }}</span>
                </div>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :class="{ highlighted: hoveredSlice === 'assistant-' + item.assistant_id }"
                    :style="{
                      width: `${(item.count / maxConversationCount) * 100}%`,
                      background: item.color || '#223F79',
                    }"
                  />
                </div>
                <div v-if="hoveredSlice === 'assistant-' + item.assistant_id" class="chart-tooltip bar-tooltip">
                  <div class="tooltip-name">{{ item.assistant_name }}</div>
                  <div class="tooltip-value">{{ item.count }} conversations</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Row 3: model donut + recent conversations -->
        <div class="dash-row">
          <div class="dash-card">
            <div class="dash-section-title">{{ t('statistics.assistantStats.modelDistribution') }}</div>
            <div v-if="!modelPie.length" class="no-data">{{ t('statistics.assistantStats.noData') }}</div>
            <div v-else class="pie-wrap" style="position: relative;">
              <svg viewBox="0 0 100 100" class="pie-svg">
                <path
                  v-for="slice in modelPie"
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
                  v-for="slice in modelPie"
                  :key="slice.name"
                  class="pie-legend-item"
                  :class="{ dimmed: hoveredSlice && hoveredSlice !== slice.name }"
                  @mouseenter="hoveredSlice = slice.name"
                  @mouseleave="hoveredSlice = null"
                >
                  <div class="pie-legend-dot" :style="{ background: slice.color }" />
                  <div class="pie-legend-text">
                    <div class="pie-legend-name">{{ slice.name }}</div>
                    <div class="pie-legend-pct">{{ slice.pct }}% · {{ slice.count }}</div>
                  </div>
                </div>
              </div>
              <div v-if="hoveredSlice && modelPie.find(s => s.name === hoveredSlice)" class="chart-tooltip">
                <template v-for="slice in modelPie" :key="slice.name">
                  <div v-if="slice.name === hoveredSlice">
                    <div class="tooltip-name">{{ slice.name }}</div>
                    <div class="tooltip-value">{{ slice.pct }}% · {{ slice.count }}</div>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <div class="dash-card">
            <div class="dash-section-title">{{ t('statistics.assistantStats.recentConversations') }}</div>
            <div v-if="!recentConversations.length" class="no-data">{{ t('statistics.assistantStats.noData') }}</div>
            <div v-else class="recent-list">
              <div
                v-for="conv in recentConversations"
                :key="conv.id"
                class="recent-item"
              >
                <div class="recent-dot" />
                <div class="recent-name">{{ conv.assistant_name }}</div>
                <div class="recent-time">
                  <Clock :size="12" />
                  <span>{{ formatTime(conv.updated_at) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.assistant-stats-tab {
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

/* ─── Sub tabs ─────────────────────────────────────────────── */
.sub-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}

.sub-tab {
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #ffffff;
  font-size: 13px;
  color: #8e8e93;
  cursor: pointer;
  transition: all 0.12s;
}

.sub-tab:hover {
  background: rgba(0, 0, 0, 0.03);
}

.sub-tab.active {
  background: rgba(34, 63, 121, 0.10);
  border-color: rgba(34, 63, 121, 0.18);
  color: #223F79;
  font-weight: 600;
}

/* ─── KPI row ──────────────────────────────────────────────── */
.kpi-row {
  display: grid;
  gap: 14px;
}

.kpi-row.three {
  grid-template-columns: repeat(3, 1fr);
}

.kpi-row.four {
  grid-template-columns: repeat(4, 1fr);
}

.kpi-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: box-shadow 0.15s, transform 0.15s;
}

.kpi-card:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.kpi-card.accent {
  background: linear-gradient(135deg, #223F79 0%, #2a4d94 100%);
  border: none;
}

.kpi-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(34, 63, 121, 0.08);
  color: #223F79;
  display: flex;
  align-items: center;
  justify-content: center;
}

.kpi-card.accent .kpi-icon {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.kpi-value {
  font-size: 24px;
  font-weight: 700;
  color: #1c1c1e;
  line-height: 1.2;
}

.kpi-card.accent .kpi-value {
  color: #fff;
}

.kpi-label {
  font-size: 12px;
  color: #8e8e93;
}

.kpi-card.accent .kpi-label {
  color: rgba(255, 255, 255, 0.75);
}

/* ─── Dash rows ────────────────────────────────────────────── */
.dash-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.dash-row.three {
  grid-template-columns: 1fr 1fr 1fr;
}

.dash-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
}

.dash-card.full-width {
  grid-column: 1 / -1;
}

.dash-section-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  margin-bottom: 16px;
}

.no-data {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #8e8e93;
  padding: 24px 0;
}

/* ─── Pie chart ────────────────────────────────────────────── */
.pie-wrap {
  display: flex;
  align-items: center;
  gap: 20px;
  flex: 1;
}

.pie-wrap.center {
  justify-content: center;
}

.pie-svg {
  width: 120px;
  height: 120px;
  flex-shrink: 0;
}

.pie-svg.small {
  width: 90px;
  height: 90px;
}

.pie-legend {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.pie-legend.compact {
  gap: 6px;
}

.pie-legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pie-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pie-legend-name {
  font-size: 12px;
  color: #3c3c43;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pie-legend-pct {
  font-size: 11px;
  color: #8e8e93;
}

.pie-legend-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

/* ─── Bar list (assistants) ────────────────────────────────── */
.bar-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bar-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bar-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

.bar-name {
  color: #3c3c43;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bar-count {
  color: #8e8e93;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.bar-track {
  height: 8px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease;
}

/* ─── Rating bars ──────────────────────────────────────────── */
.rating-bars {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  justify-content: center;
}

.rating-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rating-bar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}

.rating-bar-label {
  color: #3c3c43;
  font-weight: 500;
}

.rating-bar-count {
  color: #8e8e93;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* ─── Trend bars ───────────────────────────────────────────── */
.trend-bars {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 32px;
  padding: 12px 0;
  flex: 1;
  min-height: 140px;
}

.trend-bar-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex: 1;
  max-width: 80px;
}

.trend-bar-track {
  width: 36px;
  height: 100px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
}

.trend-bar-fill {
  width: 100%;
  background: linear-gradient(180deg, #223F79 0%, #3b6bc4 100%);
  border-radius: 6px;
  transition: height 0.5s ease;
}

.trend-bar-value {
  font-size: 14px;
  font-weight: 700;
  color: #1c1c1e;
}

.trend-bar-label {
  font-size: 11px;
  color: #8e8e93;
  text-align: center;
}

/* ─── Recent conversations ─────────────────────────────────── */
.recent-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.02);
  transition: background 0.12s;
}

.recent-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.recent-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #223F79;
  flex-shrink: 0;
}

.recent-name {
  flex: 1;
  font-size: 13px;
  color: #1c1c1e;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-time {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #8e8e93;
  flex-shrink: 0;
}

.recent-time svg {
  color: #c7c7cc;
}

/* ─── Recent papers ────────────────────────────────────────── */
.paper-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.paper-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid rgba(0, 0, 0, 0.04);
  transition: background 0.12s;
}

.paper-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.paper-source {
  font-size: 11px;
  font-weight: 600;
  color: #223F79;
  background: rgba(34, 63, 121, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;
  white-space: nowrap;
}

.paper-title {
  flex: 1;
  font-size: 13px;
  color: #1c1c1e;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.paper-date {
  font-size: 11px;
  color: #8e8e93;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.paper-indicators {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: #c7c7cc;
  background: rgba(0, 0, 0, 0.04);
}

.indicator.active {
  color: #223F79;
  background: rgba(34, 63, 121, 0.10);
}

.indicator.good {
  color: #10b981;
  background: rgba(16, 185, 129, 0.10);
}

.indicator.bad {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.10);
}

.indicator.muted {
  color: #d1d5db;
  background: rgba(0, 0, 0, 0.03);
}

.paper-score {
  font-size: 11px;
  font-weight: 600;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.10);
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}

.paper-analyzed {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: #8b5cf6;
  background: rgba(139, 92, 246, 0.10);
  flex-shrink: 0;
}

/* Chart hover interactions */
.pie-wrap { position: relative; }
.pie-slice {
  transition: opacity 0.2s ease, transform 0.25s ease;
  transform-origin: center;
  cursor: pointer;
}
.pie-slice:hover { transform: scale(1.04); }
.pie-slice.dimmed { opacity: 0.3; }
.pie-legend-item {
  transition: opacity 0.2s ease;
  cursor: pointer;
}
.pie-legend-item.dimmed { opacity: 0.35; }

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

.rating-bar { position: relative; cursor: pointer; }
.bar-fill { transition: width 0.5s ease, filter 0.2s ease; }
.bar-fill.highlighted { filter: brightness(1.15); }

.trend-bar-item { position: relative; cursor: pointer; }
.trend-bar-fill { transition: height 0.5s ease, filter 0.2s ease; }
.trend-bar-fill.highlighted { filter: brightness(1.2); }

.bar-item { position: relative; cursor: pointer; }
.bar-item .bar-fill { transition: width 0.5s ease, filter 0.2s ease; }
.bar-item .bar-fill.highlighted { filter: brightness(1.2); }

.bar-tooltip {
  top: auto;
  bottom: calc(100% + 4px);
  transform: translateX(-50%);
  left: 50%;
}

/* Daily stacked bar chart */
.daily-chart { display: flex; flex-direction: column; gap: 12px; }
.daily-chart-bars {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 180px;
  padding: 0 8px;
}
.daily-bar-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  position: relative;
  cursor: pointer;
  transition: transform 0.15s ease;
}
.daily-bar-wrap:hover {
  transform: translateY(-2px);
}
.daily-bar-track {
  width: 100%;
  max-width: 24px;
  height: 100%;
  display: flex;
  flex-direction: column-reverse;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(0,0,0,0.04);
  border: 1px solid rgba(0,0,0,0.06);
}
.daily-bar-segment {
  width: 100%;
  min-height: 2px;
  transition: opacity 0.15s, height 0.5s ease, filter 0.15s;
}
.daily-bar-segment.good { background: #34C759; }
.daily-bar-segment.bad { background: #FF3B30; }
.daily-bar-segment.favorite { background: #FF9500; }
.daily-bar-segment.read-only { background: #007AFF; }
.daily-bar-segment.unread { background: #AEAEB2; }
.daily-bar-wrap:hover .daily-bar-segment { filter: brightness(1.1); }
.daily-chart-bars:hover .daily-bar-wrap:not(:hover) .daily-bar-segment { opacity: 0.45; }
.daily-bar-label { font-size: 10px; color: #8e8e93; white-space: nowrap; }

/* Tooltip */
.daily-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(28, 28, 30, 0.92);
  backdrop-filter: blur(12px);
  color: #fff;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 12px;
  white-space: nowrap;
  z-index: 10;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  pointer-events: none;
  animation: tooltipIn 0.15s ease;
}
@keyframes tooltipIn {
  from { opacity: 0; transform: translateX(-50%) translateY(4px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.tooltip-date { font-weight: 600; margin-bottom: 6px; font-size: 13px; }
.tooltip-row { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.tooltip-total { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.15); font-weight: 600; }

/* Legend */
.daily-legend {
  display: flex;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
}
.daily-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #3c3c43;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.dot.good { background: #34C759; }
.dot.bad { background: #FF3B30; }
.dot.favorite { background: #FF9500; }
.dot.read-only { background: #007AFF; }
.dot.unread { background: #E5E5EA; }
</style>
