<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Search, Plus, Trash2, FileText, ChevronRight,
  Folder, FolderOpen, GripVertical, RotateCcw, X, Check,
} from 'lucide-vue-next'
import { useNotesStore } from '../../stores/notes'
import { initImageAssetBase, resolveImageUrl } from '../../utils/imageAsset'

const { t } = useI18n()
const store = useNotesStore()

initImageAssetBase()

// ─── Pastel tag colors ───────────────────────────────────────────────────────

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

// ─── Group expansion state ───────────────────────────────────────────────────

const expandedGroups = ref<Set<string>>(new Set())

function isGroupExpanded(groupId: string): boolean {
  return expandedGroups.value.has(groupId)
}

function toggleGroup(groupId: string) {
  if (expandedGroups.value.has(groupId)) {
    expandedGroups.value.delete(groupId)
  } else {
    expandedGroups.value.add(groupId)
  }
  expandedGroups.value = new Set(expandedGroups.value)
}

// ─── New group ───────────────────────────────────────────────────────────────

const addingGroup = ref(false)
const newGroupName = ref('')
const newGroupInputRef = ref<HTMLInputElement>()

function startAddGroup() {
  addingGroup.value = true
  nextTick(() => newGroupInputRef.value?.focus())
}

function submitNewGroup() {
  const name = newGroupName.value.trim()
  if (name) store.createGroup(name)
  newGroupName.value = ''
  addingGroup.value = false
}

function cancelNewGroup() {
  newGroupName.value = ''
  addingGroup.value = false
}

// ─── Grouped notes ───────────────────────────────────────────────────────────

const sortedGroups = computed(() => {
  return [...store.groups].sort((a, b) => a.sortOrder - b.sortOrder)
})

const ungroupedNotes = computed(() => {
  return store.filteredNotes.filter(n => !n.groupId)
})

function notesInGroup(groupId: string) {
  return store.filteredNotes.filter(n => n.groupId === groupId)
}

// ─── Note actions ────────────────────────────────────────────────────────────

function onNoteClick(id: string) {
  store.openNote(id)
  store.viewMode = 'editor'
}

function onNewNote() {
  store.newNote()
}

function onDeleteNote(e: MouseEvent, id: string) {
  e.stopPropagation()
  store.deleteOne(id)
}

// ─── Trash ───────────────────────────────────────────────────────────────────

const trashOpen = ref(false)

async function onRestoreTrash(id: string) {
  await store.restoreTrashItem(id)
}

async function onPermanentDelete(id: string) {
  await store.permanentlyDeleteTrashItem(id)
}

async function onClearAllTrash() {
  if (window.confirm(t('notes.recentlyDeleted.clearConfirm'))) {
    await store.clearAllTrash()
  }
}

// ─── Drag and drop ───────────────────────────────────────────────────────────

const dragOverGroupId = ref<string>('__none__')

function onDragStart(e: DragEvent, noteId: string) {
  if (e.dataTransfer) {
    e.dataTransfer.setData('text/plain', noteId)
    e.dataTransfer.effectAllowed = 'move'
  }
}

function onDragOver(e: DragEvent, groupId: string) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverGroupId.value = groupId || '__ungrouped__'
}


function onDragLeave() {
  dragOverGroupId.value = '__none__'
}

function onDrop(e: DragEvent, groupId: string) {
  e.preventDefault()
  dragOverGroupId.value = '__none__'
  const noteId = e.dataTransfer?.getData('text/plain')
  if (!noteId) return
  store.moveNoteToGroup(noteId, groupId)
}

// ─── Click outside for any pickers ───────────────────────────────────────────

function handlePickerOutside(_e: MouseEvent) {
  // no-op placeholder for future pickers
}

onMounted(() => document.addEventListener('mousedown', handlePickerOutside))
onUnmounted(() => document.removeEventListener('mousedown', handlePickerOutside))
</script>

