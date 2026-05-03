<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { Plus, X, ChevronDown } from 'lucide-vue-next'
import { useAssistantSettingsStore, DEFAULT_TITLE_PROMPT } from '../../../stores/assistantSettings'
import { useAiSettingsStore } from '../../../stores/aiSettings'
import { usePapersStore, DEFAULT_ANALYSIS_PROMPT } from '../../../stores/papers'

const s      = useAssistantSettingsStore()
const ai     = useAiSettingsStore()
const papers = usePapersStore()

// ─── Save on blur / enter ─────────────────────────────────────────────────────

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

// ─── ArXiv config ─────────────────────────────────────────────────────────────

const papersOpen = ref(true)

// ArXiv LLM: selected from aiSettings dropdowns
const papersProviderId = ref('')
const papersModelId    = ref('')

const papersModelOptions = computed(() =>
  ai.providers.find(p => p.id === papersProviderId.value)?.models ?? [],
)

function onPapersProviderChange(pid: string) {
  papersProviderId.value = pid
  papersModelId.value    = ai.providers.find(p => p.id === pid)?.models[0]?.id ?? ''
}

function providerTypeToCfgString(type: string): string {
  if (type === 'anthropic') return 'anthropic'
  if (type === 'google')    return 'google'
  if (type === 'ollama')    return 'ollama'
  return 'openai'  // openai + custom are OpenAI-compatible
}

// Local editable copy of remaining PaperConfig fields
const llmMaxTokens  = ref(2000)
const llmTemp       = ref(0.3)
const categories    = ref<string[]>(['cs.AI', 'cs.LG', 'cs.CV', 'cs.CL'])
const maxResults    = ref(50)
const topics        = ref<string[]>(['deep learning', 'LLM'])
const analysisPrompt = ref(DEFAULT_ANALYSIS_PROMPT)
const schedulerEnabled  = ref(false)
const schedulerHour     = ref(9)
const schedulerMinute   = ref(0)
const schedulerTimezone = ref('Asia/Shanghai')
const autoAnalyze       = ref(true)
const relevanceThreshold = ref(5)

const papersConfigLoading = ref(false)
const papersConfigSaving  = ref(false)
const llmSyncing          = ref(false)

async function syncLlmConfig() {
  if (!papersProviderId.value) return
  llmSyncing.value = true
  const provider = ai.providers.find(p => p.id === papersProviderId.value)
  await papers.saveConfig({
    llm_provider: provider ? providerTypeToCfgString(provider.type) : '',
    llm_model:    papersModelId.value,
    llm_api_key:  provider?.apiKey  ?? '',
    llm_base_url: provider?.baseUrl ?? '',
  })
  llmSyncing.value = false
}

const COMMON_TIMEZONES = [
  'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
  'America/New_York', 'America/Los_Angeles', 'America/Chicago',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'UTC',
]

const COMMON_CATEGORIES = [
  'cs.AI', 'cs.LG', 'cs.CV', 'cs.CL', 'cs.RO',
  'cs.NE', 'cs.IR', 'stat.ML',
]

// Tag input helpers
const newCategory = ref('')
const newTopic    = ref('')

function addCategory() {
  const v = newCategory.value.trim()
  if (v && !categories.value.includes(v)) categories.value.push(v)
  newCategory.value = ''
}

function removeCategory(c: string) {
  categories.value = categories.value.filter(x => x !== c)
}

function addTopic() {
  const v = newTopic.value.trim()
  if (v && !topics.value.includes(v)) topics.value.push(v)
  newTopic.value = ''
}

function removeTopic(t: string) {
  topics.value = topics.value.filter(x => x !== t)
}

function toggleCategory(cat: string) {
  if (categories.value.includes(cat)) removeCategory(cat)
  else categories.value.push(cat)
}

