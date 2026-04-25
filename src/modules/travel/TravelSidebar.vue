<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, Plus, Star, FileText, ChevronDown, MapPin, Trash2, LayoutList, Paperclip, Tag, ChevronRight, RotateCcw } from 'lucide-vue-next'
import { useTravelStore } from '../../stores/travel'
import { initImageAssetBase, resolveImageUrl } from '../../utils/imageAsset'
import { getTrashRetentionDays } from '../../utils/travelStorage'

const { t } = useI18n()
const store = useTravelStore()

// Deterministic pastel color from string
const PASTELS = [
  { bg: 'rgba(255,179,186,0.35)', color: '#a93226' },
  { bg: 'rgba(255,218,185,0.45)', color: '#ba5a00' },
  { bg: 'rgba(255,240,168,0.50)', color: '#9a7000' },
  { bg: 'rgba(176,230,198,0.45)', color: '#1a7a45' },
  { bg: 'rgba(174,214,241,0.45)', color: '#1a5276' },
  { bg: 'rgba(212,172,242,0.38)', color: '#7048a0' },
  { bg: 'rgba(248,196,196,0.40)', color: '#b03030' },
  { bg: 'rgba(163,228,215,0.45)', color: '#0e6655' },
  { bg: 'rgba(251,210,166,0.45)', color: '#c05a00' },
  { bg: 'rgba(196,215,248,0.45)', color: '#1f618d' },
  { bg: 'rgba(220,210,255,0.40)', color: '#6040a0' },
  { bg: 'rgba(170,235,180,0.45)', color: '#1e7a30' },
]
function pastelStyle(str: string) {
  let h = 0
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0xFFFF
  const p = PASTELS[h % PASTELS.length]
  return { backgroundColor: p.bg, color: p.color }
}

const hasEntries = computed(() => store.notes.length > 0)

initImageAssetBase()

function onEntryClick(id: string) {
  store.openNote(id)
}

function onNewEntry() {
  store.newNote()
}

function onDeleteEntry(e: MouseEvent, id: string) {
  e.stopPropagation()
  store.deleteOne(id)
}

// ─── Recently Deleted ─────────────────────────────────────────────────────────

const trashOpen = ref(false)

