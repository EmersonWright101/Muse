import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { encryptLocal, decryptLocal, encryptForServer, decryptFromServer } from '../utils/crypto'
import { listWebSearchProviders } from '../services/webSearch'
import { apiPut, getServerApiKey } from '../services/api'

const LS_KEY       = 'muse-web-search-settings'
const LS_USAGE_KEY = 'muse-web-search-usage'
export const LS_MODIFIED_AT_KEY = 'muse-web-search-settings-modified-at'

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

interface MonthlyUsage {
  month: string  // YYYY-MM
  counts: Record<string, number>
}

function loadUsage(): MonthlyUsage {
  try {
    const raw = localStorage.getItem(LS_USAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { month: '', counts: {} }
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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

  // ─── Monthly usage counter ────────────────────────────────────────────────
  const _usage = loadUsage()
  const _thisMonth = currentMonth()
  // Reset if it's a new month
  if (_usage.month !== _thisMonth) {
    _usage.month = _thisMonth
    _usage.counts = {}
  }
  const monthlyUsage = ref<Record<string, number>>({ ..._usage.counts })

  function incrementUsage(providerId: string) {
    monthlyUsage.value = {
      ...monthlyUsage.value,
      [providerId]: (monthlyUsage.value[providerId] ?? 0) + 1,
    }
    localStorage.setItem(LS_USAGE_KEY, JSON.stringify({ month: _thisMonth, counts: monthlyUsage.value }))
  }

  function getMonthlyUsage(providerId: string): number {
    return monthlyUsage.value[providerId] ?? 0
  }

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
    localStorage.setItem(LS_MODIFIED_AT_KEY, new Date().toISOString())
  }

  watch([enabled, activeProviderId, providerApiKeyEnc, providerNumResults, exaSearchType], () => {
    persist()
    scheduleServerPush()
  }, { deep: true })

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

  function reload() {
    const raw = loadRaw()
    enabled.value = raw.enabled ?? false
    activeProviderId.value = raw.activeProviderId ?? 'exa'
    providerApiKeyEnc.value = Object.fromEntries(
      Object.entries(raw.providers ?? {}).map(([k, v]) => [k, v.apiKeyEnc ?? '']),
    )
    providerNumResults.value = Object.fromEntries(
      Object.entries(raw.providers ?? {}).map(([k, v]) => [k, v.numResults ?? 5]),
    )
    exaSearchType.value = raw.providers?.exa?.exaSearchType ?? 'auto'
  }

  // ─── Server sync ─────────────────────────────────────────────────────────

  let _serverPushTimer: ReturnType<typeof setTimeout> | null = null

  async function _buildServerPayload(): Promise<PersistedSettings> {
    const srvKey = getServerApiKey()
    const providers: Record<string, ProviderStore> = {}
    for (const { id } of listWebSearchProviders()) {
      const plain = await getApiKey(id)
      const apiKeyEnc = plain && srvKey
        ? await encryptForServer(plain, srvKey).catch(() => '')
        : ''
      providers[id] = {
        apiKeyEnc,
        numResults: providerNumResults.value[id] ?? 5,
        ...(id === 'exa' ? { exaSearchType: exaSearchType.value } : {}),
      }
    }
    return { enabled: enabled.value, activeProviderId: activeProviderId.value, providers }
  }

  function scheduleServerPush() {
    if (_serverPushTimer) clearTimeout(_serverPushTimer)
    _serverPushTimer = setTimeout(async () => {
      const payload = await _buildServerPayload().catch(() => null)
      if (payload) apiPut('/api/settings/webSearch', { value: payload }).catch(() => {})
    }, 800)
  }

  async function pushToServer() {
    const payload = await _buildServerPayload().catch(() => null)
    if (payload) await apiPut('/api/settings/webSearch', { value: payload }).catch(() => {})
  }

  async function syncFromServer(allSettings: Record<string, unknown>) {
    const s = allSettings.webSearch as PersistedSettings | undefined
    if (!s) return
    const srvKey = getServerApiKey()
    if (s.enabled !== undefined) enabled.value = s.enabled
    if (s.activeProviderId) activeProviderId.value = s.activeProviderId
    for (const [id, pv] of Object.entries(s.providers ?? {})) {
      if (pv.apiKeyEnc && srvKey) {
        try {
          const plain = await decryptFromServer(pv.apiKeyEnc, srvKey)
          await setApiKey(id, plain)
        } catch { /* skip */ }
      }
      if (pv.numResults !== undefined) {
        providerNumResults.value = { ...providerNumResults.value, [id]: pv.numResults }
      }
      if (id === 'exa' && pv.exaSearchType) exaSearchType.value = pv.exaSearchType
    }
    persist()
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
    monthlyUsage,
    incrementUsage,
    getMonthlyUsage,
    reload,
    pushToServer,
    syncFromServer,
  }
})

