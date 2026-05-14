import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiPut } from '../services/api'

const LS_KEY = 'assistant-settings'

interface Persisted {
  providerId: string
  modelId: string
  titleGenProviderId: string
  titleGenModelId: string
  titleGenPrompt: string
}

export const DEFAULT_TITLE_PROMPT =
  '根据以下对话内容，用不超过10个字生成一个简短的话题标题，只输出标题文本，不要加引号或其他标点。\n用户：{user}\nAI：{response}'

function loadPersisted(): Partial<Persisted> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') } catch { return {} }
}

export const useAssistantSettingsStore = defineStore('assistantSettings', () => {
  const saved = loadPersisted()

  const providerId         = ref(saved.providerId         ?? '')
  const modelId            = ref(saved.modelId            ?? '')
  const titleGenProviderId = ref(saved.titleGenProviderId ?? '')
  const titleGenModelId    = ref(saved.titleGenModelId    ?? '')
  const titleGenPrompt     = ref(saved.titleGenPrompt     ?? DEFAULT_TITLE_PROMPT)

  let _pushTimer: ReturnType<typeof setTimeout> | null = null

  function persist() {
    const data: Persisted = {
      providerId:         providerId.value,
      modelId:            modelId.value,
      titleGenProviderId: titleGenProviderId.value,
      titleGenModelId:    titleGenModelId.value,
      titleGenPrompt:     titleGenPrompt.value,
    }
    localStorage.setItem(LS_KEY, JSON.stringify(data))
    if (_pushTimer) clearTimeout(_pushTimer)
    _pushTimer = setTimeout(() => {
      apiPut('/api/settings/privateAssistant', { value: data }).catch(() => {})
    }, 800)
  }

  async function pushToServer() {
    if (_pushTimer) { clearTimeout(_pushTimer); _pushTimer = null }
    const data: Persisted = {
      providerId:         providerId.value,
      modelId:            modelId.value,
      titleGenProviderId: titleGenProviderId.value,
      titleGenModelId:    titleGenModelId.value,
      titleGenPrompt:     titleGenPrompt.value,
    }
    await apiPut('/api/settings/privateAssistant', { value: data }).catch(() => {})
  }

  async function syncFromServer(allSettings: Record<string, unknown>) {
    const s = allSettings.privateAssistant as Partial<Persisted> | undefined
    if (!s) return
    if (s.providerId         !== undefined) providerId.value         = s.providerId
    if (s.modelId            !== undefined) modelId.value            = s.modelId
    if (s.titleGenProviderId !== undefined) titleGenProviderId.value = s.titleGenProviderId
    if (s.titleGenModelId    !== undefined) titleGenModelId.value    = s.titleGenModelId
    if (s.titleGenPrompt     !== undefined) titleGenPrompt.value     = s.titleGenPrompt
    localStorage.setItem(LS_KEY, JSON.stringify({
      providerId: providerId.value,
      modelId: modelId.value,
      titleGenProviderId: titleGenProviderId.value,
      titleGenModelId: titleGenModelId.value,
      titleGenPrompt: titleGenPrompt.value,
    } satisfies Persisted))
  }

  return {
    providerId,
    modelId,
    titleGenProviderId,
    titleGenModelId,
    titleGenPrompt,
    persist,
    pushToServer,
    syncFromServer,
  }
})
