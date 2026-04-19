<script setup lang="ts">
import { ref } from 'vue'
import { CloudUpload, RefreshCw, CheckCircle2, XCircle, Loader2, Eye, EyeOff } from 'lucide-vue-next'
import { useSyncStore } from '../../../stores/sync'

const sync = useSyncStore()

const showPass     = ref(false)
const testResult   = ref<{ ok: boolean; message: string } | null>(null)
const testLoading  = ref(false)

async function testConn() {
  testLoading.value = true
  testResult.value  = null
  testResult.value  = await sync.testConnection()
  testLoading.value = false
}

const INTERVALS = [
  { label: '手动', value: 0 },
  { label: '每 5 分钟', value: 5 },
  { label: '每 15 分钟', value: 15 },
  { label: '每 30 分钟', value: 30 },
  { label: '每小时', value: 60 },
]

function stateLabel(): string {
  switch (sync.status.state) {
    case 'syncing':  return '同步中…'
    case 'success':  return `上次同步: ${fmtTime(sync.status.lastSyncAt)}`
    case 'error':    return `错误: ${sync.status.lastError}`
    case 'uptodate': return '已是最新'
    default:         return sync.status.lastSyncAt ? `上次同步: ${fmtTime(sync.status.lastSyncAt)}` : '从未同步'
  }
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="sync-settings">
    <h1 class="page-title">WebDAV 同步</h1>
    <p class="page-desc">将对话历史和 AI 配置加密同步到 WebDAV 服务器（如坚果云、Nextcloud 等）。</p>

    <!-- Enable toggle -->
    <div class="section-card">
      <div class="card-row">
        <div>
          <div class="row-title">启用同步</div>
          <div class="row-sub">开启后将按设定间隔自动同步</div>
        </div>
        <label class="toggle-switch">
          <input v-model="sync.config.enabled" type="checkbox" />
          <span class="toggle-track"><span class="toggle-thumb" /></span>
        </label>
      </div>
    </div>

    <!-- Connection settings -->
    <div class="section-card">
      <h2 class="section-title">服务器配置</h2>

      <div class="form-group">
        <label class="form-label">服务器地址</label>
        <input
          v-model="sync.config.serverUrl"
          type="url"
          class="form-input"
          placeholder="https://dav.jianguoyun.com/dav/"
        />
      </div>

      <div class="form-group">
        <label class="form-label">用户名</label>
        <input
          v-model="sync.config.username"
          type="text"
          class="form-input"
          placeholder="账号邮箱或用户名"
          autocomplete="off"
        />
      </div>

      <div class="form-group">
        <label class="form-label">密码</label>
        <div class="pass-row">
          <input
            v-model="sync.config.password"
            :type="showPass ? 'text' : 'password'"
            class="form-input"
            placeholder="WebDAV 密码（用于加密数据）"
            autocomplete="new-password"
          />
          <button class="eye-btn" @click="showPass = !showPass">
            <EyeOff v-if="showPass" :size="14" />
            <Eye v-else :size="14" />
          </button>
        </div>
        <p class="field-hint">密码同时作为本地加密密钥，更改密码后需重新同步。</p>
      </div>

      <div class="form-group">
        <label class="form-label">远端目录</label>
        <input
          v-model="sync.config.remotePath"
          type="text"
          class="form-input"
          placeholder="MuseApp"
        />
      </div>

      <!-- Test connection -->
      <div class="test-row">
        <button class="test-btn" :disabled="testLoading" @click="testConn()">
          <Loader2 v-if="testLoading" :size="13" class="spin" />
          <span v-else>测试连接</span>
        </button>
        <div v-if="testResult" class="test-result" :class="{ ok: testResult.ok, err: !testResult.ok }">
          <CheckCircle2 v-if="testResult.ok" :size="13" />
          <XCircle v-else :size="13" />
          {{ testResult.message }}
        </div>
      </div>
    </div>

    <!-- Auto-sync interval -->
    <div class="section-card">
      <h2 class="section-title">自动同步</h2>
      <div class="form-group">
        <label class="form-label">同步频率</label>
        <select v-model="sync.config.autoSyncIntervalMinutes" class="form-select">
          <option v-for="opt in INTERVALS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
    </div>

    <!-- Status & sync now -->
    <div class="sync-status-card">
      <div class="status-info">
        <div class="status-state" :class="sync.status.state">
          <div class="state-dot" />
          <span>{{ stateLabel() }}</span>
        </div>
        <div v-if="sync.status.progress" class="status-progress">{{ sync.status.progress }}</div>
      </div>
      <button
        class="sync-now-btn"
        :disabled="sync.status.state === 'syncing' || !sync.config.enabled"
        @click="sync.syncNow()"
      >
        <RefreshCw :size="14" :class="{ spin: sync.status.state === 'syncing' }" />
        立即同步
      </button>
    </div>

    <!-- Info -->
    <div class="info-card">
      <CloudUpload :size="16" class="info-icon" />
      <p class="info-text">
        同步内容包括：所有对话历史、AI 供应商配置（含 API Key）。
        所有数据在上传前均使用 AES-256-GCM 加密，服务器无法读取原始内容。
      </p>
    </div>
  </div>
</template>

<style scoped>
.sync-settings {
  padding: 28px 32px;
  max-width: 580px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: #1c1c1e;
  margin: 0 0 4px;
}

.page-desc {
  font-size: 13px;
  color: #8e8e93;
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
  margin: 0 0 2px;
}

.card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.row-title {
  font-size: 14px;
  font-weight: 500;
  color: #1c1c1e;
}

.row-sub {
  font-size: 12px;
  color: #8e8e93;
  margin-top: 2px;
}

/* Toggle */
.toggle-switch { position: relative; display: inline-flex; align-items: center; cursor: pointer; }
.toggle-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.toggle-track { width: 36px; height: 22px; background: rgba(0, 0, 0, 0.15); border-radius: 11px; transition: background 0.2s; position: relative; }
.toggle-switch input:checked + .toggle-track { background: #223F79; }
.toggle-thumb { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; background: white; border-radius: 50%; transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
.toggle-switch input:checked + .toggle-track .toggle-thumb { transform: translateX(14px); }

/* Form */
.form-group { display: flex; flex-direction: column; gap: 5px; }

.form-label {
  font-size: 12px;
  font-weight: 500;
  color: #6e6e73;
}

.form-input {
  height: 34px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 9px;
  padding: 0 12px;
  font-size: 13px;
  color: #1c1c1e;
  background: white;
  outline: none;
  transition: border-color 0.15s;
}

.form-input:focus { border-color: rgba(34, 63, 121, 0.4); }

.pass-row { display: flex; gap: 6px; }
.pass-row .form-input { flex: 1; }

.eye-btn {
  width: 34px;
  height: 34px;
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 9px;
  background: white;
  color: #8e8e93;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.eye-btn:hover { background: #f5f5f7; }

.field-hint {
  font-size: 11px;
  color: #aeaeb2;
  margin: 0;
}

.form-select {
  height: 34px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 9px;
  padding: 0 12px;
  font-size: 13px;
  color: #1c1c1e;
  background: white;
  outline: none;
  cursor: pointer;
}

/* Test connection */
.test-row { display: flex; align-items: center; gap: 12px; }

.test-btn {
  height: 32px;
  padding: 0 16px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  background: white;
  font-size: 13px;
  color: #3c3c43;
  cursor: pointer;
  transition: background 0.12s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.test-btn:hover:not(:disabled) { background: #f5f5f7; }
.test-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.test-result {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}

.test-result.ok { color: #34c759; }
.test-result.err { color: #ff3b30; }

/* Sync status card */
.sync-status-card {
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.status-info { display: flex; flex-direction: column; gap: 3px; }

.status-state {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: #3c3c43;
}

.state-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #aeaeb2;
  flex-shrink: 0;
}

.status-state.syncing .state-dot  { background: #007aff; animation: pulse 1s infinite; }
.status-state.success .state-dot  { background: #34c759; }
.status-state.error   .state-dot  { background: #ff3b30; }
.status-state.uptodate .state-dot { background: #34c759; }

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

.status-progress { font-size: 11px; color: #8e8e93; }

.sync-now-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 16px;
  background: #223F79;
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.12s;
  flex-shrink: 0;
}

.sync-now-btn:hover:not(:disabled) { opacity: 0.85; }
.sync-now-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Info card */
.info-card {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  background: rgba(34, 63, 121, 0.04);
  border: 1px solid rgba(34, 63, 121, 0.10);
  border-radius: 12px;
}

.info-icon { color: #223F79; flex-shrink: 0; margin-top: 1px; }

.info-text {
  font-size: 12px;
  color: #6e6e73;
  margin: 0;
  line-height: 1.55;
}

/* Spinner */
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
