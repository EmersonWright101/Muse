/**
 * AI Provider Settings Store
 *
 * Stores API keys encrypted with the device key so they are never persisted
 * as plaintext. The store exposes decrypted keys at runtime (in memory only).
 * Supports dynamic add/remove of providers in addition to the four built-ins.
 */

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { encryptLocal, decryptLocal, encryptForServer, decryptFromServer } from '../utils/crypto'
import { resolveDataRoot } from '../utils/path'
import { writeTextFile, rename } from '@tauri-apps/plugin-fs'
import { apiPut, getServerApiKey } from '../services/api'

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
  id:              string;
  name:            string;
  contextLength?:  number;
  multimodal?:     boolean;  // supports image/video INPUT
  reasoning?:      boolean;  // is a reasoning/thinking model
  imageOutput?:    boolean;  // generates images as output
  audio?:          boolean;  // supports audio output (TTS)
  defaultVoice?:   string;   // default voice id for TTS models
  video?:          boolean;  // supports video input
  inputPrice?:     number;   // per 1M input tokens (in priceCurrency)
  outputPrice?:    number;   // per 1M output tokens (in priceCurrency)
  pricePerRequest?: number;  // fixed cost per request (in priceCurrency), used for image-gen models
  imageSize?:      string;   // default image size, e.g. '1024x1024', '1792x1024'
  priceCurrency?:  'usd' | 'cny';
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
  const rate = model.priceCurrency === 'cny' ? EXCHANGE_RATE_CNY_TO_USD : 1
  // Fixed per-request cost (e.g. image generation models)
  if (model.pricePerRequest != null) {
    return model.pricePerRequest / rate
  }
  if (model.inputPrice == null && model.outputPrice == null) return undefined
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
  type:            'openai' | 'anthropic' | 'google' | 'custom' | 'ollama' | 'qcw-muse';
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

