<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useHomeStore, type AnimalPoster } from '../../stores/home'
import { useChatStore } from '../../stores/chat'
import { useNotesStore } from '../../stores/notes'
import { useTravelStore } from '../../stores/travel'
import { useEbookStore } from '../../stores/ebook'
import { useI18n } from 'vue-i18n'
import {
  Sparkles, Settings, Trash2, X, ZoomIn, RefreshCw, Copy, Download, Check,
  AlertTriangle, ChevronLeft, ChevronRight,
  MessageSquare, FileText, MapPin, BookOpen,
} from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import HomePosterSettings from './HomePosterSettings.vue'

const { t } = useI18n()
const home      = useHomeStore()
const chatStore = useChatStore()
const notesStore = useNotesStore()
const travelStore = useTravelStore()
const ebookStore = useEbookStore()
const router = useRouter()

const lightboxPoster  = ref<AnimalPoster | null>(null)
const deleteConfirmId = ref<string | null>(null)
const copiedPosterId  = ref<string | null>(null)
const saveToast = ref('')
const showSettingsPanel = ref(false)
let _saveToastTimer: ReturnType<typeof setTimeout> | null = null

// Carousel
const carouselIndex = ref(0)
const carouselHover = ref(false)

const posters   = computed(() => home.posters)
const isEmpty   = computed(() => posters.value.length === 0 && !home.isGenerating)
const isConfigured = computed(() => !!home.settings.providerId)

watch(posters, (ps) => {
  if (carouselIndex.value >= ps.length) {
    carouselIndex.value = Math.max(0, ps.length - 1)
  }
})

function prevSlide() {
  carouselIndex.value = carouselIndex.value === 0 ? posters.value.length - 1 : carouselIndex.value - 1
}

function nextSlide() {
  carouselIndex.value = carouselIndex.value === posters.value.length - 1 ? 0 : carouselIndex.value + 1
}

// ── Activity feed ─────────────────────────────────────────────────────────────

interface ActivityItem {
  type: 'chat' | 'note' | 'travel' | 'book'
  id: string
  title: string
  subtitle: string
  timeMs: number
}

function cleanPreview(raw: string, title: string): string {
  const stripped = raw
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/\*(.*?)\*/gs, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .trim()
  // Don't show subtitle if it's empty or just restates the title
  if (!stripped || stripped === title.trim()) return ''
  return stripped
}

const activityItems = computed((): ActivityItem[] => {
  const items: ActivityItem[] = []

  for (const c of chatStore.conversations.slice(0, 8)) {
    const title = c.title || '未命名对话'
    items.push({
      type: 'chat',
      id: c.id,
      title,
      subtitle: cleanPreview(c.preview || '', title),
      timeMs: new Date(c.updatedAt).getTime(),
    })
  }

  const sortedNotes = [...notesStore.notes]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8)
  for (const n of sortedNotes) {
    const title = n.title || '未命名笔记'
    items.push({
      type: 'note',
      id: n.id,
      title,
      subtitle: cleanPreview(n.preview || '', title),
      timeMs: new Date(n.updatedAt).getTime(),
    })
  }

  const sortedTravel = [...travelStore.notes]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8)
  for (const tr of sortedTravel) {
    const title = tr.title || '未命名日记'
    items.push({
      type: 'travel',
      id: tr.id,
      title,
      subtitle: cleanPreview(tr.preview || '', title),
      timeMs: new Date(tr.updatedAt).getTime(),
    })
  }

  const readingBooks = ebookStore.books
    .filter(b => b.readStatus === 'reading')
    .sort((a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt))
    .slice(0, 5)
  for (const b of readingBooks) {
    items.push({
      type: 'book',
      id: b.id,
      title: b.title,
      subtitle: b.author || '',
      timeMs: b.lastReadAt ?? b.addedAt,
    })
  }

  return items.sort((a, b) => b.timeMs - a.timeMs).slice(0, 12)
})

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000)         return '刚刚'
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(ms).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function activityRoute(item: ActivityItem): string {
  const map: Record<ActivityItem['type'], string> = {
    chat: '/chat', note: '/notes', travel: '/travel', book: '/ebook',
  }
  return map[item.type]
}

