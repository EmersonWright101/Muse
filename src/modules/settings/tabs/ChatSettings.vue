<script setup lang="ts">
import { computed } from 'vue'
import { useChatSettingsStore, DEFAULT_TITLE_PROMPT } from '../../../stores/chatSettings'
import { useAiSettingsStore } from '../../../stores/aiSettings'

const chatSettings = useChatSettingsStore()
const ai           = useAiSettingsStore()

// Providers that have a valid API key configured
const availableProviders = computed(() =>
  ai.providers.filter(p => p.enabled && p.apiKey && p.models.length > 0),
)

// Models for the currently selected title-gen provider
const availableModels = computed(() => {
  const p = ai.providers.find(p => p.id === chatSettings.titleGenProviderId)
  return p?.models ?? []
})

function onProviderChange(pid: string) {
  chatSettings.titleGenProviderId = pid
  // Auto-select the first model of the new provider
  const p = ai.providers.find(p => p.id === pid)
  chatSettings.titleGenModelId = p?.models[0]?.id ?? ''
}

function resetPrompt() {
  chatSettings.titleGenPrompt = DEFAULT_TITLE_PROMPT
}
</script>

<template>
  <div class="chat-settings">
    <h1 class="page-title">对话设置</h1>

    <div class="section-card">
      <h2 class="section-title">话题标题生成</h2>
      <p class="section-desc">每轮对话结束后，自动调用指定模型为对话生成一个简短标题。不配置则保持原标题不变。</p>

      <div class="field">
        <label class="field-label">供应商</label>
        <select
          class="field-select"
          :value="chatSettings.titleGenProviderId"
          @change="onProviderChange(($event.target as HTMLSelectElement).value)"
        >
          <option value="">不自动生成标题</option>
          <option
            v-for="p in availableProviders"
            :key="p.id"
            :value="p.id"
          >{{ p.name }}</option>
        </select>
      </div>

      <div v-if="chatSettings.titleGenProviderId" class="field">
        <label class="field-label">模型</label>
        <select
          v-model="chatSettings.titleGenModelId"
          class="field-select"
        >
          <option value="">请选择模型</option>
          <option
            v-for="m in availableModels"
            :key="m.id"
            :value="m.id"
          >{{ m.name || m.id }}</option>
        </select>
      </div>

      <div v-if="chatSettings.titleGenProviderId" class="field">
        <div class="field-label-row">
          <label class="field-label">Prompt 模板</label>
          <button class="reset-btn" @click="resetPrompt()">恢复默认</button>
        </div>
        <p class="field-hint">使用 <code>{user}</code> 和 <code>{response}</code> 作为占位符，分别代表用户第一条消息和 AI 的回复。</p>
        <textarea
          v-model="chatSettings.titleGenPrompt"
          class="field-textarea"
          rows="5"
          spellcheck="false"
        />
      </div>
    </div>

    <div class="section-card">
      <h2 class="section-title">模型参数</h2>
      <p class="section-desc">调整发送给 AI 的请求参数，适用于所有对话。</p>

      <div class="field">
        <div class="field-label-row">
          <label class="field-label">Temperature（创意度）</label>
          <span class="param-value">{{ chatSettings.temperature.toFixed(2) }}</span>
        </div>
        <p class="field-hint">控制输出的随机性。0 = 确定性最强，1 = 默认，2 = 最具创意。</p>
        <input
          type="range"
          min="0" max="2" step="0.05"
          :value="chatSettings.temperature"
          class="field-range"
          @input="chatSettings.temperature = Number(($event.target as HTMLInputElement).value)"
        />
        <div class="range-labels">
          <span>0</span><span>1</span><span>2</span>
        </div>
      </div>

      <div class="field">
        <div class="field-label-row">
          <label class="field-label">Max Tokens（最大输出长度）</label>
          <button class="reset-btn" @click="chatSettings.maxTokens = 8192">重置</button>
        </div>
        <p class="field-hint">单次回复最多生成的 token 数量。不同模型上限不同，请勿超过模型限制。</p>
        <input
          v-model.number="chatSettings.maxTokens"
          type="number"
          min="256"
          max="131072"
          step="256"
          class="field-input"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-settings {
  padding: 28px 32px;
  max-width: 520px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: #1c1c1e;
  margin: 0;
}

.section-card {
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0;
}

.section-desc {
  font-size: 12px;
  color: #8e8e93;
  margin: 0;
  line-height: 1.5;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field-label {
  font-size: 12px;
  font-weight: 500;
  color: #3c3c43;
}

.field-hint {
  font-size: 11px;
  color: #8e8e93;
  margin: 0;
  line-height: 1.5;
}

.field-hint code {
  font-family: 'SF Mono', 'Menlo', monospace;
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 10.5px;
}

.field-select {
  height: 32px;
  border: 1.5px solid rgba(0, 0, 0, 0.10);
  border-radius: 8px;
  padding: 0 10px;
  font-size: 13px;
  color: #1c1c1e;
  background: white;
  outline: none;
  cursor: pointer;
  transition: border-color 0.15s;
  font-family: inherit;
  appearance: auto;
}

.field-select:focus { border-color: rgba(34, 63, 121, 0.4); }

.field-textarea {
  border: 1.5px solid rgba(0, 0, 0, 0.10);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: #1c1c1e;
  background: white;
  outline: none;
  resize: vertical;
  font-family: inherit;
  transition: border-color 0.15s;
}

.field-textarea:focus { border-color: rgba(34, 63, 121, 0.4); }

.reset-btn {
  font-size: 11px;
  color: #223F79;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  opacity: 0.75;
  transition: opacity 0.12s;
}

.reset-btn:hover { opacity: 1; }

.param-value {
  font-size: 12px;
  font-weight: 600;
  color: #223F79;
  font-variant-numeric: tabular-nums;
}

.field-range {
  width: 100%;
  accent-color: #223F79;
  cursor: pointer;
}

.range-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #aeaeb2;
  margin-top: 2px;
}

.field-input {
  height: 32px;
  border: 1.5px solid rgba(0, 0, 0, 0.10);
  border-radius: 8px;
  padding: 0 10px;
  font-size: 13px;
  color: #1c1c1e;
  background: white;
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
  width: 140px;
}

.field-input:focus { border-color: rgba(34, 63, 121, 0.4); }
</style>
