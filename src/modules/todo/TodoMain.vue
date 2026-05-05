<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useTodoStore } from '../../stores/todo'
import TaskItem from './components/TaskItem.vue'
import TaskDetail from './components/TaskDetail.vue'
import CalendarView from './components/CalendarView.vue'
import KanbanView from './components/KanbanView.vue'
import QuadrantView from './components/QuadrantView.vue'
import {
  Plus, Search, LayoutList, Calendar, Columns3, Grid2x2,
  ArrowUpDown, SortAsc, Clock, AlignLeft, Star,
  CheckSquare2, Eye, EyeOff, Bell,
} from 'lucide-vue-next'
import type { TodoTask } from '../../stores/todo'
import { useTodoNotifications } from './composables/useTodoNotifications'
import TimePickerInput from './components/TimePickerInput.vue'

const store = useTodoStore()
useTodoNotifications()

onMounted(() => store.load())

// ─── New task ─────────────────────────────────────────────────────────────────

const newTaskTitle = ref('')
const newTaskInputRef = ref<HTMLInputElement>()
const showTaskOptions = ref(false)
const newTaskDate = ref('')
const newTaskTime = ref<string | null>(null)
const newTaskReminder = ref<number | null>(null)

const REMINDER_OPTIONS = [
  { value: null,  label: '不提醒' },
  { value: 5,     label: '5 分钟前' },
  { value: 10,    label: '10 分钟前' },
  { value: 15,    label: '15 分钟前' },
  { value: 30,    label: '30 分钟前' },
  { value: 60,    label: '1 小时前' },
  { value: 120,   label: '2 小时前' },
  { value: 1440,  label: '1 天前' },
]

async function createTask() {
  const title = newTaskTitle.value.trim()
  if (!title) return
  const task = store.addTask({
    title,
    dueDate: newTaskDate.value || undefined,
    dueTime: newTaskTime.value ?? undefined,
    reminderMinutes: newTaskReminder.value,
  })
  newTaskTitle.value = ''
  await nextTick()
  store.activeTaskId = task.id
}

function onNewTaskKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') createTask()
  if (e.key === 'Escape') { newTaskTitle.value = ''; newTaskInputRef.value?.blur() }
}

// ─── Filter label ─────────────────────────────────────────────────────────────

const SMART_LABELS: Record<string, string> = {
  today: '今天', upcoming: '即将到来', starred: '已标记', inbox: '收件箱',
  all: '全部任务', completed: '已完成',
}

const filterLabel = computed(() => {
  const f = store.activeFilter
  if (SMART_LABELS[f]) return SMART_LABELS[f]
  const p = store.projects.find(p => p.id === f)
  return p?.name ?? '任务'
})

// ─── Sort options ─────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { key: 'manual',    label: '手动排序',   icon: ArrowUpDown },
  { key: 'priority',  label: '按优先级',   icon: Star },
  { key: 'dueDate',   label: '按截止日期', icon: Clock },
  { key: 'createdAt', label: '按创建时间', icon: Clock },
  { key: 'title',     label: '按名称',     icon: SortAsc },
] as const

const showSortMenu = ref(false)

// ─── View mode icons ──────────────────────────────────────────────────────────

const VIEW_ICONS = [
  { key: 'list',      icon: LayoutList, title: '列表' },
  { key: 'calendar',  icon: Calendar,   title: '日历' },
  { key: 'kanban',    icon: Columns3,   title: '看板' },
  { key: 'quadrant',  icon: Grid2x2,    title: '四象限' },
] as const

// ─── Group by section ─────────────────────────────────────────────────────────

interface Group { label: string; tasks: TodoTask[] }

const groups = computed((): Group[] => {
  const tasks = store.filteredTasks
  if (store.viewMode !== 'list') return [{ label: '', tasks }]

  // For "today" group by overdue / today / starred
  if (store.activeFilter === 'today') {
    const overdue = tasks.filter(t => t.dueDate && t.dueDate < store.todayStr && !t.completed)
    const today   = tasks.filter(t => t.dueDate === store.todayStr && !t.completed)
    const starred = tasks.filter(t => !t.dueDate && t.starred && !t.completed)
    const result: Group[] = []
    if (overdue.length) result.push({ label: '逾期', tasks: overdue })
    if (today.length)   result.push({ label: '今天', tasks: today })
    if (starred.length) result.push({ label: '已标记', tasks: starred })
    return result.length ? result : [{ label: '', tasks }]
  }

  return [{ label: '', tasks }]
})