// ── Poster actions ────────────────────────────────────────────────────────────

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
  const deletedId = deleteConfirmId.value
  await home.deletePoster(deletedId)
  deleteConfirmId.value = null
  if (lightboxPoster.value?.id === deletedId) {
    lightboxPoster.value = null
  }
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
  } catch { /* silently fail */ }
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
  await home.loadPosters()
  home.deduplicateAnimals()
  home.startDailyScheduler()
  await home.maybeAutoGenerate()

  // Load activity data (non-blocking)
  Promise.all([
    chatStore.loadList(),
    notesStore.loadList(),
    travelStore.loadList(),
  ]).catch(() => {})
})
</script>

<template>
  <div class="home-main">
    <!-- Header bar -->
    <div class="home-header">
      <div class="header-left">
        <h1 class="muse-wordmark" aria-label="Muse">
          <span class="muse-letter ml-0">M</span>
          <span class="muse-letter ml-1">u</span>
          <span class="muse-letter ml-2">s</span>
          <span class="muse-letter ml-3">e</span>
        </h1>
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
        <button
          class="settings-trigger-btn"
          :class="{ active: showSettingsPanel, 'low-stock': home.animals.length < 5 }"
          :title="t('nav.settings')"
          @click="showSettingsPanel = !showSettingsPanel"
        >
          <AlertTriangle v-if="home.animals.length < 5" :size="13" class="stock-warning" />
          <Settings :size="15" />
        </button>
      </div>
    </div>

    <!-- Settings dropdown -->
    <div v-if="showSettingsPanel" class="settings-dropdown-backdrop" @click.self="showSettingsPanel = false" />
    <Transition name="fade">
      <div v-if="showSettingsPanel" class="settings-dropdown">
        <HomePosterSettings />
      </div>
    </Transition>

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
      <div v-if="isEmpty && activityItems.length === 0" class="empty-state">
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
          <button class="action-btn secondary" @click="showSettingsPanel = true">
            <Settings :size="14" />
            {{ t('home.configureFirst') }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- Main scrollable content -->
    <div v-if="posters.length > 0 || activityItems.length > 0" class="home-content">

      <!-- ── Poster carousel ── -->
      <div v-if="posters.length > 0" class="carousel-section">
        <div
          class="carousel-wrapper"
          @mouseenter="carouselHover = true"
          @mouseleave="carouselHover = false"
        >
          <!-- Current poster -->
          <div
            class="poster-card carousel-card"
            @click="openLightbox(posters[carouselIndex])"
          >
            <img
              v-if="posters[carouselIndex]?.imageBase64"
              :src="`data:image/png;base64,${posters[carouselIndex].imageBase64}`"
              :alt="posters[carouselIndex].animalName"
              class="poster-image"
            />
            <div v-else class="poster-placeholder">
              <Sparkles :size="28" />
            </div>
            <div class="poster-overlay">
              <div class="poster-meta">
                <span class="poster-animal">{{ posters[carouselIndex]?.animalName }}</span>
                <span class="poster-date">{{ formatDate(posters[carouselIndex]?.date ?? '') }}</span>
              </div>
              <button
                class="delete-btn"
                :title="t('common.delete')"
                @click.stop="confirmDelete(posters[carouselIndex].id)"
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
                :class="{ copied: copiedPosterId === posters[carouselIndex]?.id }"
                title="复制图片"
                @click.stop="copyPosterImage(posters[carouselIndex])"
              >
                <Check v-if="copiedPosterId === posters[carouselIndex]?.id" :size="13" />
                <Copy v-else :size="13" />
              </button>
              <button class="poster-action-btn" title="下载图片" @click.stop="downloadPosterImage(posters[carouselIndex])">
                <Download :size="13" />
              </button>
            </div>
          </div>

          <!-- Navigation arrows -->
          <Transition name="fade-quick">
            <button
              v-if="posters.length > 1 && carouselHover"
              class="carousel-arrow carousel-arrow-left"
              @click.stop="prevSlide"
            >
              <ChevronLeft :size="18" />
            </button>
          </Transition>
          <Transition name="fade-quick">
            <button
              v-if="posters.length > 1 && carouselHover"
              class="carousel-arrow carousel-arrow-right"
              @click.stop="nextSlide"
            >
              <ChevronRight :size="18" />
            </button>
          </Transition>

          <!-- Dot indicators -->
          <div v-if="posters.length > 1" class="carousel-dots">
            <button
              v-for="(_, i) in posters"
              :key="i"
              class="carousel-dot"
              :class="{ active: i === carouselIndex }"
              @click.stop="carouselIndex = i"
            />
          </div>
        </div>
      </div>

      <!-- ── Recent activity ── -->
      <div v-if="activityItems.length > 0" class="activity-section">
        <div class="section-label">最近动态</div>
        <div class="activity-grid">
          <div
            v-for="item in activityItems"
            :key="`${item.type}-${item.id}`"
            class="activity-card"
            :class="`activity-${item.type}`"
            @click="router.push(activityRoute(item))"
          >
            <div class="activity-icon-wrap">
              <MessageSquare v-if="item.type === 'chat'"   :size="15" />
              <FileText      v-else-if="item.type === 'note'"   :size="15" />
              <MapPin        v-else-if="item.type === 'travel'" :size="15" />
              <BookOpen      v-else-if="item.type === 'book'"   :size="15" />
            </div>
            <div class="activity-body">
              <div class="activity-title">{{ item.title }}</div>
              <div v-if="item.subtitle" class="activity-subtitle">{{ item.subtitle }}</div>
            </div>
            <div class="activity-time">{{ relativeTime(item.timeMs) }}</div>
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

/* ── Muse animated wordmark ─────────────────────────────────────────────── */

.muse-wordmark {
  display: flex;
  align-items: flex-end;
  gap: 0.5px;
  margin: 0;
  line-height: 1;
  user-select: none;
}

.muse-letter {
  display: inline-block;
  font-size: 22px;
  font-weight: 800;
  font-style: italic;
  font-family: 'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
  letter-spacing: -0.5px;
  will-change: transform;
  /* entry + continuous float combined */
  animation: museEnter 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both,
             museFloat 2.6s ease-in-out infinite;
}

/* per-letter colors: warm orange → mid purple → cool navy */
.ml-0 { color: #D97B2C; animation-delay: 0s,         0.04s; }
.ml-1 { color: #9B5FAB; animation-delay: 0.07s,       0.2s;  }
.ml-2 { color: #5A6CC4; animation-delay: 0.14s,       0.36s; }
.ml-3 { color: #1E4F9A; animation-delay: 0.21s,       0.52s; }

@keyframes museEnter {
  from {
    opacity: 0;
    transform: translateY(7px) rotate(-4deg) scale(0.85);
  }
  to {
    opacity: 1;
    transform: translateY(0) rotate(0deg) scale(1);
  }
}

@keyframes museFloat {
  0%, 100% { transform: translateY(0px)   rotate(0deg); }
  28%       { transform: translateY(-2.5px) rotate(-0.6deg); }
  72%       { transform: translateY(1.2px)  rotate(0.3deg); }
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

.settings-trigger-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: #8e8e93;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
}

.settings-trigger-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #1c1c1e;
}

.settings-trigger-btn.active {
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
}

.settings-trigger-btn.low-stock {
  color: #ff3b30;
}

.stock-warning { color: #ff3b30; }

.settings-dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 49;
}

.settings-dropdown {
  position: absolute;
  top: 52px;
  right: 20px;
  width: 320px;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  background: rgba(248, 248, 250, 0.98);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.14), 0 2px 8px rgba(0, 0, 0, 0.08);
  z-index: 50;
  flex-shrink: 0;
}

.settings-dropdown::-webkit-scrollbar {
  width: 4px;
}

.settings-dropdown::-webkit-scrollbar-track {
  background: transparent;
}

.settings-dropdown::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.10);
  border-radius: 2px;
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

.spin-icon { animation: spin 1s linear infinite; }

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

.sparkle-anim { animation: sparkle-pulse 1.2s ease-in-out infinite; }

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

/* ── Main content scroll ── */
.home-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px 28px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  will-change: transform;
}

.home-content::-webkit-scrollbar { width: 4px; }
.home-content::-webkit-scrollbar-track { background: transparent; }
.home-content::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom: 12px;
}

