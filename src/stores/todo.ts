import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  loadTodos,
  saveTodos,
  newTask,
  newProject,
  type TodoTask,
  type TodoProject,
  type Priority,
  type Quadrant,
} from '../utils/todoStorage'
import {
  getApiConfig,
  setApiConfig,
  pingApi,
  apiLoadAll,
  apiCreateTask,
  apiUpdateTask,
  apiDeleteTask,
  apiCreateProject,
  apiUpdateProject,
  apiDeleteProject,
  type TodoApiConfig,
} from '../utils/todoApi'

export type { TodoTask, TodoProject, Priority, Quadrant, TodoApiConfig }
export type ViewMode = 'list' | 'calendar' | 'kanban' | 'quadrant'
export type SortMode = 'manual' | 'priority' | 'dueDate' | 'createdAt' | 'title'
export type FilterKey = 'inbox' | 'today' | 'upcoming' | 'starred' | 'all' | 'completed' | string
export type ApiStatus = 'unconfigured' | 'connected' | 'error'

// ─── Pending ops queue (offline support) ─────────────────────────────────────

type PendingOp =
  | { type: 'createTask';    d: TodoTask }
  | { type: 'updateTask';    d: TodoTask }
  | { type: 'deleteTask';    id: string }
  | { type: 'createProject'; d: TodoProject }
  | { type: 'updateProject'; d: TodoProject }
  | { type: 'deleteProject'; id: string }

const LS_PENDING_KEY = 'muse-todo-pending'

