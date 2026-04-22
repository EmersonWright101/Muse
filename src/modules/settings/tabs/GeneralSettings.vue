<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpen, AlertTriangle, Check, X } from 'lucide-vue-next'
import { open } from '@tauri-apps/plugin-dialog'
import { readDir, remove } from '@tauri-apps/plugin-fs'
import { getDataRoot, setDataRoot, resolveDataRoot, migrateData } from '../../../utils/path'

const { locale, t } = useI18n()

const languages = [
  { code: 'zh-CN', label: '简体中文', flag: '🇨🇳' },
  { code: 'en-US', label: 'English',  flag: '🇺🇸' },
]

function setLocale(code: string) {
  locale.value = code
  localStorage.setItem('muse-locale', code)
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
      <h2 class="section-title">对话记录</h2>
      <div class="info-row">
        <span class="info-label">储存位置</span>
        <span class="info-value">{{ currentPath }}/conversations</span>
      </div>
      <div class="info-row">
        <span class="info-label">加密方式</span>
        <span class="info-value">API Key 使用 AES-256-GCM 加密存储</span>
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

.info-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.info-label {
  font-size: 13px;
  color: #8e8e93;
  width: 70px;
  flex-shrink: 0;
}

.info-value {
  font-size: 13px;
  color: #3c3c43;
  word-break: break-all;
}
</style>
