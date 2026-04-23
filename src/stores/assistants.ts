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
