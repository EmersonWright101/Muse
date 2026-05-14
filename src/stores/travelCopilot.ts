import { defineStore } from 'pinia'
import { ref } from 'vue'
import { resolveDataRoot, normalizePath } from '../utils/path'
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs'
import { apiPut } from '../services/api'

const LS_KEY             = 'muse-travel-copilot'
const LS_MODIFIED_AT_KEY = 'muse-travel-copilot-modified-at'

export interface CopilotDailyStat {
  inputTokens:  number
  outputTokens: number
  costUsd:      number
  requests:     number
}

async function getCopilotStatsPath(): Promise<string> {
  return `${await resolveDataRoot()}/travel-copilot-stats.json`
}

async function loadCopilotStats(): Promise<Record<string, CopilotDailyStat>> {
  try {
    const path = await getCopilotStatsPath()
    if (!(await exists(path))) return {}
    return JSON.parse(await readTextFile(path)) as Record<string, CopilotDailyStat>
  } catch { return {} }
}

async function saveCopilotStats(stats: Record<string, CopilotDailyStat>): Promise<void> {
  try {
    const path = await getCopilotStatsPath()
    const dir  = normalizePath(path).slice(0, normalizePath(path).lastIndexOf('/'))
    if (!(await exists(dir))) await mkdir(dir, { recursive: true })
    await writeTextFile(path, JSON.stringify(stats, null, 2))
  } catch { /* ignore */ }
}

export const useTravelCopilotStore = defineStore('travelCopilot', () => {
  const enabled         = ref(false)
  const providerId      = ref('')
  const modelId         = ref('')
  const completionWords = ref(10)
  const triggerDelay    = ref(600)
  const contextChars    = ref(2000)
  const copilotStats    = ref<Record<string, CopilotDailyStat>>({})

  function _loadFromStorage() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const s = JSON.parse(raw)
        enabled.value         = s.enabled         ?? false
        providerId.value      = s.providerId       ?? ''
        modelId.value         = s.modelId          ?? ''
        completionWords.value = s.completionWords  ?? 10
        triggerDelay.value    = s.triggerDelay     ?? 1000
        contextChars.value    = s.contextChars     ?? 2000
      }
    } catch { /* ignore */ }
  }

  _loadFromStorage()
  loadCopilotStats().then(s => { copilotStats.value = s }).catch(() => {})

  function save() {
    const payload = {
      enabled:         enabled.value,
      providerId:      providerId.value,
      modelId:         modelId.value,
      completionWords: completionWords.value,
      triggerDelay:    triggerDelay.value,
      contextChars:    contextChars.value,
      stats:           copilotStats.value,
    }
    localStorage.setItem(LS_KEY, JSON.stringify(payload))
    localStorage.setItem(LS_MODIFIED_AT_KEY, new Date().toISOString())
    apiPut('/api/settings/travelCopilot', { value: payload }).catch(() => {})
  }

  function setEnabled(v: boolean)  { enabled.value = v; save() }
  function setProvider(id: string) { providerId.value = id; save() }
  function setModel(id: string)    { modelId.value = id; save() }
  function setWords(n: number)     { completionWords.value = Math.max(1, Math.min(100, n)); save() }
  function setDelay(ms: number)    { triggerDelay.value = Math.max(200, Math.min(5000, ms)); save() }
  function setContext(n: number)   { contextChars.value = Math.max(200, Math.min(10000, n)); save() }

  function recordUsage(date: string, inputTokens: number, outputTokens: number, costUsd: number) {
    const s = copilotStats.value[date] ?? { inputTokens: 0, outputTokens: 0, costUsd: 0, requests: 0 }
    s.inputTokens  += inputTokens
    s.outputTokens += outputTokens
    s.costUsd      += costUsd
    s.requests     += 1
    copilotStats.value = { ...copilotStats.value, [date]: s }
    saveCopilotStats(copilotStats.value).catch(() => {})
    pushToServer().catch(() => {})
  }

  async function pushToServer() {
    await apiPut('/api/settings/travelCopilot', {
      value: {
        enabled: enabled.value,
        providerId: providerId.value,
        modelId: modelId.value,
        completionWords: completionWords.value,
        triggerDelay: triggerDelay.value,
        contextChars: contextChars.value,
        stats: copilotStats.value,
      },
    }).catch(() => {})
  }

  async function syncFromServer(allSettings: Record<string, unknown>) {
    const s = allSettings.travelCopilot as Record<string, unknown> | undefined
    if (!s) return
    if (s.enabled         !== undefined) enabled.value         = !!s.enabled
    if (s.providerId      !== undefined) providerId.value      = s.providerId as string
    if (s.modelId         !== undefined) modelId.value         = s.modelId as string
    if (s.completionWords !== undefined) completionWords.value = Number(s.completionWords) || 10
    if (s.triggerDelay    !== undefined) triggerDelay.value    = Number(s.triggerDelay) || 600
    if (s.contextChars    !== undefined) contextChars.value    = Number(s.contextChars) || 2000
    if (s.stats && typeof s.stats === 'object') {
      copilotStats.value = { ...copilotStats.value, ...(s.stats as Record<string, CopilotDailyStat>) }
      saveCopilotStats(copilotStats.value).catch(() => {})
    }
    localStorage.setItem(LS_KEY, JSON.stringify({
      enabled: enabled.value,
      providerId: providerId.value,
      modelId: modelId.value,
      completionWords: completionWords.value,
      triggerDelay: triggerDelay.value,
      contextChars: contextChars.value,
      stats: copilotStats.value,
    }))
  }

  /** Called after a remote sync to refresh reactive state from updated localStorage. */
  function reload() { _loadFromStorage() }

  return {
    enabled, providerId, modelId, completionWords, triggerDelay, contextChars, copilotStats,
    setEnabled, setProvider, setModel, setWords, setDelay, setContext, recordUsage, reload,
    pushToServer, syncFromServer,
  }
})
