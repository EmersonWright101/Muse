import { defineStore } from 'pinia'
import { ref } from 'vue'

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

  function persist() {
    const data: Persisted = {
      providerId:         providerId.value,
      modelId:            modelId.value,
      titleGenProviderId: titleGenProviderId.value,
      titleGenModelId:    titleGenModelId.value,
      titleGenPrompt:     titleGenPrompt.value,
    }
    localStorage.setItem(LS_KEY, JSON.stringify(data))
  }

  return {
    providerId,
    modelId,
    titleGenProviderId,
    titleGenModelId,
    titleGenPrompt,
    persist,
  }
})
