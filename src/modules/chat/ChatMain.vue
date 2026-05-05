<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import { ArrowLeftRight } from 'lucide-vue-next'
import { useChatStore } from '../../stores/chat'
import ChatPanel from './ChatPanel.vue'

const chat = useChatStore()

const showRightPanel = computed(() => chat.splitView && !!chat.secondaryActiveConvId)

// Resizable split
const leftPercent = ref(50)
const isDragging = ref(false)
let _startX = 0
let _startPercent = 0
let _containerWidth = 0

function onDividerMousedown(e: MouseEvent) {
  const container = document.querySelector('.panels-container') as HTMLElement
  if (!container) return
  _containerWidth = container.offsetWidth
  _startX = e.clientX
  _startPercent = leftPercent.value
  isDragging.value = true
  document.addEventListener('mousemove', onMousemove)
  document.addEventListener('mouseup', onMouseup)
  e.preventDefault()
}

function onMousemove(e: MouseEvent) {
  if (!isDragging.value) return
  const delta = e.clientX - _startX
  leftPercent.value = Math.max(20, Math.min(80, _startPercent + (delta / _containerWidth) * 100))
}

function onMouseup() {
  isDragging.value = false
  document.removeEventListener('mousemove', onMousemove)
  document.removeEventListener('mouseup', onMouseup)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onMousemove)
  document.removeEventListener('mouseup', onMouseup)
})
</script>

<template>
  <div class="chat-main" :class="{ 'is-dragging': isDragging }">
    <div class="panels-container" :class="{ split: chat.splitView }">
      <ChatPanel
        panel-key="left"
        class="panel left-panel"
        :style="chat.splitView ? { flex: 'none', width: leftPercent + '%' } : {}"
      />
      <template v-if="chat.splitView">
        <!-- Draggable divider with swap button -->
        <div
          class="split-divider"
          :class="{ dragging: isDragging }"
          @mousedown="onDividerMousedown"
        >
          <button
            v-if="showRightPanel"
            class="swap-btn"
            title="互换左右面板"
            @mousedown.stop
            @click.stop="chat.swapPanels()"
          >
            <ArrowLeftRight :size="11" />
          </button>
        </div>

        <ChatPanel
          v-if="showRightPanel"
          panel-key="right"
          class="panel right-panel"
        />
        <div v-else class="panel right-panel empty-right">
          <div class="empty-right-content">
            <p class="empty-right-title">选择右侧对话</p>
            <p class="empty-right-hint">从左侧侧边栏选择一个对话在右侧显示</p>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.chat-main {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: row;
  background: #ffffff;
  min-width: 0;
  overflow: hidden;
}

.chat-main.is-dragging {
  user-select: none;
  cursor: col-resize;
}

.panels-container {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-width: 0;
  overflow: hidden;
}

.panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.right-panel {
  flex: 1;
}

.split-divider {
  width: 5px;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.06);
  cursor: col-resize;
  transition: background 0.15s;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.split-divider:hover,
.split-divider.dragging {
  background: rgba(34, 63, 121, 0.25);
}

.swap-btn {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid rgba(34, 63, 121, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #223F79;
  opacity: 0;
  transition: opacity 0.15s, background 0.1s;
  z-index: 10;
  padding: 0;
}

.split-divider:hover .swap-btn {
  opacity: 1;
}

.swap-btn:hover {
  background: rgba(34, 63, 121, 0.08);
}

.empty-right {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fafafa;
}

.empty-right-content {
  text-align: center;
  color: #8e8e93;
  padding: 40px;
}

.empty-right-title {
  font-size: 16px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0 0 8px;
}

.empty-right-hint {
  font-size: 13px;
  margin: 0;
}
</style>
