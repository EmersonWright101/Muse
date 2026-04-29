<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useHomeStore, type AnimalPoster } from '../../stores/home'
import { useI18n } from 'vue-i18n'
import { Sparkles, Settings, Trash2, X, ZoomIn, RefreshCw, Copy, Download, Check } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

const { t } = useI18n()
const home = useHomeStore()
const router = useRouter()

const lightboxPoster  = ref<AnimalPoster | null>(null)
const deleteConfirmId = ref<string | null>(null)
const copiedPosterId  = ref<string | null>(null)
const saveToast = ref('')
let _saveToastTimer: ReturnType<typeof setTimeout> | null = null

const posters = computed(() => home.posters)
const isEmpty = computed(() => posters.value.length === 0 && !home.isGenerating)
// Show manual-generate controls whenever a provider is selected.
// The `enabled` flag only gates auto-generation, not the user-triggered button.
const isConfigured = computed(() => !!home.settings.providerId)

async function handleGenerate() {
  if (home.isGenerating) return
  await home.generatePoster()
}

function openLightbox(poster: AnimalPoster) {
  lightboxPoster.value = poster
}

function closeLightbox() {
  lightboxPoster.value = null
}

function confirmDelete(id: string) {
  deleteConfirmId.value = id
}

async function doDelete() {
  if (!deleteConfirmId.value) return
  await home.deletePoster(deleteConfirmId.value)
  deleteConfirmId.value = null
  if (lightboxPoster.value?.id === deleteConfirmId.value) {
    lightboxPoster.value = null
  }
}

function goSettings() {
  router.push('/settings')
}