// Load config from backend when section opens
async function loadPapersConfig() {
  if (!papers.isConfigured) return
  papersConfigLoading.value = true
  await papers.fetchConfig()
  const cfg = papers.config
  if (cfg) {
    // Match provider by base URL, fall back to first configured provider
    const normalize = (u: string) => u.replace(/\/+$/, '').toLowerCase()
    const matched = cfg.llm_base_url
      ? ai.providers.find(p => p.enabled && p.apiKey && normalize(p.baseUrl) === normalize(cfg.llm_base_url!))
      : undefined
    const provider = matched ?? ai.providers.find(p => p.enabled && p.apiKey && p.models.length > 0)
    if (provider) {
      papersProviderId.value = provider.id
      papersModelId.value    = provider.models.find(m => m.id === cfg.llm_model)?.id ?? provider.models[0]?.id ?? ''
    }
    llmMaxTokens.value     = cfg.llm_max_tokens     ?? 2000
    llmTemp.value          = cfg.llm_temperature    ?? 0.3
    categories.value       = cfg.arxiv_categories   ?? ['cs.AI', 'cs.LG']
    maxResults.value       = cfg.max_results        ?? 50
    topics.value           = cfg.interested_topics  ?? []
    analysisPrompt.value   = cfg.analysis_prompt    ?? DEFAULT_ANALYSIS_PROMPT
    schedulerEnabled.value = cfg.scheduler_enabled  ?? false
    schedulerHour.value    = cfg.scheduler_hour     ?? 9
    schedulerMinute.value  = cfg.scheduler_minute   ?? 0
    schedulerTimezone.value = cfg.scheduler_timezone ?? 'Asia/Shanghai'
    autoAnalyze.value      = cfg.auto_analyze       ?? true
    relevanceThreshold.value = cfg.relevance_threshold ?? 5
  }
  papersConfigLoading.value = false
}

async function savePapersConfig() {
  papersConfigSaving.value = true
  const provider = ai.providers.find(p => p.id === papersProviderId.value)
  await papers.saveConfig({
    llm_provider:       provider ? providerTypeToCfgString(provider.type) : '',
    llm_model:          papersModelId.value,
    llm_api_key:        provider?.apiKey  ?? '',
    llm_base_url:       provider?.baseUrl ?? '',
    llm_max_tokens:     llmMaxTokens.value,
    llm_temperature:    llmTemp.value,
    arxiv_categories:   categories.value,
    max_results:        maxResults.value,
    interested_topics:  topics.value,
    analysis_prompt:    analysisPrompt.value,
    scheduler_enabled:  schedulerEnabled.value,
    scheduler_hour:     schedulerHour.value,
    scheduler_minute:   schedulerMinute.value,
    scheduler_timezone: schedulerTimezone.value,
    auto_analyze:       autoAnalyze.value,
    relevance_threshold: relevanceThreshold.value,
  })
  papersConfigSaving.value = false
}

function resetAnalysisPrompt() {
  analysisPrompt.value = DEFAULT_ANALYSIS_PROMPT
}

onMounted(loadPapersConfig)

