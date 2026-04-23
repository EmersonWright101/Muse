import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  listAssistants,
  saveAssistant,
  deleteAssistant,
  newId,
  type Assistant,
} from '../utils/storage'

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

export const useAssistantsStore = defineStore('assistants', () => {
  const assistants = ref<Assistant[]>([])

  async function load() {
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
    await load()
    return a
  }

  async function update(
    id: string, name: string, systemPrompt: string, color: string,
    defaultProviderId?: string, defaultModelId?: string,
  ) {
    const existing = assistants.value.find(a => a.id === id)
    if (!existing) return
    await saveAssistant({
      ...existing,
      name: name.trim(),
      systemPrompt: systemPrompt.trim(),
      color,
      defaultProviderId,
      defaultModelId,
      updatedAt: new Date().toISOString(),
    })
    await load()
  }

  async function remove(id: string) {
    await deleteAssistant(id)
    await load()
  }

  load()

  return { assistants, load, create, update, remove }
})

// ─── Sync module ─────────────────────────────────────────────────────────────

import { syncService } from '../services/sync'
import type { SyncModule } from '../services/sync/types'
import {
  getDeletedAssistants,
  applyRemoteDeletedAssistants,
} from '../utils/storage'

const MOD_AST = 'assistants'

interface AssistantsPayload {
  list: Assistant[]
  deletedAssistants: Record<string, string>
}

const assistantsSyncModule: SyncModule = {
  id: MOD_AST,
  remoteDirs: ['assistants'],
  getLocalTimestamp() {
    return localStorage.getItem('muse-ts-assistants') ?? new Date(0).toISOString()
  },
  async sync(ctx, localChanged) {
    ctx.setProgress('同步助手配置…')
    const localList = await listAssistants()
    const path = ctx.rp('assistants/list.enc')

    const raw = await ctx.getEncrypted<AssistantsPayload | Assistant[]>(path, { list: [], deletedAssistants: {} })
    const remotePayload: AssistantsPayload = Array.isArray(raw)
      ? { list: raw, deletedAssistants: {} }
      : raw

    applyRemoteDeletedAssistants(remotePayload.deletedAssistants ?? {})
    const mergedDeleted = getDeletedAssistants()

    function isDeleted(a: Assistant): boolean {
      const ts = mergedDeleted[a.id]
      return !!ts && ts > (a.updatedAt ?? a.createdAt)
    }

    const merged = new Map<string, Assistant>()
    for (const a of localList) if (!isDeleted(a)) merged.set(a.id, a)
    for (const a of remotePayload.list) if (!isDeleted(a)) {
      const local = merged.get(a.id)
      if (!local || (a.updatedAt ?? a.createdAt) > (local.updatedAt ?? local.createdAt)) {
        merged.set(a.id, a)
      }
    }

    const mergedList = [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    for (const a of mergedList) {
      const local = localList.find(l => l.id === a.id)
      if (!local || (a.updatedAt ?? a.createdAt) > (local.updatedAt ?? local.createdAt)) {
        await saveAssistant(a)
      }
    }
    for (const local of localList) {
      if (isDeleted(local)) await deleteAssistant(local.id)
    }

    if (!localChanged) return
    await ctx.putEncrypted(path, { list: mergedList, deletedAssistants: mergedDeleted } satisfies AssistantsPayload)
  },
  async onSynced() {
    await useAssistantsStore().load()
  },
}

syncService.register(assistantsSyncModule)
