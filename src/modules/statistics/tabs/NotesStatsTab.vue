<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileText, FolderOpen, Image, Trash2, HardDrive, Type } from 'lucide-vue-next'
import { apiGet, isBackendConfigured } from '../../../services/api'
import { resolveNoteImageUrl, initNotesImageAssetBase } from '../../../utils/notesStorage'
import EmptyState from '../components/EmptyState.vue'

const { t } = useI18n()

interface NotesStats {
  total_notes: number
  total_groups: number
  total_images: number
  total_content_bytes: number
  total_image_bytes: number
  trashed_notes: number
  notes_per_group: Array<{ group_id: string; group_name: string; count: number }>
  top_tags: Array<{ tag: string; count: number }>
  notes_by_month: Array<{ month: string; count: number }>
  recent_notes: Array<{ id: string; title: string; date: string; cover: string; group_name: string }>
  group_distribution: Array<{ name: string; count: number; percentage: number }>
}

const data = ref<NotesStats | null>(null)
const loading = ref(false)
const error = ref(false)
const hoveredSlice = ref<string | null>(null)
const hoveredMBar = ref<string | null>(null)

const COLORS = ['#223F79', '#3B5BA5', '#52BA6F', '#E4983D', '#9B6CF0', '#20BDB8', '#F0A830', '#E85D75']

async function load() {
  if (!isBackendConfigured()) return
  loading.value = true
  error.value = false
  try { data.value = await apiGet<NotesStats>('/api/statistics/notes') }
  catch { error.value = true }
  finally { loading.value = false }
}

onMounted(async () => {
  await initNotesImageAssetBase()
  load()
})

/* ─── KPI cards ─────────────────────────────────────────────── */
const kpis = computed(() => {
  const d = data.value
  if (!d) return []
  return [
    { label: t('statistics.notesStats.totalNotes'), value: d.total_notes, icon: FileText },
    { label: t('statistics.notesStats.totalGroups'), value: d.total_groups, icon: FolderOpen },
    { label: t('statistics.notesStats.totalImages'), value: d.total_images, icon: Image },
    { label: t('statistics.notesStats.trashedNotes'), value: d.trashed_notes, icon: Trash2 },
  ]
})

/* ─── Donut chart helpers ───────────────────────────────────── */
function donutArc(cx: number, cy: number, oR: number, iR: number, sA: number, eA: number) {
  const large = eA - sA > Math.PI ? 1 : 0
  const o1 = `${cx + oR * Math.cos(sA)} ${cy + oR * Math.sin(sA)}`
  const o2 = `${cx + oR * Math.cos(eA)} ${cy + oR * Math.sin(eA)}`
  const i1 = `${cx + iR * Math.cos(sA)} ${cy + iR * Math.sin(sA)}`
  const i2 = `${cx + iR * Math.cos(eA)} ${cy + iR * Math.sin(eA)}`
  return `M ${o1} A ${oR} ${oR} 0 ${large} 1 ${o2} L ${i2} A ${iR} ${iR} 0 ${large} 0 ${i1} Z`
}

const donut = computed(() => {
  const list = data.value?.group_distribution ?? []
  if (!list.length) return []
  const total = list.reduce((s, g) => s + g.count, 0) || 1
  let start = -Math.PI / 2
  return list.map((g, i) => {
    const angle = (g.count / total) * Math.PI * 2
    const end = start + angle
    const d = donutArc(50, 50, 38, 22, start, end)
    const item = { name: g.name, count: g.count, pct: g.percentage.toFixed(1), color: COLORS[i % COLORS.length], d }
    start = end
    return item
  })
})

/* ─── Group bars ────────────────────────────────────────────── */
const maxGroup = computed(() => Math.max(...(data.value?.notes_per_group ?? []).map(g => g.count), 1))

/* ─── Tags ──────────────────────────────────────────────────── */
const tags = computed(() => {
  const list = data.value?.top_tags ?? []
  const max = Math.max(...list.map(t => t.count), 1)
  return list.slice(0, 10).map(t => ({ ...t, sz: t.count / max > 0.7 ? 'lg' : t.count / max > 0.4 ? 'md' : 'sm' }))
})

