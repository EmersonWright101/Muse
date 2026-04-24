import { defineStore } from 'pinia'
import { ref } from 'vue'

const LS_KEY             = 'muse-travel-copilot'
const LS_MODIFIED_AT_KEY = 'muse-travel-copilot-modified-at'

export const useTravelCopilotStore = defineStore('travelCopilot', () => {
  const enabled         = ref(false)
  const providerId      = ref('')
  const modelId         = ref('')
  const completionWords = ref(10)
  const triggerDelay    = ref(1000)
  const contextChars    = ref(2000)

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

  function save() {
    localStorage.setItem(LS_KEY, JSON.stringify({
      enabled:         enabled.value,
      providerId:      providerId.value,
      modelId:         modelId.value,
      completionWords: completionWords.value,
      triggerDelay:    triggerDelay.value,
      contextChars:    contextChars.value,
    }))
    localStorage.setItem(LS_MODIFIED_AT_KEY, new Date().toISOString())
  }

  function setEnabled(v: boolean)  { enabled.value = v; save() }
  function setProvider(id: string) { providerId.value = id; save() }
  function setModel(id: string)    { modelId.value = id; save() }
  function setWords(n: number)     { completionWords.value = Math.max(1, Math.min(100, n)); save() }
  function setDelay(ms: number)    { triggerDelay.value = Math.max(200, Math.min(5000, ms)); save() }
  function setContext(n: number)   { contextChars.value = Math.max(200, Math.min(10000, n)); save() }

  /** Called after a remote sync to refresh reactive state from updated localStorage. */
  function reload() { _loadFromStorage() }

  return {
    enabled, providerId, modelId, completionWords, triggerDelay, contextChars,
    setEnabled, setProvider, setModel, setWords, setDelay, setContext, reload,
  }
})

// ─── Sync module ─────────────────────────────────────────────────────────────

import { syncService } from '../services/sync'
import type { SyncModule } from '../services/sync/types'

const travelCopilotSyncModule: SyncModule = {
  id:         'travelCopilot',
  remoteDirs: ['settings'],
  getLocalTimestamp() {
    return localStorage.getItem(LS_MODIFIED_AT_KEY) ?? new Date(0).toISOString()
  },
  async sync(ctx, localChanged) {
    ctx.setProgress('同步 Copilot 设置…')
    const path      = ctx.rp('settings/travel_copilot.enc')
    const raw       = localStorage.getItem(LS_KEY)
    const localData = raw ? JSON.parse(raw) : {}

    const remoteData = await ctx.getEncrypted<Record<string, unknown> | null>(path, null)

    if (!remoteData) {
      if (localChanged && Object.keys(localData).length > 0) {
        await ctx.putEncrypted(path, { ...localData, __syncTs: new Date().toISOString() })
      }
      return
    }

    const localTs  = await this.getLocalTimestamp()
    const remoteTs = (remoteData as Record<string, unknown> & { __syncTs?: string }).__syncTs
      ?? new Date(0).toISOString()

    if (remoteTs > localTs) {
      // Remote is newer — overwrite local (strip __syncTs metadata)
      const { __syncTs: _, ...data } = remoteData as Record<string, unknown> & { __syncTs?: string }
      localStorage.setItem(LS_KEY, JSON.stringify(data))
      // Note: reactive state refreshed via onSynced below
    }

    if (!localChanged) return
    await ctx.putEncrypted(path, { ...localData, __syncTs: new Date().toISOString() })
  },
  async onSynced() {
    useTravelCopilotStore().reload()
  },
}

syncService.register(travelCopilotSyncModule)
