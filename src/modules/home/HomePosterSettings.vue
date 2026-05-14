<script setup lang="ts">
import { ref, computed } from 'vue'
import { useHomeStore, DEFAULT_PROMPT, FREQUENCY_OPTIONS } from '../../stores/home'
import { useAiSettingsStore } from '../../stores/aiSettings'
import { useI18n } from 'vue-i18n'
import { RotateCcw } from 'lucide-vue-next'
import AnimalListPanel from './AnimalListPanel.vue'

const { locale, t } = useI18n()
const homeStore = useHomeStore()
const aiStore   = useAiSettingsStore()

const posterEnabled    = ref(homeStore.settings.enabled)
const posterProviderId = ref(homeStore.settings.providerId)
const posterModelId    = ref(homeStore.settings.modelId)
const posterFrequency  = ref(homeStore.settings.frequency)
const posterPrompt     = ref(homeStore.settings.promptTemplate || DEFAULT_PROMPT)
const posterMaxPosters = ref(homeStore.settings.maxPosters)

const imageProviders = computed(() =>
  aiStore.providers.filter(p => p.enabled && p.apiKey && p.models.some(m => m.imageOutput))
)

const imageModels = computed(() => {
  const provider = aiStore.providers.find(p => p.id === posterProviderId.value)
  return provider?.models.filter(m => m.imageOutput) ?? []
})

function save() {
  homeStore.updateSettings({
    enabled:        posterEnabled.value,
    providerId:     posterProviderId.value,
    modelId:        posterModelId.value,
    frequency:      posterFrequency.value,
    promptTemplate: posterPrompt.value,
    maxPosters:     posterMaxPosters.value,
  })
}

function onProviderChange() {
  const models = imageModels.value
  if (models.length > 0 && !models.find(m => m.id === posterModelId.value)) {
    posterModelId.value = models[0].id
  }
  save()
}

function resetPrompt() {
  posterPrompt.value = DEFAULT_PROMPT
  save()
}
</script>

<template>
  <div class="poster-settings-panel">
    <!-- Section: 自动生成 -->
    <div class="ps-section">
      <div class="ps-section-title">{{ t('settings.poster.title') }}</div>

      <!-- Enable toggle -->
      <div class="ps-row">
        <span class="ps-label">{{ t('settings.poster.enabled') }}</span>
        <button
          class="ps-toggle"
          :class="{ active: posterEnabled }"
          @click="posterEnabled = !posterEnabled; save()"
        >
          <div class="ps-toggle-thumb" />
        </button>
      </div>

      <!-- Provider -->
      <div class="ps-row">
        <span class="ps-label">{{ t('settings.poster.provider') }}</span>
        <select
          v-if="imageProviders.length > 0"
          v-model="posterProviderId"
          class="ps-select"
          @change="onProviderChange"
        >
          <option value="">{{ t('settings.poster.selectProvider') }}</option>
          <option v-for="p in imageProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <span v-else class="ps-no-models">{{ t('settings.poster.noImageModels') }}</span>
      </div>

      <!-- Model -->
      <div v-if="imageModels.length > 0" class="ps-row">
        <span class="ps-label">{{ t('settings.poster.model') }}</span>
        <select v-model="posterModelId" class="ps-select" @change="save">
          <option value="">{{ t('settings.poster.selectModel') }}</option>
          <option v-for="m in imageModels" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </div>

      <!-- Frequency -->
      <div class="ps-row align-top">
        <span class="ps-label">{{ t('settings.poster.frequency') }}</span>
        <div class="ps-freq-group">
          <button
            v-for="opt in FREQUENCY_OPTIONS"
            :key="opt.value"
            class="ps-freq-btn"
            :class="{ active: posterFrequency === opt.value }"
            @click="posterFrequency = opt.value; save()"
          >
            {{ locale === 'zh-CN' ? opt.labelZh : opt.labelEn }}
          </button>
        </div>
      </div>

      <!-- Max posters -->
      <div class="ps-row">
        <span class="ps-label">{{ t('settings.poster.maxPosters') }}</span>
        <div class="ps-num-row">
          <input
            v-model.number="posterMaxPosters"
            type="number"
            min="5"
            max="100"
            class="ps-num-input"
            @change="save"
          />
          <span class="ps-num-unit">{{ t('settings.poster.maxPostersUnit') }}</span>
        </div>
      </div>
    </div>

    <div class="ps-divider" />

    <!-- Section: 提示词 -->
    <div class="ps-section">
      <div class="ps-prompt-header">
        <span class="ps-section-title">{{ t('settings.poster.promptTitle') }}</span>
        <button class="ps-reset-btn" @click="resetPrompt">
          <RotateCcw :size="11" />
          重置
        </button>
      </div>
      <p class="ps-hint">{{ t('settings.poster.promptHint') }}</p>
      <textarea
        v-model="posterPrompt"
        class="ps-textarea"
        rows="3"
        @blur="save"
      />
    </div>

    <div class="ps-divider" />

    <!-- Section: 动物候选池 -->
    <div class="ps-section ps-section-animals">
      <AnimalListPanel />
    </div>
  </div>
