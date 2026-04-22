<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Eye, EyeOff, Plus, Trash2, Check, X, ChevronRight, RefreshCw, Search, SlidersHorizontal, Pencil } from 'lucide-vue-next'
import { useAiSettingsStore, inferModelCaps, type AIProvider } from '../../../stores/aiSettings'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import openrouterLogoUrl from '../../../assets/providers/openrouter.svg'

const ai = useAiSettingsStore()

// ─── Selected provider in left panel ─────────────────────────────────────────

const selectedId = ref(ai.providers[0]?.id ?? '')
const selected   = computed(() => ai.providers.find(p => p.id === selectedId.value) ?? null)

watch(() => ai.providers.length, () => {
  if (!ai.providers.find(p => p.id === selectedId.value)) {
    selectedId.value = ai.providers[0]?.id ?? ''
  }
})

// ─── Add provider form ────────────────────────────────────────────────────────

const showAddForm = ref(false)
const newProvName = ref('')
const addInputRef  = ref<HTMLInputElement | null>(null)

function confirmAddProvider() {
  const name = (addInputRef.value?.value ?? newProvName.value).trim()
  if (!name) return
  const id = `provider_${Date.now()}`
  const newP: AIProvider = {
    id,
    type:            'custom',
    name,
    apiKey:          '',
    baseUrl:         '',
    models:          [{ id: 'default', name: '默认模型' }],
    enabled:         false,
    selectedModelId: 'default',
    builtIn:         false,
  }
  ai.providers.push(newP)
  selectedId.value  = id
  showAddForm.value = false
  newProvName.value = ''
}

function cancelAddProvider() {
  showAddForm.value = false
  newProvName.value = ''
}

// ─── Delete provider ──────────────────────────────────────────────────────────

const confirmDelete = ref(false)

function handleDelete() {
  if (!selected.value) return
  confirmDelete.value = true
}

function doDelete() {
  if (!selected.value) return
  const id     = selected.value.id
  const nextId = ai.providers.find(p => p.id !== id)?.id ?? ''
  selectedId.value    = nextId
  confirmDelete.value = false
  const idx = ai.providers.findIndex(p => p.id === id)
  if (idx !== -1) ai.providers.splice(idx, 1)
}

function cancelDelete() {
  confirmDelete.value = false
}

watch(selectedId, () => { confirmDelete.value = false })

// ─── Detail panel editing ─────────────────────────────────────────────────────

const showKey  = ref(false)
const editMode = ref(false)
const editKey  = ref('')
const editName = ref('')

function startEdit() {
  if (!selected.value) return
  editMode.value = true
  editKey.value  = selected.value.apiKey
  editName.value = selected.value.name
  showKey.value  = false
}

function cancelEdit() {
  editMode.value = false
}

function saveEdit() {
  if (!selected.value) return
  const patch: Partial<Pick<AIProvider, 'apiKey' | 'baseUrl' | 'name'>> = {
    apiKey: editKey.value,
  }
  if (!selected.value.builtIn) patch.name = editName.value
  ai.updateProvider(selected.value.id, patch)
  editMode.value = false
}

watch(selectedId, () => { editMode.value = false; showKey.value = false })

// ─── Model management ─────────────────────────────────────────────────────────

const showAddModel  = ref(false)
const newModelId    = ref('')
const newModelName  = ref('')

function startAddModel() {
  showAddModel.value = true
  newModelId.value   = ''
  newModelName.value = ''
}

function confirmAddModel() {
  if (!selected.value) return
  const id   = newModelId.value.trim()
  const name = newModelName.value.trim()
  if (!id) return
  ai.addCustomModel(selected.value.id, { id, name: name || id })
  showAddModel.value = false
}

function cancelAddModel() {
  showAddModel.value = false
}

watch(selectedId, () => { showAddModel.value = false; fetchModelError.value = '' })

// ─── Inline model editing ─────────────────────────────────────────────────────

import type { AIModel } from '../../../stores/aiSettings'

const editingModelId = ref<string | null>(null)
const editDraft = ref<Partial<AIModel>>({})

function startEditModel(m: AIModel) {
  editingModelId.value = m.id
  editDraft.value = {
    reasoning: m.reasoning ?? false,
    multimodal: m.multimodal ?? false,
    imageOutput: m.imageOutput ?? false,
    audio: m.audio ?? false,
    video: m.video ?? false,
    inputPrice: m.inputPrice ?? undefined,
    outputPrice: m.outputPrice ?? undefined,
    priceCurrency: m.priceCurrency ?? 'usd',
    contextLength: m.contextLength ?? undefined,
  }
}

function saveEditModel(m: AIModel) {
  if (!selected.value) return
  const model = selected.value.models.find(x => x.id === m.id)
  if (!model) return
  Object.assign(model, editDraft.value)
  ai.persist()
  editingModelId.value = null
}

function cancelEditModel() {
  editingModelId.value = null
  editDraft.value = {}
}

// ─── Connection test & model fetch ───────────────────────────────────────────

type ConnStatus = 'idle' | 'testing' | 'ok' | 'error'
const connStatus  = ref<Record<string, ConnStatus>>({})
const connMessage = ref<Record<string, string>>({})

function getConn(id: string): ConnStatus { return connStatus.value[id] ?? 'idle' }

const CONN_OK_KEY = 'muse-ai-conn-ok'
function persistConnOk(id: string) {
  try {
    const prev: string[] = JSON.parse(localStorage.getItem(CONN_OK_KEY) ?? '[]')
    if (!prev.includes(id)) localStorage.setItem(CONN_OK_KEY, JSON.stringify([...prev, id]))
  } catch { /* ignore */ }
}
;(() => {
  try {
    const ids: string[] = JSON.parse(localStorage.getItem(CONN_OK_KEY) ?? '[]')
    for (const id of ids) connStatus.value[id] = 'ok'
  } catch { /* ignore */ }
})()

