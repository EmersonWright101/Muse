<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useUiStore } from '../../stores/uiStore'
import { useStatisticsStore } from '../../stores/statistics'
import OverviewTab from './tabs/OverviewTab.vue'
import TokenTab from './tabs/TokenTab.vue'
import TrafficTab from './tabs/TrafficTab.vue'
import CostTab from './tabs/CostTab.vue'
import RankingTab from './tabs/RankingTab.vue'

const ui = useUiStore()
const stats = useStatisticsStore()

const aiUsageTabs = [
  { id: 'tokens',  label: 'Token 用量' },
  { id: 'traffic', label: '流量' },
  { id: 'cost',    label: '花费' },
  { id: 'ranking', label: '排行榜' },
]

const aiUsageComponents: Record<string, unknown> = {
  tokens:  TokenTab,
  traffic: TrafficTab,
  cost:    CostTab,
  ranking: RankingTab,
}

const activeAiComponent = computed(() => aiUsageComponents[ui.aiUsageSubSection] ?? TokenTab)

onMounted(() => {
  stats.loadStats()
})
</script>

<template>
  <div class="statistics-main">
    <div class="statistics-scroll">
      <OverviewTab v-if="ui.statsSection === 'overview'" />
      <template v-else>
        <div class="ai-usage-tabs">
          <div
            v-for="tab in aiUsageTabs"
            :key="tab.id"
            class="ai-usage-tab"
            :class="{ active: ui.aiUsageSubSection === tab.id }"
            @click="ui.setAiUsageSubSection(tab.id)"
          >
            {{ tab.label }}
          </div>
        </div>
        <component :is="activeAiComponent" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.statistics-main {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: #ffffff;
}

.statistics-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.statistics-scroll::-webkit-scrollbar { width: 4px; }
.statistics-scroll::-webkit-scrollbar-track { background: transparent; }
.statistics-scroll::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.10); border-radius: 2px; }

.ai-usage-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 28px 0;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.ai-usage-tab {
  padding: 8px 16px;
  font-size: 13px;
  color: #8e8e93;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all 0.12s;
  user-select: none;
}

.ai-usage-tab:hover {
  color: #3c3c43;
}

.ai-usage-tab.active {
  color: #223F79;
  font-weight: 500;
  border-bottom-color: #223F79;
}
</style>
