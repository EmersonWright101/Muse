<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, SquarePen, Trash2, ListChecks, X, Pin, Plus, Pencil, ChevronDown } from 'lucide-vue-next'
import { useChatStore }       from '../../stores/chat'
import { useAssistantsStore, ASSISTANT_COLORS } from '../../stores/assistants'
import type { Assistant }     from '../../stores/assistants'

const { t } = useI18n()
const chat       = useChatStore()
const assistants = useAssistantsStore()

// ─── Conversation filter ───────────────────────────────────────────────────────

const searchQuery        = ref('')
const filterAssistantId  = ref<string | null>(null)

// Assistant picker dropdown
const pickerOpen = ref(false)
const pickerRoot = ref<HTMLElement>()

function handlePickerOutside(e: MouseEvent) {
  if (pickerRoot.value && !pickerRoot.value.contains(e.target as Node)) pickerOpen.value = false
}

onMounted(()  => document.addEventListener('mousedown', handlePickerOutside))
onUnmounted(() => document.removeEventListener('mousedown', handlePickerOutside))

function selectFilter(id: string | null) {
  filterAssistantId.value = id
  pickerOpen.value = false
}

const activeFilterLabel = computed(() => {
  if (filterAssistantId.value === null) return null
  return assistants.assistants.find(a => a.id === filterAssistantId.value) ?? null
})

const filtered = computed(() => {
  let list = chat.conversations
  if (filterAssistantId.value !== null) {
    list = list.filter(c => c.assistantId === filterAssistantId.value)
  }
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return list
  return list.filter(c =>
    c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q),
  )
})

function assistantColor(id: string): string {
  return assistants.assistants.find(a => a.id === id)?.color ?? '#aeaeb2'
}

function assistantShortName(id: string): string {
  const name = assistants.assistants.find(a => a.id === id)?.name ?? ''
  return name.length > 5 ? name.slice(0, 5) : name
}

// ─── Rename ───────────────────────────────────────────────────────────────────

const renamingId  = ref<string | null>(null)
const renameInput = ref('')

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

// ─── Title truncation ────────────────────────────────────────────────────────

function truncateTitle(title: string, max = 12): string {
  return title.length > max ? title.slice(0, max) + '…' : title
}

// ─── Time formatting ──────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  const d   = new Date(iso)
  const now = new Date()
  const days = Math.floor((now.getTime() - d.getTime()) / 86400_000)
  if (days === 0) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return t('common.yesterday')
  if (days < 7)   return `周${['日', '一', '二', '三', '四', '五', '六'][d.getDay()]}`
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

// ─── Click item ───────────────────────────────────────────────────────────────

function clickItem(id: string) {
  if (chat.batchMode) {
    chat.toggleSelect(id)
  } else {
    chat.openConversation(id)
  }
}

// ─── New conversation ─────────────────────────────────────────────────────────

function handleNewChat() {
  chat.newConversation(undefined, undefined, filterAssistantId.value ?? undefined)
}

// ─── Assistant form ───────────────────────────────────────────────────────────

const showForm      = ref(false)
const editingId     = ref<string | null>(null)
const formName      = ref('')
const formPrompt    = ref('')
const formColor     = ref(ASSISTANT_COLORS[0])
const formNameInput = ref<HTMLInputElement>()

function openCreate() {
  editingId.value  = null
  formName.value   = ''
  formPrompt.value = ''
  formColor.value  = ASSISTANT_COLORS[0]
  showForm.value   = true
  nextTick(() => formNameInput.value?.focus())
}

function openEdit(a: Assistant) {
  editingId.value  = a.id
  formName.value   = a.name
  formPrompt.value = a.systemPrompt
  formColor.value  = a.color
  showForm.value   = true
  nextTick(() => formNameInput.value?.focus())
}

function cancelForm() {
  showForm.value = false
}

async function saveForm() {
  if (!formName.value.trim()) return
  if (editingId.value) {
    await assistants.update(editingId.value, formName.value, formPrompt.value, formColor.value)
  } else {
    await assistants.create(formName.value, formPrompt.value, formColor.value)
  }
  showForm.value = false
}

async function removeAssistant(id: string) {
  if (filterAssistantId.value === id) filterAssistantId.value = null
  await assistants.remove(id)
}
</script>

