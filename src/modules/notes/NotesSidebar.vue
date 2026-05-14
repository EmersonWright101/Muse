<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Search, Plus, Trash2, FileText, ChevronRight,
  Folder, FolderOpen, GripVertical, RotateCcw, X, Check, SlidersHorizontal,
} from 'lucide-vue-next'
import { useNotesStore } from '../../stores/notes'
import { initImageAssetBase, resolveImageUrl } from '../../utils/imageAsset'

const { t } = useI18n()
const store = useNotesStore()

initImageAssetBase()

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

// ─── Filter panel ────────────────────────────────────────────────────────────

const filterOpen = ref(false)
const filterBtnRef = ref<HTMLButtonElement>()

const hasActiveFilter = computed(() => !!store.selectedTag)

function toggleFilter() {
  filterOpen.value = !filterOpen.value
}

function selectTag(tag: string) {
  store.selectedTag = store.selectedTag === tag ? '' : tag
}

function clearFilter() {
  store.selectedTag = ''
}

function onFilterOutside(e: MouseEvent) {
  if (!filterOpen.value) return
  const target = e.target as HTMLElement
  if (!target.closest('.filter-wrap')) filterOpen.value = false
}

onMounted(() => document.addEventListener('mousedown', onFilterOutside))
onUnmounted(() => document.removeEventListener('mousedown', onFilterOutside))

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

// ─── Group context menu (right-click) ────────────────────────────────────────

interface CtxMenu { groupId: string; x: number; y: number }
const ctxMenu = ref<CtxMenu | null>(null)

function openGroupCtx(e: MouseEvent, groupId: string) {
  e.preventDefault()
  e.stopPropagation()
  ctxMenu.value = { groupId, x: e.clientX, y: e.clientY }
}

function closeCtxMenu() { ctxMenu.value = null }

function onCtxOutside(e: MouseEvent) {
  if (ctxMenu.value && !(e.target as HTMLElement).closest('.group-ctx-menu')) closeCtxMenu()
}

onMounted(() => document.addEventListener('mousedown', onCtxOutside))
onUnmounted(() => document.removeEventListener('mousedown', onCtxOutside))

// ─── Ungrouped custom display name (persisted in localStorage) ───────────────

const LS_UNGROUPED_NAME = 'muse-notes-ungrouped-name'
const ungroupedDisplayName = ref(localStorage.getItem(LS_UNGROUPED_NAME) || '')

function getGroupDisplayName(groupId: string, fallback: string): string {
  if (groupId === '__ungrouped__') return ungroupedDisplayName.value || t('notes.ungrouped')
  return fallback
}

// ─── Group rename (inline input) ─────────────────────────────────────────────

const renamingGroupId = ref<string | null>(null)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement>()

function startRenameGroup(groupId: string, currentName: string) {
  closeCtxMenu()
  renamingGroupId.value = groupId
  renameValue.value = currentName
  nextTick(() => { renameInputRef.value?.focus(); renameInputRef.value?.select() })
}

async function submitRenameGroup() {
  const name = renameValue.value.trim()
  if (name && renamingGroupId.value) {
    if (renamingGroupId.value === '__ungrouped__') {
      ungroupedDisplayName.value = name
      localStorage.setItem(LS_UNGROUPED_NAME, name)
    } else {
      await store.renameGroup(renamingGroupId.value, name)
    }
  }
  renamingGroupId.value = null
  renameValue.value = ''
}

function cancelRenameGroup() {
  renamingGroupId.value = null
  renameValue.value = ''
}

