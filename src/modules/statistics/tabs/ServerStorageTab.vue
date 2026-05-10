<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RefreshCw, CloudOff, Type, Cpu, DollarSign, BookOpen, Star, Database, Server, BarChart3 } from 'lucide-vue-next'
import { apiGet, isBackendConfigured } from '../../../services/api'
import { usePapersStore } from '../../../stores/papers'
import { useStatisticsStore } from '../../../stores/statistics'

interface ServerStats {
  settings: number; chat: number; home: number
  travel: number; papers: number; todo: number; total: number
  [key: string]: number  // 允许后端返回新的模块数据（如 ebook 等）
}

const stats      = ref<ServerStats | null>(null)
const loading    = ref(false)
const error      = ref(false)
const hoveredKey = ref<string | null>(null)

const R    = 72
const SW   = 24
const CIRC = 2 * Math.PI * R

function formatBytes(n: number): string {
  if (n === 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`
  return `${(n / 1073741824).toFixed(2)} GB`
}

async function load() {
  if (!isBackendConfigured()) return
  loading.value = true
  error.value = false
  try { stats.value = await apiGet<ServerStats>('/api/statistics') }
  catch { error.value = true }
  finally { loading.value = false }
}

// 已知模块的显示配置（label、颜色）
// 后端返回的新字段如果没有在这里定义，会显示 key 作为 label 并使用默认颜色
const MODULE_META: Record<string, { label: string; color: string }> = {
  chat:     { label: '对话',     color: '#3B5BA5' },
  home:     { label: '海报',     color: '#52BA6F' },
  papers:   { label: '论文',     color: '#E4983D' },
  travel:   { label: '旅行笔记', color: '#9B6CF0' },
  settings: { label: '设置',     color: '#20BDB8' },
  todo:     { label: 'Todo',     color: '#F0A830' },
  ebook:    { label: '图书',     color: '#E85D75' },
}

const DEFAULT_COLORS = [
  '#3B5BA5', '#52BA6F', '#E4983D', '#9B6CF0',
  '#20BDB8', '#F0A830', '#E85D75', '#6B8E23',
  '#4682B4', '#D2691E', '#8B4513', '#708090',
]

const modules = computed(() => {
  if (!stats.value) return []
  const total = stats.value.total || 1

  // 自动收集后端返回的所有模块（排除 total 字段）
  const keys = Object.keys(stats.value).filter(k => k !== 'total')

  let colorIdx = 0
  return keys
    .map(key => {
      const meta = MODULE_META[key]
      const bytes = stats.value![key] as number
      return {
        key,
        label: meta?.label ?? key,
        color: meta?.color ?? DEFAULT_COLORS[colorIdx++ % DEFAULT_COLORS.length],
        bytes,
        pct: (bytes / total) * 100,
      }
    })
    .sort((a, b) => b.bytes - a.bytes)
})

const segments = computed(() => {
  if (!stats.value) return []
  const total = stats.value.total || 1
  let cum = 0
  return modules.value.map(m => {
    const len = (m.bytes / total) * CIRC
    const s = { ...m, len, dasharray: `${len} ${CIRC}`, dashoffset: -cum }
    cum += len
    return s
  })
})

const active = computed(() =>
  hoveredKey.value ? modules.value.find(m => m.key === hoveredKey.value) ?? null : null
)

// ─── Paper AI section ─────────────────────────────────────────────────────────

const papers    = usePapersStore()
const statsStore = useStatisticsStore()

const d       = computed(() => papers.paperStatistics?.dashboard)
const provider = computed(() => papers.paperStatistics?.analysis_provider)
const sources  = computed(() => papers.paperStatistics?.sources ?? [])

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatCost(usd: number): string {
  return statsStore.formatCost(usd)
}

async function openStatsPage() {
  if (!papers.baseUrl) return
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(`${papers.baseUrl}/stats`)
  } catch { /* ignore */ }
}

async function refreshAll() {
  load()
  if (papers.isConfigured) papers.fetchPaperStatistics()
}

// ─── Init ─────────────────────────────────────────────────────────────────────

const configured = isBackendConfigured()

onMounted(() => {
  load()
  if (papers.isConfigured && !papers.paperStatistics) {
    papers.fetchPaperStatistics()
  }
})
</script>

<template>
  <div class="server-storage">

    <!-- ── Header ───────────────────────────────────────────────────────────── -->
    <div class="page-header">
      <h2 class="page-title">服务器存储空间</h2>
      <div class="header-actions">
        <button v-if="papers.isConfigured" class="action-btn" @click="openStatsPage">
          <BarChart3 :size="13" />
          <span>后台查看</span>
        </button>
        <button v-if="configured" class="action-btn" :disabled="loading || papers.isFetchingPaperStats" @click="refreshAll">
          <RefreshCw :size="13" :class="{ spinning: loading || papers.isFetchingPaperStats }" />
        </button>
      </div>
    </div>

    <div v-if="!configured" class="empty-state">
      <CloudOff :size="36" class="empty-icon" />
      <p class="empty-title">未配置后端服务器</p>
      <p class="empty-desc">在设置 → 通用 → 后端服务器配置中填写服务地址和 API Key。</p>
    </div>

    <div v-else-if="loading && !stats" class="skeleton-wrap">
      <div class="skeleton-circle" />
      <div class="skeleton-rows">
        <div v-for="i in 6" :key="i" class="skeleton-row" />
      </div>
    </div>

    <div v-else-if="error" class="empty-state">
      <p class="empty-title">获取失败</p>
      <p class="empty-desc">无法连接到后端，请检查网络和服务器状态。</p>
    </div>

    <div v-else-if="stats" class="chart-layout">
      <div class="chart-wrap">
        <svg viewBox="0 0 200 200" class="donut-svg">
          <circle cx="100" cy="100" :r="R" fill="none" stroke="rgba(0,0,0,0.06)" :stroke-width="SW" />
          <g transform="rotate(-90 100 100)">
            <circle
              v-for="seg in segments" :key="seg.key"
              cx="100" cy="100" :r="R"
              fill="none" :stroke="seg.color"
              :stroke-width="hoveredKey === seg.key ? SW + 6 : SW"
              :stroke-dasharray="seg.dasharray"
              :stroke-dashoffset="seg.dashoffset"
              :opacity="hoveredKey && hoveredKey !== seg.key ? 0.3 : 1"
              class="seg"
              @mouseenter="hoveredKey = seg.key"
              @mouseleave="hoveredKey = null"
            />
          </g>
          <text x="100" y="91"  class="c-sub" text-anchor="middle" dominant-baseline="middle">{{ active ? active.label : '总占用' }}</text>
          <text x="100" y="112" class="c-val" text-anchor="middle" dominant-baseline="middle">{{ active ? formatBytes(active.bytes) : formatBytes(stats.total) }}</text>
          <text v-if="active" x="100" y="130" class="c-pct" text-anchor="middle" dominant-baseline="middle">{{ active.pct.toFixed(1) }}%</text>
        </svg>
        <div class="stacked-bar">
          <div
            v-for="seg in segments" :key="seg.key"
            class="bar-seg"
            :style="{ flex: seg.len, background: seg.color }"
            :class="{ dimmed: hoveredKey && hoveredKey !== seg.key, lit: hoveredKey === seg.key }"
            @mouseenter="hoveredKey = seg.key"
            @mouseleave="hoveredKey = null"
          />
        </div>
      </div>
      <div class="legend">
        <div
          v-for="m in modules" :key="m.key"
          class="legend-row"
          :class="{ dimmed: hoveredKey && hoveredKey !== m.key, lit: hoveredKey === m.key }"
          @mouseenter="hoveredKey = m.key"
          @mouseleave="hoveredKey = null"
        >
          <span class="dot" :style="{ background: m.color }" />
          <span class="leg-label">{{ m.label }}</span>
          <div class="leg-bar-wrap">
            <div class="leg-bar-fill" :style="{ width: m.pct + '%', background: m.color }" />
          </div>
          <span class="leg-pct">{{ m.pct.toFixed(1) }}%</span>
          <span class="leg-size">{{ formatBytes(m.bytes) }}</span>
        </div>
      </div>
    </div>

    <!-- ── Paper AI section (only when papers backend configured) ─────────────── -->
    <template v-if="papers.isConfigured">
      <div class="section-sep" />

      <div class="section-heading">
        <h3 class="section-title">私人 AI 助手</h3>
      </div>

      <div v-if="papers.isFetchingPaperStats && !d" class="paper-loading">加载中…</div>

      <div v-else-if="papers.paperStatsError" class="paper-error">
        {{ papers.paperStatsError }}
        <button class="action-btn" @click="papers.fetchPaperStatistics()">
          <RefreshCw :size="13" /> 重试
        </button>
      </div>

      <template v-else-if="d">
        <!-- KPI Cards -->
        <div class="cards-grid">
          <div class="mini-card">
            <div class="mini-icon"><Type :size="15" /></div>
            <div class="mini-label">Input Tokens</div>
            <div class="mini-value">{{ formatNumber(d.total_tokens_input) }}</div>
          </div>
          <div class="mini-card">
            <div class="mini-icon"><Cpu :size="15" /></div>
            <div class="mini-label">Output Tokens</div>
            <div class="mini-value">{{ formatNumber(d.total_tokens_output) }}</div>
          </div>
          <div class="mini-card accent">
            <div class="mini-icon"><DollarSign :size="15" /></div>
            <div class="mini-label">总花费</div>
            <div class="mini-value">{{ formatCost(d.cost_usd) }}</div>
          </div>
          <div class="mini-card">
            <div class="mini-icon"><Server :size="15" /></div>
            <div class="mini-label">API 请求</div>
            <div class="mini-value">{{ formatNumber(d.api_requests_count) }}</div>
          </div>
          <div class="mini-card">
            <div class="mini-icon"><BookOpen :size="15" /></div>
            <div class="mini-label">已分析 / 总论文</div>
            <div class="mini-value">{{ d.analyzed_papers }}<span class="mini-value-dim">/ {{ d.total_papers }}</span></div>
          </div>
          <div class="mini-card">
            <div class="mini-icon"><Star :size="15" /></div>
            <div class="mini-label">好文章</div>
            <div class="mini-value">{{ d.good_papers }}</div>
          </div>
        </div>

        <!-- Provider -->
        <div v-if="provider" class="info-card">
          <div class="info-card-title">AI 分析提供商</div>
          <div class="provider-grid">
            <div class="provider-item">
              <span class="pk">名称</span><span class="pv">{{ provider.name }}</span>
            </div>
            <div class="provider-item">
              <span class="pk">模型</span><span class="pv">{{ provider.model }}</span>
            </div>
            <div class="provider-item">
              <span class="pk">Base URL</span><span class="pv pv-url">{{ provider.base_url }}</span>
            </div>
            <div class="provider-item">
              <span class="pk">Input 单价</span><span class="pv">${{ provider.price_input_usd_per_m }} / 1M</span>
            </div>
            <div class="provider-item">
              <span class="pk">Output 单价</span><span class="pv">${{ provider.price_output_usd_per_m }} / 1M</span>
            </div>
          </div>
        </div>

        <!-- Sources -->
        <div v-if="sources.length > 0" class="info-card">
          <div class="info-card-title">来源分布</div>
          <div class="source-list">
            <div v-for="s in sources" :key="s.source" class="source-row">
              <div class="source-info">
                <span class="source-name">{{ s.source }}</span>
                <span v-if="s.last_crawl_at" class="source-meta">上次爬取 {{ s.last_crawl_at }}</span>
              </div>
              <div class="source-bar-wrap">
                <div class="source-bar-track">
                  <div class="source-bar-fill" :style="{ width: `${(s.analyzed / Math.max(s.total, 1)) * 100}%` }" />
                </div>
                <div class="source-bar-labels">
                  <span class="source-bar-hi">已分析 {{ s.analyzed }}</span>
                  <span>共 {{ s.total }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Storage overview -->
        <div class="info-card">
          <div class="info-card-title">存储概览</div>
          <div class="storage-row">
            <Database :size="14" /><span class="storage-label">数据库</span>
            <span class="storage-value">{{ formatBytes(d.db_size_bytes) }}</span>
          </div>
          <div class="storage-row">
            <BookOpen :size="14" /><span class="storage-label">PDF 文件</span>
            <span class="storage-value">{{ d.pdfs_stored }} 个 / {{ formatBytes(d.pdf_bytes) }}</span>
          </div>
        </div>
      </template>
    </template>

  </div>
</template>

<style scoped>
.server-storage {
  padding: 28px 32px 48px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Header ── */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.page-title {
  font-size: 18px;
  font-weight: 700;
  color: #1c1c1e;
  margin: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,0.08);
  background: #fff;
  font-size: 12px;
  color: #3c3c43;
  cursor: pointer;
  transition: background 0.12s;
}
.action-btn:hover:not(:disabled) { background: rgba(0,0,0,0.04); }
.action-btn:disabled { opacity: 0.5; cursor: default; }
.action-btn.spinning svg,
svg.spinning { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Empty / error ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 0;
  text-align: center;
}
.empty-icon  { color: #c7c7cc; }
.empty-title { font-size: 15px; font-weight: 600; color: #1c1c1e; margin: 0; }
.empty-desc  { font-size: 13px; color: #8e8e93; margin: 0; max-width: 280px; line-height: 1.5; }

/* ── Skeleton ── */
.skeleton-wrap { display: flex; gap: 32px; align-items: center; margin-bottom: 24px; }
.skeleton-circle { width: 200px; height: 200px; border-radius: 50%; background: rgba(0,0,0,0.06); flex-shrink: 0; animation: pulse 1.4s ease-in-out infinite; }
.skeleton-rows { flex: 1; display: flex; flex-direction: column; gap: 10px; }
.skeleton-row { height: 38px; border-radius: 9px; background: rgba(0,0,0,0.04); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }

/* ── Chart layout ── */
.chart-layout {
  display: flex;
  gap: 32px;
  align-items: center;
  margin-bottom: 24px;
}
.chart-wrap { flex-shrink: 0; width: 200px; }
.donut-svg  { width: 200px; height: 200px; overflow: visible; }

.seg { cursor: pointer; transition: stroke-width 0.18s ease, opacity 0.18s ease; }

.c-sub { font-size: 12px; fill: #8e8e93; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
.c-val { font-size: 17px; font-weight: 700; fill: #1c1c1e; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-variant-numeric: tabular-nums; }
.c-pct { font-size: 12px; fill: #8e8e93; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }

.stacked-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin-top: 14px; background: rgba(0,0,0,0.06); }
.bar-seg { height: 100%; min-width: 3px; cursor: pointer; transition: opacity 0.18s, filter 0.18s; }
.bar-seg.dimmed { opacity: 0.25; }
.bar-seg.lit    { filter: brightness(1.15); }

/* ── Legend ── */
.legend { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.legend-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 9px; cursor: pointer;
  transition: background 0.12s, opacity 0.18s;
}
.legend-row:hover, .legend-row.lit { background: rgba(0,0,0,0.04); }
.legend-row.dimmed { opacity: 0.3; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.leg-label { font-size: 13px; color: #3c3c43; width: 68px; flex-shrink: 0; }
.leg-bar-wrap { flex: 1; height: 5px; border-radius: 3px; background: rgba(0,0,0,0.06); overflow: hidden; min-width: 0; }
.leg-bar-fill { height: 100%; border-radius: 3px; min-width: 2px; transition: width 0.4s ease; }
.leg-pct  { font-size: 11px; color: #8e8e93; width: 40px; text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.leg-size { font-size: 12px; color: #8e8e93; width: 72px; text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums; }

/* ── Section separator ── */
.section-sep {
  height: 1px;
  background: rgba(0,0,0,0.07);
  margin: 8px 0 24px;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.section-title {
  font-size: 16px;
  font-weight: 700;
  color: #1c1c1e;
  margin: 0;
}

.paper-loading { font-size: 14px; color: #8e8e93; padding: 24px 0; text-align: center; }
.paper-error   { font-size: 13px; color: #ef4444; padding: 16px 0; display: flex; align-items: center; gap: 12px; }

/* ── KPI Cards ── */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.mini-card {
  background: #fff;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 13px;
  padding: 14px 16px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.04);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.mini-card.accent { background: linear-gradient(135deg, #223F79 0%, #2a4d94 100%); border: none; }
.mini-card.accent .mini-label,
.mini-card.accent .mini-value { color: rgba(255,255,255,0.85); }
.mini-card.accent .mini-value { color: #fff; }
.mini-icon {
  width: 26px; height: 26px; border-radius: 7px;
  background: rgba(34,63,121,0.08); color: #223F79;
  display: flex; align-items: center; justify-content: center;
}
.mini-card.accent .mini-icon { background: rgba(255,255,255,0.15); color: #fff; }
.mini-label { font-size: 11px; color: #8e8e93; }
.mini-value { font-size: 18px; font-weight: 700; color: #1c1c1e; }
.mini-value-dim { font-size: 13px; font-weight: 500; color: #8e8e93; margin-left: 2px; }

/* ── Info cards ── */
.info-card {
  background: #fff;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 13px;
  padding: 18px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.04);
  margin-bottom: 12px;
}
.info-card-title { font-size: 13px; font-weight: 600; color: #1c1c1e; margin-bottom: 14px; }

.provider-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 20px; }
.provider-item { display: flex; flex-direction: column; gap: 2px; }
.pk { font-size: 11px; color: #8e8e93; }
.pv { font-size: 13px; color: #1c1c1e; font-weight: 500; }
.pv-url { font-size: 12px; color: #3c3c43; word-break: break-all; font-weight: 400; }

.source-list { display: flex; flex-direction: column; gap: 12px; }
.source-row  { display: flex; align-items: center; gap: 14px; }
.source-info { width: 110px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; }
.source-name { font-size: 13px; color: #1c1c1e; font-weight: 500; text-transform: capitalize; }
.source-meta { font-size: 10px; color: #8e8e93; }
.source-bar-wrap  { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.source-bar-track { height: 7px; background: rgba(0,0,0,0.05); border-radius: 4px; overflow: hidden; }
.source-bar-fill  { height: 100%; background: #223F79; border-radius: 4px; transition: width 0.4s; }
.source-bar-labels { display: flex; justify-content: space-between; font-size: 11px; color: #8e8e93; }
.source-bar-hi    { color: #223F79; font-weight: 500; }

.storage-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: #3c3c43;
  padding: 4px 0;
}
.storage-row :deep(svg) { color: #8e8e93; flex-shrink: 0; }
.storage-label { color: #8e8e93; flex: 1; }
.storage-value { font-weight: 600; color: #1c1c1e; }
</style>
