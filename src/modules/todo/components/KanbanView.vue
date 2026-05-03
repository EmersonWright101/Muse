<script setup lang="ts">
import { computed } from 'vue'
import { useTodoStore, type TodoTask } from '../../../stores/todo'
import TaskItem from './TaskItem.vue'
import { Plus } from 'lucide-vue-next'

const store = useTodoStore()

const todayStr = computed(() => store.todayStr)

function tomorrowStr(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

const COLUMNS: Array<{ key: string; label: string; color: string; predicate: (t: TodoTask) => boolean }> = [
  {
    key: 'overdue',
    label: '逾期',
    color: '#ff3b30',
    predicate: t => !t.completed && !!t.dueDate && t.dueDate < todayStr.value,
  },
  {
    key: 'today',
    label: '今天',
    color: '#007aff',
    predicate: t => !t.completed && t.dueDate === todayStr.value,
  },
  {
    key: 'tomorrow',
    label: '明天',
    color: '#ff9500',
    predicate: t => !t.completed && t.dueDate === tomorrowStr(),
  },
  {
    key: 'upcoming',
    label: '即将到来',
    color: '#34c759',
    predicate: t => !t.completed && !!t.dueDate && t.dueDate > tomorrowStr(),
  },
  {
    key: 'inbox',
    label: '无日期',
    color: '#8e8e93',
    predicate: t => !t.completed && !t.dueDate,
  },
  {
    key: 'done',
    label: '已完成',
    color: '#34c759',
    predicate: t => t.completed,
  },
]

function getColumnTasks(col: typeof COLUMNS[number]): TodoTask[] {
  // For kanban we show all tasks (not filter-limited) across the columns, but respect project filter
  let base = store.tasks
  if (
    store.activeFilter !== 'all' &&
    store.activeFilter !== 'today' &&
    store.activeFilter !== 'upcoming' &&
    store.activeFilter !== 'starred' &&
    store.activeFilter !== 'inbox' &&
    store.activeFilter !== 'completed'
  ) {
    // project filter
    base = base.filter(t => t.projectId === store.activeFilter)
  }

  return base.filter(col.predicate)
}

function addTaskToColumn(col: typeof COLUMNS[number]) {
  const dueDate = col.key === 'today' ? todayStr.value
    : col.key === 'tomorrow' ? tomorrowStr()
    : null
  store.addTask({ dueDate })
}
</script>

<template>
  <div class="kanban-view">
    <div
      v-for="col in COLUMNS"
      :key="col.key"
      class="kanban-col"
    >
      <div class="col-header">
        <span class="col-dot" :style="{ background: col.color }" />
        <span class="col-title">{{ col.label }}</span>
        <span class="col-count">{{ getColumnTasks(col).length }}</span>
        <button
          v-if="col.key !== 'done'"
          class="col-add-btn"
          title="添加任务"
          @click="addTaskToColumn(col)"
        >
          <Plus :size="12" />
        </button>
      </div>
      <div class="col-tasks">
        <div
          v-if="getColumnTasks(col).length === 0"
          class="col-empty"
        >暂无任务</div>
        <div
          v-for="task in getColumnTasks(col)"
          :key="task.id"
          class="kanban-card"
          :class="{ active: store.activeTaskId === task.id }"
          @click="store.activeTaskId = task.id"
        >
          <TaskItem :task="task" compact />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kanban-view {
  display: flex;
  gap: 12px;
  padding: 16px;
  height: 100%;
  overflow-x: auto;
  align-items: flex-start;
}

.kanban-col {
  flex-shrink: 0;
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(0, 0, 0, 0.025);
  border-radius: 12px;
  padding: 12px;
  max-height: 100%;
}

.col-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.col-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.col-title {
  font-size: 12px;
  font-weight: 600;
  color: #1c1c1e;
  flex: 1;
}

.col-count {
  font-size: 11px;
  color: #8e8e93;
}

.col-add-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: #8e8e93;
  cursor: pointer;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s, color 0.1s;
}

.col-add-btn:hover {
  background: rgba(0, 0, 0, 0.07);
  color: #1c1c1e;
}

.col-tasks {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  flex: 1;
}

.col-empty {
  font-size: 11px;
  color: #c7c7cc;
  text-align: center;
  padding: 16px 0;
}

.kanban-card {
  background: white;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.1s, border-color 0.1s;
  cursor: pointer;
}

.kanban-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.kanban-card.active {
  border-color: rgba(34, 63, 121, 0.3);
  background: rgba(34, 63, 121, 0.03);
}
</style>