const completedTasks = computed(() =>
  store.tasks.filter(t => t.completed && (
    store.activeFilter === 'completed' ||
    store.activeFilter === 'all' ||
    (store.activeFilter === 'today' && t.completedAt?.startsWith(store.todayStr)) ||
    (!['inbox','today','upcoming','starred','all','completed'].includes(store.activeFilter) && t.projectId === store.activeFilter)
  ))
)

const showCompletedSection = ref(false)

// ─── Right panel (overview when no task selected) ─────────────────────────────

const showRightPanel = computed(() => store.viewMode === 'list')

const todayDoneTasks = computed(() =>
  store.tasks.filter(t => t.completedAt?.startsWith(store.todayStr))
)
const todayPendingTasks = computed(() =>
  store.tasks.filter(t => t.dueDate === store.todayStr && !t.completed)
)
const overdueTasks = computed(() =>
  store.tasks.filter(t => !!t.dueDate && t.dueDate < store.todayStr && !t.completed)
)
const upcomingCount = computed(() =>
  store.tasks.filter(t => !!t.dueDate && t.dueDate > store.todayStr && !t.completed).length
)
const totalToday = computed(() => todayDoneTasks.value.length + todayPendingTasks.value.length)
const progressPct = computed(() =>
  totalToday.value === 0 ? 0 : Math.round((todayDoneTasks.value.length / totalToday.value) * 100)
)
// SVG circle: r=40, circumference = 2π×40 ≈ 251.2
const CIRCUM = 251.2
const strokeDash = computed(() => `${(progressPct.value / 100) * CIRCUM} ${CIRCUM}`)

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return '早上好'
  if (h < 18) return '下午好'
  return '晚上好'
}

