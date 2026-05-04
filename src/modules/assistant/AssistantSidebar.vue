<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, SquarePen, Trash2, ListChecks, X, Pin, Pencil, ChevronDown, ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown, RotateCcw, BookOpen, MessageSquare, ArrowUpDown, Filter, Star } from 'lucide-vue-next'

// silence TS6133 for icons used only in template
void ArrowUpDown
void Filter
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
  if (q) {
    list = list.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.abstract.toLowerCase().includes(q) ||
      p.primary_category.toLowerCase().includes(q),
    )
  }
  if (analyzedFilter.value === 'analyzed') {
    list = list.filter(p => p.analyzed)
  } else if (analyzedFilter.value === 'un_analyzed') {
    list = list.filter(p => !p.analyzed)
  }
  if (favoriteFilter.value === 'favorite') {
    list = list.filter(p => p.favorite)
  } else if (favoriteFilter.value === 'unfavorite') {
    list = list.filter(p => !p.favorite)
  }
  if (goodFilter.value === 'good') {
    list = list.filter(p => p.good === true)
  } else if (goodFilter.value === 'not_good') {
    list = list.filter(p => p.good === false)
  }
  return list
})

function clickPaper(id: string) {
  assistant.activePaperId = assistant.activePaperId === id ? null : id
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

type SortMode = 'relevance_desc' | 'relevance_asc' | 'date_desc' | 'date_asc'
const paperSort = ref<SortMode>('relevance_desc')

function sortPapers(list: typeof papers.pushPapers): typeof papers.pushPapers {
  const sorted = [...list]
  switch (paperSort.value) {
    case 'relevance_desc':
      sorted.sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
      break
    case 'relevance_asc':
      sorted.sort((a, b) => (a.relevance_score ?? 0) - (b.relevance_score ?? 0))
      break
    case 'date_desc':
      sorted.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
      break
    case 'date_asc':
      sorted.sort((a, b) => new Date(a.published_at).getTime() - new Date(b.published_at).getTime())
      break
  }
  return sorted
}

// ─── Collapsible date groups ──────────────────────────────────────────────────

const collapsedGroups = ref<Set<string>>(new Set())

function toggleGroup(date: string) {
  const s = new Set(collapsedGroups.value)
  if (s.has(date)) s.delete(date)
  else s.add(date)
  collapsedGroups.value = s
}

// ─── Time range / date navigation ─────────────────────────────────────────────

const todayStr = new Date().toISOString().slice(0, 10)

const TIME_MODES = [
  { value: 'today' as const, label: '今日' },
  { value: '1d'    as const, label: '近1天' },
  { value: '1w'    as const, label: '近1周' },
  { value: '1m'    as const, label: '近1月' },
  { value: 'custom'as const, label: '自选' },
]

async function setMode(mode: typeof TIME_MODES[number]['value']) {
  papers.pushMode = mode
  await papers.fetchPushPapers()
}

function prevDay() {
  const d = new Date(papers.pushDate + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  papers.fetchPushPapers(d.toISOString().slice(0, 10))
}

function nextDay() {
  const d = new Date(papers.pushDate + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  const next = d.toISOString().slice(0, 10)
  if (next <= todayStr) papers.fetchPushPapers(next)
}

function onDateChange(e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (v) papers.fetchPushPapers(v)
}

// ─── Grouped papers ───────────────────────────────────────────────────────────

function localDateStr(iso: string | null | undefined): string {
  if (!iso) return '?'
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const TAG_ABBREVS: Record<string, string> = {
  'Systematic Generalization': 'SysGen',
  'Compositional Generalization': 'ComGen',
  'Compositional': 'ComGen',
}

function tagLabel(tag: string): string {
  return TAG_ABBREVS[tag] ?? tag
}

function tagStyle(tag: string): Record<string, string> {
  const palette = [
    { bg: 'rgba(221,133,60,0.10)', fg: '#DD853C' },
    { bg: 'rgba(221,133,60,0.12)', fg: '#b86d2e' },
    { bg: 'rgba(221,133,60,0.13)', fg: '#DD853C' },
    { bg: 'rgba(175,82,222,0.11)', fg: '#7e28c0' },
    { bg: 'rgba(255,59,48,0.10)', fg: '#cc2216' },
    { bg: 'rgba(0,199,190,0.11)', fg: '#007a76' },
    { bg: 'rgba(255,149,0,0.11)', fg: '#b86d00' },
    { bg: 'rgba(90,90,220,0.11)', fg: '#3636aa' },
    { bg: 'rgba(255,100,180,0.10)', fg: '#b0206a' },
    { bg: 'rgba(200,100,50,0.11)', fg: '#993a10' },
    { bg: 'rgba(80,150,200,0.11)', fg: '#2a5a90' },
  ]
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash)
  const p = palette[Math.abs(hash) % palette.length]
  return { background: p.bg, color: p.fg }
}

const groupedPapers = computed(() => {
  const list = filteredPapers.value
  const map: Record<string, typeof list> = {}
  for (const p of list) {
    const d = localDateStr(p.published_at) ?? p.fetch_date ?? localDateStr(p.crawled_at) ?? '?'
    if (!map[d]) map[d] = []
    map[d].push(p)
  }
  return Object.keys(map)
    .sort((a, b) => b.localeCompare(a))
    .map(date => ({ date, papers: sortPapers(map[date]) }))
})

function formatGroupDate(dateStr: string): string {
  if (dateStr === '?') return '未知日期'
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.floor((today.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
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

// ─── Dropdown menus ───────────────────────────────────────────────────────────

const modeMenuOpen = ref(false)
const sortMenuOpen = ref(false)
const filterMenuOpen = ref(false)

const modeBtnEl = ref<HTMLElement>()
const sortBtnEl = ref<HTMLElement>()
const filterBtnEl = ref<HTMLElement>()

const modeMenuStyle = ref({ top: '0px', left: '0px' })
const sortMenuStyle = ref({ top: '0px', left: '0px' })
const filterMenuStyle = ref({ top: '0px', left: '0px' })

function menuPos(el?: HTMLElement) {
  if (!el) return { top: '0px', left: '0px' }
  const rect = el.getBoundingClientRect()
  return {
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
  }
}

function closeModeMenu(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.mode-dropdown-wrap')) modeMenuOpen.value = false
}

function switchMode(mode: 'papers' | 'chat') {
  assistant.papersViewMode = mode
  modeMenuOpen.value = false
}

function closeSortMenu(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.sort-menu-wrap')) sortMenuOpen.value = false
}

function selectSort(mode: SortMode) {
  paperSort.value = mode
  sortMenuOpen.value = false
}

// ─── Filter menu ──────────────────────────────────────────────────────────────

const analyzedFilter = ref<'all' | 'analyzed' | 'un_analyzed'>('all')
const favoriteFilter = ref<'all' | 'favorite' | 'unfavorite'>('all')
const goodFilter = ref<'all' | 'good' | 'not_good'>('all')

function closeFilterMenu(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.filter-menu-wrap')) filterMenuOpen.value = false
}

// ─── Trash ────────────────────────────────────────────────────────────────────

const trashOpen = ref(false)
const paperTrashOpen = ref(false)

function daysUntilExpiry(deletedAt: string): number {
  const elapsed = Date.now() - new Date(deletedAt).getTime()
  return Math.max(1, 30 - Math.floor(elapsed / 86_400_000))
}

function togglePaperTrash() {
  paperTrashOpen.value = !paperTrashOpen.value
  if (paperTrashOpen.value) papers.fetchDeletedPapers()
}

const paperMenuOpen  = ref(false)
const paperMenuPaper = ref<any>(null)
const paperMenuPos   = ref({ x: 0, y: 0 })

function openPaperMenu(e: MouseEvent, paper: any) {
  paperMenuPaper.value = paper
  paperMenuPos.value   = { x: e.clientX, y: e.clientY }
  paperMenuOpen.value  = true
}

function closePaperMenu() { paperMenuOpen.value = false }

function paperMenuDelete() {
  if (paperMenuPaper.value)
    papers.softDeletePaper(paperMenuPaper.value.id, paperMenuPaper.value.source ?? 'arxiv')
  closePaperMenu()
}

onMounted(()  => {
  document.addEventListener('click', closeConvMenu)
  document.addEventListener('click', closeModeMenu)
  document.addEventListener('click', closeSortMenu)
  document.addEventListener('click', closeFilterMenu)
  document.addEventListener('click', closePaperMenu)
})
onUnmounted(() => {
  document.removeEventListener('click', closeConvMenu)
  document.removeEventListener('click', closeModeMenu)
  document.removeEventListener('click', closeSortMenu)
  document.removeEventListener('click', closeFilterMenu)
  document.removeEventListener('click', closePaperMenu)
})
</script>

<template>
  <div :class="['assistant-sidebar', assistant.papersViewMode === 'papers' ? 'theme-orange' : 'theme-blue']">
    <!-- Papers sidebar -->
    <!-- Unified header -->
    <div class="panel-header">
      <div class="mode-dropdown-wrap">
        <button
          ref="modeBtnEl"
          class="mode-dropdown"
          @click.stop="modeMenuOpen = !modeMenuOpen; modeMenuStyle = menuPos(modeBtnEl)"
        >
          <BookOpen v-if="assistant.papersViewMode === 'papers'" :size="13" />
          <MessageSquare v-else :size="13" />
          <span>{{ assistant.papersViewMode === 'papers' ? '论文推送' : '智能回答' }}</span>
          <ChevronDown :size="11" />
        </button>
        <Teleport to="body">
          <div v-show="modeMenuOpen" class="mode-menu" :style="{ position: 'fixed', top: modeMenuStyle.top, left: modeMenuStyle.left }">
            <button
              class="mode-menu-item"
              :class="{ active: assistant.papersViewMode === 'papers' }"
              @click.stop="switchMode('papers')"
            >
              <BookOpen :size="13" />
              论文推送
            </button>
            <button
              class="mode-menu-item"
              :class="{ active: assistant.papersViewMode === 'chat' }"
              @click.stop="switchMode('chat')"
            >
              <MessageSquare :size="13" />
              智能回答
            </button>
          </div>
        </Teleport>
      </div>
      <template v-if="assistant.papersViewMode === 'papers'">
        <div class="header-tools">
          <div class="sort-menu-wrap">
            <button
              ref="sortBtnEl"
              class="sort-icon-btn"
              title="排序"
              @click.stop="sortMenuOpen = !sortMenuOpen; sortMenuStyle = menuPos(sortBtnEl)"
            >
              <ArrowUpDown :size="14" />
            </button>
            <Teleport to="body">
              <div v-show="sortMenuOpen" class="sort-menu" :style="{ position: 'fixed', top: sortMenuStyle.top, left: sortMenuStyle.left }">
                <div class="sort-menu-group">
                  <div class="sort-menu-label">指标</div>
                  <button
                    class="sort-menu-item"
                    :class="{ active: paperSort.startsWith('relevance') }"
                    @click.stop="selectSort(paperSort.endsWith('desc') ? 'relevance_desc' : 'relevance_asc')"
                  >
                    <span class="sort-menu-check">{{ paperSort.startsWith('relevance') ? '✓' : '' }}</span>
                    分数
                  </button>
                  <button
                    class="sort-menu-item"
                    :class="{ active: paperSort.startsWith('date') }"
                    @click.stop="selectSort(paperSort.endsWith('desc') ? 'date_desc' : 'date_asc')"
                  >
                    <span class="sort-menu-check">{{ paperSort.startsWith('date') ? '✓' : '' }}</span>
                    日期
                  </button>
                </div>
                <div class="sort-menu-divider" />
                <div class="sort-menu-group">
                  <div class="sort-menu-label">排序方式</div>
                  <button
                    class="sort-menu-item"
                    :class="{ active: paperSort.endsWith('desc') }"
                    @click.stop="selectSort(paperSort.startsWith('relevance') ? 'relevance_desc' : 'date_desc')"
                  >
                    <span class="sort-menu-check">{{ paperSort.endsWith('desc') ? '✓' : '' }}</span>
                    降序
                  </button>
                  <button
                    class="sort-menu-item"
                    :class="{ active: paperSort.endsWith('asc') }"
                    @click.stop="selectSort(paperSort.startsWith('relevance') ? 'relevance_asc' : 'date_asc')"
                  >
                    <span class="sort-menu-check">{{ paperSort.endsWith('asc') ? '✓' : '' }}</span>
                    升序
                  </button>
                </div>
              </div>
            </Teleport>
          </div>
          <div class="filter-menu-wrap">
            <button
              ref="filterBtnEl"
              class="filter-icon-btn"
              title="筛选"
              @click.stop="filterMenuOpen = !filterMenuOpen; filterMenuStyle = menuPos(filterBtnEl)"
            >
              <Filter :size="14" />
            </button>
            <Teleport to="body">
              <div v-show="filterMenuOpen" class="filter-menu" :style="{ position: 'fixed', top: filterMenuStyle.top, left: filterMenuStyle.left }">
                <div class="filter-menu-group">
                  <div class="filter-menu-label">时间范围</div>
                  <button
                    v-for="m in TIME_MODES"
                    :key="m.value"
                    class="filter-menu-item"
                    :class="{ active: papers.pushMode === m.value }"
                    @click.stop="setMode(m.value)"
                  >
                    <span class="filter-menu-check">{{ papers.pushMode === m.value ? '✓' : '' }}</span>
                    {{ m.label }}
                  </button>
                </div>
                <div v-if="papers.pushMode === 'today'" class="filter-date-nav">
                  <button class="filter-date-btn" :disabled="papers.isFetchingPush" @click.stop="prevDay">
                    <ChevronLeft :size="12" />
                  </button>
                  <input
                    type="date"
                    class="filter-date-input"
                    :value="papers.pushDate"
                    :max="todayStr"
                    @change="onDateChange"
                  />
                  <button class="filter-date-btn" :disabled="papers.isFetchingPush || papers.pushDate >= todayStr" @click.stop="nextDay">
                    <ChevronRight :size="12" />
                  </button>
                </div>
                <div v-else-if="papers.pushMode === 'custom'" class="filter-date-range">
                  <div class="filter-date-row">
                    <span class="filter-date-label">从</span>
                    <input
                      type="date"
                      class="filter-date-input"
                      v-model="papers.pushDateFrom"
                      :max="papers.pushDateTo || todayStr"
                      @change="papers.fetchPushPapers()"
                    />
                  </div>
                  <div class="filter-date-row">
                    <span class="filter-date-label">到</span>
                    <input
                      type="date"
                      class="filter-date-input"
                      v-model="papers.pushDateTo"
                      :min="papers.pushDateFrom"
                      :max="todayStr"
                      @change="papers.fetchPushPapers()"
                    />
                  </div>
                </div>
                <div class="filter-menu-divider" />
                <div class="filter-menu-group">
                  <div class="filter-menu-label">分析状态</div>
                  <button
                    class="filter-menu-item"
                    :class="{ active: analyzedFilter === 'all' }"
                    @click.stop="analyzedFilter = 'all'"
                  >
                    <span class="filter-menu-check">{{ analyzedFilter === 'all' ? '✓' : '' }}</span>
                    全部
                  </button>
                  <button
                    class="filter-menu-item"
                    :class="{ active: analyzedFilter === 'analyzed' }"
                    @click.stop="analyzedFilter = 'analyzed'"
                  >
                    <span class="filter-menu-check">{{ analyzedFilter === 'analyzed' ? '✓' : '' }}</span>
                    已分析
                  </button>
                  <button
                    class="filter-menu-item"
                    :class="{ active: analyzedFilter === 'un_analyzed' }"
                    @click.stop="analyzedFilter = 'un_analyzed'"
                  >
                    <span class="filter-menu-check">{{ analyzedFilter === 'un_analyzed' ? '✓' : '' }}</span>
                    未分析
                  </button>
                </div>
                <div class="filter-menu-divider" />
                <div class="filter-menu-group">
                  <div class="filter-menu-label">收藏状态</div>
                  <button
                    class="filter-menu-item"
                    :class="{ active: favoriteFilter === 'all' }"
                    @click.stop="favoriteFilter = 'all'"
                  >
                    <span class="filter-menu-check">{{ favoriteFilter === 'all' ? '✓' : '' }}</span>
                    全部
                  </button>
                  <button
                    class="filter-menu-item"
                    :class="{ active: favoriteFilter === 'favorite' }"
                    @click.stop="favoriteFilter = 'favorite'"
                  >
                    <span class="filter-menu-check">{{ favoriteFilter === 'favorite' ? '✓' : '' }}</span>
                    已收藏
                  </button>
                  <button
                    class="filter-menu-item"
                    :class="{ active: favoriteFilter === 'unfavorite' }"
                    @click.stop="favoriteFilter = 'unfavorite'"
                  >
                    <span class="filter-menu-check">{{ favoriteFilter === 'unfavorite' ? '✓' : '' }}</span>
                    未收藏
                  </button>
                </div>
                <div class="filter-menu-divider" />
                <div class="filter-menu-group">
                  <div class="filter-menu-label">评价状态</div>
                  <button
                    class="filter-menu-item"
                    :class="{ active: goodFilter === 'all' }"
                    @click.stop="goodFilter = 'all'"
                  >
                    <span class="filter-menu-check">{{ goodFilter === 'all' ? '✓' : '' }}</span>
                    全部
                  </button>
                  <button
                    class="filter-menu-item"
                    :class="{ active: goodFilter === 'good' }"
                    @click.stop="goodFilter = 'good'"
                  >
                    <span class="filter-menu-check">{{ goodFilter === 'good' ? '✓' : '' }}</span>
                    好文章
                  </button>
                  <button
                    class="filter-menu-item"
                    :class="{ active: goodFilter === 'not_good' }"
                    @click.stop="goodFilter = 'not_good'"
                  >
                    <span class="filter-menu-check">{{ goodFilter === 'not_good' ? '✓' : '' }}</span>
                    不感兴趣
                  </button>
                </div>
              </div>
            </Teleport>
          </div>
          <button
            class="icon-btn"
            :disabled="papers.isFetchingPush"
            title="刷新"
            @click="papers.fetchPushPapers()"
          >
            <RotateCcw :size="14" />
          </button>
        </div>
      </template>
      <template v-else>
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
      </template>
    </div>

    <template v-if="assistant.papersViewMode === 'papers'">
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

      <!-- Paper list (grouped by date) -->
      <div class="list-scroll">
        <div v-if="!papers.isConfigured" class="empty-state">
          尚未配置后端
        </div>
        <template v-else-if="groupedPapers.length === 0">
          <div class="empty-state">{{ paperSearch ? '没有匹配的论文' : '暂无论文' }}</div>
        </template>
        <template v-else>
          <template v-for="group in groupedPapers" :key="group.date">
            <div class="date-group-header" @click="toggleGroup(group.date)">
              <div class="date-group-left">
                <component :is="collapsedGroups.has(group.date) ? ChevronRight : ChevronDown" :size="10" class="date-group-chevron" />
                <span class="date-group-label">{{ formatGroupDate(group.date) }}</span>
              </div>
              <span class="date-group-count">{{ group.papers.length }}</span>
            </div>
            <div v-show="!collapsedGroups.has(group.date)">
              <div
                v-for="paper in group.papers"
                :key="paper.id"
                class="list-item paper-item"
                :class="{ active: assistant.activePaperId === paper.id, unread: !paper.read }"
                @click="clickPaper(paper.id)"
                @contextmenu.prevent="openPaperMenu($event, paper)"
              >
                <div class="paper-item-content">
                  <div class="paper-item-title">{{ paper.title }}</div>
                  <div class="paper-item-meta">
                    <div class="paper-item-meta-left">
                      <span v-if="paper.relevance_score !== null" class="paper-item-score" :style="{ color: paper.relevance_score >= 5 ? '#DD853C' : '#E06B4A' }">
                        {{ paper.relevance_score.toFixed(1) }}
                      </span>
                      <span
                        v-for="tag in (paper.matched_tags ?? []).slice(0, 2)"
                        :key="tag"
                        class="paper-item-tag"
                        :style="tagStyle(tag)"
                      >{{ tagLabel(tag) }}</span>
                    </div>
                    <div class="paper-item-feedback">
                      <button
                        class="feedback-btn fav"
                        :class="{ active: paper.favorite }"
                        title="收藏"
                        @click.stop="papers.toggleFavorite(paper.id, paper.source ?? 'arxiv')"
                      ><Star :size="12" /></button>
                      <button
                        class="feedback-btn"
                        :class="{ active: paper.good === true }"
                        title="好文章"
                        @click.stop="papers.togglePaperGood(paper.id, true, paper.source ?? 'arxiv')"
                      ><ThumbsUp :size="12" /></button>
                      <button
                        class="feedback-btn bad"
                        :class="{ active: paper.good === false }"
                        title="不感兴趣"
                        @click.stop="papers.togglePaperGood(paper.id, false, paper.source ?? 'arxiv')"
                      ><ThumbsDown :size="12" /></button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </template>
      </div>

      <!-- Trash section for papers -->
      <div class="trash-section paper-trash-section">
        <button class="trash-toggle" @click="togglePaperTrash">
          <ChevronDown :size="11" class="trash-chevron" :class="{ open: paperTrashOpen }" />
          <Trash2 :size="11" class="trash-toggle-icon" />
          <span class="trash-toggle-label">最近删除</span>
          <span class="trash-count-badge">{{ papers.deletedPapers.length }}</span>
        </button>
        <div v-if="paperTrashOpen" class="trash-list">
          <div v-if="papers.deletedPapers.length === 0" class="trash-empty">
            暂无已删除论文
          </div>
          <div
            v-for="paper in papers.deletedPapers"
            :key="paper.id"
            class="trash-item"
          >
            <div class="trash-item-body">
              <span class="trash-item-title" :title="paper.title">{{ paper.title.length > 24 ? paper.title.slice(0, 24) + '…' : paper.title }}</span>
              <div v-if="(paper.matched_tags ?? []).length" class="trash-item-tags">
                <span
                  v-for="tag in (paper.matched_tags ?? []).slice(0, 2)"
                  :key="tag"
                  class="paper-item-tag"
                  :style="tagStyle(tag)"
                >{{ tagLabel(tag) }}</span>
              </div>
            </div>
            <div class="trash-item-actions">
              <button class="trash-action-btn restore-btn" title="恢复" @click.stop="papers.restorePaper(paper.id, paper.source ?? 'arxiv')">
                <RotateCcw :size="10" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Chat sidebar -->
    <template v-else>
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

  <Teleport to="body">
    <div
      v-if="paperMenuOpen"
      class="conv-context-menu"
      :style="{ left: paperMenuPos.x + 'px', top: paperMenuPos.y + 'px' }"
      @click.stop
    >
      <button class="conv-menu-item danger" @click="paperMenuDelete">
        <Trash2 :size="13" />
        <span>移至回收站</span>
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
  position: relative;
}

.panel-header {
  height: 48px;
  padding: 0 10px 0 14px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
}

.mode-dropdown-wrap {
  position: relative;
  flex-shrink: 0;
}

.mode-dropdown {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 6px;
  border: none;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.12s;
  background: transparent;
  color: #3c3c43;
}

.mode-dropdown:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #1c1c1e;
}

.theme-orange .mode-dropdown {
  color: #DD853C;
}
.theme-orange .mode-dropdown:hover {
  background: rgba(221, 133, 60, 0.10);
  color: #DD853C;
}

.mode-menu {
  position: fixed;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  padding: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.10);
  width: 130px;
}

.mode-menu-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.10s;
  background: transparent;
  color: #3c3c43;
  text-align: left;
}

.mode-menu-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.mode-menu-item.active {
  background: rgba(38, 65, 120, 0.08);
  color: #264178;
  font-weight: 600;
}
.theme-orange .mode-menu-item.active {
  background: rgba(221, 133, 60, 0.08);
  color: #DD853C;
}

.header-tools {
  display: flex;
  align-items: center;
  gap: 0;
  margin-left: auto;
}

.header-actions {
  display: flex;
  gap: 0;
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
.icon-btn.active { background: rgba(38, 65, 120, 0.10); color: #264178; }
.theme-orange .icon-btn.active { background: rgba(221, 133, 60, 0.10); color: #DD853C; }
.icon-btn.danger:hover { background: rgba(255, 59, 48, 0.08); color: #ff3b30; }
.icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.batch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(38, 65, 120, 0.05);
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

/* ─── Time range bar ───────────────────────────────────────────────────────── */

.time-range-bar {
  display: flex;
  padding: 5px 8px 0;
  gap: 2px;
  flex-shrink: 0;
}

.range-btn {
  flex: 1;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 500;
  color: #8e8e93;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  white-space: nowrap;
}

.range-btn:hover { background: rgba(0,0,0,0.05); color: #3c3c43; }
.range-btn.active { background: rgba(38,65,120,0.12); color: #264178; font-weight: 600; }
.theme-orange .range-btn.active { background: rgba(221,133,60,0.12); color: #DD853C; }

/* ─── Date nav ─────────────────────────────────────────────────────────────── */

.date-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  flex-shrink: 0;
}

.date-nav-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: #8e8e93;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}

.date-nav-btn:hover:not(:disabled) { background: rgba(0,0,0,0.06); color: #3c3c43; }
.date-nav-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.date-input {
  flex: 1;
  height: 20px;
  border: 1px solid rgba(0,0,0,0.10);
  border-radius: 5px;
  background: rgba(255,255,255,0.7);
  font-size: 10.5px;
  color: #1c1c1e;
  text-align: center;
  padding: 0 2px;
  cursor: pointer;
  outline: none;
  min-width: 0;
}

.date-input:focus { border-color: rgba(34,63,121,0.4); }

/* ─── Custom date range ────────────────────────────────────────────────────── */

.date-range-row {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px;
  flex-shrink: 0;
}

.date-range-input {
  flex: 1;
  height: 20px;
  border: 1px solid rgba(0,0,0,0.10);
  border-radius: 5px;
  background: rgba(255,255,255,0.7);
  font-size: 10px;
  color: #1c1c1e;
  padding: 0 2px;
  cursor: pointer;
  outline: none;
  min-width: 0;
}

.date-range-input:focus { border-color: rgba(34,63,121,0.4); }

.date-range-sep {
  color: #aeaeb2;
  font-size: 11px;
  flex-shrink: 0;
}

/* ─── Date group header ────────────────────────────────────────────────────── */

.date-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px 2px;
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;
  transition: color 0.12s;
}
.date-group-header:hover .date-group-label { color: #8e8e93; }

.date-group-left {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: -14px;
}

.date-group-chevron {
  color: #c7c7cc;
  flex-shrink: 0;
}

.date-group-label {
  font-size: 12.5px;
  font-weight: 700;
  color: #6e6e73;
  letter-spacing: 0.02em;
}

.date-group-count {
  font-size: 10px;
  color: #8e8e93;
  background: rgba(0,0,0,0.08);
  padding: 1px 6px;
  border-radius: 8px;
}

/* ─── Header sort ──────────────────────────────────────────────────────────── */

.sort-menu-wrap {
  position: relative;
  flex-shrink: 0;
}

.sort-icon-btn {
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

.sort-icon-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #3c3c43;
}

.sort-menu {
  position: fixed;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  padding: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.10);
  width: 120px;
}

.sort-menu-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.sort-menu-label {
  font-size: 10px;
  font-weight: 600;
  color: #aeaeb2;
  padding: 2px 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.sort-menu-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.06);
  margin: 2px 0;
}

.sort-menu-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.10s;
  background: transparent;
  color: #3c3c43;
  text-align: left;
}

.sort-menu-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.sort-menu-item.active {
  background: rgba(38, 65, 120, 0.08);
  color: #264178;
  font-weight: 600;
}
.theme-orange .sort-menu-item.active {
  background: rgba(221, 133, 60, 0.08);
  color: #DD853C;
}

.sort-menu-check {
  width: 14px;
  text-align: center;
  font-size: 11px;
}

/* ─── Filter menu ────────────────────────────────────────────────────────────── */

.filter-menu-wrap {
  position: relative;
  flex-shrink: 0;
}

.filter-icon-btn {
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

.filter-icon-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #3c3c43;
}

.filter-menu {
  position: fixed;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  padding: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.10);
  width: 160px;
}

.filter-menu-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.filter-menu-label {
  font-size: 10px;
  font-weight: 600;
  color: #aeaeb2;
  padding: 2px 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.filter-menu-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.06);
  margin: 2px 0;
}

.filter-menu-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.10s;
  background: transparent;
  color: #3c3c43;
  text-align: left;
}

.filter-menu-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.filter-menu-item.active {
  background: rgba(38, 65, 120, 0.08);
  color: #264178;
  font-weight: 600;
}
.theme-orange .filter-menu-item.active {
  background: rgba(221, 133, 60, 0.08);
  color: #DD853C;
}

.filter-menu-check {
  width: 14px;
  text-align: center;
  font-size: 11px;
}

.filter-date-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
}

.filter-date-btn {
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
  transition: background 0.12s;
  padding: 0;
}

.filter-date-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
  color: #3c3c43;
}

.filter-date-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.filter-date-input {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  padding: 3px 5px;
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 5px;
  background: #ffffff;
  color: #3c3c43;
  outline: none;
}

.filter-date-range {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 8px;
}

.filter-date-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.filter-date-label {
  font-size: 11px;
  color: #8e8e93;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.filter-date-sep {
  font-size: 11px;
  color: #aeaeb2;
}

/* ─── Paper feedback buttons ───────────────────────────────────────────────── */

.paper-item-feedback {
  display: flex;
  gap: 1px;
  flex-shrink: 0;
  align-items: center;
}

.feedback-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: #c7c7cc;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  opacity: 0;
  transform: scale(0.7);
  width: 0;
  overflow: hidden;
  transition:
    opacity 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
    transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
    width 0.2s ease,
    background 0.12s,
    color 0.12s;
}

