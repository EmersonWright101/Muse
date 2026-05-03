<script setup lang="ts">
import { ref, computed } from 'vue'
import { useTodoStore, type Quadrant, type TodoTask } from '../../../stores/todo'
import {
  Star, Calendar, RotateCcw, ChevronRight, AlertCircle,
  Plus, ChevronDown, ChevronUp, GripVertical,
} from 'lucide-vue-next'

const store = useTodoStore()

// ─── Quadrant config ──────────────────────────────────────────────────────────

const QUADRANTS: Array<{
  key: Quadrant
  label: string
  sub: string
  color: string
  bgColor: string
  borderColor: string
}> = [
  {
    key: 'q1',
    label: '重要 · 紧急',
    sub: '立即处理',
    color: '#ff3b30',
    bgColor: 'rgba(255, 59, 48, 0.04)',
    borderColor: 'rgba(255, 59, 48, 0.18)',
  },
  {
    key: 'q2',
    label: '重要 · 不紧急',
    sub: '计划安排',
    color: '#007aff',
    bgColor: 'rgba(0, 122, 255, 0.04)',
    borderColor: 'rgba(0, 122, 255, 0.18)',
  },
  {
    key: 'q3',
    label: '不重要 · 紧急',
    sub: '委托他人',
    color: '#ff9500',
    bgColor: 'rgba(255, 149, 0, 0.04)',
    borderColor: 'rgba(255, 149, 0, 0.18)',
  },
  {
    key: 'q4',
    label: '不重要 · 不紧急',
    sub: '减少或删除',
    color: '#8e8e93',
    bgColor: 'rgba(142, 142, 147, 0.04)',
    borderColor: 'rgba(142, 142, 147, 0.14)',
  },
]

const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#ff3b30', high: '#ff9500', medium: '#007aff', low: '#34c759', none: 'transparent',
}

// ─── Drag state ───────────────────────────────────────────────────────────────

const draggingId = ref<string | null>(null)
const dragOverZone = ref<Quadrant | 'unassigned' | null>(null)

function onDragStart(e: DragEvent, taskId: string) {
  draggingId.value = taskId
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', taskId)
  }
}

function onDragEnd() {
  draggingId.value = null
  dragOverZone.value = null
}

function onDragOver(e: DragEvent, zone: Quadrant | 'unassigned') {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverZone.value = zone
}

function onDragLeave(e: DragEvent, zone: Quadrant | 'unassigned') {
  // Only clear if truly leaving the zone (not entering a child)
  const related = e.relatedTarget as HTMLElement | null
  if (related && (e.currentTarget as HTMLElement).contains(related)) return
  if (dragOverZone.value === zone) dragOverZone.value = null
}

function onDrop(zone: Quadrant | 'unassigned') {
  if (!draggingId.value) return
  store.setTaskQuadrant(draggingId.value, zone === 'unassigned' ? null : zone)
  draggingId.value = null
  dragOverZone.value = null
}

// ─── Add task inline ──────────────────────────────────────────────────────────

const addingIn = ref<Quadrant | null>(null)
const addTitle = ref('')

function startAdd(q: Quadrant) {
  addingIn.value = q
  addTitle.value = ''
}

function confirmAdd(q: Quadrant) {
  const title = addTitle.value.trim()
  if (title) {
    const task = store.addTask({ title, quadrant: q })
    store.activeTaskId = task.id
  }
  addingIn.value = null
}

function cancelAdd() {
  addingIn.value = null
}

// ─── Unassigned panel ─────────────────────────────────────────────────────────

const unassignedOpen = ref(true)

