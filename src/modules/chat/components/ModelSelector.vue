<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ChevronDown, Check } from 'lucide-vue-next'
import { useAiSettingsStore, type AIProvider } from '../../../stores/aiSettings'

const props = defineProps<{ dropDown?: boolean }>()
const emit = defineEmits<{ (e: 'select', providerId: string, modelId: string): void }>()

const ai    = useAiSettingsStore()
const open  = ref(false)
const root  = ref<HTMLElement>()

const activeProvider = computed(() => ai.activeProvider())
const activeModel    = computed(() =>
  activeProvider.value?.models.find(m => m.id === activeProvider.value?.selectedModelId)
)

const configuredProviders = computed(() => ai.configuredProviders())

function selectModel(providerId: string, modelId: string) {
  ai.setActiveProvider(providerId)
  ai.setModelForProvider(providerId, modelId)
  emit('select', providerId, modelId)
  open.value = false
}

function handleOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

onMounted(()  => document.addEventListener('mousedown', handleOutside))
onUnmounted(() => document.removeEventListener('mousedown', handleOutside))

// ─── Provider icon mapping ────────────────────────────────────────────────────

const PROVIDER_ICONS: Record<string, string> = {
  openai:      new URL('../../../assets/providers/openai.svg',      import.meta.url).href,
  anthropic:   new URL('../../../assets/providers/claude.svg',      import.meta.url).href,
  google:      new URL('../../../assets/providers/gemini.svg',      import.meta.url).href,
  deepseek:    new URL('../../../assets/providers/deepseek.svg',    import.meta.url).href,
  ollama:      new URL('../../../assets/providers/ollama.svg',      import.meta.url).href,
  lmstudio:    new URL('../../../assets/providers/lmstudio.svg',    import.meta.url).href,
  openrouter:  new URL('../../../assets/providers/openrouter.svg',  import.meta.url).href,
  siliconflow: new URL('../../../assets/providers/siliconflow.svg', import.meta.url).href,
  zhipu:       new URL('../../../assets/providers/zhipu.svg',       import.meta.url).href,
  microsoft:   new URL('../../../assets/providers/microsoft.svg',   import.meta.url).href,
  nvidia:      new URL('../../../assets/providers/nvidia.svg',      import.meta.url).href,
}

function providerIcon(p: AIProvider): string | null {
  // Built-in id match
  if (PROVIDER_ICONS[p.id]) return PROVIDER_ICONS[p.id]
  // Name / baseUrl keyword match for custom providers
  const key = (p.name + ' ' + p.baseUrl).toLowerCase()
  if (key.includes('deepseek'))    return PROVIDER_ICONS.deepseek
  if (key.includes('ollama'))      return PROVIDER_ICONS.ollama
  if (key.includes('lmstudio'))    return PROVIDER_ICONS.lmstudio
  if (key.includes('openrouter'))  return PROVIDER_ICONS.openrouter
  if (key.includes('siliconflow')) return PROVIDER_ICONS.siliconflow
  if (key.includes('zhipu') || key.includes('智谱')) return PROVIDER_ICONS.zhipu
  if (key.includes('azure') || key.includes('microsoft')) return PROVIDER_ICONS.microsoft
  if (key.includes('nvidia') || key.includes('dgx')) return PROVIDER_ICONS.nvidia
  if (key.includes('claude') || key.includes('anthropic')) return PROVIDER_ICONS.anthropic
  if (key.includes('gemini') || key.includes('google'))    return PROVIDER_ICONS.google
  if (key.includes('openai') || p.type === 'openai')       return PROVIDER_ICONS.openai
  return null
}
</script>

