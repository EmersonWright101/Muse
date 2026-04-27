<script setup lang="ts">
import { ref, watch } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'
import { useWebSearchStore } from '../../../stores/webSearch'
import { listWebSearchProviders } from '../../../services/webSearch'

const store = useWebSearchStore()

const providers = listWebSearchProviders()

// ─── API key display per provider ─────────────────────────────────────────────
const apiKeyInputs  = ref<Record<string, string>>({})
const apiKeyVisible = ref<Record<string, boolean>>({})
const savedStatus   = ref<Record<string, boolean>>({})

// Load decrypted keys into inputs on mount
for (const { id } of providers) {
  apiKeyVisible.value[id] = false
  apiKeyInputs.value[id]  = ''
  if (store.hasApiKey(id)) {
    store.getApiKey(id).then(k => { apiKeyInputs.value[id] = k })
  }
}

function toggleVisible(id: string) {
  apiKeyVisible.value[id] = !apiKeyVisible.value[id]
}

async function saveApiKey(id: string) {
  await store.setApiKey(id, apiKeyInputs.value[id]?.trim() ?? '')
  savedStatus.value[id] = true
  setTimeout(() => { savedStatus.value[id] = false }, 1500)
}

// Auto-save when the api key input loses focus
function onKeyBlur(id: string) {
  saveApiKey(id)
}

// Sync number-of-results back to store
const localNumResults = ref<Record<string, number>>({})
for (const { id } of providers) {
  localNumResults.value[id] = store.getNumResults(id)
}
watch(localNumResults, (v) => {
  for (const { id } of providers) {
    store.setNumResults(id, v[id])
  }
}, { deep: true })
</script>