/* Active buttons always visible */
.feedback-btn.active {
  opacity: 1;
  transform: scale(1);
  width: 20px;
}

/* Hover: reveal all buttons with stagger */
.paper-item:hover .feedback-btn,
.paper-item.active .feedback-btn {
  opacity: 1;
  transform: scale(1);
  width: 20px;
}

.paper-item:hover .feedback-btn:nth-child(1),
.paper-item.active .feedback-btn:nth-child(1) { transition-delay: 0ms; }

.paper-item:hover .feedback-btn:nth-child(2),
.paper-item.active .feedback-btn:nth-child(2) { transition-delay: 30ms; }

.paper-item:hover .feedback-btn:nth-child(3),
.paper-item.active .feedback-btn:nth-child(3) { transition-delay: 60ms; }

/* Reset delay on leave */
.paper-item:not(:hover):not(.active) .feedback-btn { transition-delay: 0ms; }

.feedback-btn:hover { background: rgba(221,133,60,0.12); color: #DD853C; }
.feedback-btn.bad:hover { background: rgba(221,133,60,0.10); color: #DD853C; }
.feedback-btn.fav:hover { background: rgba(255,193,7,0.12); color: #f5a623; }
.feedback-btn.active { color: #DD853C; }
.feedback-btn.bad.active { color: #DD853C; }
.feedback-btn.fav.active { color: #f5a623; }

/* ─── Paper list ───────────────────────────────────────────────────────────── */

.list-item.paper-item {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 8px 10px;
}

.list-item.paper-item.unread::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(221,133,60,0.06);
  pointer-events: none;
}

.paper-item-content {
  flex: 1;
  min-width: 0;
  width: 100%;
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
  word-break: break-word;
}

.paper-item.active .paper-item-title { color: #DD853C; font-weight: 600; }

.paper-item-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}

.paper-item-meta-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
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

.paper-item-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
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
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.12s;
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  overflow: hidden;
}

.list-item:hover { background: rgba(0, 0, 0, 0.05); }
.list-item.active { background: rgba(38, 65, 120, 0.14); }
.list-item.selected { background: rgba(38, 65, 120, 0.08); }

.theme-orange .list-item.active { background: rgba(221, 133, 60, 0.14); }
.theme-orange .list-item.selected { background: rgba(221, 133, 60, 0.08); }

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
  border: 1px solid rgba(38, 65, 120, 0.4);
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

.trash-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.trash-item-title {
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: #6e6e73;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trash-item-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
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

.trash-empty {
  font-size: 11px;
  color: #aeaeb2;
  text-align: center;
  padding: 8px 0;
}

.restore-btn { color: #264178; }
.restore-btn:hover { background: rgba(38, 65, 120, 0.12); }
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
