import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { encryptLocal, decryptLocal } from '../utils/crypto'
import { listWebSearchProviders } from '../services/webSearch'

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
  }
})

// ─── Sync module ─────────────────────────────────────────────────────────────

import { syncService } from '../services/sync'
import type { SyncModule } from '../services/sync/types'

interface RemoteProviderStore {
  apiKey?: string      // plaintext — safe inside sync-encrypted container
  apiKeyEnc?: string   // legacy: device-local encrypted key from old sync format
  numResults?: number
  exaSearchType?: 'auto' | 'fast' | 'deep'
}

interface RemoteWebSearchSettings {
  __syncTs?: string
  enabled?: boolean
  activeProviderId?: string
  providers?: Record<string, RemoteProviderStore>
}

const MOD_WEB_SEARCH = 'webSearch'

const webSearchSyncModule: SyncModule = {
  id: MOD_WEB_SEARCH,
  remoteDirs: ['settings'],
  getLocalTimestamp() {
    return localStorage.getItem(LS_MODIFIED_AT_KEY) ?? new Date(0).toISOString()
  },
  async sync(ctx, localChanged) {
    ctx.setProgress('同步联网搜索设置…')
    const store = useWebSearchStore()
    const path  = ctx.rp('settings/web_search_settings.enc')

    // Build remote payload with plaintext API keys (safe inside sync-encrypted container)
    async function buildRemotePayload(ts: string): Promise<RemoteWebSearchSettings> {
      const providers: Record<string, RemoteProviderStore> = {}
      for (const { id } of listWebSearchProviders()) {
        providers[id] = {
          apiKey:     await store.getApiKey(id),
          numResults: store.getNumResults(id),
          ...(id === 'exa' ? { exaSearchType: store.exaSearchType } : {}),
        }
      }
      return {
        __syncTs:         ts,
        enabled:          store.enabled,
        activeProviderId: store.activeProviderId,
        providers,
      }
    }

    const remoteData = await ctx.getEncrypted<RemoteWebSearchSettings | null>(path, null)

    if (!remoteData) {
      if (localChanged) await ctx.putEncrypted(path, await buildRemotePayload(new Date().toISOString()))
      return
    }

    const localTs  = this.getLocalTimestamp() as string
    const remoteTs = remoteData.__syncTs ?? new Date(0).toISOString()

    // Apply remote settings to localStorage when remote is newer, then refresh in-memory state via onSynced
    if (remoteTs > localTs) {
      const providers: Record<string, ProviderStore> = {}
      for (const { id } of listWebSearchProviders()) {
        const rp = remoteData.providers?.[id]
        providers[id] = {
          // Prefer plaintext apiKey (new format); fall back to legacy apiKeyEnc
          apiKeyEnc: rp?.apiKey
            ? await encryptLocal(rp.apiKey)
            : (rp?.apiKeyEnc ?? ''),
          numResults: rp?.numResults ?? 5,
          ...(id === 'exa' ? { exaSearchType: rp?.exaSearchType ?? 'auto' } : {}),
        }
      }
      localStorage.setItem(LS_KEY, JSON.stringify({
        enabled:          remoteData.enabled ?? false,
        activeProviderId: remoteData.activeProviderId ?? 'exa',
        providers,
      } satisfies PersistedSettings))
      localStorage.setItem(LS_MODIFIED_AT_KEY, remoteTs)
    }

    if (!localChanged && remoteTs <= localTs) return
    await ctx.putEncrypted(path, await buildRemotePayload(new Date().toISOString()))
  },
}

syncService.register({
  ...webSearchSyncModule,
  async onSynced() {
    useWebSearchStore().reload()
  },
})
