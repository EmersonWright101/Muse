<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { X } from 'lucide-vue-next';
import { updateStore, initUpdateStore, checkForUpdates, startUpdate } from '../../../stores/update';

onMounted(() => {
  initUpdateStore();
});

const renderedNotes = computed(() => {
  if (!updateStore.releaseNotes) return '';
  try {
    const raw = marked.parse(updateStore.releaseNotes) as string;
    return DOMPurify.sanitize(raw);
  } catch {
    return updateStore.releaseNotes;
  }
});
</script>

<template>
  <!-- Release Notes Modal -->
  <Teleport to="body">
    <div v-if="updateStore.showReleaseNotes" class="rn-overlay" @click.self="updateStore.showReleaseNotes = false">
      <div class="rn-modal">
        <div class="rn-header">
          <div class="rn-title-wrap">
            <span class="rn-badge">v{{ updateStore.newVersion }}</span>
            <h2 class="rn-title">更新内容</h2>
          </div>
          <button class="rn-close" @click="updateStore.showReleaseNotes = false">
            <X :size="16" />
          </button>
        </div>
        <div class="rn-body markdown-body" v-html="renderedNotes" />
        <div class="rn-footer">
          <button class="rn-dismiss" @click="updateStore.showReleaseNotes = false">稍后</button>
          <button class="rn-install" @click="startUpdate(); updateStore.showReleaseNotes = false">
            立即更新
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <div class="about-settings">
    <div class="app-hero">
      <div class="app-logo">
        <span>M</span>
      </div>
      <div class="app-info">
        <h1 class="app-name">Muse</h1>
        <span class="app-version">版本 {{ updateStore.version || '0.1.0' }}</span>
      </div>
    </div>

    <p class="app-desc">
      Muse 是一款私密、安全的个人 AI 助手桌面应用。
      支持多家 AI 供应商，对话历史本地加密存储，可选 WebDAV 云同步。
    </p>

    <div class="section-card">
      <div class="info-row">
        <span class="row-label">框架</span>
        <span class="row-val">Tauri 2 + Vue 3</span>
      </div>
      <div class="info-row">
        <span class="row-label">AI 加密</span>
        <span class="row-val">AES-256-GCM + PBKDF2-SHA256</span>
      </div>
      <div class="info-row">
        <span class="row-label">许可</span>
        <span class="row-val">MIT License</span>
      </div>
    </div>

    <!-- 检查更新 -->
    <div class="section-card update-card">
      <div class="update-header">
        <span class="update-title">检查更新</span>
        <span v-if="updateStore.state === 'available'" class="update-badge">有新版本</span>
      </div>

      <!-- 版本信息 -->
      <div class="version-row">
        <span class="row-label">当前版本</span>
        <span class="row-val">{{ updateStore.version || '—' }}</span>
      </div>
      <div v-if="updateStore.state === 'available'" class="version-row">
        <span class="row-label">新版本</span>
        <span class="row-val new-version">{{ updateStore.newVersion }}</span>
      </div>

      <!-- 下载进度条 -->
      <div v-if="updateStore.state === 'downloading'" class="progress-wrap">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: updateStore.downloadProgress + '%' }"></div>
        </div>
        <span class="progress-label">{{ updateStore.downloadProgress }}%</span>
      </div>

      <!-- 错误提示 -->
      <p v-if="updateStore.errorMsg" class="error-msg">{{ updateStore.errorMsg }}</p>

      <!-- 操作按钮 -->
      <div class="update-actions">
        <!-- 已是最新版 -->
        <div v-if="updateStore.showLatestFeedback" class="latest-tip">
          <span class="latest-dot"></span>
          已是最新版本
        </div>

        <!-- 检查中 -->
        <button v-else-if="updateStore.state === 'checking'" class="btn-check" disabled>
          <span class="spinner"></span>
          检查中…
        </button>

        <!-- 下载中 -->
        <button v-else-if="updateStore.state === 'downloading'" class="btn-check" disabled>
          <span class="spinner"></span>
          下载中…
        </button>

        <!-- 有更新 -->
        <template v-else-if="updateStore.state === 'available'">
          <button
            v-if="updateStore.releaseNotes"
            class="btn-notes"
            @click="updateStore.showReleaseNotes = true"
          >查看更新内容</button>
          <button class="btn-update" @click="startUpdate">
            立即更新到 {{ updateStore.newVersion }}
          </button>
        </template>

        <!-- 默认/空闲/错误 -->
        <button v-else class="btn-check" @click="checkForUpdates(true)">
          检查更新
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about-settings {
  padding: 40px 32px;
  max-width: 480px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.app-hero {
  display: flex;
  align-items: center;
  gap: 18px;
}

.app-logo {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: linear-gradient(145deg, #E4983D 0%, #223F79 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(34, 63, 121, 0.28);
  flex-shrink: 0;
}

.app-logo span {
  color: white;
  font-size: 30px;
  font-weight: 700;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
  letter-spacing: -1px;
}

.app-info { display: flex; flex-direction: column; gap: 4px; }

.app-name {
  font-size: 26px;
  font-weight: 700;
  color: #1c1c1e;
  margin: 0;
  letter-spacing: -0.5px;
}

.app-version {
  font-size: 13px;
  color: #8e8e93;
}

.app-desc {
  font-size: 14px;
  color: #6e6e73;
  line-height: 1.65;
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

.info-row,
.version-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.row-label {
  font-size: 13px;
  color: #8e8e93;
  width: 70px;
  flex-shrink: 0;
}

.row-val {
  font-size: 13px;
  color: #3c3c43;
}

/* Update card */
.update-card { gap: 12px; }

.update-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.update-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
}

.update-badge {
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: #223F79;
  border-radius: 8px;
  padding: 2px 8px;
}

.new-version { color: #223F79; font-weight: 600; }

.progress-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: rgba(0, 0, 0, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #E4983D, #223F79);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-label {
  font-size: 12px;
  color: #8e8e93;
  width: 32px;
  text-align: right;
  flex-shrink: 0;
}

.error-msg {
  font-size: 12px;
  color: #ff3b30;
  margin: 0;
}

.update-actions {
  margin-top: 2px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.btn-check,
.btn-update,
.btn-notes {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  padding: 7px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-check {
  background: rgba(0, 0, 0, 0.06);
  color: #3c3c43;
}

.btn-check:disabled { opacity: 0.6; cursor: default; }

.btn-update {
  background: linear-gradient(135deg, #223F79, #3a5fa0);
  color: #fff;
}

.btn-update:hover { opacity: 0.88; }

.btn-notes {
  background: rgba(34, 63, 121, 0.08);
  color: #223F79;
}

.btn-notes:hover { background: rgba(34, 63, 121, 0.14); }

.latest-tip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #34c759;
  font-weight: 500;
}

.latest-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #34c759;
  animation: pulse 1.8s ease-in-out infinite;
}

.spinner {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(0, 0, 0, 0.15);
  border-top-color: #3c3c43;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}

/* ─── Release Notes Modal ─────────────────────────────────────────────────── */
.rn-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.rn-modal {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.22);
  width: 100%;
  max-width: 540px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.rn-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
  flex-shrink: 0;
}

.rn-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.rn-badge {
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #223F79, #3a5fa0);
  border-radius: 6px;
  padding: 2px 8px;
  letter-spacing: 0.2px;
}

.rn-title {
  font-size: 16px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0;
}

.rn-close {
  width: 28px;
  height: 28px;
  border: none;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 8px;
  color: #3c3c43;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s;
  flex-shrink: 0;
}

.rn-close:hover { background: rgba(0, 0, 0, 0.12); }

.rn-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 20px;
  font-size: 13px;
  line-height: 1.7;
  color: #3c3c43;
  min-height: 0;
}

.rn-body::-webkit-scrollbar { width: 4px; }
.rn-body::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

.rn-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px 18px;
  border-top: 1px solid rgba(0, 0, 0, 0.07);
  flex-shrink: 0;
}

.rn-dismiss {
  padding: 7px 16px;
  border-radius: 8px;
  border: none;
  background: rgba(0, 0, 0, 0.06);
  color: #3c3c43;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s;
}

.rn-dismiss:hover { background: rgba(0, 0, 0, 0.10); }

.rn-install {
  padding: 7px 18px;
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, #223F79, #3a5fa0);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.12s;
}

.rn-install:hover { opacity: 0.88; }
</style>

<!-- markdown content styles (not scoped — apply to v-html) -->
<style>
.rn-body.markdown-body p { margin: 0 0 8px; }
.rn-body.markdown-body p:last-child { margin-bottom: 0; }
.rn-body.markdown-body h1,
.rn-body.markdown-body h2,
.rn-body.markdown-body h3 { font-size: 14px; font-weight: 600; color: #1c1c1e; margin: 14px 0 6px; }
.rn-body.markdown-body ul,
.rn-body.markdown-body ol { padding-left: 1.4em; margin: 6px 0; }
.rn-body.markdown-body li { margin: 3px 0; }
.rn-body.markdown-body code {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 0.88em;
  color: #c7254e;
}
.rn-body.markdown-body a { color: #223F79; }
.rn-body.markdown-body hr { border: none; border-top: 1px solid rgba(0,0,0,0.10); margin: 10px 0; }
</style>
