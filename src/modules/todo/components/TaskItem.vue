<script setup lang="ts">
import { ref, computed } from 'vue'
import { Star, ChevronRight, Calendar, Tag, RotateCcw, AlertCircle } from 'lucide-vue-next'
import { useTodoStore, type TodoTask } from '../../../stores/todo'
import TaskContextMenu from './TaskContextMenu.vue'

const props = defineProps<{ task: TodoTask; compact?: boolean }>()
const store = useTodoStore()

const ctxMenu = ref<{ x: number; y: number } | null>(null)

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  // Clamp so menu doesn't go off-screen
  const x = Math.min(e.clientX, window.innerWidth  - 180)
  const y = Math.min(e.clientY, window.innerHeight - 240)
  ctxMenu.value = { x, y }
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#ff3b30',
  high:   '#ff9500',
  medium: '#007aff',
  low:    '#34c759',
  none:   'transparent',
}

const priorityColor = computed(() => PRIORITY_COLOR[props.task.priority] ?? 'transparent')
const isActive = computed(() => store.activeTaskId === props.task.id)
const isOverdue = computed(() => {
  if (!props.task.dueDate || props.task.completed) return false
  return props.task.dueDate < store.todayStr
})

const subtaskDone = computed(() => props.task.subtasks.filter(s => s.completed).length)
const subtaskTotal = computed(() => props.task.subtasks.length)

function formatDate(d: string): string {
  const today = store.todayStr
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)
  if (d === today) return '今天'
  if (d === tomorrowStr) return '明天'
  return d.slice(5).replace('-', '/')
}
</script>

<template>
  <div
    class="task-item"
    :class="{ active: isActive, completed: task.completed, overdue: isOverdue }"
    @click="store.activeTaskId = task.id"
    @contextmenu="onContextMenu"
  >
    <!-- Priority bar -->
    <div class="priority-bar" :style="{ background: priorityColor }" />

    <!-- Checkbox -->
    <button
      class="check-btn"
      :class="{ checked: task.completed }"
      @click.stop="store.toggleComplete(task.id)"
    >
      <svg v-if="task.completed" viewBox="0 0 16 16" fill="none" class="check-icon">
        <path d="M3.5 8l3 3 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <!-- Content -->
    <div class="task-content">
      <div class="task-title-row">
        <span class="task-title" :class="{ 'task-title--done': task.completed }">{{ task.title || '无标题' }}</span>
        <Star
          v-if="task.starred"
          :size="11"
          class="star-icon filled"
          @click.stop="store.toggleStar(task.id)"
        />
      </div>

      <div v-if="!compact" class="task-meta">
        <span v-if="task.dueDate" class="meta-chip" :class="{ overdue: isOverdue }">
          <Calendar :size="10" />
          {{ formatDate(task.dueDate) }}
        </span>
        <span v-if="task.recurrence !== 'none'" class="meta-chip">
          <RotateCcw :size="10" />
        </span>
        <span v-if="subtaskTotal > 0" class="meta-chip">
          <ChevronRight :size="10" />
          {{ subtaskDone }}/{{ subtaskTotal }}
        </span>
        <span v-for="tag in task.tags.slice(0, 2)" :key="tag" class="meta-chip tag-chip">
          <Tag :size="9" />
          {{ tag }}
        </span>
        <span v-if="isOverdue && !task.completed" class="meta-chip overdue-badge">
          <AlertCircle :size="10" />
          逾期
        </span>
      </div>
    </div>
  </div>

  <TaskContextMenu
    v-if="ctxMenu"
    :task="task"
    :x="ctxMenu.x"
    :y="ctxMenu.y"
    @close="ctxMenu = null"
  />
</template>

<style scoped>
.task-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px 8px 0;
  border-radius: 9px;
  cursor: pointer;
  transition: background 0.1s;
  position: relative;
  overflow: hidden;
}

.task-item:hover {
  background: rgba(0, 0, 0, 0.03);
}

.task-item.active {
  background: rgba(34, 63, 121, 0.07);
}

.priority-bar {
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 2px;
  flex-shrink: 0;
}

.check-btn {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid #c7c7cc;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  margin-top: 1px;
  margin-left: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, background 0.15s;
  padding: 0;
}

.check-btn:hover {
  border-color: #34c759;
}

.check-btn.checked {
  background: #34c759;
  border-color: #34c759;
  color: white;
}

.check-icon {
  width: 11px;
  height: 11px;
}

.task-content {
  flex: 1;
  min-width: 0;
}

.task-title-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.task-title {
  font-size: 13px;
  color: #1c1c1e;
  font-weight: 500;
  line-height: 1.4;
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.task-title--done {
  text-decoration: line-through;
  color: #8e8e93;
}

.star-icon {
  color: #ff9500;
  flex-shrink: 0;
}

.star-icon.filled {
  fill: #ff9500;
}

.task-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 3px;
}

.meta-chip {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: #8e8e93;
}

.meta-chip.overdue {
  color: #ff3b30;
}

.tag-chip {
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 5px;
  border-radius: 4px;
}

.overdue-badge {
  color: #ff3b30;
  font-weight: 600;
}
</style>
