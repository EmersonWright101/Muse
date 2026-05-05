<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, SquarePen, Trash2, ListChecks, X, Pin, Plus, Pencil, ChevronDown, Download, RotateCcw, Check, Cpu } from 'lucide-vue-next'
import { useChatStore }       from '../../stores/chat'
import { useAssistantsStore, ASSISTANT_COLORS } from '../../stores/assistants'
import { useAiSettingsStore } from '../../stores/aiSettings'
import type { Assistant }     from '../../stores/assistants'
import { useChatExport, type ExportFilter } from '../../composables/useChatExport'

const { t } = useI18n()
const chat       = useChatStore()
const assistants = useAssistantsStore()
const aiSettings = useAiSettingsStore()

const configuredProviders = computed(() => aiSettings.configuredProviders())

const formModelSelection = computed({
  get() {
    if (formDefaultProviderId.value && formDefaultModelId.value) {
      return `${formDefaultProviderId.value}::${formDefaultModelId.value}`
    }
    return ''
  },
  set(val: string) {
    if (val) {
      const [pid, mid] = val.split('::')
      formDefaultProviderId.value = pid
      formDefaultModelId.value = mid
    } else {
      formDefaultProviderId.value = undefined
      formDefaultModelId.value = undefined
    }
  },
})

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

// ─── Conversation context menu ───────────────────────────────────────────────

const convMenuOpen   = ref(false)
const convMenuConvId = ref<string | null>(null)
const convMenuPos    = ref({ x: 0, y: 0 })

function openConvMenu(e: MouseEvent, convId: string) {
  if (chat.batchMode) return
  convMenuConvId.value = convId
  convMenuPos.value    = { x: e.clientX, y: e.clientY }
  convMenuOpen.value   = true
}

function closeConvMenu() {
  convMenuOpen.value = false
}

function convMenuRename() {
  const conv = chat.conversations.find(c => c.id === convMenuConvId.value)
  if (conv) startRename(conv.id, conv.title)
  closeConvMenu()
}

function convMenuDelete() {
  if (convMenuConvId.value) chat.deleteOne(convMenuConvId.value)
  closeConvMenu()
}

function convMenuOpenInRight() {
  if (convMenuConvId.value) {
    chat.openSecondaryConversation(convMenuConvId.value)
  }
  closeConvMenu()
}

function convMenuOpenInWindow() {
  if (convMenuConvId.value) {
    chat.openConversationWindow(convMenuConvId.value)
  }
  closeConvMenu()
}

// ─── Global default model picker ────────────────────────────────────────────

const globalModelPickerOpen = ref(false)
const globalModelPickerPos  = ref({ x: 0, y: 0 })

function openGlobalModelPicker(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  globalModelPickerPos.value = { x: rect.right, y: rect.top }
  globalModelPickerOpen.value = true
}

function closeGlobalModelPicker() {
  globalModelPickerOpen.value = false
}

function selectGlobalModel(providerId: string, modelId: string) {
  aiSettings.setDefaultModel(providerId, modelId)
  closeGlobalModelPicker()
}

function handleGlobalModelPickerOutside(e: MouseEvent) {
  const picker = document.querySelector('.global-model-picker-dropdown')
  if (picker && !picker.contains(e.target as Node)) {
    closeGlobalModelPicker()
  }
}

onMounted(()  => {
  document.addEventListener('click', closeConvMenu)
  document.addEventListener('click', handleGlobalModelPickerOutside)
})
onUnmounted(() => {
  document.removeEventListener('click', closeConvMenu)
  document.removeEventListener('click', handleGlobalModelPickerOutside)
})

// ─── Click item ───────────────────────────────────────────────────────────────

function clickItem(id: string) {
  if (chat.batchMode) {
    chat.toggleSelect(id)
  } else {
    chat.openInFocusedPanel(id)
  }
}

// ─── New conversation ─────────────────────────────────────────────────────────

function handleNewChat() {
  const assistantId = filterAssistantId.value ?? undefined
  let providerId: string | undefined
  let modelId: string | undefined
  if (assistantId) {
    const a = assistants.assistants.find(x => x.id === assistantId)
    if (a?.defaultProviderId && a?.defaultModelId) {
      providerId = a.defaultProviderId
      modelId = a.defaultModelId
    }
  }
  chat.newConversation(providerId, modelId, assistantId)
}

// ─── Assistant form ───────────────────────────────────────────────────────────