function daysUntilPermanentDelete(deletedAt: string): number | null {
  const retention = getTrashRetentionDays()
  if (retention <= 0) return null
  const deleted = new Date(deletedAt)
  const expiry = new Date(deleted.getTime() + retention * 24 * 60 * 60 * 1000)
  const diff = Math.ceil((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  return Math.max(0, diff)
}

async function onRestoreTrash(id: string) {
  await store.restoreTrashItem(id)
}

async function onPermanentDelete(id: string) {
  await store.permanentlyDeleteTrashItem(id)
}

async function onClearAllTrash() {
  if (window.confirm(t('travel.recentlyDeleted.clearConfirm'))) {
    await store.clearAllTrash()
  }
}

// ─── Tag filter picker ────────────────────────────────────────────────────────

const tagPickerOpen = ref(false)
const tagPickerRoot = ref<HTMLElement>()

function selectTag(tag: string) {
  store.selectedTag = tag
  tagPickerOpen.value = false
}

function clearTag() {
  store.selectedTag = ''
  tagPickerOpen.value = false
}

// ─── L1 category picker ──────────────────────────────────────────────────────

const pickerL1Open = ref(false)
const pickerL1Root = ref<HTMLElement>()

function handlePickerOutside(e: MouseEvent) {
  if (tagPickerRoot.value && !tagPickerRoot.value.contains(e.target as Node)) {
    tagPickerOpen.value = false
  }
  if (pickerL1Root.value && !pickerL1Root.value.contains(e.target as Node)) {
    pickerL1Open.value = false
  }
  if (pickerL2Root.value && !pickerL2Root.value.contains(e.target as Node)) {
    pickerL2Open.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handlePickerOutside)
  // Scan for orphaned attachments once on mount
  store.scanAttachments().then(() => {
    if (store.orphanedAttachments.length > 0) {
      showAttachmentDialog.value = true
      selectedForDelete.value = new Set(store.orphanedAttachments)
    }
  })
})
onUnmounted(() => document.removeEventListener('mousedown', handlePickerOutside))

function selectL1(cat: string) {
  store.selectedCategoryL1 = cat
  store.selectedCategoryL2 = ''  // reset L2 when L1 changes
  pickerL1Open.value = false
}

function clearL1() {
  store.selectedCategoryL1 = ''
  store.selectedCategoryL2 = ''
  pickerL1Open.value = false
}

// ─── L2 category picker ──────────────────────────────────────────────────────

const pickerL2Open = ref(false)
const pickerL2Root = ref<HTMLElement>()

function selectL2(cat: string) {
  store.selectedCategoryL2 = cat
  pickerL2Open.value = false
}

function clearL2() {
  store.selectedCategoryL2 = ''
  pickerL2Open.value = false
}

// ─── Attachment cleanup dialog ───────────────────────────────────────────────

const showAttachmentDialog = ref(false)
const selectedForDelete = ref(new Set<string>())

function toggleFileSelect(filename: string) {
  if (selectedForDelete.value.has(filename)) {
    selectedForDelete.value.delete(filename)
  } else {
    selectedForDelete.value.add(filename)
  }
  selectedForDelete.value = new Set(selectedForDelete.value)
}

async function deleteSelectedAttachments() {
  for (const filename of selectedForDelete.value) {
    await store.deleteOrphanedAttachment(filename)
  }
  showAttachmentDialog.value = false
}

function keepAllAttachments() {
  showAttachmentDialog.value = false
}
</script>

<template>
  <div class="travel-sidebar">
    <!-- Header -->
    <div class="panel-header">
      <div class="header-title">{{ t('travel.title') }}</div>
      <div class="header-actions">
        <!-- Tag filter picker -->
        <div ref="tagPickerRoot" class="tag-filter-wrap">
          <button
            class="icon-btn"
            :class="{ 'icon-btn--active': !!store.selectedTag }"
            :title="t('travel.tagFilter')"
            @click="tagPickerOpen = !tagPickerOpen"
          >
            <Tag :size="14" />
          </button>
          <Transition name="picker-drop">
            <div v-if="tagPickerOpen" class="tag-picker-dropdown">
              <button class="picker-item" :class="{ active: !store.selectedTag }" @click="clearTag">
                <span class="picker-item-name">{{ t('travel.filterAll') }}</span>
              </button>
              <div v-if="store.allTags.length" class="picker-divider" />
              <button
                v-for="tag in store.allTags"
                :key="tag"
                class="picker-item"
                :class="{ active: store.selectedTag === tag }"
                @click="selectTag(tag)"
              >
                <span class="picker-item-name"># {{ tag }}</span>
              </button>
            </div>
          </Transition>
        </div>
        <button
          class="icon-btn"
          :title="store.viewMode === 'editor' ? t('travel.mapView') : t('travel.editorView')"
          @click="store.viewMode = store.viewMode === 'editor' ? 'map' : 'editor'"
        >
          <MapPin v-if="store.viewMode === 'editor'" :size="15" />
          <LayoutList v-else :size="15" />
        </button>
        <button class="icon-btn" :title="t('travel.newEntry')" @click="onNewEntry">
          <Plus :size="15" />
        </button>
      </div>
    </div>

    <!-- Category filter bar -->
    <div class="filter-bar">
      <!-- L1 picker -->
      <div ref="pickerL1Root" class="filter-picker">
        <button
          class="filter-btn"
          :class="{ active: !!store.selectedCategoryL1 }"
          @click="pickerL1Open = !pickerL1Open"
        >
          <span class="filter-label">{{ store.selectedCategoryL1 || t('travel.filterAll') }}</span>
          <ChevronDown :size="10" class="filter-chevron" :class="{ rotated: pickerL1Open }" />
        </button>
        <Transition name="picker-drop">
          <div v-if="pickerL1Open" class="picker-dropdown">
            <button class="picker-item" :class="{ active: !store.selectedCategoryL1 }" @click="clearL1">
              <span class="picker-item-name">{{ t('travel.filterAll') }}</span>
            </button>
            <div v-if="store.categoriesL1.length" class="picker-divider" />
            <button
              v-for="cat in store.categoriesL1"
              :key="cat"
              class="picker-item"
              :class="{ active: store.selectedCategoryL1 === cat }"
              @click="selectL1(cat)"
            >
              <span class="picker-item-name">{{ cat }}</span>
            </button>
          </div>
        </Transition>
      </div>

      <span class="filter-sep">/</span>

      <!-- L2 picker -->
      <div ref="pickerL2Root" class="filter-picker">
        <button
          class="filter-btn"
          :class="{ active: !!store.selectedCategoryL2 }"
          @click="pickerL2Open = !pickerL2Open"
        >
          <span class="filter-label">{{ store.selectedCategoryL2 || t('travel.filterAll') }}</span>
          <ChevronDown :size="10" class="filter-chevron" :class="{ rotated: pickerL2Open }" />
        </button>
        <Transition name="picker-drop">
          <div v-if="pickerL2Open" class="picker-dropdown">
            <button class="picker-item" :class="{ active: !store.selectedCategoryL2 }" @click="clearL2">
              <span class="picker-item-name">{{ t('travel.filterAll') }}</span>
            </button>
            <div v-if="store.categoriesL2.length" class="picker-divider" />
            <button
              v-for="cat in store.categoriesL2"
              :key="cat"
              class="picker-item"
              :class="{ active: store.selectedCategoryL2 === cat }"
              @click="selectL2(cat)"
            >
              <span class="picker-item-name">{{ cat }}</span>
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- Search -->
    <div class="search-bar">
      <Search :size="13" class="search-icon" />
      <input
        v-model="store.searchQuery"
        class="search-input"
        :placeholder="t('travel.search')"
        type="text"
      />
    </div>

    <!-- Entries list -->
    <div class="list-scroll">
      <!-- Empty state -->
      <div v-if="!hasEntries" class="empty-state">
        <FileText :size="32" class="empty-icon" />
        <p class="empty-text">{{ t('travel.noEntries') }}</p>
        <button class="empty-action" @click="onNewEntry">
          <Plus :size="13" />
          {{ t('travel.newEntry') }}
        </button>
      </div>

      <!-- No search results -->
      <div v-else-if="!store.filteredNotes.length" class="empty-state">
        <Search :size="28" class="empty-icon" />
        <p class="empty-text">{{ t('travel.noResults') }}</p>
      </div>

      <!-- List -->
      <div
        v-for="entry in store.filteredNotes"
        :key="entry.id"
        class="list-item"
        :class="{ active: store.activeNoteId === entry.id }"
        @click="onEntryClick(entry.id)"
      >
        <div class="item-cover">
          <img
            v-if="entry.cover && (entry.cover.startsWith('http') || entry.cover.startsWith('/') || entry.cover.includes('.'))"
            :src="resolveImageUrl(entry.cover)"
            class="cover-img"
            alt=""
          />
          <span v-else>{{ entry.cover || '📍' }}</span>
        </div>
        <div class="item-content">
          <div class="item-title-row">
            <div class="item-title">
              <span v-if="entry.categoryL2" class="item-cat-prefix">{{ entry.categoryL2 }}·</span>{{ entry.title }}
            </div>
            <button class="delete-btn" :title="t('common.delete')" @click="onDeleteEntry($event, entry.id)">
              <Trash2 :size="12" />
            </button>
          </div>
          <div class="item-preview">{{ entry.preview || t('travel.noPreview') }}</div>
          <div class="item-meta-row">
            <span
              v-if="entry.categoryL1"
              class="item-category"
              :style="pastelStyle(entry.categoryL1)"
            >{{ entry.categoryL1 }}</span>
            <span
              v-for="tag in (entry.tags ?? []).slice(0, 2)"
              :key="tag"
              class="item-tag"
              :style="pastelStyle(tag)"
            >#{{ tag }}</span>
            <span class="item-rating" v-if="entry.rating > 0">
              <Star :size="9" class="star-icon" />
              {{ entry.rating }}
            </span>
            <span class="item-date">
              <MapPin :size="10" />
              {{ entry.date }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Recently Deleted section -->
    <div v-if="store.trashItems.length > 0" class="trash-section">
      <button class="trash-toggle" @click="trashOpen = !trashOpen">
        <ChevronRight :size="11" class="trash-chevron" :class="{ rotated: trashOpen }" />
        <Trash2 :size="11" class="trash-toggle-icon" />
        <span class="trash-toggle-label">{{ t('travel.recentlyDeleted.title') }}</span>
        <span class="trash-count-badge">{{ store.trashItems.length }}</span>
        <button
          v-if="trashOpen"
          class="trash-clear-btn"
          :title="t('travel.recentlyDeleted.clearAll')"
          @click.stop="onClearAllTrash"
        >{{ t('travel.recentlyDeleted.clearAll') }}</button>
      </button>
      <div v-if="trashOpen" class="trash-list">
        <div
          v-for="item in store.trashItems"
          :key="item.id"
          class="trash-item"
        >
          <div class="trash-item-cover">
            <span>{{ item.cover || '🗑️' }}</span>
          </div>
          <div class="trash-item-info">
            <div class="trash-item-title">{{ item.title }}</div>
            <div class="trash-item-meta">
              <span>{{ t('travel.recentlyDeleted.deletedOn') }} {{ item.deletedAt.slice(0, 10) }}</span>
              <span v-if="daysUntilPermanentDelete(item.deletedAt) !== null" class="trash-days-left">
                · {{ daysUntilPermanentDelete(item.deletedAt) }} {{ t('travel.recentlyDeleted.daysLeft') }}
              </span>
            </div>
          </div>
          <div class="trash-item-actions">
            <button
              class="trash-action-btn restore-btn"
              :title="t('travel.recentlyDeleted.restore')"
              @click="onRestoreTrash(item.id)"
            >
              <RotateCcw :size="11" />
            </button>
            <button
              class="trash-action-btn perm-delete-btn"
              :title="t('travel.recentlyDeleted.deletePermanently')"
              @click="onPermanentDelete(item.id)"
            >
              <Trash2 :size="11" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Attachment cleanup dialog -->
    <Teleport to="body">
      <div v-if="showAttachmentDialog" class="attach-overlay" @click.self="keepAllAttachments">
        <div class="attach-dialog">
          <div class="attach-header">
            <Paperclip :size="16" class="attach-icon" />
            <span class="attach-title">{{ t('travel.attachmentScan.title') }}</span>
          </div>
          <p class="attach-desc">{{ t('travel.attachmentScan.desc') }}</p>
          <div class="attach-list">
            <label
              v-for="filename in store.orphanedAttachments"
              :key="filename"
              class="attach-item"
            >
              <input
                type="checkbox"
                :checked="selectedForDelete.has(filename)"
                @change="toggleFileSelect(filename)"
              />
              <span class="attach-filename">{{ filename }}</span>
            </label>
          </div>
          <div class="attach-footer">
            <button class="attach-keep-btn" @click="keepAllAttachments">
              {{ t('travel.attachmentScan.keepAll') }}
            </button>
            <button
              class="attach-delete-btn"
              :disabled="selectedForDelete.size === 0"
              @click="deleteSelectedAttachments"
            >
              {{ t('travel.attachmentScan.deleteSelected') }} ({{ selectedForDelete.size }})
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.travel-sidebar {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: rgba(240, 240, 242, 0.45);
  backdrop-filter: blur(60px) saturate(2);
  -webkit-backdrop-filter: blur(60px) saturate(2);
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.10), 0 0 0 0.5px rgba(255, 255, 255, 0.6) inset;
}

.panel-header {
  height: 52px;
  padding: 0 10px 0 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.header-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
}

/* ─── Filter bar ──────────────────────────────────────────────────────────── */

.filter-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px 2px;
  flex-shrink: 0;
}