const filteredUnassigned = computed(() => {
  const q = store.searchQuery.trim().toLowerCase()
  if (!q) return store.unassignedTasks
  return store.unassignedTasks.filter(t =>
    t.title.toLowerCase().includes(q) ||
    t.tags.some(tag => tag.toLowerCase().includes(q))
  )
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: string): string {
  const today = store.todayStr
  if (d === today) return '今天'
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
  if (d === tomorrow.toISOString().slice(0, 10)) return '明天'
  return d.slice(5).replace('-', '/')
}

function isOverdue(task: TodoTask): boolean {
  return !!task.dueDate && !task.completed && task.dueDate < store.todayStr
}

function getQuadrantTasks(q: Quadrant) {
  const q$ = store.getQuadrantTasks(q)
  const sq = store.searchQuery.trim().toLowerCase()
  if (!sq) return q$
  return q$.filter(t =>
    t.title.toLowerCase().includes(sq) ||
    t.tags.some(tag => tag.toLowerCase().includes(sq))
  )
}
</script>

<template>
  <div class="quadrant-root">
    <div class="quadrant-body">
      <!-- Top axis label (紧急 ↔ 不紧急) -->
      <div class="axis-x-row">
        <div class="axis-x-label left">
          <div class="axis-arrow axis-arrow--left" />
          紧急
        </div>
        <div class="axis-x-divider" />
        <div class="axis-x-label right">
          不紧急
          <div class="axis-arrow axis-arrow--right" />
        </div>
      </div>

      <!-- 2×2 grid -->
      <div class="quadrant-grid">
        <div
          v-for="q in QUADRANTS"
          :key="q.key"
          class="quadrant-cell"
          :class="{ 'drag-over': dragOverZone === q.key }"
          :style="{
            background: dragOverZone === q.key ? q.bgColor.replace('0.04', '0.10') : q.bgColor,
            borderColor: dragOverZone === q.key ? q.color : q.borderColor,
          }"
          @dragover="onDragOver($event, q.key)"
          @dragleave="onDragLeave($event, q.key)"
          @drop="onDrop(q.key)"
        >
          <!-- Cell header -->
          <div class="cell-header" :style="{ borderBottomColor: q.borderColor }">
            <div class="cell-badge" :style="{ background: q.color + '18', color: q.color }">
              {{ q.key.toUpperCase() }}
            </div>
            <div class="cell-title-wrap">
              <span class="cell-title" :style="{ color: q.color }">{{ q.label }}</span>
              <span class="cell-sub">{{ q.sub }}</span>
            </div>
            <span class="cell-count">{{ getQuadrantTasks(q.key).length }}</span>
            <button class="cell-add-btn" :style="{ color: q.color }" title="添加任务" @click="startAdd(q.key)">
              <Plus :size="13" />
            </button>
          </div>

          <!-- Task list -->
          <div class="cell-tasks">
            <!-- Inline add input -->
            <div v-if="addingIn === q.key" class="inline-add">
              <input
                class="inline-add-input"
                v-model="addTitle"
                placeholder="任务标题…"
                @keydown.enter="confirmAdd(q.key)"
                @keydown.escape="cancelAdd"
                @blur="confirmAdd(q.key)"
                autofocus
              />
            </div>

            <div
              v-for="task in getQuadrantTasks(q.key)"
              :key="task.id"
              class="quadrant-card"
              :class="{
                active: store.activeTaskId === task.id,
                dragging: draggingId === task.id,
                overdue: isOverdue(task),
              }"
              draggable="true"
              @dragstart="onDragStart($event, task.id)"
              @dragend="onDragEnd"
              @click="store.activeTaskId = task.id"
            >
              <div class="card-drag-handle">
                <GripVertical :size="12" />
              </div>

              <!-- Priority indicator -->
              <div
                v-if="task.priority !== 'none'"
                class="card-priority-dot"
                :style="{ background: PRIORITY_COLOR[task.priority] }"
              />

              <div class="card-content">
                <!-- Checkbox -->
                <button
                  class="card-check"
                  :class="{ checked: task.completed }"
                  @click.stop="store.toggleComplete(task.id)"
                >
                  <svg v-if="task.completed" viewBox="0 0 16 16" fill="none" width="9" height="9">
                    <path d="M3.5 8l3 3 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>

                <div class="card-body">
                  <span class="card-title" :class="{ done: task.completed }">
                    {{ task.title || '无标题' }}
                  </span>
                  <div class="card-meta">
                    <span v-if="task.dueDate" class="meta-item" :class="{ overdue: isOverdue(task) }">
                      <Calendar :size="9" />
                      {{ formatDate(task.dueDate) }}
                    </span>
                    <span v-if="task.starred" class="meta-item star">
                      <Star :size="9" fill="#ff9500" color="#ff9500" />
                    </span>
                    <span v-if="task.recurrence !== 'none'" class="meta-item">
                      <RotateCcw :size="9" />
                    </span>
                    <span v-if="task.subtasks.length" class="meta-item">
                      <ChevronRight :size="9" />
                      {{ task.subtasks.filter(s => s.completed).length }}/{{ task.subtasks.length }}
                    </span>
                    <span v-if="isOverdue(task)" class="meta-item overdue-badge">
                      <AlertCircle :size="9" />
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Empty placeholder -->
            <div v-if="getQuadrantTasks(q.key).length === 0 && addingIn !== q.key" class="cell-empty">
              拖入任务或点击 + 添加
            </div>
          </div>
        </div>
      </div>

      <!-- Unassigned panel -->
      <div
        class="unassigned-panel"
        :class="{ 'drag-over': dragOverZone === 'unassigned' }"
        @dragover="onDragOver($event, 'unassigned')"
        @dragleave="onDragLeave($event, 'unassigned')"
        @drop="onDrop('unassigned')"
      >
        <button class="unassigned-header" @click="unassignedOpen = !unassignedOpen">
          <component :is="unassignedOpen ? ChevronDown : ChevronUp" :size="13" />
          <span class="unassigned-title">待分配</span>
          <span class="unassigned-count">{{ filteredUnassigned.length }}</span>
          <span class="unassigned-hint">拖到四象限分配</span>
        </button>

        <div v-if="unassignedOpen" class="unassigned-list">
          <div
            v-for="task in filteredUnassigned"
            :key="task.id"
            class="unassigned-card"
            :class="{
              active: store.activeTaskId === task.id,
              dragging: draggingId === task.id,
            }"
            draggable="true"
            @dragstart="onDragStart($event, task.id)"
            @dragend="onDragEnd"
            @click="store.activeTaskId = task.id"
          >
            <div class="card-drag-handle">
              <GripVertical :size="12" />
            </div>
            <div
              v-if="task.priority !== 'none'"
              class="card-priority-dot"
              :style="{ background: PRIORITY_COLOR[task.priority] }"
            />
            <button
              class="card-check"
              :class="{ checked: task.completed }"
              @click.stop="store.toggleComplete(task.id)"
            >
              <svg v-if="task.completed" viewBox="0 0 16 16" fill="none" width="9" height="9">
                <path d="M3.5 8l3 3 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <span class="card-title unassigned-task-title" :class="{ done: task.completed }">
              {{ task.title || '无标题' }}
            </span>
            <span v-if="task.dueDate" class="meta-item" :class="{ overdue: isOverdue(task) }" style="margin-left:4px">
              <Calendar :size="9" />
              {{ formatDate(task.dueDate) }}
            </span>
          </div>
          <div v-if="filteredUnassigned.length === 0" class="unassigned-empty">
            所有任务已分配 🎉
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.quadrant-root {
  display: flex;
  height: 100%;
  overflow: hidden;
  gap: 0;
}

