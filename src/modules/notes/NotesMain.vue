<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileText, LayoutGrid, PenLine } from 'lucide-vue-next'
import { useNotesStore } from '../../stores/notes'
import NotesEditor from './components/NotesEditor.vue'

const { t } = useI18n()
const store = useNotesStore()

const hasActive = computed(() => !!store.activeNoteId)

// ─── Time-buckets for flashcard home page ────────────────────────────────────

const now = computed(() => Date.now())

function daysAgo(d: number) {
  return now.value - d * 24 * 60 * 60 * 1000
}

function getUpdatedTs(note: { updatedAt?: string }): number {
  return note.updatedAt ? new Date(note.updatedAt).getTime() : 0
}

const notesByTime = computed(() => {
  const list = [...store.notes].sort((a, b) => getUpdatedTs(b) - getUpdatedTs(a))
  const oneDay = list.filter(n => getUpdatedTs(n) >= daysAgo(1))
  const threeDay = list.filter(n => getUpdatedTs(n) >= daysAgo(3) && getUpdatedTs(n) < daysAgo(1))
  const fiveDay = list.filter(n => getUpdatedTs(n) >= daysAgo(5) && getUpdatedTs(n) < daysAgo(3))
  const oneWeek = list.filter(n => getUpdatedTs(n) >= daysAgo(7) && getUpdatedTs(n) < daysAgo(5))
  return { oneDay, threeDay, fiveDay, oneWeek }
})

const rows = computed(() => [
  { key: 'oneDay', label: t('notes.timeRange.oneDay'), notes: notesByTime.value.oneDay, gradient: 'linear-gradient(135deg, rgba(174,214,241,0.45) 0%, rgba(196,215,248,0.35) 100%)' },
  { key: 'threeDay', label: t('notes.timeRange.threeDays'), notes: notesByTime.value.threeDay, gradient: 'linear-gradient(135deg, rgba(176,230,198,0.45) 0%, rgba(170,235,180,0.35) 100%)' },
  { key: 'fiveDay', label: t('notes.timeRange.fiveDays'), notes: notesByTime.value.fiveDay, gradient: 'linear-gradient(135deg, rgba(255,218,185,0.50) 0%, rgba(251,210,166,0.40) 100%)' },
  { key: 'oneWeek', label: t('notes.timeRange.oneWeek'), notes: notesByTime.value.oneWeek, gradient: 'linear-gradient(135deg, rgba(212,172,242,0.35) 0%, rgba(220,210,255,0.30) 100%)' },
])

function openNote(id: string) {
  store.openNote(id)
  store.viewMode = 'editor'
}