const dateLabel = computed(() => {
  const d = new Date()
  const weekdays = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六']
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`
})

const starredTasks = computed(() =>
  store.tasks.filter(t => t.starred && !t.completed)
)

// ─── API error toast ──────────────────────────────────────────────────────────

const apiErrorToast = ref<string | null>(null)
let _errorToastTimer: ReturnType<typeof setTimeout> | null = null

watch(() => store.apiError, (msg) => {
  if (!msg) return
  apiErrorToast.value = msg
  if (_errorToastTimer) clearTimeout(_errorToastTimer)
  _errorToastTimer = setTimeout(() => { apiErrorToast.value = null }, 4000)
})

</script>

<template>
  <div class="todo-main">
    <!-- List / Calendar / Kanban / Quadrant panel -->
    <div class="main-panel" :class="{ narrow: showRightPanel }">
      <!-- Toolbar -->
      <div class="toolbar">
        <h1 class="view-title">{{ filterLabel }}</h1>

        <div class="toolbar-right">
          <!-- Search -->
          <div class="search-wrap">
            <Search :size="13" class="search-icon" />
            <input
              v-model="store.searchQuery"
              class="search-input"
              placeholder="搜索…"
            />
          </div>

          <!-- View mode toggle -->
          <div class="view-toggle">
            <button
              v-for="v in VIEW_ICONS"
              :key="v.key"
              class="toggle-btn"
              :class="{ active: store.viewMode === v.key }"
              :title="v.title"
              @click="store.viewMode = v.key"
            >
              <component :is="v.icon" :size="14" />
            </button>
          </div>

          <!-- Sort -->
          <div class="sort-wrap" v-if="store.viewMode === 'list' || store.viewMode === 'kanban'">
            <button class="icon-action-btn" title="排序" @click="showSortMenu = !showSortMenu">
              <AlignLeft :size="14" />
            </button>
            <div v-if="showSortMenu" class="sort-menu" @click.stop>
              <button
                v-for="s in SORT_OPTIONS"
                :key="s.key"
                class="sort-item"
                :class="{ active: store.sortMode === s.key }"
                @click="store.sortMode = s.key; showSortMenu = false"
              >
                <component :is="s.icon" :size="12" />
                {{ s.label }}
              </button>
            </div>
          </div>

          <!-- Show completed toggle -->
          <button
            v-if="(store.viewMode === 'list' || store.viewMode === 'kanban') && store.activeFilter !== 'completed'"
            class="icon-action-btn"
            :class="{ active: store.showCompleted }"
            title="显示已完成"
            @click="store.showCompleted = !store.showCompleted"
          >
            <component :is="store.showCompleted ? Eye : EyeOff" :size="14" />
          </button>
        </div>
      </div>

      <!-- Content -->
      <div class="content-area" @click="showSortMenu = false">

        <!-- Calendar view -->
        <CalendarView v-if="store.viewMode === 'calendar'" />

        <!-- Kanban view -->
        <KanbanView v-else-if="store.viewMode === 'kanban'" />

        <!-- Quadrant view -->
        <QuadrantView v-else-if="store.viewMode === 'quadrant'" />

        <!-- List view -->
        <template v-else>
          <div class="list-container">
            <!-- Add task bar -->
            <div v-if="store.activeFilter !== 'completed'" class="add-task-bar">
              <button class="add-plus" @click="createTask">
                <Plus :size="14" />
              </button>
              <input
                ref="newTaskInputRef"
                v-model="newTaskTitle"
                class="add-task-input"
                placeholder="添加新任务…"
                @keydown="onNewTaskKeydown"
              />
              <button
                class="add-options-btn"
                :class="{ active: showTaskOptions }"
                title="设置日期和提醒"
                @click="showTaskOptions = !showTaskOptions"
              >
                <Calendar :size="13" />
              </button>
            </div>

            <!-- Expandable date / time / reminder options -->
            <div v-if="showTaskOptions && store.activeFilter !== 'completed'" class="add-task-options">
              <div class="opt-row" title="截止日期">
                <Calendar :size="12" class="opt-icon" />
                <input type="date" v-model="newTaskDate" class="opt-date-input" />
              </div>
              <div class="opt-row" title="截止时间">
                <Clock :size="12" class="opt-icon" />
                <TimePickerInput v-model="newTaskTime" />
              </div>
              <div class="opt-row" title="提前提醒">
                <Bell :size="12" class="opt-icon" />
                <select
                  class="opt-select"
                  :value="newTaskReminder ?? ''"
                  @change="e => newTaskReminder = (e.target as HTMLSelectElement).value ? Number((e.target as HTMLSelectElement).value) : null"
                >
                  <option v-for="o in REMINDER_OPTIONS" :key="String(o.value)" :value="o.value ?? ''">{{ o.label }}</option>
                </select>
              </div>
            </div>

            <!-- Empty state -->
            <div
              v-if="store.isLoading"
              class="empty-state"
            >加载中…</div>

            <template v-else>
              <template v-if="groups.every(g => g.tasks.length === 0) && !store.isLoading">
                <div class="empty-state">
                  <CheckSquare2 :size="36" class="empty-icon" />
                  <span>{{ store.searchQuery ? '没有找到匹配的任务' : '没有任务，放松一下吧 ☀️' }}</span>
                </div>
              </template>

              <template v-else>
                <div v-for="group in groups" :key="group.label" class="task-group">
                  <div v-if="group.label" class="group-header">{{ group.label }}</div>
                  <div class="task-list">
                    <TaskItem
                      v-for="task in group.tasks"
                      :key="task.id"
                      :task="task"
                    />
                  </div>
                </div>
              </template>

              <!-- Completed section -->
              <div
                v-if="completedTasks.length > 0 && store.activeFilter !== 'completed' && !store.showCompleted"
                class="completed-toggle"
                @click="showCompletedSection = !showCompletedSection"
              >
                <CheckSquare2 :size="13" />
                已完成 {{ completedTasks.length }}
                <span class="toggle-arrow" :class="{ open: showCompletedSection }">▾</span>
              </div>

              <div v-if="showCompletedSection && store.activeFilter !== 'completed'" class="task-list completed-list">
                <TaskItem
                  v-for="task in completedTasks"
                  :key="task.id"
                  :task="task"
                />
              </div>
            </template>
          </div>
        </template>
      </div>
    </div>

    <!-- Right panel: task detail OR overview -->
    <div v-if="showRightPanel" class="right-panel">
      <!-- Task detail -->
      <TaskDetail v-if="store.activeTaskId" />

      <!-- Overview (no task selected) -->
      <div v-else class="overview-panel">
        <!-- Greeting -->
        <div class="ov-greeting">
          <span class="ov-hello">{{ greeting() }}</span>
          <span class="ov-date">{{ dateLabel }}</span>
        </div>

        <!-- Progress ring card -->
        <div class="ov-card ov-progress-card">
          <div class="ov-progress-ring-wrap">
            <svg class="ov-ring" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" class="ring-bg" />
              <circle
                cx="50" cy="50" r="40"
                class="ring-fill"
                :style="{ strokeDasharray: strokeDash, stroke: progressPct === 100 ? '#34c759' : '#223F79' }"
              />
            </svg>
            <div class="ov-ring-center">
              <span class="ov-ring-pct">{{ progressPct }}%</span>
              <span class="ov-ring-label">完成</span>
            </div>
          </div>
          <div class="ov-progress-info">
            <div class="ov-progress-title">今日进度</div>
            <div class="ov-progress-sub">
              {{ todayDoneTasks.length }} / {{ totalToday }} 个任务已完成
            </div>
            <div class="ov-progress-bar-wrap">
              <div
                class="ov-progress-bar"
                :style="{ width: progressPct + '%', background: progressPct === 100 ? '#34c759' : '#223F79' }"
              />
            </div>
          </div>
        </div>

        <!-- Stats grid -->
        <div class="ov-stats-grid">
          <div
            class="ov-stat-card"
            :class="{ clickable: overdueTasks.length > 0 }"
            @click="overdueTasks.length && (store.activeFilter = 'today')"
          >
            <div class="ov-stat-num" :style="{ color: overdueTasks.length > 0 ? '#ff3b30' : '#1c1c1e' }">
              {{ overdueTasks.length }}
            </div>
            <div class="ov-stat-label" :style="{ color: overdueTasks.length > 0 ? '#ff3b30' : '#8e8e93' }">
              逾期
            </div>
          </div>
          <div class="ov-stat-card clickable" @click="store.activeFilter = 'today'">
            <div class="ov-stat-num" style="color:#007aff">{{ todayPendingTasks.length }}</div>
            <div class="ov-stat-label">今天待办</div>
          </div>
          <div class="ov-stat-card clickable" @click="store.activeFilter = 'upcoming'">
            <div class="ov-stat-num" style="color:#ff9500">{{ upcomingCount }}</div>
            <div class="ov-stat-label">即将到来</div>
          </div>
          <div class="ov-stat-card clickable" @click="store.activeFilter = 'starred'">
            <div class="ov-stat-num" style="color:#5856d6">{{ starredTasks.length }}</div>
            <div class="ov-stat-label">已标记</div>
          </div>
        </div>

        <!-- Top priority tasks -->
        <div v-if="overdueTasks.length > 0 || todayPendingTasks.length > 0" class="ov-card ov-focus-card">
          <div class="ov-focus-header">
            <span class="ov-focus-title">需要关注</span>
          </div>
          <div class="ov-focus-list">
            <div
              v-for="task in [...overdueTasks, ...todayPendingTasks].slice(0, 5)"
              :key="task.id"
              class="ov-focus-item"
              @click="store.activeTaskId = task.id"
            >
              <div
                class="ov-focus-dot"
                :style="{ background: task.dueDate && task.dueDate < store.todayStr ? '#ff3b30' : '#007aff' }"
              />
              <span class="ov-focus-text">{{ task.title || '无标题' }}</span>
              <span v-if="task.dueDate && task.dueDate < store.todayStr" class="ov-focus-tag overdue">逾期</span>
              <span v-else-if="task.priority === 'urgent'" class="ov-focus-tag urgent">紧急</span>
            </div>
          </div>
        </div>

        <!-- All done state -->
        <div v-if="totalToday > 0 && progressPct === 100" class="ov-done-banner">
          🎉 今日任务全部完成！
        </div>

        <!-- Footer tip -->
        <div class="ov-tip">
          点击任意任务查看详情 · 拖入四象限规划优先级
        </div>
      </div>
    </div>

    <!-- API error toast -->
    <Transition name="api-toast">
      <div v-if="apiErrorToast" class="api-error-toast">
        {{ apiErrorToast }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.todo-main {
  flex: 1;
  width: 100%;
  display: flex;
  height: 100%;
  overflow: hidden;
  background: #ffffff;
  position: relative;
}

.main-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.main-panel.narrow {
  flex: 0 0 360px;
  min-width: 0;
  border-right: 1px solid rgba(0, 0, 0, 0.06);
}

/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  background: rgba(255, 255, 255, 0.95);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
  gap: 12px;
}

.view-title {
  font-size: 20px;
  font-weight: 700;
  color: #1c1c1e;
  margin: 0;
  white-space: nowrap;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.search-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 5px 10px;
}

.search-icon {
  color: #8e8e93;
  flex-shrink: 0;
}

.search-input {
  border: none;
  outline: none;
  font-size: 12px;
  color: #1c1c1e;
  background: transparent;
  width: 120px;
}

.search-input::placeholder {
  color: #c7c7cc;
}

.view-toggle {
  display: flex;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  padding: 2px;
  gap: 1px;
}

.toggle-btn {
  width: 28px;
  height: 26px;
  border: none;
  background: transparent;
  color: #8e8e93;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
}

.toggle-btn:hover {
  color: #1c1c1e;
}

.toggle-btn.active {
  background: white;
  color: #223F79;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.10);
}

.icon-action-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  color: #8e8e93;
  cursor: pointer;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s, color 0.1s;
}

.icon-action-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #1c1c1e;
}

.icon-action-btn.active {
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
}

.sort-wrap {
  position: relative;
}

.sort-menu {
  position: absolute;
  right: 0;
  top: 36px;
  z-index: 50;
  background: rgba(255, 255, 255, 0.97);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  padding: 5px;
  min-width: 140px;
}

.sort-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  color: #1c1c1e;
  cursor: pointer;
  transition: background 0.1s;
  white-space: nowrap;
}

.sort-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.sort-item.active {
  color: #223F79;
  font-weight: 500;
}

/* Content area */
.content-area {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.list-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Add task bar */
.add-task-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  padding: 8px 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  margin-bottom: 4px;
  flex-shrink: 0;
}

.add-plus {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.1s;
}

.add-plus:hover {
  background: rgba(34, 63, 121, 0.18);
}

.add-task-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 13px;
  color: #1c1c1e;
  background: transparent;
}

.add-task-input::placeholder {
  color: #c7c7cc;
}

.add-options-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: #8e8e93;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.1s, color 0.1s;
}

.add-options-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #1c1c1e;
}

.add-options-btn.active {
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
}

.add-task-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 7px 12px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 10px;
  margin-bottom: 4px;
  flex-shrink: 0;
}

.opt-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.opt-icon {
  color: #8e8e93;
  flex-shrink: 0;
}

.opt-date-input {
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 12px;
  color: #1c1c1e;
  background: rgba(0, 0, 0, 0.02);
  outline: none;
  cursor: pointer;
  max-width: 120px;
}

.opt-date-input:focus {
  border-color: #223F79;
}

.opt-select {
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 12px;
  color: #1c1c1e;
  background: rgba(0, 0, 0, 0.02);
  outline: none;
  cursor: pointer;
}

/* Task groups */
.task-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.group-header {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 8px 2px 4px;
}

.task-list {
  background: white;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
  overflow: hidden;
  padding: 4px;
}

.completed-list {
  margin-top: 4px;
}

.completed-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #8e8e93;
  cursor: pointer;
  padding: 8px 4px 4px;
  transition: color 0.1s;
  user-select: none;
}

.completed-toggle:hover {
  color: #3c3c43;
}

.toggle-arrow {
  transition: transform 0.2s;
  display: inline-block;
  margin-left: 2px;
}

.toggle-arrow.open {
  transform: rotate(180deg);
}

/* Empty state */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 14px;
  color: #8e8e93;
  padding: 60px 20px;
}

.empty-icon {
  color: #c7c7cc;
}

/* ─── Right panel ──────────────────────────────────────────────────────────── */
.right-panel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ─── Overview (no task selected) ─────────────────────────────────────────── */
.overview-panel {
  flex: 1;
  overflow-y: auto;
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: #ffffff;
}

.ov-greeting {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ov-hello {
  font-size: 22px;
  font-weight: 700;
  color: #1c1c1e;
  line-height: 1.2;
}

.ov-date {
  font-size: 13px;
  color: #8e8e93;
}

.ov-card {
  background: white;
  border-radius: 16px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
}

/* Progress ring card */
.ov-progress-card {
  padding: 18px;
  display: flex;
  align-items: center;
  gap: 18px;
}

.ov-progress-ring-wrap {
  position: relative;
  width: 80px;
  height: 80px;
  flex-shrink: 0;
}

.ov-ring {
  width: 80px;
  height: 80px;
  transform: rotate(-90deg);
}

.ring-bg {
  fill: none;
  stroke: rgba(0, 0, 0, 0.07);
  stroke-width: 8;
}

.ring-fill {
  fill: none;
  stroke-width: 8;
  stroke-linecap: round;
  transition: stroke-dasharray 0.6s ease, stroke 0.4s ease;
}

.ov-ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
}

.ov-ring-pct {
  font-size: 16px;
  font-weight: 700;
  color: #1c1c1e;
  line-height: 1;
}

.ov-ring-label {
  font-size: 10px;
  color: #8e8e93;
}

.ov-progress-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ov-progress-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
}

.ov-progress-sub {
  font-size: 12px;
  color: #8e8e93;
}

.ov-progress-bar-wrap {
  height: 4px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 2px;
  overflow: hidden;
}

.ov-progress-bar {
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease, background 0.3s ease;
  min-width: 2px;
}

/* Stats grid */
.ov-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.ov-stat-card {
  background: white;
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: transform 0.12s, box-shadow 0.12s;
}

.ov-stat-card.clickable {
  cursor: pointer;
}

.ov-stat-card.clickable:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.ov-stat-num {
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
}

.ov-stat-label {
  font-size: 11px;
  color: #8e8e93;
}

/* Focus card */
.ov-focus-card {
  overflow: hidden;
}

.ov-focus-header {
  padding: 12px 16px 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.ov-focus-title {
  font-size: 13px;
  font-weight: 600;
  color: #1c1c1e;
}

.ov-focus-list {
  display: flex;
  flex-direction: column;
}

.ov-focus-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  cursor: pointer;
  transition: background 0.1s;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
}

.ov-focus-item:last-child { border-bottom: none; }

.ov-focus-item:hover {
  background: rgba(0, 0, 0, 0.025);
}

.ov-focus-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ov-focus-text {
  flex: 1;
  font-size: 12px;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ov-focus-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  flex-shrink: 0;
  font-weight: 500;
}

.ov-focus-tag.overdue {
  background: rgba(255, 59, 48, 0.10);
  color: #ff3b30;
}

.ov-focus-tag.urgent {
  background: rgba(255, 149, 0, 0.10);
  color: #ff9500;
}

/* Done banner */
.ov-done-banner {
  background: linear-gradient(135deg, rgba(52, 199, 89, 0.12), rgba(0, 122, 255, 0.08));
  border: 1px solid rgba(52, 199, 89, 0.2);
  border-radius: 14px;
  padding: 14px 18px;
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  text-align: center;
}

/* Footer tip */
.ov-tip {
  font-size: 11px;
  color: #c7c7cc;
  text-align: center;
  padding: 4px 0 8px;
}

.api-error-toast {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #ff3b30;
  color: #fff;
  font-size: 13px;
  padding: 9px 18px;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  max-width: 480px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  z-index: 999;
}

.api-toast-enter-active,
.api-toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.api-toast-enter-from,
.api-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
