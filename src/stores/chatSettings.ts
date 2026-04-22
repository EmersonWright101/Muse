import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const LS_KEY = 'muse-chat-settings'
export const LS_MODIFIED_AT_KEY = 'muse-chat-settings-modified-at'

export const DEFAULT_TITLE_PROMPT =
  '请用一句话（不超过15字）概括以下对话的主题，只输出标题本身，不加引号或标点：\n用户：{user}\nAI：{response}'

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

export const useChatSettingsStore = defineStore('chatSettings', () => {
  const saved = load()

  const titleGenProviderId = ref<string>(saved.titleGenProviderId ?? '')
  const titleGenModelId    = ref<string>(saved.titleGenModelId    ?? '')
  const titleGenPrompt     = ref<string>(saved.titleGenPrompt     ?? DEFAULT_TITLE_PROMPT)

  const temperature = ref<number>(saved.temperature !== undefined ? Number(saved.temperature) : 1.0)
  const maxTokens   = ref<number>(saved.maxTokens   !== undefined ? Number(saved.maxTokens)   : 8192)

  watch(
    [titleGenProviderId, titleGenModelId, titleGenPrompt, temperature, maxTokens],
    () => {
      const payload = {
        titleGenProviderId: titleGenProviderId.value,
        titleGenModelId:    titleGenModelId.value,
        titleGenPrompt:     titleGenPrompt.value,
        temperature:        temperature.value,
        maxTokens:          maxTokens.value,
      }
      localStorage.setItem(LS_KEY, JSON.stringify(payload))
      localStorage.setItem(LS_MODIFIED_AT_KEY, new Date().toISOString())
    },
  )

  return { titleGenProviderId, titleGenModelId, titleGenPrompt, temperature, maxTokens }
})