async function testConnection() {
  if (!selected.value) return
  const { id, type, apiKey, baseUrl } = selected.value
  if (!baseUrl) { connStatus.value[id] = 'error'; connMessage.value[id] = '请先配置 API 地址'; return }
  connStatus.value[id]  = 'testing'
  connMessage.value[id] = ''
  try {
    let list: unknown[]
    if (type === 'ollama') {
      // Ollama uses /api/tags and needs no API key
      const resp = await tauriFetch(`${baseUrl}/api/tags`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      list = data.models ?? []
    } else {
      if (!apiKey) { connStatus.value[id] = 'error'; connMessage.value[id] = '请先配置 API 密钥'; return }
      const resp = await tauriFetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      list = data.data ?? data.models ?? []
    }
    connStatus.value[id]  = 'ok'
    connMessage.value[id] = `连接成功，获取到 ${list.length} 个模型`
    persistConnOk(id)
    setTimeout(() => { connMessage.value[id] = '' }, 3000)
  } catch (e: unknown) {
    connStatus.value[id]  = 'error'
    connMessage.value[id] = e instanceof Error ? e.message : String(e)
  }
}

const fetchingModels  = ref(false)
const fetchModelError = ref('')

// ─── Model picker ─────────────────────────────────────────────────────────────

interface PickerModel {
  id:            string
  name?:         string
  context_length?: number
  architecture?: { modality?: string }
  pricing?:      { prompt?: string | number }
}

interface PickerCaps {
  reasoning:   boolean
  vision:      boolean
  imageOutput: boolean
  video:       boolean
  embedding:   boolean
  reranking:   boolean
}

function getPickerCaps(m: PickerModel): PickerCaps {
  const inferred = inferModelCaps(m.id, m.architecture?.modality)
  const id  = m.id.toLowerCase()
  const mod = (m.architecture?.modality ?? '').toLowerCase()
  return {
    reasoning:   inferred.reasoning   ?? false,
    vision:      inferred.multimodal  ?? false,
    imageOutput: inferred.imageOutput ?? false,
    video:       inferred.video       ?? false,
    embedding:   mod.includes('embed') || /embed/.test(id),
    reranking:   /rerank/.test(id),
  }
}

const showModelPicker = ref(false)
const pickerModels    = ref<PickerModel[]>([])
const pickerSearch    = ref('')
const pickerSelected  = ref<Set<string>>(new Set())
const pickerTab       = ref<'all' | 'reasoning' | 'vision' | 'imageOutput' | 'video' | 'embedding' | 'reranking'>('all')

// Group OpenRouter-style "provider/model-name" by their prefix
const pickerGroups = computed(() => {
  const search = pickerSearch.value.toLowerCase().trim()
  let list = search
    ? pickerModels.value.filter(m =>
        m.id.toLowerCase().includes(search) ||
        (m.name ?? '').toLowerCase().includes(search))
    : pickerModels.value

  if (pickerTab.value !== 'all') {
    const tab = pickerTab.value
    list = list.filter(m => getPickerCaps(m)[tab])
  }

  // Group by prefix (e.g. "openai" from "openai/gpt-4o"), or "其他" if no slash
  const groups = new Map<string, PickerModel[]>()
  for (const m of list) {
    const slash = m.id.indexOf('/')
    const group = slash > 0 ? m.id.slice(0, slash) : '其他'
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(m)
  }
  return [...groups.entries()].map(([name, models]) => ({ name, models }))
})

const pickerTabs = computed(() => {
  const counts = {
    all:         pickerModels.value.length,
    reasoning:   pickerModels.value.filter(m => getPickerCaps(m).reasoning).length,
    vision:      pickerModels.value.filter(m => getPickerCaps(m).vision).length,
    imageOutput: pickerModels.value.filter(m => getPickerCaps(m).imageOutput).length,
    video:       pickerModels.value.filter(m => getPickerCaps(m).video).length,
    embedding:   pickerModels.value.filter(m => getPickerCaps(m).embedding).length,
    reranking:   pickerModels.value.filter(m => getPickerCaps(m).reranking).length,
  }
  return [
    { id: 'all'         as const, label: '全部', count: counts.all },
    { id: 'reasoning'   as const, label: '推理', count: counts.reasoning },
    { id: 'vision'      as const, label: '视觉', count: counts.vision },
    { id: 'imageOutput' as const, label: '图像', count: counts.imageOutput },
    { id: 'video'       as const, label: '视频', count: counts.video },
    { id: 'embedding'   as const, label: '嵌入', count: counts.embedding },
    { id: 'reranking'   as const, label: '重排', count: counts.reranking },
  ].filter(t => t.id === 'all' || t.count > 0)
})

function closeModelPicker() {
  showModelPicker.value = false
  pickerSearch.value    = ''
  pickerTab.value       = 'all'
}

function togglePickerModel(id: string) {
  if (pickerSelected.value.has(id)) pickerSelected.value.delete(id)
  else pickerSelected.value.add(id)
}

function confirmPickerSelection() {
  if (!selected.value) return
  const prov = selected.value
  const fetchedIds = new Set(pickerModels.value.map(m => m.id))
  for (const m of pickerModels.value) {
    if (pickerSelected.value.has(m.id) && !prov.models.find(x => x.id === m.id)) {
      const caps = inferModelCaps(m.id, m.architecture?.modality)
      ai.addCustomModel(prov.id, {
        id:            m.id,
        name:          m.name || m.id,
        contextLength: m.context_length,
        ...caps,
      })
    }
  }
  for (const m of [...prov.models]) {
    if (fetchedIds.has(m.id) && !pickerSelected.value.has(m.id)) {
      ai.removeCustomModel(prov.id, m.id)
    }
  }
  closeModelPicker()
}

async function fetchModels() {
  if (!selected.value) return
  const { type, apiKey, baseUrl } = selected.value
  if (!baseUrl) { fetchModelError.value = '需要先配置 API 地址'; return }
  fetchingModels.value  = true
  fetchModelError.value = ''
  try {
    let list: PickerModel[]
    if (type === 'ollama') {
      // Ollama: GET /api/tags, no auth, response { models: [{ name, model, size, ... }] }
      const resp = await tauriFetch(`${baseUrl}/api/tags`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      list = (data.models ?? []).map((m: { name?: string; model?: string }) => ({
        id:   m.name ?? m.model ?? '',
        name: m.name ?? m.model ?? '',
      }))
    } else {
      if (!apiKey) { fetchModelError.value = '需要先配置 API 密钥'; return }
      const resp = await tauriFetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      list = data.data ?? data.models ?? []
    }
    if (list.length === 0) { fetchModelError.value = '未返回任何模型'; return }
    pickerModels.value   = list
    pickerSelected.value = new Set(list.filter(m => selected.value!.models.find(x => x.id === m.id)).map(m => m.id))
    pickerSearch.value   = ''
    pickerTab.value      = 'all'
    showModelPicker.value = true
  } catch (e: unknown) {
    fetchModelError.value = `获取失败: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    fetchingModels.value = false
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function maskKey(key: string) {
  if (!key) return ''
  if (key.length <= 8) return '•'.repeat(key.length)
  return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 7, 20)) + key.slice(-3)
}

const BUILT_IN_COLORS: Record<string, string> = {
  openai:    '#10a37f',
  anthropic: '#d4890a',
  google:    '#4285f4',
  custom:    '#8e8e93',
}
const PALETTE = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#BB8FCE', '#85C1E9', '#F39C12', '#27AE60']

function providerColor(id: string): string {
  if (BUILT_IN_COLORS[id]) return BUILT_IN_COLORS[id]
  let hash = 0
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) & 0xFFFF
  return PALETTE[hash % PALETTE.length]
}

function providerInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase()
}

function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function isOpenRouter(p: AIProvider | null): boolean {
  return !!(p && (p.id === 'openrouter' || (p.baseUrl && p.baseUrl.includes('openrouter.ai'))))
}

// Sub-provider initial for OpenRouter models (e.g. "openai" from "openai/gpt-4o")
function subProviderInitial(modelId: string): string {
  const slash = modelId.indexOf('/')
  return slash > 0 ? modelId.slice(0, slash).charAt(0).toUpperCase() : modelId.charAt(0).toUpperCase()
}

// Provider SVG logos — auto-discovered from assets/providers/
const providerSvgModules = import.meta.glob<{ default: string }>('/src/assets/providers/*.svg', { eager: true })

function getProviderLogoUrl(p: AIProvider): string | null {
  const svgMap: Record<string, string> = {}
  for (const [path, mod] of Object.entries(providerSvgModules)) {
    const name = path.replace(/^.*\//, '').replace(/\.svg$/, '')
    svgMap[name] = mod.default
  }
  // Direct id match (built-in providers: openai, anthropic, google)
  // anthropic maps to claude.svg, google maps to gemini.svg
  const idAliases: Record<string, string> = { anthropic: 'claude', google: 'gemini' }
  const idKey = idAliases[p.id] ?? p.id
  if (svgMap[idKey]) return svgMap[idKey]
  // Explicit keyword aliases not derivable from filename
  const hay = (p.name + ' ' + p.baseUrl).toLowerCase()
  if (hay.includes('dgx') || hay.includes('nvidia')) return svgMap['nvidia'] ?? null
  for (const [name, url] of Object.entries(svgMap)) {
    if (hay.includes(name)) return url
  }
  return null
}

// Model SVG logos — auto-discovered; adding a new <name>.svg to assets/models/ is enough
const modelSvgModules = import.meta.glob<{ default: string }>('/src/assets/models/*.svg', { eager: true })

function getModelLogoUrl(modelId: string, providerId = ''): string | null {
  const mid = modelId.toLowerCase()
  const pid = providerId.toLowerCase()
  const svgMap: Record<string, string> = {}
  for (const [path, mod] of Object.entries(modelSvgModules)) {
    const name = path.replace(/^.*\//, '').replace(/\.svg$/, '')
    svgMap[name] = mod.default
  }
  for (const name of Object.keys(svgMap)) {
    if (mid.includes(name)) return svgMap[name]
  }
  for (const name of Object.keys(svgMap)) {
    if (pid.includes(name)) return svgMap[name]
  }
  return null
}
</script>

<template>
  <div class="ai-settings">
    <!-- ── Left: provider list ── -->
    <div class="provider-list-panel">
      <div class="list-header">
        <span class="list-title">AI 服务商</span>
      </div>

      <div class="provider-list">
        <button
          v-for="p in ai.providers"
          :key="p.id"
          class="provider-row"
          :class="{ selected: selectedId === p.id }"
          @click="selectedId = p.id"
        >
          <img
            v-if="getProviderLogoUrl(p)"
            :src="getProviderLogoUrl(p)!"
            class="p-logo-img"
            :alt="p.name"
          />
          <span
            v-else
            class="p-dot"
            :style="{ background: providerColor(p.id) }"
          >{{ providerInitial(p.name) }}</span>
          <span class="p-name">{{ p.name }}</span>
          <span class="p-status" :class="getConn(p.id) === 'error' ? 'err' : p.enabled ? 'on' : 'off'">
            {{ getConn(p.id) === 'error' ? 'ERR' : p.enabled ? 'ON' : 'OFF' }}
          </span>
          <ChevronRight :size="12" class="p-chevron" />
        </button>
      </div>

      <!-- Add provider form -->
      <div v-if="showAddForm" class="add-form">
        <input
          ref="addInputRef"
          :value="newProvName"
          class="add-input"
          placeholder="服务商名称"
          @input="newProvName = ($event.target as HTMLInputElement).value"
          @keydown.enter="confirmAddProvider"
          @keydown.esc="cancelAddProvider"
          autofocus
        />
        <div class="add-form-actions">
          <button class="btn-primary sm" @click="confirmAddProvider">确认</button>
          <button class="btn-ghost sm"   @click="cancelAddProvider">取消</button>
        </div>
      </div>

      <button v-if="!showAddForm" class="add-provider-btn" @click="showAddForm = true">
        <Plus :size="13" />
        添加服务商
      </button>
    </div>

    <!-- ── Right: provider detail ── -->
    <div class="detail-panel">
      <template v-if="selected">
        <!-- Header -->
        <div class="detail-header">
          <div class="detail-title-row">
            <img
              v-if="getProviderLogoUrl(selected)"
              :src="getProviderLogoUrl(selected)!"
              class="detail-logo-img"
              :alt="selected.name"
            />
            <span
              v-else
              class="detail-dot"
              :style="{ background: providerColor(selected.id) }"
            >{{ providerInitial(selected.name) }}</span>
            <h2 class="detail-name">{{ selected.name }}</h2>
          </div>
          <div class="detail-header-actions">
            <button
              class="test-btn"
              :class="getConn(selected.id)"
              :disabled="getConn(selected.id) === 'testing'"
              @click="testConnection"
            >
              <RefreshCw :size="12" :class="{ spin: getConn(selected.id) === 'testing' }" />
              {{ getConn(selected.id) === 'testing' ? '测试中…' : '测试连接' }}
            </button>
            <label
              class="toggle-switch"
              :class="{ 'toggle-locked': getConn(selected.id) !== 'ok' }"
              :title="getConn(selected.id) !== 'ok' ? '请先测试连接' : selected.enabled ? '已启用' : '已禁用'"
            >
              <input
                type="checkbox"
                :checked="selected.enabled"
                :disabled="getConn(selected.id) !== 'ok'"
                @change="ai.updateProvider(selected.id, { enabled: !selected.enabled })"
              />
              <span class="toggle-track"><span class="toggle-thumb" /></span>
            </label>
            <button class="delete-btn" title="删除服务商" @click="handleDelete">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <div v-if="confirmDelete" class="delete-confirm-banner">
          <span class="delete-confirm-label">确认删除「{{ selected.name }}」？</span>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="delete-confirm-yes" @click="doDelete">删除</button>
            <button class="delete-confirm-no"  @click="cancelDelete">取消</button>
          </div>
        </div>

        <div v-if="connMessage[selected.id]" class="conn-msg" :class="getConn(selected.id)">
          {{ connMessage[selected.id] }}
        </div>

        <!-- API Key -->
        <div class="detail-section">
          <div class="section-label">API 密钥</div>
          <template v-if="!editMode">
            <div class="key-display-row">
              <span class="key-mono">{{ selected.apiKey ? maskKey(selected.apiKey) : '未配置' }}</span>
              <button class="btn-small" @click="startEdit">{{ selected.apiKey ? '修改' : '添加' }}</button>
            </div>
          </template>
          <template v-else>
            <div class="edit-field">
              <div v-if="!selected.builtIn" style="margin-bottom:8px">
                <div class="field-label-sm">服务商名称</div>
                <input v-model="editName" class="text-input" placeholder="服务商名称" />
              </div>
              <div class="field-label-sm">API 密钥</div>
              <div class="key-input-row">
                <input
                  v-model="editKey"
                  :type="showKey ? 'text' : 'password'"
                  class="text-input mono"
                  placeholder="输入 API Key"
                  autocomplete="off"
                />
                <button class="eye-btn" @click="showKey = !showKey">
                  <EyeOff v-if="showKey" :size="14" />
                  <Eye v-else :size="14" />
                </button>
              </div>
              <div class="edit-actions">
                <button class="btn-primary" @click="saveEdit"><Check :size="12" /> 保存</button>
                <button class="btn-ghost" @click="cancelEdit"><X :size="12" /> 取消</button>
              </div>
            </div>
          </template>
        </div>

        <!-- Base URL -->
        <div class="detail-section">
          <div class="section-label">API 地址</div>
          <input
            class="text-input url-input"
            :value="selected.baseUrl"
            placeholder="https://api.example.com/v1"
            @change="ai.updateProvider(selected.id, { baseUrl: ($event.target as HTMLInputElement).value.trim() })"
          />
        </div>

        <!-- Provider Type (non-built-in only) -->
        <div v-if="!selected.builtIn" class="detail-section">
          <div class="section-label">服务类型</div>
          <select
            class="text-input"
            :value="selected.type"
            @change="ai.updateProvider(selected.id, { type: ($event.target as HTMLSelectElement).value as AIProvider['type'] })"
          >
            <option value="custom">OpenAI 兼容</option>
            <option value="ollama">Ollama</option>
          </select>
        </div>

        <!-- Models section -->
        <div class="detail-section">
          <div class="models-header">
            <div class="models-header-left">
              <span class="section-label" style="margin-bottom:0">模型</span>
              <span class="model-count-badge">{{ selected.models.length }}</span>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn-small" :disabled="fetchingModels" @click="fetchModels">
                <RefreshCw :size="11" :class="{ spin: fetchingModels }" />
                {{ fetchingModels ? '获取中…' : '获取模型列表' }}
              </button>
              <button class="btn-small" @click="startAddModel">
                <Plus :size="11" /> 手动添加
              </button>
            </div>
          </div>
          <div v-if="fetchModelError" class="fetch-error">{{ fetchModelError }}</div>

          <!-- Add model form -->
          <div v-if="showAddModel" class="add-model-form">
            <input
              v-model="newModelId"
              class="text-input"
              placeholder="Model ID (如 gpt-4o)"
              @keydown.enter="confirmAddModel"
              @keydown.esc="cancelAddModel"
            />
            <input
              v-model="newModelName"
              class="text-input"
              placeholder="显示名称 (可选)"
              @keydown.enter="confirmAddModel"
              @keydown.esc="cancelAddModel"
            />
            <div class="edit-actions">
              <button class="btn-primary sm" @click="confirmAddModel">确认</button>
              <button class="btn-ghost sm" @click="cancelAddModel">取消</button>
            </div>
          </div>

          <!-- Cherry Studio-style model table -->
          <div class="model-table">
            <div
              v-for="m in selected.models"
              :key="m.id"
              class="model-row-wrap"
              :class="{ 'model-row-default': selected.selectedModelId === m.id }"
            >
              <!-- Normal row -->
              <div class="model-row">
                <!-- Model logo if SVG exists, otherwise color dot with letter -->
                <div
                  class="model-row-icon"
                  :style="getModelLogoUrl(m.id, selected.id) ? {} : { background: isOpenRouter(selected) ? providerColor(m.id.split('/')[0] ?? m.id) : providerColor(selected.id) }"
                >
                  <img
                    v-if="getModelLogoUrl(m.id, selected.id)"
                    :src="getModelLogoUrl(m.id, selected.id)!"
                    class="model-row-logo"
                    alt=""
                  />
                  <template v-else>
                    {{ isOpenRouter(selected) ? subProviderInitial(m.id) : providerInitial(selected.name) }}
                  </template>
                </div>

                <div class="model-row-info">
                  <div class="model-row-name-line">
                    <span class="model-row-name">{{ m.name || m.id }}</span>
                    <span v-if="m.reasoning"   class="m-badge reasoning">推理</span>
                    <span v-if="m.multimodal"  class="m-badge vision">视觉</span>
                    <span v-if="m.imageOutput" class="m-badge image">图像</span>
                    <span v-if="m.audio"       class="m-badge audio">音频</span>
                    <span v-if="m.video"       class="m-badge video">视频</span>
                    <span v-if="m.contextLength" class="m-ctx">{{ formatCtx(m.contextLength) }}</span>
                  </div>
                  <span v-if="m.name && m.name !== m.id" class="model-row-id">{{ m.id }}</span>
                </div>

                <div class="model-row-actions">
                  <button
                    v-if="editingModelId !== m.id"
                    class="row-action-btn edit-btn"
                    title="编辑模型"
                    @click="startEditModel(m)"
                  >
                    <Pencil :size="11" />
                  </button>
                  <button
                    class="row-action-btn set-default-btn"
                    :class="{ 'is-default': selected.selectedModelId === m.id }"
                    @click="ai.setModelForProvider(selected.id, m.id)"
                    :title="selected.selectedModelId === m.id ? '当前默认' : '设为默认'"
                  >
                    <Check :size="11" />
                  </button>
                  <button
                    class="row-action-btn remove-btn"
                    @click.stop="ai.removeCustomModel(selected.id, m.id)"
                    title="移除模型"
                  >
                    <X :size="11" />
                  </button>
                </div>
              </div>

              <!-- Inline edit panel -->
              <div v-if="editingModelId === m.id" class="model-edit-panel">
                <div class="edit-panel-section">
                  <div class="edit-panel-label">能力</div>
                  <div class="cap-toggle-group">
                    <label class="cap-toggle" :class="{ active: editDraft.reasoning }">
                      <input v-model="editDraft.reasoning" type="checkbox" />
                      <span>推理</span>
                    </label>
                    <label class="cap-toggle" :class="{ active: editDraft.multimodal }">
                      <input v-model="editDraft.multimodal" type="checkbox" />
                      <span>视觉</span>
                    </label>
                    <label class="cap-toggle" :class="{ active: editDraft.imageOutput }">
                      <input v-model="editDraft.imageOutput" type="checkbox" />
                      <span>图像</span>
                    </label>
                    <label class="cap-toggle" :class="{ active: editDraft.audio }">
                      <input v-model="editDraft.audio" type="checkbox" />
                      <span>音频</span>
                    </label>
                    <label class="cap-toggle" :class="{ active: editDraft.video }">
                      <input v-model="editDraft.video" type="checkbox" />
                      <span>视频</span>
                    </label>
                  </div>
                </div>

                <div class="edit-panel-section">
                  <div class="edit-panel-label">价格</div>
                  <div class="price-edit-row">
                    <div class="price-field">
                      <span class="price-field-label">输入</span>
                      <input
                        v-model.number="editDraft.inputPrice"
                        type="number"
                        step="0.01"
                        min="0"
                        class="price-edit-input"
                        placeholder="0.00"
                      />
                    </div>
                    <div class="price-field">
                      <span class="price-field-label">输出</span>
                      <input
                        v-model.number="editDraft.outputPrice"
                        type="number"
                        step="0.01"
                        min="0"
                        class="price-edit-input"
                        placeholder="0.00"
                      />
                    </div>
                    <div class="price-field">
                      <span class="price-field-label">货币</span>
                      <select v-model="editDraft.priceCurrency" class="price-edit-select">
                        <option value="usd">USD</option>
                        <option value="cny">CNY</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div class="edit-panel-section">
                  <div class="edit-panel-label">上下文长度</div>
                  <input
                    v-model.number="editDraft.contextLength"
                    type="number"
                    min="0"
                    class="price-edit-input"
                    placeholder="Token 数"
                    style="width: 140px;"
                  />
                </div>

                <div class="edit-panel-actions">
                  <button class="btn-primary sm" @click="saveEditModel(m)">保存</button>
                  <button class="btn-ghost sm" @click="cancelEditModel">取消</button>
                </div>
              </div>
            </div>

            <div v-if="selected.models.length === 0" class="model-table-empty">
              暂无模型，点击「获取模型列表」或「手动添加」
            </div>
          </div>
        </div>
      </template>

      <div v-else class="detail-empty">
        请在左侧选择一个服务商
      </div>
    </div>
  </div>

  <!-- ── Model picker popup ── -->
  <Teleport to="body">
    <div v-if="showModelPicker" class="picker-backdrop" @click.self="closeModelPicker">
      <div class="picker-panel">
        <!-- Header -->
        <div class="picker-header">
          <div class="picker-header-left">
            <span v-if="selected && isOpenRouter(selected)" class="picker-provider-logo">
              <img :src="openrouterLogoUrl" class="picker-logo-img" alt="" />
            </span>
            <span
              v-else-if="selected"
              class="picker-provider-dot"
              :style="{ background: providerColor(selected?.id ?? '') }"
            >{{ providerInitial(selected?.name ?? '') }}</span>
            <div>
              <div class="picker-title">{{ selected?.name ?? '' }} 模型</div>
              <div class="picker-subtitle">{{ pickerSelected.size }} 已选 / {{ pickerModels.length }} 个可用</div>
            </div>
          </div>
          <div class="picker-header-right">
            <button class="picker-select-text" @click="pickerSelected = new Set(pickerModels.map(m => m.id))">全选</button>
            <button class="picker-select-text" @click="pickerSelected = new Set()">清空</button>
            <button class="picker-close-btn" @click="closeModelPicker"><X :size="16" /></button>
          </div>
        </div>

        <!-- Search + filter tabs -->
        <div class="picker-search-area">
          <div class="picker-search-wrap">
            <Search :size="14" class="search-icon" />
            <input
              v-model="pickerSearch"
              class="picker-search"
              placeholder="搜索模型 ID 或名称…"
              autofocus
            />
          </div>
          <div class="picker-tabs">
            <button
              v-for="tab in pickerTabs"
              :key="tab.id"
              class="picker-tab"
              :class="{ active: pickerTab === tab.id }"
              @click="pickerTab = tab.id"
            >
              {{ tab.label }}
              <span class="tab-count">{{ tab.count }}</span>
            </button>
          </div>
        </div>

        <!-- Model list grouped by provider -->
        <div class="picker-list">
          <template v-for="group in pickerGroups" :key="group.name">
            <div class="picker-group-header">
              <span
                class="picker-group-dot"
                :style="{ background: providerColor(group.name) }"
              >{{ group.name.charAt(0).toUpperCase() }}</span>
              <span class="picker-group-name">{{ group.name }}</span>
              <span class="picker-group-count">{{ group.models.length }}</span>
            </div>
            <label
              v-for="m in group.models"
              :key="m.id"
              class="picker-item"
              :class="{ checked: pickerSelected.has(m.id) }"
            >
              <input
                type="checkbox"
                class="picker-checkbox"
                :checked="pickerSelected.has(m.id)"
                @change="togglePickerModel(m.id)"
              />
              <div class="picker-item-info">
                <span class="picker-model-name">{{ m.name || m.id }}</span>
                <span v-if="m.name && m.name !== m.id" class="picker-model-id">{{ m.id }}</span>
              </div>
              <div class="picker-item-caps">
                <span v-if="getPickerCaps(m).reasoning"   class="m-badge reasoning">推理</span>
                <span v-if="getPickerCaps(m).vision"      class="m-badge vision">视觉</span>
                <span v-if="getPickerCaps(m).imageOutput" class="m-badge image">图像</span>
                <span v-if="getPickerCaps(m).video"       class="m-badge video">视频</span>
                <span v-if="getPickerCaps(m).embedding"   class="m-badge embed">嵌入</span>
                <span v-if="getPickerCaps(m).reranking"   class="m-badge rerank">重排</span>
                <span v-if="m.context_length" class="picker-ctx">{{ formatCtx(m.context_length) }}</span>
              </div>
            </label>
          </template>
          <div v-if="pickerGroups.length === 0" class="picker-empty">
            <SlidersHorizontal :size="28" class="picker-empty-icon" />
            <span>无匹配结果</span>
          </div>
        </div>

        <div class="picker-footer">
          <button class="btn-ghost" @click="closeModelPicker">取消</button>
          <button class="btn-primary" @click="confirmPickerSelection">
            <Check :size="13" /> 确认选择
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ai-settings {
  display: flex;
  flex-direction: row;
  height: 100%;
  overflow: hidden;
}

/* ── Left panel ── */
.provider-list-panel {
  width: 196px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(0, 0, 0, 0.07);
  background: rgba(248, 248, 250, 0.6);
  overflow: hidden;
}

.list-header {
  padding: 20px 14px 10px;
  flex-shrink: 0;
}

.list-title {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.provider-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}

.provider-list::-webkit-scrollbar { width: 3px; }
.provider-list::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

.provider-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  transition: background 0.10s;
  margin-bottom: 1px;
}

.provider-row:hover { background: rgba(0,0,0,0.05); }
.provider-row.selected { background: rgba(34, 63, 121, 0.09); }

.p-dot {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: white;
  letter-spacing: -0.3px;
}

.p-logo-img {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  flex-shrink: 0;
  object-fit: contain;
  background: #f0f0f5;
  padding: 2px;
}

.p-name {
  flex: 1;
  font-size: 13px;
  color: #1c1c1e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.provider-row.selected .p-name { color: #223F79; font-weight: 500; }

.p-status {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 5px;
  border-radius: 4px;
  flex-shrink: 0;
}

.p-status.on  { background: rgba(52,199,89,0.12); color: #34c759; }
.p-status.off { background: rgba(0,0,0,0.05); color: #8e8e93; }
.p-status.err { background: rgba(255,59,48,0.10); color: #ff3b30; }

.p-chevron { color: #c7c7cc; flex-shrink: 0; }
.provider-row.selected .p-chevron { color: #223F79; }

.add-form {
  padding: 8px 10px 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
  border-top: 1px solid rgba(0,0,0,0.06);
}

.add-input {
  height: 30px;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 7px;
  padding: 0 9px;
  font-size: 12px;
  color: #1c1c1e;
  background: white;
  outline: none;
  width: 100%;
}

.add-input:focus { border-color: rgba(34, 63, 121, 0.4); }

.add-form-actions { display: flex; gap: 6px; }

.add-provider-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin: 8px 10px 10px;
  padding: 7px;
  border: 1.5px dashed rgba(0,0,0,0.15);
  border-radius: 8px;
  background: transparent;
  color: #8e8e93;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.12s;
  flex-shrink: 0;
}

.add-provider-btn:hover {
  border-color: rgba(34, 63, 121, 0.35);
  color: #223F79;
  background: rgba(34, 63, 121, 0.04);
}

/* ── Right detail panel ── */
.detail-panel {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
  min-width: 0;
}

.detail-panel::-webkit-scrollbar { width: 4px; }
.detail-panel::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.detail-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-dot {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.detail-logo-img {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  flex-shrink: 0;
  object-fit: contain;
  background: #f0f0f5;
  padding: 4px;
}

.detail-name {
  font-size: 18px;
  font-weight: 700;
  color: #1c1c1e;
}

.detail-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.toggle-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}

.toggle-switch input { position: absolute; opacity: 0; width: 0; height: 0; }

.toggle-track {
  width: 36px;
  height: 20px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 10px;
  transition: background 0.2s;
  position: relative;
}

.toggle-switch input:checked + .toggle-track { background: #34c759; }

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

.toggle-switch input:checked + .toggle-track .toggle-thumb { transform: translateX(16px); }

.delete-btn {
  width: 30px;
  height: 30px;
  border: 1px solid rgba(0,0,0,0.09);
  border-radius: 7px;
  background: transparent;
  color: #8e8e93;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.12s;
}

.delete-btn:hover { background: rgba(255,59,48,0.08); border-color: rgba(255,59,48,0.2); color: #ff3b30; }

.delete-confirm-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  margin-bottom: 16px;
  background: rgba(255,59,48,0.07);
  border: 1px solid rgba(255,59,48,0.2);
  border-radius: 10px;
}

.delete-confirm-label { font-size: 13px; color: #c0392b; }

.delete-confirm-yes {
  padding: 3px 10px;
  background: #ff3b30;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: opacity 0.12s;
}
.delete-confirm-yes:hover { opacity: 0.85; }

.delete-confirm-no {
  padding: 3px 10px;
  background: rgba(0,0,0,0.06);
  color: #3c3c43;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}
.delete-confirm-no:hover { background: rgba(0,0,0,0.10); }

.toggle-locked { opacity: 0.4; cursor: not-allowed; }

.test-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: 1px solid rgba(0,0,0,0.09);
  border-radius: 7px;
  background: transparent;
  color: #3c3c43;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.12s;
}
.test-btn:hover { background: rgba(0,0,0,0.05); }
.test-btn.ok    { border-color: rgba(52,199,89,0.4); color: #34c759; background: rgba(52,199,89,0.06); }
.test-btn.error { border-color: rgba(255,59,48,0.3); color: #ff3b30; background: rgba(255,59,48,0.05); }
.test-btn:disabled { opacity: 0.6; cursor: default; }

.conn-msg {
  font-size: 12px;
  padding: 7px 10px;
  border-radius: 8px;
  margin-bottom: 16px;
}
.conn-msg.ok    { background: rgba(52,199,89,0.08); color: #248a3d; }
.conn-msg.error { background: rgba(255,59,48,0.07); color: #c0392b; }

.fetch-error {
  font-size: 11px;
  color: #8e8e93;
  margin-top: 4px;
  margin-bottom: 6px;
}

@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.8s linear infinite; }

.detail-section { margin-bottom: 24px; }

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 8px;
}

.key-display-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  background: rgba(0,0,0,0.03);
  border: 1px solid rgba(0,0,0,0.07);
  border-radius: 9px;
}

.key-mono {
  flex: 1;
  font-size: 13px;
  color: #3c3c43;
  font-family: 'SF Mono', 'Menlo', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-field {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.field-label-sm {
  font-size: 11px;
  font-weight: 500;
  color: #8e8e93;
  margin-bottom: 4px;
  letter-spacing: 0.2px;
}

.key-input-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.text-input {
  flex: 1;
  height: 34px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  padding: 0 10px;
  font-size: 13px;
  color: #1c1c1e;
  background: white;
  outline: none;
  width: 100%;
}

.text-input.mono { font-family: 'SF Mono', 'Menlo', monospace; }
.text-input:focus { border-color: rgba(34, 63, 121, 0.4); }

.eye-btn {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: 1px solid rgba(0,0,0,0.10);
  border-radius: 8px;
  background: white;
  color: #8e8e93;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.eye-btn:hover { background: #f5f5f7; }

.edit-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

/* Buttons */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 16px;
  background: #223F79;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  transition: opacity 0.12s;
}
.btn-primary:hover { opacity: 0.85; }
.btn-primary.sm { padding: 4px 10px; font-size: 12px; }

.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 16px;
  background: rgba(0,0,0,0.06);
  color: #3c3c43;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
}
.btn-ghost:hover { background: rgba(0,0,0,0.10); }
.btn-ghost.sm { padding: 4px 10px; font-size: 12px; }

.btn-small {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 10px;
  background: rgba(34, 63, 121, 0.08);
  color: #223F79;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s;
  flex-shrink: 0;
}
.btn-small:hover { background: rgba(34, 63, 121, 0.14); }
.btn-small:disabled { opacity: 0.5; cursor: default; }

/* Models section */
.models-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.models-header-left {
  display: flex;
  align-items: center;
  gap: 7px;
}

.model-count-badge {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  background: rgba(0,0,0,0.06);
  padding: 1px 7px;
  border-radius: 10px;
}

.add-model-form {
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Cherry Studio-style model table */
.model-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: rgba(0,0,0,0.02);
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 12px;
  overflow: hidden;
  padding: 4px;
}

.model-row-wrap {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  transition: background 0.10s;
}

.model-row-wrap:hover { background: rgba(0,0,0,0.04); }

.model-row-wrap.model-row-default { background: rgba(34, 63, 121, 0.06); }

.model-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: default;
}

.model-row-icon {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: white;
}

.model-row-logo {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  object-fit: contain;
}

.model-row-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.model-row-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.model-row-name {
  font-size: 13px;
  font-weight: 500;
  color: #1c1c1e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-row-default .model-row-name { color: #223F79; }

.model-row-id {
  font-size: 10.5px;
  color: #8e8e93;
  font-family: 'SF Mono', 'Menlo', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}



.m-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
  white-space: nowrap;
}
.m-badge.reasoning { background: rgba(88, 86, 214, 0.10); color: #5856d6; }
.m-badge.vision    { background: rgba(52, 199, 89, 0.10); color: #28a745; }
.m-badge.image     { background: rgba(255, 149, 0, 0.12); color: #c8710a; }
.m-badge.audio     { background: rgba(0, 122, 255, 0.10); color: #0062cc; }
.m-badge.video     { background: rgba(175, 82, 222, 0.10); color: #8e44ad; }
.m-badge.embed     { background: rgba(0, 122, 255, 0.10); color: #0062cc; }
.m-badge.rerank    { background: rgba(255, 45, 85, 0.10); color: #c0002f; }

.m-ctx {
  font-size: 10px;
  color: #8e8e93;
  background: rgba(0,0,0,0.05);
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.model-row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.edit-btn,
.set-default-btn,
.remove-btn {
  opacity: 0;
  transition: opacity 0.15s;
}
.model-row-wrap:hover .edit-btn,
.model-row-wrap:hover .set-default-btn,
.model-row-wrap:hover .remove-btn {
  opacity: 1;
}
.edit-btn:hover { background: rgba(34, 63, 121, 0.10); color: #223F79; }

.row-action-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.10s;
  color: #c7c7cc;
}

.set-default-btn:hover { background: rgba(34, 63, 121, 0.10); color: #223F79; }
.set-default-btn.is-default { color: #223F79; background: rgba(34, 63, 121, 0.10); }
.remove-btn:hover { background: rgba(255,59,48,0.08); color: #ff3b30; }

.model-table-empty {
  padding: 24px;
  text-align: center;
  font-size: 12px;
  color: #8e8e93;
}

/* Inline edit panel */
.model-edit-panel {
  padding: 10px 12px 12px;
  margin: 0 8px 6px;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.edit-panel-section {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.edit-panel-label {
  font-size: 10px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.cap-toggle-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cap-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.10);
  background: white;
  cursor: pointer;
  font-size: 12px;
  color: #8e8e93;
  transition: all 0.12s;
  user-select: none;
}

.cap-toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.cap-toggle.active {
  border-color: rgba(34, 63, 121, 0.35);
  background: rgba(34, 63, 121, 0.06);
  color: #223F79;
  font-weight: 500;
}

.price-edit-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.price-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.price-field-label {
  font-size: 10px;
  color: #8e8e93;
}

.price-edit-input {
  width: 80px;
  height: 30px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 7px;
  padding: 0 8px;
  font-size: 12px;
  color: #1c1c1e;
  background: white;
  outline: none;
}

.price-edit-input:focus { border-color: rgba(34, 63, 121, 0.4); }

.price-edit-select {
  width: 70px;
  height: 30px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 7px;
  padding: 0 6px;
  font-size: 12px;
  color: #1c1c1e;
  background: white;
  outline: none;
  cursor: pointer;
}

.price-edit-select:focus { border-color: rgba(34, 63, 121, 0.4); }

.edit-panel-actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}

/* Empty state */
.detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 14px;
  color: #8e8e93;
}

/* ── Model picker popup ── */
.picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.picker-panel {
  width: 680px;
  max-height: 680px;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 14px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}

.picker-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.picker-provider-logo {
  display: flex;
  align-items: center;
}

.picker-logo-img {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  object-fit: contain;
  background: #f0f0f5;
  padding: 3px;
}

.picker-provider-dot {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: white;
}

.picker-title {
  font-size: 15px;
  font-weight: 700;
  color: #1c1c1e;
  line-height: 1.2;
}

.picker-subtitle {
  font-size: 11px;
  color: #8e8e93;
  margin-top: 1px;
}

.picker-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.picker-select-text {
  font-size: 12px;
  color: #223F79;
  background: rgba(34, 63, 121, 0.07);
  border: none;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 6px;
  transition: background 0.10s;
}
.picker-select-text:hover { background: rgba(34, 63, 121, 0.13); }

.picker-close-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 7px;
  background: rgba(0,0,0,0.05);
  color: #8e8e93;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.10s;
  margin-left: 4px;
}
.picker-close-btn:hover { background: rgba(0,0,0,0.10); color: #1c1c1e; }

/* Search + tabs */
.picker-search-area {
  padding: 12px 16px 0;
  flex-shrink: 0;
}

.picker-search-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0,0,0,0.04);
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 9px;
  padding: 0 12px;
  margin-bottom: 10px;
}

.search-icon { color: #8e8e93; flex-shrink: 0; }

.picker-search {
  flex: 1;
  height: 36px;
  border: none;
  background: transparent;
  outline: none;
  font-size: 13px;
  color: #1c1c1e;
}

.picker-tabs {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  padding-bottom: 1px;
}

.picker-tabs::-webkit-scrollbar { display: none; }

.picker-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: none;
  border-radius: 8px 8px 0 0;
  background: transparent;
  color: #8e8e93;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.10s;
  border-bottom: 2px solid transparent;
}

.picker-tab:hover { color: #3c3c43; background: rgba(0,0,0,0.04); }
.picker-tab.active { color: #223F79; border-bottom-color: #223F79; background: rgba(34, 63, 121, 0.05); }

.tab-count {
  font-size: 10px;
  background: rgba(0,0,0,0.07);
  padding: 1px 5px;
  border-radius: 8px;
  font-weight: 600;
}
.picker-tab.active .tab-count { background: rgba(34, 63, 121, 0.12); color: #223F79; }

/* Model list */
.picker-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  border-top: 1px solid rgba(0,0,0,0.06);
}

.picker-list::-webkit-scrollbar { width: 4px; }
.picker-list::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

.picker-group-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px 4px;
  position: sticky;
  top: 0;
  background: white;
  z-index: 1;
}

.picker-group-dot {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  color: white;
}

.picker-group-name {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  flex: 1;
}

.picker-group-count {
  font-size: 10px;
  color: #c7c7cc;
  background: rgba(0,0,0,0.05);
  padding: 1px 6px;
  border-radius: 8px;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.10s;
  user-select: none;
}

.picker-item:hover { background: rgba(0,0,0,0.04); }
.picker-item.checked { background: rgba(34, 63, 121, 0.05); }

.picker-checkbox {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  accent-color: #223F79;
  cursor: pointer;
}

.picker-item-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}

.picker-model-name {
  font-size: 13px;
  color: #1c1c1e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-item.checked .picker-model-name { color: #223F79; font-weight: 500; }

.picker-model-id {
  font-size: 10.5px;
  color: #8e8e93;
  font-family: 'SF Mono', 'Menlo', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-item-caps {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.picker-ctx {
  font-size: 10px;
  color: #8e8e93;
  background: rgba(0,0,0,0.05);
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.picker-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 0;
  font-size: 13px;
  color: #8e8e93;
}

.picker-empty-icon { color: #c7c7cc; }

.picker-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid rgba(0, 0, 0, 0.07);
  flex-shrink: 0;
  background: rgba(248, 248, 250, 0.8);
}

.url-input { width: 100%; }
</style>
