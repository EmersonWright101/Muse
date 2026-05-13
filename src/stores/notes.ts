/**
 * Notes Store
 *
 * Manages the list of markdown notes and the currently active note.
 * Persists to disk via notesStorage.ts.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { exists } from '@tauri-apps/plugin-fs'
import { notesDir } from '../utils/path'
import {
  listNotes,
  loadNote,
  saveNote,
  moveNoteToTrash,
  listTrashItems,
  restoreNoteFromTrash,
  permanentlyDeleteFromTrash,
  purgeExpiredTrash,
  getTrashRetentionDays,
  createEmptyNote,
  rebuildContent,
  extractFirstImage,
  scanUnusedAttachments,
  deleteAttachment,
  loadGroups,
  saveGroups,
  type NoteItem,
  type NoteMeta,
  type NoteGroup,
  type NoteTrashMeta,
} from '../utils/notesStorage'

export type { NoteItem, NoteMeta, NoteGroup }

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^-|-$/g, '')
}

async function ensureUniqueId(id: string, excludeId?: string): Promise<string> {
  const dir = await notesDir()
  let candidate = id
  let counter = 1
  while (await exists(`${dir}/${candidate}.md`)) {
    if (candidate === excludeId) break
    candidate = `${id}-${counter}`
    counter++
  }
  return candidate
}

export const useNotesStore = defineStore('notes', () => {
  const notes = ref<NoteMeta[]>([])
  const groups = ref<NoteGroup[]>([])
  const activeNoteId = ref<string | null>(null)
  const activeNote = ref<NoteItem | null>(null)
  const searchQuery = ref('')
  const selectedGroupId = ref<string>('')
  const selectedTag = ref<string>('')
  const viewMode = ref<'home' | 'editor'>('home')
  const trashItems = ref<NoteTrashMeta[]>([])
  const isLoading = ref(false)
  const orphanedAttachments = ref<string[]>([])
  let _openNoteReqId = 0

  const allTags = computed(() => {
    const set = new Set<string>()
    for (const n of notes.value) for (const tag of (n.tags ?? [])) if (tag) set.add(tag)
    return Array.from(set).sort()
  })

  const filteredNotes = computed(() => {
    let list = notes.value
    if (selectedGroupId.value) {
      list = list.filter(n => n.groupId === selectedGroupId.value)
    }
    if (selectedTag.value) {
      list = list.filter(n => (n.tags ?? []).includes(selectedTag.value))
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter(
        n =>
          n.title.toLowerCase().includes(q) ||
          n.preview.toLowerCase().includes(q) ||
          (n.tags ?? []).some(t => t.toLowerCase().includes(q))
      )
    }
    return list
  })

  const groupedNotes = computed(() => {
    const map: Record<string, NoteMeta[]> = {}
    for (const note of filteredNotes.value) {
      const gid = note.groupId || 'ungrouped'
      if (!map[gid]) map[gid] = []
      map[gid].push(note)
    }
    return map
  })

  // ─── Load list ─────────────────────────────────────────────────────────────

  async function loadList() {
    isLoading.value = true
    notes.value = await listNotes()
    groups.value = await loadGroups()
    isLoading.value = false
  }

  async function loadGroupsList() {
    groups.value = await loadGroups()
  }

  async function saveGroupsList() {
    await saveGroups(groups.value)
  }

  // ─── Trash ─────────────────────────────────────────────────────────────────

  async function loadTrash() {
    trashItems.value = await listTrashItems()
  }

  async function purgeExpiredTrashItems() {
    await purgeExpiredTrash(getTrashRetentionDays())
    trashItems.value = await listTrashItems()
  }

  async function restoreTrashItem(id: string) {
    await restoreNoteFromTrash(id)
    await loadList()
    await loadTrash()
  }

  async function permanentlyDeleteTrashItem(id: string) {
    await permanentlyDeleteFromTrash(id)
    await loadTrash()
  }

  async function clearAllTrash() {
    for (const item of trashItems.value) {
      await permanentlyDeleteFromTrash(item.id)
    }
    trashItems.value = []
  }

  // ─── Scan orphaned attachments ─────────────────────────────────────────────

  async function scanAttachments() {
    orphanedAttachments.value = await scanUnusedAttachments()
  }

  async function deleteOrphanedAttachment(filename: string) {
    await deleteAttachment(filename)
    orphanedAttachments.value = orphanedAttachments.value.filter(f => f !== filename)
  }

  // ─── Open note ─────────────────────────────────────────────────────────────

  async function openNote(id: string) {
    if (activeNoteId.value === id) return
    const reqId = ++_openNoteReqId
    isLoading.value = true
    const note = await loadNote(id)
    if (reqId !== _openNoteReqId) return
    if (note) {
      activeNote.value = note
      activeNoteId.value = id
    }
    isLoading.value = false
  }

  // ─── New note ─────────────────────────────────────────────────────────────-

  async function newNote(groupId?: string) {
    const note = createEmptyNote()
    if (groupId) note.groupId = groupId
    note.content = rebuildContent(note)
    await saveNote(note)
    await loadList()
    await openNote(note.id)
    viewMode.value = 'editor'
  }

  // ─── Save active note ──────────────────────────────────────────────────────

  async function saveActive() {
    if (!activeNote.value) return
    const oldId = activeNoteId.value
    const note = activeNote.value

    const slug = slugify(note.title)
    if (slug && slug !== note.id) {
      note.id = await ensureUniqueId(slug, note.id)
    }

    const body = note.content.replace(/^---[\s\S]*?---\s*\n?/, '').trimStart()
    const img = extractFirstImage(body)
    if (img) {
      note.cover = img
    }

    note.content = rebuildContent(note)
    await saveNote(note, { oldId: oldId ?? undefined })
    if (oldId && oldId !== note.id) {
      activeNoteId.value = note.id
    }
    await loadList()
  }

  // ─── Delete note (moves to trash) ─────────────────────────────────────────

  async function deleteOne(id: string) {
    await moveNoteToTrash(id)
    if (activeNoteId.value === id) {
      activeNoteId.value = null
      activeNote.value = null
    }
    await loadList()
    await loadTrash()
  }

  // ─── Update meta helpers ───────────────────────────────────────────────────

  function setTitle(title: string) {
    if (activeNote.value) activeNote.value.title = title
  }

  function setTags(tags: string[]) {
    if (activeNote.value) activeNote.value.tags = tags
  }

  function setDate(date: string) {
    if (activeNote.value) activeNote.value.date = date
  }

  function setGroupId(groupId: string | null) {
    if (activeNote.value) activeNote.value.groupId = groupId ?? ''
  }

  function setBody(body: string) {
    if (activeNote.value) {
      const note = activeNote.value
      note.content = rebuildContent({ ...note, content: body })
    }
  }

  function setCover(cover: string) {
    if (activeNote.value) activeNote.value.cover = cover
  }

  // ─── Group management ──────────────────────────────────────────────────────

  async function createGroup(name: string) {
    const group: NoteGroup = {
      id: crypto.randomUUID(),
      name,
      sortOrder: groups.value.length,
      createdAt: new Date().toISOString(),
    }
    groups.value.push(group)
    await saveGroups(groups.value)
  }

  async function renameGroup(id: string, name: string) {
    const g = groups.value.find(x => x.id === id)
    if (!g) return
    g.name = name
    g.updatedAt = new Date().toISOString()
    await saveGroups(groups.value)
  }

  async function deleteGroup(id: string) {
    for (const meta of notes.value.filter(n => n.groupId === id)) {
      const note = await loadNote(meta.id)
      if (note) {
        note.groupId = ''
        await saveNote(note, { sync: false })
      }
    }
    groups.value = groups.value.filter(g => g.id !== id)
    await saveGroups(groups.value)
    await loadList()
  }

  async function reorderGroups(newGroups: NoteGroup[]) {
    groups.value = newGroups.map((g, i) => ({ ...g, sortOrder: i }))
    await saveGroups(groups.value)
  }

  async function moveNoteToGroup(noteId: string, groupId: string) {
    const note = await loadNote(noteId)
    if (!note) return
    note.groupId = groupId
    await saveNote(note)
    await loadList()
  }

  // ─── Recent notes helper ───────────────────────────────────────────────────

  function recentNotes(days: number): NoteMeta[] {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    return notes.value.filter(n => new Date(n.date) >= cutoff)
  }

  // Init
  loadList()
  loadTrash()
  purgeExpiredTrashItems()

  return {
    notes,
    groups,
    activeNoteId,
    activeNote,
    searchQuery,
    selectedGroupId,
    selectedTag,
    viewMode,
    trashItems,
    isLoading,
    allTags,
    filteredNotes,
    groupedNotes,
    orphanedAttachments,
    loadList,
    loadGroupsList,
    saveGroupsList,
    loadTrash,
    purgeExpiredTrashItems,
    restoreTrashItem,
    permanentlyDeleteTrashItem,
    clearAllTrash,
    scanAttachments,
    deleteOrphanedAttachment,
    openNote,
    newNote,
    saveActive,
    deleteOne,
    setTitle,
    setTags,
    setDate,
    setGroupId,
    setBody,
    setCover,
    createGroup,
    renameGroup,
    deleteGroup,
    reorderGroups,
    moveNoteToGroup,
    recentNotes,
  }
})