<template>
  <div class="chat-sidebar">
    <!-- Header -->
    <div class="panel-header">
      <div ref="pickerRoot" class="assistant-picker">
        <button class="picker-btn" @click="pickerOpen = !pickerOpen">
          <span v-if="activeFilterLabel" class="picker-dot" :style="{ background: activeFilterLabel.color }" />
          <span class="picker-label">{{ activeFilterLabel?.name ?? '全部对话' }}</span>
          <ChevronDown :size="11" class="picker-chevron" :class="{ rotated: pickerOpen }" />
        </button>
        <Transition name="picker-drop">
          <div v-if="pickerOpen" class="picker-dropdown">
            <button
              class="picker-item"
              :class="{ active: filterAssistantId === null }"
              @click="selectFilter(null)"
            >
              <span class="picker-item-dot all" />
              <span class="picker-item-name">全部对话</span>
            </button>
            <div v-if="assistants.assistants.length" class="picker-divider" />
            <div v-for="a in assistants.assistants" :key="a.id" class="picker-item-row">
              <button
                class="picker-item"
                :class="{ active: filterAssistantId === a.id }"
                @click="selectFilter(a.id)"
              >
                <span class="picker-item-dot" :style="{ background: a.color }" />
                <span class="picker-item-name">{{ a.name }}</span>
              </button>
              <button class="picker-edit" :title="'编辑 ' + a.name" @click.stop="openEdit(a)">
                <Pencil :size="10" />
              </button>
            </div>
            <div class="picker-divider" />
            <button class="picker-item add-item" @click="pickerOpen = false; openCreate()">
              <Plus :size="12" class="picker-add-icon" />
              <span class="picker-item-name">新建助手</span>
            </button>
          </div>
        </Transition>
      </div>

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
          <ListChecks :size="14" />
        </button>
        <button class="icon-btn" :title="t('chat.newChat')" @click="handleNewChat()">
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

        <!-- Assistant name tag (shown in "全部" view) -->
        <span
          v-else-if="!chat.batchMode && conv.assistantId && filterAssistantId === null"
          class="assistant-tag"
          :style="{ background: assistantColor(conv.assistantId) }"
        >{{ assistantShortName(conv.assistantId) }}</span>

        <!-- Streaming indicator dot -->
        <div v-if="chat.streamingConvIds.has(conv.id)" class="streaming-dot" />

        <div class="item-content">
          <input
            v-if="renamingId === conv.id"
            v-model="renameInput"
            class="rename-input"
            @blur="finishRename(conv.id)"
            @keydown="handleRenameKeydown($event, conv.id)"
            @click.stop
            autofocus
          />
          <span v-else class="item-title">{{ truncateTitle(conv.title) }}</span>
        </div>

        <!-- Right side: time fades out, actions fade in on hover -->
        <div v-if="!chat.batchMode" class="item-right">
          <span class="item-time">{{ formatTime(conv.updatedAt) }}</span>
          <div class="item-actions">
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

    <!-- Assistant form overlay -->
    <Transition name="form-fade">
      <div v-if="showForm" class="form-overlay" @click.self="cancelForm()">
        <div class="form-panel">
          <div class="form-header">
            <span class="form-title">{{ editingId ? '编辑助手' : '新建助手' }}</span>
            <button v-if="editingId" class="form-delete-btn" title="删除助手" @click="removeAssistant(editingId!)">
              <Trash2 :size="12" />
            </button>
          </div>

          <label class="form-label">名称</label>
          <input
            ref="formNameInput"
            v-model="formName"
            class="form-input"
            placeholder="助手名称"
            @keydown.enter="saveForm()"
            @keydown.esc="cancelForm()"
          />

          <label class="form-label">标识颜色</label>
          <div class="color-row">
            <button
              v-for="c in ASSISTANT_COLORS"
              :key="c"
              class="color-dot"
              :class="{ selected: formColor === c }"
              :style="{ background: c }"
              @click="formColor = c"
            />
          </div>

          <label class="form-label">System Prompt</label>
          <textarea
            v-model="formPrompt"
            class="form-textarea"
            placeholder="请输入助手的 system prompt，用于定义角色和行为…"
            rows="5"
          />

          <div class="form-actions">
            <button class="form-btn cancel" @click="cancelForm()">取消</button>
            <button class="form-btn save" :disabled="!formName.trim()" @click="saveForm()">保存</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.chat-sidebar {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: rgba(228, 228, 232, 0.88);
  backdrop-filter: blur(40px) saturate(1.8);
  -webkit-backdrop-filter: blur(40px) saturate(1.8);
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.10), 0 0 0 0.5px rgba(255, 255, 255, 0.6) inset;
  position: relative;
}

/* ─── Header ──────────────────────────────────────────────────────────────── */

.panel-header {
  height: 48px;
  padding: 0 10px 0 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
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

/* ─── Assistant picker dropdown ───────────────────────────────────────────── */

.assistant-picker {
  position: relative;
  flex: 1;
  min-width: 0;
}

.picker-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px 0 6px;
  border: none;
  background: transparent;
  border-radius: 7px;
  cursor: pointer;
  max-width: 160px;
  transition: background 0.12s;
}

.picker-btn:hover { background: rgba(0, 0, 0, 0.06); }

.picker-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.picker-label {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.picker-chevron {
  color: #8e8e93;
  flex-shrink: 0;
  transition: transform 0.15s;
}

.picker-chevron.rotated { transform: rotate(180deg); }

.picker-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 180px;
  background: rgba(250, 250, 252, 0.96);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  padding: 5px;
  z-index: 50;
}

.picker-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.07);
  margin: 4px 4px;
}

.picker-item-row {
  display: flex;
  align-items: center;
  border-radius: 7px;
  overflow: hidden;
}

.picker-item-row:hover .picker-edit { opacity: 1; }

