/**
 * AI Provider Settings Store
 *
 * Stores API keys encrypted with the device key so they are never persisted
 * as plaintext. The store exposes decrypted keys at runtime (in memory only).
 * Supports dynamic add/remove of providers in addition to the four built-ins.
 */

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { encryptLocal, decryptLocal } from '../utils/crypto'
import { resolveDataRoot } from '../utils/path'
import { writeTextFile, rename } from '@tauri-apps/plugin-fs'

const LS_KEY             = 'muse-ai-settings'
const LS_DELETED_KEY     = 'muse-deleted-providers'
export const LS_MODIFIED_AT_KEY = 'muse-ai-settings-modified-at'
export const DEBOUNCE_MS = 300

async function tombstonesPath(): Promise<string> {
  return `${await resolveDataRoot()}/provider-tombstones.json`
}

async function saveProviderTombstones(map: Record<string, string>): Promise<void> {
  try {
    const path = await tombstonesPath()
    const tmp = `${path}.tmp`
    await writeTextFile(tmp, JSON.stringify(map, null, 2))
    await rename(tmp, path)
  } catch { /* ignore */ }
}

// Tombstone helpers — record provider deletions for cross-device sync
export function getDeletedProviders(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_DELETED_KEY) ?? '{}') } catch { return {} }
}
function recordProviderDeletion(id: string) {
  const map = getDeletedProviders()
  map[id] = new Date().toISOString()
  localStorage.setItem(LS_DELETED_KEY, JSON.stringify(map))
  saveProviderTombstones(map)
}
export function applyRemoteDeletedProviders(remote: Record<string, string>) {
  const local = getDeletedProviders()
  let changed = false
  for (const [id, ts] of Object.entries(remote)) {
    if (!local[id] || ts > local[id]) { local[id] = ts; changed = true }
  }
  if (changed) {
    localStorage.setItem(LS_DELETED_KEY, JSON.stringify(local))
    saveProviderTombstones(local)
  }
}

export interface AIModel {
  id:            string;
  name:          string;
  contextLength?: number;
  multimodal?:   boolean;  // supports image/video INPUT
  reasoning?:    boolean;  // is a reasoning/thinking model
  imageOutput?:  boolean;  // generates images as output
  audio?:        boolean;  // supports audio input
  video?:        boolean;  // supports video input
  inputPrice?:   number;   // per 1M input tokens (in priceCurrency)
  outputPrice?:  number;   // per 1M output tokens (in priceCurrency)
  priceCurrency?: 'usd' | 'cny';
}

/** Infer model capabilities from model ID and optional OpenRouter modality string. */
const EXCHANGE_RATE_CNY_TO_USD = 7.2

export function calculateModelCost(
  providers: AIProvider[],
  providerId: string,
  modelId: string,
  inputTokens?: number,
  outputTokens?: number,
): number | undefined {
  const provider = providers.find(p => p.id === providerId)
  const model = provider?.models.find(m => m.id === modelId)
  if (!model) return undefined
  if (model.inputPrice == null && model.outputPrice == null) return undefined
  const rate = model.priceCurrency === 'cny' ? EXCHANGE_RATE_CNY_TO_USD : 1
  const inputCost = ((inputTokens ?? 0) / 1_000_000) * (model.inputPrice ?? 0) / rate
  const outputCost = ((outputTokens ?? 0) / 1_000_000) * (model.outputPrice ?? 0) / rate
  return inputCost + outputCost
}

export function inferModelCaps(modelId: string, openRouterModality?: string): Partial<Pick<AIModel, 'multimodal' | 'reasoning' | 'imageOutput' | 'audio' | 'video'>> {
  const id = modelId.toLowerCase()
  const reasoning = /\bo[1-9](-|$)|\bo4|deepseek-r[0-9]|qwq|thinking|reflect|reasoner/.test(id)
  if (openRouterModality) {
    return {
      multimodal:  openRouterModality.includes('image') && openRouterModality.includes('->text'),
      imageOutput: openRouterModality.includes('->image'),
      reasoning,
      video:       openRouterModality.includes('->video') || openRouterModality.includes('video'),
    }
  }
  const imageOutput = /dall-e|imagen|gpt-image|gpt-5-image|flux|stable-diff|sd-|midj/.test(id)
  const multimodal  = !imageOutput && /vision|gpt-4o|claude-3|gemini|llava|pixtral|qwen-vl|intern-vl|phi.*vision|cogvlm|minicpm-v/.test(id)
  const audio       = /whisper|tts|audio|speech/.test(id)
  const video       = /video|sora/.test(id)
  return { multimodal, imageOutput, reasoning, audio, video }
}

