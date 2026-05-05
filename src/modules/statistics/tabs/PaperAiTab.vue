<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { usePapersStore } from '../../../stores/papers'
import { useStatisticsStore } from '../../../stores/statistics'
import { RefreshCw, Type, Cpu, DollarSign, BookOpen, Star, Database, Server, BarChart3 } from 'lucide-vue-next'

const papers = usePapersStore()
const stats = useStatisticsStore()

const d = computed(() => papers.paperStatistics?.dashboard)
const provider = computed(() => papers.paperStatistics?.analysis_provider)
const sources = computed(() => papers.paperStatistics?.sources ?? [])

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatCost(usd: number): string {
  return stats.formatCost(usd)
}

function refresh() {
  papers.fetchPaperStatistics()
}

async function openStatsPage() {
  if (!papers.baseUrl) return
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(`${papers.baseUrl}/stats`)
  } catch { /* ignore */ }
}

onMounted(() => {
  if (!papers.paperStatistics && papers.isConfigured) {
    papers.fetchPaperStatistics()
  }
})
</script>

<template>
  <div class="paper-ai-tab">
    <template v-if="papers.isFetchingPaperStats">
      <div class="loading-state">加载中…</div>
    </template>
    <template v-else-if="papers.paperStatsError">
      <div class="error-state">
        <p>{{ papers.paperStatsError }}</p>
        <button class="retry-btn" @click="refresh">
          <RefreshCw :size="13" />
          重试
        </button>
      </div>
    </template>
    <template v-else-if="!d">
      <div class="empty-state">
        <p>暂无数据</p>
        <button class="retry-btn" @click="refresh">
          <RefreshCw :size="13" />
          刷新
        </button>
      </div>
    </template>
    <template v-else>
      <div class="tab-header">
        <h2 class="tab-title">私人 AI 助手</h2>
        <div class="tab-actions">
          <button class="refresh-btn" @click="openStatsPage">
            <BarChart3 :size="13" />
            后台查看
          </button>
          <button class="refresh-btn" :disabled="papers.isFetchingPaperStats" @click="refresh">
            <RefreshCw :size="13" />
            刷新
          </button>
        </div>
      </div>

      <!-- KPI Cards -->
      <div class="cards-grid">
        <div class="mini-card">
          <div class="mini-icon">
            <Type :size="16" />
          </div>
          <div class="mini-label">Input Tokens</div>
          <div class="mini-value">{{ formatNumber(d.total_tokens_input) }}</div>
        </div>
        <div class="mini-card">
          <div class="mini-icon">
            <Cpu :size="16" />
          </div>
          <div class="mini-label">Output Tokens</div>
          <div class="mini-value">{{ formatNumber(d.total_tokens_output) }}</div>
        </div>
        <div class="mini-card accent">
          <div class="mini-icon">
            <DollarSign :size="16" />
          </div>
          <div class="mini-label">总花费</div>
          <div class="mini-value">{{ formatCost(d.cost_usd) }}</div>
        </div>
        <div class="mini-card">
          <div class="mini-icon">
            <Server :size="16" />
          </div>
          <div class="mini-label">API 请求</div>
          <div class="mini-value">{{ formatNumber(d.api_requests_count) }}</div>
        </div>
        <div class="mini-card">
          <div class="mini-icon">
            <BookOpen :size="16" />
          </div>
          <div class="mini-label">已分析 / 总论文</div>
          <div class="mini-value">
            {{ d.analyzed_papers }}<span class="mini-value-dim">/ {{ d.total_papers }}</span>
          </div>
        </div>
        <div class="mini-card">
          <div class="mini-icon">
            <Star :size="16" />
          </div>
          <div class="mini-label">好文章</div>
          <div class="mini-value">{{ d.good_papers }}</div>
        </div>
      </div>

      <!-- Provider info -->
      <div v-if="provider" class="section-card">
        <div class="section-title">AI 分析提供商</div>
        <div class="provider-grid">
          <div class="provider-item">
            <span class="provider-key">名称</span>
            <span class="provider-val">{{ provider.name }}</span>
          </div>
          <div class="provider-item">
            <span class="provider-key">模型</span>
            <span class="provider-val">{{ provider.model }}</span>
          </div>
          <div class="provider-item">
            <span class="provider-key">Base URL</span>
            <span class="provider-val provider-url">{{ provider.base_url }}</span>
          </div>
          <div class="provider-item">
            <span class="provider-key">Input 单价</span>
            <span class="provider-val">${{ provider.price_input_usd_per_m }} / 1M tokens</span>
          </div>
          <div class="provider-item">
            <span class="provider-key">Output 单价</span>
            <span class="provider-val">${{ provider.price_output_usd_per_m }} / 1M tokens</span>
          </div>
        </div>
      </div>

      <!-- Source distribution -->
      <div v-if="sources.length > 0" class="section-card">
        <div class="section-header">
          <div class="section-title">来源分布</div>
        </div>
        <div class="source-list">
          <div v-for="s in sources" :key="s.source" class="source-row">
            <div class="source-info">
              <span class="source-name">{{ s.source }}</span>
              <span v-if="s.last_crawl_at" class="source-meta">
                上次爬取 {{ s.last_crawl_at }}
              </span>
            </div>
            <div class="source-bar-wrap">
              <div class="source-bar-track">
                <div
                  class="source-bar-fill"
                  :style="{ width: `${(s.analyzed / Math.max(s.total, 1)) * 100}%` }"
                />
              </div>
              <div class="source-bar-labels">
                <span class="source-bar-label">已分析 {{ s.analyzed }}</span>
                <span class="source-bar-total">共 {{ s.total }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Storage info -->
      <div class="section-card">
        <div class="section-title">存储概览</div>
        <div class="storage-grid">
          <div class="storage-item">
            <Database :size="14" />
            <span class="storage-label">数据库</span>
            <span class="storage-value">{{ formatBytes(d.db_size_bytes) }}</span>
          </div>
          <div class="storage-item">
            <BookOpen :size="14" />
            <span class="storage-label">PDF 文件</span>
            <span class="storage-value">{{ d.pdfs_stored }} 个 / {{ formatBytes(d.pdf_bytes) }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.paper-ai-tab {
  padding: 24px 28px 48px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-height: 100%;
}

.loading-state,
.empty-state,
.error-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #8e8e93;
  padding: 60px;
  gap: 12px;
}

.error-state { color: #ef4444; }

.retry-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #ffffff;
  font-size: 12px;
  color: #3c3c43;
  cursor: pointer;
  transition: all 0.12s;
}

.retry-btn:hover {
  background: rgba(0, 0, 0, 0.03);
}

.tab-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.tab-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tab-title {
  font-size: 18px;
  font-weight: 700;
  color: #1c1c1e;
  margin: 0;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #ffffff;
  font-size: 12px;
  color: #3c3c43;
  cursor: pointer;
  transition: all 0.12s;
}

.refresh-btn:hover {
  background: rgba(0, 0, 0, 0.03);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.mini-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mini-card.accent {
  background: linear-gradient(135deg, #223F79 0%, #2a4d94 100%);
  border: none;
}

.mini-card.accent .mini-label,
.mini-card.accent .mini-value {
  color: rgba(255, 255, 255, 0.85);
}

.mini-card.accent .mini-value {
  color: #fff;
}

.mini-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(34, 63, 121, 0.08);
  color: #223F79;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mini-card.accent .mini-icon {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.mini-label {
  font-size: 12px;
  color: #8e8e93;
}

.mini-value {
  font-size: 20px;
  font-weight: 700;
  color: #1c1c1e;
}

.mini-value-dim {
  font-size: 14px;
  font-weight: 500;
  color: #8e8e93;
  margin-left: 2px;
}

.section-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0;
}

/* Provider grid */
.provider-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px 20px;
}

