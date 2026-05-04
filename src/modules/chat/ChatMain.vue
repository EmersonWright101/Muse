<script setup lang="ts">
import { computed } from 'vue'
import { useChatStore } from '../../stores/chat'
import ChatPanel from './ChatPanel.vue'

const chat = useChatStore()

const showRightPanel = computed(() => chat.splitView && !!chat.secondaryActiveConvId)
</script>

<template>
  <div class="chat-main">
    <!-- Conversation panels -->
    <div class="panels-container" :class="{ split: chat.splitView }">
      <ChatPanel panel-key="left" class="panel left-panel" />
      <ChatPanel
        v-if="showRightPanel"
        panel-key="right"
        class="panel right-panel"
      />
      <!-- Empty right panel placeholder when split is on but no secondary conv selected -->
      <div v-else-if="chat.splitView" class="panel right-panel empty-right">
        <div class="empty-right-content">
          <p class="empty-right-title">选择右侧对话</p>
          <p class="empty-right-hint">从左侧侧边栏选择一个对话在右侧显示</p>
        </div>
      </div>
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

.panels-container {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-width: 0;
  overflow: hidden;
}

.panels-container.split .panel {
  flex: 1;
  width: 50%;
}

.panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.right-panel {
  border-left: 1px solid rgba(0, 0, 0, 0.06);
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