.axis-arrow--left {
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-right: 6px solid rgba(0, 0, 0, 0.18);
}

.axis-arrow--right {
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 6px solid rgba(0, 0, 0, 0.18);
}

/* ─── Body ─────────────────────────────────────────────────────────────────── */
.quadrant-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 8px 12px 8px 4px;
  gap: 6px;
}

/* ─── X-axis row ───────────────────────────────────────────────────────────── */
.axis-x-row {
  display: flex;
  align-items: center;
  height: 22px;
  flex-shrink: 0;
  user-select: none;
}

.axis-x-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  flex: 1;
  letter-spacing: 0.5px;
}

.axis-x-label.right {
  justify-content: flex-end;
}

.axis-x-divider {
  width: 1px;
  height: 100%;
  background: rgba(0, 0, 0, 0.10);
  margin: 0 8px;
}

/* ─── Grid ─────────────────────────────────────────────────────────────────── */
.quadrant-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

.quadrant-cell {
  border-radius: 12px;
  border: 1.5px solid;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.quadrant-cell.drag-over {
  box-shadow: 0 0 0 2px currentColor inset;
}

/* ─── Cell header ──────────────────────────────────────────────────────────── */
.cell-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  border-bottom: 1px solid;
  flex-shrink: 0;
}

.cell-badge {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 800;
  flex-shrink: 0;
}

.cell-title-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.cell-title {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
}

.cell-sub {
  font-size: 10px;
  color: #8e8e93;
  line-height: 1;
}

.cell-count {
  font-size: 11px;
  color: #8e8e93;
  flex-shrink: 0;
}

.cell-add-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s;
  flex-shrink: 0;
  opacity: 0.6;
}

