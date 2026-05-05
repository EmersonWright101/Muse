<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useTodoStore, type Priority, type TodoTask } from '../../../stores/todo'
import {
  X, Star, Trash2, Calendar, Tag, RotateCcw, Flag,
  Plus, Check, ChevronRight, Bell,
} from 'lucide-vue-next'
import TimePickerInput from './TimePickerInput.vue'

const store = useTodoStore()

const task = computed(() => store.activeTask)
const t$ = computed(() => store.activeTask as TodoTask)

// Local editable copies
const localTitle = ref('')
const localNotes = ref('')
const newSubtaskTitle = ref('')
const newTag = ref('')
const showTagInput = ref(false)

watch(task, (t) => {
  if (t) {
    localTitle.value = t.title
    localNotes.value = t.notes
  }
}, { immediate: true })

function saveTitle() {
  if (!task.value) return
  store.updateTask(task.value.id, { title: localTitle.value })
}

function saveNotes() {
  if (!task.value) return
  store.updateTask(task.value.id, { notes: localNotes.value })
}

function setPriority(p: Priority) {
  if (!task.value) return
  store.updateTask(task.value.id, { priority: p })
}

function setDueDate(e: Event) {
  if (!task.value) return
  const v = (e.target as HTMLInputElement).value
  store.updateTask(task.value.id, { dueDate: v || null })
}

function setDueTime(v: string | null) {
  if (!task.value) return
  store.updateTask(task.value.id, { dueTime: v || null })
}

function setReminder(e: Event) {
  if (!task.value) return
  const v = (e.target as HTMLSelectElement).value
  store.updateTask(task.value.id, { reminderMinutes: v ? Number(v) : null })
}

const REMINDER_OPTIONS = [
  { value: '',     label: '不提醒' },
  { value: '5',    label: '5 分钟前' },
  { value: '10',   label: '10 分钟前' },
  { value: '15',   label: '15 分钟前' },
  { value: '30',   label: '30 分钟前' },
  { value: '60',   label: '1 小时前' },
  { value: '120',  label: '2 小时前' },
  { value: '1440', label: '1 天前' },
]

function setRecurrence(e: Event) {
  if (!task.value) return
  store.updateTask(task.value.id, { recurrence: (e.target as HTMLSelectElement).value as TodoTask['recurrence'] })
}

function setProject(e: Event) {
  if (!task.value) return
  const v = (e.target as HTMLSelectElement).value
  store.updateTask(task.value.id, { projectId: v || null })
}

function addSubtask() {
  if (!task.value || !newSubtaskTitle.value.trim()) return
  store.addSubtask(task.value.id, newSubtaskTitle.value.trim())
  newSubtaskTitle.value = ''
}

function addTag() {
  if (!task.value || !newTag.value.trim()) return
  const tag = newTag.value.trim()
  if (!task.value.tags.includes(tag)) {
    store.updateTask(task.value.id, { tags: [...task.value.tags, tag] })
  }
  newTag.value = ''
  showTagInput.value = false
}

function removeTag(tag: string) {
  if (!task.value) return
  store.updateTask(task.value.id, { tags: task.value.tags.filter(t => t !== tag) })
}

const PRIORITY_OPTIONS: { value: Priority; label: string; color: string }[] = [
  { value: 'none',   label: '无',   color: '#8e8e93' },
  { value: 'low',    label: '低',   color: '#34c759' },
  { value: 'medium', label: '中',   color: '#007aff' },
  { value: 'high',   label: '高',   color: '#ff9500' },
  { value: 'urgent', label: '紧急', color: '#ff3b30' },
]

const RECURRENCE_OPTIONS = [
  { value: 'none',    label: '不重复' },
  { value: 'daily',   label: '每天' },
  { value: 'weekly',  label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'yearly',  label: '每年' },
]


</script>