export interface AIProvider {
  id:              string;
  type:            'openai' | 'anthropic' | 'google' | 'custom' | 'ollama';
  name:            string;
  apiKey:          string;   // plaintext in memory only; stored encrypted
  baseUrl:         string;
  models:          AIModel[];
  enabled:         boolean;
  selectedModelId: string;
  builtIn?:        boolean;  // true for the four default providers
  updatedAt?:      string;   // ISO timestamp, updated on every user-facing change
}

// ─── Built-in model lists ─────────────────────────────────────────────────────

const OPENAI_MODELS: AIModel[] = [
  { id: 'gpt-4o',          name: 'GPT-4o',        contextLength: 128_000, multimodal: true },
  { id: 'gpt-4o-mini',     name: 'GPT-4o Mini',   contextLength: 128_000, multimodal: true },
  { id: 'gpt-4-turbo',     name: 'GPT-4 Turbo',   contextLength: 128_000, multimodal: true },
  { id: 'gpt-4',           name: 'GPT-4',          contextLength:   8_192 },
  { id: 'gpt-3.5-turbo',   name: 'GPT-3.5 Turbo', contextLength:  16_385 },
  { id: 'o1',              name: 'o1',             contextLength: 200_000, reasoning: true },
  { id: 'o1-mini',         name: 'o1 Mini',        contextLength: 128_000, reasoning: true },
  { id: 'o3-mini',         name: 'o3 Mini',        contextLength: 200_000, reasoning: true },
  { id: 'o3',              name: 'o3',             contextLength: 200_000, reasoning: true },
  { id: 'o4-mini',         name: 'o4 Mini',        contextLength: 200_000, reasoning: true, multimodal: true },
]

const ANTHROPIC_MODELS: AIModel[] = [
  { id: 'claude-opus-4-5',              name: 'Claude Opus 4.5',     contextLength: 200_000, multimodal: true },
  { id: 'claude-sonnet-4-5',            name: 'Claude Sonnet 4.5',   contextLength: 200_000, multimodal: true },
  { id: 'claude-haiku-4-5',             name: 'Claude Haiku 4.5',    contextLength: 200_000, multimodal: true },
  { id: 'claude-3-5-sonnet-20241022',   name: 'Claude 3.5 Sonnet',   contextLength: 200_000, multimodal: true },
  { id: 'claude-3-5-haiku-20241022',    name: 'Claude 3.5 Haiku',    contextLength: 200_000, multimodal: true },
  { id: 'claude-3-opus-20240229',       name: 'Claude 3 Opus',       contextLength: 200_000, multimodal: true },
]

const GOOGLE_MODELS: AIModel[] = [
  { id: 'gemini-2.0-flash',      name: 'Gemini 2.0 Flash',      contextLength: 1_000_000, multimodal: true },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', contextLength: 1_000_000, multimodal: true },
  { id: 'gemini-1.5-pro',        name: 'Gemini 1.5 Pro',        contextLength: 2_000_000, multimodal: true },
  { id: 'gemini-1.5-flash',      name: 'Gemini 1.5 Flash',      contextLength: 1_000_000, multimodal: true },
]

const DEEPSEEK_MODELS: AIModel[] = [
  { id: 'deepseek-chat',     name: 'DeepSeek V3',        contextLength: 64_000,  inputPrice: 1,  outputPrice: 2,  priceCurrency: 'cny' },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1',        contextLength: 64_000,  reasoning: true, inputPrice: 4, outputPrice: 16, priceCurrency: 'cny' },
]


const DEFAULT_PROVIDERS: AIProvider[] = [
  { id: 'openai',    type: 'openai',    name: 'OpenAI',              apiKey: '', baseUrl: 'https://api.openai.com/v1',                       models: OPENAI_MODELS,    enabled: true,  selectedModelId: 'gpt-4o',              builtIn: true },
  { id: 'anthropic', type: 'anthropic', name: 'Anthropic',           apiKey: '', baseUrl: 'https://api.anthropic.com',                        models: ANTHROPIC_MODELS, enabled: true,  selectedModelId: 'claude-sonnet-4-5',   builtIn: true },
  { id: 'google',    type: 'google',    name: 'Google Gemini',       apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: GOOGLE_MODELS,    enabled: true,  selectedModelId: 'gemini-2.0-flash',    builtIn: true },
  { id: 'deepseek',  type: 'custom',    name: 'DeepSeek',            apiKey: '', baseUrl: 'https://api.deepseek.com',                         models: DEEPSEEK_MODELS,  enabled: true,  selectedModelId: 'deepseek-chat',       builtIn: true },
  { id: 'custom',    type: 'custom',    name: '自定义 (OpenAI 兼容)', apiKey: '', baseUrl: '',                                                  models: [{ id: 'custom-model', name: '自定义模型' }], enabled: false, selectedModelId: 'custom-model', builtIn: true },
]

