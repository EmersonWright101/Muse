import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { apiPut } from '../services/api'

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

  function currentPayload() {
    return {
      titleGenProviderId: titleGenProviderId.value,
      titleGenModelId:    titleGenModelId.value,
      titleGenPrompt:     titleGenPrompt.value,
      temperature:        temperature.value,
      maxTokens:          maxTokens.value,
    }
  }

  let _serverPushTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleServerPush() {
    if (_serverPushTimer) clearTimeout(_serverPushTimer)
    _serverPushTimer = setTimeout(() => {
      apiPut('/api/settings/chat', { value: currentPayload() }).catch(() => {})
    }, 800)
  }

  watch(
    [titleGenProviderId, titleGenModelId, titleGenPrompt, temperature, maxTokens],
    () => {
      localStorage.setItem(LS_KEY, JSON.stringify(currentPayload()))
      localStorage.setItem(LS_MODIFIED_AT_KEY, new Date().toISOString())
      scheduleServerPush()
    },
  )

  async function pushToServer() {
    await apiPut('/api/settings/chat', { value: currentPayload() }).catch(() => {})
  }

  async function syncFromServer(allSettings: Record<string, unknown>) {
    const s = allSettings.chat as Record<string, unknown> | undefined
    if (!s) return
    if (s.titleGenProviderId !== undefined) titleGenProviderId.value = s.titleGenProviderId as string
    if (s.titleGenModelId    !== undefined) titleGenModelId.value    = s.titleGenModelId    as string
    if (s.titleGenPrompt     !== undefined) titleGenPrompt.value     = s.titleGenPrompt     as string
    if (s.temperature        !== undefined) temperature.value        = Number(s.temperature)
    if (s.maxTokens          !== undefined) maxTokens.value          = Number(s.maxTokens)
    // Persist the pulled values to localStorage so they survive the session
    localStorage.setItem(LS_KEY, JSON.stringify(currentPayload()))
  }

  return { titleGenProviderId, titleGenModelId, titleGenPrompt, temperature, maxTokens, pushToServer, syncFromServer }
})

