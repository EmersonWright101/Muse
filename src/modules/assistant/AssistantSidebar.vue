<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, SquarePen, Trash2, ListChecks, X, Pin, Pencil, ChevronDown, RotateCcw, BookOpen } from 'lucide-vue-next'
import { useAssistantStore } from '../../stores/assistant'
import { usePapersStore } from '../../stores/papers'

const { t } = useI18n()
const assistant = useAssistantStore()
const papers    = usePapersStore()

// ─── Chat search ──────────────────────────────────────────────────────────────

const searchQuery = ref('')

const filteredConvs = () => {
  let list = assistant.conversations
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return list
  return list.filter(c =>
    c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q),
  )
}

// ─── Paper list ───────────────────────────────────────────────────────────────

const paperSearch = ref('')

const filteredPapers = computed(() => {
  let list = papers.pushPapers
  const q = paperSearch.value.toLowerCase().trim()
  if (!q) return list
  return list.filter(p =>
    p.title.toLowerCase().includes(q) ||
    p.abstract.toLowerCase().includes(q) ||
    p.primary_category.toLowerCase().includes(q),
  )
})

function clickPaper(id: string) {
  assistant.activePaperId = assistant.activePaperId === id ? null : id
}

const CAT_PALETTE: Record<string, { bg: string; fg: string }> = {
  'cs.AI':   { bg: 'rgba(34,63,121,0.12)',   fg: '#223F79' },
  'cs.LG':   { bg: 'rgba(52,199,89,0.13)',   fg: '#1a7a35' },
  'cs.CV':   { bg: 'rgba(228,152,61,0.14)',  fg: '#c47a2a' },
  'cs.CL':   { bg: 'rgba(175,82,222,0.12)',  fg: '#7e28c0' },
  'cs.RO':   { bg: 'rgba(255,59,48,0.11)',   fg: '#cc2216' },
  'cs.GT':   { bg: 'rgba(0,199,190,0.12)',   fg: '#007a76' },
  'cs.NE':   { bg: 'rgba(255,149,0,0.12)',   fg: '#b86d00' },
  'cs.IR':   { bg: 'rgba(90,90,220,0.12)',   fg: '#3636aa' },
  'cs.HC':   { bg: 'rgba(255,100,180,0.11)', fg: '#b0206a' },
  'cs.CR':   { bg: 'rgba(200,100,50,0.12)',  fg: '#993a10' },
  'cs.DS':   { bg: 'rgba(80,150,200,0.12)',  fg: '#2a5a90' },
  'stat.ML': { bg: 'rgba(52,199,89,0.14)',   fg: '#166f2e' },
}

function catStyle(cat: string): { background: string; color: string } {
  const p = CAT_PALETTE[cat]
  if (p) return { background: p.bg, color: p.fg }
  let hash = 0
  for (let i = 0; i < cat.length; i++) hash = cat.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  return { background: `hsla(${hue},60%,92%,1)`, color: `hsl(${hue},55%,32%)` }
}

// ─── Rename ───────────────────────────────────────────────────────────────────

const renamingId  = ref<string | null>(null)
const renameInput = ref('')

function startRename(id: string, title: string) {
  renamingId.value  = id
  renameInput.value = title
}

async function finishRename(id: string) {
  if (renameInput.value.trim()) await assistant.renameConversation(id, renameInput.value.trim())
  renamingId.value = null
}

function handleRenameKeydown(e: KeyboardEvent, id: string) {
  if (e.key === 'Enter') finishRename(id)
  if (e.key === 'Escape') renamingId.value = null
}

function truncateTitle(title: string, max = 12): string {
  return title.length > max ? title.slice(0, max) + '…' : title
}