async function copyPosterImage(poster: AnimalPoster) {
  if (!poster.imageBase64) return
  try {
    const bin = atob(poster.imageBase64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeImage(bytes)
    copiedPosterId.value = poster.id
    setTimeout(() => { copiedPosterId.value = null }, 2000)
  } catch { /* silently fail on unsupported browser */ }
}

function showSaveToast(text: string) {
  saveToast.value = text
  if (_saveToastTimer) clearTimeout(_saveToastTimer)
  _saveToastTimer = setTimeout(() => { saveToast.value = '' }, 2500)
}

async function downloadPosterImage(poster: AnimalPoster) {
  if (!poster.imageBase64) return
  try {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const bin = atob(poster.imageBase64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const savePath = await save({
      defaultPath: `${poster.animalName}-${poster.date}.png`,
      filters: [{ name: 'Image', extensions: ['png'] }],
    })
    if (!savePath) return
    await writeFile(savePath, bytes)
    showSaveToast('保存成功')
  } catch {
    showSaveToast('保存失败')
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' })
}

onMounted(async () => {
  // Start the 11:00 daily scheduler (idempotent — safe to call multiple times)
  home.startDailyScheduler()
  // Catch-up: generate today's poster if it was missed (e.g. app was closed at 11 AM)
  await home.maybeAutoGenerate()
})
</script>

<template>
  <div class="home-main">
    <!-- Header bar -->
    <div class="home-header">
      <div class="header-left">
        <h1 class="header-title">{{ t('home.title') }}</h1>
        <span class="header-subtitle">{{ t('home.subtitle') }}</span>
      </div>
      <div class="header-right">
        <button
          v-if="isConfigured"
          class="generate-header-btn"
          :class="{ generating: home.isGenerating }"
          :disabled="home.isGenerating"
          :title="t('home.generateNow')"
          @click="handleGenerate"
        >
          <RefreshCw v-if="home.isGenerating" :size="14" class="spin-icon" />
          <Sparkles v-else :size="14" />
          <span>{{ home.isGenerating ? t('home.generating') : t('home.generateNow') }}</span>
        </button>
        <button class="icon-btn" :title="t('nav.settings')" @click="goSettings">
          <Settings :size="17" />
        </button>
      </div>
    </div>

    <!-- Generating placeholder -->
    <Transition name="fade">
      <div v-if="home.isGenerating" class="generating-banner">
        <div class="generating-shimmer" />
        <div class="generating-text">
          <Sparkles :size="14" class="sparkle-anim" />
          <span>{{ t('home.generatingPoster') }}</span>
        </div>
      </div>
    </Transition>

    <!-- Empty state -->
    <Transition name="fade">
      <div v-if="isEmpty" class="empty-state">
        <div class="empty-icon">
          <Sparkles :size="36" />
        </div>
        <p class="empty-title">{{ t('home.emptyTitle') }}</p>
        <p class="empty-desc">{{ t('home.emptyDesc') }}</p>
        <div class="empty-actions">
          <button v-if="isConfigured" class="action-btn primary" @click="home.generatePoster()">
            <Sparkles :size="14" />
            {{ t('home.generateNow') }}
          </button>
          <button class="action-btn secondary" @click="goSettings">
            <Settings :size="14" />
            {{ t('home.configureFirst') }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- Poster wall -->
    <div v-if="posters.length > 0" class="poster-wall">
      <!-- Today's feature poster (first one) -->
      <div v-if="posters[0]" class="feature-section">
        <div class="section-label">{{ t('home.todayFeature') }}</div>
        <div
          class="poster-card feature-card"
          @click="openLightbox(posters[0])"
        >
          <img
            v-if="posters[0].imageBase64"
            :src="`data:image/png;base64,${posters[0].imageBase64}`"
            :alt="posters[0].animalName"
            class="poster-image"
            loading="lazy"
          />
          <div v-else class="poster-placeholder">
            <Sparkles :size="28" />
          </div>
          <div class="poster-overlay">
            <div class="poster-meta">
              <span class="poster-animal">{{ posters[0].animalName }}</span>
              <span class="poster-date">{{ formatDate(posters[0].date) }}</span>
            </div>
            <button
              class="delete-btn"
              :title="t('common.delete')"
              @click.stop="confirmDelete(posters[0].id)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
          <div class="zoom-hint">
            <ZoomIn :size="14" />
          </div>
          <div class="poster-action-bar">
            <button
              class="poster-action-btn"
              :class="{ copied: copiedPosterId === posters[0].id }"
              title="复制图片"
              @click.stop="copyPosterImage(posters[0])"
            >
              <Check v-if="copiedPosterId === posters[0].id" :size="13" />
              <Copy v-else :size="13" />
            </button>
            <button class="poster-action-btn" title="下载图片" @click.stop="downloadPosterImage(posters[0])">
              <Download :size="13" />
            </button>
          </div>
        </div>
      </div>

      <!-- Grid of past posters -->
      <div v-if="posters.length > 1" class="grid-section">
        <div class="section-label">{{ t('home.pastPosters') }}</div>
        <div class="poster-grid">
          <div
            v-for="poster in posters.slice(1)"
            :key="poster.id"
            class="poster-card grid-card"
            @click="openLightbox(poster)"
          >
            <img
              v-if="poster.imageBase64"
              :src="`data:image/png;base64,${poster.imageBase64}`"
              :alt="poster.animalName"
              class="poster-image"
              loading="lazy"
            />
            <div v-else class="poster-placeholder">
              <Sparkles :size="18" />
            </div>
            <div class="poster-overlay">
              <div class="poster-meta">
                <span class="poster-animal">{{ poster.animalName }}</span>
                <span class="poster-date">{{ formatDate(poster.date) }}</span>
              </div>
              <button
                class="delete-btn"
                :title="t('common.delete')"
                @click.stop="confirmDelete(poster.id)"
              >
                <Trash2 :size="11" />
              </button>
            </div>
            <div class="poster-action-bar">
              <button
                class="poster-action-btn"
                :class="{ copied: copiedPosterId === poster.id }"
                title="复制图片"
                @click.stop="copyPosterImage(poster)"
              >
                <Check v-if="copiedPosterId === poster.id" :size="12" />
                <Copy v-else :size="12" />
              </button>
              <button class="poster-action-btn" title="下载图片" @click.stop="downloadPosterImage(poster)">
                <Download :size="12" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Lightbox -->
    <Teleport to="body">
      <Transition name="lightbox">
        <div v-if="lightboxPoster" class="lightbox-overlay" @click.self="closeLightbox">
          <div class="lightbox-container">
            <img
              v-if="lightboxPoster.imageBase64"
              :src="`data:image/png;base64,${lightboxPoster.imageBase64}`"
              :alt="lightboxPoster.animalName"
              class="lightbox-image"
            />
            <div class="lightbox-info">
              <div class="lightbox-animal">{{ lightboxPoster.animalName }}</div>
              <div class="lightbox-date">{{ formatDate(lightboxPoster.date) }}</div>
              <div class="lightbox-prompt">{{ lightboxPoster.prompt }}</div>
            </div>
            <button class="lightbox-close" @click="closeLightbox">
              <X :size="16" />
            </button>
            <button class="lightbox-delete" @click="confirmDelete(lightboxPoster.id); closeLightbox()">
              <Trash2 :size="14" />
              {{ t('common.delete') }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Delete confirm dialog -->
    <Teleport to="body">
      <div v-if="deleteConfirmId" class="confirm-overlay" @click.self="deleteConfirmId = null">
        <div class="confirm-dialog">
          <p class="confirm-title">{{ t('home.deleteConfirmTitle') }}</p>
          <p class="confirm-desc">{{ t('home.deleteConfirmDesc') }}</p>
          <div class="confirm-actions">
            <button class="confirm-btn secondary" @click="deleteConfirmId = null">
              {{ t('common.cancel') }}
            </button>
            <button class="confirm-btn danger" @click="doDelete">
              {{ t('common.delete') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Save toast -->
    <Teleport to="body">
      <div v-if="saveToast" class="save-toast">{{ saveToast }}</div>
    </Teleport>
  </div>
</template>

<style scoped>
.home-main {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f5f5f7;
}

/* Header */
.home-header {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.header-title {
  font-size: 17px;
  font-weight: 700;
  color: #1c1c1e;
  margin: 0;
}

.header-subtitle {
  font-size: 12px;
  color: #8e8e93;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: #8e8e93;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.icon-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #1c1c1e;
}

.generate-header-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #E4983D 0%, #223F79 100%);
  color: white;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
}

.generate-header-btn:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

.generate-header-btn:disabled {
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

/* Generating banner */
.generating-banner {
  position: relative;
  margin: 20px 28px 0;
  height: 52px;
  border-radius: 14px;
  overflow: hidden;
  background: rgba(228, 152, 61, 0.08);
  border: 1px solid rgba(228, 152, 61, 0.20);
  flex-shrink: 0;
}

.generating-shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(228, 152, 61, 0.15) 40%,
    rgba(34, 63, 121, 0.10) 60%,
    transparent 100%);
  background-size: 200% 100%;
  animation: shimmer 1.8s ease-in-out infinite;
}

@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.generating-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
  color: #E4983D;
  font-weight: 500;
}

@keyframes sparkle-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.5; transform: scale(0.85); }
}

.sparkle-anim {
  animation: sparkle-pulse 1.2s ease-in-out infinite;
}

/* Empty state */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 40px;
}

.empty-icon {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(228, 152, 61, 0.12) 0%, rgba(34, 63, 121, 0.10) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #E4983D;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0;
}

.empty-desc {
  font-size: 13px;
  color: #8e8e93;
  margin: 0;
  text-align: center;
  max-width: 300px;
  line-height: 1.6;
}

.empty-actions {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 18px;
  border-radius: 10px;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.12s, transform 0.1s;
}

.action-btn:hover {
  opacity: 0.85;
  transform: translateY(-1px);
}

.action-btn.primary {
  background: linear-gradient(135deg, #E4983D 0%, #223F79 100%);
  color: white;
}

.action-btn.secondary {
  background: rgba(0, 0, 0, 0.06);
  color: #3c3c43;
}

/* Poster wall */
.poster-wall {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px 28px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.poster-wall::-webkit-scrollbar { width: 4px; }
.poster-wall::-webkit-scrollbar-track { background: transparent; }
.poster-wall::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom: 12px;
}

/* Feature (hero) card — always 16:9 to match generated image dimensions */
.feature-section {
  flex-shrink: 0;
}

.feature-card {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 18px;
}

/* Grid cards */
.poster-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}

.grid-card {
  aspect-ratio: 16 / 9;
  border-radius: 14px;
}

/* Shared poster card styles */
.poster-card {
  position: relative;
  overflow: hidden;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.05);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.10);
  transition: transform 0.2s, box-shadow 0.2s;
}