/* ─── Storage ───────────────────────────────────────────────── */
const storageTotal = computed(() => {
  const d = data.value
  return d ? Math.max(d.total_content_bytes + d.total_image_bytes, 1) : 1
})

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`
  return `${(n / 1073741824).toFixed(2)} GB`
}

/* ─── Monthly chart ─────────────────────────────────────────── */
const months = computed(() => (data.value?.notes_by_month ?? []).slice(-12))
const monthMax = computed(() => Math.max(...months.value.map(m => m.count), 1))

const MW = 720, MH = 160
const MP = { t: 16, r: 12, b: 28, l: 32 }

const mBars = computed(() => {
  const list = months.value
  if (!list.length) return []
  const cw = MW - MP.l - MP.r
  const ch = MH - MP.t - MP.b
  const bw = Math.max(16, (cw / list.length) * 0.6)
  const step = cw / list.length
  return list.map((m, i) => {
    const h = (m.count / monthMax.value) * ch
    return {
      x: MP.l + i * step + (step - bw) / 2,
      y: MP.t + ch - h,
      w: bw, h,
      lbl: m.month.slice(5),
      cnt: m.count,
    }
  })
})

/* ─── Recent notes ──────────────────────────────────────────── */
const recent = computed(() => (data.value?.recent_notes ?? []).slice(0, 5))

function fmtDate(s: string): string {
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function isImagePath(str: string): boolean {
  return str.startsWith('http') || str.startsWith('/') || str.includes('.')
}
</script>

<template>
  <div class="notes-stats-tab">
    <template v-if="loading">
      <div class="loading-state">{{ t('common.loading') }}</div>
    </template>
    <template v-else-if="error || !data">
      <EmptyState />
    </template>
    <template v-else>
      <div class="tab-header">
        <h2 class="tab-title">{{ t('statistics.notesStats.title') }}</h2>
      </div>

      <!-- Row 1: KPI cards -->
      <div class="kpi-row">
        <div v-for="(c, i) in kpis" :key="c.label" class="kpi-card" :class="{ 'kpi-primary': i === 0 }">
          <div class="kpi-icon"><component :is="c.icon" :size="18" /></div>
          <div class="kpi-value">{{ c.value }}</div>
          <div class="kpi-label">{{ c.label }}</div>
        </div>
      </div>

      <!-- Row 2: Group distribution + Notes per group -->
      <div class="dash-row">
        <div class="dash-section">
          <div class="dash-section-title">{{ t('statistics.notesStats.groupDistribution') }}</div>
          <div v-if="donut.length" class="donut-wrap" style="position: relative;">
            <svg viewBox="0 0 100 100" class="donut-svg">
              <path v-for="s in donut" :key="s.name" :d="s.d" :fill="s.color" class="donut-slice" :class="{ dimmed: hoveredSlice && hoveredSlice !== s.name }" @mouseenter="hoveredSlice = s.name" @mouseleave="hoveredSlice = null" />
            </svg>
            <div class="donut-legend">
              <div v-for="s in donut" :key="s.name" class="donut-legend-item" :class="{ dimmed: hoveredSlice && hoveredSlice !== s.name }" @mouseenter="hoveredSlice = s.name" @mouseleave="hoveredSlice = null">
                <div class="donut-legend-dot" :style="{ background: s.color }" />
                <div class="donut-legend-text">
                  <div class="donut-legend-name">{{ s.name }}</div>
                  <div class="donut-legend-pct">{{ s.pct }}% · {{ s.count }}</div>
                </div>
              </div>
            </div>
            <div v-if="hoveredSlice && donut.find(s => s.name === hoveredSlice)" class="chart-tooltip">
              <template v-for="s in donut" :key="s.name">
                <div v-if="s.name === hoveredSlice">
                  <div class="tooltip-name">{{ s.name }}</div>
                  <div class="tooltip-value">{{ s.pct }}% · {{ s.count }}</div>
                </div>
              </template>
            </div>
          </div>
          <div v-else class="empty-mini">{{ t('statistics.notesStats.noData') }}</div>
        </div>

        <div class="dash-section">
          <div class="dash-section-title">{{ t('statistics.notesStats.notesPerGroup') }}</div>
          <div v-if="data.notes_per_group.length" class="group-bars">
            <div v-for="g in data.notes_per_group" :key="g.group_id" class="group-bar-row" @mouseenter="hoveredSlice = g.group_id" @mouseleave="hoveredSlice = null">
              <span class="group-bar-name">{{ g.group_name || t('statistics.notesStats.ungrouped') }}</span>
              <div class="group-bar-track">
                <div class="group-bar-fill" :class="{ highlighted: hoveredSlice === g.group_id }" :style="{ width: `${(g.count / maxGroup) * 100}%` }" />
              </div>
              <span class="group-bar-count">{{ g.count }}</span>
              <div v-if="hoveredSlice === g.group_id" class="chart-tooltip bar-tooltip">
                <div class="tooltip-name">{{ g.group_name || t('statistics.notesStats.ungrouped') }}</div>
                <div class="tooltip-value">{{ g.count }} notes</div>
              </div>
            </div>
          </div>
          <div v-else class="empty-mini">{{ t('statistics.notesStats.noData') }}</div>
        </div>
      </div>

      <!-- Row 3: Top tags + Storage breakdown -->
      <div class="dash-row">
        <div class="dash-section">
          <div class="dash-section-title">{{ t('statistics.notesStats.topTags') }}</div>
          <div v-if="tags.length" class="tag-cloud">
            <span v-for="tag in tags" :key="tag.tag" class="tag-chip" :class="`tag-${tag.sz}`">
              {{ tag.tag }}<span class="tag-count">{{ tag.count }}</span>
            </span>
          </div>
          <div v-else class="empty-mini">{{ t('statistics.notesStats.noData') }}</div>
        </div>

        <div class="dash-section">
          <div class="dash-section-title">{{ t('statistics.notesStats.storageBreakdown') }}</div>
          <div class="storage-list">
            <div class="storage-item">
              <div class="storage-item-header">
                <Type :size="14" />
                <span class="storage-item-name">{{ t('statistics.notesStats.contentStorage') }}</span>
                <span class="storage-item-value">{{ fmtBytes(data.total_content_bytes) }}</span>
              </div>
              <div class="storage-item-track">
                <div class="storage-item-fill" :style="{ width: `${(data.total_content_bytes / storageTotal) * 100}%` }" />
              </div>
            </div>
            <div class="storage-item">
              <div class="storage-item-header">
                <Image :size="14" />
                <span class="storage-item-name">{{ t('statistics.notesStats.imageStorage') }}</span>
                <span class="storage-item-value">{{ fmtBytes(data.total_image_bytes) }}</span>
              </div>
              <div class="storage-item-track">
                <div class="storage-item-fill img" :style="{ width: `${(data.total_image_bytes / storageTotal) * 100}%` }" />
              </div>
            </div>
            <div class="storage-total">
              <HardDrive :size="14" />
              <span>{{ t('statistics.notesStats.totalStorage') }}</span>
              <span class="storage-total-value">{{ fmtBytes(data.total_content_bytes + data.total_image_bytes) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Row 4: Notes by month -->
      <div class="dash-section full-width">
        <div class="dash-section-title">{{ t('statistics.notesStats.notesByMonth') }}</div>
        <div v-if="months.length" class="month-chart">
          <svg :viewBox="`0 0 ${MW} ${MH}`" class="month-svg">
            <line v-for="i in 4" :key="i"
              :x1="MP.l" :y1="MP.t + ((MH - MP.t - MP.b) / 4) * i"
              :x2="MW - MP.r" :y2="MP.t + ((MH - MP.t - MP.b) / 4) * i"
              stroke="rgba(0,0,0,0.04)" stroke-width="1" />
            <rect v-for="bar in mBars" :key="bar.lbl"
              :x="bar.x" :y="bar.y" :width="bar.w" :height="bar.h"
              rx="3" fill="#223F79" class="month-bar" :class="{ dimmed: hoveredMBar && hoveredMBar !== bar.lbl }" :opacity="hoveredMBar && hoveredMBar !== bar.lbl ? 0.4 : 0.85" @mouseenter="hoveredMBar = bar.lbl" @mouseleave="hoveredMBar = null" />
            <text v-for="bar in mBars" :key="`${bar.lbl}-t`"
              :x="bar.x + bar.w / 2" :y="MH - 8"
              text-anchor="middle" font-size="10" fill="#8e8e93">{{ bar.lbl }}</text>
            <text :x="MP.l - 6" :y="MP.t + 4" text-anchor="end" font-size="10" fill="#aeaeb2">{{ monthMax }}</text>
            <text :x="MP.l - 6" :y="MH - MP.b + 4" text-anchor="end" font-size="10" fill="#aeaeb2">0</text>
          </svg>
          <div v-if="hoveredMBar" class="chart-tooltip month-tooltip">
            <template v-for="bar in mBars" :key="bar.lbl">
              <div v-if="bar.lbl === hoveredMBar">
                <div class="tooltip-name">{{ bar.lbl }}</div>
                <div class="tooltip-value">{{ bar.cnt }} notes</div>
              </div>
            </template>
          </div>
        </div>
        <div v-else class="empty-mini">{{ t('statistics.notesStats.noData') }}</div>
      </div>

      <!-- Row 5: Recent notes -->
      <div class="dash-section full-width">
        <div class="dash-section-title">{{ t('statistics.notesStats.recentNotes') }}</div>
        <div v-if="recent.length" class="recent-list">
          <div v-for="n in recent" :key="n.id" class="recent-item">
            <div class="recent-cover">
              <img v-if="isImagePath(n.cover)" :src="resolveNoteImageUrl(n.cover)" class="recent-img" />
              <span v-else>{{ n.cover || '📝' }}</span>
            </div>
            <div class="recent-info">
              <div class="recent-title">{{ n.title || t('statistics.notesStats.untitled') }}</div>
              <div class="recent-meta">
                <span class="recent-date">{{ fmtDate(n.date) }}</span>
                <span v-if="n.group_name" class="recent-badge">{{ n.group_name }}</span>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="empty-mini">{{ t('statistics.notesStats.noData') }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.notes-stats-tab { padding: 24px 28px; display: flex; flex-direction: column; gap: 16px; }
.loading-state { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #8e8e93; padding: 60px; }
.tab-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.tab-title { font-size: 18px; font-weight: 700; color: #1c1c1e; margin: 0; }

/* KPI */
.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.kpi-card { background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 14px; padding: 16px 18px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); transition: box-shadow 0.15s, transform 0.15s; display: flex; flex-direction: column; gap: 8px; }
.kpi-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.08); transform: translateY(-1px); }
.kpi-primary { background: linear-gradient(135deg, #223F79 0%, #2a4d94 100%); border: none; }
.kpi-primary .kpi-icon { background: rgba(255,255,255,0.15); color: #fff; }
.kpi-primary .kpi-value { color: #fff; }
.kpi-primary .kpi-label { color: rgba(255,255,255,0.75); }
.kpi-icon { width: 32px; height: 32px; border-radius: 8px; background: rgba(34,63,121,0.08); color: #223F79; display: flex; align-items: center; justify-content: center; }
.kpi-value { font-size: 22px; font-weight: 700; color: #1c1c1e; line-height: 1.2; }
.kpi-label { font-size: 12px; color: #8e8e93; }

/* Dash rows */
.dash-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.dash-section { background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 14px; padding: 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }
.dash-section.full-width { grid-column: 1 / -1; }
.dash-section-title { font-size: 14px; font-weight: 600; color: #1c1c1e; margin-bottom: 16px; }
.empty-mini { font-size: 13px; color: #8e8e93; text-align: center; padding: 24px 0; }

/* Donut */
.donut-wrap { display: flex; align-items: center; gap: 20px; }
.donut-svg { width: 120px; height: 120px; flex-shrink: 0; }
.donut-legend { display: flex; flex-direction: column; gap: 8px; flex: 1; }
.donut-legend-item { display: flex; align-items: center; gap: 8px; }
.donut-legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.donut-legend-name { font-size: 12px; color: #3c3c43; font-weight: 500; }
.donut-legend-pct { font-size: 11px; color: #8e8e93; }

/* Group bars */
.group-bars { display: flex; flex-direction: column; gap: 12px; }
.group-bar-row { display: flex; align-items: center; gap: 10px; }
.group-bar-name { width: 100px; flex-shrink: 0; font-size: 12px; color: #3c3c43; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.group-bar-track { flex: 1; height: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; overflow: hidden; }
.group-bar-fill { height: 100%; background: #223F79; border-radius: 4px; transition: width 0.4s ease; }
.group-bar-count { width: 36px; flex-shrink: 0; text-align: right; font-size: 12px; color: #1c1c1e; font-weight: 600; font-variant-numeric: tabular-nums; }

/* Tag cloud */
.tag-cloud { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.tag-chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 20px; background: rgba(34,63,121,0.08); color: #223F79; font-weight: 500; transition: background 0.12s; }
.tag-chip:hover { background: rgba(34,63,121,0.15); }
.tag-sm { font-size: 11px; }
.tag-md { font-size: 13px; }
.tag-lg { font-size: 15px; }
.tag-count { font-size: 10px; color: #8e8e93; font-weight: 600; background: rgba(255,255,255,0.6); padding: 1px 5px; border-radius: 10px; }

/* Storage */
.storage-list { display: flex; flex-direction: column; gap: 14px; }
.storage-item-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 13px; }
.storage-item-header svg { color: #8e8e93; flex-shrink: 0; }
.storage-item-name { color: #3c3c43; flex: 1; }
.storage-item-value { color: #1c1c1e; font-weight: 600; font-variant-numeric: tabular-nums; }
.storage-item-track { height: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; overflow: hidden; }
.storage-item-fill { height: 100%; background: #223F79; border-radius: 4px; transition: width 0.4s ease; }
.storage-item-fill.img { background: #52BA6F; }
.storage-total { display: flex; align-items: center; gap: 6px; margin-top: 4px; padding-top: 10px; border-top: 1px solid rgba(0,0,0,0.06); font-size: 13px; color: #3c3c43; }
.storage-total svg { color: #8e8e93; flex-shrink: 0; }
.storage-total-value { margin-left: auto; font-weight: 700; color: #1c1c1e; font-variant-numeric: tabular-nums; }

/* Monthly chart */
.month-chart { width: 100%; overflow-x: auto; position: relative; }
.month-svg { width: 100%; height: 160px; min-width: 400px; }

/* Chart hover interactions */
.donut-wrap { position: relative; }
.donut-slice {
  transition: opacity 0.2s ease, transform 0.25s ease;
  transform-origin: center;
  cursor: pointer;
}
.donut-slice:hover { transform: scale(1.04); }
.donut-slice.dimmed { opacity: 0.3; }
.donut-legend-item {
  transition: opacity 0.2s ease;
  cursor: pointer;
}
.donut-legend-item.dimmed { opacity: 0.35; }

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

.group-bar-row { position: relative; cursor: pointer; }
.group-bar-fill {
  transition: width 0.4s ease, filter 0.2s ease;
}
.group-bar-fill.highlighted {
  filter: brightness(1.2);
}
.bar-tooltip {
  top: auto;
  bottom: calc(100% + 2px);
  transform: translateX(-50%);
  left: 50%;
}

.month-chart { position: relative; }
.month-bar {
  transition: opacity 0.2s ease, y 0.2s ease, height 0.2s ease;
  cursor: pointer;
}
.month-bar:hover {
  opacity: 1 !important;
}
.month-tooltip {
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
}

/* Recent notes */
.recent-list { display: flex; flex-direction: column; gap: 8px; }
.recent-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: #f9f9f9; border-radius: 10px; transition: background 0.12s; }
.recent-item:hover { background: #f2f2f7; }
.recent-cover { width: 36px; height: 36px; border-radius: 8px; background: #fff; border: 1px solid rgba(0,0,0,0.06); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; overflow: hidden; }
.recent-img { width: 100%; height: 100%; object-fit: cover; }
.recent-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.recent-title { font-size: 14px; font-weight: 500; color: #1c1c1e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.recent-meta { display: flex; align-items: center; gap: 8px; }
.recent-date { font-size: 12px; color: #8e8e93; }
.recent-badge { font-size: 11px; color: #223F79; background: rgba(34,63,121,0.08); padding: 1px 7px; border-radius: 10px; font-weight: 500; }
</style>
