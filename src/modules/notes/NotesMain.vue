<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileText, LayoutGrid, PenLine, Folder, Hash, Plus, ChevronDown } from 'lucide-vue-next'
import { useNotesStore } from '../../stores/notes'
import NotesEditor from './components/NotesEditor.vue'

const { t } = useI18n()
const store = useNotesStore()

const hasActive = computed(() => !!store.activeNoteId)
const showMeta = computed(() => hasActive.value && store.viewMode === 'editor')
const note = computed(() => store.activeNote)

// ─── Tag input in top bar ─────────────────────────────────────────────────────
const tagInput = ref('')
const tagInputVisible = ref(false)
const tagInputEl = ref<HTMLInputElement>()
const tagSuggestionsVisible = ref(false)

const tagSuggestions = computed(() => {
  const q = tagInput.value.trim().toLowerCase()
  const existing = new Set(note.value?.tags ?? [])
  return store.allTags
    .filter(t => !existing.has(t) && (q === '' || t.toLowerCase().includes(q)))
    .slice(0, 6)
})

function startAddTag() {
  tagInputVisible.value = true
  tagSuggestionsVisible.value = true
  nextTick(() => tagInputEl.value?.focus())
}

function applyTag(tag: string) {
  if (!note.value || note.value.tags.includes(tag)) return
  store.setTags([...note.value.tags, tag])
  tagInput.value = ''; tagInputVisible.value = false; tagSuggestionsVisible.value = false
}

function addTag() {
  const v = tagInput.value.trim()
  if (v) applyTag(v)
  else { tagInput.value = ''; tagInputVisible.value = false; tagSuggestionsVisible.value = false }
}

function removeTag(tag: string) {
  if (!note.value) return
  store.setTags(note.value.tags.filter(t => t !== tag))
}

function onTagBlur() {
  setTimeout(() => { tagInputVisible.value = false; tagSuggestionsVisible.value = false; tagInput.value = '' }, 150)
}

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

      <!-- Active note meta: group + tags -->
      <div v-if="showMeta && note" class="note-meta-bar">
        <!-- Group -->
        <div class="meta-group-wrap">
          <Folder :size="11" class="meta-icon" />
          <select :value="note.groupId ?? ''" class="meta-group-select" @change="store.setGroupId(($event.target as HTMLSelectElement).value)">
            <option value="">{{ t('notes.noGroup') }}</option>
            <option v-for="g in store.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
          <ChevronDown :size="9" class="meta-chevron" />
        </div>

        <span class="meta-sep">·</span>

        <!-- Tags -->
        <div class="meta-tags-wrap">
          <Hash :size="11" class="meta-icon" />
          <span v-for="tag in (note.tags ?? [])" :key="tag" class="meta-tag-chip">
            {{ tag }}<button class="meta-tag-remove" @mousedown.prevent="removeTag(tag)">×</button>
          </span>
          <div v-if="tagInputVisible" class="meta-tag-input-wrap">
            <input
              ref="tagInputEl"
              v-model="tagInput"
              class="meta-tag-input"
              :placeholder="t('notes.tagPlaceholder')"
              @keydown.enter.prevent="addTag"
              @keydown.escape="tagInputVisible = false; tagInput = ''"
              @blur="onTagBlur"
            />
            <div v-if="tagSuggestionsVisible && tagSuggestions.length" class="meta-tag-suggestions">
              <button v-for="s in tagSuggestions" :key="s" class="meta-tag-sugg" @mousedown.prevent="applyTag(s)">#{{ s }}</button>
            </div>
          </div>
          <button v-else class="meta-tag-add" @click="startAddTag">
            <Plus :size="10" />
            <span v-if="!(note.tags?.length)">{{ t('notes.tags') }}</span>
          </button>
        </div>
      </div>

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
  flex-shrink: 0;
}

/* ─── Note meta bar (group + tags) ───────────────────────────────────────── */

.note-meta-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 0 16px;
  overflow: hidden;
}

.meta-icon { color: #aeaeb2; flex-shrink: 0; }
.meta-sep  { font-size: 11px; color: #d1d1d6; flex-shrink: 0; }

/* Group select */
.meta-group-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  position: relative;
  flex-shrink: 0;
}

.meta-group-select {
  border: none;
  background: transparent;
  outline: none;
  font-size: 11.5px;
  color: #6e6e73;
  cursor: pointer;
  font-family: inherit;
  appearance: none;
  -webkit-appearance: none;
  padding-right: 14px;
  max-width: 110px;
  text-overflow: ellipsis;
  overflow: hidden;
}
.meta-group-select:hover { color: #3c3c43; }

.meta-chevron { position: absolute; right: 0; color: #aeaeb2; pointer-events: none; }

/* Tags */
.meta-tags-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  overflow: hidden;
  min-width: 0;
}

.meta-tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 5px 2px 6px;
  background: rgba(34, 63, 121, 0.07);
  color: #223F79;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.meta-tag-remove {
  border: none;
  background: transparent;
  color: #223F79;
  opacity: 0.45;
  cursor: pointer;
  padding: 0;
  font-size: 13px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  transition: opacity 0.12s;
}
.meta-tag-remove:hover { opacity: 0.9; }

.meta-tag-add {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: none;
  background: transparent;
  color: #aeaeb2;
  border-radius: 5px;
  padding: 2px 5px;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
}
.meta-tag-add:hover { background: rgba(0, 0, 0, 0.05); color: #6e6e73; }

.meta-tag-input-wrap { position: relative; flex-shrink: 0; }
.meta-tag-input {
  width: 80px; height: 22px;
  border: 1px solid rgba(34, 63, 121, 0.28);
  border-radius: 5px; padding: 0 7px;
  font-size: 11px; background: rgba(34, 63, 121, 0.04);
  color: #1c1c1e; outline: none; font-family: inherit;
}
.meta-tag-input:focus { border-color: rgba(34, 63, 121, 0.5); }

.meta-tag-suggestions {
  position: absolute; top: calc(100% + 4px); left: 0; min-width: 130px;
  background: rgba(252, 252, 254, 0.98); border: 1px solid rgba(0, 0, 0, 0.09);
  border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 4px; z-index: 60; display: flex; flex-direction: column; gap: 1px;
}
.meta-tag-sugg {
  display: block; width: 100%; text-align: left;
  padding: 5px 9px; border-radius: 6px; border: none; background: none;
  font-size: 11.5px; color: #223F79; cursor: pointer; font-family: inherit;
  transition: background 0.10s;
}
.meta-tag-sugg:hover { background: rgba(34, 63, 121, 0.08); }

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

</style>
