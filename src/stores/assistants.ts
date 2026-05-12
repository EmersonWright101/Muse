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
      }, {
        onConflict: async () => {
          const remote = await apiGet<RemoteAssistant>(`/api/assistants/${id}`)
          if (!remote) {
            return {
              name:               updated.name,
              system_prompt:      updated.systemPrompt,
              color:              updated.color,
              default_provider_id: updated.defaultProviderId,
              default_model_id:    updated.defaultModelId,
              updated_at:         updated.updatedAt,
            }
          }
          return {
            name:               updated.name || remote.name,
            system_prompt:      updated.systemPrompt || remote.systemPrompt,
            color:              updated.color || remote.color,
            default_provider_id: updated.defaultProviderId ?? remote.defaultProviderId,
            default_model_id:    updated.defaultModelId ?? remote.defaultModelId,
            updated_at:         new Date().toISOString(),
          }
        },
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

  function fingerprint(a: { name: string; systemPrompt: string; color: string; defaultProviderId?: string; defaultModelId?: string }): string {
    return `${a.name}|${a.systemPrompt}|${a.color}|${a.defaultProviderId ?? ''}|${a.defaultModelId ?? ''}`
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

      const localAll = await listAssistants()

      // Check if backend is empty → migrate local data
      if (active.length === 0) {
        if (localAll.length > 0) {
          for (const a of localAll) {
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
          assistants.value = localAll
          return
        }
      }

      const byFp = new Map<string, { locals: Assistant[]; remotes: Assistant[] }>()
      for (const a of localAll) {
        const fp = fingerprint(a)
        const entry = byFp.get(fp) ?? { locals: [], remotes: [] }
        entry.locals.push(a)
        byFp.set(fp, entry)
      }
      for (const a of active) {
        const fp = fingerprint(a)
        const entry = byFp.get(fp) ?? { locals: [], remotes: [] }
        entry.remotes.push(a)
        byFp.set(fp, entry)
      }

      const merged: Assistant[] = []
      for (const [, entry] of byFp) {
        if (entry.locals.length > 0 && entry.remotes.length > 0) {
          const all = [...entry.locals, ...entry.remotes]
          const smallestId = all.map(a => a.id).sort()[0]
          const latestUpdatedAt = all.map(a => a.updatedAt).sort().pop()!
          const base = all.find(a => a.id === smallestId)!
          const mergedAssistant: Assistant = {
            ...base,
            id: smallestId,
            updatedAt: latestUpdatedAt,
          }
          await saveAssistant(mergedAssistant)
          merged.push(mergedAssistant)
        } else if (entry.remotes.length > 0) {
          const rep = entry.remotes[0]
          await saveAssistant(rep)
          merged.push(rep)
        } else {
          for (const a of entry.locals) {
            await apiPost('/api/assistants', {
              id:                  a.id,
              name:                a.name,
              system_prompt:       a.systemPrompt,
              color:               a.color,
              default_provider_id: a.defaultProviderId,
              default_model_id:    a.defaultModelId,
              created_at:          a.createdAt,
              updated_at:          a.updatedAt,
            }).catch(() => {})
            await saveAssistant(a)
            merged.push(a)
          }
        }
      }

      assistants.value = merged
    } catch { /* ignore */ }
  }

  load()

  return { assistants, load, create, update, remove, syncFromServer }
})
