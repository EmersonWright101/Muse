<script setup lang="ts">
import { Cloud, CloudOff } from 'lucide-vue-next'
import { useTodoStore } from '../../../stores/todo'

const store = useTodoStore()

function disconnect() {
  store.saveApiConfig(null)
}
</script>

<template>
  <div class="todo-settings">
    <div class="section-title">待办 · 后端同步</div>
    <p class="section-desc">待办数据通过通用设置中的后端服务器进行同步，本地文件仍作为备份。</p>

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

.hint {
  margin-top: 16px;
  font-size: 12px;
  color: #aeaeb2;
  line-height: 1.5;
}

</style>