/* ── Carousel ── */
.carousel-section {
  flex-shrink: 0;
}

.carousel-wrapper {
  position: relative;
  width: 100%;
  border-radius: 18px;
  overflow: hidden;
}

.carousel-card {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 18px;
}

.carousel-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.40);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 10;
  transition: background 0.15s;
}

.carousel-arrow:hover { background: rgba(0, 0, 0, 0.65); }

.carousel-arrow-left  { left: 12px; }
.carousel-arrow-right { right: 12px; }

.carousel-dots {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  z-index: 10;
}

.carousel-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  padding: 0;
  transition: background 0.2s, transform 0.2s;
}

.carousel-dot.active {
  background: white;
  transform: scale(1.3);
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
  transform: translateY(-2px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
}

.poster-card:hover .zoom-hint { opacity: 1; }

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
  padding: 12px 14px 44px;
  background: linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 100%);
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  opacity: 0;
  transition: opacity 0.2s;
}

.poster-card:hover .poster-overlay { opacity: 1; }

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

.delete-btn:hover { background: #ff3b30; }

.poster-action-bar {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  gap: 5px;
  opacity: 0;
  transition: opacity 0.2s;
}

.poster-card:hover .poster-action-bar { opacity: 1; }

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

/* ── Activity feed ── */
.activity-section {
  flex-shrink: 0;
}

.activity-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.activity-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 13px;
  border-radius: 12px;
  background: white;
  cursor: pointer;
  transition: background 0.12s, box-shadow 0.12s, transform 0.12s;
  border: 1px solid rgba(0, 0, 0, 0.05);
  min-width: 0;
}

