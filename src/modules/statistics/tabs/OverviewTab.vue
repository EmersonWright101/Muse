<script setup lang="ts">
import { computed } from 'vue'
import { useStatisticsStore, getModelColor } from '../../../stores/statistics'
import ModelIcon from '../components/ModelIcon.vue'
import EmptyState from '../components/EmptyState.vue'
import { Hash, ArrowUp, Wallet, Activity } from 'lucide-vue-next'

const stats = useStatisticsStore()

const cards = computed(() => [
  { label: '总 Token 用量', value: formatNumber(stats.totalTokens), sub: `输入 ${formatNumber(stats.totalInputTokens)} / 输出 ${formatNumber(stats.totalOutputTokens)}`, icon: Hash, color: '#223F79' },
  { label: '总上传流量', value: `${stats.totalUploads.toFixed(1)} MB`, sub: `下载 ${stats.totalDownloads.toFixed(1)} MB`, icon: ArrowUp, color: '#E4983D' },
  { label: '总花费', value: stats.formatCost(stats.totalCost), sub: `共 ${formatNumber(stats.totalRequests)} 次请求`, icon: Wallet, color: '#34c759' },
  { label: '活跃模型', value: `${stats.modelStats.length}`, sub: '有使用记录的模型', icon: Activity, color: '#8e8e93' },
])

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const topModels = computed(() => [...stats.modelStats].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 5))
const maxTokens = computed(() => Math.max(...topModels.value.map(m => m.totalTokens), 1))
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
      <div class="tab-header">
        <h2 class="tab-title">数据概览</h2>
      </div>

      <div class="cards-grid">
        <div v-for="card in cards" :key="card.label" class="stat-card">
          <div class="card-icon" :style="{ background: `${card.color}15`, color: card.color }">
            <component :is="card.icon" :size="18" />
          </div>
          <div class="card-info">
            <div class="card-value">{{ card.value }}</div>
            <div class="card-label">{{ card.label }}</div>
            <div class="card-sub">{{ card.sub }}</div>
          </div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-title">Top 5 模型使用量</div>
        <div class="bar-chart">
          <div v-for="m in topModels" :key="m.modelId" class="bar-row">
            <div class="bar-label">
              <div class="bar-name-wrap">
                <ModelIcon :model-id="m.modelId" :size="20" />
                <span class="bar-name">{{ m.modelName }}</span>
              </div>
              <span class="bar-num">{{ formatNumber(m.totalTokens) }}</span>
            </div>
            <div class="bar-track">
              <div
                class="bar-fill"
                :style="{
                  width: `${(m.totalTokens / maxTokens) * 100}%`,
                  background: getModelColor(m.modelId),
                }"
              />
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

.cards-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}

.stat-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 18px;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.15s, transform 0.15s;
}

.stat-card:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.card-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.card-info {
  flex: 1;
  min-width: 0;
}

.card-value {
  font-size: 22px;
  font-weight: 700;
  color: #1c1c1e;
  line-height: 1.2;
}

.card-label {
  font-size: 12px;
  color: #8e8e93;
  margin-top: 4px;
}

.card-sub {
  font-size: 11px;
  color: #aeaeb2;
  margin-top: 2px;
}

.section-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  margin-bottom: 16px;
}

.bar-chart {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.bar-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bar-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

.bar-name-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.bar-name {
  color: #3c3c43;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bar-num {
  color: #8e8e93;
  font-weight: 500;
  flex-shrink: 0;
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
  transition: width 0.6s ease;
  cursor: pointer;
}

.bar-fill:hover {
  filter: brightness(1.15);
}
</style>