<template>
  <div v-if="task" class="task-detail">
    <!-- Header -->
    <div class="detail-header">
      <button
        class="complete-btn"
        :class="{ completed: t$.completed }"
        @click="store.toggleComplete(t$.id)"
        :title="t$.completed ? '标记为未完成' : '标记为完成'"
      >
        <Check :size="14" />
      </button>
      <div class="header-actions">
        <button
          class="icon-btn"
          :class="{ active: t$.starred }"
          title="标记"
          @click="store.toggleStar(t$.id)"
        >
          <Star :size="15" :fill="t$.starred ? '#ff9500' : 'none'" :color="t$.starred ? '#ff9500' : '#8e8e93'" />
        </button>
        <button class="icon-btn danger" title="删除任务" @click="store.deleteTask(t$.id)">
          <Trash2 :size="15" />
        </button>
        <button class="icon-btn" title="关闭" @click="store.activeTaskId = null">
          <X :size="15" />
        </button>
      </div>
    </div>

    <div class="detail-body">
      <!-- Title -->
      <textarea
        class="title-input"
        v-model="localTitle"
        placeholder="任务标题"
        rows="1"
        @input="(e) => { (e.target as HTMLTextAreaElement).style.height = 'auto'; (e.target as HTMLTextAreaElement).style.height = (e.target as HTMLTextAreaElement).scrollHeight + 'px' }"
        @blur="saveTitle"
        @keydown.enter.prevent="saveTitle"
      />

      <!-- Priority -->
      <div class="field-row">
        <Flag :size="13" class="field-icon" />
        <span class="field-label">优先级</span>
        <div class="priority-pills">
          <button
            v-for="p in PRIORITY_OPTIONS"
            :key="p.value"
            class="priority-pill"
            :class="{ active: t$.priority === p.value }"
            :style="t$.priority === p.value ? { background: p.color + '22', color: p.color, borderColor: p.color + '55' } : {}"
            @click="setPriority(p.value)"
          >
            {{ p.label }}
          </button>
        </div>
      </div>

      <!-- Due date -->
      <div class="field-row">
        <Calendar :size="13" class="field-icon" />
        <span class="field-label">截止日期</span>
        <div class="date-inputs">
          <input
            type="date"
            class="date-input"
            :value="t$.dueDate ?? ''"
            @change="setDueDate"
          />
          <TimePickerInput
            :modelValue="t$.dueTime"
            @update:modelValue="setDueTime"
          />
        </div>
      </div>

      <!-- Reminder -->
      <div class="field-row">
        <Bell :size="13" class="field-icon" />
        <span class="field-label">提醒</span>
        <select class="select-input" :value="t$.reminderMinutes ?? ''" @change="setReminder">
          <option v-for="o in REMINDER_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>

      <!-- Recurrence -->
      <div class="field-row">
        <RotateCcw :size="13" class="field-icon" />
        <span class="field-label">重复</span>
        <select class="select-input" :value="t$.recurrence" @change="setRecurrence">
          <option v-for="r in RECURRENCE_OPTIONS" :key="r.value" :value="r.value">{{ r.label }}</option>
        </select>
      </div>

      <!-- Project -->
      <div class="field-row">
        <ChevronRight :size="13" class="field-icon" />
        <span class="field-label">清单</span>
        <select class="select-input" :value="t$.projectId ?? ''" @change="setProject">
          <option value="">收件箱</option>
          <option v-for="p in store.projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>

      <!-- Tags -->
      <div class="field-row tags-row">
        <Tag :size="13" class="field-icon" />
        <span class="field-label">标签</span>
        <div class="tags-wrap">
          <span v-for="tag in t$.tags" :key="tag" class="tag-chip">
            {{ tag }}
            <button class="tag-remove" @click="removeTag(tag)"><X :size="9" /></button>
          </span>
          <template v-if="showTagInput">
            <input
              v-model="newTag"
              class="tag-input"
              placeholder="添加标签…"
              @keydown.enter="addTag"
              @keydown.escape="showTagInput = false"
              @blur="addTag"
              autofocus
            />
          </template>
          <button v-else class="add-tag-btn" @click="showTagInput = true">
            <Plus :size="11" />
          </button>
        </div>
      </div>

      <!-- Subtasks -->
      <div class="subtasks-section">
        <div class="subtasks-header">
          <span class="field-label">子任务</span>
          <span class="subtask-progress" v-if="t$.subtasks.length">
            {{ t$.subtasks.filter(s => s.completed).length }}/{{ t$.subtasks.length }}
          </span>
        </div>
        <div class="subtask-list">
          <div v-for="sub in t$.subtasks" :key="sub.id" class="subtask-row">
            <button
              class="check-btn small"
              :class="{ checked: sub.completed }"
              @click="store.toggleSubtask(t$.id, sub.id)"
            >
              <svg v-if="sub.completed" viewBox="0 0 16 16" fill="none" style="width:9px;height:9px">
                <path d="M3.5 8l3 3 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <span class="subtask-title" :class="{ done: sub.completed }">{{ sub.title }}</span>
            <button class="subtask-del" @click="store.deleteSubtask(t$.id, sub.id)"><X :size="10" /></button>
          </div>
        </div>
        <div class="subtask-add-row">
          <input
            v-model="newSubtaskTitle"
            class="subtask-input"
            placeholder="添加子任务…"
            @keydown.enter="addSubtask"
          />
          <button class="subtask-add-btn" @click="addSubtask"><Plus :size="13" /></button>
        </div>
      </div>

      <!-- Notes -->
      <div class="notes-section">
        <div class="field-label notes-label">备注</div>
        <textarea
          class="notes-input"
          v-model="localNotes"
          placeholder="添加备注…"
          rows="4"
          @blur="saveNotes"
        />
      </div>

      <!-- Timestamps -->
      <div class="timestamps">
        <span>创建于 {{ t$.createdAt.slice(0, 10) }}</span>
        <span v-if="t$.completedAt">完成于 {{ t$.completedAt.slice(0, 10) }}</span>
      </div>
    </div>
  </div>

  <div v-else class="detail-empty">
    <span>选择一个任务查看详情</span>
  </div>