.activity-card:hover {
  background: #fafafa;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.07);
  transform: translateY(-1px);
}

.activity-icon-wrap {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}

.activity-chat   .activity-icon-wrap { background: rgba(0, 122, 255, 0.12); color: #007aff; }
.activity-note   .activity-icon-wrap { background: rgba(52, 199, 89, 0.12); color: #34c759; }
.activity-travel .activity-icon-wrap { background: rgba(228, 152, 61, 0.14); color: #E4983D; }
.activity-book   .activity-icon-wrap { background: rgba(175, 82, 222, 0.12); color: #af52de; }

.activity-body {
  flex: 1;
  min-width: 0;
}

.activity-title {
  font-size: 13px;
  font-weight: 500;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.activity-subtitle {
  font-size: 11px;
  color: #8e8e93;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.activity-time {
  flex-shrink: 0;
  font-size: 10px;
  color: #aeaeb2;
  margin-top: 2px;
  white-space: nowrap;
}

/* ── Lightbox ── */
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

.lightbox-close:hover { background: rgba(0,0,0,0.75); }

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

.lightbox-delete:hover { background: #ff3b30; }

/* ── Confirm dialog ── */
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

.confirm-btn.secondary:hover { background: rgba(0,0,0,0.10); }

.confirm-btn.danger {
  background: #ff3b30;
  color: white;
}

.confirm-btn.danger:hover { background: #e6352b; }

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

/* ── Transitions ── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.fade-quick-enter-active, .fade-quick-leave-active { transition: opacity 0.15s; }
.fade-quick-enter-from, .fade-quick-leave-to { opacity: 0; }

.lightbox-enter-active { transition: opacity 0.2s; }
.lightbox-leave-active { transition: opacity 0.15s; }
.lightbox-enter-from, .lightbox-leave-to { opacity: 0; }
</style>
