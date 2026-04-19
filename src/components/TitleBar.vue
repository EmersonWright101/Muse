<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window'
import { PanelLeft } from 'lucide-vue-next'

defineProps<{ panelVisible: boolean }>()
const emit = defineEmits<{ toggle: [] }>()

const win = getCurrentWindow()

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

.panel-toggle-btn:hover {
  background: rgba(0, 0, 0, 0.07);
  color: #1c1c1e;
}

.panel-toggle-btn.active {
  color: #1c1c1e;
}
</style>
