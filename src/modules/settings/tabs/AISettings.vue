<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Eye, EyeOff, Plus, Trash2, Check, X, ChevronRight, RefreshCw } from 'lucide-vue-next'
import { useAiSettingsStore, type AIProvider } from '../../../stores/aiSettings'

const ai = useAiSettingsStore()

// ─── Selected provider in left panel ─────────────────────────────────────────

const selectedId = ref(ai.providers[0]?.id ?? '')
const selected   = computed(() => ai.providers.find(p => p.id === selectedId.value) ?? null)

// When the selected provider is removed, move to the first available
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
  // Direct mutation — bypasses ai.addProvider which may be undefined after HMR
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
  // Direct mutation — bypasses ai.removeProvider which may be undefined after HMR
  const idx = ai.providers.findIndex(p => p.id === id)
  if (idx !== -1) ai.providers.splice(idx, 1)
}

function cancelDelete() {
  confirmDelete.value = false
}

// Reset confirm state when switching providers
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
    apiKey:  editKey.value,
  }
  if (!selected.value.builtIn) patch.name = editName.value
  ai.updateProvider(selected.value.id, patch)
  editMode.value = false
}

// Reset edit state when switching providers
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

// Reset add-model form when switching providers
watch(selectedId, () => { showAddModel.value = false; fetchModelError.value = '' })

// ─── Connection test & model fetch ───────────────────────────────────────────

type ConnStatus = 'idle' | 'testing' | 'ok' | 'error'
const connStatus  = ref<Record<string, ConnStatus>>({})
const connMessage = ref<Record<string, string>>({})

function getConn(id: string): ConnStatus { return connStatus.value[id] ?? 'idle' }

// Persist/restore "ok" status so toggle stays unlocked across sessions
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
  const { id, apiKey, baseUrl } = selected.value
  if (!apiKey || !baseUrl) { connStatus.value[id] = 'error'; connMessage.value[id] = '请先配置 API 密钥和地址'; return }
  connStatus.value[id]  = 'testing'
  connMessage.value[id] = ''
  try {
    const resp = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const list: Array<{ id: string }> = data.data ?? data.models ?? []
    let added = 0
    for (const m of list) {
      if (m.id && !selected.value!.models.find(x => x.id === m.id)) {
        ai.addCustomModel(selected.value!.id, { id: m.id, name: m.id })
        added++
      }
    }
    connStatus.value[id]  = 'ok'
    connMessage.value[id] = `连接成功，获取到 ${list.length} 个模型${added ? `，新增 ${added} 个` : '（已是最新）'}`
    persistConnOk(id)
    setTimeout(() => { connMessage.value[id] = '' }, 3000)
  } catch (e: unknown) {
    connStatus.value[id]  = 'error'
    connMessage.value[id] = e instanceof Error ? e.message : String(e)
  }
}

const fetchingModels  = ref(false)
const fetchModelError = ref('')

// ─── Model picker popup ───────────────────────────────────────────────────────

const showModelPicker  = ref(false)
const pickerModels     = ref<Array<{ id: string }>>([])
const pickerSearch     = ref('')
const pickerSelected   = ref<Set<string>>(new Set())

const filteredPickerModels = computed(() => {
  const q = pickerSearch.value.toLowerCase().trim()
  return q ? pickerModels.value.filter(m => m.id.toLowerCase().includes(q)) : pickerModels.value
})

function closeModelPicker() {
  showModelPicker.value = false
  pickerSearch.value    = ''
}

function togglePickerModel(id: string) {
  if (pickerSelected.value.has(id)) pickerSelected.value.delete(id)
  else pickerSelected.value.add(id)
}

function confirmPickerSelection() {
  if (!selected.value) return
  const prov = selected.value
  const fetchedIds = new Set(pickerModels.value.map(m => m.id))
  // Add newly checked models
  for (const id of pickerSelected.value) {
    if (!prov.models.find(m => m.id === id)) {
      ai.addCustomModel(prov.id, { id, name: id })
    }
  }
  // Remove unchecked models that came from the fetched list
  for (const m of [...prov.models]) {
    if (fetchedIds.has(m.id) && !pickerSelected.value.has(m.id)) {
      ai.removeCustomModel(prov.id, m.id)
    }
  }
  closeModelPicker()
}