.poster-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
}

.poster-card:hover .zoom-hint {
  opacity: 1;
}

.poster-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
}

.poster-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(228, 152, 61, 0.08) 0%, rgba(34, 63, 121, 0.08) 100%);
  color: rgba(34, 63, 121, 0.3);
}

.poster-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px 14px 12px;
  background: linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 100%);
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  opacity: 0;
  transition: opacity 0.2s;
}

.poster-card:hover .poster-overlay {
  opacity: 1;
}

.poster-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.poster-animal {
  font-size: 15px;
  font-weight: 700;
  color: white;
  text-shadow: 0 1px 4px rgba(0,0,0,0.4);
}

.poster-date {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.75);
}

.zoom-hint {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: rgba(0,0,0,0.35);
  backdrop-filter: blur(4px);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.delete-btn {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: none;
  background: rgba(255, 59, 48, 0.85);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s;
}

.delete-btn:hover {
  background: #ff3b30;
}

.poster-action-bar {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  gap: 5px;
  opacity: 0;
  transition: opacity 0.2s;
}

.poster-card:hover .poster-action-bar {
  opacity: 1;
}

.poster-action-btn {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: none;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s;
}

.poster-action-btn:hover { background: rgba(0, 0, 0, 0.65); }
.poster-action-btn.copied { background: rgba(52, 199, 89, 0.75); }

/* Lightbox */
.lightbox-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.80);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
  padding: 40px;
}