async function deleteGroupFromCtx(groupId: string) {
  closeCtxMenu()
  await store.deleteGroup(groupId)
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

function onDeleteNote(id: string) {
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

// ─── Mouse-based drag (avoids macOS native drag API and the "+" copy badge) ───

interface DragState {
  noteId: string
  startX: number
  startY: number
  active: boolean
  ghostX: number
  ghostY: number
  overGroupId: string
}

const drag = ref<DragState | null>(null)
const dragOverGroupId = computed(() => drag.value?.active ? drag.value.overGroupId : '__none__')

function startDrag(e: MouseEvent, noteId: string) {
  e.preventDefault() // prevent text selection; does not block click event
  document.body.style.userSelect = 'none'
  drag.value = { noteId, startX: e.clientX, startY: e.clientY, active: false, ghostX: e.clientX, ghostY: e.clientY, overGroupId: '' }
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function noteIcon(note: { cover?: string }): string {
  const c = note.cover ?? ''
  return (c && !c.startsWith('http') && !c.includes('.')) ? c : '📝'
}

function onDragMove(e: MouseEvent) {
  if (!drag.value) return
  const dx = e.clientX - drag.value.startX
  const dy = e.clientY - drag.value.startY
  if (!drag.value.active && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
    drag.value.active = true
    document.body.style.cursor = 'grabbing'
  }
  if (drag.value.active) {
    drag.value.ghostX = e.clientX
    drag.value.ghostY = e.clientY
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const section = el?.closest('[data-group-id]') as HTMLElement | null
    drag.value.overGroupId = section?.dataset.groupId ?? ''
  }
}

function onDragEnd() {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  const d = drag.value
  drag.value = null
  if (!d) return
  if (d.active && d.overGroupId !== '') {
    // Completed a drag-to-group
    const rawId = d.overGroupId === '__ungrouped__' ? '' : d.overGroupId
    store.moveNoteToGroup(d.noteId, rawId)
  } else if (!d.active) {
    // No movement — treat as a click to open the note
    onNoteClick(d.noteId)
  }
}

</script>

<template>
  <div class="notes-sidebar" @contextmenu.prevent>
    <!-- Header -->
    <div class="panel-header">
      <div class="header-title">{{ t('notes.title') }}</div>
      <div class="header-actions">
        <!-- Filter button -->
        <div class="filter-wrap">
          <button
            ref="filterBtnRef"
            class="icon-btn filter-btn"
            :class="{ active: hasActiveFilter }"
            :title="t('notes.tagFilter')"
            @click="toggleFilter"
          >
            <SlidersHorizontal :size="13" />
            <span v-if="hasActiveFilter" class="filter-dot" />
          </button>
          <div v-if="filterOpen" class="filter-panel">
            <div class="filter-panel-header">
              <span class="filter-panel-title">{{ t('notes.tagFilter') }}</span>
              <button v-if="hasActiveFilter" class="filter-clear-btn" @click="clearFilter">
                <X :size="10" /> {{ t('common.cancel') || 'Clear' }}
              </button>
            </div>
            <div v-if="store.allTags.length === 0" class="filter-empty">
              {{ t('notes.noNotes') || 'No tags yet' }}
            </div>
            <div v-else class="filter-tags">
              <button
                v-for="tag in store.allTags"
                :key="tag"
                class="filter-tag-chip"
                :class="{ selected: store.selectedTag === tag }"
                @click="selectTag(tag)"
              >
                #{{ tag }}
              </button>
            </div>
          </div>
        </div>

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
          data-group-id="__ungrouped__"
        >
          <div v-if="renamingGroupId === '__ungrouped__'" class="group-rename-wrap">
            <input
              ref="renameInputRef"
              v-model="renameValue"
              class="group-rename-input"
              @keydown.enter.prevent="submitRenameGroup"
              @keydown.esc="cancelRenameGroup"
              @blur="submitRenameGroup"
            />
          </div>
          <button v-else class="group-header" @click="toggleGroup('__ungrouped__')" @contextmenu.prevent="openGroupCtx($event, '__ungrouped__')">
            <ChevronRight
              :size="11"
              class="group-chevron"
              :class="{ rotated: isGroupExpanded('__ungrouped__') }"
            />
            <FolderOpen v-if="isGroupExpanded('__ungrouped__')" :size="13" class="group-icon" />
            <Folder v-else :size="13" class="group-icon" />
            <span class="group-name">{{ getGroupDisplayName('__ungrouped__', '') }}</span>
            <span class="group-count">{{ ungroupedNotes.length }}</span>
          </button>
          <div v-if="isGroupExpanded('__ungrouped__')" class="group-notes">
            <div
              v-for="note in ungroupedNotes"
              :key="note.id"
              class="list-item"
              :class="{ active: store.activeNoteId === note.id }"
              @mousedown="startDrag($event, note.id)"
              @contextmenu.prevent
            >
              <span class="note-icon">{{ noteIcon(note) }}</span>
              <span class="item-title">{{ note.title || t('notes.titlePlaceholder') }}</span>
              <button class="delete-btn" :title="t('common.delete')" @mousedown.stop @click.stop="onDeleteNote(note.id)">
                <Trash2 :size="11" />
              </button>
            </div>
          </div>
        </div>

        <!-- Groups -->
        <div
          v-for="group in sortedGroups"
          :key="group.id"
          class="group-section"
          :class="{ 'drag-over': dragOverGroupId === group.id }"
          :data-group-id="group.id"
        >
          <!-- Rename input (shown when renaming) -->
          <div v-if="renamingGroupId === group.id" class="group-rename-wrap">
            <input
              ref="renameInputRef"
              v-model="renameValue"
              class="group-rename-input"
              @keydown.enter.prevent="submitRenameGroup"
              @keydown.esc="cancelRenameGroup"
              @blur="submitRenameGroup"
            />
          </div>
          <button v-else class="group-header" @click="toggleGroup(group.id)" @contextmenu.prevent="openGroupCtx($event, group.id)">
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
              @mousedown="startDrag($event, note.id)"
              @contextmenu.prevent
            >
              <span class="note-icon">{{ noteIcon(note) }}</span>
              <span class="item-title">{{ note.title || t('notes.titlePlaceholder') }}</span>
              <button class="delete-btn" :title="t('common.delete')" @mousedown.stop @click.stop="onDeleteNote(note.id)">
                <Trash2 :size="11" />
              </button>
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
              <span>{{ t('notes.recentlyDeleted.deletedOn') }} {{ item.deletedAt.slice(0, 10) }}</span>
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

  <!-- Drag ghost (mouse-based drag) -->
  <Teleport to="body">
    <div
      v-if="drag?.active"
      class="notes-drag-ghost"
      :style="{ transform: `translate(${drag.ghostX + 14}px, ${drag.ghostY - 14}px)` }"
    >
      <GripVertical :size="11" />
      <span>移动笔记</span>
    </div>
  </Teleport>

  <!-- Group context menu -->
  <Teleport to="body">
    <div
      v-if="ctxMenu"
      class="group-ctx-menu"
      :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
    >
      <button class="ctx-item" @click="startRenameGroup(ctxMenu!.groupId, ctxMenu!.groupId === '__ungrouped__' ? getGroupDisplayName('__ungrouped__', '') : (store.groups.find(g => g.id === ctxMenu!.groupId)?.name ?? ''))">
        重命名
      </button>
      <template v-if="ctxMenu!.groupId !== '__ungrouped__'">
        <div class="ctx-sep" />
        <button class="ctx-item ctx-item--danger" @click="deleteGroupFromCtx(ctxMenu!.groupId)">
          删除分组
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.notes-sidebar {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: rgba(235, 235, 235, 0.85);
  backdrop-filter: blur(40px) saturate(1.8);
  -webkit-backdrop-filter: blur(40px) saturate(1.8);
  border-radius: 24px;
  overflow: hidden;
  clip-path: inset(0 round 24px);
  box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.6) inset;
  user-select: none;
  -webkit-user-select: none;
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
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  gap: 6px;
  align-items: center;
  transition: background 0.12s;
  user-select: none;
  -webkit-user-select: none;
}

.list-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.list-item.active {
  background: rgba(34, 63, 121, 0.10);
}

.note-icon {
  flex-shrink: 0;
  font-size: 14px;
  line-height: 1;
  width: 18px;
  text-align: center;
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

/* ─── Filter ──────────────────────────────────────────────────────────────── */

.filter-wrap {
  position: relative;
}

.filter-btn {
  position: relative;
}

.filter-btn.active {
  color: #223F79;
  background: rgba(34, 63, 121, 0.09);
}

.filter-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #223F79;
  pointer-events: none;
}

.filter-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 100;
  min-width: 160px;
  max-width: 220px;
  background: rgba(252, 252, 254, 0.98);
  border: 1px solid rgba(0, 0, 0, 0.09);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.13), 0 2px 8px rgba(0, 0, 0, 0.06);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.filter-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 4px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.filter-panel-title {
  font-size: 11px;
  font-weight: 600;
  color: #3c3c43;
  letter-spacing: 0.02em;
}

.filter-clear-btn {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: #ff3b30;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 1px 4px;
  border-radius: 4px;
  transition: background 0.1s;
}

.filter-clear-btn:hover {
  background: rgba(255, 59, 48, 0.08);
}

.filter-empty {
  font-size: 11px;
  color: #aeaeb2;
  text-align: center;
  padding: 8px 4px;
}

.filter-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 2px 0;
}

