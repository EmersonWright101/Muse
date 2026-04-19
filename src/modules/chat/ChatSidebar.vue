<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, SquarePen, Trash2, CheckSquare, Square, X, Pin } from 'lucide-vue-next'
import { useChatStore } from '../../stores/chat'

const { t } = useI18n()
const chat  = useChatStore()

const searchQuery  = ref('')
const renamingId   = ref<string | null>(null)
const renameInput  = ref('')

const filtered = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return chat.conversations
  return chat.conversations.filter(c =>
    c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q),
  )
})

function formatTime(iso: string): string {
  const d   = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / 86400_000)
  if (days === 0) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return t('common.yesterday')
  if (days < 7)   return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()] ? `周${['日', '一', '二', '三', '四', '五', '六'][d.getDay()]}` : '上周'
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function clickItem(id: string) {
  if (chat.batchMode) {
    chat.toggleSelect(id)
  } else {
    chat.openConversation(id)
  }
}

function startRename(id: string, title: string) {
  renamingId.value  = id
  renameInput.value = title
}

async function finishRename(id: string) {
  if (renameInput.value.trim()) {
    await chat.renameConversation(id, renameInput.value.trim())
  }
  renamingId.value = null
}

function handleRenameKeydown(e: KeyboardEvent, id: string) {
  if (e.key === 'Enter') finishRename(id)
  if (e.key === 'Escape') renamingId.value = null
}
</script>

<template>
  <div class="chat-sidebar">
    <!-- Header -->
    <div class="panel-header">
      <h2 class="panel-title">{{ t('chat.title') }}</h2>
      <div class="header-actions">
        <button
          v-if="chat.batchMode"
          class="icon-btn danger"
          :title="t('common.delete')"
          :disabled="chat.selectedConvIds.size === 0"
          @click="chat.deleteBatch()"
        >
          <Trash2 :size="14" />
        </button>
        <button
          class="icon-btn"
          :class="{ active: chat.batchMode }"
          :title="chat.batchMode ? '退出选择' : '批量选择'"
          @click="chat.toggleBatchMode()"
        >
          <CheckSquare v-if="chat.batchMode" :size="14" />
          <Square v-else :size="14" />
        </button>
        <button class="icon-btn" :title="t('chat.newChat')" @click="chat.newConversation()">
          <SquarePen :size="14" />
        </button>
      </div>
    </div>

    <!-- Batch mode bar -->
    <div v-if="chat.batchMode" class="batch-bar">
      <span class="batch-count">已选 {{ chat.selectedConvIds.size }} 项</span>
      <button class="link-btn" @click="chat.selectAll()">全选</button>
      <button class="link-btn" @click="chat.clearSelection()">取消</button>
    </div>

    <!-- Search -->
    <div class="search-bar">
      <Search :size="13" class="search-icon" />
      <input
        v-model="searchQuery"
        class="search-input"
        :placeholder="t('chat.search')"
        type="text"
      />
      <button v-if="searchQuery" class="clear-btn" @click="searchQuery = ''">
        <X :size="11" />
      </button>
    </div>

    <!-- Conversation list -->
    <div class="list-scroll">
      <div v-if="filtered.length === 0" class="empty-state">
        {{ searchQuery ? '没有匹配的对话' : '还没有对话' }}
      </div>

      <div
        v-for="conv in filtered"
        :key="conv.id"
        class="list-item"
        :class="{
          active:   chat.activeConvId === conv.id && !chat.batchMode,
          selected: chat.batchMode && chat.selectedConvIds.has(conv.id),
          pinned:   conv.pinned,
        }"
        @click="clickItem(conv.id)"
      >
        <!-- Batch checkbox -->
        <div v-if="chat.batchMode" class="item-check">
          <div class="check-box" :class="{ checked: chat.selectedConvIds.has(conv.id) }">
            <svg v-if="chat.selectedConvIds.has(conv.id)" width="10" height="10" viewBox="0 0 10 10">
              <polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
        </div>

        <!-- Pin indicator -->
        <div v-if="conv.pinned && !chat.batchMode" class="pin-dot">
          <Pin :size="9" />
        </div>

        <div class="item-content">
          <!-- Title row -->
          <div class="item-header">
            <input
              v-if="renamingId === conv.id"
              v-model="renameInput"
              class="rename-input"
              @blur="finishRename(conv.id)"
              @keydown="handleRenameKeydown($event, conv.id)"
              @click.stop
              autofocus
            />
            <span v-else class="item-title">{{ conv.title }}</span>
            <span class="item-time">{{ formatTime(conv.updatedAt) }}</span>
          </div>
          <!-- Preview -->
          <div class="item-preview">{{ conv.preview }}</div>
        </div>

        <!-- Hover actions (non-batch mode) -->
        <div v-if="!chat.batchMode" class="item-actions">
          <button
            class="action-btn"
            :title="conv.pinned ? '取消置顶' : '置顶'"
            @click.stop="chat.togglePin(conv.id)"
          >
            <Pin :size="11" />
          </button>
          <button
            class="action-btn"
            title="重命名"
            @click.stop="startRename(conv.id, conv.title)"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button
            class="action-btn danger"
            :title="t('common.delete')"
            @click.stop="chat.deleteOne(conv.id)"
          >
            <Trash2 :size="11" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-sidebar {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: rgba(235, 235, 235, 0.85);
  backdrop-filter: blur(40px) saturate(1.8);
  -webkit-backdrop-filter: blur(40px) saturate(1.8);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.10), 0 0 0 0.5px rgba(255, 255, 255, 0.6) inset;
}

