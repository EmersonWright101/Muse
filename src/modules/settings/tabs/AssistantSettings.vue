<script setup lang="ts">
import { computed, watch } from 'vue'
import { useAssistantSettingsStore, DEFAULT_TITLE_PROMPT } from '../../../stores/assistantSettings'
import { useAiSettingsStore } from '../../../stores/aiSettings'

const s  = useAssistantSettingsStore()
const ai = useAiSettingsStore()

function save() { s.persist() }

// ─── Main model provider / model ─────────────────────────────────────────────

const availableProviders = computed(() =>
  ai.providers.filter(p => p.enabled && p.apiKey && p.models.length > 0),
)

const mainModelOptions = computed(() =>
  ai.providers.find(p => p.id === s.providerId)?.models ?? [],
)

function onMainProviderChange(pid: string) {
  s.providerId = pid
  s.modelId    = ai.providers.find(p => p.id === pid)?.models[0]?.id ?? ''
  s.persist()
}

watch(() => s.modelId, () => s.persist())

// ─── Title gen provider / model ───────────────────────────────────────────────

const titleGenModelOptions = computed(() =>
  ai.providers.find(p => p.id === s.titleGenProviderId)?.models ?? [],
)

function onProviderChange(pid: string) {
  s.titleGenProviderId = pid
  s.titleGenModelId    = ai.providers.find(p => p.id === pid)?.models[0]?.id ?? ''
  s.persist()
}

watch(() => s.titleGenModelId, () => s.persist())
watch(() => s.titleGenPrompt,  () => s.persist())

function resetPrompt() {
  s.titleGenPrompt = DEFAULT_TITLE_PROMPT
  s.persist()
}
</script>

<template>
  <div class="assistant-settings">
    <h1 class="page-title">私人助手设置</h1>

    <!-- ── Model ──────────────────────────────────────────────── -->
    <div class="section-card">
      <h2 class="section-title">模型配置</h2>
      <p class="section-desc">选择私人助手使用的 AI 供应商和模型。</p>

      <div class="field">
        <label class="field-label">供应商</label>
        <select
          class="field-select"
          :value="s.providerId"
          @change="onMainProviderChange(($event.target as HTMLSelectElement).value)"
        >
          <option value="">请选择供应商</option>
          <option v-for="p in availableProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>

      <div v-if="s.providerId" class="field">
        <label class="field-label">模型</label>
        <select v-model="s.modelId" class="field-select" @change="save">
          <option value="">请选择模型</option>
          <option v-for="m in mainModelOptions" :key="m.id" :value="m.id">{{ m.name || m.id }}</option>
        </select>
      </div>
    </div>

    <!-- ── Title generation ───────────────────────────────────── -->
    <div class="section-card">
      <h2 class="section-title">话题标题生成</h2>
      <p class="section-desc">每轮对话结束后，自动调用指定模型为对话生成一个简短标题。不配置则保持原标题不变。</p>

      <div class="field">
        <label class="field-label">供应商</label>
        <select
          class="field-select"
          :value="s.titleGenProviderId"
          @change="onProviderChange(($event.target as HTMLSelectElement).value)"
        >
          <option value="">不自动生成标题</option>
          <option v-for="p in availableProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>

      <div v-if="s.titleGenProviderId" class="field">
        <label class="field-label">模型</label>
        <select v-model="s.titleGenModelId" class="field-select">
          <option value="">请选择模型</option>
          <option v-for="m in titleGenModelOptions" :key="m.id" :value="m.id">{{ m.name || m.id }}</option>
        </select>
      </div>

      <div v-if="s.titleGenProviderId" class="field">
        <div class="field-label-row">
          <label class="field-label">Prompt 模板</label>
          <button class="reset-btn" @click="resetPrompt">恢复默认</button>
        </div>
        <p class="field-hint">使用 <code>{user}</code> 和 <code>{response}</code> 作为占位符，分别代表用户第一条消息和 AI 的回复。</p>
        <textarea
          v-model="s.titleGenPrompt"
          class="field-textarea"
          rows="5"
          spellcheck="false"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.assistant-settings {
  padding: 28px 32px;
  max-width: 540px;
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
  width: 100%;
  box-sizing: border-box;
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
  width: 100%;
  box-sizing: border-box;
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
</style>
