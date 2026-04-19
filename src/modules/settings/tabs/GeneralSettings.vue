<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { locale } = useI18n()

const languages = [
  { code: 'zh-CN', label: '简体中文', flag: '🇨🇳' },
  { code: 'en-US', label: 'English',  flag: '🇺🇸' },
]

function setLocale(code: string) {
  locale.value = code
  localStorage.setItem('muse-locale', code)
}
</script>

<template>
  <div class="general-settings">
    <h1 class="page-title">通用设置</h1>

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
      <h2 class="section-title">对话记录</h2>
      <div class="info-row">
        <span class="info-label">储存位置</span>
        <span class="info-value">本地应用数据目录</span>
      </div>
      <div class="info-row">
        <span class="info-label">加密方式</span>
        <span class="info-value">API Key 使用 AES-256-GCM 加密存储</span>
      </div>
    </div>
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
}
</style>
