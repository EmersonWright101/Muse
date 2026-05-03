<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpen, AlertTriangle, Check, X, ChevronDown, Pencil, Trash2, Plus, RotateCcw, Eye, EyeOff, Wifi, WifiOff } from 'lucide-vue-next'
import { usePapersStore } from '../../../stores/papers'
import { open } from '@tauri-apps/plugin-dialog'
import { readDir, remove } from '@tauri-apps/plugin-fs'
import { getDataRoot, setDataRoot, resolveDataRoot, migrateData } from '../../../utils/path'
import { getTrashRetentionDays, setTrashRetentionDays } from '../../../utils/travelStorage'
import { useHomeStore, DEFAULT_PROMPT, FREQUENCY_OPTIONS } from '../../../stores/home'
import { useAiSettingsStore } from '../../../stores/aiSettings'

const { locale, t } = useI18n()

// ── Poster wall settings ────────────────────────────────────────────────────

const homeStore = useHomeStore()
const aiStore   = useAiSettingsStore()

const posterEnabled       = ref(homeStore.settings.enabled)
const posterProviderId    = ref(homeStore.settings.providerId)
const posterModelId       = ref(homeStore.settings.modelId)
const posterFrequency     = ref(homeStore.settings.frequency)
const posterPrompt        = ref(homeStore.settings.promptTemplate || DEFAULT_PROMPT)
const posterMaxPosters    = ref(homeStore.settings.maxPosters)

const imageProviders = computed(() =>
  aiStore.providers.filter(p => p.enabled && p.apiKey && p.models.some(m => m.imageOutput))
)

const imageModels = computed(() => {
  const provider = aiStore.providers.find(p => p.id === posterProviderId.value)
  return provider?.models.filter(m => m.imageOutput) ?? []
})

function savePosterSettings() {
  homeStore.updateSettings({
    enabled:        posterEnabled.value,
    providerId:     posterProviderId.value,
    modelId:        posterModelId.value,
    frequency:      posterFrequency.value,
    promptTemplate: posterPrompt.value,
    maxPosters:     posterMaxPosters.value,
  })
}

function onPosterProviderChange() {
  const models = imageModels.value
  if (models.length > 0 && !models.find(m => m.id === posterModelId.value)) {
    posterModelId.value = models[0].id
  }
  savePosterSettings()
}

function resetPrompt() {
  posterPrompt.value = DEFAULT_PROMPT
  savePosterSettings()
}

// ── Animal list editor ──────────────────────────────────────────────────────

const showAnimalList  = ref(false)
const editingIndex    = ref(-1)
const editZh          = ref('')
const editEn          = ref('')
// 'single' = one-by-one inline form, 'bulk' = textarea paste mode
const addMode         = ref<'single' | 'bulk'>('single')
const showAddForm     = ref(false)
const newZh           = ref('')
const newEn           = ref('')
const bulkText        = ref('')

// Set of animal zh names that have already appeared in posters
const usedAnimalNames = computed(() => new Set(homeStore.posters.map(p => p.animalName)))

// Preview parse of bulk input: each non-empty line → { zh, en }
const bulkPreview = computed(() => {
  return bulkText.value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const idx = line.indexOf(',')
      const zh = idx >= 0 ? line.slice(0, idx).trim() : line.trim()
      const en = idx >= 0 ? line.slice(idx + 1).trim() : ''
      return { zh, en, valid: zh.length > 0 && en.length > 0 }
    })
})

const bulkValidCount = computed(() => bulkPreview.value.filter(r => r.valid).length)

function startEdit(index: number) {
  editingIndex.value = index
  editZh.value = homeStore.animals[index].zh
  editEn.value = homeStore.animals[index].en
  showAddForm.value = false
}

function saveEdit(index: number) {
  homeStore.updateAnimal(index, { zh: editZh.value, en: editEn.value })
  editingIndex.value = -1
}

function cancelEdit() {
  editingIndex.value = -1
}

function confirmAdd() {
  if (!newZh.value.trim() || !newEn.value.trim()) return
  homeStore.addAnimal({ zh: newZh.value, en: newEn.value })
  newZh.value = ''
  newEn.value = ''
  showAddForm.value = false
}

function cancelAdd() {
  newZh.value = ''
  newEn.value = ''
  bulkText.value = ''
  showAddForm.value = false
}

function confirmBulkImport() {
  for (const row of bulkPreview.value) {
    if (row.valid) homeStore.addAnimal({ zh: row.zh, en: row.en })
  }
  bulkText.value = ''
  showAddForm.value = false
}