.filter-sep {
  font-size: 11px;
  color: #c7c7cc;
  flex-shrink: 0;
}

.filter-picker {
  position: relative;
  flex: 1;
  min-width: 0;
}

.filter-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  padding: 0 6px;
  border: none;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 6px;
  cursor: pointer;
  width: 100%;
  transition: background 0.12s;
}

.filter-btn:hover { background: rgba(0, 0, 0, 0.09); }
.filter-btn.active { background: rgba(34, 63, 121, 0.10); }
.filter-btn.active .filter-label { color: #223F79; }

.filter-label {
  font-size: 11.5px;
  font-weight: 500;
  color: #3c3c43;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
  text-align: left;
}

.filter-chevron {
  color: #8e8e93;
  flex-shrink: 0;
  transition: transform 0.15s;
}
.filter-chevron.rotated { transform: rotate(180deg); }

/* ─── Category picker dropdown ────────────────────────────────────────────── */

.picker-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 140px;
  background: rgba(250, 250, 252, 0.96);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  padding: 5px;
  z-index: 50;
}

.picker-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.07);
  margin: 4px 4px;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: transparent;
  border-radius: 7px;
  cursor: pointer;
  text-align: left;
  transition: background 0.10s;
}

.picker-item:hover { background: rgba(0, 0, 0, 0.05); }
.picker-item.active { background: rgba(34, 63, 121, 0.08); }
.picker-item.active .picker-item-name { color: #223F79; }

.picker-item-name {
  font-size: 12.5px;
  font-weight: 500;
  color: #1c1c1e;
}

/* Transition */
.picker-drop-enter-active, .picker-drop-leave-active {
  transition: opacity 0.12s, transform 0.12s;
}
.picker-drop-enter-from, .picker-drop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ─── Header actions ──────────────────────────────────────────────────────── */

.header-actions {
  display: flex;
  gap: 2px;
  align-items: center;
}

.icon-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: #8e8e93;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.icon-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #3c3c43;
}