.picker-item {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  padding: 6px 8px;
  border: none;
  background: transparent;
  border-radius: 7px;
  cursor: pointer;
  text-align: left;
  transition: background 0.10s;
}

.picker-item:hover { background: rgba(0, 0, 0, 0.05); }
.picker-item.active { background: rgba(34, 63, 121, 0.08); }
.picker-item.active .picker-item-name { color: #223F79; }

.picker-item-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.picker-item-dot.all {
  background: #aeaeb2;
}

.picker-item-name {
  font-size: 12.5px;
  font-weight: 500;
  color: #1c1c1e;
}

.picker-edit {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: #8e8e93;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s;
  margin-right: 3px;
}

.picker-edit:hover { background: rgba(0, 0, 0, 0.07); color: #3c3c43; }

.add-item { color: #8e8e93; }
.add-item .picker-item-name { color: #8e8e93; font-weight: 400; }
.add-item:hover .picker-item-name { color: #3c3c43; }

.picker-add-icon { color: #8e8e93; flex-shrink: 0; }

/* Transition */
.picker-drop-enter-active, .picker-drop-leave-active {
  transition: opacity 0.12s, transform 0.12s;
}
.picker-drop-enter-from, .picker-drop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ─── Batch bar ───────────────────────────────────────────────────────────── */

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

/* ─── Search ──────────────────────────────────────────────────────────────── */

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

/* ─── List ────────────────────────────────────────────────────────────────── */

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

.assistant-tag {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 600;
  color: white;
  white-space: nowrap;
  letter-spacing: 0.01em;
  line-height: 16px;
}

.item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.item-title {
  font-size: 13px;
  font-weight: 500;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.list-item.active .item-title { color: #223F79; }

.item-right {
  position: relative;
  flex-shrink: 0;
  width: 70px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.item-time {
  font-size: 10px;
  color: #8e8e93;
  white-space: nowrap;
  transition: opacity 0.12s;
}

.list-item:hover .item-time { opacity: 0; }

.streaming-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #30d158;
  flex-shrink: 0;
  animation: stream-pulse 1.2s ease-in-out infinite;
}

@keyframes stream-pulse {
  0%, 100% { opacity: 1;   transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(0.7); }
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
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
}

.list-item:hover .item-actions {
  opacity: 1;
  pointer-events: auto;
}

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

/* ─── Assistant form overlay ──────────────────────────────────────────────── */

.form-overlay {
  position: absolute;
  inset: 0;
  background: rgba(235, 235, 235, 0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: flex-end;
  z-index: 10;
}

.form-panel {
  width: 100%;
  background: rgba(248, 248, 250, 0.98);
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px 12px 0 0;
  padding: 16px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.10);
}

.form-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.form-title {
  font-size: 13px;
  font-weight: 600;
  color: #1c1c1e;
}

.form-delete-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: #ff3b30;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s;
}

.form-delete-btn:hover { background: rgba(255, 59, 48, 0.08); }

.form-label {
  font-size: 11px;
  font-weight: 500;
  color: #8e8e93;
  letter-spacing: 0.02em;
  margin-top: 2px;
}

.form-input {
  height: 30px;
  border: 1.5px solid rgba(0, 0, 0, 0.10);
  border-radius: 7px;
  padding: 0 10px;
  font-size: 13px;
  color: #1c1c1e;
  background: white;
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
}

.form-input:focus { border-color: rgba(34, 63, 121, 0.4); }

.color-row {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}

.color-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.12s, border-color 0.12s;
  flex-shrink: 0;
}

.color-dot:hover { transform: scale(1.15); }

.color-dot.selected {
  border-color: white;
  box-shadow: 0 0 0 2px currentColor, 0 0 0 3px rgba(0, 0, 0, 0.15);
}

.form-textarea {
  border: 1.5px solid rgba(0, 0, 0, 0.10);
  border-radius: 7px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.55;
  color: #1c1c1e;
  background: white;
  outline: none;
  resize: none;
  font-family: inherit;
  transition: border-color 0.15s;
}

.form-textarea:focus { border-color: rgba(34, 63, 121, 0.4); }
.form-textarea::placeholder { color: #aeaeb2; }

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.form-btn {
  flex: 1;
  height: 32px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.12s;
}

.form-btn.cancel {
  background: rgba(0, 0, 0, 0.07);
  color: #3c3c43;
}

.form-btn.cancel:hover { background: rgba(0, 0, 0, 0.10); }

.form-btn.save {
  background: #223F79;
  color: white;
}

.form-btn.save:hover { opacity: 0.88; }
.form-btn.save:disabled { opacity: 0.35; cursor: not-allowed; }

/* ─── Form transition ─────────────────────────────────────────────────────── */

.form-fade-enter-active,
.form-fade-leave-active {
  transition: opacity 0.18s;
}

.form-fade-enter-active .form-panel,
.form-fade-leave-active .form-panel {
  transition: transform 0.18s;
}

.form-fade-enter-from,
.form-fade-leave-to {
  opacity: 0;
}

.form-fade-enter-from .form-panel,
.form-fade-leave-to .form-panel {
  transform: translateY(24px);
}
</style>