function confirmReset() {
  homeStore.resetAnimals()
}

function deleteAnimal(index: number) {
  if (editingIndex.value === index) editingIndex.value = -1
  homeStore.deleteAnimal(index)
}

// Trash retention
const trashRetentionDays = ref<number>(getTrashRetentionDays())

const RETENTION_OPTIONS = [
  { value: 7,  label: () => t('settings.trash.days7') },
  { value: 14, label: () => t('settings.trash.days14') },
  { value: 30, label: () => t('settings.trash.days30') },
  { value: 60, label: () => t('settings.trash.days60') },
  { value: 90, label: () => t('settings.trash.days90') },
  { value: 0,  label: () => t('settings.trash.never') },
]

function setTrashRetention(days: number) {
  trashRetentionDays.value = days
  setTrashRetentionDays(days)
}

const languages = [
  { code: 'zh-CN', label: '简体中文', flag: '🇨🇳' },
  { code: 'en-US', label: 'English',  flag: '🇺🇸' },
]

function setLocale(code: string) {
  locale.value = code
  localStorage.setItem('muse-locale', code)
}

// ── ArXiv backend connection ─────────────────────────────────────────────────

const papers = usePapersStore()
const papersKeyVisible = ref(false)
const papersPinging    = ref(false)
const papersPingResult = ref<'ok' | 'err' | null>(null)

function saveBackendConn() {
  papers.persistConn()
  papersPingResult.value = null
}

async function pingBackend() {
  if (!papers.baseUrl) return
  papersPinging.value = true
  papersPingResult.value = null
  try {
    const r = await fetch(`${papers.baseUrl}/api/papers/ping`, {
      headers: { Authorization: `Bearer ${papers.apiKey}` },
      signal: AbortSignal.timeout(5000),
    })
    papersPingResult.value = r.ok ? 'ok' : 'err'
  } catch {
    papersPingResult.value = 'err'
  } finally {
    papersPinging.value = false
  }
}

// Data path
const currentPath = ref('')
const isCustom = ref(false)
const migrateError = ref('')
const showMigrateConfirm = ref(false)
const pendingNewRoot = ref('')

// Delete old dir confirmation
const showDeleteOldConfirm = ref(false)
const pendingDeletePath = ref('')
const oldDirEntries = ref<Array<{ name: string; isDirectory: boolean }>>([])

async function refreshPath() {
  const root = await resolveDataRoot()
  currentPath.value = root
  isCustom.value = !!getDataRoot()
}

onMounted(refreshPath)

async function chooseFolder() {
  const selected = await open({ directory: true })
  if (typeof selected === 'string') {
    const oldRoot = await resolveDataRoot()
    const newRoot = selected.replace(/[/\\]+$/, '')
    if (oldRoot === newRoot) return
    pendingNewRoot.value = newRoot
    showMigrateConfirm.value = true
  }
}

async function confirmMigrate() {
  showMigrateConfirm.value = false
  const oldRoot = await resolveDataRoot()
  const newRoot = pendingNewRoot.value
  if (oldRoot !== newRoot) {
    try {
      await migrateData(oldRoot, newRoot)
    } catch (e: unknown) {
      migrateError.value = t('settings.dataPath.migrateFailed')
      console.error(e)
      return
    }
  }
  migrateError.value = ''
  setDataRoot(newRoot)
  await refreshPath()

  // Check if old dir still has contents
  try {
    const entries = await readDir(oldRoot)
    if (entries.length > 0) {
      oldDirEntries.value = entries.map(e => ({ name: e.name, isDirectory: e.isDirectory }))
      pendingDeletePath.value = oldRoot
      showDeleteOldConfirm.value = true
    }
  } catch {
    // ignore
  }
}

async function confirmDeleteOld() {
  try {
    await remove(pendingDeletePath.value, { recursive: true })
  } catch (e) {
    console.error('Failed to delete old dir:', e)
  }
  showDeleteOldConfirm.value = false
}
</script>

