<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, Square, X, Loader2, Check } from 'lucide-vue-next'
import sidebarIcon from '../assets/icons/sidebar.svg'
import cloudGray from '../assets/icons/cloud-gray.svg'
import cloudBlue from '../assets/icons/cloud-blue.svg'
import cloudGreen from '../assets/icons/cloud-green.svg'
import cloudRed from '../assets/icons/cloud-red.svg'
import { syncStatus } from '../stores/syncStatus'
import { tryNewSync } from '../services/syncManager2'
import { computed, ref, watch } from 'vue'

defineProps<{ panelVisible: boolean }>()
const emit = defineEmits<{ toggle: [] }>()

const win = getCurrentWindow()

// On Windows (WebView2), the user agent contains "Windows NT"
const isWindows = navigator.userAgent.includes('Windows')

async function onMouseDown(e: MouseEvent) {
  if (e.button === 0 && !(e.target as HTMLElement).closest('button')) {
    await win.startDragging()
  }
}

const syncIconTitle = computed(() => {
  switch (syncStatus.state) {
    case 'syncing': return '正在同步…'
    case 'done':    return '同步完成'
    case 'error':   return `同步失败：${syncStatus.lastError ?? '未知错误'}（点击重试）`
    case 'not_configured': return '未配置后端'
    default:
      if (syncStatus.lastError) return `上次同步失败：${syncStatus.lastError}（点击重试）`
      return '后端已连接'
  }
})

const showStatusText = ref(false)
const statusText = computed(() => {
  if (syncStatus.state === 'syncing') {
    if (syncStatus.currentAction) {
      return syncStatus.currentAction
    }
    if (syncStatus.currentModule) {
      return `正在同步：${syncStatus.currentModule}`
    }
    return '正在同步…'
  }
  if (syncStatus.state === 'done') return '同步完成'
  if (syncStatus.state === 'error' || syncStatus.lastError) {
    return `同步失败：${syncStatus.lastError ?? '未知错误'}`
  }
  return ''
})

const cloudSrc = computed(() => {
  switch (syncStatus.state) {
    case 'syncing': return cloudBlue
    case 'done':    return cloudGreen
    case 'error':   return cloudRed
    default:        return syncStatus.lastError ? cloudRed : cloudGray
  }
})

let _hideTimer: ReturnType<typeof setTimeout> | null = null
watch(() => syncStatus.state, (state) => {
  if (state === 'syncing') {
    showStatusText.value = true
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null }
  } else if (state === 'done') {
    showStatusText.value = true
    if (_hideTimer) clearTimeout(_hideTimer)
    if (!syncStatus.lastError) {
      _hideTimer = setTimeout(() => { showStatusText.value = false }, 3000)
    }
  } else if (state === 'error') {
    showStatusText.value = true
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null }
  } else if (state === 'idle') {
    showStatusText.value = !!syncStatus.lastError
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null }
  }
}, { immediate: true })
</script>

<template>
  <div class="titlebar" @mousedown="onMouseDown">
    <!-- Panel toggle -->
    <button
      class="panel-toggle-btn"
      :class="{ active: panelVisible }"
      @click="emit('toggle')"
    >
      <img :src="sidebarIcon" class="sidebar-toggle-icon" :class="{ active: panelVisible }" alt="" />
    </button>

    <!-- Sync status -->
    <button
      class="titlebar-sync-btn"
      :class="syncStatus.state"
      :title="syncIconTitle"
      @click="tryNewSync().catch(() => {})"
    >
      <img :src="cloudSrc" class="titlebar-cloud-icon" alt="" />
      <Loader2 v-if="syncStatus.state === 'syncing'" :size="10" :stroke-width="3" class="ts-inner-spin" />
      <Check v-else-if="syncStatus.state === 'done'" :size="11" :stroke-width="3.5" class="ts-inner-check" />
    </button>
    <transition name="fade">
      <span v-if="showStatusText && statusText" class="titlebar-sync-text">{{ statusText }}</span>
    </transition>

    <!-- Drag spacer -->
    <div class="drag-spacer" />

    <!-- Windows custom window controls (macOS gets OS-native traffic lights) -->
    <div v-if="isWindows" class="win-controls">
      <button class="win-btn" title="最小化" @mousedown.stop @click="win.minimize()">
        <Minus :size="12" />
      </button>
      <button class="win-btn" title="最大化 / 还原" @mousedown.stop @click="win.toggleMaximize()">
        <Square :size="10" />
      </button>
      <button class="win-btn close-btn" title="关闭" @mousedown.stop @click="win.close()">
        <X :size="12" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  height: 44px;
  width: 100%;
  display: flex;
  align-items: center;
  padding: 0 12px;
  flex-shrink: 0;
  user-select: none;
  cursor: default;
  background: #ffffff;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.drag-spacer { flex: 1; }

.panel-toggle-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: #8e8e93;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.panel-toggle-btn:hover { background: rgba(0, 0, 0, 0.07); }

.sidebar-toggle-icon {
  width: 27px;
  height: 27px;
  opacity: 0.5;
  transition: opacity 0.12s;
}
.panel-toggle-btn:hover .sidebar-toggle-icon {
  opacity: 0.75;
}
.sidebar-toggle-icon.active {
  opacity: 0.85;
}

.titlebar-cloud-icon {
  width: 27px;
  height: 27px;
  transition: opacity 0.12s;
}

/* ─── Titlebar sync button ─────────────────────────────────────────────────── */
.titlebar-sync-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: #8e8e93;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  position: relative;
  margin-left: 2px;
  flex-shrink: 0;
}
.titlebar-sync-btn:hover { background: rgba(0, 0, 0, 0.07); }
.titlebar-sync-btn.syncing { color: #223F79; }
.titlebar-sync-btn.done   { color: #34c759; }
.titlebar-sync-btn.error  { color: #ff3b30; }

.ts-inner-spin {
  position: absolute;
  left: 10px;
  animation: ts-spin 0.8s linear infinite;
}
.ts-inner-check {
  position: absolute;
  left: 10px;
}
@keyframes ts-spin {
  to { transform: rotate(360deg); }
}

.titlebar-sync-text {
  font-size: 11px;
  color: #8e8e93;
  margin-left: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ─── Windows window controls ──────────────────────────────────────────────── */

.win-controls {
  display: flex;
  align-items: stretch;
  margin-right: -12px;
}

.win-btn {
  width: 46px;
  height: 44px;
  border: none;
  background: transparent;
  color: #3c3c43;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}

.win-btn:hover { background: rgba(0, 0, 0, 0.08); }

.win-btn.close-btn:hover {
  background: #c42b1c;
  color: white;
}
</style>
