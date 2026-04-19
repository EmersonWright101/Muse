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

const LS_KEY             = 'muse-ai-settings'
export const LS_MODIFIED_AT_KEY = 'muse-ai-settings-modified-at'

export interface AIModel {
  id:            string;
  name:          string;
  contextLength?: number;
  multimodal?:   boolean;
}

export interface AIProvider {
  id:              string;
  type:            'openai' | 'anthropic' | 'google' | 'custom';
  name:            string;
  apiKey:          string;   // plaintext in memory only; stored encrypted
  baseUrl:         string;
  models:          AIModel[];
  enabled:         boolean;
  selectedModelId: string;
  builtIn?:        boolean;  // true for the four default providers
}

// ─── Built-in model lists ─────────────────────────────────────────────────────

const OPENAI_MODELS: AIModel[] = [
  { id: 'gpt-4o',          name: 'GPT-4o',        contextLength: 128_000, multimodal: true },
  { id: 'gpt-4o-mini',     name: 'GPT-4o Mini',   contextLength: 128_000, multimodal: true },
  { id: 'gpt-4-turbo',     name: 'GPT-4 Turbo',   contextLength: 128_000, multimodal: true },
  { id: 'gpt-4',           name: 'GPT-4',          contextLength:   8_192 },
  { id: 'gpt-3.5-turbo',   name: 'GPT-3.5 Turbo', contextLength:  16_385 },
  { id: 'o1',              name: 'o1',             contextLength: 200_000 },
  { id: 'o1-mini',         name: 'o1 Mini',        contextLength: 128_000 },
  { id: 'o3-mini',         name: 'o3 Mini',        contextLength: 200_000 },
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

const DEFAULT_PROVIDERS: AIProvider[] = [
  { id: 'openai',    type: 'openai',    name: 'OpenAI',              apiKey: '', baseUrl: 'https://api.openai.com/v1',                       models: OPENAI_MODELS,    enabled: true,  selectedModelId: 'gpt-4o',              builtIn: true },
  { id: 'anthropic', type: 'anthropic', name: 'Anthropic',           apiKey: '', baseUrl: 'https://api.anthropic.com',                        models: ANTHROPIC_MODELS, enabled: true,  selectedModelId: 'claude-sonnet-4-5',   builtIn: true },
  { id: 'google',    type: 'google',    name: 'Google Gemini',       apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: GOOGLE_MODELS,    enabled: true,  selectedModelId: 'gemini-2.0-flash',    builtIn: true },
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
  customModels?:   AIModel[];
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
        customModels:    p.type === 'custom' ? p.models : undefined,
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

  function updateProvider(id: string, patch: Partial<Pick<AIProvider, 'apiKey' | 'baseUrl' | 'enabled' | 'name'>>) {
    const p = providers.value.find(p => p.id === id)
    if (p) Object.assign(p, patch)
    persist()
  }

  function addCustomModel(providerId: string, model: AIModel) {
    const p = providers.value.find(p => p.id === providerId)
    if (p && !p.models.find(m => m.id === model.id)) p.models.push(model)
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
    persist()
  }

  // ─── Persistence helpers ────────────────────────────────────────────────────

  let _persistTimer: ReturnType<typeof setTimeout> | null = null
  function persist() {
    if (_persistTimer) clearTimeout(_persistTimer)
    _persistTimer = setTimeout(() => saveToStorage(activeProviderId.value, providers.value), 300)
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
        if (sp.customModels?.length) p.models = sp.customModels
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
    addCustomModel,
    removeCustomModel,
    addProvider,
    removeProvider,
    persist,
  }
})
