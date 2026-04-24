<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window'
import { PanelLeft, Minus, Square, X } from 'lucide-vue-next'

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
</script>

<template>
  <div class="titlebar" @mousedown="onMouseDown">
    <!-- Panel toggle -->
    <button
      class="panel-toggle-btn"
      :class="{ active: panelVisible }"
      @click="emit('toggle')"
    >
      <PanelLeft :size="18" />
    </button>

    <!-- Drag spacer -->
    <div class="drag-spacer" />

    <!-- Windows custom window controls (macOS gets OS-native traffic lights) -->
    <div v-if="isWindows" class="win-controls">
      <button class="win-btn" title="最小化" @click="win.minimize()">
        <Minus :size="12" />
      </button>
      <button class="win-btn" title="最大化 / 还原" @click="win.toggleMaximize()">
        <Square :size="10" />
      </button>
      <button class="win-btn close-btn" title="关闭" @click="win.close()">
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

.panel-toggle-btn:hover { background: rgba(0, 0, 0, 0.07); color: #1c1c1e; }
.panel-toggle-btn.active { color: #1c1c1e; }

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