<template>
  <div class="general-settings">
    <h1 class="page-title">{{ t('settings.sections.general') }}</h1>

    <div class="section-card">
      <h2 class="section-title">{{ t('settings.dataPath.title') }}</h2>
      <p class="section-desc">{{ t('settings.dataPath.description') }}</p>

      <div class="path-row">
        <div class="path-info">
          <span class="path-label">{{ t('settings.dataPath.current') }}</span>
          <span class="path-value" :class="{ custom: isCustom }">{{ currentPath }}</span>
        </div>
        <div class="path-actions">
          <button class="path-btn" @click="chooseFolder">
            <FolderOpen :size="14" />
            {{ t('settings.dataPath.choose') }}
          </button>
        </div>
        <div v-if="migrateError" class="migrate-error">{{ migrateError }}</div>
      </div>
    </div>

    <div class="section-card">
      <h2 class="section-title">语言 / Language</h2>
      <div class="lang-list">
        <button
          v-for="lang in languages"
          :key="lang.code"
          class="lang-item"
          :class="{ active: locale === lang.code }"
          @click="setLocale(lang.code)"
        >
          <span class="lang-flag">{{ lang.flag }}</span>
          <span class="lang-label">{{ lang.label }}</span>
          <span v-if="locale === lang.code" class="lang-check">✓</span>
        </button>
      </div>
    </div>

    <!-- ── Animal Poster Wall ─────────────────────────────────────── -->
    <div class="section-card">
      <h2 class="section-title">{{ t('settings.poster.title') }}</h2>
      <p class="section-desc">{{ t('settings.poster.description') }}</p>

      <!-- Enable toggle -->
      <div class="toggle-row">
        <span class="toggle-label">{{ t('settings.poster.enabled') }}</span>
        <button
          class="toggle-btn"
          :class="{ active: posterEnabled }"
          @click="posterEnabled = !posterEnabled; savePosterSettings()"
        >
          <div class="toggle-thumb" />
        </button>
      </div>

      <!-- Provider selector -->
      <div class="form-row">
        <span class="form-label">{{ t('settings.poster.provider') }}</span>
        <div class="form-control">
          <select
            v-if="imageProviders.length > 0"
            v-model="posterProviderId"
            class="select-input"
            @change="onPosterProviderChange"
          >
            <option value="">{{ t('settings.poster.selectProvider') }}</option>
            <option
              v-for="p in imageProviders"
              :key="p.id"
              :value="p.id"
            >{{ p.name }}</option>
          </select>
          <span v-else class="no-models-hint">{{ t('settings.poster.noImageModels') }}</span>
        </div>
      </div>

      <!-- Model selector -->
      <div v-if="imageModels.length > 0" class="form-row">
        <span class="form-label">{{ t('settings.poster.model') }}</span>
        <div class="form-control">
          <select
            v-model="posterModelId"
            class="select-input"
            @change="savePosterSettings"
          >
            <option value="">{{ t('settings.poster.selectModel') }}</option>
            <option
              v-for="m in imageModels"
              :key="m.id"
              :value="m.id"
            >{{ m.name }}</option>
          </select>
        </div>
      </div>

      <!-- Frequency -->
      <div class="form-row">
        <span class="form-label">{{ t('settings.poster.frequency') }}</span>
        <div class="freq-options">
          <button
            v-for="opt in FREQUENCY_OPTIONS"
            :key="opt.value"
            class="freq-btn"
            :class="{ active: posterFrequency === opt.value }"
            @click="posterFrequency = opt.value; savePosterSettings()"
          >
            {{ locale === 'zh-CN' ? opt.labelZh : opt.labelEn }}
          </button>
        </div>
      </div>

      <!-- Max posters -->
      <div class="form-row">
        <span class="form-label">{{ t('settings.poster.maxPosters') }}</span>
        <div class="form-control number-row">
          <input
            v-model.number="posterMaxPosters"
            type="number"
            min="5"
            max="100"
            class="number-input"
            @change="savePosterSettings"
          />
          <span class="number-unit">{{ t('settings.poster.maxPostersUnit') }}</span>
        </div>
      </div>

      <!-- Prompt template -->
      <div class="prompt-section">
        <div class="prompt-header">
          <span class="form-label">{{ t('settings.poster.promptTitle') }}</span>
          <button class="reset-btn" @click="resetPrompt">重置</button>
        </div>
        <p class="section-desc" style="margin-bottom: 6px">{{ t('settings.poster.promptHint') }}</p>
        <textarea
          v-model="posterPrompt"
          class="prompt-textarea"
          rows="4"
          @blur="savePosterSettings"
        />
      </div>

      <!-- Animal list -->
      <div class="animal-section">
        <button class="animal-toggle-row" @click="showAnimalList = !showAnimalList">
          <span class="form-label" style="pointer-events:none">动物列表</span>
          <div class="animal-toggle-right">
            <span class="animal-count-badge">{{ homeStore.animals.length }} 种</span>
            <ChevronDown :size="14" :class="['chevron', { rotated: showAnimalList }]" />
          </div>
        </button>

        <div v-if="showAnimalList" class="animal-list-wrap">
          <!-- Toolbar -->
          <div class="animal-toolbar">
            <span class="animal-legend">
              <span class="used-dot" /> 已出现过
            </span>
            <button class="icon-text-btn danger-text" @click="confirmReset">
              <RotateCcw :size="12" />
              重置默认
            </button>
          </div>

          <!-- List -->
          <div class="animal-list">
            <div
              v-for="(animal, idx) in homeStore.animals"
              :key="idx"
              class="animal-row"
              :class="{ editing: editingIndex === idx }"
            >
              <!-- Edit mode -->
              <template v-if="editingIndex === idx">
                <input
                  v-model="editZh"
                  class="animal-input"
                  placeholder="中文名"
                  @keydown.enter="saveEdit(idx)"
                  @keydown.escape="cancelEdit"
                />
                <input
                  v-model="editEn"
                  class="animal-input wide"
                  placeholder="English name"
                  @keydown.enter="saveEdit(idx)"
                  @keydown.escape="cancelEdit"
                />
                <button class="row-action-btn confirm" @click="saveEdit(idx)">
                  <Check :size="12" />
                </button>
                <button class="row-action-btn cancel" @click="cancelEdit">
                  <X :size="12" />
                </button>
              </template>

              <!-- Display mode -->
              <template v-else>
                <span class="used-dot" :class="{ visible: usedAnimalNames.has(animal.zh) }" />
                <span class="animal-zh">{{ animal.zh }}</span>
                <span class="animal-en">{{ animal.en }}</span>
                <div class="row-actions">
                  <button class="row-action-btn edit" @click="startEdit(idx)" :title="'编辑'">
                    <Pencil :size="11" />
                  </button>
                  <button class="row-action-btn delete" @click="deleteAnimal(idx)" :title="'删除'">
                    <Trash2 :size="11" />
                  </button>
                </div>
              </template>
            </div>
          </div>

          <!-- Add panel -->
          <template v-if="showAddForm">
            <!-- Mode tabs -->
            <div class="add-mode-tabs">
              <button
                class="add-mode-tab"
                :class="{ active: addMode === 'single' }"
                @click="addMode = 'single'"
              >单个添加</button>
              <button
                class="add-mode-tab"
                :class="{ active: addMode === 'bulk' }"
                @click="addMode = 'bulk'"
              >批量导入</button>
            </div>

            <!-- Single mode -->
            <div v-if="addMode === 'single'" class="animal-add-row">
              <input
                v-model="newZh"
                class="animal-input"
                placeholder="中文名"
                @keydown.enter="confirmAdd"
                @keydown.escape="cancelAdd"
              />
              <input
                v-model="newEn"
                class="animal-input wide"
                placeholder="English name for AI prompt"
                @keydown.enter="confirmAdd"
                @keydown.escape="cancelAdd"
              />
              <button class="row-action-btn confirm" :disabled="!newZh.trim() || !newEn.trim()" @click="confirmAdd">
                <Check :size="12" />
              </button>
              <button class="row-action-btn cancel" @click="cancelAdd">
                <X :size="12" />
              </button>
            </div>

            <!-- Bulk mode -->
            <div v-else class="bulk-import-panel">
              <p class="bulk-hint">每行一个动物，中文名与英文名之间用逗号分隔：</p>
              <p class="bulk-example">例：<code>北极熊,Polar Bear</code></p>
              <textarea
                v-model="bulkText"
                class="bulk-textarea"
                placeholder="北极熊,Polar Bear&#10;东北虎,Amur Tiger&#10;宽吻海豚,Bottlenose Dolphin"
                rows="6"
              />
              <!-- Preview count -->
              <div class="bulk-preview-bar">
                <span v-if="bulkText.trim()" class="bulk-count">
                  解析到 <strong>{{ bulkValidCount }}</strong> 条有效数据
                  <template v-if="bulkPreview.length > bulkValidCount">
                    （{{ bulkPreview.length - bulkValidCount }} 条格式有误已忽略）
                  </template>
                </span>
                <div class="bulk-actions">
                  <button class="bulk-btn secondary" @click="cancelAdd">取消</button>
                  <button
                    class="bulk-btn primary"
                    :disabled="bulkValidCount === 0"
                    @click="confirmBulkImport"
                  >导入 {{ bulkValidCount > 0 ? bulkValidCount + ' 条' : '' }}</button>
                </div>
              </div>
            </div>
          </template>

          <!-- Add button (collapsed state) -->
          <button v-else class="add-animal-btn" @click="showAddForm = true; editingIndex = -1">
            <Plus :size="13" />
            添加动物
          </button>
        </div>
      </div>
    </div>

    <div class="section-card">
      <h2 class="section-title">{{ t('settings.trash.title') }}</h2>
      <p class="section-desc">{{ t('settings.trash.description') }}</p>
      <div class="retention-options">
        <button
          v-for="opt in RETENTION_OPTIONS"
          :key="opt.value"
          class="retention-btn"
          :class="{ active: trashRetentionDays === opt.value }"
          @click="setTrashRetention(opt.value)"
        >
          {{ opt.label() }}
        </button>
      </div>
    </div>

    <!-- ── Backend Server Config ───────────────────────────────── -->
    <div class="section-card">
      <h2 class="section-title">后端服务器配置</h2>
      <p class="section-desc">配置你的后端服务地址与鉴权 Token，论文推送与待办同步将共用该服务器。</p>

      <div class="papers-field">
        <label class="papers-label">服务地址</label>
        <input
          v-model="papers.baseUrl"
          type="text"
          class="papers-input"
          placeholder="http://your-server"
          spellcheck="false"
          autocomplete="off"
          @blur="saveBackendConn"
          @keydown.enter.prevent="saveBackendConn"
        />
      </div>

      <div class="papers-field">
        <label class="papers-label">API Key</label>
        <div class="papers-key-row">
          <input
            v-model="papers.apiKey"
            :type="papersKeyVisible ? 'text' : 'password'"
            class="papers-input"
            placeholder="Bearer Token…"
            spellcheck="false"
            autocomplete="off"
            @blur="saveBackendConn"
            @keydown.enter.prevent="saveBackendConn"
          />
          <button class="papers-icon-btn" :title="papersKeyVisible ? '隐藏' : '显示'" @click="papersKeyVisible = !papersKeyVisible">
            <EyeOff v-if="papersKeyVisible" :size="13" />
            <Eye v-else :size="13" />
          </button>
          <button class="papers-ping-btn" :disabled="!papers.baseUrl || papersPinging" @click="pingBackend">
            <span v-if="papersPinging" class="papers-spin" />
            <Wifi v-else :size="13" />
            {{ papersPinging ? '测试中…' : '测试连接' }}
          </button>
        </div>
        <div v-if="papersPingResult === 'ok'" class="papers-ping-result ok">
          <Check :size="12" /> 连接成功
        </div>
        <div v-else-if="papersPingResult === 'err'" class="papers-ping-result err">
          <WifiOff :size="12" /> 连接失败，请检查地址和 Key
        </div>
      </div>
    </div>

    <!-- Migrate confirm dialog -->
    <Teleport to="body">
      <div v-if="showMigrateConfirm" class="confirm-overlay" @click="showMigrateConfirm = false">
        <div class="confirm-dialog" @click.stop>
          <div class="confirm-icon">
            <AlertTriangle :size="28" />
          </div>
          <p class="confirm-title">{{ t('settings.dataPath.migrateTitle') }}</p>
          <p class="confirm-desc">{{ t('settings.dataPath.migrateDesc') }}</p>
          <div class="confirm-actions">
            <button class="confirm-btn secondary" @click="showMigrateConfirm = false">
              <X :size="14" />
              {{ t('common.cancel') }}
            </button>
            <button class="confirm-btn primary" @click="confirmMigrate">
              <Check :size="14" />
              {{ t('common.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Delete old dir confirm dialog -->
    <Teleport to="body">
      <div v-if="showDeleteOldConfirm" class="confirm-overlay" @click="showDeleteOldConfirm = false">
        <div class="confirm-dialog wide" @click.stop>
          <div class="confirm-icon">
            <AlertTriangle :size="28" />
          </div>
          <p class="confirm-title">{{ t('settings.dataPath.deleteOldTitle') }}</p>
          <p class="confirm-desc">{{ t('settings.dataPath.deleteOldDesc') }}</p>
          <div class="old-dir-list">
            <div
              v-for="entry in oldDirEntries"
              :key="entry.name"
              class="old-dir-item"
            >
              <span class="old-dir-icon">{{ entry.isDirectory ? '📁' : '📄' }}</span>
              <span class="old-dir-name">{{ entry.name }}</span>
            </div>
          </div>
          <div class="confirm-actions">
            <button class="confirm-btn secondary" @click="showDeleteOldConfirm = false">
              <X :size="14" />
              {{ t('settings.dataPath.keepOld') }}
            </button>
            <button class="confirm-btn danger" @click="confirmDeleteOld">
              <Check :size="14" />
              {{ t('settings.dataPath.deleteOld') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.general-settings {
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
  gap: 10px;
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
  margin: -4px 0 4px;
  line-height: 1.5;
}

.lang-list { display: flex; flex-direction: column; gap: 4px; }

.lang-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1.5px solid transparent;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  transition: all 0.12s;
  width: 100%;
  text-align: left;
}

.lang-item:hover { background: rgba(0, 0, 0, 0.04); }

.lang-item.active {
  background: rgba(34, 63, 121, 0.07);
  border-color: rgba(34, 63, 121, 0.20);
}

.lang-flag { font-size: 18px; }

.lang-label { font-size: 14px; color: #1c1c1e; flex: 1; }

.lang-check { font-size: 13px; color: #223F79; font-weight: 600; }

/* Data path */
.path-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.path-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.path-label {
  font-size: 11px;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.path-value {
  font-size: 12px;
  color: #3c3c43;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
  word-break: break-all;
  background: rgba(0,0,0,0.03);
  padding: 6px 8px;
  border-radius: 6px;
}

.path-value.custom {
  color: #223F79;
  background: rgba(34, 63, 121, 0.06);
}

.path-actions {
  display: flex;
  gap: 8px;
}

.path-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 8px;
  border: none;
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s;
}

.path-btn:hover {
  background: rgba(34, 63, 121, 0.18);
}

.path-btn.secondary {
  background: rgba(0, 0, 0, 0.05);
  color: #3c3c43;
}

.path-btn.secondary:hover {
  background: rgba(0, 0, 0, 0.10);
}

.migrate-error {
  font-size: 12px;
  color: #ff3b30;
  background: rgba(255, 59, 48, 0.06);
  padding: 8px 10px;
  border-radius: 8px;
  margin-top: 4px;
}

/* Confirm dialog */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  backdrop-filter: blur(2px);
}

.confirm-dialog {
  background: white;
  border-radius: 14px;
  padding: 22px 24px;
  width: 340px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
}

.confirm-icon {
  color: #ff9500;
}

.confirm-title {
  font-size: 15px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0;
  text-align: center;
}

.confirm-desc {
  font-size: 12px;
  color: #8e8e93;
  text-align: center;
  margin: 0;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: 10px;
  width: 100%;
  margin-top: 6px;
}

.confirm-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 8px 0;
  border-radius: 8px;
  border: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s;
}

.confirm-btn.secondary {
  background: rgba(0, 0, 0, 0.05);
  color: #3c3c43;
}

.confirm-btn.secondary:hover {
  background: rgba(0, 0, 0, 0.10);
}

.confirm-btn.primary {
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
}

.confirm-btn.primary:hover {
  background: rgba(34, 63, 121, 0.18);
}

.confirm-btn.danger {
  background: #ff3b30;
  color: white;
}

.confirm-btn.danger:hover {
  background: #e6352b;
}

.confirm-dialog.wide {
  width: 400px;
}

.old-dir-list {
  max-height: 180px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 8px;
  padding: 8px 10px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.old-dir-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 5px;
  font-size: 12px;
  color: #1c1c1e;
}

.old-dir-icon {
  font-size: 13px;
  flex-shrink: 0;
}

.old-dir-name {
  word-break: break-all;
}

/* Trash retention */
.retention-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.retention-btn {
  padding: 5px 12px;
  border-radius: 8px;
  border: 1.5px solid transparent;
  background: rgba(0, 0, 0, 0.04);
  color: #3c3c43;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s;
}

.retention-btn:hover {
  background: rgba(0, 0, 0, 0.08);
}

.retention-btn.active {
  background: rgba(34, 63, 121, 0.08);
  border-color: rgba(34, 63, 121, 0.25);
  color: #223F79;
}

/* Poster settings */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.toggle-label {
  font-size: 13px;
  color: #1c1c1e;
}

.toggle-btn {
  width: 44px;
  height: 26px;
  border-radius: 13px;
  border: none;
  background: rgba(0,0,0,0.12);
  cursor: pointer;
  transition: background 0.2s;
  padding: 3px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.toggle-btn.active {
  background: #223F79;
  justify-content: flex-end;
}

.toggle-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  transition: none;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.form-label {
  font-size: 13px;
  color: #3c3c43;
  width: 100px;
  flex-shrink: 0;
}

.form-control {
  flex: 1;
}

.select-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,0.12);
  background: white;
  font-size: 13px;
  color: #1c1c1e;
  cursor: pointer;
  outline: none;
}

.select-input:focus {
  border-color: rgba(34, 63, 121, 0.35);
}

.no-models-hint {
  font-size: 12px;
  color: #ff9500;
  line-height: 1.4;
}

.freq-options {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.freq-btn {
  padding: 5px 12px;
  border-radius: 8px;
  border: 1.5px solid transparent;
  background: rgba(0,0,0,0.04);
  color: #3c3c43;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s;
}

.freq-btn:hover {
  background: rgba(0,0,0,0.08);
}

.freq-btn.active {
  background: rgba(34, 63, 121, 0.08);
  border-color: rgba(34, 63, 121, 0.25);
  color: #223F79;
}

.number-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.number-input {
  width: 70px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,0.12);
  background: white;
  font-size: 13px;
  color: #1c1c1e;
  text-align: center;
  outline: none;
}

.number-input:focus {
  border-color: rgba(34, 63, 121, 0.35);
}

.number-unit {
  font-size: 13px;
  color: #8e8e93;
}

.prompt-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prompt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.reset-btn {
  font-size: 12px;
  color: #8e8e93;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 5px;
  transition: color 0.12s, background 0.12s;
}

.reset-btn:hover {
  color: #3c3c43;
  background: rgba(0,0,0,0.05);
}

.prompt-textarea {
  width: 100%;
  padding: 9px 11px;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,0.12);
  background: white;
  font-size: 12px;
  color: #1c1c1e;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.prompt-textarea:focus {
  border-color: rgba(34, 63, 121, 0.35);
}

/* ── Animal list ─────────────────────────────────────────────────────────── */

.animal-section {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.animal-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 4px 0;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.1s;
}

.animal-toggle-row:hover {
  background: rgba(0, 0, 0, 0.03);
}

.animal-toggle-right {
  display: flex;
  align-items: center;
  gap: 7px;
}

.animal-count-badge {
  font-size: 11px;
  color: #8e8e93;
  background: rgba(0, 0, 0, 0.06);
  padding: 2px 7px;
  border-radius: 10px;
}

.chevron {
  color: #8e8e93;
  transition: transform 0.18s;
}

.chevron.rotated {
  transform: rotate(180deg);
}

.animal-list-wrap {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  overflow: hidden;
}

.animal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 11px;
  background: rgba(0, 0, 0, 0.02);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.animal-legend {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #8e8e93;
}

.icon-text-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  background: none;
  border: none;
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 5px;
  transition: background 0.1s;
}

.icon-text-btn.danger-text { color: #ff3b30; }

.icon-text-btn:hover {
  background: rgba(0, 0, 0, 0.06);
}

.animal-list {
  max-height: 320px;
  overflow-y: auto;
}

.animal-list::-webkit-scrollbar { width: 3px; }
.animal-list::-webkit-scrollbar-track { background: transparent; }
.animal-list::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

.animal-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 11px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  min-height: 36px;
  transition: background 0.1s;
}

.animal-row:last-child { border-bottom: none; }

.animal-row:not(.editing):hover {
  background: rgba(0, 0, 0, 0.025);
}

.animal-row.editing {
  background: rgba(34, 63, 121, 0.04);
}

.used-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: transparent;
  flex-shrink: 0;
  transition: background 0.15s;
}