.icon-btn--active {
  color: #223F79 !important;
  background: rgba(34, 63, 121, 0.08) !important;
}

.tag-filter-wrap {
  position: relative;
}

.tag-picker-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 140px;
  background: rgba(250, 250, 252, 0.96);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  padding: 5px;
  z-index: 50;
}

/* ─── Search ──────────────────────────────────────────────────────────────── */

.search-bar {
  margin: 6px 12px 8px;
  height: 30px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 8px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  gap: 7px;
  flex-shrink: 0;
}

.search-icon {
  color: #8e8e93;
  flex-shrink: 0;
}

.search-input {
  border: none;
  background: transparent;
  color: #1c1c1e;
  font-size: 12px;
  width: 100%;
  outline: none;
}

.search-input::placeholder {
  color: #8e8e93;
}

/* ─── List ────────────────────────────────────────────────────────────────── */

.list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 4px 6px 8px;
}

.list-scroll::-webkit-scrollbar {
  width: 4px;
}

.list-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.list-scroll::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 2px;
}

.list-item {
  padding: 10px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  transition: background 0.12s;
}

.list-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.list-item.active {
  background: rgba(34, 63, 121, 0.10);
}

.item-cover {
  font-size: 20px;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  background: rgba(120, 120, 128, 0.1);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  overflow: hidden;
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.item-content {
  min-width: 0;
  flex: 1;
}

.item-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 3px;
}