.filter-tag-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(0, 0, 0, 0.03);
  color: #3c3c43;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
}

.filter-tag-chip:hover {
  background: rgba(34, 63, 121, 0.07);
  border-color: rgba(34, 63, 121, 0.18);
  color: #223F79;
}

.filter-tag-chip.selected {
  background: rgba(34, 63, 121, 0.10);
  border-color: rgba(34, 63, 121, 0.28);
  color: #223F79;
  font-weight: 600;
}

/* ─── Group rename ────────────────────────────────────────────────────────── */

.group-rename-wrap {
  padding: 4px 8px;
}

.group-rename-input {
  width: 100%;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid rgba(34, 63, 121, 0.35);
  background: white;
  font-size: 12.5px;
  font-weight: 600;
  color: #1c1c1e;
  outline: none;
  box-sizing: border-box;
}

.group-rename-input:focus {
  border-color: rgba(34, 63, 121, 0.55);
  box-shadow: 0 0 0 2px rgba(34, 63, 121, 0.10);
}
</style>

<style>
/* Drag ghost — outside scoped so Teleport can reach it */
.notes-drag-ghost {
  position: fixed;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  background: rgba(34, 63, 121, 0.90);
  color: #fff;
  font-size: 11.5px;
  font-weight: 500;
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  white-space: nowrap;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

/* Group context menu */
.group-ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 140px;
  background: rgba(252, 252, 254, 0.98);
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.08);
  padding: 4px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 12px;
  border: none;
  background: transparent;
  font-size: 13px;
  color: #1c1c1e;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.10s;
  font-family: inherit;
}

.ctx-item:hover {
  background: rgba(0, 0, 0, 0.06);
}

.ctx-item--danger {
  color: #ff3b30;
}

.ctx-item--danger:hover {
  background: rgba(255, 59, 48, 0.08);
}

.ctx-sep {
  height: 1px;
  background: rgba(0, 0, 0, 0.07);
  margin: 3px 4px;
}
</style>
