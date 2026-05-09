<script setup lang="ts">
import { computed, ref } from 'vue'
import { BookOpen, Clock, Flame, BookMarked, Calendar, TrendingUp, BarChart3, HardDrive, RefreshCw } from 'lucide-vue-next'
import { useEbookStore } from '../../../stores/ebook'

const store = useEbookStore()

// ─── Heatmap data ─────────────────────────────────────────────────────────────

const MONTHS_TO_SHOW = 6
const today = new Date()
today.setHours(0, 0, 0, 0)

interface Cell {
  date: string
  minutes: number
  level: 0 | 1 | 2 | 3 | 4
  label: string
}

interface MonthRow {
  label: string
  days: (Cell | null)[]
}

const monthRows = computed<MonthRow[]>(() => {
  const heatmap = store.getSessionHeatmap(365)
  const rows: MonthRow[] = []

  for (let m = 0; m < MONTHS_TO_SHOW; m++) {
    const monthDate = new Date(today.getFullYear(), today.getMonth() - (MONTHS_TO_SHOW - 1 - m), 1)
    const year = monthDate.getFullYear()
    const month = monthDate.getMonth()
    const label = monthDate.toLocaleDateString('zh-CN', { month: 'short' })

    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const firstDay = new Date(year, month, 1).getDay() // 0=Sun

    const days: (Cell | null)[] = []
    // Pad leading empty cells (shift so Monday=0 for display alignment)
    const mondayFirst = firstDay === 0 ? 6 : firstDay - 1
    for (let i = 0; i < mondayFirst; i++) days.push(null)
    // Fill days
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d)
      const key = date.toISOString().slice(0, 10)
      const mins = heatmap[key] ?? 0
      days.push({
        date: key,
        minutes: mins,
        level: mins === 0 ? 0 : mins < 15 ? 1 : mins < 30 ? 2 : mins < 60 ? 3 : 4,
        label: `${key}: ${mins} 分钟`,
      })
    }
    // Pad trailing to fill complete weeks
    while (days.length % 7 !== 0) days.push(null)

    rows.push({ label, days })
  }

  return rows
})

const DAY_LABELS_SHORT = ['一', '二', '三', '四', '五', '六', '日']

// ─── Stats ────────────────────────────────────────────────────────────────────

const totalMinutes  = computed(() => store.getTotalReadingMinutes())
const currentStreak = computed(() => store.getCurrentStreak())
const totalBooks    = computed(() => store.books.length)
const finishedBooks = computed(() => store.books.filter(b => b.readStatus === 'finished').length)
const totalAnns     = computed(() => store.annotations.length)
const todayMinutes  = computed(() => store.getTodayReadingMinutes())
const weeklyAvg     = computed(() => store.getWeeklyAvgMinutes())
const monthlyAvg    = computed(() => store.getMonthlyAvgMinutes())
const yearlyAvg     = computed(() => store.getYearlyAvgMinutes())

const hoverCell = ref<Cell | null>(null)
const isSyncing = ref(false)

async function syncData() {
  if (isSyncing.value) return
  isSyncing.value = true
  await store.syncFromServer()
  isSyncing.value = false
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const min = m % 60
  return min > 0 ? `${h}h ${min}m` : `${h}h`
}

function formatMinutesShort(m: number): string {
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const min = m % 60
  return min > 0 ? `${h}h ${min}m` : `${h}h`
}

function formatStorage(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// Most-read books (by session duration)
const topBooks = computed(() => {
  const totals: Record<string, number> = {}
  for (const s of store.sessions) {
    totals[s.bookId] = (totals[s.bookId] ?? 0) + s.duration
  }
  return Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([id, dur]) => {
      const book = store.books.find(b => b.id === id)
      return { id, title: book?.title ?? '未知书籍', author: book?.author ?? '', minutes: Math.round(dur / 60) }
    })
})
</script>

