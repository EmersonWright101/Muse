<script setup lang="ts">
import { useStatisticsStore, type TimeRange } from '../../../stores/statistics'

const stats = useStatisticsStore()

const options: { value: TimeRange; label: string }[] = [
  { value: 'today', label: '今天' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'year', label: '本年' },
]
</script>

<template>
  <div class="time-range">
    <button
      v-for="opt in options"
      :key="opt.value"
      class="range-btn"
      :class="{ active: stats.timeRange === opt.value }"
      @click="stats.setTimeRange(opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.time-range {
  display: flex;
  gap: 4px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 8px;
  padding: 3px;
}

.range-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  font-size: 12px;
  color: #8e8e93;
  cursor: pointer;
  transition: all 0.12s;
  font-weight: 500;
}

.range-btn:hover {
  color: #3c3c43;
}

.range-btn.active {
  background: #ffffff;
  color: #223F79;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
</style>
