<script setup lang="ts">
// About page – static info
</script>

<template>
  <div class="about-settings">
    <div class="app-hero">
      <div class="app-logo">
        <span>M</span>
      </div>
      <div class="app-info">
        <h1 class="app-name">Muse</h1>
        <span class="app-version">版本 0.1.0</span>
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

.info-row {
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
</style>
