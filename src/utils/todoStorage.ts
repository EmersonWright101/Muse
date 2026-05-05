/**
 * File-based storage for todos.
 *
 * Layout under {dataRoot}/todos/:
 *   todos/data.json  — full TodoData (projects + tasks)
 */

import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs'
import { resolveDataRoot } from './path'

// ─── Types ────────────────────────────────────────────────────────────────────

export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent'
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
export type Quadrant = 'q1' | 'q2' | 'q3' | 'q4'

export interface SubTask {
  id: string
  title: string
  completed: boolean
}

export interface TodoTask {
  id: string
  projectId: string | null
  title: string
  notes: string
  priority: Priority
  dueDate: string | null
  dueTime: string | null
  reminderMinutes: number | null
  tags: string[]
  completed: boolean
  completedAt: string | null
  createdAt: string
  updatedAt: string
  subtasks: SubTask[]
  recurrence: Recurrence
  starred: boolean
  order: number
  quadrant: Quadrant | null
}

export interface TodoProject {
  id: string
  name: string
  color: string
  icon: string
  createdAt: string
  order: number
}

export interface TodoData {
  version: number
  projects: TodoProject[]
  tasks: TodoTask[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function todosDir(): Promise<string> {
  return `${await resolveDataRoot()}/todos`
}

async function dataPath(): Promise<string> {
  return `${await todosDir()}/data.json`
}

const EMPTY_DATA: TodoData = { version: 1, projects: [], tasks: [] }

// ─── API ─────────────────────────────────────────────────────────────────────

export async function loadTodos(): Promise<TodoData> {
  try {
    const p = await dataPath()
    if (!(await exists(p))) return { ...EMPTY_DATA }
    const raw = await readTextFile(p)
    const data = JSON.parse(raw) as TodoData
    data.tasks = data.tasks.map(t => ({ ...t, reminderMinutes: (t as any).reminderMinutes ?? null }))
    return data
  } catch {
    return { ...EMPTY_DATA }
  }
}

export async function saveTodos(data: TodoData): Promise<void> {
  const dir = await todosDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const p = await dataPath()
  await writeTextFile(p, JSON.stringify(data, null, 2))
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

export function newTask(partial: Partial<TodoTask> = {}): TodoTask {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    projectId: null,
    title: '',
    notes: '',
    priority: 'none',
    dueDate: null,
    dueTime: null,
    reminderMinutes: null,
    tags: [],
    completed: false,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    subtasks: [],
    recurrence: 'none',
    starred: false,
    order: Date.now(),
    quadrant: null,
    ...partial,
  }
}

export function newProject(partial: Partial<TodoProject> = {}): TodoProject {
  const PROJECT_COLORS = [
    '#5856d6', '#007aff', '#34c759', '#ff9500',
    '#ff3b30', '#af52de', '#00c7be', '#223F79',
  ]
  const PROJECT_ICONS = ['📁', '🏠', '💼', '🎯', '📚', '🏃', '🎨', '🛒']
  const idx = Math.floor(Math.random() * PROJECT_COLORS.length)
  return {
    id: crypto.randomUUID(),
    name: '',
    color: PROJECT_COLORS[idx],
    icon: PROJECT_ICONS[idx],
    createdAt: new Date().toISOString(),
    order: Date.now(),
    ...partial,
  }
}