<template>
  <div class="notes-sidebar">
    <!-- Header -->
    <div class="panel-header">
      <div class="header-title">{{ t('notes.title') }}</div>
      <div class="header-actions">
        <button class="icon-btn" :title="t('notes.newGroup')" @click="startAddGroup">
          <Folder :size="14" />
        </button>
        <button class="icon-btn" :title="t('notes.newNote')" @click="onNewNote">
          <Plus :size="15" />
        </button>
      </div>
    </div>

    <!-- Search -->
    <div class="search-bar">
      <Search :size="13" class="search-icon" />
      <input
        v-model="store.searchQuery"
        class="search-input"
        :placeholder="t('notes.search')"
        type="text"
      />
    </div>

    <!-- New group input -->
    <div v-if="addingGroup" class="new-group-wrap">
      <input
        ref="newGroupInputRef"
        v-model="newGroupName"
        class="new-group-input"
        :placeholder="t('notes.groupNamePlaceholder')"
        @keydown.enter="submitNewGroup"
        @keydown.esc="cancelNewGroup"
        @blur="submitNewGroup"
      />
      <button class="icon-btn" @click="submitNewGroup"><Check :size="13" /></button>
      <button class="icon-btn" @click="cancelNewGroup"><X :size="13" /></button>
    </div>

    <!-- Notes list -->
    <div class="list-scroll">
      <!-- Empty state -->
      <div v-if="store.notes.length === 0" class="empty-state">
        <FileText :size="32" class="empty-icon" />
        <p class="empty-text">{{ t('notes.noEntries') }}</p>
        <button class="empty-action" @click="onNewNote">
          <Plus :size="13" />
          {{ t('notes.newNote') }}
        </button>
      </div>

      <!-- No search results -->
      <div v-else-if="!store.filteredNotes.length" class="empty-state">
        <Search :size="28" class="empty-icon" />
        <p class="empty-text">{{ t('notes.noResults') }}</p>
      </div>

      <!-- Grouped notes -->
      <template v-else>
        <!-- Ungrouped -->
        <div
          class="group-section"
          :class="{ 'drag-over': dragOverGroupId === '__ungrouped__' }"
          @dragover="onDragOver($event, '')"
          @dragleave="onDragLeave"
          @drop="onDrop($event, '')"
        >
          <button class="group-header" @click="toggleGroup('__ungrouped__')">
            <ChevronRight
              :size="11"
              class="group-chevron"
              :class="{ rotated: isGroupExpanded('__ungrouped__') }"
            />
            <FolderOpen v-if="isGroupExpanded('__ungrouped__')" :size="13" class="group-icon" />
            <Folder v-else :size="13" class="group-icon" />
            <span class="group-name">{{ t('notes.ungrouped') }}</span>
            <span class="group-count">{{ ungroupedNotes.length }}</span>
          </button>
          <div v-if="isGroupExpanded('__ungrouped__')" class="group-notes">
            <div
              v-for="note in ungroupedNotes"
              :key="note.id"
              class="list-item"
              :class="{ active: store.activeNoteId === note.id }"
              draggable="true"
              @click="onNoteClick(note.id)"
              @dragstart="onDragStart($event, note.id)"
            >
              <GripVertical :size="12" class="drag-handle" />
              <div class="item-content">
                <div class="item-title-row">
                  <div class="item-title">{{ note.title }}</div>
                  <button
                    class="delete-btn"
                    :title="t('common.delete')"
                    @click="onDeleteNote($event, note.id)"
                  >
                    <Trash2 :size="12" />
                  </button>
                </div>
                <div class="item-preview-text">{{ note.preview || '' }}</div>
                <div class="item-meta-row">
                  <div class="item-tags-left">
                    <span
                      v-for="tag in (note.tags ?? []).slice(0, 2)"
                      :key="tag"
                      class="item-tag"
                      :style="pastelStyle(tag)"
                    >#{{ tag }}</span>
                  </div>
                  <span class="item-date">{{ note.date }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Groups -->
        <div
          v-for="group in sortedGroups"
          :key="group.id"
          class="group-section"
          :class="{ 'drag-over': dragOverGroupId === group.id }"
          @dragover="onDragOver($event, group.id)"
          @dragleave="onDragLeave"
          @drop="onDrop($event, group.id)"
        >
          <button class="group-header" @click="toggleGroup(group.id)">
            <ChevronRight
              :size="11"
              class="group-chevron"
              :class="{ rotated: isGroupExpanded(group.id) }"
            />
            <FolderOpen v-if="isGroupExpanded(group.id)" :size="13" class="group-icon" />
            <Folder v-else :size="13" class="group-icon" />
            <span class="group-name">{{ group.name }}</span>
            <span class="group-count">{{ notesInGroup(group.id).length }}</span>
          </button>
          <div v-if="isGroupExpanded(group.id)" class="group-notes">
            <div
              v-for="note in notesInGroup(group.id)"
              :key="note.id"
              class="list-item"
              :class="{ active: store.activeNoteId === note.id }"
              draggable="true"
              @click="onNoteClick(note.id)"
              @dragstart="onDragStart($event, note.id)"
            >
              <GripVertical :size="12" class="drag-handle" />
              <div class="item-content">
                <div class="item-title-row">
                  <div class="item-title">{{ note.title }}</div>
                  <button
                    class="delete-btn"
                    :title="t('common.delete')"
                    @click="onDeleteNote($event, note.id)"
                  >
                    <Trash2 :size="12" />
                  </button>
                </div>
                <div class="item-preview-text">{{ note.preview || '' }}</div>
                <div class="item-meta-row">
                  <div class="item-tags-left">
                    <span
                      v-for="tag in (note.tags ?? []).slice(0, 2)"
                      :key="tag"
                      class="item-tag"
                      :style="pastelStyle(tag)"
                    >#{{ tag }}</span>
                  </div>
                  <span class="item-date">{{ note.date }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Recently Deleted -->
    <div v-if="store.trashItems.length > 0" class="trash-section">
      <button class="trash-toggle" @click="trashOpen = !trashOpen">
        <ChevronRight :size="11" class="trash-chevron" :class="{ rotated: trashOpen }" />
        <Trash2 :size="11" class="trash-toggle-icon" />
        <span class="trash-toggle-label">{{ t('notes.recentlyDeleted.title') }}</span>
        <span class="trash-count-badge">{{ store.trashItems.length }}</span>
        <button
          v-if="trashOpen"
          class="trash-clear-btn"
          :title="t('notes.recentlyDeleted.clearAll')"
          @click.stop="onClearAllTrash"
        >{{ t('notes.recentlyDeleted.clearAll') }}</button>
      </button>
      <div v-if="trashOpen" class="trash-list">
        <div
          v-for="item in store.trashItems"
          :key="item.id"
          class="trash-item"
        >
          <div class="trash-item-cover">
            <img
              v-if="item.cover && (item.cover.startsWith('http') || item.cover.startsWith('/') || item.cover.includes('.'))"
              :src="resolveImageUrl(item.cover)"
              class="cover-img"
              alt=""
            />
            <span v-else>{{ item.cover || '🗑️' }}</span>
          </div>
          <div class="trash-item-info">
            <div class="trash-item-title">{{ item.title }}</div>
            <div class="trash-item-meta">
              <span>{{ t('notes.recentlyDeleted.deletedOn') }} {{ item.updatedAt.slice(0, 10) }}</span>
            </div>
          </div>
          <div class="trash-item-actions">
            <button
              class="trash-action-btn restore-btn"
              :title="t('notes.recentlyDeleted.restore')"
              @click="onRestoreTrash(item.id)"
            >
              <RotateCcw :size="11" />
            </button>
            <button
              class="trash-action-btn perm-delete-btn"
              :title="t('notes.recentlyDeleted.deletePermanently')"
              @click="onPermanentDelete(item.id)"
            >
              <Trash2 :size="11" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notes-sidebar {
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

/* ─── New group input ─────────────────────────────────────────────────────── */

.new-group-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px 8px;
  flex-shrink: 0;
}

.new-group-input {
  flex: 1;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid rgba(34, 63, 121, 0.3);
  background: white;
  font-size: 12px;
  color: #1c1c1e;
  outline: none;
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

/* ─── Group sections ──────────────────────────────────────────────────────── */

.group-section {
  margin-bottom: 2px;
  border-radius: 8px;
  transition: background 0.15s;
}

.group-section.drag-over {
  background: rgba(34, 63, 121, 0.08);
}

.group-header {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  border-radius: 8px;
  transition: background 0.12s;
}

.group-header:hover {
  background: rgba(0, 0, 0, 0.04);
}

.group-chevron {
  color: #8e8e93;
  flex-shrink: 0;
  transition: transform 0.15s;
}

.group-chevron.rotated {
  transform: rotate(90deg);
}

.group-icon {
  color: #8e8e93;
  flex-shrink: 0;
}

.group-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #3c3c43;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-count {
  font-size: 11px;
  font-weight: 500;
  color: #8e8e93;
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 6px;
  border-radius: 8px;
  flex-shrink: 0;
}

.group-notes {
  padding: 2px 2px 4px 24px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* ─── Note items ──────────────────────────────────────────────────────────── */

.list-item {
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  gap: 6px;
  align-items: flex-start;
  transition: background 0.12s;
}

.list-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.list-item.active {
  background: rgba(34, 63, 121, 0.10);
}

.drag-handle {
  color: #c7c7cc;
  flex-shrink: 0;
  margin-top: 2px;
  cursor: grab;
}

.drag-handle:active {
  cursor: grabbing;
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

.list-item.active .item-title {
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

.item-preview-text {
  font-size: 11px;
  color: #8e8e93;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
  display: block;
}

.item-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: space-between;
}

.item-tags-left {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.item-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
}

.item-date {
  font-size: 10px;
  color: #aeaeb2;
  flex-shrink: 0;
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

.trash-list::-webkit-scrollbar {
  width: 3px;
}

.trash-list::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.10);
  border-radius: 2px;
}

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
  overflow: hidden;
}

.trash-item-cover .cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
</style>
