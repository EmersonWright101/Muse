<script setup lang="ts">
import { ref, computed } from 'vue'
import { useTodoStore } from '../../stores/todo'
import {
  Inbox, Star, Calendar, CalendarDays, CheckSquare, LayoutList,
  Plus, Trash2, Pencil, Check, X,
} from 'lucide-vue-next'

const store = useTodoStore()

const editingProjectId = ref<string | null>(null)
const editingName = ref('')
const newProjectMode = ref(false)
const newProjectName = ref('')

const SMART_FILTERS = [
  { key: 'today',    label: '今天',    icon: Calendar },
  { key: 'upcoming', label: '即将到来', icon: CalendarDays },
  { key: 'starred',  label: '已标记',   icon: Star },
  { key: 'inbox',    label: '收件箱',   icon: Inbox },
  { key: 'all',      label: '全部任务', icon: LayoutList },
  { key: 'completed',label: '已完成',   icon: CheckSquare },
] as const

function startEditProject(id: string, name: string) {
  editingProjectId.value = id
  editingName.value = name
}

function saveEditProject(id: string) {
  if (editingName.value.trim()) {
    store.updateProject(id, { name: editingName.value.trim() })
  }
  editingProjectId.value = null
}

function startNewProject() {
  newProjectMode.value = true
  newProjectName.value = ''
}

function confirmNewProject() {
  const name = newProjectName.value.trim()
  if (name) {
    const p = store.addProject({ name })
    store.activeFilter = p.id
  }
  newProjectMode.value = false
}

function cancelNewProject() {
  newProjectMode.value = false
}

const sortedProjects = computed(() =>
  [...store.projects].sort((a, b) => a.order - b.order)
)
</script>

<template>
  <aside class="todo-sidebar">
    <div class="sidebar-title">待办</div>

    <!-- Smart filters -->
    <div class="section-group">
      <button
        v-for="f in SMART_FILTERS"
        :key="f.key"
        class="filter-item"
        :class="{ active: store.activeFilter === f.key }"
        @click="store.activeFilter = f.key"
      >
        <component :is="f.icon" :size="14" class="filter-icon" />
        <span class="filter-label">{{ f.label }}</span>
        <span v-if="f.key !== 'completed'" class="filter-count">
          {{ store.countByFilter(f.key) || '' }}
        </span>
      </button>
    </div>

    <!-- Projects -->
    <div class="section-header">
      <span class="section-label">清单</span>
      <button class="add-btn" title="新建清单" @click="startNewProject">
        <Plus :size="13" />
      </button>
    </div>

    <div class="section-group projects-group">
      <button
        v-for="p in sortedProjects"
        :key="p.id"
        class="filter-item project-item"
        :class="{ active: store.activeFilter === p.id }"
        @click="store.activeFilter = p.id"
      >
        <span class="project-dot" :style="{ background: p.color }" />
        <template v-if="editingProjectId === p.id">
          <input
            v-model="editingName"
            class="project-name-input"
            @keydown.enter="saveEditProject(p.id)"
            @keydown.escape="editingProjectId = null"
            @blur="saveEditProject(p.id)"
            @click.stop
            autofocus
          />
        </template>
        <template v-else>
          <span class="filter-label project-name">{{ p.name }}</span>
          <span class="filter-count">{{ store.countByFilter(p.id) || '' }}</span>
          <div class="project-actions" @click.stop>
            <button class="proj-action-btn" title="重命名" @click="startEditProject(p.id, p.name)">
              <Pencil :size="11" />
            </button>
            <button class="proj-action-btn danger" title="删除" @click="store.deleteProject(p.id)">
              <Trash2 :size="11" />
            </button>
          </div>
        </template>
      </button>

      <!-- New project input -->
      <div v-if="newProjectMode" class="filter-item new-project-row">
        <span class="project-dot" style="background: #8e8e93" />
        <input
          v-model="newProjectName"
          class="project-name-input"
          placeholder="清单名称…"
          @keydown.enter="confirmNewProject"
          @keydown.escape="cancelNewProject"
          autofocus
        />
        <button class="proj-action-btn confirm" @click="confirmNewProject"><Check :size="11" /></button>
        <button class="proj-action-btn" @click="cancelNewProject"><X :size="11" /></button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.todo-sidebar {
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
  padding: 14px 10px 14px;
  gap: 2px;
  overflow-y: auto;
  user-select: none;
}

.sidebar-title {
  font-size: 20px;
  font-weight: 700;
  color: #1c1c1e;
  padding: 0 8px 10px;
}

.section-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-bottom: 8px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 2px;
  margin-top: 4px;
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.add-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: #8e8e93;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s, color 0.1s;
}

.add-btn:hover {
  background: rgba(0, 0, 0, 0.07);
  color: #1c1c1e;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: background 0.1s;
}

.filter-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.filter-item.active {
  background: rgba(34, 63, 121, 0.10);
}

.filter-item.active .filter-label {
  color: #223F79;
  font-weight: 600;
}

.filter-item.active .filter-icon {
  color: #223F79;
}

.filter-icon {
  color: #8e8e93;
  flex-shrink: 0;
}

.filter-label {
  flex: 1;
  font-size: 13px;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.filter-count {
  font-size: 11px;
  color: #8e8e93;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  min-width: 14px;
  text-align: right;
}

/* Projects */
.projects-group {
  flex: 1;
}

.project-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.project-name {
  font-size: 13px;
}

.project-actions {
  display: none;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.project-item:hover .project-actions {
  display: flex;
}

.project-item:hover .filter-count {
  display: none;
}

.proj-action-btn {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: #8e8e93;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}

.proj-action-btn:hover {
  background: rgba(0, 0, 0, 0.07);
  color: #1c1c1e;
}

.proj-action-btn.danger:hover {
  color: #ff3b30;
  background: rgba(255, 59, 48, 0.08);
}

.proj-action-btn.confirm:hover {
  color: #34c759;
  background: rgba(52, 199, 89, 0.1);
}

.project-name-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 13px;
  color: #1c1c1e;
  outline: none;
  min-width: 0;
}

.new-project-row {
  background: rgba(34, 63, 121, 0.06);
}
</style>