const showForm      = ref(false)
const editingId     = ref<string | null>(null)
const formName      = ref('')
const formPrompt    = ref('')
const formColor     = ref(ASSISTANT_COLORS[0])
const formDefaultProviderId = ref<string | undefined>(undefined)
const formDefaultModelId    = ref<string | undefined>(undefined)
const formNameInput = ref<HTMLInputElement>()

function openCreate() {
  editingId.value  = null
  formName.value   = ''
  formPrompt.value = ''
  formColor.value  = ASSISTANT_COLORS[0]
  formDefaultProviderId.value = undefined
  formDefaultModelId.value    = undefined
  showForm.value   = true
  nextTick(() => formNameInput.value?.focus())
}

function openEdit(a: Assistant) {
  editingId.value  = a.id
  formName.value   = a.name
  formPrompt.value = a.systemPrompt
  formColor.value  = a.color
  formDefaultProviderId.value = a.defaultProviderId
  formDefaultModelId.value    = a.defaultModelId
  showForm.value   = true
  nextTick(() => formNameInput.value?.focus())
}

function cancelForm() {
  showForm.value = false
}

async function saveForm() {
  if (!formName.value.trim()) return
  const dp = formDefaultProviderId.value
  const dm = formDefaultModelId.value
  if (editingId.value) {
    await assistants.update(editingId.value, formName.value, formPrompt.value, formColor.value, dp, dm)
  } else {
    await assistants.create(formName.value, formPrompt.value, formColor.value, dp, dm)
  }
  showForm.value = false
}

async function removeAssistant(id: string) {
  if (filterAssistantId.value === id) filterAssistantId.value = null
  await assistants.remove(id)
}

// ─── Export ───────────────────────────────────────────────────────────────────

const { exportChat, exporting, exportError } = useChatExport()
const exportOpen    = ref(false)
const exportRoot    = ref<HTMLElement>()
const exportSuccess = ref(false)

function handleExportOutside(e: MouseEvent) {
  if (exportRoot.value && !exportRoot.value.contains(e.target as Node)) exportOpen.value = false
}

onMounted(()  => document.addEventListener('mousedown', handleExportOutside))
onUnmounted(() => document.removeEventListener('mousedown', handleExportOutside))

async function doExport(filter: ExportFilter) {
  exportOpen.value = false
  await exportChat(filter)
  if (!exportError.value) {
    exportSuccess.value = true
    setTimeout(() => { exportSuccess.value = false }, 2000)
  }
}

// ─── Trash ────────────────────────────────────────────────────────────────────

const trashOpen = ref(false)