<template>
  <div class="ws-settings">
    <h1 class="page-title">联网搜索</h1>

    <!-- Global toggle -->
    <div class="section-card">
      <div class="field-row">
        <div>
          <div class="field-label">启用联网搜索</div>
          <p class="field-hint">在对话中联网搜索最新信息，搜索结果将作为上下文发送给 AI。</p>
        </div>
        <button
          class="toggle-btn"
          :class="{ on: store.enabled }"
          @click="store.enabled = !store.enabled"
        >
          <span class="toggle-knob" />
        </button>
      </div>
    </div>

    <!-- Provider config cards -->
    <div
      v-for="{ id, name } in providers"
      :key="id"
      class="section-card"
    >
      <h2 class="section-title">{{ name }}</h2>

      <!-- API Key -->
      <div class="field">
        <label class="field-label">API Key</label>
        <div class="key-row">
          <input
            v-model="apiKeyInputs[id]"
            :type="apiKeyVisible[id] ? 'text' : 'password'"
            class="field-input key-input"
            placeholder="粘贴你的 API Key…"
            spellcheck="false"
            autocomplete="off"
            @blur="onKeyBlur(id)"
            @keydown.enter.prevent="saveApiKey(id)"
          />
          <button class="icon-btn" :title="apiKeyVisible[id] ? '隐藏' : '显示'" @click="toggleVisible(id)">
            <EyeOff v-if="apiKeyVisible[id]" :size="14" />
            <Eye v-else :size="14" />
          </button>
          <button
            class="save-btn"
            :class="{ saved: savedStatus[id] }"
            @click="saveApiKey(id)"
          >
            {{ savedStatus[id] ? '已保存' : '保存' }}
          </button>
        </div>
        <p class="field-hint">
          在
          <a href="https://dashboard.exa.ai/api-keys" target="_blank" class="link">dashboard.exa.ai</a>
          获取 API Key。
        </p>
      </div>

      <!-- Number of results -->
      <div class="field">
        <div class="field-label-row">
          <label class="field-label">搜索结果数量</label>
          <span class="param-value">{{ localNumResults[id] }}</span>
        </div>
        <input
          v-model.number="localNumResults[id]"
          type="range"
          min="1" max="10" step="1"
          class="field-range"
        />
        <div class="range-labels"><span>1</span><span>5</span><span>10</span></div>
      </div>

      <!-- Exa-specific: search type -->
      <div v-if="id === 'exa'" class="field">
        <label class="field-label">搜索模式</label>
        <p class="field-hint">auto 自动平衡速度与质量；fast 更快；deep 更深度但耗时较长。</p>
        <div class="seg-group">
          <button
            v-for="t in (['auto', 'fast', 'deep'] as const)"
            :key="t"
            class="seg-btn"
            :class="{ active: store.exaSearchType === t }"
            @click="store.exaSearchType = t"
          >{{ t }}</button>
        </div>
      </div>

      <!-- Monthly usage counter -->
      <div class="field usage-row">
        <div class="usage-label">
          <span>本月已使用</span>
          <span class="usage-count" :class="{ warning: store.getMonthlyUsage(id) >= 900 }">
            {{ store.getMonthlyUsage(id) }} / 1000
          </span>
        </div>
        <div class="usage-bar-bg">
          <div
            class="usage-bar-fill"
            :class="{ warning: store.getMonthlyUsage(id) >= 900 }"
            :style="{ width: Math.min(store.getMonthlyUsage(id) / 1000 * 100, 100) + '%' }"
          />
        </div>
        <p class="field-hint">免费额度每月自动重置（本地计数）</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ws-settings {
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

.field { display: flex; flex-direction: column; gap: 6px; }

.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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

.link { color: #223F79; text-decoration: none; }
.link:hover { text-decoration: underline; }

.key-row { display: flex; gap: 6px; align-items: center; }

.field-input {
  height: 32px;
  border: 1.5px solid rgba(0, 0, 0, 0.10);
  border-radius: 8px;
  padding: 0 10px;
  font-size: 13px;
  color: #1c1c1e;
  background: white;
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}
.field-input:focus { border-color: rgba(34, 63, 121, 0.4); }
.key-input { flex: 1; }

.icon-btn {
  width: 32px; height: 32px;
  border: 1.5px solid rgba(0, 0, 0, 0.10);
  border-radius: 8px;
  background: white;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: #8e8e93;
  flex-shrink: 0;
  transition: border-color 0.15s, color 0.15s;
}
.icon-btn:hover { color: #3c3c43; border-color: rgba(0, 0, 0, 0.2); }

.save-btn {
  height: 32px;
  padding: 0 12px;
  border: 1.5px solid rgba(34, 63, 121, 0.3);
  border-radius: 8px;
  background: white;
  color: #223F79;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.save-btn:hover { background: rgba(34, 63, 121, 0.06); }
.save-btn.saved { background: #22c55e; color: white; border-color: #22c55e; }

/* Toggle */
.toggle-btn {
  width: 36px; height: 20px;
  border-radius: 10px;
  border: none;
  background: #d1d1d6;
  cursor: pointer;
  padding: 0;
  position: relative;
  flex-shrink: 0;
  transition: background 0.2s;
}
.toggle-btn.on { background: #22c55e; }
.toggle-knob {
  position: absolute;
  top: 2px; left: 2px;
  width: 16px; height: 16px;
  background: white;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
  transition: transform 0.2s;
}
.toggle-btn.on .toggle-knob { transform: translateX(16px); }

/* Segmented control */
.seg-group { display: flex; gap: 4px; }
.seg-btn {
  height: 28px;
  padding: 0 12px;
  border: 1.5px solid rgba(0, 0, 0, 0.10);
  border-radius: 8px;
  background: white;
  color: #3c3c43;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.seg-btn:hover { background: rgba(0,0,0,0.04); }
.seg-btn.active { background: rgba(34, 63, 121, 0.1); border-color: rgba(34, 63, 121, 0.3); color: #223F79; font-weight: 500; }

/* Usage counter */
.usage-row { gap: 8px; }

.usage-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #3c3c43;
}

.usage-count {
  font-size: 12px;
  font-weight: 600;
  color: #223F79;
}
.usage-count.warning { color: #f59e0b; }

.usage-bar-bg {
  height: 4px;
  background: rgba(0, 0, 0, 0.07);
  border-radius: 2px;
  overflow: hidden;
}

.usage-bar-fill {
  height: 100%;
  background: #223F79;
  border-radius: 2px;
  transition: width 0.3s ease;
}
.usage-bar-fill.warning { background: #f59e0b; }

/* Range */
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

.param-value {
  font-size: 12px;
  font-weight: 600;
  color: #223F79;
  font-variant-numeric: tabular-nums;
}
</style>
