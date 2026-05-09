import { onMounted, onUnmounted, watch, ref, readonly } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useTodoStore } from '../../../stores/todo'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'

const NOTIFY_INTERVAL_MS = 10 * 1000
const POLL_INTERVAL_MS   = 5 * 60 * 1000
const POLL_WINDOW_MS     = NOTIFY_INTERVAL_MS + 5 * 1000

// ─── Notification health status (exported for settings page) ─────────────────
export interface NotifStatus {
  permissionGranted: boolean
  osScheduledCount: number       // reminders currently queued with the OS
  firedCount: number             // total successful fires this session
  lastChannel: 'tauri' | 'web' | null  // which channel last succeeded
  lastError: string | null       // last failure reason (null = healthy)
  lastCheckedAt: Date | null
}

const _notifStatus = ref<NotifStatus>({
  permissionGranted: false,
  osScheduledCount: 0,
  firedCount: 0,
  lastChannel: null,
  lastError: null,
  lastCheckedAt: null,
})

/** Reactive notification health — import this anywhere to read status. */
export const notifStatus = readonly(_notifStatus)

// ─── Persistent dedup (daily-scoped so reminders reset each day) ──────────────
function todayKey(): string {
  const d = new Date()
  return `muse-notified-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function loadNotifiedIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(todayKey()) ?? '[]')) }
  catch { return new Set() }
}

function persistNotifiedId(id: string, set: Set<string>) {
  set.add(id)
  try {
    localStorage.setItem(todayKey(), JSON.stringify([...set]))
    const y = new Date(); y.setDate(y.getDate() - 1)
    localStorage.removeItem(`muse-notified-${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`)
  } catch {}
}

export function useTodoNotifications() {
  const store = useTodoStore()
  let notifyTimer: ReturnType<typeof setInterval> | null = null
  let pollTimer:   ReturnType<typeof setInterval> | null = null
  let stopWatcher: (() => void) | null = null
  const notifiedIds = loadNotifiedIds()
  let isFirstCheck = true

  // ─── Permission ────────────────────────────────────────────────────────────
  async function ensurePermission(): Promise<boolean> {
    try {
      let granted = await isPermissionGranted()
      if (!granted) {
        const permission = await requestPermission()
        granted = permission === 'granted'
      }
      _notifStatus.value.permissionGranted = granted
      if (!granted) {
        _notifStatus.value.lastError = '通知权限未授权，请在系统设置中开启'
        console.warn('[notif] permission denied')
      }
      return granted
    } catch {
      // Tauri plugin unavailable — fall through to Web Notification API
    }
    if (!('Notification' in window)) {
      _notifStatus.value.lastError = '当前环境不支持通知'
      return false
    }
    if (Notification.permission === 'granted') {
      _notifStatus.value.permissionGranted = true
      return true
    }
    if (Notification.permission === 'denied') {
      _notifStatus.value.permissionGranted = false
      _notifStatus.value.lastError = '浏览器通知权限被拒绝'
      return false
    }
    const result = await Notification.requestPermission()
    _notifStatus.value.permissionGranted = result === 'granted'
    return result === 'granted'
  }

  // ─── Fire one notification, returns which channel delivered it ─────────────
  async function fireNotification(
    title: string,
    body: string,
    tag: string,
  ): Promise<'tauri' | 'web' | 'failed'> {
    // Try Tauri native plugin first
    try {
      await sendNotification({ title, body, sound: 'default' })
      _notifStatus.value.firedCount++
      _notifStatus.value.lastChannel = 'tauri'
      _notifStatus.value.lastError = null
      _notifStatus.value.lastCheckedAt = new Date()
      return 'tauri'
    } catch (e) {
      console.warn('[notif] sendNotification (tauri) failed:', e)
    }

    // Fallback: Web Notification API
    if (Notification.permission === 'granted') {
      new Notification(title, { body, tag, silent: false })
      _notifStatus.value.firedCount++
      _notifStatus.value.lastChannel = 'web'
      _notifStatus.value.lastError = 'Tauri 插件不可用，已降级为浏览器通知'
      _notifStatus.value.lastCheckedAt = new Date()
      return 'web'
    }

    _notifStatus.value.lastError = '通知发送失败：两种通道均不可用'
    _notifStatus.value.lastCheckedAt = new Date()
    console.error('[notif] all channels failed for:', title)
    return 'failed'
  }

  // ─── JS polling (foreground, every 10 s) ──────────────────────────────────
  async function checkAndNotify() {
    const now   = new Date()
    const today = store.todayStr
    const tasks = store.tasks
    const reminderWindowMs = isFirstCheck ? Infinity : POLL_WINDOW_MS
    isFirstCheck = false

    const overdueNew = tasks.filter(t =>
      !t.completed && t.dueDate && t.dueDate < today && !notifiedIds.has(`ov-${t.id}`)
    )
    if (overdueNew.length > 0) {
      overdueNew.forEach(t => persistNotifiedId(`ov-${t.id}`, notifiedIds))
      await fireNotification(
        `⚠️ 逾期任务 (${overdueNew.length})`,
        overdueNew.slice(0, 3).map(t => t.title).join('、') + (overdueNew.length > 3 ? ' 等' : ''),
        'todo-overdue',
      )
    }

    const dueTodayNew = tasks.filter(t =>
      !t.completed && t.dueDate === today && !t.dueTime && !notifiedIds.has(`td-${t.id}`)
    )
    if (dueTodayNew.length > 0) {
      dueTodayNew.forEach(t => persistNotifiedId(`td-${t.id}`, notifiedIds))
      await fireNotification(
        `📋 今日任务 (${dueTodayNew.length})`,
        dueTodayNew.slice(0, 3).map(t => t.title).join('、') + (dueTodayNew.length > 3 ? ' 等' : ''),
        'todo-today',
      )
    }

    for (const task of tasks) {
      if (task.completed || !task.dueDate || !task.dueTime || task.reminderMinutes === null) continue
      const key = `rm-${task.id}-${task.dueDate}-${task.dueTime}-${task.reminderMinutes}`
      if (notifiedIds.has(key)) continue

      const [y, m, d] = task.dueDate.split('-').map(Number)
      const [hh, mm] = task.dueTime.split(':').map(Number)
      const dueDateTime = new Date(y, m - 1, d, hh, mm)
      const remindAt    = new Date(dueDateTime.getTime() - task.reminderMinutes * 60 * 1000)
      const elapsedMs   = now.getTime() - remindAt.getTime()

      if (elapsedMs >= 0 && elapsedMs < reminderWindowMs) {
        persistNotifiedId(key, notifiedIds)
        const minLabel = task.reminderMinutes >= 60
          ? `${task.reminderMinutes / 60} 小时`
          : `${task.reminderMinutes} 分钟`
        await fireNotification(
          `⏰ 任务提醒`,
          `「${task.title}」将在 ${minLabel}后截止`,
          key,
        )
      }
    }
  }

  // ─── OS scheduling (background delivery) ──────────────────────────────────
  async function scheduleOsReminders() {
    const now = Date.now() / 1000
    const reminders: Array<{ id: string; title: string; body: string; notifyAt: number }> = []

    for (const task of store.tasks) {
      if (
        task.completed ||
        !task.dueDate ||
        !task.dueTime ||
        task.reminderMinutes === null ||
        task.reminderMinutes === undefined
      ) continue

      const [y, m, d] = task.dueDate.split('-').map(Number)
      const [hh, mm] = task.dueTime.split(':').map(Number)
      const dueMs    = new Date(y, m - 1, d, hh, mm).getTime()
      const remindAt = (dueMs - task.reminderMinutes * 60 * 1000) / 1000
      if (remindAt <= now) continue

      const minLabel = task.reminderMinutes >= 60
        ? `${task.reminderMinutes / 60} 小时`
        : `${task.reminderMinutes} 分钟`
      reminders.push({
        id: `${task.id}-${task.dueDate}-${task.dueTime}-${task.reminderMinutes}`,
        title: '⏰ 任务提醒',
        body: `「${task.title}」将在 ${minLabel}后截止`,
        notifyAt: remindAt,
      })
    }

    try {
      const queued = await invoke<number>('schedule_todo_reminders', { reminders })
      _notifStatus.value.osScheduledCount = queued
      if (queued !== reminders.length) {
        console.warn(`[notif] OS scheduled ${queued}/${reminders.length} reminders`)
      }
    } catch (e) {
      _notifStatus.value.osScheduledCount = 0
      _notifStatus.value.lastError = `OS 后台调度失败: ${e}`
      console.error('[notif] schedule_todo_reminders failed:', e)
    }
  }

  // ─── Dock badge ───────────────────────────────────────────────────────────
  async function updateDockBadge() {
    const count = store.countByFilter('today')
    try { await invoke('set_dock_badge', { count }) } catch {}
  }

  let stopBadgeWatcher: (() => void) | null = null

  // ─── Lifecycle ────────────────────────────────────────────────────────────
  onMounted(async () => {
    await ensurePermission()
    if (store.tasks.length === 0) await store.load()

    await scheduleOsReminders()
    updateDockBadge()
    checkAndNotify()
    notifyTimer = setInterval(checkAndNotify, NOTIFY_INTERVAL_MS)
    pollTimer   = setInterval(() => {
      if (store.apiStatus === 'connected') store.load()
    }, POLL_INTERVAL_MS)

    stopWatcher = watch(() => store.tasks, scheduleOsReminders, { deep: true })
    stopBadgeWatcher = watch(() => store.tasks, updateDockBadge, { deep: true })
  })

  onUnmounted(() => {
    if (notifyTimer) clearInterval(notifyTimer)
    if (pollTimer)   clearInterval(pollTimer)
    if (stopWatcher) stopWatcher()
    if (stopBadgeWatcher) stopBadgeWatcher()
  })
}