</template>

<style scoped>
.task-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
  border-left: 1px solid rgba(0, 0, 0, 0.06);
}

.detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 13px;
  color: #8e8e93;
  background: #f9f9fb;
  border-left: 1px solid rgba(0, 0, 0, 0.06);
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.complete-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1.5px solid #c7c7cc;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: transparent;
  transition: all 0.15s;
}

.complete-btn:hover {
  border-color: #34c759;
  color: #34c759;
}

.complete-btn.completed {
  background: #34c759;
  border-color: #34c759;
  color: white;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.icon-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #8e8e93;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s, color 0.1s;
}

.icon-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #1c1c1e;
}

.icon-btn.danger:hover {
  color: #ff3b30;
  background: rgba(255, 59, 48, 0.08);
}

.detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.title-input {
  width: 100%;
  border: none;
  background: transparent;
  font-size: 16px;
  font-weight: 600;
  color: #1c1c1e;
  resize: none;
  outline: none;
  line-height: 1.4;
  padding: 0;
  overflow: hidden;
  min-height: 24px;
}

.title-input::placeholder {
  color: #c7c7cc;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
}

.field-icon {
  color: #8e8e93;
  flex-shrink: 0;
}

.field-label {
  font-size: 12px;
  color: #8e8e93;
  width: 52px;
  flex-shrink: 0;
}

.priority-pills {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.priority-pill {
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: transparent;
  font-size: 11px;
  color: #3c3c43;
  cursor: pointer;
  transition: all 0.1s;
}

.priority-pill:hover {
  background: rgba(0, 0, 0, 0.04);
}

.date-inputs {
  display: flex;
  gap: 6px;
  align-items: center;
}

.date-input,
.time-input {
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 6px;
  padding: 3px 7px;
  font-size: 12px;
  color: #1c1c1e;
  background: rgba(0, 0, 0, 0.02);
  outline: none;
  cursor: pointer;
}

.date-input:focus,
.time-input:focus {
  border-color: #223F79;
}

.time-input {
  width: 90px;
}

.select-input {
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 6px;
  padding: 3px 7px;
  font-size: 12px;
  color: #1c1c1e;
  background: rgba(0, 0, 0, 0.02);
  outline: none;
  cursor: pointer;
}

/* Tags */
.tags-row {
  align-items: flex-start;
  padding-top: 2px;
}

.tags-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}

.tag-chip {
  display: flex;
  align-items: center;
  gap: 3px;
  background: rgba(34, 63, 121, 0.08);
  color: #223F79;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 10px;
}

.tag-remove {
  border: none;
  background: transparent;
  color: #8e8e93;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
}

.tag-input {
  border: 1px solid rgba(34, 63, 121, 0.3);
  border-radius: 10px;
  padding: 2px 8px;
  font-size: 11px;
  outline: none;
  width: 90px;
}

.add-tag-btn {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px dashed #c7c7cc;
  background: transparent;
  color: #8e8e93;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.1s;
}

.add-tag-btn:hover {
  border-color: #223F79;
  color: #223F79;
}

/* Subtasks */
.subtasks-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.subtasks-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.subtask-progress {
  font-size: 11px;
  color: #8e8e93;
}

.subtask-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.subtask-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px 0;
}

.check-btn {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid #c7c7cc;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  flex-shrink: 0;
  padding: 0;
}

.check-btn.small {
  width: 14px;
  height: 14px;
}

.check-btn.checked {
  background: #34c759;
  border-color: #34c759;
  color: white;
}

.subtask-title {
  flex: 1;
  font-size: 13px;
  color: #1c1c1e;
}

.subtask-title.done {
  text-decoration: line-through;
  color: #8e8e93;
}

.subtask-del {
  border: none;
  background: transparent;
  color: #c7c7cc;
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  border-radius: 4px;
  transition: color 0.1s;
  opacity: 0;
}

.subtask-row:hover .subtask-del {
  opacity: 1;
}

.subtask-del:hover {
  color: #ff3b30;
}

.subtask-add-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.subtask-input {
  flex: 1;
  border: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  background: transparent;
  font-size: 12px;
  color: #1c1c1e;
  outline: none;
  padding: 4px 0;
}

.subtask-input::placeholder {
  color: #c7c7cc;
}

.subtask-add-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: rgba(34, 63, 121, 0.08);
  color: #223F79;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Notes */
.notes-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.notes-label {
  width: auto;
}

.notes-input {
  width: 100%;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  color: #1c1c1e;
  background: rgba(0, 0, 0, 0.02);
  resize: vertical;
  outline: none;
  line-height: 1.5;
  font-family: inherit;
  min-height: 80px;
}

.notes-input:focus {
  border-color: rgba(34, 63, 121, 0.3);
  background: white;
}

.notes-input::placeholder {
  color: #c7c7cc;
}

/* Timestamps */
.timestamps {
  display: flex;
  gap: 12px;
  font-size: 10px;
  color: #c7c7cc;
  padding-top: 4px;
}
</style>