.item-title {
  font-size: 13px;
  font-weight: 500;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.item-cat-prefix {
  color: #1c1c1e;
  font-weight: 500;
}

.list-item.active .item-title {
  color: #223F79;
}

.list-item.active .item-cat-prefix {
  color: #223F79;
}

.delete-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: #c7c7cc;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.12s, color 0.12s;
  flex-shrink: 0;
}

.list-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: rgba(255, 59, 48, 0.10);
  color: #ff3b30;
}

.item-preview {
  font-size: 11px;
  color: #8e8e93;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.item-category {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
}

.item-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
}

.item-rating {
  font-size: 10px;
  color: #ff9500;
  display: flex;
  align-items: center;
  gap: 2px;
}

.star-icon {
  fill: #ff9500;
}

.item-date {
  font-size: 10px;
  color: #aeaeb2;
  display: flex;
  align-items: center;
  gap: 3px;
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  gap: 10px;
  text-align: center;
}

.empty-icon {
  color: #c7c7cc;
}

.empty-text {
  font-size: 13px;
  color: #8e8e93;
  margin: 0;
}

.empty-action {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
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

.empty-action:hover {
  background: rgba(34, 63, 121, 0.18);
}

/* ─── Recently Deleted ────────────────────────────────────────────────────── */

.trash-section {
  flex-shrink: 0;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.trash-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
}

.trash-toggle:hover {
  background: rgba(0, 0, 0, 0.03);
}

.trash-chevron {
  color: #aeaeb2;
  flex-shrink: 0;
  transition: transform 0.15s;
}

.trash-chevron.rotated {
  transform: rotate(90deg);
}

.trash-toggle-icon {
  color: #aeaeb2;
  flex-shrink: 0;
}

.trash-toggle-label {
  font-size: 11px;
  font-weight: 500;
  color: #8e8e93;
  flex: 1;
}

.trash-count-badge {
  font-size: 10px;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.08);
  color: #8e8e93;
  padding: 1px 6px;
  border-radius: 8px;
  flex-shrink: 0;
}