export const OPENAI_MODELS: AIModel[] = [
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

export const ANTHROPIC_MODELS: AIModel[] = [
  { id: 'claude-opus-4-5',              name: 'Claude Opus 4.5',     contextLength: 200_000, multimodal: true },
  { id: 'claude-sonnet-4-5',            name: 'Claude Sonnet 4.5',   contextLength: 200_000, multimodal: true },
  { id: 'claude-haiku-4-5',             name: 'Claude Haiku 4.5',    contextLength: 200_000, multimodal: true },
  { id: 'claude-3-5-sonnet-20241022',   name: 'Claude 3.5 Sonnet',   contextLength: 200_000, multimodal: true },
  { id: 'claude-3-5-haiku-20241022',    name: 'Claude 3.5 Haiku',    contextLength: 200_000, multimodal: true },
  { id: 'claude-3-opus-20240229',       name: 'Claude 3 Opus',       contextLength: 200_000, multimodal: true },
]

export const GOOGLE_MODELS: AIModel[] = [
  { id: 'gemini-2.0-flash',      name: 'Gemini 2.0 Flash',      contextLength: 1_000_000, multimodal: true },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', contextLength: 1_000_000, multimodal: true },
  { id: 'gemini-1.5-pro',        name: 'Gemini 1.5 Pro',        contextLength: 2_000_000, multimodal: true },
  { id: 'gemini-1.5-flash',      name: 'Gemini 1.5 Flash',      contextLength: 1_000_000, multimodal: true },
]

export const DEEPSEEK_MODELS: AIModel[] = [
  { id: 'deepseek-chat',     name: 'DeepSeek V3',        contextLength: 64_000,  inputPrice: 1,  outputPrice: 2,  priceCurrency: 'cny' },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1',        contextLength: 64_000,  reasoning: true, inputPrice: 4, outputPrice: 16, priceCurrency: 'cny' },
]



// ─── Persistence ──────────────────────────────────────────────────────────────

interface PersistedProvider {
  id:              string;
  type:            AIProvider['type'];
  name:            string;
  builtIn?:        boolean;
  apiKeyEnc:       string;
  /** Plaintext key received from server when encryption was skipped (graceful fallback). */
  apiKey?:         string;
  baseUrl:         string;
  enabled:         boolean;
  selectedModelId: string;
  customModels?:   AIModel[];  // kept for backward compatibility
  updatedAt?:      string;
}

interface PersistedSettings {
  activeProviderId: string;
  providers:        PersistedProvider[];
  defaultProviderId?: string;
  defaultModelId?:    string;
  ebookDefaultProviderId?: string;
  ebookDefaultModelId?:    string;
  paperDefaultProviderId?: string;
  paperDefaultModelId?:    string;
  titleGenProviderId?: string;
  titleGenModelId?:    string;
}

async function saveToStorage(
  activeId: string,
  providers: AIProvider[],
  defaultProviderId?: string,
  defaultModelId?:    string,
  ebookDefaultProviderId?: string,
  ebookDefaultModelId?:    string,
  paperDefaultProviderId?: string,
  paperDefaultModelId?:    string,
  titleGenProviderId?: string,
  titleGenModelId?:    string,
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
      defaultProviderId,
      defaultModelId,
      ebookDefaultProviderId,
      ebookDefaultModelId,
      paperDefaultProviderId,
      paperDefaultModelId,
      titleGenProviderId,
      titleGenModelId,
    } satisfies PersistedSettings))
    localStorage.setItem(LS_MODIFIED_AT_KEY, new Date().toISOString())
  } catch (e) {
    console.error('Failed to save AI settings:', e)
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAiSettingsStore = defineStore('aiSettings', () => {
  // Start with no providers — users add their own; built-in defaults are no longer pre-populated.
  const providers        = ref<AIProvider[]>([])
  const activeProviderId = ref<string>('')
  const defaultProviderId = ref<string>('')
  const defaultModelId    = ref<string>('')
  const ebookDefaultProviderId = ref<string>('')
  const ebookDefaultModelId    = ref<string>('')
  const paperDefaultProviderId = ref<string>('')
  const paperDefaultModelId    = ref<string>('')
  const titleGenProviderId = ref<string>('')
  const titleGenModelId    = ref<string>('')

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
    if (p) {
      p.selectedModelId = modelId
      p.updatedAt = new Date().toISOString()
      persist()
    }
  }

  function setDefaultModel(providerId: string, modelId: string) {
    defaultProviderId.value = providerId
    defaultModelId.value    = modelId
    persist()
  }

  function clearDefaultModel() {
    defaultProviderId.value = ''
    defaultModelId.value    = ''
  }

  function setEbookDefaultModel(providerId: string, modelId: string) {
    ebookDefaultProviderId.value = providerId
    ebookDefaultModelId.value    = modelId
    persist()
  }

  function setPaperDefaultModel(providerId: string, modelId: string) {
    paperDefaultProviderId.value = providerId
    paperDefaultModelId.value    = modelId
    persist()
  }

  function setTitleGenModel(providerId: string, modelId: string) {
    titleGenProviderId.value = providerId
    titleGenModelId.value    = modelId
    persist()
  }

  function clearTitleGenModel() {
    titleGenProviderId.value = ''
    titleGenModelId.value    = ''
    persist()
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
      p.updatedAt = new Date().toISOString()
      persist()
    }
  }

  function removeCustomModel(providerId: string, modelId: string) {
    const p = providers.value.find(p => p.id === providerId)
    if (p) {
      p.models = p.models.filter(m => m.id !== modelId)
      p.updatedAt = new Date().toISOString()
      persist()
    }
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
    const target = providers.value[idx]
    // Tombstone ALL providers sharing the same name to clear all duplicates at once
    const sameNameIds = providers.value
      .filter(p => p.name === target.name)
      .map(p => p.id)
    providers.value = providers.value.filter(p => p.name !== target.name)
    if (sameNameIds.includes(activeProviderId.value)) {
      activeProviderId.value = providers.value[0]?.id ?? ''
    }
    for (const pid of sameNameIds) recordProviderDeletion(pid)
    persist()
  }

  // ─── Persistence helpers ────────────────────────────────────────────────────

  let _persistTimer: ReturnType<typeof setTimeout> | null = null
  let _initDone = false
  let _pendingPersist = false
  let _initResolve: (() => void) | undefined
  const _initPromise = new Promise<void>(resolve => { _initResolve = resolve })

  function persist() {
    if (!_initDone) { _pendingPersist = true; return }
    if (_persistTimer) clearTimeout(_persistTimer)
    _persistTimer = setTimeout(() => saveToStorage(
      activeProviderId.value,
      providers.value,
      defaultProviderId.value,
      defaultModelId.value,
      ebookDefaultProviderId.value,
      ebookDefaultModelId.value,
      paperDefaultProviderId.value,
      paperDefaultModelId.value,
      titleGenProviderId.value,
      titleGenModelId.value,
    ), DEBOUNCE_MS)
  }

  function flush(): Promise<void> {
    if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null }
    return saveToStorage(
      activeProviderId.value,
      providers.value,
      defaultProviderId.value,
      defaultModelId.value,
      ebookDefaultProviderId.value,
      ebookDefaultModelId.value,
      paperDefaultProviderId.value,
      paperDefaultModelId.value,
      titleGenProviderId.value,
      titleGenModelId.value,
    )
  }

  // Load persisted settings on init
  ;(async () => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const saved: PersistedSettings = JSON.parse(raw)

        for (const sp of saved.providers) {
          if (!sp.name) continue
          // All saved providers are reconstructed as-is (no built-in defaults exist anymore)
          const existing = providers.value.find(p => p.id === sp.id)
          if (existing) {
            // Merge into already-pushed provider (e.g. from a prior sync import mid-init)
            existing.baseUrl         = sp.baseUrl || existing.baseUrl
            existing.enabled         = sp.enabled
            existing.selectedModelId = sp.selectedModelId || existing.selectedModelId
            existing.updatedAt       = sp.updatedAt
            if (sp.customModels?.length) existing.models = sp.customModels
            if (sp.apiKeyEnc) {
              try { existing.apiKey = await decryptLocal(sp.apiKeyEnc) } catch { /* skip */ }
            }
          } else {
            const newP: AIProvider = {
              id:              sp.id,
              type:            sp.type ?? 'custom',
              name:            sp.name,
              apiKey:          '',
              baseUrl:         sp.baseUrl,
              models:          sp.customModels?.length ? sp.customModels : [{ id: 'default', name: '默认模型' }],
              enabled:         sp.enabled,
              selectedModelId: sp.selectedModelId,
              builtIn:         sp.builtIn ?? false,
              updatedAt:       sp.updatedAt,
            }
            providers.value.push(newP)  // claim the slot before async decrypt to prevent race duplication
            if (sp.apiKeyEnc) {
              try { newP.apiKey = await decryptLocal(sp.apiKeyEnc) } catch { /* skip */ }
            }
          }
        }

        if (saved.activeProviderId) activeProviderId.value = saved.activeProviderId
        if (saved.defaultProviderId) defaultProviderId.value = saved.defaultProviderId
        if (saved.defaultModelId)    defaultModelId.value    = saved.defaultModelId
        if (saved.ebookDefaultProviderId) ebookDefaultProviderId.value = saved.ebookDefaultProviderId
        if (saved.ebookDefaultModelId)    ebookDefaultModelId.value    = saved.ebookDefaultModelId
        if (saved.paperDefaultProviderId) paperDefaultProviderId.value = saved.paperDefaultProviderId
        if (saved.paperDefaultModelId)    paperDefaultModelId.value    = saved.paperDefaultModelId
        if (saved.titleGenProviderId) titleGenProviderId.value = saved.titleGenProviderId
        if (saved.titleGenModelId)    titleGenModelId.value    = saved.titleGenModelId
      }
    } catch { /* ignore corrupt data */ }
    _initDone = true
    _initResolve?.()
    if (_pendingPersist) persist()
  })()

  // Watch for changes and auto-persist + server push
  let _serverPushTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleServerPush() {
    if (_serverPushTimer) clearTimeout(_serverPushTimer)
    _serverPushTimer = setTimeout(() => { pushToServer().catch((err) => { console.error('[AISettingsSync] Push to server failed:', err) }) }, 800)
  }

  watch(providers, () => { persist(); scheduleServerPush() }, { deep: true })
  watch(activeProviderId,       () => { persist(); scheduleServerPush() })
  watch(defaultProviderId,      () => { persist(); scheduleServerPush() })
  watch(defaultModelId,         () => { persist(); scheduleServerPush() })
  watch(ebookDefaultProviderId, () => { persist(); scheduleServerPush() })
  watch(ebookDefaultModelId,    () => { persist(); scheduleServerPush() })
  watch(paperDefaultProviderId, () => { persist(); scheduleServerPush() })
  watch(paperDefaultModelId,    () => { persist(); scheduleServerPush() })
  watch(titleGenProviderId,     () => { persist(); scheduleServerPush() })
  watch(titleGenModelId,        () => { persist(); scheduleServerPush() })

  // ─── Server sync ────────────────────────────────────────────────────────────

  async function pushToServer(): Promise<void> {
    const srvKey = getServerApiKey()
    if (!srvKey) return
    const persisted: PersistedProvider[] = []
    for (const p of providers.value) {
      let apiKeyEnc = ''
      if (p.apiKey) {
        try { apiKeyEnc = await encryptForServer(p.apiKey, srvKey) } catch { /* skip */ }
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
    await apiPut('/api/settings/ai', {
      value: {
        activeProviderId:       activeProviderId.value,
        providers:              persisted,
        defaultProviderId:      defaultProviderId.value,
        defaultModelId:         defaultModelId.value,
        ebookDefaultProviderId: ebookDefaultProviderId.value,
        ebookDefaultModelId:    ebookDefaultModelId.value,
        paperDefaultProviderId: paperDefaultProviderId.value,
        paperDefaultModelId:    paperDefaultModelId.value,
        titleGenProviderId:     titleGenProviderId.value,
        titleGenModelId:        titleGenModelId.value,
        deletedProviders:       getDeletedProviders(),
      },
    })
  }

  // ── Content-based provider merge helpers ───────────────────────────────────

  function _providerFingerprint(p: { name: string; type: string; baseUrl: string; enabled: boolean; models: AIModel[] }): string {
    const modelKey = p.models.map(m => `${m.id}|${m.name}`).sort().join(',')
    return `${p.name}|${p.type}|${p.baseUrl}|${p.enabled}|${modelKey}`
  }

  function _providerContentEqual(a: AIProvider, b: AIProvider): boolean {
    return _providerFingerprint(a) === _providerFingerprint(b)
  }

  /** Remap an old provider id to a new one in all id-referencing fields. */
  function _remapProviderId(oldId: string, newId: string) {
    if (activeProviderId.value === oldId) activeProviderId.value = newId
    if (defaultProviderId.value === oldId) defaultProviderId.value = newId
    if (ebookDefaultProviderId.value === oldId) ebookDefaultProviderId.value = newId
    if (ebookDefaultModelId.value && providers.value.find(p => p.id === oldId)?.selectedModelId === ebookDefaultModelId.value) {
      // modelId stays the same, providerId changes
    }
    if (paperDefaultProviderId.value === oldId) paperDefaultProviderId.value = newId
    if (titleGenProviderId.value === oldId) titleGenProviderId.value = newId
    // Also remap inside each provider's selectedModelId? No, model IDs are provider-scoped.
  }

  async function syncFromServer(allSettings: Record<string, unknown>): Promise<void> {
    await _initPromise  // wait for local init to finish
    const s = allSettings.ai as (PersistedSettings & { deletedProviders?: Record<string, string> }) | undefined
    if (!s) return
    const srvKey = getServerApiKey()

    if (s.deletedProviders) applyRemoteDeletedProviders(s.deletedProviders)
    const deletedMap = getDeletedProviders()

    // Convert remote providers to AIProvider[]
    const remoteProviders: AIProvider[] = []
    for (const sp of (s.providers ?? [])) {
      if (!sp.name || deletedMap[sp.id]) continue
      let apiKey = sp.apiKey || ''
      if (sp.apiKeyEnc && srvKey) {
        try { apiKey = await decryptFromServer(sp.apiKeyEnc, srvKey) } catch { /* skip */ }
      }
      remoteProviders.push({
        id:              sp.id,
        type:            sp.type            ?? 'custom',
        name:            sp.name,
        apiKey,
        baseUrl:         sp.baseUrl         ?? '',
        models:          sp.customModels?.length ? sp.customModels : [{ id: 'default', name: '默认模型' }],
        enabled:         sp.enabled         ?? true,
        selectedModelId: sp.selectedModelId ?? '',
        builtIn:         sp.builtIn         ?? false,
        updatedAt:       sp.updatedAt,
      })
    }

    // Content-based merge: same content → keep one (deterministic id = lexicographically smallest)
    const merged: AIProvider[] = []
    const remoteMatched = new Set<string>()
    const idRemap = new Map<string, string>() // oldId -> keepId

    // 1. Process local providers
    for (const local of providers.value) {
      const remoteIdx = remoteProviders.findIndex(r => _providerContentEqual(local, r) && !remoteMatched.has(r.id))
      if (remoteIdx >= 0) {
        const remote = remoteProviders[remoteIdx]
        remoteMatched.add(remote.id)
        // Content is identical → keep one. Use lexicographically smallest id for cross-device convergence.
        const keepId = local.id < remote.id ? local.id : remote.id
        const discardId = keepId === local.id ? remote.id : local.id
        if (discardId !== keepId) idRemap.set(discardId, keepId)
        merged.push({
          ...local,
          id: keepId,
          // Merge apiKey: prefer local plaintext, fall back to remote decrypted
          apiKey: local.apiKey || remote.apiKey,
          // Merge selectedModelId: prefer non-empty
          selectedModelId: local.selectedModelId || remote.selectedModelId,
          // Use latest updatedAt
          updatedAt: (local.updatedAt && remote.updatedAt)
            ? (local.updatedAt > remote.updatedAt ? local.updatedAt : remote.updatedAt)
            : (local.updatedAt || remote.updatedAt),
        })
      } else {
        // Local-only (content not found remotely)
        merged.push(local)
      }
    }

    // 2. Add remote-only providers (skip if same name already in merged to avoid duplicates)
    const mergedNames = new Set(merged.map(p => p.name))
    for (const remote of remoteProviders) {
      if (!remoteMatched.has(remote.id) && !mergedNames.has(remote.name)) {
        merged.push(remote)
        mergedNames.add(remote.name)
      }
    }

    // 3. Apply id remaps to all referencing fields
    for (const [oldId, newId] of idRemap) {
      _remapProviderId(oldId, newId)
    }

    // Temporarily suppress the watch-triggered server push during bulk replace
    providers.value = merged

    if (s.activeProviderId)  activeProviderId.value  = s.activeProviderId
    if (s.defaultProviderId) defaultProviderId.value = s.defaultProviderId
    if (s.defaultModelId)    defaultModelId.value    = s.defaultModelId
    if (s.ebookDefaultProviderId) ebookDefaultProviderId.value = s.ebookDefaultProviderId
    if (s.ebookDefaultModelId)    ebookDefaultModelId.value    = s.ebookDefaultModelId
    if (s.paperDefaultProviderId) paperDefaultProviderId.value = s.paperDefaultProviderId
    if (s.paperDefaultModelId)    paperDefaultModelId.value    = s.paperDefaultModelId
    if (s.titleGenProviderId) titleGenProviderId.value = s.titleGenProviderId
    if (s.titleGenModelId)    titleGenModelId.value    = s.titleGenModelId

    await flush()
  }

  return {
    providers,
    activeProviderId,
    activeProvider,
    activeModelId,
    defaultProviderId,
    defaultModelId,
    ebookDefaultProviderId,
    ebookDefaultModelId,
    paperDefaultProviderId,
    paperDefaultModelId,
    titleGenProviderId,
    titleGenModelId,
    configuredProviders,
    setActiveProvider,
    setModelForProvider,
    setDefaultModel,
    clearDefaultModel,
    setEbookDefaultModel,
    setPaperDefaultModel,
    setTitleGenModel,
    clearTitleGenModel,
    updateProvider,
    importProvider,
    addCustomModel,
    removeCustomModel,
    addProvider,
    removeProvider,
    persist,
    flush,
    pushToServer,
    syncFromServer,
  }
})