function daysUntilExpiry(deletedAt: string): number {
  const elapsed = Date.now() - new Date(deletedAt).getTime()
  return Math.max(1, 30 - Math.floor(elapsed / 86_400_000))
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
            <div class="picker-item-row">
              <button
                class="picker-item"
                :class="{ active: filterAssistantId === null }"
                @click="selectFilter(null)"
              >
                <span class="picker-item-dot all" />
                <span class="picker-item-name">全部对话</span>
              </button>
              <button
                class="picker-model-btn"
                title="设置全局默认模型"
                @click.stop="openGlobalModelPicker($event)"
              >
                <Cpu :size="10" />
                <span class="picker-model-label">默认模型</span>
              </button>
            </div>
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

        <!-- Export -->
        <div ref="exportRoot" class="export-picker">
          <button
            class="icon-btn"
            :class="{ active: exportOpen || exportSuccess }"
            :title="exporting ? '导出中…' : '导出对话数据'"
            :disabled="exporting"
            @click="exportOpen = !exportOpen"
          >
            <Download :size="14" />
          </button>
          <Transition name="picker-drop">
            <div v-if="exportOpen" class="export-dropdown">
              <div class="export-title">导出对话</div>
              <button class="export-item" @click="doExport('all')">
                <span class="export-item-icon">📄</span>
                <div class="export-item-info">
                  <span class="export-item-label">全部对话</span>
                  <span class="export-item-desc">导出所有消息及反馈</span>
                </div>
              </button>
              <button class="export-item" @click="doExport('positive')">
                <span class="export-item-icon">👍</span>
                <div class="export-item-info">
                  <span class="export-item-label">好评消息</span>
                  <span class="export-item-desc">仅导出标记为有帮助的对话</span>
                </div>
              </button>
              <button class="export-item" @click="doExport('negative')">
                <span class="export-item-icon">👎</span>
                <div class="export-item-info">
                  <span class="export-item-label">差评消息</span>
                  <span class="export-item-desc">仅导出标记为无帮助的对话</span>
                </div>
              </button>
              <div v-if="exportError" class="export-error">{{ exportError }}</div>
            </div>
          </Transition>
        </div>

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
          'secondary-active': chat.secondaryActiveConvId === conv.id && chat.splitView && !chat.batchMode,
          selected: chat.batchMode && chat.selectedConvIds.has(conv.id),
          pinned:   conv.pinned,
        }"
        @click="clickItem(conv.id)"
        @contextmenu.prevent="openConvMenu($event, conv.id)"
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

    <!-- Recently Deleted (fixed at bottom like travel notes) -->
    <div v-if="!searchQuery && filterAssistantId === null && chat.trashedConversations.length > 0" class="trash-section">
      <button class="trash-toggle" @click="trashOpen = !trashOpen">
        <ChevronDown :size="11" class="trash-chevron" :class="{ open: trashOpen }" />
        <Trash2 :size="11" class="trash-toggle-icon" />
        <span class="trash-toggle-label">最近删除</span>
        <span class="trash-count-badge">{{ chat.trashedConversations.length }}</span>
        <button
          v-if="trashOpen"
          class="trash-clear-btn"
          title="清空"
          @click.stop="chat.clearAllTrash()"
        >清空</button>
      </button>
      <div v-if="trashOpen" class="trash-list">
        <div
          v-for="item in chat.trashedConversations"
          :key="item.id"
          class="trash-item"
          @click="chat.openTrashPreview(item.id)"
        >
          <span class="trash-item-title" :title="item.title">{{ item.title.length > 16 ? item.title.slice(0, 16) + '…' : item.title }}</span>
          <span class="trash-item-days">{{ daysUntilExpiry(item.deletedAt) }}天</span>
          <div class="trash-item-actions">
            <button
              class="trash-action-btn restore-btn"
              title="恢复"
              @click.stop="chat.restoreFromTrash(item.id)"
            >
              <RotateCcw :size="11" />
            </button>
            <button
              class="trash-action-btn perm-delete-btn"
              title="永久删除"
              @click.stop="chat.permanentDeleteOne(item.id)"
            >
              <Trash2 :size="11" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Trash preview overlay -->
    <Teleport to="body">
      <Transition name="trash-preview-fade">
        <div v-if="chat.previewTrashedConv" class="trash-preview-overlay" @click.self="chat.closeTrashPreview()">
          <div class="trash-preview-panel">
            <div class="trash-preview-header">
              <span class="trash-preview-title">{{ chat.previewTrashedConv.title }}</span>
              <button class="trash-preview-close" @click="chat.closeTrashPreview()">
                <X :size="16" />
              </button>
            </div>
            <div class="trash-preview-body">
              <div
                v-for="msg in chat.previewTrashedConv.messages"
                :key="msg.id"
                class="trash-preview-msg"
                :class="{ user: msg.role === 'user', assistant: msg.role === 'assistant' }"
              >
                <div class="trash-preview-role">{{ msg.role === 'user' ? '用户' : 'AI' }}</div>
                <div class="trash-preview-content">{{ msg.content }}</div>
                <div v-if="msg.attachments?.length" class="trash-preview-attachments">
                  <span v-for="att in msg.attachments" :key="att.id" class="trash-preview-att">📎 {{ att.name }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

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

          <label class="form-label">默认模型（可选）</label>
          <select v-model="formModelSelection" class="form-input" style="height: 30px;">
            <option value="">使用全局默认模型</option>
            <optgroup v-for="p in configuredProviders" :key="p.id" :label="p.name">
              <option
                v-for="m in p.models"
                :key="m.id"
                :value="`${p.id}::${m.id}`"
              >
                {{ m.name }}
              </option>
            </optgroup>
          </select>

          <div class="form-actions">
            <button class="form-btn cancel" @click="cancelForm()">取消</button>
            <button class="form-btn save" :disabled="!formName.trim()" @click="saveForm()">保存</button>
          </div>
        </div>
      </div>
    </Transition>

  </div>

  <!-- Teleport outside backdrop-filter stacking context so position:fixed uses viewport coords -->
  <Teleport to="body">
    <div
      v-if="convMenuOpen"
      class="conv-context-menu"
      :style="{ left: convMenuPos.x + 'px', top: convMenuPos.y + 'px' }"
      @click.stop
    >
      <button class="conv-menu-item" @click="convMenuRename">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        <span>编辑话题名称</span>
      </button>
      <button v-if="convMenuConvId !== chat.activeConvId" class="conv-menu-item" @click="convMenuOpenInRight">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
        <span>在右侧打开</span>
      </button>
      <button class="conv-menu-item" @click="convMenuOpenInWindow">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h7"/></svg>
        <span>独立窗口显示</span>
      </button>
      <div class="conv-menu-divider" />
      <button class="conv-menu-item danger" @click="convMenuDelete">
        <Trash2 :size="13" />
        <span>删除对话</span>
      </button>
    </div>

    <!-- Global default model picker dropdown -->
    <div
      v-if="globalModelPickerOpen"
      class="global-model-picker-dropdown"
      :style="{ left: globalModelPickerPos.x + 'px', top: globalModelPickerPos.y + 'px' }"
      @click.stop
    >
      <div v-if="configuredProviders.length === 0" class="sm-no-providers">
        请先在设置中添加 API Key
      </div>
      <template v-else>
        <div v-for="p in configuredProviders" :key="p.id" class="sm-provider-group">
          <div class="sm-group-label">{{ p.name }}</div>
          <button
            v-for="m in p.models"
            :key="m.id"
            class="sm-model-item"
            :class="{ active: aiSettings.defaultProviderId === p.id && aiSettings.defaultModelId === m.id }"
            @click="selectGlobalModel(p.id, m.id)"
          >
            <Check
              v-if="aiSettings.defaultProviderId === p.id && aiSettings.defaultModelId === m.id"
              :size="10"
              class="sm-check"
            />
            <span v-else class="sm-check-ph" />
            {{ m.name }}
          </button>
        </div>
      </template>
    </div>
  </Teleport>
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
.picker-item-row:hover .picker-model-btn { opacity: 1; }

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

.picker-model-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 22px;
  padding: 0 6px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: #8e8e93;
  border-radius: 5px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s;
  margin-right: 3px;
}