watch(() => papersOpen.value, (open) => { if (open) loadPapersConfig() })
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

    <!-- ── 论文推送配置 ──────────────────────────────────── -->
    <div class="section-card papers-section">
      <button class="papers-header" @click="papersOpen = !papersOpen">
        <div class="papers-header-left">
          <span class="papers-dot" />
          <h2 class="section-title" style="margin:0">论文推送配置</h2>
        </div>
        <div class="papers-header-right">
          <span v-if="!papers.isConfigured" class="papers-no-conn">需先在通用设置中配置后端地址</span>
          <ChevronDown :size="14" class="papers-chevron" :class="{ open: papersOpen }" />
        </div>
      </button>

      <div v-if="papersOpen" class="papers-body">
        <div v-if="!papers.isConfigured" class="papers-no-conn-banner">
          请先在「设置 → 通用 → 后端服务器配置」中填写服务地址和 API Key。
        </div>

        <template v-else>
          <div v-if="papersConfigLoading" class="papers-loading">正在从后端加载配置…</div>

          <template v-else>
            <!-- LLM Settings -->
            <div class="papers-group">
              <div class="papers-group-title">AI 分析模型</div>

              <div class="field">
                <label class="field-label">供应商</label>
                <select
                  class="field-select"
                  :value="papersProviderId"
                  @change="onPapersProviderChange(($event.target as HTMLSelectElement).value)"
                >
                  <option value="">请选择供应商</option>
                  <option v-for="p in availableProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </div>

              <div v-if="papersProviderId" class="field">
                <label class="field-label">模型</label>
                <select v-model="papersModelId" class="field-select">
                  <option value="">请选择模型</option>
                  <option v-for="m in papersModelOptions" :key="m.id" :value="m.id">{{ m.name || m.id }}</option>
                </select>
              </div>

              <div v-if="papersProviderId" class="sync-row">
                <p class="field-hint" style="flex:1">选择好供应商和模型后，点击「同步」将 API Key 写入后端数据库。</p>
                <button
                  class="sync-btn"
                  :disabled="llmSyncing || !papersModelId"
                  @click="syncLlmConfig"
                >
                  <span v-if="llmSyncing" class="papers-spin-inline" />
                  {{ llmSyncing ? '同步中…' : '同步 Key 到后端' }}
                </button>
              </div>

              <div class="field-row">
                <div class="field" style="flex:1">
                  <label class="field-label">Max Tokens</label>
                  <input v-model.number="llmMaxTokens" type="number" min="256" max="8192" class="field-input" style="width:100%;box-sizing:border-box" />
                </div>
                <div class="field" style="flex:1">
                  <label class="field-label">Temperature</label>
                  <div class="slider-row">
                    <input v-model.number="llmTemp" type="range" min="0" max="1" step="0.05" class="slider" />
                    <span class="slider-val">{{ llmTemp.toFixed(2) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Crawl Settings -->
            <div class="papers-group">
              <div class="papers-group-title">爬取设置</div>

              <div class="field">
                <label class="field-label">论文分类</label>
                <div class="tag-input-area">
                  <div class="tags-list">
                    <span v-for="cat in categories" :key="cat" class="tag">
                      {{ cat }}
                      <button class="tag-remove" @click="removeCategory(cat)"><X :size="10" /></button>
                    </span>
                  </div>
                  <div class="tag-input-row">
                    <input
                      v-model="newCategory"
                      class="tag-input"
                      placeholder="输入分类后回车…"
                      @keydown.enter.prevent="addCategory"
                    />
                    <button class="tag-add-btn" @click="addCategory"><Plus :size="12" /></button>
                  </div>
                  <div class="tag-presets">
                    <span
                      v-for="cat in COMMON_CATEGORIES"
                      :key="cat"
                      class="tag-preset"
                      :class="{ active: categories.includes(cat) }"
                      @click="toggleCategory(cat)"
                    >{{ cat }}</span>
                  </div>
                </div>
              </div>

              <div class="field">
                <label class="field-label">每次最多条数</label>
                <input v-model.number="maxResults" type="number" min="5" max="500" class="field-input" style="width:90px" />
              </div>
            </div>

            <!-- Topics -->
            <div class="papers-group">
              <div class="papers-group-title">感兴趣的主题</div>
              <div class="field">
                <label class="field-label">主题标签</label>
                <div class="tag-input-area">
                  <div class="tags-list">
                    <span v-for="t in topics" :key="t" class="tag">
                      {{ t }}
                      <button class="tag-remove" @click="removeTopic(t)"><X :size="10" /></button>
                    </span>
                  </div>
                  <div class="tag-input-row">
                    <input
                      v-model="newTopic"
                      class="tag-input"
                      placeholder="例：deep learning…"
                      @keydown.enter.prevent="addTopic"
                    />
                    <button class="tag-add-btn" @click="addTopic"><Plus :size="12" /></button>
                  </div>
                </div>
                <p class="field-hint">AI 分析时将根据这些主题评估论文相关度。</p>
              </div>
            </div>

            <!-- Analysis Prompt -->
            <div class="papers-group">
              <div class="papers-group-title">分析 Prompt</div>
              <div class="field">
                <div class="field-label-row">
                  <label class="field-label">Prompt 模板</label>
                  <button class="reset-btn" @click="resetAnalysisPrompt">恢复默认</button>
                </div>
                <p class="field-hint">支持变量：<code>{topics}</code> <code>{title}</code> <code>{authors}</code> <code>{abstract}</code></p>
                <textarea
                  v-model="analysisPrompt"
                  class="field-textarea"
                  rows="6"
                  spellcheck="false"
                />
              </div>
            </div>

            <!-- Scheduler -->
            <div class="papers-group">
              <div class="papers-group-title">定时推送</div>

              <div class="toggle-field">
                <span class="toggle-label">启用定时爬取</span>
                <button
                  class="toggle-btn"
                  :class="{ active: schedulerEnabled }"
                  @click="schedulerEnabled = !schedulerEnabled"
                >
                  <div class="toggle-thumb" />
                </button>
              </div>

              <template v-if="schedulerEnabled">
                <div class="field-row">
                  <div class="field" style="flex:1">
                    <label class="field-label">小时</label>
                    <input v-model.number="schedulerHour" type="number" min="0" max="23" class="field-input" style="width:70px" />
                  </div>
                  <div class="field" style="flex:1">
                    <label class="field-label">分钟</label>
                    <input v-model.number="schedulerMinute" type="number" min="0" max="59" class="field-input" style="width:70px" />
                  </div>
                  <div class="field" style="flex:2">
                    <label class="field-label">时区</label>
                    <select v-model="schedulerTimezone" class="field-select">
                      <option v-for="tz in COMMON_TIMEZONES" :key="tz" :value="tz">{{ tz }}</option>
                    </select>
                  </div>
                </div>
              </template>

              <div class="toggle-field">
                <span class="toggle-label">爬取后立即分析</span>
                <button
                  class="toggle-btn"
                  :class="{ active: autoAnalyze }"
                  @click="autoAnalyze = !autoAnalyze"
                >
                  <div class="toggle-thumb" />
                </button>
              </div>

              <div class="field">
                <div class="field-label-row">
                  <label class="field-label">相关度阈值</label>
                  <span class="slider-val-badge">{{ relevanceThreshold }}</span>
                </div>
                <div class="slider-row">
                  <span class="slider-end-label">0</span>
                  <input v-model.number="relevanceThreshold" type="range" min="0" max="10" step="1" class="slider" />
                  <span class="slider-end-label">10</span>
                </div>
                <p class="field-hint">低于此分值的论文不会在推送中高亮显示。</p>
              </div>
            </div>

            <!-- Save button -->
            <div class="papers-save-row">
              <button class="papers-save-btn" :disabled="papersConfigSaving" @click="savePapersConfig">
                <span v-if="papersConfigSaving" class="papers-spin-inline" />
                {{ papersConfigSaving ? '保存中…' : '保存论文配置' }}
              </button>
            </div>
          </template>
        </template>
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

.papers-section { padding: 0; gap: 0; overflow: hidden; }

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

.field-row {
  display: flex;
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

.field-hint code {
  font-family: 'SF Mono', 'Menlo', monospace;
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 10.5px;
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

.field-input.wide { width: 100%; box-sizing: border-box; }
.field-input:focus { border-color: rgba(34, 63, 121, 0.4); }

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

.key-row { display: flex; gap: 6px; align-items: center; }
.key-input { flex: 1; width: auto; }

.icon-btn {
  width: 32px; height: 32px;
  border: 1.5px solid rgba(0, 0, 0, 0.10);
  border-radius: 8px; background: white; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: #8e8e93; flex-shrink: 0; transition: border-color 0.15s, color 0.15s;
}
.icon-btn:hover { color: #3c3c43; border-color: rgba(0, 0, 0, 0.2); }

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

/* ── ArXiv section ─────────────────────────────────────────────────────────── */

.papers-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 14px 18px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 14px;
  transition: background 0.12s;
  text-align: left;
}

.papers-header:hover { background: rgba(0, 0, 0, 0.02); }

.papers-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.papers-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, #E4983D, #223F79);
  flex-shrink: 0;
}

.papers-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.papers-no-conn {
  font-size: 11px;
  color: #ff9500;
}

.papers-chevron {
  color: #8e8e93;
  transition: transform 0.18s;
  flex-shrink: 0;
}
.papers-chevron.open { transform: rotate(180deg); }

.papers-body {
  padding: 0 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.papers-no-conn-banner {
  font-size: 12px;
  color: #ff9500;
  background: rgba(255, 149, 0, 0.08);
  border: 1px solid rgba(255, 149, 0, 0.2);
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 12px;
}

.papers-loading {
  font-size: 12px;
  color: #8e8e93;
  padding: 16px 0;
  text-align: center;
}

.papers-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 14px;
}

.papers-group + .papers-group {
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}

.papers-group-title {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* ── Tag input ──────────────────────────────────────────────────────────────── */

.tag-input-area {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: white;
  border: 1.5px solid rgba(0, 0, 0, 0.10);
  border-radius: 8px;
  padding: 8px 10px;
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(34, 63, 121, 0.08);
  color: #223F79;
  border-radius: 6px;
  padding: 2px 7px 2px 8px;
  font-size: 11.5px;
  font-weight: 500;
}

.tag-remove {
  display: flex; align-items: center; justify-content: center;
  width: 14px; height: 14px;
  background: none; border: none; cursor: pointer;
  color: rgba(34, 63, 121, 0.5);
  border-radius: 3px;
  transition: color 0.1s;
}
.tag-remove:hover { color: #223F79; }

.tag-input-row {
  display: flex;
  gap: 5px;
  align-items: center;
}

.tag-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 12px;
  color: #1c1c1e;
  background: transparent;
  font-family: inherit;
}

.tag-input::placeholder { color: #aeaeb2; }

.tag-add-btn {
  width: 22px; height: 22px;
  border: 1.5px solid rgba(34, 63, 121, 0.2);
  border-radius: 6px;
  background: transparent;
  color: #223F79;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  transition: background 0.1s;
}
.tag-add-btn:hover { background: rgba(34, 63, 121, 0.08); }

.tag-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}

.tag-preset {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.04);
  color: #6e6e73;
  cursor: pointer;
  transition: all 0.1s;
}
.tag-preset:hover { background: rgba(34, 63, 121, 0.07); color: #223F79; }
.tag-preset.active { background: rgba(34, 63, 121, 0.12); color: #223F79; font-weight: 500; }

/* ── Slider ─────────────────────────────────────────────────────────────────── */

.slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
}

.slider-end-label {
  font-size: 11px;
  color: #aeaeb2;
  width: 12px;
  text-align: center;
  flex-shrink: 0;
}

.slider {
  flex: 1;
  accent-color: #223F79;
  height: 4px;
  cursor: pointer;
}

.slider-val { font-size: 12px; color: #3c3c43; min-width: 28px; text-align: right; }
.slider-val-badge {
  font-size: 12px;
  font-weight: 600;
  color: #223F79;
  background: rgba(34, 63, 121, 0.08);
  padding: 1px 8px;
  border-radius: 6px;
}

/* ── Toggle ─────────────────────────────────────────────────────────────────── */

.toggle-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toggle-label { font-size: 12px; color: #3c3c43; }

.toggle-btn {
  width: 40px; height: 24px;
  border-radius: 12px;
  border: none;
  background: rgba(0,0,0,0.12);
  cursor: pointer;
  padding: 2px;
  display: flex; align-items: center;
  flex-shrink: 0;
  transition: background 0.2s;
}
.toggle-btn.active { background: #223F79; justify-content: flex-end; }
.toggle-thumb {
  width: 18px; height: 18px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

/* ── Save button ─────────────────────────────────────────────────────────────── */

.papers-save-row {
  padding-top: 4px;
  display: flex;
  justify-content: flex-end;
}

.papers-save-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 20px;
  border-radius: 10px;
  border: none;
  background: #223F79;
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.12s;
}
.papers-save-btn:hover:not(:disabled) { opacity: 0.88; }
.papers-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.sync-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(34, 63, 121, 0.04);
  border: 1px solid rgba(34, 63, 121, 0.10);
  border-radius: 8px;
  padding: 8px 12px;
}

.sync-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: rgba(34, 63, 121, 0.12);
  color: #223F79;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.12s;
}
.sync-btn:hover:not(:disabled) { background: rgba(34, 63, 121, 0.20); }
.sync-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.papers-spin-inline {
  display: inline-block;
  width: 12px; height: 12px;
  border: 1.5px solid rgba(255,255,255,0.4);
  border-top-color: white;
  border-radius: 50%;
  animation: papers-rotate 0.7s linear infinite;
}

@keyframes papers-rotate { to { transform: rotate(360deg); } }
</style>