// ─── Persistence ──────────────────────────────────────────────────────────────

interface PersistedProvider {
  id:              string;
  type:            AIProvider['type'];
  name:            string;
  builtIn?:        boolean;
  apiKeyEnc:       string;
  baseUrl:         string;
  enabled:         boolean;
  selectedModelId: string;
  customModels?:   AIModel[];  // kept for backward compatibility
  updatedAt?:      string;
}

interface PersistedSettings {
  activeProviderId: string;
  providers:        PersistedProvider[];
}

async function saveToStorage(
  activeId: string,
  providers: AIProvider[],
): Promise<void> {
  try {
    const persisted: PersistedProvider[] = []
    for (const p of providers) {
      let apiKeyEnc = ''
      if (p.apiKey) {
        try { apiKeyEnc = await encryptLocal(p.apiKey) } catch { /* skip */ }
      }
      persisted.push({
        id:              p.id,
        type:            p.type,
        name:            p.name,
        builtIn:         p.builtIn,
        apiKeyEnc,
        baseUrl:         p.baseUrl,
        enabled:         p.enabled,
        selectedModelId: p.selectedModelId,
        customModels:    p.models,
        updatedAt:       p.updatedAt,
      })
    }
    localStorage.setItem(LS_KEY, JSON.stringify({
      activeProviderId: activeId,
      providers:        persisted,
    } satisfies PersistedSettings))
    localStorage.setItem(LS_MODIFIED_AT_KEY, new Date().toISOString())
  } catch (e) {
    console.error('Failed to save AI settings:', e)
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAiSettingsStore = defineStore('aiSettings', () => {
  const providers        = ref<AIProvider[]>(DEFAULT_PROVIDERS.map(p => ({ ...p, models: [...p.models] })))
  const activeProviderId = ref<string>(providers.value[0]?.id ?? 'openai')

  function activeProvider(): AIProvider | undefined {
    return providers.value.find(p => p.id === activeProviderId.value)
  }

  function activeModelId(): string {
    return activeProvider()?.selectedModelId ?? ''
  }

  function configuredProviders(): AIProvider[] {
    return providers.value.filter(p => p.enabled && p.apiKey)
  }

  function setActiveProvider(id: string) {
    activeProviderId.value = id
  }

  function setModelForProvider(providerId: string, modelId: string) {
    const p = providers.value.find(p => p.id === providerId)
    if (p) p.selectedModelId = modelId
  }

  function updateProvider(id: string, patch: Partial<Pick<AIProvider, 'apiKey' | 'baseUrl' | 'enabled' | 'name' | 'type'>>) {
    const p = providers.value.find(p => p.id === id)
    if (p) Object.assign(p, patch, { updatedAt: new Date().toISOString() })
    persist()
  }

  /** Upsert a provider from a remote sync payload — creates it if not present locally. */
  function importProvider(rp: {
    id: string; name?: string; type?: AIProvider['type']; builtIn?: boolean;
    apiKey?: string; baseUrl?: string; enabled?: boolean;
    selectedModelId?: string; customModels?: AIModel[]; updatedAt?: string;
  }) {
    const p = providers.value.find(p => p.id === rp.id)
    if (p) {
      if (rp.apiKey          !== undefined) p.apiKey          = rp.apiKey
      if (rp.baseUrl         !== undefined) p.baseUrl         = rp.baseUrl
      if (rp.enabled         !== undefined) p.enabled         = rp.enabled
      if (rp.name            !== undefined) p.name            = rp.name
      if (rp.selectedModelId)               p.selectedModelId = rp.selectedModelId
      if (rp.customModels?.length)          p.models          = rp.customModels
      if (rp.updatedAt)                     p.updatedAt       = rp.updatedAt
    } else if (rp.id && rp.name) {
      providers.value.push({
        id:              rp.id,
        type:            rp.type            ?? 'custom',
        name:            rp.name,
        apiKey:          rp.apiKey          ?? '',
        baseUrl:         rp.baseUrl         ?? '',
        models:          rp.customModels?.length ? rp.customModels : [{ id: 'default', name: '默认模型' }],
        enabled:         rp.enabled         ?? true,
        selectedModelId: rp.selectedModelId ?? 'default',
        builtIn:         false,
        updatedAt:       rp.updatedAt,
      })
    }
    persist()
  }

  function addCustomModel(providerId: string, model: AIModel) {
    const p = providers.value.find(p => p.id === providerId)
    if (p && !p.models.find(m => m.id === model.id)) {
      const inferred = inferModelCaps(model.id)
      p.models.push({ ...inferred, ...model })
    }
    persist()
  }

  function removeCustomModel(providerId: string, modelId: string) {
    const p = providers.value.find(p => p.id === providerId)
    if (p) p.models = p.models.filter(m => m.id !== modelId)
    persist()
  }

  // ─── Dynamic provider management ───────────────────────────────────────────

  function addProvider(name: string, baseUrl: string): AIProvider {
    const id = `provider_${Date.now()}`
    const newP: AIProvider = {
      id,
      type:            'custom',
      name:            name.trim(),
      apiKey:          '',
      baseUrl:         baseUrl.trim(),
      models:          [{ id: 'default', name: '默认模型' }],
      enabled:         true,
      selectedModelId: 'default',
      builtIn:         false,
      updatedAt:       new Date().toISOString(),
    }
    providers.value.push(newP)
    persist()
    return newP
  }

  function removeProvider(id: string) {
    const idx = providers.value.findIndex(p => p.id === id)
    if (idx === -1) return
    providers.value.splice(idx, 1)
    if (activeProviderId.value === id) {
      activeProviderId.value = providers.value[0]?.id ?? ''
    }
    recordProviderDeletion(id)
    persist()
  }

  // ─── Persistence helpers ────────────────────────────────────────────────────

  let _persistTimer: ReturnType<typeof setTimeout> | null = null
  let _initDone = false
  let _pendingPersist = false

  function persist() {
    if (!_initDone) { _pendingPersist = true; return }
    if (_persistTimer) clearTimeout(_persistTimer)
    _persistTimer = setTimeout(() => saveToStorage(activeProviderId.value, providers.value), DEBOUNCE_MS)
  }

  function flush(): Promise<void> {
    if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null }
    return saveToStorage(activeProviderId.value, providers.value)
  }

  // Load persisted settings on init
  ;(async () => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const saved: PersistedSettings = JSON.parse(raw)

      // Track which provider IDs have been handled
      for (const sp of saved.providers) {
        const p = providers.value.find(p => p.id === sp.id)

        if (!p) {
          // Dynamically added provider — reconstruct it
          if (!sp.name) continue
          const newP: AIProvider = {
            id:              sp.id,
            type:            sp.type ?? 'custom',
            name:            sp.name,
            apiKey:          '',
            baseUrl:         sp.baseUrl,
            models:          sp.customModels?.length ? sp.customModels : [{ id: 'default', name: '默认模型' }],
            enabled:         sp.enabled,
            selectedModelId: sp.selectedModelId,
            builtIn:         false,
            updatedAt:       sp.updatedAt,
          }
          if (sp.apiKeyEnc) {
            try { newP.apiKey = await decryptLocal(sp.apiKeyEnc) } catch { /* skip */ }
          }
          providers.value.push(newP)
          continue
        }

        // Built-in provider — merge saved values
        p.baseUrl         = sp.baseUrl || p.baseUrl
        p.enabled         = sp.enabled
        p.selectedModelId = sp.selectedModelId || p.selectedModelId
        p.updatedAt       = sp.updatedAt
        if (sp.customModels?.length) {
          if (p.type === 'custom') {
            p.models = sp.customModels
          } else {
            // Merge saved prices into hardcoded defaults
            const savedMap = new Map(sp.customModels.map(m => [m.id, m]))
            p.models = p.models.map(m => {
              const saved = savedMap.get(m.id)
              if (!saved) return m
              return { ...m, inputPrice: saved.inputPrice, outputPrice: saved.outputPrice }
            })
          }
        }
        if (sp.apiKeyEnc) {
          try { p.apiKey = await decryptLocal(sp.apiKeyEnc) } catch { /* skip */ }
        }
      }

      // Remove built-in providers that were explicitly deleted by the user
      // (they were in the defaults list but absent from saved.providers)
      const savedIds = new Set(saved.providers.map(sp => sp.id))
      for (let i = providers.value.length - 1; i >= 0; i--) {
        if (providers.value[i].builtIn && !savedIds.has(providers.value[i].id)) {
          providers.value.splice(i, 1)
        }
      }

      if (saved.activeProviderId) activeProviderId.value = saved.activeProviderId
    } catch { /* ignore */ }
    _initDone = true
    if (_pendingPersist) persist()
  })()

  // Watch for changes and auto-persist
  watch(providers, persist, { deep: true })
  watch(activeProviderId, persist)

  return {
    providers,
    activeProviderId,
    activeProvider,
    activeModelId,
    configuredProviders,
    setActiveProvider,
    setModelForProvider,
    updateProvider,
    importProvider,
    addCustomModel,
    removeCustomModel,
    addProvider,
    removeProvider,
    persist,
    flush,
  }
})