function truncateText(text: string, max = 40): string {
  return text.length > max ? text.slice(0, max) + '…' : text
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

// ─── Context menu ─────────────────────────────────────────────────────────────

const convMenuOpen   = ref(false)
const convMenuConvId = ref<string | null>(null)
const convMenuPos    = ref({ x: 0, y: 0 })

function openConvMenu(e: MouseEvent, convId: string) {
  if (assistant.batchMode) return
  convMenuConvId.value = convId
  convMenuPos.value    = { x: e.clientX, y: e.clientY }
  convMenuOpen.value   = true
}

function closeConvMenu() { convMenuOpen.value = false }

function convMenuRename() {
  const conv = assistant.conversations.find(c => c.id === convMenuConvId.value)
  if (conv) startRename(conv.id, conv.title)
  closeConvMenu()
}

function convMenuDelete() {
  if (convMenuConvId.value) assistant.deleteOne(convMenuConvId.value)
  closeConvMenu()
}

// ─── Click item ───────────────────────────────────────────────────────────────

function clickItem(id: string) {
  if (assistant.batchMode) assistant.toggleSelect(id)
  else assistant.openConversation(id)
}

// ─── Trash ────────────────────────────────────────────────────────────────────

const trashOpen = ref(false)

function daysUntilExpiry(deletedAt: string): number {
  const elapsed = Date.now() - new Date(deletedAt).getTime()
  return Math.max(1, 30 - Math.floor(elapsed / 86_400_000))
}

onMounted(()  => document.addEventListener('click', closeConvMenu))
onUnmounted(() => document.removeEventListener('click', closeConvMenu))
</script>

<template>
  <div class="assistant-sidebar">
    <!-- Papers sidebar -->
    <template v-if="assistant.papersViewMode === 'papers'">
      <!-- Header -->
      <div class="panel-header">
        <span class="panel-title">论文推送</span>
        <div class="header-actions">
          <button
            class="icon-btn"
            :disabled="papers.isFetchingPush"
            title="刷新"
            @click="papers.fetchPushPapers()"
          >
            <RotateCcw :size="14" />
          </button>
          <button
            class="icon-btn"
            :disabled="papers.isCrawling || !papers.isConfigured"
            title="立即爬取"
            @click="papers.crawlNow()"
          >
            <BookOpen :size="14" />
          </button>
        </div>
      </div>

      <!-- Search -->
      <div class="search-bar">
        <Search :size="13" class="search-icon" />
        <input
          v-model="paperSearch"
          class="search-input"
          placeholder="搜索论文…"
          type="text"
        />
        <button v-if="paperSearch" class="clear-btn" @click="paperSearch = ''">
          <X :size="11" />
        </button>
      </div>

      <!-- Paper list -->
      <div class="list-scroll">
        <div v-if="!papers.isConfigured" class="empty-state">
          尚未配置后端
        </div>
        <div v-else-if="filteredPapers.length === 0" class="empty-state">
          {{ paperSearch ? '没有匹配的论文' : '暂无论文' }}
        </div>
        <div
          v-for="paper in filteredPapers"
          :key="paper.id"
          class="list-item paper-item"
          :class="{ active: assistant.activePaperId === paper.id }"
          @click="clickPaper(paper.id)"
        >
          <div class="paper-item-content">
            <div class="paper-item-title">{{ truncateText(paper.title, 36) }}</div>
            <div class="paper-item-meta">
              <span class="paper-item-cat" :style="catStyle(paper.primary_category)">{{ paper.primary_category }}</span>
              <span v-if="paper.relevance_score !== null" class="paper-item-score" :style="{ color: paper.relevance_score >= 8 ? '#34c759' : paper.relevance_score >= 5 ? '#ff9500' : '#ff3b30' }">
                {{ paper.relevance_score.toFixed(1) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Chat sidebar -->
    <template v-else>
      <!-- Header -->
      <div class="panel-header">
        <span class="panel-title">私人助手</span>
        <div class="header-actions">
          <button
            v-if="assistant.batchMode"
            class="icon-btn danger"
            :title="t('common.delete')"
            :disabled="assistant.selectedConvIds.size === 0"
            @click="assistant.deleteBatch()"
          >
            <Trash2 :size="14" />
          </button>
          <button
            class="icon-btn"
            :class="{ active: assistant.batchMode }"
            :title="assistant.batchMode ? '退出选择' : '批量选择'"
            @click="assistant.toggleBatchMode()"
          >
            <ListChecks :size="14" />
          </button>
          <button class="icon-btn" title="新建对话" @click="assistant.newConversation()">
            <SquarePen :size="14" />
          </button>
        </div>
      </div>

      <!-- Batch mode bar -->
      <div v-if="assistant.batchMode" class="batch-bar">
        <span class="batch-count">已选 {{ assistant.selectedConvIds.size }} 项</span>
        <button class="link-btn" @click="assistant.selectAll()">全选</button>
        <button class="link-btn" @click="assistant.clearSelection()">取消</button>
      </div>

      <!-- Search -->
      <div class="search-bar">
        <Search :size="13" class="search-icon" />
        <input
          v-model="searchQuery"
          class="search-input"
          placeholder="搜索对话…"
          type="text"
        />
        <button v-if="searchQuery" class="clear-btn" @click="searchQuery = ''">
          <X :size="11" />
        </button>
      </div>

      <!-- Conversation list -->
      <div class="list-scroll">
        <div v-if="filteredConvs().length === 0" class="empty-state">
          {{ searchQuery ? '没有匹配的对话' : '还没有对话' }}
        </div>

        <div
          v-for="conv in filteredConvs()"
          :key="conv.id"
          class="list-item"
          :class="{
            active:   assistant.activeConvId === conv.id && !assistant.batchMode,
            selected: assistant.batchMode && assistant.selectedConvIds.has(conv.id),
            pinned:   conv.pinned,
          }"
          @click="clickItem(conv.id)"
          @contextmenu.prevent="openConvMenu($event, conv.id)"
        >
          <!-- Batch checkbox -->
          <div v-if="assistant.batchMode" class="item-check">
            <div class="check-box" :class="{ checked: assistant.selectedConvIds.has(conv.id) }">
              <svg v-if="assistant.selectedConvIds.has(conv.id)" width="10" height="10" viewBox="0 0 10 10">
                <polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </div>
          </div>

          <!-- Pin indicator -->
          <div v-if="conv.pinned && !assistant.batchMode" class="pin-dot">
            <Pin :size="9" />
          </div>

          <!-- Streaming indicator dot -->
          <div v-if="assistant.streamingConvIds.has(conv.id)" class="streaming-dot" />

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

          <!-- Right side: time + hover actions -->
          <div v-if="!assistant.batchMode" class="item-right">
            <span class="item-time">{{ formatTime(conv.updatedAt) }}</span>
            <div class="item-actions">
              <button
                class="action-btn"
                :title="conv.pinned ? '取消置顶' : '置顶'"
                @click.stop="assistant.togglePin(conv.id)"
              >
                <Pin :size="11" />
              </button>
              <button
                class="action-btn"
                title="重命名"
                @click.stop="startRename(conv.id, conv.title)"
              >
                <Pencil :size="11" />
              </button>
              <button
                class="action-btn danger"
                :title="t('common.delete')"
                @click.stop="assistant.deleteOne(conv.id)"
              >
                <Trash2 :size="11" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Recently Deleted -->
      <div v-if="!searchQuery && assistant.trashedConversations.length > 0" class="trash-section">
        <button class="trash-toggle" @click="trashOpen = !trashOpen">
          <ChevronDown :size="11" class="trash-chevron" :class="{ open: trashOpen }" />
          <Trash2 :size="11" class="trash-toggle-icon" />
          <span class="trash-toggle-label">最近删除</span>
          <span class="trash-count-badge">{{ assistant.trashedConversations.length }}</span>
          <button
            v-if="trashOpen"
            class="trash-clear-btn"
            title="清空"
            @click.stop="assistant.clearAllTrash()"
          >清空</button>
        </button>
        <div v-if="trashOpen" class="trash-list">
          <div
            v-for="item in assistant.trashedConversations"
            :key="item.id"
            class="trash-item"
            @click="assistant.openTrashPreview(item.id)"
          >
            <span class="trash-item-title" :title="item.title">{{ item.title.length > 16 ? item.title.slice(0, 16) + '…' : item.title }}</span>
            <span class="trash-item-days">{{ daysUntilExpiry(item.deletedAt) }}天</span>
            <div class="trash-item-actions">
              <button class="trash-action-btn restore-btn" title="恢复" @click.stop="assistant.restoreFromTrash(item.id)">
                <RotateCcw :size="11" />
              </button>
              <button class="trash-action-btn perm-delete-btn" title="永久删除" @click.stop="assistant.permanentDeleteOne(item.id)">
                <Trash2 :size="11" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Trash preview overlay -->
    <Teleport to="body">
      <Transition name="trash-preview-fade">
        <div v-if="assistant.previewTrashedConv" class="trash-preview-overlay" @click.self="assistant.closeTrashPreview()">
          <div class="trash-preview-panel">
            <div class="trash-preview-header">
              <span class="trash-preview-title">{{ assistant.previewTrashedConv.title }}</span>
              <button class="trash-preview-close" @click="assistant.closeTrashPreview()">
                <X :size="16" />
              </button>
            </div>
            <div class="trash-preview-body">
              <div
                v-for="msg in assistant.previewTrashedConv.messages"
                :key="msg.id"
                class="trash-preview-msg"
                :class="{ user: msg.role === 'user', assistant: msg.role === 'assistant' }"
              >
                <div class="trash-preview-role">{{ msg.role === 'user' ? '用户' : 'AI' }}</div>
                <div class="trash-preview-content">{{ msg.content }}</div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>

  <Teleport to="body">
    <div
      v-if="convMenuOpen"
      class="conv-context-menu"
      :style="{ left: convMenuPos.x + 'px', top: convMenuPos.y + 'px' }"
      @click.stop
    >
      <button class="conv-menu-item" @click="convMenuRename">
        <Pencil :size="13" />
        <span>编辑话题名称</span>
      </button>
      <div class="conv-menu-divider" />
      <button class="conv-menu-item danger" @click="convMenuDelete">
        <Trash2 :size="13" />
        <span>删除对话</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.assistant-sidebar {
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

/* ─── Paper list ───────────────────────────────────────────────────────────── */

.paper-item {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 7px 10px;
}

.paper-item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.paper-item-title {
  font-size: 12.5px;
  font-weight: 500;
  color: #1c1c1e;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.paper-item.active .paper-item-title { color: #c47a2a; font-weight: 600; }

.paper-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.paper-item-cat {
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
}

.paper-item-score {
  font-size: 10.5px;
  font-weight: 700;
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
.list-item.active { background: rgba(34, 63, 121, 0.14); }
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

.check-box.checked { background: #223F79; border-color: #223F79; }

.pin-dot {
  flex-shrink: 0;
  color: #223F79;
  opacity: 0.5;
  display: flex;
  align-items: center;
}

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

/* ─── Trash section ───────────────────────────────────────────────────────── */

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

.trash-toggle:hover { background: rgba(0, 0, 0, 0.03); }

.trash-chevron { color: #aeaeb2; flex-shrink: 0; transition: transform 0.15s; }
.trash-chevron.open { transform: rotate(180deg); }
.trash-toggle-icon { color: #aeaeb2; flex-shrink: 0; }

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

.trash-item:hover .trash-item-actions { opacity: 1; }

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

.restore-btn { color: #34c759; }
.restore-btn:hover { background: rgba(52, 199, 89, 0.12); }
.perm-delete-btn { color: #c7c7cc; }
.perm-delete-btn:hover { background: rgba(255, 59, 48, 0.10); color: #ff3b30; }

/* ─── Trash preview ───────────────────────────────────────────────────────── */

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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.trash-preview-close:hover { background: rgba(0, 0, 0, 0.06); color: #3c3c43; }

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

.trash-preview-msg.user     { align-items: flex-end; }
.trash-preview-msg.assistant { align-items: flex-start; }

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

.trash-preview-fade-enter-active, .trash-preview-fade-leave-active {
  transition: opacity 0.18s;
}
.trash-preview-fade-enter-from, .trash-preview-fade-leave-to {
  opacity: 0;
}
</style>

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
</style>
