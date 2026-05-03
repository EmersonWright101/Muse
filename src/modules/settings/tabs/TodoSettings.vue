<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Cloud, CloudOff, Loader, RefreshCw } from 'lucide-vue-next'
import { useTodoStore } from '../../../stores/todo'

const store = useTodoStore()

const apiUrl    = ref('')
const apiKey    = ref('')
const testing   = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)
const saved      = ref(false)

onMounted(() => {
  apiUrl.value = localStorage.getItem('muse-todo-api-url') ?? ''
  apiKey.value = localStorage.getItem('muse-todo-api-key') ?? ''
})

async function testConnection() {
  if (!apiUrl.value.trim()) return
  testing.value   = true
  testResult.value = null
  testResult.value = await store.testApiConnection({ url: apiUrl.value.trim(), apiKey: apiKey.value.trim() })
  testing.value   = false
}

function save() {
  const url = apiUrl.value.trim()
  store.saveApiConfig(url ? { url, apiKey: apiKey.value.trim() } : null)
  if (url) store.load()
  saved.value = true
  setTimeout(() => { saved.value = false }, 1800)
}

function disconnect() {
  store.saveApiConfig(null)
  apiUrl.value    = ''
  apiKey.value    = ''
  testResult.value = null
}
</script>

<template>
  <div class="todo-settings">
    <div class="section-title">待办 · 后端连接</div>
    <p class="section-desc">配置远程后端后，任务数据将同步到服务器，本地文件仍作为备份。</p>

    <!-- Status badge -->
    <div class="status-row">
      <div class="status-badge" :class="store.apiStatus">
        <Cloud v-if="store.apiStatus === 'connected'" :size="13" />
        <CloudOff v-else :size="13" />
        <span>{{
          store.apiStatus === 'connected' ? '已连接后端' :
          store.apiStatus === 'error'     ? '连接异常' : '本地模式'
        }}</span>
      </div>
      <button v-if="store.apiStatus === 'connected'" class="link-btn danger" @click="disconnect">断开连接</button>
    </div>

    <!-- Pending offline changes -->
    <div v-if="store.pendingCount > 0" class="pending-banner">
      ⏳ {{ store.pendingCount }} 条离线改动待同步，重连后将自动推送到后端
    </div>

    <!-- Error message -->
    <div v-if="store.apiStatus === 'error' && store.apiError" class="error-banner">
      {{ store.apiError }}
    </div>

    <!-- Form -->
    <div class="form-block">
      <label class="field-label">服务地址</label>
      <input
        v-model="apiUrl"
        class="field-input"
        placeholder="http://localhost:3000"
        @keydown.enter="save"
      />

      <label class="field-label">API Key</label>
      <input
        v-model="apiKey"
        class="field-input"
        type="password"
        placeholder="留空则不鉴权"
        @keydown.enter="save"
      />

      <!-- Test result -->
      <div v-if="testResult" class="test-result" :class="{ ok: testResult.ok, fail: !testResult.ok }">
        {{ testResult.ok ? '✓' : '✗' }} {{ testResult.message }}
      </div>

      <div class="form-actions">
        <button class="btn secondary" :disabled="testing || !apiUrl.trim()" @click="testConnection">
          <Loader v-if="testing" :size="13" class="spin" />
          <RefreshCw v-else :size="13" />
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <button class="btn primary" @click="save">
          {{ saved ? '已保存 ✓' : '保存' }}
        </button>
      </div>
    </div>

    <div class="hint">
      <strong>提示：</strong>本地数据始终保存一份备份，断开连接后可继续正常使用。
    </div>
  </div>
</template>

<style scoped>
.todo-settings {
  padding: 28px 32px;
  max-width: 560px;
}

.section-title {
  font-size: 17px;
  font-weight: 700;
  color: #1c1c1e;
  margin-bottom: 6px;
}

.section-desc {
  font-size: 13px;
  color: #8e8e93;
  margin: 0 0 20px;
  line-height: 1.5;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  background: rgba(142, 142, 147, 0.12);
  color: #8e8e93;
}

.status-badge.connected {
  background: rgba(52, 199, 89, 0.12);
  color: #34c759;
}

.status-badge.error {
  background: rgba(255, 59, 48, 0.10);
  color: #ff3b30;
}

.link-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: #8e8e93;
  padding: 0;
}

.link-btn.danger:hover { color: #ff3b30; }

.pending-banner {
  background: rgba(255, 149, 0, 0.08);
  border: 1px solid rgba(255, 149, 0, 0.22);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: #ff9500;
  margin-bottom: 16px;
}

.error-banner {
  background: rgba(255, 59, 48, 0.08);
  border: 1px solid rgba(255, 59, 48, 0.20);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: #ff3b30;
  margin-bottom: 16px;
}

.form-block {
  background: #f9f9fb;
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 4px;
}

.field-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  background: white;
  font-size: 13px;
  color: #1c1c1e;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}

.field-input:focus {
  border-color: #007aff;
}

.test-result {
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 12px;
}

.test-result.ok   { background: rgba(52, 199, 89, 0.10); color: #34c759; }
.test-result.fail { background: rgba(255, 59, 48, 0.08); color: #ff3b30; }

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.1s;
}

.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.primary   { background: #007aff; color: white; }
.btn.secondary { background: rgba(0, 0, 0, 0.07); color: #1c1c1e; }

.hint {
  margin-top: 16px;
  font-size: 12px;
  color: #aeaeb2;
  line-height: 1.5;
}

@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.8s linear infinite; }
</style>
