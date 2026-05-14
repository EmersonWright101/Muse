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
import { recordSyncTimestamp } from '../utils/syncTimestamp'

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

// ─── Content-based deduplication helpers ─────────────────────────────────────

function projectFingerprint(p: TodoProject): string {
  return `${p.name}\x00${p.color}`
}

function taskFingerprint(t: TodoTask): string {
  return `${t.title}\x00${t.notes}\x00${t.dueDate ?? ''}\x00${t.projectId ?? ''}`
}

function dedupProjects(projects: TodoProject[]): { projects: TodoProject[]; remap: Map<string, string> } {
  const groups = new Map<string, TodoProject[]>()
  for (const p of projects) {
    const fp = projectFingerprint(p)
    const arr = groups.get(fp) ?? []
    arr.push(p)
    groups.set(fp, arr)
  }
  const deduped: TodoProject[] = []
  const remap = new Map<string, string>()
  for (const group of groups.values()) {
    group.sort((a, b) => a.id.localeCompare(b.id))
    const kept = group[0]
    deduped.push(kept)
    for (let i = 1; i < group.length; i++) {
      remap.set(group[i].id, kept.id)
    }
  }
  return { projects: deduped, remap }
}

function dedupTasks(tasks: TodoTask[]): { tasks: TodoTask[]; discardedIds: Set<string> } {
  const groups = new Map<string, TodoTask[]>()
  for (const t of tasks) {
    const fp = taskFingerprint(t)
    const arr = groups.get(fp) ?? []
    arr.push(t)
    groups.set(fp, arr)
  }
  const deduped: TodoTask[] = []
  const discardedIds = new Set<string>()
  for (const group of groups.values()) {
    group.sort((a, b) => a.id.localeCompare(b.id))
    const kept = { ...group[0] }
    for (let i = 1; i < group.length; i++) {
      discardedIds.add(group[i].id)
      const other = group[i]
      if (other.completed && !kept.completed) {
        kept.completed = true
        if (other.completedAt && (!kept.completedAt || other.completedAt > kept.completedAt)) {
          kept.completedAt = other.completedAt
        }
      }
      if (other.updatedAt > kept.updatedAt) {
        kept.updatedAt = other.updatedAt
      }
    }
    deduped.push(kept)
  }
  return { tasks: deduped, discardedIds }
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

  // Guard against concurrent load() calls (each call uploads local-only tasks, racing calls duplicate them)
  let _loadInProgress = false

  // Per-task debounce timers — coalesces rapid edits (e.g. typing) into one request
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
      try {
        await apiUpdateTask(c, task, {
          onConflict: async () => {
            const remote = await apiLoadAll(c)
            const remoteTask = remote.tasks.find(t => t.id === taskId)
            if (!remoteTask) return task
            return {
              ...remoteTask,
              title: task.title,
              notes: task.notes,
              tags: task.tags,
              dueDate: task.dueDate,
              dueTime: task.dueTime,
              priority: task.priority,
              quadrant: task.quadrant,
              projectId: task.projectId,
              starred: task.starred,
              recurrence: task.recurrence,
              reminderMinutes: task.reminderMinutes,
              subtasks: task.subtasks,
              order: task.order,
              updatedAt: new Date().toISOString(),
            }
          },
        })
      }
      catch (e) {
        _onApiError(e, `updateTask ${taskId}`)
        _enqueuePending({ type: 'updateTask', d: { ...task } })
      }
    }, 500))
  }

  // Per-project debounce timers
  const _projectUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function _scheduleProjectUpdate(projectId: string) {
    const c = cfg()
    if (!c) return
    const existing = _projectUpdateTimers.get(projectId)
    if (existing) clearTimeout(existing)
    _projectUpdateTimers.set(projectId, setTimeout(async () => {
      _projectUpdateTimers.delete(projectId)
      const project = projects.value.find(p => p.id === projectId)
      if (!project) return
      try {
        await apiUpdateProject(c, project, {
          onConflict: async () => {
            const remote = await apiLoadAll(c)
            const remoteProject = remote.projects.find(p => p.id === projectId)
            if (!remoteProject) return project
            return {
              ...remoteProject,
              name: project.name,
              color: project.color,
              order: project.order,
              updatedAt: new Date().toISOString(),
            }
          },
        })
      }
      catch (e) {
        _onApiError(e, `updateProject ${projectId}`)
        _enqueuePending({ type: 'updateProject', d: { ...project } })
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
    if (_loadInProgress) return   // prevent concurrent calls that cause task duplication
    _loadInProgress = true
    isLoading.value = true
    try {
      const c = cfg()
      if (c) {
        try {
          const localData = await loadTodos()

          await _syncPending(c)
          const remote = await apiLoadAll(c)

          // Merge by ID: remote wins for same IDs
          const projectById = new Map<string, TodoProject>()
          for (const p of remote.projects) projectById.set(p.id, p)
          for (const p of localData.projects) if (!projectById.has(p.id)) projectById.set(p.id, p)

          const taskById = new Map<string, TodoTask>()
          for (const t of remote.tasks) taskById.set(t.id, t)
          for (const t of localData.tasks) if (!taskById.has(t.id)) taskById.set(t.id, t)

          // 1. Deduplicate projects by name|color
          const { projects: dedupedProjects, remap: projectRemap } = dedupProjects(Array.from(projectById.values()))

          // 2. Remap task projectIds to kept project
          const remappedTasks = Array.from(taskById.values()).map(t => {
            if (t.projectId && projectRemap.has(t.projectId)) {
              return { ...t, projectId: projectRemap.get(t.projectId)! }
            }
            return t
          })

          // 3. Deduplicate tasks by title|description|dueDate|projectId
          const { tasks: dedupedTasks, discardedIds: discardedTaskIds } = dedupTasks(remappedTasks)

          const remoteProjectIds = new Set(remote.projects.map(p => p.id))
          const remoteTaskIds = new Set(remote.tasks.map(t => t.id))
          const remoteTaskMap = new Map(remote.tasks.map(t => [t.id, t]))

          // Push project changes back to server
          const projectDeletions = Array.from(projectRemap.keys())
            .filter(oldId => remoteProjectIds.has(oldId))
            .map(oldId => apiDeleteProject(c, oldId).catch(() => {}))

          const projectCreationMap = new Map<string, TodoProject>()
          const projectCreations = dedupedProjects
            .filter(p => !remoteProjectIds.has(p.id))
            .map(async p => {
              try {
                const created = await apiCreateProject(c, p)
                projectCreationMap.set(p.id, created)
              } catch (e) {
                console.warn('[todo-api] createProject during dedup:', e instanceof Error ? e.message : e)
              }
            })

          await Promise.allSettled([...projectDeletions, ...projectCreations])

          // Capture any server-assigned project ID changes
          const projectIdChanges = new Map<string, string>()
          for (let i = 0; i < dedupedProjects.length; i++) {
            const p = dedupedProjects[i]
            if (!remoteProjectIds.has(p.id)) {
              const created = projectCreationMap.get(p.id)
              if (created) {
                if (created.id !== p.id) projectIdChanges.set(p.id, created.id)
                dedupedProjects[i] = created
              }
            }
          }

          // Apply any project ID changes to tasks
          const finalTasks = dedupedTasks.map(t => {
            if (t.projectId && projectIdChanges.has(t.projectId)) {
              return { ...t, projectId: projectIdChanges.get(t.projectId)! }
            }
            return t
          })

          // Push task changes back to server
          const taskDeletions = Array.from(discardedTaskIds)
            .filter(id => remoteTaskIds.has(id))
            .map(id => apiDeleteTask(c, id).catch(() => {}))

          const taskCreationMap = new Map<string, TodoTask>()
          const taskCreations = finalTasks
            .filter(t => !remoteTaskIds.has(t.id))
            .map(async t => {
              try {
                const created = await apiCreateTask(c, t)
                taskCreationMap.set(t.id, created)
              } catch (e) {
                console.warn('[todo-api] createTask during dedup:', e instanceof Error ? e.message : e)
              }
            })

          const taskUpdates = finalTasks
            .filter(t => remoteTaskIds.has(t.id))
            .filter(t => {
              const orig = remoteTaskMap.get(t.id)!
              return t.completed !== orig.completed || t.updatedAt !== orig.updatedAt || t.projectId !== orig.projectId
            })
            .map(t => apiUpdateTask(c, t).catch(e => {
              console.warn('[todo-api] updateTask during dedup:', e instanceof Error ? e.message : e)
            }))

          await Promise.allSettled([...taskDeletions, ...taskCreations, ...taskUpdates])

          // Update finalTasks with server-returned versions for newly created tasks
          for (let i = 0; i < finalTasks.length; i++) {
            const t = finalTasks[i]
            if (!remoteTaskIds.has(t.id)) {
              const created = taskCreationMap.get(t.id)
              if (created) finalTasks[i] = created
            }
          }

          projects.value = dedupedProjects
          tasks.value = finalTasks
          apiStatus.value = 'connected'
          apiError.value = null
          await saveTodos({ version: 1, projects: dedupedProjects, tasks: finalTasks })
          recordSyncTimestamp('todo', new Date().toISOString())
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
      _loadInProgress = false
    }
  }

  // ─── Computed ────────────────────────────────────────────────────────────────

  const todayStr = computed(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

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
      list = list.filter(t => (t.dueDate && t.dueDate <= todayStr.value) || t.starred)
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

    const dueDate = partial.dueDate ?? (activeFilter.value === 'today' ? todayStr.value : null)

    const task = newTask({ ...partial, projectId, dueDate, order: Date.now() })
    tasks.value.unshift(task)
    activeTaskId.value = task.id

    const c = cfg()
    if (c) {
      apiCreateTask(c, task).then(created => {
        if (created.id !== task.id) {
          const idx = tasks.value.findIndex(t => t.id === task.id)
          if (idx !== -1) tasks.value[idx] = { ...tasks.value[idx], id: created.id }
          if (activeTaskId.value === task.id) activeTaskId.value = created.id
        }
      }).catch(e => {
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
      apiCreateProject(c, project).then(created => {
        if (created.id !== project.id) {
          const idx = projects.value.findIndex(p => p.id === project.id)
          if (idx !== -1) projects.value[idx] = { ...projects.value[idx], id: created.id }
          if (activeFilter.value === project.id) activeFilter.value = created.id
        }
      }).catch(e => {
        _onApiError(e, `createProject ${project.id}`)
        _enqueuePending({ type: 'createProject', d: { ...project } })
      })
    }
    return project
  }

  function updateProject(id: string, patch: Partial<TodoProject>) {
    const idx = projects.value.findIndex(p => p.id === id)
    if (idx === -1) return
    projects.value[idx] = { ...projects.value[idx], ...patch, updatedAt: new Date().toISOString() }
    _scheduleProjectUpdate(id)
  }

  function deleteProject(id: string, deleteTasks: boolean = true) {
    projects.value = projects.value.filter(p => p.id !== id)
    const c = cfg()

    if (deleteTasks) {
      const orphanIds = tasks.value.filter(t => t.projectId === id).map(t => t.id)
      tasks.value = tasks.value.filter(t => t.projectId !== id)
      if (c) {
        // Cascade deletes are background cleanup — log failures but don't toast
        // (the user's primary action succeeded locally; many backends also auto-cascade)
        for (const tid of orphanIds) {
          apiDeleteTask(c, tid).catch(e => {
            console.warn(`[todo-api] cascade deleteTask ${tid}:`, e instanceof Error ? e.message : e)
            _enqueuePending({ type: 'deleteTask', id: tid })
          })
        }
      }
    } else {
      const now = new Date().toISOString()
      tasks.value = tasks.value.map(t =>
        t.projectId === id ? { ...t, projectId: null, updatedAt: now } : t
      )
      if (c) {
        for (const t of tasks.value) {
          if (t.projectId === null && t.updatedAt === now) _scheduleApiUpdate(t.id)
        }
      }
    }

    if (activeFilter.value === id) activeFilter.value = 'inbox'

    if (c) {
      apiDeleteProject(c, id).catch(e => {
        console.warn(`[todo-api] deleteProject ${id}:`, e instanceof Error ? e.message : e)
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
    const [y, m, day] = from.split('-').map(Number)
    const d = new Date(y, m - 1, day)
    if (recurrence === 'daily') d.setDate(d.getDate() + 1)
    else if (recurrence === 'weekly') d.setDate(d.getDate() + 7)
    else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1)
    else if (recurrence === 'yearly') d.setFullYear(d.getFullYear() + 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