<template>
  <div ref="root" class="model-selector">
    <button class="selector-btn" @click="open = !open">
      <img
        v-if="activeProvider && providerIcon(activeProvider)"
        :src="providerIcon(activeProvider)!"
        class="provider-icon"
        :alt="activeProvider.name"
      />
      <span v-else class="provider-dot-fallback" />
      <span class="selector-label">
        <span class="selector-provider">{{ activeProvider?.name ?? '选择模型' }}</span>
        <span v-if="activeModel" class="selector-sep">·</span>
        <span v-if="activeModel" class="selector-model">{{ activeModel.name }}</span>
      </span>
      <ChevronDown :size="12" class="chevron" :class="{ rotated: open }" />
    </button>

    <Transition name="dropdown">
      <div v-if="open" class="dropdown" :class="{ 'drop-down': props.dropDown }">
        <div v-if="configuredProviders.length === 0" class="no-providers">
          请先在设置中添加 API Key
        </div>
        <div v-else>
          <div v-for="p in configuredProviders" :key="p.id" class="provider-group">
            <div class="group-label">
              <img
                v-if="providerIcon(p)"
                :src="providerIcon(p)!"
                class="group-label-icon"
                :alt="p.name"
              />
              {{ p.name }}
            </div>
            <button
              v-for="m in p.models"
              :key="m.id"
              class="model-item"
              :class="{ active: ai.activeProviderId === p.id && p.selectedModelId === m.id }"
              @click="selectModel(p.id, m.id)"
            >
              <Check v-if="ai.activeProviderId === p.id && p.selectedModelId === m.id" :size="11" class="check-icon" />
              <span v-else class="check-placeholder" />
              <span class="m-name">{{ m.name }}</span>
              <span v-if="m.reasoning"   class="m-cap reasoning">思考</span>
              <span v-if="m.imageOutput" class="m-cap image">图像</span>
              <span v-if="m.contextLength" class="m-ctx">{{ formatCtx(m.contextLength) }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts">
function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}
</script>

<style scoped>
.model-selector {
  position: relative;
}

.selector-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: rgba(0, 0, 0, 0.05);
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  color: #3c3c43;
  transition: background 0.12s;
}

.selector-btn:hover { background: rgba(0, 0, 0, 0.08); }

.provider-icon {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  flex-shrink: 0;
  object-fit: contain;
}

.provider-dot-fallback {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c7c7cc;
  flex-shrink: 0;
}

.group-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 10px 2px;
}

.group-label-icon {
  width: 13px;
  height: 13px;
  border-radius: 3px;
  object-fit: contain;
  flex-shrink: 0;
}

.selector-label {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 200px;
  overflow: hidden;
  white-space: nowrap;
}

.selector-provider {
  font-weight: 600;
  color: #1c1c1e;
  flex-shrink: 0;
}

.selector-sep {
  color: #c7c7cc;
  flex-shrink: 0;
}

.selector-model {
  color: #3c3c43;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chevron { color: #8e8e93; transition: transform 0.15s; }
.chevron.rotated { transform: rotate(180deg); }

.dropdown {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  left: auto;
  min-width: 240px;
  max-height: 320px;
  overflow-y: auto;
  background: rgba(250, 250, 252, 0.95);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.14);
  padding: 6px;
  z-index: 100;
}

.dropdown::-webkit-scrollbar { width: 3px; }
.dropdown::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

.no-providers {
  padding: 12px;
  font-size: 12px;
  color: #8e8e93;
  text-align: center;
}

.provider-group { margin-bottom: 4px; }


.model-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  background: transparent;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
  color: #1c1c1e;
  transition: background 0.10s;
}

.model-item:hover { background: rgba(0, 0, 0, 0.05); }
.model-item.active { background: rgba(34, 63, 121, 0.08); color: #223F79; }

.check-icon { color: #223F79; flex-shrink: 0; }
.check-placeholder { width: 11px; flex-shrink: 0; }

.m-name { flex: 1; text-align: left; }

.m-ctx {
  font-size: 10px;
  color: #8e8e93;
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 5px;
  border-radius: 4px;
}

.m-cap {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
}

.m-cap.reasoning { background: rgba(88, 86, 214, 0.10); color: #5856d6; }
.m-cap.image     { background: rgba(255, 149, 0, 0.12); color: #c8710a; }

.drop-down {
  bottom: auto;
  top: calc(100% + 8px);
}

/* Transition */
.dropdown-enter-active, .dropdown-leave-active {
  transition: opacity 0.12s, transform 0.12s;
}
.dropdown-enter-from, .dropdown-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