.lightbox-container {
  position: relative;
  max-width: 1100px;
  width: 100%;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
  background: #111;
}

.lightbox-image {
  width: 100%;
  display: block;
  max-height: 80vh;
  object-fit: contain;
  background: #000;
}

.lightbox-info {
  padding: 18px 22px;
  background: rgba(20, 20, 20, 0.95);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lightbox-animal {
  font-size: 20px;
  font-weight: 700;
  color: white;
}

.lightbox-date {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.lightbox-prompt {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 4px;
  line-height: 1.5;
}

.lightbox-close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,0.5);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s;
  backdrop-filter: blur(4px);
}

.lightbox-close:hover {
  background: rgba(0,0,0,0.75);
}

.lightbox-delete {
  position: absolute;
  bottom: 70px;
  right: 14px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  border-radius: 9px;
  border: none;
  background: rgba(255, 59, 48, 0.85);
  color: white;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  backdrop-filter: blur(4px);
}

.lightbox-delete:hover {
  background: #ff3b30;
}

/* Confirm dialog */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 600;
  backdrop-filter: blur(2px);
}

.confirm-dialog {
  background: white;
  border-radius: 16px;
  padding: 24px;
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.15);
}

.confirm-title {
  font-size: 15px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0;
}

.confirm-desc {
  font-size: 12px;
  color: #8e8e93;
  margin: 0;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

.confirm-btn {
  flex: 1;
  padding: 9px 0;
  border-radius: 9px;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s;
}

.confirm-btn.secondary {
  background: rgba(0,0,0,0.05);
  color: #3c3c43;
}

.confirm-btn.secondary:hover {
  background: rgba(0,0,0,0.10);
}

.save-toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(30, 30, 30, 0.88);
  color: #fff;
  padding: 8px 20px;
  border-radius: 20px;
  font-size: 13px;
  pointer-events: none;
  z-index: 99999;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.confirm-btn.danger {
  background: #ff3b30;
  color: white;
}

.confirm-btn.danger:hover {
  background: #e6352b;
}

/* Transitions */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.lightbox-enter-active { transition: opacity 0.2s; }
.lightbox-leave-active { transition: opacity 0.15s; }
.lightbox-enter-from, .lightbox-leave-to { opacity: 0; }
</style>