.provider-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.provider-key {
  font-size: 11px;
  color: #8e8e93;
}

.provider-val {
  font-size: 13px;
  color: #1c1c1e;
  font-weight: 500;
}

.provider-url {
  font-size: 12px;
  color: #3c3c43;
  word-break: break-all;
}

/* Source list */
.source-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.source-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.source-info {
  width: 120px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.source-name {
  font-size: 13px;
  color: #1c1c1e;
  font-weight: 500;
  text-transform: capitalize;
}

.source-meta {
  font-size: 10px;
  color: #8e8e93;
}

.source-bar-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.source-bar-track {
  height: 8px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
  overflow: hidden;
}

.source-bar-fill {
  height: 100%;
  background: #223F79;
  border-radius: 4px;
  transition: width 0.4s ease;
}

.source-bar-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #8e8e93;
}

.source-bar-label {
  color: #223F79;
  font-weight: 500;
}

/* Storage */
.storage-grid {
  display: flex;
  gap: 24px;
}

.storage-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #3c3c43;
  font-size: 13px;
}

.storage-item :deep(svg) {
  color: #8e8e93;
  flex-shrink: 0;
}

.storage-label {
  color: #8e8e93;
}

.storage-value {
  font-weight: 600;
  color: #1c1c1e;
}

@media (max-width: 720px) {
  .cards-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .provider-grid {
    grid-template-columns: 1fr;
  }
}
</style>
