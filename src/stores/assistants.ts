import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  listAssistants,
  saveAssistant,
  deleteAssistant,
  newId,
  type Assistant,
} from '../utils/storage'
import { apiGet, apiPost, apiPut, apiDelete, isBackendConfigured } from '../services/api'

export type { Assistant }

export const ASSISTANT_COLORS = [
  '#5B8AF5',
  '#E4983D',
  '#52BA6F',
  '#F5609E',
  '#9B6CF0',
  '#20BDB8',
  '#F0A830',
  '#E55E5E',
]

interface RemoteAssistant {
  id: string
  name: string
  systemPrompt: string
  color: string
  defaultProviderId?: string
  defaultModelId?: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export const useAssistantsStore = defineStore('assistants', () => {
  const assistants = ref<Assistant[]>([])

  async function load() {
    if (isBackendConfigured()) {
      try {
        const remote = await apiGet<RemoteAssistant[]>('/api/assistants')
        if (remote) {
          // Filter soft-deleted records; apply to local store and file
          const active = remote.filter(a => !a.deletedAt).map(a => ({
            id:                a.id,
            name:              a.name,
            systemPrompt:      a.systemPrompt,
            color:             a.color,
            defaultProviderId: a.defaultProviderId,
            defaultModelId:    a.defaultModelId,
            createdAt:         a.createdAt,
            updatedAt:         a.updatedAt,
          } as Assistant))
          // Persist to local file as cache
          for (const a of active) await saveAssistant(a)
          assistants.value = active
          return
        }
      } catch { /* fall through to local */ }
    }
    assistants.value = await listAssistants()
  }

  async function create(
    name: string, systemPrompt: string, color: string,
    defaultProviderId?: string, defaultModelId?: string,
  ): Promise<Assistant> {
    const now = new Date().toISOString()
    const a: Assistant = {
      id:           newId(),
      name:         name.trim(),
      systemPrompt: systemPrompt.trim(),
      color,
      defaultProviderId,
      defaultModelId,
      createdAt:    now,
      updatedAt:    now,
    }
    await saveAssistant(a)
    if (isBackendConfigured()) {
      apiPost('/api/assistants', {
        id:                 a.id,
        name:               a.name,
        system_prompt:      a.systemPrompt,
        color:              a.color,
        default_provider_id: a.defaultProviderId,
        default_model_id:    a.defaultModelId,
        created_at:         a.createdAt,
        updated_at:         a.updatedAt,
      }).catch(() => {})
    }
    await load()
    return a
  }

  async function update(
    id: string, name: string, systemPrompt: string, color: string,
    defaultProviderId?: string, defaultModelId?: string,
  ) {
    const existing = assistants.value.find(a => a.id === id)
    if (!existing) return
    const updated: Assistant = {
      ...existing,
      name: name.trim(),
      systemPrompt: systemPrompt.trim(),
      color,
      defaultProviderId,
      defaultModelId,
      updatedAt: new Date().toISOString(),
    }
    await saveAssistant(updated)
    if (isBackendConfigured()) {
      apiPut(`/api/assistants/${id}`, {
        name:               updated.name,
        system_prompt:      updated.systemPrompt,
        color:              updated.color,
        default_provider_id: updated.defaultProviderId,
        default_model_id:    updated.defaultModelId,
        updated_at:         updated.updatedAt,
      }).catch(() => {})
    }
    await load()
  }

  async function remove(id: string) {
    await deleteAssistant(id)
    if (isBackendConfigured()) {
      apiDelete(`/api/assistants/${id}`).catch(() => {})
    }
    await load()
  }

  async function syncFromServer() {
    if (!isBackendConfigured()) return
    try {
      const remote = await apiGet<RemoteAssistant[]>('/api/assistants')
      if (!remote) return
      const active = remote.filter(a => !a.deletedAt).map(a => ({
        id:                a.id,
        name:              a.name,
        systemPrompt:      a.systemPrompt,
        color:             a.color,
        defaultProviderId: a.defaultProviderId,
        defaultModelId:    a.defaultModelId,
        createdAt:         a.createdAt,
        updatedAt:         a.updatedAt,
      } as Assistant))

      // Check if backend is empty → migrate local data
      if (active.length === 0) {
        const local = await listAssistants()
        if (local.length > 0) {
          for (const a of local) {
            await apiPost('/api/assistants', {
              id:                 a.id,
              name:               a.name,
              system_prompt:      a.systemPrompt,
              color:              a.color,
              default_provider_id: a.defaultProviderId,
              default_model_id:    a.defaultModelId,
              created_at:         a.createdAt,
              updated_at:         a.updatedAt,
            }).catch(() => {})
          }
          assistants.value = local
          return
        }
      }

      for (const a of active) await saveAssistant(a)
      assistants.value = active

      // Push local assistants not on remote at all (handles failed uploads)
      const remoteIds = new Set(remote.map(a => a.id))
      const localAll = await listAssistants()
      const newlyPushed: Assistant[] = []
      for (const a of localAll) {
        if (remoteIds.has(a.id)) continue
        apiPost('/api/assistants', {
          id:                  a.id,
          name:                a.name,
          system_prompt:       a.systemPrompt,
          color:               a.color,
          default_provider_id: a.defaultProviderId,
          default_model_id:    a.defaultModelId,
          created_at:          a.createdAt,
          updated_at:          a.updatedAt,
        }).catch(() => {})
        newlyPushed.push(a)
      }
      if (newlyPushed.length > 0) {
        assistants.value = [...assistants.value, ...newlyPushed]
      }
    } catch { /* ignore */ }
  }

  load()

  return { assistants, load, create, update, remove, syncFromServer }
})
