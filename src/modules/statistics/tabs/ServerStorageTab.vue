<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RefreshCw, HardDrive, CloudOff } from 'lucide-vue-next'
import { apiGet, isBackendConfigured } from '../../../services/api'

interface ServerStats {
  settings: number
  chat:     number
  home:     number
  travel:   number
  papers:   number
  todo:     number
  total:    number
}

const stats   = ref<ServerStats | null>(null)
const loading = ref(false)
const error   = ref(false)

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function load() {
  if (!isBackendConfigured()) return
  loading.value = true
  error.value = false
  try {
    stats.value = await apiGet<ServerStats>('/api/statistics')
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

const modules = computed(() => {
  if (!stats.value) return []
  const total = stats.value.total || 1
  return [
    { key: 'chat',     label: '对话',     bytes: stats.value.chat,     color: '#223F79' },
    { key: 'papers',   label: '论文',     bytes: stats.value.papers,   color: '#E4983D' },
    { key: 'home',     label: '海报',     bytes: stats.value.home,     color: '#52BA6F' },
    { key: 'travel',   label: '旅行笔记', bytes: stats.value.travel,   color: '#9B6CF0' },
    { key: 'settings', label: '设置',     bytes: stats.value.settings, color: '#20BDB8' },
    { key: 'todo',     label: 'Todo',     bytes: stats.value.todo,     color: '#F0A830' },
  ].map(m => ({ ...m, pct: (m.bytes / total) * 100 }))
    .sort((a, b) => b.bytes - a.bytes)
})

const configured = isBackendConfigured()

onMounted(load)
</script>

<template>
  <div class="server-storage">
    <div class="page-header">
      <h2 class="page-title">服务器存储</h2>
      <button v-if="configured" class="refresh-btn" :class="{ spinning: loading }" :disabled="loading" @click="load">
        <RefreshCw :size="13" />
      </button>
    </div>

    <!-- Not configured -->
    <div v-if="!configured" class="empty-state">
      <CloudOff :size="36" class="empty-icon" />
      <p class="empty-title">未配置后端服务器</p>
      <p class="empty-desc">在设置 → 通用 → 后端服务器配置中填写服务地址和 API Key。</p>
    </div>

    <!-- Loading -->
    <div v-else-if="loading && !stats" class="loading-state">
      <div class="skeleton-card" />
      <div class="skeleton-row" v-for="i in 5" :key="i" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="empty-state">
      <p class="empty-title">获取失败</p>
      <p class="empty-desc">无法连接到后端，请检查网络和服务器状态。</p>
    </div>

    <!-- Data -->
    <template v-else-if="stats">
      <!-- Total card -->
      <div class="total-card">
        <HardDrive :size="20" class="total-icon" />
        <div class="total-info">
          <span class="total-label">总占用</span>
          <span class="total-value">{{ formatBytes(stats.total) }}</span>
        </div>
      </div>

      <!-- Stacked bar -->
      <div class="stacked-bar">
        <div
          v-for="m in modules"
          :key="m.key"
          class="bar-segment"
          :style="{ width: m.pct + '%', background: m.color }"
          :title="`${m.label}: ${formatBytes(m.bytes)}`"
        />
      </div>

      <!-- Module rows -->
      <div class="module-list">
        <div v-for="m in modules" :key="m.key" class="module-row">
          <div class="module-left">
            <span class="module-dot" :style="{ background: m.color }" />
            <span class="module-label">{{ m.label }}</span>
          </div>
          <div class="module-right">
            <div class="module-bar-wrap">
              <div class="module-bar-fill" :style="{ width: m.pct + '%', background: m.color }" />
            </div>
            <span class="module-size">{{ formatBytes(m.bytes) }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.server-storage {
  padding: 28px 28px 40px;
  max-width: 560px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.page-title {
  font-size: 18px;
  font-weight: 700;
  color: #1c1c1e;
  margin: 0;
}

.refresh-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.05);
  color: #8e8e93;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.refresh-btn:hover:not(:disabled) { background: rgba(0,0,0,0.09); color: #3c3c43; }
.refresh-btn:disabled { opacity: 0.5; cursor: default; }
.refresh-btn.spinning svg { animation: spin 0.8s linear infinite; }

@keyframes spin { to { transform: rotate(360deg); } }

/* Empty / loading states */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 60px 0;
  text-align: center;
}
.empty-icon { color: #c7c7cc; }
.empty-title { font-size: 15px; font-weight: 600; color: #1c1c1e; margin: 0; }
.empty-desc  { font-size: 13px; color: #8e8e93; margin: 0; max-width: 280px; line-height: 1.5; }

.loading-state { display: flex; flex-direction: column; gap: 12px; }
.skeleton-card { height: 76px; border-radius: 14px; background: rgba(0,0,0,0.06); animation: pulse 1.4s ease-in-out infinite; }
.skeleton-row  { height: 44px; border-radius: 10px; background: rgba(0,0,0,0.04); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }

/* Total card */
.total-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: rgba(34, 63, 121, 0.06);
  border: 1px solid rgba(34, 63, 121, 0.12);
  border-radius: 14px;
  padding: 16px 18px;
  margin-bottom: 16px;
}
.total-icon { color: #223F79; flex-shrink: 0; }
.total-info { display: flex; flex-direction: column; gap: 2px; }
.total-label { font-size: 12px; color: #8e8e93; }
.total-value { font-size: 22px; font-weight: 700; color: #1c1c1e; letter-spacing: -0.5px; }

/* Stacked bar */
.stacked-bar {
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(0,0,0,0.06);
  display: flex;
  margin-bottom: 20px;
}
.bar-segment { height: 100%; transition: width 0.4s ease; min-width: 2px; }

/* Module list */
.module-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.module-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 10px;
}

.module-left {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 80px;
  flex-shrink: 0;
}
.module-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.module-label { font-size: 13px; color: #3c3c43; }

.module-right {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.module-bar-wrap {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: rgba(0,0,0,0.06);
  overflow: hidden;
}
.module-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
  min-width: 2px;
}
.module-size {
  font-size: 12px;
  color: #8e8e93;
  width: 64px;
  text-align: right;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
</style>
