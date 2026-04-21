<script setup lang="ts">
import { computed } from 'vue'
import { useStatisticsStore, getModelColor, getModelLogoUrl } from '../../../stores/statistics'
import ModelIcon from '../components/ModelIcon.vue'
import TimeRangeSelector from '../components/TimeRangeSelector.vue'
import EmptyState from '../components/EmptyState.vue'

const stats = useStatisticsStore()

const daily = computed(() => stats.dailyStats)
const maxDailyCost = computed(() => {
  const max = Math.max(...daily.value.map(d => d.cost), 0.001)
  return max
})

const CHART_HEIGHT = 320
const ICON_MIN_PX = 18
const iconThreshold = ICON_MIN_PX / CHART_HEIGHT

const maxModelCost = computed(() => Math.max(...stats.modelStats.map(m => m.cost), 0.001))
</script>

<template>
  <div class="cost-tab">
    <template v-if="stats.isLoading">
      <div class="loading-state">加载中…</div>
    </template>
    <template v-else-if="!stats.hasData">
      <EmptyState />
    </template>
    <template v-else>
      <div class="tab-header">
        <h2 class="tab-title">花费统计</h2>
        <div class="header-actions">
          <div class="currency-toggle">
            <button
              class="curr-btn"
              :class="{ active: stats.currency === 'usd' }"
              @click="stats.setCurrency('usd')"
            >$</button>
            <button
              class="curr-btn"
              :class="{ active: stats.currency === 'cny' }"
              @click="stats.setCurrency('cny')"
            >¥</button>
          </div>
          <TimeRangeSelector />
        </div>
      </div>

      <div class="cards-grid">
        <div class="mini-card accent">
          <div class="mini-label">总花费</div>
          <div class="mini-value">{{ stats.formatCost(stats.totalCost) }}</div>
        </div>
        <div class="mini-card">
          <div class="mini-label">平均每次请求</div>
          <div class="mini-value">{{ stats.formatCost(stats.totalCost / (stats.totalRequests || 1)) }}</div>
        </div>
      </div>

      <!-- 按时间分布 — overlay 方案 -->
      <div class="section-card">
        <div class="section-title">按时间分布</div>
        <div class="col-chart">
          <div v-for="d in daily" :key="d.date" class="col-item">
            <div class="col-stack">
              <div class="col-track">
                <div
                  v-for="m in d.models"
                  :key="m.modelId"
                  class="col-segment"
                  :style="{
                    height: maxDailyCost ? `${(m.cost / maxDailyCost) * 100}%` : '0%',
                    background: getModelColor(m.modelId),
                  }"
                >
                  <img
                    v-if="maxDailyCost && (m.cost / maxDailyCost) >= iconThreshold && getModelLogoUrl(m.modelId)"
                    :src="getModelLogoUrl(m.modelId)!"
                    class="segment-icon"
                    alt=""
                  />
                  <div class="segment-tooltip">
                    <div class="tip-title">{{ m.modelName }}</div>
                    <div class="tip-line">花费: {{ stats.formatCost(m.cost) }}</div>
                    <div class="tip-line">请求: {{ m.requests }} 次</div>
                  </div>
                </div>
              </div>
              <div class="col-overlay">
                <div
                  class="col-value"
                  :style="{ bottom: `calc(${(d.cost / maxDailyCost) * 100}% + 6px)` }"
                >{{ stats.formatCost(d.cost) }}</div>
              </div>
            </div>
            <div class="col-label">{{ d.date.slice(5) }}</div>
          </div>
        </div>
      </div>

      <!-- 按模型分布 -->
      <div class="section-card">
        <div class="section-title">按模型分布</div>
        <div class="model-list">
          <div v-for="m in stats.modelStats" :key="m.modelId" class="model-row">
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
                    width: `${(m.cost / maxModelCost) * 100}%`,
                    background: getModelColor(m.modelId),
                  }"
                />
              </div>
            </div>
            <div class="model-num">{{ stats.formatCost(m.cost) }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cost-tab {
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.currency-toggle {
  display: flex;
  gap: 1px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 6px;
  padding: 2px;
}

.curr-btn {
  width: 28px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 600;
  color: #8e8e93;
  cursor: pointer;
  transition: all 0.12s;
}

.curr-btn:hover {
  color: #3c3c43;
}

.curr-btn.active {
  background: #ffffff;
  color: #223F79;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}

.mini-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
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

.mini-label {
  font-size: 12px;
  color: #8e8e93;
}

.mini-value {
  font-size: 20px;
  font-weight: 700;
  color: #1c1c1e;
  margin-top: 6px;
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

/* ── 时间分布柱状图 — overlay 方案 ── */
.col-chart {
  display: flex;
  align-items: stretch;
  gap: 6px;
  height: 320px;
  padding-bottom: 4px;
}

.col-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 100%;
}

.col-stack {
  width: 100%;
  flex: 1;
  position: relative;
  min-height: 0;
}

.col-track {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  border-radius: 4px;
  z-index: 1;
}

.col-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.col-value {
  position: absolute;
  left: 50%;
  transform: translate(-50%, -100%);
  font-size: 12px;
  color: #1c1c1e;
  font-weight: 600;
  white-space: nowrap;
  line-height: 1;
}

.col-segment {
  position: relative;
  width: 100%;
  min-height: 2px;
  transition: height 0.4s ease;
  cursor: pointer;
}

.col-segment:hover {
  filter: brightness(1.15);
}

.col-segment:first-child {
  border-radius: 4px 4px 0 0;
}

.col-segment:last-child {
  border-radius: 0 0 4px 4px;
}

.col-segment:only-child {
  border-radius: 4px;
}

.segment-icon {
  width: 12px;
  height: 12px;
  object-fit: contain;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  filter: drop-shadow(0 1px 1px rgba(0,0,0,0.35));
  pointer-events: none;
}

.segment-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.1s;
  white-space: nowrap;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(16px) saturate(1.2);
  -webkit-backdrop-filter: blur(16px) saturate(1.2);
  color: #1c1c1e;
  border: 1px solid rgba(255, 255, 255, 0.5);
  padding: 5px 9px;
  border-radius: 8px;
  z-index: 100;
  line-height: 1.5;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}

.segment-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-top-color: rgba(255, 255, 255, 0.72);
}

.col-segment:hover .segment-tooltip {
  opacity: 1;
}

.tip-title {
  font-weight: 600;
  margin-bottom: 1px;
  color: #1c1c1e;
}

.tip-line {
  font-size: 10px;
  color: #5c5c5e;
}

.col-label {
  font-size: 9px;
  color: #8e8e93;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}

/* ── 按模型分布 ── */
.model-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.model-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.model-info {
  width: 120px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-name {
  font-size: 13px;
  color: #1c1c1e;
  font-weight: 500;
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
  transition: width 0.4s ease;
  cursor: pointer;
}

.model-bar-fill:hover {
  filter: brightness(1.15);
}

.model-num {
  width: 70px;
  flex-shrink: 0;
  text-align: right;
  font-size: 13px;
  color: #1c1c1e;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