.trash-clear-btn {
  font-size: 10px;
  color: #ff3b30;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0 2px;
  flex-shrink: 0;
  transition: opacity 0.12s;
}

.trash-clear-btn:hover {
  opacity: 0.7;
}

.trash-list {
  padding: 2px 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
}

.trash-list::-webkit-scrollbar { width: 3px; }
.trash-list::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.10); border-radius: 2px; }

.trash-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  transition: background 0.10s;
}

.trash-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.trash-item-cover {
  font-size: 16px;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  background: rgba(120, 120, 128, 0.08);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
}

.trash-item-info {
  flex: 1;
  min-width: 0;
}

.trash-item-title {
  font-size: 12px;
  font-weight: 500;
  color: #6e6e73;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.trash-item-meta {
  font-size: 10px;
  color: #aeaeb2;
}

.trash-days-left {
  color: #ff9500;
}

.trash-item-actions {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.trash-item:hover .trash-item-actions {
  opacity: 1;
}

.trash-action-btn {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.10s;
}

.restore-btn {
  color: #34c759;
}

.restore-btn:hover {
  background: rgba(52, 199, 89, 0.12);
}

.perm-delete-btn {
  color: #c7c7cc;
}

.perm-delete-btn:hover {
  background: rgba(255, 59, 48, 0.10);
  color: #ff3b30;
}

/* ─── Attachment cleanup dialog ───────────────────────────────────────────── */

.attach-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.attach-dialog {
  background: rgba(250, 250, 252, 0.98);
  backdrop-filter: blur(24px) saturate(1.8);
  -webkit-backdrop-filter: blur(24px) saturate(1.8);
  border-radius: 14px;
  padding: 20px;
  width: 340px;
  max-width: 90vw;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
}

.attach-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.attach-icon {
  color: #ff9500;
}

.attach-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
}

.attach-desc {
  font-size: 12px;
  color: #6e6e73;
  margin: 0 0 12px;
  line-height: 1.5;
}

.attach-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
  margin-bottom: 16px;
}

.attach-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.10s;
}

.attach-item:hover { background: rgba(0, 0, 0, 0.04); }

.attach-filename {
  font-size: 12px;
  color: #1c1c1e;
  word-break: break-all;
}

.attach-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.attach-keep-btn {
  padding: 7px 14px;
  border-radius: 8px;
  border: none;
  background: rgba(0, 0, 0, 0.07);
  color: #3c3c43;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s;
}

.attach-keep-btn:hover { background: rgba(0, 0, 0, 0.12); }

.attach-delete-btn {
  padding: 7px 14px;
  border-radius: 8px;
  border: none;
  background: rgba(255, 59, 48, 0.12);
  color: #ff3b30;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s;
}

.attach-delete-btn:hover:not(:disabled) { background: rgba(255, 59, 48, 0.20); }
.attach-delete-btn:disabled { opacity: 0.4; cursor: default; }
</style>