.cell-add-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  opacity: 1;
}

/* ─── Cell tasks ───────────────────────────────────────────────────────────── */
.cell-tasks {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cell-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #c7c7cc;
  pointer-events: none;
  padding: 10px;
  text-align: center;
}

/* ─── Inline add ───────────────────────────────────────────────────────────── */
.inline-add {
  background: white;
  border-radius: 8px;
  border: 1px solid rgba(34, 63, 121, 0.25);
  padding: 5px 8px;
}

.inline-add-input {
  width: 100%;
  border: none;
  outline: none;
  font-size: 12px;
  color: #1c1c1e;
  background: transparent;
}

.inline-add-input::placeholder {
  color: #c7c7cc;
}

/* ─── Quadrant card ────────────────────────────────────────────────────────── */
.quadrant-card {
  background: white;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  padding: 6px 8px;
  cursor: grab;
  display: flex;
  align-items: flex-start;
  gap: 5px;
  transition: box-shadow 0.12s, opacity 0.12s, transform 0.12s;
  position: relative;
}

.quadrant-card:active {
  cursor: grabbing;
}

.quadrant-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.quadrant-card.active {
  border-color: rgba(34, 63, 121, 0.30);
  background: rgba(34, 63, 121, 0.03);
}

.quadrant-card.dragging {
  opacity: 0.4;
  transform: scale(0.97);
}

.quadrant-card.overdue {
  border-left: 2px solid #ff3b30;
}

/* ─── Card internals ───────────────────────────────────────────────────────── */
.card-drag-handle {
  color: #c7c7cc;
  cursor: grab;
  flex-shrink: 0;
  margin-top: 1px;
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity 0.1s;
}

.quadrant-card:hover .card-drag-handle {
  opacity: 1;
}

.card-priority-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 5px;
}

.card-content {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.card-check {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 1.5px solid #c7c7cc;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
  padding: 0;
  transition: border-color 0.12s, background 0.12s;
  color: transparent;
}

.card-check:hover {
  border-color: #34c759;
}

.card-check.checked {
  background: #34c759;
  border-color: #34c759;
  color: white;
}

.card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.card-title {
  font-size: 12px;
  color: #1c1c1e;
  font-weight: 500;
  line-height: 1.35;
  word-break: break-word;
}

.card-title.done {
  text-decoration: line-through;
  color: #8e8e93;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: #8e8e93;
}

.meta-item.overdue {
  color: #ff3b30;
}

.overdue-badge {
  color: #ff3b30;
}

/* ─── Unassigned panel ─────────────────────────────────────────────────────── */
.unassigned-panel {
  flex-shrink: 0;
  border-radius: 10px;
  border: 1.5px dashed rgba(0, 0, 0, 0.12);
  background: rgba(0, 0, 0, 0.015);
  transition: border-color 0.15s, background 0.15s;
  max-height: 180px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.unassigned-panel.drag-over {
  border-color: rgba(34, 63, 121, 0.45);
  background: rgba(34, 63, 121, 0.04);
}

.unassigned-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  flex-shrink: 0;
  color: #3c3c43;
}

.unassigned-title {
  font-size: 12px;
  font-weight: 600;
  color: #1c1c1e;
}

.unassigned-count {
  font-size: 11px;
  color: #8e8e93;
  margin-right: auto;
}

.unassigned-hint {
  font-size: 10px;
  color: #c7c7cc;
}

.unassigned-list {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 8px;
}

.unassigned-card {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 5px 9px;
  white-space: nowrap;
  cursor: grab;
  flex-shrink: 0;
  transition: box-shadow 0.1s, opacity 0.12s, transform 0.12s;
}

.unassigned-card:active {
  cursor: grabbing;
}

.unassigned-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.unassigned-card.active {
  border-color: rgba(34, 63, 121, 0.30);
  background: rgba(34, 63, 121, 0.03);
}

.unassigned-card.dragging {
  opacity: 0.4;
  transform: scale(0.95);
}

.unassigned-task-title {
  font-size: 12px;
  color: #1c1c1e;
  font-weight: 500;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.unassigned-task-title.done {
  text-decoration: line-through;
  color: #8e8e93;
}

.unassigned-empty {
  font-size: 12px;
  color: #8e8e93;
  padding: 4px;
}
</style>