// ─── Sync module ─────────────────────────────────────────────────────────────

import { syncService } from '../services/sync'
import type { SyncModule } from '../services/sync/types'

const MOD_AI = 'aiSettings'

const aiSyncModule: SyncModule = {
  id: MOD_AI,
  remoteDirs: ['settings'],
  getLocalTimestamp() {
    return localStorage.getItem(LS_MODIFIED_AT_KEY) ?? new Date(0).toISOString()
  },
  async sync(ctx, localChanged) {
    ctx.setProgress('同步 AI 设置…')
    const aiStore = useAiSettingsStore()

    function toRemote(p: AIProvider) {
      return {
        id: p.id, name: p.name, type: p.type, builtIn: p.builtIn,
        apiKey: p.apiKey, baseUrl: p.baseUrl, enabled: p.enabled,
        selectedModelId: p.selectedModelId,
        customModels: p.type === 'custom' ? p.models : undefined,
        updatedAt: p.updatedAt ?? new Date(0).toISOString(),
      }
    }

    const localDeleted = getDeletedProviders()
    const localData = {
      timestamp: await this.getLocalTimestamp(),
      providers: aiStore.providers.map(toRemote),
      activeProviderId: aiStore.activeProviderId,
      deletedProviders: localDeleted,
    }

    const path = ctx.rp('settings/ai_settings.enc')
    const remoteData = await ctx.getEncrypted<typeof localData | null>(path, null)

    if (!remoteData) {
      if (localChanged) await ctx.putEncrypted(path, localData)
      return
    }

    const remoteDeleted: Record<string, string> = remoteData.deletedProviders ?? {}
    applyRemoteDeletedProviders(remoteDeleted)
    const mergedDeleted = getDeletedProviders()

    function isDeleted(p: ReturnType<typeof toRemote>): boolean {
      const ts = mergedDeleted[p.id]
      return !!ts && ts > (p.updatedAt ?? new Date(0).toISOString())
    }

    const remoteMap = new Map<string, ReturnType<typeof toRemote>>(
      (remoteData.providers ?? []).filter((p: ReturnType<typeof toRemote>) => !isDeleted(p)).map((p: ReturnType<typeof toRemote>) => [p.id, p]),
    )
    const localMap = new Map<string, ReturnType<typeof toRemote>>(localData.providers.map(p => [p.id, p]))

    for (const [id, rp_] of remoteMap) {
      const lp = localMap.get(id)
      if (!lp || (rp_.updatedAt ?? '') > (lp.updatedAt ?? '')) aiStore.importProvider(rp_)
    }

    for (const [id, ts] of Object.entries(mergedDeleted)) {
      const p = aiStore.providers.find(p => p.id === id)
      if (p && ts > (p.updatedAt ?? new Date(0).toISOString())) aiStore.removeProvider(id)
    }

    if ((remoteData.timestamp ?? '') > localData.timestamp && remoteData.activeProviderId) {
      aiStore.setActiveProvider(remoteData.activeProviderId)
    }

    if (!localChanged) return

    const mergedProviders = aiStore.providers.map(toRemote)
    for (const [id, rp_] of remoteMap) {
      if (!localMap.has(id) && !mergedProviders.find(p => p.id === id)) {
        mergedProviders.push(rp_)
      }
    }

    await ctx.putEncrypted(path, {
      timestamp: new Date().toISOString(),
      providers: mergedProviders,
      activeProviderId: aiStore.activeProviderId,
      deletedProviders: mergedDeleted,
    })
  },
}

syncService.register(aiSyncModule)