.panel-header {
  height: 48px;
  padding: 0 10px 0 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 2px;
  align-items: center;
}

.icon-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #8e8e93;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.icon-btn:hover { background: rgba(0, 0, 0, 0.06); color: #3c3c43; }
.icon-btn.active { background: rgba(34, 63, 121, 0.10); color: #223F79; }
.icon-btn.danger:hover { background: rgba(255, 59, 48, 0.08); color: #ff3b30; }
.icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.batch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(34, 63, 121, 0.05);
  font-size: 12px;
  flex-shrink: 0;
}

.batch-count { color: #3c3c43; flex: 1; }

.link-btn {
  background: none;
  border: none;
  color: #223F79;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.search-bar {
  margin: 8px 10px;
  height: 28px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 7px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  gap: 6px;
  flex-shrink: 0;
}

.search-icon { color: #8e8e93; flex-shrink: 0; }

.search-input {
  border: none;
  background: transparent;
  color: #1c1c1e;
  font-size: 12px;
  width: 100%;
  outline: none;
}

.search-input::placeholder { color: #8e8e93; }

.clear-btn {
  border: none;
  background: none;
  color: #8e8e93;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
}

.list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 4px 6px 8px;
}

.list-scroll::-webkit-scrollbar { width: 3px; }
.list-scroll::-webkit-scrollbar-track { background: transparent; }
.list-scroll::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.10); border-radius: 2px; }

.empty-state {
  text-align: center;
  padding: 32px 12px;
  font-size: 12px;
  color: #aeaeb2;
}

.list-item {
  padding: 8px 8px 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s;
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
}

.list-item:hover { background: rgba(0, 0, 0, 0.05); }
.list-item.active { background: rgba(34, 63, 121, 0.10); }
.list-item.selected { background: rgba(34, 63, 121, 0.08); }

.item-check { flex-shrink: 0; }

.check-box {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1.5px solid rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
}

.check-box.checked {
  background: #223F79;
  border-color: #223F79;
}

.pin-dot {
  flex-shrink: 0;
  color: #223F79;
  opacity: 0.5;
  display: flex;
  align-items: center;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 2px;
}

.item-title {
  font-size: 13px;
  font-weight: 500;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.list-item.active .item-title { color: #223F79; }

.item-time {
  font-size: 10px;
  color: #8e8e93;
  flex-shrink: 0;
}

.item-preview {
  font-size: 11px;
  color: #8e8e93;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rename-input {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid rgba(34, 63, 121, 0.4);
  border-radius: 4px;
  padding: 1px 4px;
  background: white;
  color: #1c1c1e;
  outline: none;
}

.item-actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}

.list-item:hover .item-actions { display: flex; }

.action-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: #8e8e93;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.action-btn:hover { background: rgba(0, 0, 0, 0.06); color: #3c3c43; }
.action-btn.danger:hover { background: rgba(255, 59, 48, 0.08); color: #ff3b30; }
</style>