<template>
  <div class="reading-tab">
    <!-- Stats row -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon"><Clock :size="18" /></div>
        <div class="stat-val">{{ formatMinutesShort(totalMinutes) }}</div>
        <div class="stat-label">累计阅读</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><Calendar :size="18" /></div>
        <div class="stat-val">{{ formatMinutesShort(todayMinutes) }}</div>
        <div class="stat-label">今日阅读</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><Flame :size="18" /></div>
        <div class="stat-val">{{ currentStreak }} <span class="stat-unit">天</span></div>
        <div class="stat-label">连续阅读</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><TrendingUp :size="18" /></div>
        <div class="stat-val">{{ formatMinutesShort(weeklyAvg) }}</div>
        <div class="stat-label">周平均</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><BarChart3 :size="18" /></div>
        <div class="stat-val">{{ formatMinutesShort(monthlyAvg) }}</div>
        <div class="stat-label">月平均</div>
      </div>
    </div>

    <!-- Second stats row -->
    <div class="stats-grid stats-grid-2">
      <div class="stat-card">
        <div class="stat-icon"><BookOpen :size="18" /></div>
        <div class="stat-val">{{ totalBooks }}</div>
        <div class="stat-label">书库总量</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><BookMarked :size="18" /></div>
        <div class="stat-val">{{ finishedBooks }}</div>
        <div class="stat-label">已读完</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="font-size:17px">✏️</div>
        <div class="stat-val">{{ totalAnns }}</div>
        <div class="stat-label">批注总数</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><Clock :size="18" /></div>
        <div class="stat-val">{{ formatMinutesShort(yearlyAvg) }}</div>
        <div class="stat-label">年平均</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><HardDrive :size="18" /></div>
        <div class="stat-val">{{ formatStorage(store.storageUsed) }}</div>
        <div class="stat-label">占用空间</div>
      </div>
    </div>

    <!-- Heatmap -->
    <div class="heatmap-section">
      <div class="heatmap-header">
        <div class="section-title">阅读热力图</div>
        <button class="refresh-btn" :class="{ spinning: isSyncing }" @click="syncData">
          <RefreshCw :size="13" />
        </button>
      </div>
      <div class="heatmap-wrap">
        <div class="heatmap-inner">
          <!-- Calendar-style month rows with horizontal day labels -->
          <div class="calendar-rows">
            <div v-for="(row, ri) in monthRows" :key="ri" class="cal-month">
              <div class="cal-label">{{ row.label }}</div>
              <div class="cal-day-header">
                <span v-for="d in DAY_LABELS_SHORT" :key="d" class="cal-day-name">{{ d }}</span>
              </div>
              <div class="cal-grid">
                <div
                  v-for="(cell, ci) in row.days"
                  :key="ci"
                  class="cal-cell"
                  :class="cell ? `level-${cell.level}` : 'cal-empty'"
                  :title="cell?.label ?? ''"
                  @mouseenter="cell ? (hoverCell = cell) : null"
                  @mouseleave="hoverCell = null"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Legend -->
        <div class="heatmap-legend">
          <span class="legend-label">少</span>
          <div v-for="l in [0,1,2,3,4]" :key="l" class="hm-cell" :class="`level-${l}`" />
          <span class="legend-label">多</span>
        </div>
      </div>
    </div>

    <!-- Top books -->
    <div v-if="topBooks.length > 0" class="top-books-section">
      <div class="section-title">阅读最多的书</div>
      <div class="top-books-list">
        <div v-for="(b, idx) in topBooks" :key="b.id" class="top-book-item">
          <span class="rank">{{ idx + 1 }}</span>
          <div class="tb-info">
            <p class="tb-title">{{ b.title }}</p>
            <p v-if="b.author" class="tb-author">{{ b.author }}</p>
          </div>
          <span class="tb-time">{{ formatMinutes(b.minutes) }}</span>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="totalBooks === 0" class="empty-state">
      <BookOpen :size="40" class="empty-icon" />
      <p>还没有阅读记录，去书库添加一本书吧</p>
    </div>
  </div>
</template>

<style scoped>
.reading-tab {
  padding: 28px 32px;
  max-width: 100%;
}

/* Stats */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
  margin-bottom: 14px;
}
.stats-grid-2 {
  margin-bottom: 32px;
}
.stat-card {
  background: #f9f9f9;
  border-radius: 14px;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}
.stat-icon { color: #223F79; }
.stat-val { font-size: 22px; font-weight: 700; color: #1c1c1e; line-height: 1; white-space: nowrap; }
.stat-unit { font-size: 14px; font-weight: 400; color: #8e8e93; }
.stat-label { font-size: 12px; color: #8e8e93; }

/* Heatmap */
.heatmap-section { margin-bottom: 32px; }
.heatmap-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.section-title { font-size: 15px; font-weight: 600; color: #1c1c1e; margin: 0; }
.refresh-btn {
  width: 26px; height: 26px; border: none; background: transparent;
  border-radius: 6px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: #8e8e93; transition: background 0.10s, color 0.10s;
}
.refresh-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }
.refresh-btn.spinning { animation: spin 0.8s linear infinite; }

.heatmap-wrap { display: block; position: relative; }

.calendar-rows { display: flex; gap: 10px; width: 100%; }
.cal-month { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.cal-label { font-size: 10px; color: #aeaeb2; text-align: center; height: 14px; line-height: 14px; }
.cal-day-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: 2px;
}
.cal-day-name {
  font-size: 9px;
  color: #aeaeb2;
  text-align: center;
  line-height: 12px;
}
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.cal-cell {
  width: 100%;
  height: 0;
  padding-bottom: 100%;
  border-radius: 3px;
  cursor: pointer;
  transition: opacity 0.10s;
}
.cal-cell:hover { opacity: 0.75; }
.cal-empty { background: transparent; pointer-events: none; }

.level-0 { background: #ebedf0; }
.level-1 { background: #c6e48b; }
.level-2 { background: #7bc96f; }
.level-3 { background: #239a3b; }
.level-4 { background: #196127; }

.heatmap-legend { display: flex; align-items: center; gap: 3px; margin-top: 8px; justify-content: flex-end; }
.legend-label { font-size: 10px; color: #aeaeb2; }



/* Top books */
.top-books-section { margin-bottom: 32px; }

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.top-books-list { display: flex; flex-direction: column; gap: 8px; }
.top-book-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: #f9f9f9;
  border-radius: 10px;
}
.rank { font-size: 14px; font-weight: 700; color: #aeaeb2; width: 20px; text-align: center; flex-shrink: 0; }
.tb-info { flex: 1; min-width: 0; }
.tb-title { font-size: 14px; font-weight: 500; color: #1c1c1e; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tb-author { font-size: 12px; color: #8e8e93; margin: 2px 0 0; }
.tb-time { font-size: 13px; color: #223F79; font-weight: 600; flex-shrink: 0; white-space: nowrap; }

/* Empty state */
.empty-state { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 60px 0; color: #aeaeb2; font-size: 14px; text-align: center; }
.empty-icon { opacity: 0.35; }
</style>
