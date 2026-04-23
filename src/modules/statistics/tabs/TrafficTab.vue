<script setup lang="ts">
import { computed } from 'vue'
import { useStatisticsStore, getModelColor, getModelLogoUrl, type SortBy } from '../../../stores/statistics'
import ModelIcon from '../components/ModelIcon.vue'
import TimeRangeSelector from '../components/TimeRangeSelector.vue'
import EmptyState from '../components/EmptyState.vue'
import { ArrowUpDown, Building2, Type } from 'lucide-vue-next'

const stats = useStatisticsStore()

const daily = computed(() => stats.dailyStats)
const maxDailyTraffic = computed(() => Math.max(...daily.value.map(d => d.uploadsMB + d.downloadsMB), 0.01))

const totalUp = computed(() => stats.modelStats.reduce((s, m) => s + m.uploadsMB, 0))
const totalDown = computed(() => stats.modelStats.reduce((s, m) => s + m.downloadsMB, 0))

function formatMB(n: number): string {
  if (n >= 1024) return `${(n / 1024).toFixed(2)} GB`
  return `${n.toFixed(1)} MB`
}

const CHART_HEIGHT = 320
const ICON_MIN_PX = 18
const iconThreshold = ICON_MIN_PX / CHART_HEIGHT

const maxModelTraffic = computed(() => Math.max(...stats.filteredSortedModelStats.map(m => m.uploadsMB + m.downloadsMB), 0.01))

const sortOptions: { key: SortBy; label: string; icon: typeof ArrowUpDown }[] = [
  { key: 'requests', label: '流量', icon: ArrowUpDown },
  { key: 'provider', label: '供应商', icon: Building2 },
  { key: 'name', label: '名称', icon: Type },
]
</script>

<template>
  <div class="traffic-tab">
    <template v-if="stats.isLoading">
      <div class="loading-state">加载中…</div>
    </template>
    <template v-else-if="!stats.hasData">
      <EmptyState />
    </template>
    <template v-else>
      <div class="tab-header">
        <h2 class="tab-title">流量统计</h2>
        <TimeRangeSelector />
      </div>

      <div class="cards-grid">
        <div class="mini-card">
          <div class="mini-label">总上传</div>
          <div class="mini-value">{{ formatMB(totalUp) }}</div>
        </div>
        <div class="mini-card">
          <div class="mini-label">总下载</div>
          <div class="mini-value">{{ formatMB(totalDown) }}</div>
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
                    height: maxDailyTraffic ? `${((m.uploadsMB + m.downloadsMB) / maxDailyTraffic) * 100}%` : '0%',
                    background: getModelColor(m.modelId),
                  }"
                >
                  <img
                    v-if="maxDailyTraffic && ((m.uploadsMB + m.downloadsMB) / maxDailyTraffic) >= iconThreshold && getModelLogoUrl(m.modelId)"
                    :src="getModelLogoUrl(m.modelId)!"
                    class="segment-icon"
                    alt=""
                  />
                  <div class="segment-tooltip">
                    <div class="tip-title">{{ m.modelName }}</div>
                    <div class="tip-line">总流量: {{ formatMB(m.uploadsMB + m.downloadsMB) }}</div>
                    <div class="tip-line">↑ {{ formatMB(m.uploadsMB) }} / ↓ {{ formatMB(m.downloadsMB) }}</div>
                  </div>
                </div>
              </div>
              <div class="col-overlay">
                <div
                  class="col-value"
                  :style="{ bottom: `calc(${((d.uploadsMB + d.downloadsMB) / maxDailyTraffic) * 100}% + 6px)` }"
                >{{ formatMB(d.uploadsMB + d.downloadsMB) }}</div>
              </div>
            </div>
            <div class="col-label">{{ d.date.slice(5) }}</div>
          </div>
        </div>
      </div>

      <!-- 按模型分布 -->
      <div class="section-card">
        <div class="section-header">
          <div class="section-title">按模型分布</div>
          <div class="sort-bar">
            <button
              v-for="opt in sortOptions"
              :key="opt.key"
              class="sort-btn"
              :class="{ active: stats.sortBy === opt.key }"
              @click="stats.setSortBy(opt.key)"
            >
              <component :is="opt.icon" :size="11" />
              {{ opt.label }}
            </button>
          </div>
        </div>
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
                    width: `${((m.uploadsMB + m.downloadsMB) / maxModelTraffic) * 100}%`,
                    background: getModelColor(m.modelId),
                  }"
                />
              </div>
            </div>
            <div class="model-num">{{ formatMB(m.uploadsMB + m.downloadsMB) }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.traffic-tab {
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

.mini-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
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

.sort-bar {
  display: flex;
  gap: 6px;
}

.sort-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #ffffff;
  font-size: 11px;
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
