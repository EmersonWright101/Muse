<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useChatStore } from '../../stores/chat'
import ChatPanel from './ChatPanel.vue'

const route = useRoute()
const chat = useChatStore()

const convId = computed(() => {
  const id = route.query.convId
  return typeof id === 'string' ? id : null
})

const isMac = navigator.userAgent.toLowerCase().includes('macintosh')

// Update window title when the conversation's title changes.
// Watch the conversations list (updated after every save / AI title-gen)
// rather than activeConv, which is global state shared with the main window.
const convTitle = computed(() =>
  chat.conversations.find(c => c.id === convId.value)?.title
)

watch(convTitle, async (title) => {
  if (title) {
    document.title = title + ' — Muse'
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      await win.setTitle(title + ' — Muse')
    } catch {
      // Not running in Tauri (e.g. browser dev mode)
    }
  }
}, { immediate: true })
</script>

<template>
  <div class="chat-window" :class="{ 'mac-overlay': isMac }">
    <!-- Drag region for macOS traffic-light area -->
    <div v-if="isMac" class="drag-region" data-tauri-drag-region />
    <ChatPanel
      v-if="convId"
      panel-key="window"
      :window-conv-id="convId"
    />
    <div v-else class="no-conv">
      <p>未指定对话</p>
    </div>
  </div>
</template>

<style scoped>
.chat-window {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #ffffff;
}

.chat-window.mac-overlay {
  padding-top: 28px;
  position: relative;
}

.drag-region {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 28px;
  z-index: 100;
}

.no-conv {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8e8e93;
}
</style>