</template>

<style scoped>
.poster-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 4px 0;
}

.ps-section {
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ps-section-animals {
  padding: 6px 14px 10px;
}

.ps-section-title {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 2px;
}

.ps-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.06);
  margin: 0 14px;
}

.ps-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 30px;
}

.ps-row.align-top {
  align-items: flex-start;
  padding-top: 2px;
}

.ps-label {
  font-size: 12px;
  color: #3c3c43;
  width: 72px;
  flex-shrink: 0;
}

.ps-toggle {
  width: 40px;
  height: 23px;
  border-radius: 12px;
  border: none;
  background: rgba(0,0,0,0.12);
  cursor: pointer;
  transition: background 0.18s;
  padding: 2px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.ps-toggle.active {
  background: #223F79;
  justify-content: flex-end;
}

.ps-toggle-thumb {
  width: 19px;
  height: 19px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}

.ps-select {
  flex: 1;
  height: 28px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid rgba(0,0,0,0.12);
  background: white;
  font-size: 12px;
  color: #1c1c1e;
  cursor: pointer;
  outline: none;
}

.ps-select:focus {
  border-color: rgba(34, 63, 121, 0.35);
}

.ps-no-models {
  font-size: 11px;
  color: #ff9500;
  line-height: 1.4;
  flex: 1;
}

.ps-freq-group {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.ps-freq-btn {
  padding: 4px 10px;
  border-radius: 7px;
  border: 1.5px solid transparent;
  background: rgba(0,0,0,0.04);
  color: #3c3c43;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.1s;
}

.ps-freq-btn:hover {
  background: rgba(0,0,0,0.08);
}

.ps-freq-btn.active {
  background: rgba(34, 63, 121, 0.09);
  border-color: rgba(34, 63, 121, 0.25);
  color: #223F79;
}

.ps-num-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ps-num-input {
  width: 56px;
  height: 28px;
  padding: 0 6px;
  border-radius: 7px;
  border: 1px solid rgba(0,0,0,0.12);
  background: white;
  font-size: 12px;
  color: #1c1c1e;
  text-align: center;
  outline: none;
}

.ps-num-input:focus {
  border-color: rgba(34, 63, 121, 0.35);
}

.ps-num-unit {
  font-size: 12px;
  color: #8e8e93;
}

.ps-prompt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ps-hint {
  font-size: 11px;
  color: #aeaeb2;
  margin: -4px 0 0;
  line-height: 1.4;
}

.ps-textarea {
  width: 100%;
  padding: 7px 9px;
  border-radius: 7px;
  border: 1px solid rgba(0,0,0,0.12);
  background: white;
  font-size: 11px;
  color: #1c1c1e;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.ps-textarea:focus {
  border-color: rgba(34, 63, 121, 0.35);
}

.ps-reset-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: #8e8e93;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 5px;
  transition: color 0.1s, background 0.1s;
}

.ps-reset-btn:hover {
  color: #3c3c43;
  background: rgba(0,0,0,0.05);
}
</style>