.picker-model-btn:hover { background: rgba(0, 0, 0, 0.07); color: #3c3c43; }

.picker-model-label {
  font-size: 10px;
  font-weight: 500;
}

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
.list-item.active { background: rgba(34, 63, 121, 0.14); }
.list-item.secondary-active { background: rgba(34, 63, 121, 0.07); border-left: 2px solid rgba(34, 63, 121, 0.35); }
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

.list-item.active .item-title { color: #223F79; font-weight: 600; }
.list-item.secondary-active .item-title { color: rgba(34, 63, 121, 0.8); }

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

/* ─── Trash section (fixed at bottom, travel-notes style) ────────────────── */

.trash-section {
  flex-shrink: 0;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.trash-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
}

.trash-toggle:hover {
  background: rgba(0, 0, 0, 0.03);
}

.trash-chevron {
  color: #aeaeb2;
  flex-shrink: 0;
  transition: transform 0.15s;
}
.trash-chevron.open { transform: rotate(180deg); }

.trash-toggle-icon {
  color: #aeaeb2;
  flex-shrink: 0;
}

.trash-toggle-label {
  font-size: 11px;
  font-weight: 500;
  color: #8e8e93;
  flex: 1;
}

.trash-count-badge {
  font-size: 10px;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.08);
  color: #8e8e93;
  padding: 1px 6px;
  border-radius: 8px;
  flex-shrink: 0;
}

.trash-clear-btn {
  font-size: 10px;
  color: #ff3b30;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0 2px;
  flex-shrink: 0;
  transition: opacity 0.12s;
}

.trash-clear-btn:hover {
  opacity: 0.7;
}

.trash-list {
  padding: 2px 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
}

.trash-list::-webkit-scrollbar { width: 3px; }
.trash-list::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.10); border-radius: 2px; }

.trash-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  transition: background 0.10s;
  cursor: pointer;
}

.trash-item:hover { background: rgba(0, 0, 0, 0.04); }

.trash-item-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: #6e6e73;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trash-item-days {
  flex-shrink: 0;
  font-size: 10px;
  color: #aeaeb2;
  white-space: nowrap;
}

.trash-item-actions {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.trash-item:hover .trash-item-actions {
  opacity: 1;
}

.trash-action-btn {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.10s;
}

.restore-btn {
  color: #34c759;
}

.restore-btn:hover {
  background: rgba(52, 199, 89, 0.12);
}

.perm-delete-btn {
  color: #c7c7cc;
}

.perm-delete-btn:hover {
  background: rgba(255, 59, 48, 0.10);
  color: #ff3b30;
}

.trash-expand-enter-active, .trash-expand-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}
.trash-expand-enter-from, .trash-expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ─── Trash preview overlay ───────────────────────────────────────────────── */

.trash-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
  padding: 40px;
}