function loadPending(): PendingOp[] {
  try { return JSON.parse(localStorage.getItem(LS_PENDING_KEY) ?? '[]') }
  catch { return [] }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useTodoStore = defineStore('todo', () => {
  const projects = ref<TodoProject[]>([])
  const tasks = ref<TodoTask[]>([])
  const isLoading = ref(true)
  const activeFilter = ref<FilterKey>('today')
  const activeTaskId = ref<string | null>(null)
  const viewMode = ref<ViewMode>('list')
  const sortMode = ref<SortMode>('manual')
  const searchQuery = ref('')
  const showCompleted = ref(false)

  // ─── API state ───────────────────────────────────────────────────────────────

  const apiStatus = ref<ApiStatus>(getApiConfig() ? 'connected' : 'unconfigured')
  const apiError  = ref<string | null>(null)

  // Pending ops survive app restarts via localStorage
  const _pendingOps = ref<PendingOp[]>(loadPending())
  const pendingCount = computed(() => _pendingOps.value.length)

  function _savePending() {
    localStorage.setItem(LS_PENDING_KEY, JSON.stringify(_pendingOps.value))
  }

  function _enqueuePending(op: PendingOp) {
    // For updates: replace the existing queued update for the same id (only keep latest)
    if (op.type === 'updateTask') {
      const idx = _pendingOps.value.findIndex(o => o.type === 'updateTask' && (o as any).d.id === op.d.id)
      if (idx !== -1) { _pendingOps.value[idx] = op; _savePending(); return }
    }
    if (op.type === 'updateProject') {
      const idx = _pendingOps.value.findIndex(o => o.type === 'updateProject' && (o as any).d.id === op.d.id)
      if (idx !== -1) { _pendingOps.value[idx] = op; _savePending(); return }
    }
    // For deletes: cancel any pending create/update for the same id (no point syncing them)
    if (op.type === 'deleteTask') {
      _pendingOps.value = _pendingOps.value.filter(o =>
        !((o.type === 'createTask' || o.type === 'updateTask') && o.d.id === op.id)
      )
    }
    if (op.type === 'deleteProject') {
      _pendingOps.value = _pendingOps.value.filter(o =>
        !((o.type === 'createProject' || o.type === 'updateProject') && o.d.id === op.id)
      )
    }
    _pendingOps.value.push(op)
    _savePending()
  }

  // Drain the queue against the backend; stops at first failure
  async function _syncPending(c: TodoApiConfig): Promise<boolean> {
    if (_pendingOps.value.length === 0) return true
    const ops = [..._pendingOps.value]
    for (const op of ops) {
      try {
        switch (op.type) {
          case 'createTask':    await apiCreateTask(c, op.d);    break
          case 'updateTask':    await apiUpdateTask(c, op.d);    break
          case 'deleteTask':    await apiDeleteTask(c, op.id);   break
          case 'createProject': await apiCreateProject(c, op.d); break
          case 'updateProject': await apiUpdateProject(c, op.d); break
          case 'deleteProject': await apiDeleteProject(c, op.id);break
        }
        // Remove the successfully synced op
        _pendingOps.value = _pendingOps.value.filter(o => o !== op)
        _savePending()
      } catch (e) {
        _onApiError(e, `syncPending:${op.type}`)
        return false
      }
    }
    return true
  }

  function cfg(): TodoApiConfig | null { return getApiConfig() }

  function saveApiConfig(config: TodoApiConfig | null) {
    setApiConfig(config)
    apiStatus.value = config ? 'connected' : 'unconfigured'
    apiError.value  = null
  }

  async function testApiConnection(config: TodoApiConfig): Promise<{ ok: boolean; message: string }> {
    return pingApi(config)
  }

  function _onApiError(e: unknown, context: string) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[todo-api] ${context}:`, msg)
    apiStatus.value = 'error'
    apiError.value  = msg
  }

  // Per-task debounce timers — reads latest task state at fire time
  const _updateTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function _scheduleApiUpdate(taskId: string) {
    const c = cfg()
    if (!c) return
    const existing = _updateTimers.get(taskId)
    if (existing) clearTimeout(existing)
    _updateTimers.set(taskId, setTimeout(async () => {
      _updateTimers.delete(taskId)
      const task = tasks.value.find(t => t.id === taskId)
      if (!task) return
      try { await apiUpdateTask(c, task) }
      catch (e) {
        _onApiError(e, `updateTask ${taskId}`)
        _enqueuePending({ type: 'updateTask', d: { ...task } })
      }
    }, 500))
  }

  // ─── Persistence ─────────────────────────────────────────────────────────────

  let _saveTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleLocalSave() {
    if (_saveTimer) clearTimeout(_saveTimer)
    _saveTimer = setTimeout(async () => {
      await saveTodos({ version: 1, projects: projects.value, tasks: tasks.value })
    }, 400)
  }

  watch([projects, tasks], scheduleLocalSave, { deep: true })

  async function load() {
    isLoading.value = true
    try {
      const c = cfg()
      if (c) {
        try {
          // Push any offline changes first, then pull the merged state
          await _syncPending(c)
          const remote = await apiLoadAll(c)
          projects.value  = remote.projects
          tasks.value     = remote.tasks
          apiStatus.value = 'connected'
          apiError.value  = null
          await saveTodos({ version: 1, projects: remote.projects, tasks: remote.tasks })
          return
        } catch (e) {
          _onApiError(e, 'load')
          // Fall through to local file
        }
      }
      const data = await loadTodos()
      projects.value = data.projects
      tasks.value    = data.tasks
    } finally {
      isLoading.value = false
    }
  }

  // ─── Computed ────────────────────────────────────────────────────────────────

  const todayStr = computed(() => new Date().toISOString().slice(0, 10))

  const allTags = computed(() => {
    const s = new Set<string>()
    for (const t of tasks.value) for (const tag of t.tags) s.add(tag)
    return Array.from(s).sort()
  })

  function getFilteredTasks(filter: FilterKey): TodoTask[] {
    let list = tasks.value

    if (filter === 'inbox') {
      list = list.filter(t => t.projectId === null)
    } else if (filter === 'today') {
      list = list.filter(t => t.dueDate === todayStr.value || t.starred)
    } else if (filter === 'upcoming') {
      list = list.filter(t => t.dueDate && t.dueDate > todayStr.value)
    } else if (filter === 'starred') {
      list = list.filter(t => t.starred)
    } else if (filter === 'completed') {
      list = list.filter(t => t.completed)
    } else if (filter === 'all') {
      // all tasks
    } else {
      list = list.filter(t => t.projectId === filter)
    }

    if (!showCompleted.value && filter !== 'completed') {
      list = list.filter(t => !t.completed)
    }

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.notes.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q))
      )
    }

    return sortTasks(list)
  }

  const filteredTasks = computed(() => getFilteredTasks(activeFilter.value))

  function sortTasks(list: TodoTask[]): TodoTask[] {
    const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }
    switch (sortMode.value) {
      case 'priority':
        return [...list].sort((a, b) =>
          (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4)
        )
      case 'dueDate':
        return [...list].sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return 0
          if (!a.dueDate) return 1
          if (!b.dueDate) return -1
          return a.dueDate.localeCompare(b.dueDate)
        })
      case 'createdAt':
        return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      case 'title':
        return [...list].sort((a, b) => a.title.localeCompare(b.title))
      default:
        return [...list].sort((a, b) => a.order - b.order)
    }
  }

  const activeTask = computed(() =>
    activeTaskId.value ? tasks.value.find(t => t.id === activeTaskId.value) ?? null : null
  )

  const tasksByDate = computed(() => {
    const map = new Map<string, TodoTask[]>()
    for (const task of tasks.value) {
      if (!task.dueDate || task.completed) continue
      if (!map.has(task.dueDate)) map.set(task.dueDate, [])
      map.get(task.dueDate)!.push(task)
    }
    return map
  })

  function countByFilter(filter: FilterKey): number {
    return getFilteredTasks(filter).filter(t => !t.completed).length
  }

  // ─── Task Actions ────────────────────────────────────────────────────────────

  function addTask(partial: Partial<TodoTask> = {}): TodoTask {
    const projectId = typeof activeFilter.value === 'string' &&
      !['inbox', 'today', 'upcoming', 'starred', 'all', 'completed'].includes(activeFilter.value)
      ? activeFilter.value
      : partial.projectId ?? null

    const dueDate = activeFilter.value === 'today' ? todayStr.value : partial.dueDate ?? null

    const task = newTask({ ...partial, projectId, dueDate, order: Date.now() })
    tasks.value.unshift(task)
    activeTaskId.value = task.id

    const c = cfg()
    if (c) {
      apiCreateTask(c, task).catch(e => {
        _onApiError(e, `createTask ${task.id}`)
        _enqueuePending({ type: 'createTask', d: { ...task } })
      })
    }
    return task
  }

  function updateTask(id: string, patch: Partial<TodoTask>) {
    const idx = tasks.value.findIndex(t => t.id === id)
    if (idx === -1) return
    tasks.value[idx] = { ...tasks.value[idx], ...patch, updatedAt: new Date().toISOString() }
    _scheduleApiUpdate(id)
  }

  function toggleComplete(id: string) {
    const task = tasks.value.find(t => t.id === id)
    if (!task) return
    const completed = !task.completed
    updateTask(id, { completed, completedAt: completed ? new Date().toISOString() : null })

    if (completed && task.recurrence !== 'none' && task.dueDate) {
      const next = nextRecurrenceDate(task.dueDate, task.recurrence)
      const recurred = newTask({ ...task, id: crypto.randomUUID(), completed: false, completedAt: null, dueDate: next, order: Date.now() })
      tasks.value.push(recurred)
      const c = cfg()
      if (c) {
        apiCreateTask(c, recurred).catch(e => {
          _onApiError(e, `createTask(recurrence) ${recurred.id}`)
          _enqueuePending({ type: 'createTask', d: { ...recurred } })
        })
      }
    }
  }

  function toggleStar(id: string) {
    const task = tasks.value.find(t => t.id === id)
    if (!task) return
    updateTask(id, { starred: !task.starred })
  }

  function deleteTask(id: string) {
    tasks.value = tasks.value.filter(t => t.id !== id)
    if (activeTaskId.value === id) activeTaskId.value = null

    const c = cfg()
    if (c) {
      apiDeleteTask(c, id).catch(e => {
        _onApiError(e, `deleteTask ${id}`)
        _enqueuePending({ type: 'deleteTask', id })
      })
    }
  }

  function addSubtask(taskId: string, title: string) {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return
    task.subtasks.push({ id: crypto.randomUUID(), title, completed: false })
    updateTask(taskId, { subtasks: task.subtasks })
  }

  function toggleSubtask(taskId: string, subId: string) {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return
    const sub = task.subtasks.find(s => s.id === subId)
    if (!sub) return
    sub.completed = !sub.completed
    updateTask(taskId, { subtasks: [...task.subtasks] })
  }

  function deleteSubtask(taskId: string, subId: string) {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return
    updateTask(taskId, { subtasks: task.subtasks.filter(s => s.id !== subId) })
  }

  // ─── Project Actions ─────────────────────────────────────────────────────────

  function addProject(partial: Partial<TodoProject> = {}): TodoProject {
    const project = newProject({ ...partial, order: Date.now() })
    projects.value.push(project)

    const c = cfg()
    if (c) {
      apiCreateProject(c, project).catch(e => {
        _onApiError(e, `createProject ${project.id}`)
        _enqueuePending({ type: 'createProject', d: { ...project } })
      })
    }
    return project
  }

  function updateProject(id: string, patch: Partial<TodoProject>) {
    const idx = projects.value.findIndex(p => p.id === id)
    if (idx === -1) return
    projects.value[idx] = { ...projects.value[idx], ...patch }

    const c = cfg()
    if (c) {
      apiUpdateProject(c, projects.value[idx]).catch(e => {
        _onApiError(e, `updateProject ${id}`)
        _enqueuePending({ type: 'updateProject', d: { ...projects.value[idx] } })
      })
    }
  }

  function deleteProject(id: string) {
    projects.value = projects.value.filter(p => p.id !== id)
    tasks.value = tasks.value.filter(t => t.projectId !== id)
    if (activeFilter.value === id) activeFilter.value = 'inbox'

    const c = cfg()
    if (c) {
      apiDeleteProject(c, id).catch(e => {
        _onApiError(e, `deleteProject ${id}`)
        _enqueuePending({ type: 'deleteProject', id })
      })
    }
  }

  // ─── Quadrant ────────────────────────────────────────────────────────────────

  function setTaskQuadrant(id: string, quadrant: Quadrant | null) {
    updateTask(id, { quadrant })
  }

  function getQuadrantTasks(q: Quadrant): TodoTask[] {
    return tasks.value.filter(t => t.quadrant === q && !t.completed)
  }

  const unassignedTasks = computed(() =>
    tasks.value.filter(t => !t.quadrant && !t.completed)
  )

  // ─── Utils ───────────────────────────────────────────────────────────────────

  function nextRecurrenceDate(from: string, recurrence: string): string {
    const d = new Date(from)
    if (recurrence === 'daily') d.setDate(d.getDate() + 1)
    else if (recurrence === 'weekly') d.setDate(d.getDate() + 7)
    else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1)
    else if (recurrence === 'yearly') d.setFullYear(d.getFullYear() + 1)
    return d.toISOString().slice(0, 10)
  }

  return {
    projects,
    tasks,
    isLoading,
    activeFilter,
    activeTaskId,
    activeTask,
    viewMode,
    sortMode,
    searchQuery,
    showCompleted,
    allTags,
    filteredTasks,
    tasksByDate,
    todayStr,
    load,
    countByFilter,
    addTask,
    updateTask,
    toggleComplete,
    toggleStar,
    deleteTask,
    addSubtask,
    toggleSubtask,
    deleteSubtask,
    addProject,
    updateProject,
    deleteProject,
    setTaskQuadrant,
    getQuadrantTasks,
    unassignedTasks,
    // API
    apiStatus,
    apiError,
    pendingCount,
    saveApiConfig,
    testApiConnection,
  }
})