.used-dot.visible {
  background: #34c759;
}

.animal-zh {
  font-size: 13px;
  color: #1c1c1e;
  font-weight: 500;
  width: 72px;
  flex-shrink: 0;
}

.animal-en {
  font-size: 12px;
  color: #8e8e93;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s;
}

.animal-row:hover .row-actions {
  opacity: 1;
}

.row-action-btn {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}

.row-action-btn.edit   { color: #8e8e93; }
.row-action-btn.edit:hover { background: rgba(0,0,0,0.07); color: #3c3c43; }

.row-action-btn.delete { color: #8e8e93; }
.row-action-btn.delete:hover { background: rgba(255,59,48,0.08); color: #ff3b30; }

.row-action-btn.confirm { color: #34c759; }
.row-action-btn.confirm:hover { background: rgba(52,199,89,0.10); }

.row-action-btn.cancel { color: #8e8e93; }
.row-action-btn.cancel:hover { background: rgba(0,0,0,0.07); }

.animal-input {
  height: 26px;
  padding: 0 7px;
  border-radius: 6px;
  border: 1px solid rgba(34, 63, 121, 0.25);
  background: white;
  font-size: 12px;
  color: #1c1c1e;
  outline: none;
  width: 76px;
  flex-shrink: 0;
}

.animal-input.wide {
  flex: 1;
  width: auto;
}

.animal-input:focus {
  border-color: rgba(34, 63, 121, 0.45);
}

.animal-add-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(34, 63, 121, 0.03);
}

.add-animal-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  padding: 9px 0;
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: transparent;
  color: #223F79;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s;
}

.add-animal-btn:hover {
  background: rgba(34, 63, 121, 0.05);
}

/* ── Add mode tabs ─────────────────────────────────────────────────────────── */

.add-mode-tabs {
  display: flex;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(0, 0, 0, 0.02);
}

.add-mode-tab {
  flex: 1;
  padding: 7px 0;
  border: none;
  background: transparent;
  font-size: 12px;
  color: #8e8e93;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
  border-bottom: 2px solid transparent;
}

.add-mode-tab.active {
  color: #223F79;
  background: rgba(34, 63, 121, 0.04);
  border-bottom-color: #223F79;
}

/* ── Bulk import panel ─────────────────────────────────────────────────────── */

.bulk-import-panel {
  padding: 10px 11px 8px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bulk-hint {
  font-size: 12px;
  color: #3c3c43;
  margin: 0;
}

.bulk-example {
  font-size: 11px;
  color: #8e8e93;
  margin: 0;
}

.bulk-example code {
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
}

.bulk-textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: white;
  font-size: 12px;
  color: #1c1c1e;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
  line-height: 1.7;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.bulk-textarea:focus {
  border-color: rgba(34, 63, 121, 0.35);
}

.bulk-preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  gap: 8px;
}

.bulk-count {
  font-size: 11px;
  color: #8e8e93;
  flex: 1;
}

.bulk-count strong {
  color: #34c759;
  font-weight: 600;
}

.bulk-actions {
  display: flex;
  gap: 6px;
}

.bulk-btn {
  padding: 5px 14px;
  border-radius: 8px;
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.12s, background 0.12s;
}

.bulk-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.bulk-btn.secondary {
  background: rgba(0, 0, 0, 0.06);
  color: #3c3c43;
}

.bulk-btn.secondary:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.10);
}

.bulk-btn.primary {
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
}

.bulk-btn.primary:hover:not(:disabled) {
  background: rgba(34, 63, 121, 0.18);
}

/* ── ArXiv backend ──────────────────────────────────────────────────────────── */

.papers-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.papers-label {
  font-size: 12px;
  font-weight: 500;
  color: #3c3c43;
}

.papers-input {
  height: 32px;
  border: 1.5px solid rgba(0, 0, 0, 0.10);
  border-radius: 8px;
  padding: 0 10px;
  font-size: 13px;
  color: #1c1c1e;
  background: white;
  outline: none;
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
  transition: border-color 0.15s;
}

.papers-input:focus { border-color: rgba(34, 63, 121, 0.4); }

.papers-key-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.papers-key-row .papers-input { flex: 1; width: auto; }

.papers-icon-btn {
  width: 32px; height: 32px;
  border: 1.5px solid rgba(0, 0, 0, 0.10);
  border-radius: 8px; background: white; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: #8e8e93; flex-shrink: 0; transition: border-color 0.15s, color 0.15s;
}
.papers-icon-btn:hover { color: #3c3c43; border-color: rgba(0,0,0,0.2); }

.papers-ping-btn {
  display: flex; align-items: center; gap: 5px;
  height: 32px; padding: 0 12px;
  border: 1.5px solid rgba(34, 63, 121, 0.2);
  border-radius: 8px;
  background: rgba(34, 63, 121, 0.06);
  color: #223F79;
  font-size: 12px; font-weight: 500;
  cursor: pointer; flex-shrink: 0;
  transition: background 0.12s;
}
.papers-ping-btn:hover:not(:disabled) { background: rgba(34, 63, 121, 0.12); }
.papers-ping-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.papers-spin {
  width: 12px; height: 12px;
  border: 1.5px solid rgba(34, 63, 121, 0.3);
  border-top-color: #223F79;
  border-radius: 50%;
  animation: papers-rotate 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes papers-rotate { to { transform: rotate(360deg); } }

.papers-ping-result {
  display: flex; align-items: center; gap: 5px;
  font-size: 12px; font-weight: 500;
  padding: 5px 8px;
  border-radius: 7px;
}
.papers-ping-result.ok  { background: rgba(52, 199, 89, 0.10); color: #34c759; }
.papers-ping-result.err { background: rgba(255, 59, 48, 0.08); color: #ff3b30; }
</style>
