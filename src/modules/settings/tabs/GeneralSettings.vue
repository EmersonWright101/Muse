<script setup lang="ts">
import { ref, onMounted, computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpen, AlertTriangle, Check, X, Eye, EyeOff, Wifi, WifiOff, HardDrive } from 'lucide-vue-next'
import { usePapersStore } from '../../../stores/papers'
import { open } from '@tauri-apps/plugin-dialog'
import { readDir, remove, stat } from '@tauri-apps/plugin-fs'
import { getDataRoot, setDataRoot, resolveDataRoot, migrateData } from '../../../utils/path'
import { getTrashRetentionDays, setTrashRetentionDays } from '../../../utils/travelStorage'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useStatisticsStore } from '../../../stores/statistics'
import { pushGeneralSettings, tryNewSync } from '../../../services/syncManager2'

const { locale, t } = useI18n()
const statsStore = useStatisticsStore()

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
  pushGeneralSettings().catch(() => {})
}

const languages = [
  { code: 'zh-CN', label: '简体中文', flag: '🇨🇳' },
  { code: 'en-US', label: 'English',  flag: '🇺🇸' },
]

function setLocale(code: string) {
  locale.value = code
  localStorage.setItem('muse-locale', code)
  pushGeneralSettings().catch(() => {})
}

const currencies = [
  { code: 'usd', label: 'USD', symbol: '$' },
  { code: 'cny', label: 'CNY', symbol: '¥' },
]

function setCurrency(code: string) {
  statsStore.setCurrency(code as 'usd' | 'cny')
  pushGeneralSettings().catch(() => {})
}

// ── ArXiv backend connection ─────────────────────────────────────────────────

const papers = usePapersStore()
const papersKeyVisible = ref(false)
const papersPinging    = ref(false)
const papersPingResult = ref<'ok' | 'err' | null>(null)

function saveBackendConn() {
  papers.persistConn()
  papersPingResult.value = null
  tryNewSync().catch(() => {})
}

async function pingBackend() {
  if (!papers.baseUrl) return
  papersPinging.value = true
  papersPingResult.value = null
  try {
    const r = await tauriFetch(`${papers.baseUrl}/api/papers/ping`, {
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

// Directory size
const dirSizeBytes  = shallowRef<number | null>(null)
const dirSizeLoading = ref(false)


function formatBytes(bytes: number): string {
  if (bytes < 1024)              return `${bytes} B`
  if (bytes < 1024 * 1024)      return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3)        return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

const formattedDirSize = computed(() =>
  dirSizeBytes.value !== null ? formatBytes(dirSizeBytes.value) : '—'
)

async function calcDirSize(dirPath: string): Promise<number> {
  try {
    const entries = await readDir(dirPath)
    const sizes = await Promise.all(entries.map(async (entry): Promise<number> => {
      const child = `${dirPath}/${entry.name}`
      if (entry.isFile) {
        try { return (await stat(child)).size ?? 0 } catch { return 0 }
      }
      if (entry.isDirectory) return calcDirSize(child)
      return 0
    }))
    return sizes.reduce((a, b) => a + b, 0)
  } catch { return 0 }
}

async function refreshPath() {
  const root = await resolveDataRoot()
  currentPath.value = root
  isCustom.value = !!getDataRoot()
  dirSizeLoading.value = true
  dirSizeBytes.value   = null
  calcDirSize(root).then(n => { dirSizeBytes.value = n }).finally(() => { dirSizeLoading.value = false })
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

async function openDataFolder() {
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
    await revealItemInDir(currentPath.value)
  } catch (e) {
    console.error('openDataFolder failed:', e)
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
          <button class="path-btn secondary" @click="openDataFolder">
            <FolderOpen :size="14" />
            打开文件夹
          </button>
          <div class="storage-badge" :class="{ loading: dirSizeLoading }">
            <HardDrive :size="12" class="storage-icon" />
            <span class="storage-label">本地占用</span>
            <span v-if="dirSizeLoading" class="storage-size">计算中…</span>
            <span v-else class="storage-size">{{ formattedDirSize }}</span>
          </div>
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

    <div class="section-card">
      <h2 class="section-title">货币单位 / Currency</h2>
      <div class="lang-list">
        <button
          v-for="curr in currencies"
          :key="curr.code"
          class="lang-item"
          :class="{ active: statsStore.currency === curr.code }"
          @click="setCurrency(curr.code)"
        >
          <span class="lang-flag">{{ curr.symbol }}</span>
          <span class="lang-label">{{ curr.label }}</span>
          <span v-if="statsStore.currency === curr.code" class="lang-check">✓</span>
        </button>
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

    <!-- ── AI Model Path (read-only) ────────────────────────────── -->
    <div class="section-card">
      <h2 class="section-title">本地 AI 工具模型路径</h2>
      <p class="section-desc">本地 AI 工具（如背景消除）所需的模型权重文件存放在数据目录下的 <code>models/</code> 子目录中。此路径不影响在线 AI 服务商的配置。</p>
      <div class="path-row">
        <div class="path-info">
          <span class="path-label">默认路径</span>
          <span class="path-value">{{ currentPath }}/models</span>
        </div>
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
  align-items: center;
  gap: 8px;
}

.storage-badge {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px 5px 9px;
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 20px;
  white-space: nowrap;
  transition: opacity 0.2s;
}

.storage-badge.loading { opacity: 0.55; }

.storage-icon { color: #8e8e93; flex-shrink: 0; }

.storage-label {
  font-size: 11px;
  color: #aeaeb2;
  font-weight: 400;
}

.storage-size {
  font-size: 12px;
  font-weight: 600;
  color: #6e6e73;
  font-variant-numeric: tabular-nums;
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
