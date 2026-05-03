<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import {
  CheckCircle, Circle, Star, StarOff, Trash2,
  Flag, ChevronRight,
} from 'lucide-vue-next'
import { useTodoStore, type TodoTask } from '../../../stores/todo'

const props = defineProps<{ task: TodoTask; x: number; y: number }>()
const emit  = defineEmits<{ close: [] }>()

const store = useTodoStore()

const PRIORITIES = [
  { key: 'urgent', label: '紧急',   color: '#ff3b30' },
  { key: 'high',   label: '高',     color: '#ff9500' },
  { key: 'medium', label: '中',     color: '#007aff' },
  { key: 'low',    label: '低',     color: '#34c759' },
  { key: 'none',   label: '无优先级', color: '#c7c7cc' },
]

const showPriority = ref(false)

function close() { emit('close') }

function toggleComplete() {
  store.toggleComplete(props.task.id)
  close()
}

function toggleStar() {
  store.toggleStar(props.task.id)
  close()
}

function setPriority(p: string) {
  store.updateTask(props.task.id, { priority: p as TodoTask['priority'] })
  close()
}

function deleteTask() {
  store.deleteTask(props.task.id)
  close()
}

function onGlobalClick(e: MouseEvent) {
  const el = document.getElementById('task-ctx-menu')
  if (el && !el.contains(e.target as Node)) close()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onMounted(() => {
  setTimeout(() => {
    document.addEventListener('mousedown', onGlobalClick)
    document.addEventListener('keydown', onKey)
  }, 0)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onGlobalClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <div
      id="task-ctx-menu"
      class="ctx-menu"
      :style="{ left: x + 'px', top: y + 'px' }"
    >
      <!-- Complete / Undo -->
      <button class="ctx-item" @click="toggleComplete">
        <CheckCircle v-if="!task.completed" :size="13" class="ctx-icon" />
        <Circle       v-else                 :size="13" class="ctx-icon" />
        <span>{{ task.completed ? '标为未完成' : '标为已完成' }}</span>
      </button>

      <!-- Star -->
      <button class="ctx-item" @click="toggleStar">
        <Star    v-if="!task.starred" :size="13" class="ctx-icon star" />
        <StarOff v-else               :size="13" class="ctx-icon" />
        <span>{{ task.starred ? '取消标记' : '标记星标' }}</span>
      </button>

      <div class="ctx-divider" />

      <!-- Priority submenu -->
      <div class="ctx-item ctx-submenu-trigger" @mouseenter="showPriority = true" @mouseleave="showPriority = false">
        <Flag :size="13" class="ctx-icon" />
        <span>设置优先级</span>
        <ChevronRight :size="11" class="ctx-chevron" />

        <div v-if="showPriority" class="ctx-submenu">
          <button
            v-for="p in PRIORITIES"
            :key="p.key"
            class="ctx-item"
            :class="{ active: task.priority === p.key }"
            @click.stop="setPriority(p.key)"
          >
            <span class="priority-dot" :style="{ background: p.color }" />
            <span>{{ p.label }}</span>
            <span v-if="task.priority === p.key" class="ctx-check">✓</span>
          </button>
        </div>
      </div>

      <div class="ctx-divider" />

      <!-- Delete -->
      <button class="ctx-item danger" @click="deleteTask">
        <Trash2 :size="13" class="ctx-icon" />
        <span>删除任务</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 9999;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16), 0 0 0 0.5px rgba(0, 0, 0, 0.08);
  padding: 4px;
  min-width: 160px;
  user-select: none;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
  color: #1c1c1e;
  text-align: left;
  transition: background 0.1s;
  position: relative;
}

.ctx-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.ctx-item.active {
  background: rgba(34, 63, 121, 0.08);
}

.ctx-item.danger { color: #ff3b30; }
.ctx-item.danger:hover { background: rgba(255, 59, 48, 0.08); }

.ctx-icon { color: #8e8e93; flex-shrink: 0; }
.ctx-icon.star { color: #ff9500; }

.ctx-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.07);
  margin: 3px 0;
}

.ctx-chevron { margin-left: auto; color: #c7c7cc; }
.ctx-check   { margin-left: auto; color: #007aff; font-size: 12px; }

.priority-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* Submenu */
.ctx-submenu-trigger { position: relative; }

.ctx-submenu {
  position: absolute;
  left: calc(100% + 4px);
  top: -4px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16), 0 0 0 0.5px rgba(0, 0, 0, 0.08);
  padding: 4px;
  min-width: 130px;
  z-index: 1;
}
</style>