async function fetchModels() {
  if (!selected.value) return
  const { apiKey, baseUrl } = selected.value
  if (!apiKey || !baseUrl) { fetchModelError.value = '需要先配置 API 密钥和地址'; return }
  fetchingModels.value  = true
  fetchModelError.value = ''
  try {
    const resp = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const list: Array<{ id: string }> = data.data ?? data.models ?? []
    if (list.length === 0) { fetchModelError.value = '未返回任何模型'; return }
    pickerModels.value   = list
    // Pre-select models already in the provider
    pickerSelected.value = new Set(list.filter(m => selected.value!.models.find(x => x.id === m.id)).map(m => m.id))
    pickerSearch.value   = ''
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
          <span class="p-dot" :style="{ background: providerColor(p.id) }">
            {{ providerInitial(p.name) }}
          </span>
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

      <!-- Add button -->
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
            <span class="detail-dot" :style="{ background: providerColor(selected.id) }">
              {{ providerInitial(selected.name) }}
            </span>
            <h2 class="detail-name">{{ selected.name }}</h2>
          </div>
          <div class="detail-header-actions">
            <!-- Test connection -->
            <button
              class="test-btn"
              :class="getConn(selected.id)"
              :disabled="getConn(selected.id) === 'testing'"
              @click="testConnection"
            >
              <RefreshCw :size="12" :class="{ spin: getConn(selected.id) === 'testing' }" />
              {{ getConn(selected.id) === 'testing' ? '测试中…' : '测试连接' }}
            </button>
            <!-- Enable toggle — only active after successful test -->
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
            <!-- Delete -->
            <button class="delete-btn" title="删除服务商" @click="handleDelete">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <!-- Delete confirmation banner — full width, below header -->
        <div v-if="confirmDelete" class="delete-confirm-banner">
          <span class="delete-confirm-label">确认删除「{{ selected.name }}」？</span>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="delete-confirm-yes" @click="doDelete">删除</button>
            <button class="delete-confirm-no"  @click="cancelDelete">取消</button>
          </div>
        </div>

        <!-- Connection message -->
        <div v-if="connMessage[selected.id]" class="conn-msg" :class="getConn(selected.id)">
          {{ connMessage[selected.id] }}
        </div>

        <!-- API Key section -->
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

        <!-- Base URL — always inline editable -->
        <div class="detail-section">
          <div class="section-label">API 地址</div>
          <input
            class="text-input url-input"
            :value="selected.baseUrl"
            placeholder="https://api.example.com/v1"
            @change="ai.updateProvider(selected.id, { baseUrl: ($event.target as HTMLInputElement).value.trim() })"
          />
        </div>

        <!-- Models section -->
        <div class="detail-section">
          <div class="models-header">
            <span class="section-label" style="margin-bottom:0">模型</span>
            <div style="display:flex;gap:6px">
              <button class="btn-small" :disabled="fetchingModels" @click="fetchModels">
                <RefreshCw :size="11" :class="{ spin: fetchingModels }" />
                {{ fetchingModels ? '获取中…' : '获取列表' }}
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

          <div class="model-chips">
            <div
              v-for="m in selected.models"
              :key="m.id"
              class="model-chip"
              :class="{ active: selected.selectedModelId === m.id }"
              @click="ai.setModelForProvider(selected.id, m.id)"
            >
              <span class="chip-name">{{ m.name }}</span>
              <span v-if="m.contextLength" class="chip-ctx">{{ formatCtx(m.contextLength) }}</span>
              <button
                class="chip-remove"
                @click.stop="ai.removeCustomModel(selected.id, m.id)"
                title="移除模型"
              >
                <X :size="9" />
              </button>
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
        <div class="picker-header">
          <span class="picker-title">选择模型</span>
          <div class="picker-header-right">
            <span class="picker-count">{{ pickerSelected.size }} / {{ pickerModels.length }}</span>
            <button class="picker-select-all" @click="pickerSelected = new Set(filteredPickerModels.map(m => m.id))">全选</button>
            <button class="picker-select-all" @click="pickerSelected = new Set()">取消全选</button>
          </div>
        </div>

        <div class="picker-search-wrap">
          <input
            v-model="pickerSearch"
            class="picker-search"
            placeholder="搜索模型…"
            autofocus
          />
        </div>

        <div class="picker-list">
          <label
            v-for="m in filteredPickerModels"
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
            <span class="picker-model-id">{{ m.id }}</span>
          </label>
          <div v-if="filteredPickerModels.length === 0" class="picker-empty">无匹配结果</div>
        </div>

        <div class="picker-footer">
          <button class="btn-ghost" @click="closeModelPicker">取消</button>
          <button class="btn-primary" @click="confirmPickerSelection">确认</button>
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

/* Add form */
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

/* Toggle switch */
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

.delete-confirm-label {
  font-size: 13px;
  color: #c0392b;
}

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

/* Sections */
.detail-section {
  margin-bottom: 24px;
}

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

.url-text {
  font-size: 13px;
  color: #3c3c43;
  word-break: break-all;
}

/* Edit field */
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

/* Models */
.models-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.add-model-form {
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.model-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  background: rgba(0,0,0,0.04);
  border: 1.5px solid transparent;
  border-radius: 20px;
  font-size: 12px;
  color: #3c3c43;
  cursor: pointer;
  transition: all 0.10s;
}

.model-chip:hover { background: rgba(0,0,0,0.07); }

.model-chip.active {
  background: rgba(34, 63, 121, 0.08);
  border-color: rgba(34, 63, 121, 0.25);
  color: #223F79;
}

.chip-name { line-height: 1; }

.chip-ctx {
  font-size: 10px;
  color: #8e8e93;
  background: rgba(0,0,0,0.05);
  padding: 1px 5px;
  border-radius: 4px;
}

.chip-remove {
  background: none;
  border: none;
  color: #c7c7cc;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  transition: color 0.10s;
}

.chip-remove:hover { color: #ff3b30; }

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
  width: 420px;
  max-height: 560px;
  background: #ffffff;
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 0;
  flex-shrink: 0;
}

.picker-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.picker-select-all {
  font-size: 12px;
  color: #223F79;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 5px;
  transition: background 0.10s;
}

.picker-select-all:hover { background: rgba(34, 63, 121, 0.08); }

.picker-title {
  font-size: 15px;
  font-weight: 700;
  color: #1c1c1e;
}

.picker-count {
  font-size: 11px;
  color: #8e8e93;
}

.picker-search-wrap {
  padding: 12px 20px;
  flex-shrink: 0;
}

.picker-search {
  width: 100%;
  height: 34px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  padding: 0 10px;
  font-size: 13px;
  color: #1c1c1e;
  background: rgba(0, 0, 0, 0.03);
  outline: none;
  box-sizing: border-box;
}

.picker-search:focus { border-color: rgba(34, 63, 121, 0.4); background: white; }

.picker-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px;
}

.picker-list::-webkit-scrollbar { width: 4px; }
.picker-list::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

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

.picker-item:hover { background: rgba(0, 0, 0, 0.04); }
.picker-item.checked { background: rgba(34, 63, 121, 0.06); }

.picker-checkbox {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  accent-color: #223F79;
  cursor: pointer;
}

.picker-model-id {
  font-size: 12.5px;
  color: #1c1c1e;
  font-family: 'SF Mono', 'Menlo', monospace;
  word-break: break-all;
  line-height: 1.4;
}

.picker-empty {
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  color: #8e8e93;
}

.picker-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid rgba(0, 0, 0, 0.07);
  flex-shrink: 0;
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
</style>