function formatCardDate(updatedAt?: string): string {
  if (!updatedAt) return ''
  const d = new Date(updatedAt)
  const nowDate = new Date()
  const isToday = d.toDateString() === nowDate.toDateString()
  if (isToday) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<template>
  <div class="notes-main">
    <!-- Top bar -->
    <div class="top-bar">
      <div class="top-bar-title">{{ t('notes.title') }}</div>
      <div class="view-toggle">
        <button
          class="toggle-btn"
          :class="{ active: store.viewMode === 'home' }"
          @click="store.viewMode = 'home'"
        >
          <LayoutGrid :size="14" />
          {{ t('notes.homeView') }}
        </button>
        <button
          v-if="hasActive"
          class="toggle-btn"
          :class="{ active: store.viewMode === 'editor' }"
          @click="store.viewMode = 'editor'"
        >
          <PenLine :size="14" />
          {{ t('notes.editorView') }}
        </button>
      </div>
    </div>

    <!-- Home view -->
    <div v-if="store.viewMode === 'home'" class="home-view">
      <div
        v-for="row in rows"
        :key="row.key"
        class="time-row"
      >
        <div class="row-header">
          <span class="row-label">{{ row.label }}</span>
          <span v-if="row.notes.length" class="row-count">{{ row.notes.length }}</span>
        </div>
        <div v-if="row.notes.length === 0" class="row-empty">
          {{ t('notes.noNotesInRange') }}
        </div>
        <div v-else class="cards-scroll">
          <div
            v-for="note in row.notes"
            :key="note.id"
            class="note-card"
            :style="{ background: row.gradient }"
            @click="openNote(note.id)"
          >
            <div class="card-title">{{ note.title }}</div>
            <div class="card-preview">{{ note.preview || t('notes.noPreview') }}</div>
            <div class="card-footer">
              <div class="card-tags">
                <span
                  v-for="tag in (note.tags ?? []).slice(0, 2)"
                  :key="tag"
                  class="card-tag"
                >#{{ tag }}</span>
              </div>
              <span class="card-date">{{ formatCardDate(note.updatedAt) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Editor view -->
    <div v-else class="editor-view">
      <div v-if="!hasActive" class="placeholder-state">
        <div class="placeholder-icon">
          <FileText :size="40" />
        </div>
        <p class="placeholder-text">{{ t('notes.placeholder') }}</p>
      </div>
      <NotesEditor v-else />

      <!-- Floating back button -->
      <button
        v-if="store.viewMode === 'editor'"
        class="floating-home-btn"
        @click="store.viewMode = 'home'"
      >
        <LayoutGrid :size="14" />
        {{ t('notes.backToHome') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.notes-main {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

/* ─── Top bar ─────────────────────────────────────────────────────────────── */

.top-bar {
  height: 48px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.top-bar-title {
  font-size: 15px;
  font-weight: 600;
  color: #1c1c1e;
}

.view-toggle {
  display: flex;
  gap: 2px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 8px;
  padding: 3px;
}

.toggle-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  color: #8e8e93;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s;
  font-weight: 500;
}

.toggle-btn.active {
  background: white;
  color: #1c1c1e;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.10);
}

/* ─── Home view ───────────────────────────────────────────────────────────── */

.home-view {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.home-view::-webkit-scrollbar {
  width: 5px;
}

.home-view::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.10);
  border-radius: 3px;
}

.time-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.row-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.row-label {
  font-size: 13px;
  font-weight: 600;
  color: #3c3c43;
}

.row-count {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 7px;
  border-radius: 8px;
}

.row-empty {
  font-size: 12px;
  color: #aeaeb2;
  padding: 12px 4px;
}

.cards-scroll {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 4px 2px 12px;
  scroll-snap-type: x mandatory;
}

.cards-scroll::-webkit-scrollbar {
  height: 5px;
}

.cards-scroll::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.10);
  border-radius: 3px;
}

.note-card {
  flex-shrink: 0;
  width: 240px;
  min-height: 140px;
  border-radius: 14px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  scroll-snap-align: start;
  border: 1px solid rgba(255, 255, 255, 0.5);
}

.note-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.10);
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-preview {
  font-size: 12px;
  color: #6e6e73;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 6px;
}

.card-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.card-tag {
  font-size: 10px;
  font-weight: 500;
  color: #223F79;
  background: rgba(255, 255, 255, 0.55);
  padding: 2px 6px;
  border-radius: 5px;
}

.card-date {
  font-size: 10px;
  color: #8e8e93;
  flex-shrink: 0;
}

/* ─── Editor view ─────────────────────────────────────────────────────────── */

.editor-view {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.placeholder-state {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
}

.placeholder-icon {
  color: #c7c7cc;
}

.placeholder-text {
  font-size: 14px;
  color: #aeaeb2;
  margin: 0;
}

.floating-home-btn {
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(12px) saturate(1.6);
  -webkit-backdrop-filter: blur(12px) saturate(1.6);
  color: #3c3c43;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08), 0 0 0 0.5px rgba(0, 0, 0, 0.06) inset;
  transition: all 0.12s;
}

.floating-home-btn:hover {
  background: white;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
}
</style>