.trash-preview-panel {
  width: 100%;
  max-width: 640px;
  max-height: 80vh;
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.trash-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
  flex-shrink: 0;
}

.trash-preview-title {
  font-size: 15px;
  font-weight: 600;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trash-preview-close {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: #8e8e93;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s;
  flex-shrink: 0;
}

.trash-preview-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #3c3c43;
}

.trash-preview-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.trash-preview-msg {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trash-preview-msg.user {
  align-items: flex-end;
}

.trash-preview-msg.assistant {
  align-items: flex-start;
}

.trash-preview-role {
  font-size: 10px;
  font-weight: 600;
  color: #aeaeb2;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.trash-preview-content {
  font-size: 13px;
  line-height: 1.55;
  color: #1c1c1e;
  background: #f5f5f7;
  padding: 10px 14px;
  border-radius: 12px;
  max-width: 90%;
  word-break: break-word;
  white-space: pre-wrap;
}

.trash-preview-msg.user .trash-preview-content {
  background: #223F79;
  color: white;
}

.trash-preview-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-width: 90%;
}

.trash-preview-att {
  font-size: 11px;
  color: #8e8e93;
  background: rgba(0, 0, 0, 0.04);
  padding: 3px 8px;
  border-radius: 6px;
}

.trash-preview-fade-enter-active, .trash-preview-fade-leave-active {
  transition: opacity 0.18s;
}
.trash-preview-fade-enter-from, .trash-preview-fade-leave-to {
  opacity: 0;
}

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

/* ─── Export picker ───────────────────────────────────────────────────────── */

.export-picker {
  position: relative;
}

.export-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  width: 220px;
  background: rgba(250, 250, 252, 0.97);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  padding: 6px;
  z-index: 50;
}

.export-title {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  padding: 2px 8px 6px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.export-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  background: transparent;
  border-radius: 7px;
  cursor: pointer;
  text-align: left;
  transition: background 0.10s;
}

.export-item:hover { background: rgba(0, 0, 0, 0.05); }

.export-item-icon {
  font-size: 16px;
  flex-shrink: 0;
  line-height: 1;
}

.export-item-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.export-item-label {
  font-size: 12.5px;
  font-weight: 500;
  color: #1c1c1e;
}

.export-item-desc {
  font-size: 10.5px;
  color: #8e8e93;
}

.export-error {
  margin-top: 4px;
  padding: 5px 8px;
  font-size: 11px;
  color: #ff3b30;
  background: rgba(255, 59, 48, 0.06);
  border-radius: 6px;
}

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

<!-- Context menu is teleported to <body>, so styles must be global (not scoped) -->
<style>
.conv-context-menu {
  position: fixed;
  z-index: 2000;
  background: rgba(250, 250, 252, 0.97);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15), 0 0 0 0.5px rgba(255, 255, 255, 0.6) inset;
  padding: 4px;
  min-width: 150px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.conv-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border: none;
  background: none;
  border-radius: 7px;
  font-size: 13px;
  color: #3c3c43;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}

.conv-menu-item:hover { background: rgba(0, 0, 0, 0.05); }

.conv-menu-item.danger { color: #ff3b30; }
.conv-menu-item.danger:hover { background: rgba(255, 59, 48, 0.08); }

.conv-menu-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.06);
  margin: 3px 6px;
}

/* ─── Conversation model picker dropdown ──────────────────────────────────── */
.global-model-picker-dropdown {
  position: fixed;
  z-index: 9999;
  min-width: 200px;
  max-height: 320px;
  overflow-y: auto;
  background: rgba(250, 250, 252, 0.97);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 11px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  padding: 5px;
}

.global-model-picker-dropdown::-webkit-scrollbar { width: 3px; }
.global-model-picker-dropdown::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.10); border-radius: 2px; }

.sm-no-providers {
  padding: 10px;
  font-size: 12px;
  color: #8e8e93;
  text-align: center;
}

.sm-provider-group { margin-bottom: 3px; }

.sm-group-label {
  padding: 4px 8px 2px;
  font-size: 10px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sm-model-item {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 5px 8px;
  background: transparent;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  color: #1c1c1e;
  cursor: pointer;
  transition: background 0.08s;
  text-align: left;
}

.sm-model-item:hover { background: rgba(0, 0, 0, 0.06); }
.sm-model-item.active { background: rgba(34, 63, 121, 0.10); color: #223F79; font-weight: 500; }

.sm-check { color: #223F79; flex-shrink: 0; }
.sm-check-ph { width: 10px; flex-shrink: 0; }
</style>
