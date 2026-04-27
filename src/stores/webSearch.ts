import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { encryptLocal, decryptLocal } from '../utils/crypto'
import { listWebSearchProviders } from '../services/webSearch'

const LS_KEY = 'muse-web-search-settings'

interface PersistedSettings {
  enabled?: boolean
  activeProviderId?: string
  providers?: Record<string, ProviderStore>
}

interface ProviderStore {
  apiKeyEnc?: string
  numResults?: number
  // Exa-specific
  exaSearchType?: 'auto' | 'fast' | 'deep'
}

function loadRaw(): PersistedSettings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

export const useWebSearchStore = defineStore('webSearch', () => {
  const saved = loadRaw()

  const enabled          = ref<boolean>(saved.enabled ?? false)
  const activeProviderId = ref<string>(saved.activeProviderId ?? 'exa')

  // Per-provider encrypted API keys and settings
  const providerApiKeyEnc = ref<Record<string, string>>(
    Object.fromEntries(
      Object.entries(saved.providers ?? {}).map(([k, v]) => [k, v.apiKeyEnc ?? '']),
    ),
  )
  const providerNumResults = ref<Record<string, number>>(
    Object.fromEntries(
      Object.entries(saved.providers ?? {}).map(([k, v]) => [k, v.numResults ?? 5]),
    ),
  )
  const exaSearchType = ref<'auto' | 'fast' | 'deep'>(
    (saved.providers?.exa?.exaSearchType) ?? 'auto',
  )

  // ─── Persist ──────────────────────────────────────────────────────────────
  function persist() {
    const providers: Record<string, ProviderStore> = {}
    for (const { id } of listWebSearchProviders()) {
      providers[id] = {
        apiKeyEnc:     providerApiKeyEnc.value[id] ?? '',
        numResults:    providerNumResults.value[id] ?? 5,
        ...(id === 'exa' ? { exaSearchType: exaSearchType.value } : {}),
      }
    }
    localStorage.setItem(LS_KEY, JSON.stringify({
      enabled:          enabled.value,
      activeProviderId: activeProviderId.value,
      providers,
    } satisfies PersistedSettings))
  }

  watch([enabled, activeProviderId, providerApiKeyEnc, providerNumResults, exaSearchType], persist, { deep: true })

  // ─── API key helpers ──────────────────────────────────────────────────────

  async function setApiKey(providerId: string, plaintext: string) {
    if (!plaintext) {
      providerApiKeyEnc.value = { ...providerApiKeyEnc.value, [providerId]: '' }
      return
    }
    const enc = await encryptLocal(plaintext)
    providerApiKeyEnc.value = { ...providerApiKeyEnc.value, [providerId]: enc }
  }

  async function getApiKey(providerId: string): Promise<string> {
    const enc = providerApiKeyEnc.value[providerId]
    if (!enc) return ''
    try { return await decryptLocal(enc) } catch { return '' }
  }

  function hasApiKey(providerId: string): boolean {
    return !!providerApiKeyEnc.value[providerId]
  }

  // ─── Per-provider search options ──────────────────────────────────────────

  function getNumResults(providerId: string): number {
    return providerNumResults.value[providerId] ?? 5
  }

  function setNumResults(providerId: string, n: number) {
    providerNumResults.value = { ...providerNumResults.value, [providerId]: n }
  }

  // Build the options object to pass to performSearch for the active provider
  function getSearchOptions(providerId: string): Record<string, unknown> {
    const base = { numResults: getNumResults(providerId) }
    if (providerId === 'exa') return { ...base, searchType: exaSearchType.value }
    return base
  }

  return {
    enabled,
    activeProviderId,
    exaSearchType,
    setApiKey,
    getApiKey,
    hasApiKey,
    getNumResults,
    setNumResults,
    getSearchOptions,
  }
})
