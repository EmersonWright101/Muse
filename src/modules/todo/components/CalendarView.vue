<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { useTodoStore } from '../../../stores/todo'

const store = useTodoStore()

const today = new Date()
const currentYear = ref(today.getFullYear())
const currentMonth = ref(today.getMonth()) // 0-indexed

function prevMonth() {
  if (currentMonth.value === 0) { currentMonth.value = 11; currentYear.value-- }
  else currentMonth.value--
}

function nextMonth() {
  if (currentMonth.value === 11) { currentMonth.value = 0; currentYear.value++ }
  else currentMonth.value++
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const MONTH_NAMES = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月']

const calendarDays = computed(() => {
  const year = currentYear.value
  const month = currentMonth.value
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  const days: Array<{ date: string; day: number; thisMonth: boolean; isToday: boolean }> = []

  // Prev month padding
  for (let i = firstDay - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i
    const prevM = month === 0 ? 11 : month - 1
    const prevY = month === 0 ? year - 1 : year
    days.push({ date: `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, day, thisMonth: false, isToday: false })
  }

  // Current month
  const todayStr = today.toISOString().slice(0, 10)
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push({ date, day: d, thisMonth: true, isToday: date === todayStr })
  }

  // Next month padding
  const remaining = 42 - days.length
  for (let d = 1; d <= remaining; d++) {
    const nextM = month === 11 ? 0 : month + 1
    const nextY = month === 11 ? year + 1 : year
    days.push({ date: `${nextY}-${String(nextM + 1).padStart(2, '0')}-${String(d).padStart(2,'0')}`, day: d, thisMonth: false, isToday: false })
  }

  return days
})

const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#ff3b30', high: '#ff9500', medium: '#007aff', low: '#34c759', none: '#8e8e93',
}

function getTasksForDate(date: string) {
  return (store.tasksByDate.get(date) ?? []).filter(t => !t.completed)
}

function selectDate(date: string) {
  const tasks = getTasksForDate(date)
  if (tasks.length > 0) {
    store.activeTaskId = tasks[0].id
  }
}
</script>

<template>
  <div class="calendar-view">
    <!-- Month nav -->
    <div class="cal-header">
      <button class="nav-btn" @click="prevMonth"><ChevronLeft :size="16" /></button>
      <span class="month-label">{{ currentYear }}年 {{ MONTH_NAMES[currentMonth] }}</span>
      <button class="nav-btn" @click="nextMonth"><ChevronRight :size="16" /></button>
    </div>

    <!-- Weekday labels -->
    <div class="weekdays-row">
      <div v-for="w in WEEKDAYS" :key="w" class="weekday-label">{{ w }}</div>
    </div>

    <!-- Days grid -->
    <div class="days-grid">
      <div
        v-for="d in calendarDays"
        :key="d.date"
        class="day-cell"
        :class="{
          'other-month': !d.thisMonth,
          'today': d.isToday,
          'has-tasks': getTasksForDate(d.date).length > 0,
        }"
        @click="selectDate(d.date)"
      >
        <span class="day-num">{{ d.day }}</span>
        <div class="task-dots">
          <span
            v-for="t in getTasksForDate(d.date).slice(0, 3)"
            :key="t.id"
            class="task-dot"
            :style="{ background: PRIORITY_COLOR[t.priority] ?? '#8e8e93' }"
          />
          <span v-if="getTasksForDate(d.date).length > 3" class="more-dot">…</span>
        </div>
        <div class="task-chips">
          <div
            v-for="t in getTasksForDate(d.date).slice(0, 2)"
            :key="t.id"
            class="task-chip"
            :style="{ borderLeft: `2px solid ${PRIORITY_COLOR[t.priority] ?? '#8e8e93'}` }"
            @click.stop="store.activeTaskId = t.id"
          >{{ t.title || '无标题' }}</div>
          <div v-if="getTasksForDate(d.date).length > 2" class="task-chip more">
            +{{ getTasksForDate(d.date).length - 2 }} 更多
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-view {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  overflow-y: auto;
}

.cal-header {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: center;
}

.nav-btn {
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

.nav-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #1c1c1e;
}

.month-label {
  font-size: 16px;
  font-weight: 700;
  color: #1c1c1e;
  min-width: 160px;
  text-align: center;
}

.weekdays-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.weekday-label {
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  padding: 4px 0;
}

.days-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  flex: 1;
}

.day-cell {
  min-height: 80px;
  border-radius: 8px;
  padding: 6px;
  cursor: pointer;
  transition: background 0.1s;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.day-cell:hover {
  background: rgba(0, 0, 0, 0.03);
}

.day-cell.has-tasks {
  background: rgba(34, 63, 121, 0.03);
}

.day-cell.has-tasks:hover {
  background: rgba(34, 63, 121, 0.07);
}

.day-num {
  font-size: 12px;
  font-weight: 500;
  color: #1c1c1e;
  line-height: 1;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
}

.day-cell.today .day-num {
  background: #223F79;
  color: white;
  font-weight: 700;
}

.day-cell.other-month .day-num {
  color: #c7c7cc;
}

.task-dots {
  display: none;
  gap: 2px;
  flex-wrap: wrap;
}

.task-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}

.more-dot {
  font-size: 9px;
  color: #8e8e93;
  line-height: 1;
}

.task-chips {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.task-chip {
  font-size: 10px;
  color: #1c1c1e;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 3px;
  padding: 2px 5px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: background 0.1s;
}

.task-chip:hover {
  background: rgba(34, 63, 121, 0.12);
  color: #223F79;
}

.task-chip.more {
  color: #8e8e93;
  background: transparent;
  font-style: italic;
  border: none;
}

@media (max-width: 700px) {
  .task-chips { display: none; }
  .task-dots { display: flex; }
  .day-cell { min-height: 48px; }
}
</style>
