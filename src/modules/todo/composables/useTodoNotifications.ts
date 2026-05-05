import { onMounted, onUnmounted } from 'vue'
import { useTodoStore } from '../../../stores/todo'

const NOTIFY_INTERVAL_MS = 5 * 60 * 1000   // 5 minutes
const POLL_INTERVAL_MS   = 30 * 1000        // 30 seconds
const notifiedIds = new Set<string>()        // dedup within session

export function useTodoNotifications() {
  const store = useTodoStore()
  let notifyTimer: ReturnType<typeof setInterval> | null = null
  let pollTimer:   ReturnType<typeof setInterval> | null = null

  async function requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false
    if (Notification.permission === 'granted') return true
    if (Notification.permission === 'denied') return false
    const result = await Notification.requestPermission()
    return result === 'granted'
  }

  function fireNotification(title: string, body: string, tag: string) {
    if (Notification.permission !== 'granted') return
    new Notification(title, { body, tag, silent: false })
  }

  function checkAndNotify() {
    const now   = new Date()
    const today = store.todayStr
    const tasks  = store.tasks

    // Overdue tasks
    const overdueNew  = tasks.filter(t => !t.completed && t.dueDate && t.dueDate < today  && !notifiedIds.has(`ov-${t.id}`))
    // Due today (date-only reminder)
    const dueTodayNew = tasks.filter(t => !t.completed && t.dueDate === today              && !notifiedIds.has(`td-${t.id}`))

    if (overdueNew.length > 0) {
      overdueNew.forEach(t => notifiedIds.add(`ov-${t.id}`))
      fireNotification(
        `⚠️ 逾期任务 (${overdueNew.length})`,
        overdueNew.slice(0, 3).map(t => t.title).join('、') + (overdueNew.length > 3 ? ' 等' : ''),
        'todo-overdue',
      )
    }

    if (dueTodayNew.length > 0) {
      dueTodayNew.forEach(t => notifiedIds.add(`td-${t.id}`))
      fireNotification(
        `📋 今日任务 (${dueTodayNew.length})`,
        dueTodayNew.slice(0, 3).map(t => t.title).join('、') + (dueTodayNew.length > 3 ? ' 等' : ''),
        'todo-today',
      )
    }

    // Time-based advance reminders
    for (const task of tasks) {
      if (task.completed || !task.dueDate || !task.dueTime || task.reminderMinutes === null) continue
      const key = `rm-${task.id}`
      if (notifiedIds.has(key)) continue

      const dueDateTime = new Date(`${task.dueDate}T${task.dueTime}`)
      const remindAt    = new Date(dueDateTime.getTime() - task.reminderMinutes * 60 * 1000)
      const elapsedMs   = now.getTime() - remindAt.getTime()

      // Fire if we just passed the reminder time (within the last check interval)
      if (elapsedMs >= 0 && elapsedMs < NOTIFY_INTERVAL_MS) {
        notifiedIds.add(key)
        const minLabel = task.reminderMinutes >= 60
          ? `${task.reminderMinutes / 60} 小时`
          : `${task.reminderMinutes} 分钟`
        fireNotification(
          `⏰ 任务提醒`,
          `「${task.title}」将在 ${minLabel}后截止`,
          key,
        )
      }
    }
  }

  onMounted(async () => {
    await requestPermission()
    // slight delay so store has loaded first
    setTimeout(checkAndNotify, 2000)
    notifyTimer = setInterval(checkAndNotify, NOTIFY_INTERVAL_MS)

    // Poll backend every 30s (only when API is configured)
    pollTimer = setInterval(() => {
      if (store.apiStatus === 'connected') store.load()
    }, POLL_INTERVAL_MS)
  })

  onUnmounted(() => {
    if (notifyTimer) clearInterval(notifyTimer)
    if (pollTimer)   clearInterval(pollTimer)
  })
}
