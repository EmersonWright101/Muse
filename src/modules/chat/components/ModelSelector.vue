<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ChevronDown, Check } from 'lucide-vue-next'
import { useAiSettingsStore } from '../../../stores/aiSettings'

const props = defineProps<{ dropDown?: boolean }>()

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
  open.value = false
}

function handleOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

onMounted(()  => document.addEventListener('mousedown', handleOutside))
onUnmounted(() => document.removeEventListener('mousedown', handleOutside))
</script>

<template>
  <div ref="root" class="model-selector">
    <button class="selector-btn" @click="open = !open">
      <span class="provider-dot" :class="activeProvider?.id ?? 'none'" />
      <span class="model-name">
        {{ activeModel?.name ?? activeProvider?.name ?? '选择模型' }}
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
            <div class="group-label">{{ p.name }}</div>
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

.provider-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.provider-dot.openai    { background: #10a37f; }
.provider-dot.anthropic { background: #d4890a; }
.provider-dot.google    { background: #4285f4; }
.provider-dot.custom    { background: #8e8e93; }
.provider-dot.none      { background: #c7c7cc; }

.model-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.group-label {
  font-size: 10px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 10px 2px;
}

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
