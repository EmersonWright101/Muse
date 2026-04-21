<script setup lang="ts">
import { computed } from 'vue'
import { useStatisticsStore, type SortBy, getModelColor } from '../../../stores/statistics'
import ModelIcon from '../components/ModelIcon.vue'
import EmptyState from '../components/EmptyState.vue'
import { Hash, Wallet, Zap } from 'lucide-vue-next'

const stats = useStatisticsStore()

const keyMap: Record<SortBy, keyof typeof stats.modelStats[number]> = { tokens: 'totalTokens', cost: 'cost', requests: 'requests' }

const sortOptions: { key: SortBy; label: string; icon: typeof Hash }[] = [
  { key: 'tokens', label: 'Token 用量', icon: Hash },
  { key: 'cost', label: '花费', icon: Wallet },
  { key: 'requests', label: '请求数', icon: Zap },
]

const ranked = computed(() => stats.rankedModels)

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const maxValue = computed(() => {
  const key = keyMap[stats.sortBy]
  return Math.max(...stats.modelStats.map(m => m[key] as number), 1)
})
</script>

<template>
  <div class="ranking-tab">
    <template v-if="stats.isLoading">
      <div class="loading-state">加载中…</div>
    </template>
    <template v-else-if="!stats.hasData">
      <EmptyState />
    </template>
    <template v-else>
      <div class="tab-header">
        <h2 class="tab-title">排行榜</h2>
      </div>

      <div class="sort-bar">
        <button
          v-for="opt in sortOptions"
          :key="opt.key"
          class="sort-btn"
          :class="{ active: stats.sortBy === opt.key }"
          @click="stats.setSortBy(opt.key)"
        >
          <component :is="opt.icon" :size="13" />
          {{ opt.label }}
        </button>
      </div>

      <div class="rank-list">
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
                  width: `${((m[keyMap[stats.sortBy]] as number) / maxValue) * 100}%`,
                  background: getModelColor(m.modelId),
                }"
              />
            </div>
          </div>

          <div class="rank-stats">
            <div class="rank-stat">
              <span class="stat-num">{{ formatNumber(m.totalTokens) }}</span>
              <span class="stat-label">Tokens</span>
            </div>
            <div class="rank-stat">
              <span class="stat-num">{{ stats.formatCost(m.cost) }}</span>
              <span class="stat-label">花费</span>
            </div>
            <div class="rank-stat">
              <span class="stat-num">{{ formatNumber(m.requests) }}</span>
              <span class="stat-label">请求</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ranking-tab {
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
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
}

.tab-title {
  font-size: 18px;
  font-weight: 700;
  color: #1c1c1e;
  margin: 0;
}

.sort-bar {
  display: flex;
  gap: 8px;
}

.sort-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 7px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #ffffff;
  font-size: 12px;
  color: #3c3c43;
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

.rank-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rank-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
  transition: box-shadow 0.15s;
}

.rank-item:hover {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
}

.rank-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rank-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rank-name {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
}

.rank-provider {
  font-size: 11px;
  color: #8e8e93;
  background: rgba(0, 0, 0, 0.04);
  padding: 1px 6px;
  border-radius: 4px;
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
  transition: width 0.5s ease;
}

.rank-bar-fill:hover {
  filter: brightness(1.15);
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
  min-width: 56px;
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
