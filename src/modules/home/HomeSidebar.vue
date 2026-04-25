<script setup lang="ts">
import { computed } from 'vue'
import { useHomeStore } from '../../stores/home'
import { Sparkles, RefreshCw, ImageOff } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const home = useHomeStore()

const today = computed(() => {
  const d = new Date()
  return {
    weekday: d.toLocaleDateString('zh-CN', { weekday: 'long' }),
    day:     d.getDate(),
    month:   d.toLocaleDateString('zh-CN', { month: 'long' }),
    year:    d.getFullYear(),
  }
})

const posterCount = computed(() => home.posters.length)

const nextGenerateLabel = computed(() => {
  if (!home.settings.enabled) return t('home.posterGenDisabled')
  if (!home.lastGeneratedDate) return t('home.posterGenNow')
  const freq = home.settings.frequency === 'daily' ? 1 : home.settings.frequency === 'every3days' ? 3 : 7
  const last = new Date(home.lastGeneratedDate + 'T00:00:00')
  const next = new Date(last)
  next.setDate(next.getDate() + freq)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (next <= today) return t('home.posterGenNow')
  const diff = Math.ceil((next.getTime() - today.getTime()) / 86_400_000)
  return t('home.posterGenIn', { days: diff })
})

async function handleGenerate() {
  if (home.isGenerating) return
  await home.generatePoster()
}
</script>

<template>
  <aside class="home-sidebar">
    <!-- Date widget -->
    <div class="date-widget">
      <div class="date-weekday">{{ today.weekday }}</div>
      <div class="date-number">{{ today.day }}</div>
      <div class="date-month">{{ today.month }} · {{ today.year }}</div>
    </div>

    <!-- Divider -->
    <div class="sidebar-divider" />

    <!-- Poster stats -->
    <div class="stats-section">
      <div class="stat-item">
        <span class="stat-value">{{ posterCount }}</span>
        <span class="stat-label">{{ t('home.posterCount') }}</span>
      </div>
    </div>

    <!-- Generate button -->
    <div class="generate-section">
      <button
        class="generate-btn"
        :class="{ generating: home.isGenerating, disabled: !home.settings.enabled }"
        :disabled="home.isGenerating"
        @click="handleGenerate"
      >
        <RefreshCw v-if="home.isGenerating" :size="15" class="spin-icon" />
        <Sparkles v-else :size="15" />
        <span>{{ home.isGenerating ? t('home.generating') : t('home.generateNow') }}</span>
      </button>

      <div class="next-generate-hint">
        <span>{{ nextGenerateLabel }}</span>
      </div>

      <div v-if="home.generateError" class="generate-error">
        <ImageOff :size="12" />
        <span>{{ home.generateError }}</span>
      </div>
    </div>

    <!-- Spacer -->
    <div class="sidebar-spacer" />

    <!-- Settings hint -->
    <div class="settings-hint">
      <span>{{ t('home.settingsHint') }}</span>
    </div>
  </aside>
</template>

<style scoped>
.home-sidebar {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 20px 16px 16px;
  gap: 0;
  overflow-y: auto;
}

/* Date widget */
.date-widget {
  padding: 20px 4px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.date-weekday {
  font-size: 11px;
  font-weight: 500;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

.date-number {
  font-size: 56px;
  font-weight: 200;
  color: #1c1c1e;
  line-height: 1;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
  letter-spacing: -2px;
  margin: 4px 0;
}

.date-month {
  font-size: 13px;
  color: #3c3c43;
  font-weight: 400;
}

.sidebar-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.06);
  margin: 4px 0 16px;
}

/* Stats */
.stats-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: #223F79;
  line-height: 1;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
}

.stat-label {
  font-size: 11px;
  color: #8e8e93;
  font-weight: 400;
}

/* Generate section */
.generate-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.generate-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 14px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #E4983D 0%, #223F79 100%);
  color: white;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  width: 100%;
}

.generate-btn:hover:not(.disabled):not(.generating) {
  opacity: 0.9;
  transform: translateY(-1px);
}

.generate-btn:active:not(.disabled):not(.generating) {
  transform: translateY(0);
}

.generate-btn.disabled {
  background: rgba(0, 0, 0, 0.08);
  color: #8e8e93;
  cursor: not-allowed;
}

.generate-btn.generating {
  opacity: 0.7;
  cursor: default;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.spin-icon {
  animation: spin 1s linear infinite;
}

.next-generate-hint {
  font-size: 11px;
  color: #8e8e93;
  text-align: center;
  line-height: 1.4;
}

.generate-error {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  font-size: 11px;
  color: #ff3b30;
  background: rgba(255, 59, 48, 0.06);
  border-radius: 7px;
  padding: 7px 9px;
  line-height: 1.4;
}

.sidebar-spacer {
  flex: 1;
}

.settings-hint {
  font-size: 11px;
  color: #c7c7cc;
  text-align: center;
  padding-bottom: 4px;
}
</style>
