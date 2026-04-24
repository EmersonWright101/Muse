/**
 * Travel Notes Store
 *
 * Manages the list of travel markdown notes and the currently active note.
 * Persists to disk via travelStorage.ts.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  listTravelNotes,
  loadTravelNote,
  saveTravelNote,
  deleteTravelNote,
  createEmptyNote,
  rebuildContent,
  extractFirstImage,
  scanUnusedAttachments,
  deleteAttachment,
  type TravelNoteMeta,
  type TravelNote,
} from '../utils/travelStorage'

export type { TravelNoteMeta, TravelNote }

export const useTravelStore = defineStore('travel', () => {
  const notes = ref<TravelNoteMeta[]>([])
  const activeNoteId = ref<string | null>(null)
  const activeNote = ref<TravelNote | null>(null)
  const searchQuery = ref('')
  const selectedCategoryL1 = ref<string>('')
  const selectedCategoryL2 = ref<string>('')
  const isLoading = ref(false)
  const viewMode = ref<'map' | 'editor' | 'powerMap'>('map')
  const orphanedAttachments = ref<string[]>([])
  let _openNoteReqId = 0

  const categoriesL1 = computed(() => {
    const set = new Set<string>()
    for (const n of notes.value) if (n.categoryL1) set.add(n.categoryL1)
    return Array.from(set).sort()
  })

  const categoriesL2 = computed(() => {
    const set = new Set<string>()
    for (const n of notes.value) {
      // If L1 filter active, only show L2 values for matching notes
      if (selectedCategoryL1.value && n.categoryL1 !== selectedCategoryL1.value) continue
      if (n.categoryL2) set.add(n.categoryL2)
    }
    return Array.from(set).sort()
  })

  const filteredNotes = computed(() => {
    let list = notes.value
    if (selectedCategoryL1.value) {
      list = list.filter(n => n.categoryL1 === selectedCategoryL1.value)
    }
    if (selectedCategoryL2.value) {
      list = list.filter(n => n.categoryL2 === selectedCategoryL2.value)
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter(
        n =>
          n.title.toLowerCase().includes(q) ||
          n.preview.toLowerCase().includes(q) ||
          n.categoryL1.toLowerCase().includes(q) ||
          n.categoryL2.toLowerCase().includes(q)
      )
    }
    return list
  })

  // ─── Load list ─────────────────────────────────────────────────────────────

  async function loadList() {
    isLoading.value = true
    notes.value = await listTravelNotes()
    isLoading.value = false
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
    const note = await loadTravelNote(id)
    if (reqId !== _openNoteReqId) return  // superseded by a newer openNote call
    if (note) {
      activeNote.value = note
      activeNoteId.value = id
    }
    isLoading.value = false
  }

  // ─── New note ─────────────────────────────────────────────────────────────-

  async function newNote() {
    const note = createEmptyNote()
    note.content = rebuildContent(note)
    await saveTravelNote(note)
    await loadList()
    await openNote(note.id)
    viewMode.value = 'editor'
  }

  // ─── Save active note ──────────────────────────────────────────────────────

  async function saveActive() {
    if (!activeNote.value) return
    const oldId = activeNoteId.value
    const body = activeNote.value.content.replace(/^---[\s\S]*?---\s*\n?/, '').trimStart()
    const img = extractFirstImage(body)
    if (img) {
      activeNote.value.cover = img
    }
    activeNote.value.content = rebuildContent(activeNote.value)
    await saveTravelNote(activeNote.value)
    if (oldId && oldId !== activeNote.value.id) {
      await deleteTravelNote(oldId)
      activeNoteId.value = activeNote.value.id
    }
    await loadList()
  }

  // ─── Delete note ───────────────────────────────────────────────────────────

  async function deleteOne(id: string) {
    await deleteTravelNote(id)
    if (activeNoteId.value === id) {
      activeNoteId.value = null
      activeNote.value = null
    }
    await loadList()
  }

  // ─── Update meta helpers ───────────────────────────────────────────────────

  function setTitle(title: string) {
    if (activeNote.value) activeNote.value.title = title
  }

  function setLatLng(lat: number, lng: number) {
    if (activeNote.value) {
      activeNote.value.lat = lat
      activeNote.value.lng = lng
    }
  }

  function setCategoryL1(cat: string) {
    if (activeNote.value) activeNote.value.categoryL1 = cat
  }

  function setCategoryL2(cat: string) {
    if (activeNote.value) activeNote.value.categoryL2 = cat
  }

  function setRating(rating: number) {
    if (activeNote.value) activeNote.value.rating = rating
  }

  function setDate(date: string) {
    if (activeNote.value) activeNote.value.date = date
  }

  function setCover(cover: string) {
    if (activeNote.value) activeNote.value.cover = cover
  }

  function setBody(body: string) {
    if (activeNote.value) {
      const note = activeNote.value
      note.content = rebuildContent({ ...note, content: body })
    }
  }

  // Init
  loadList()

  return {
    notes,
    activeNoteId,
    activeNote,
    searchQuery,
    selectedCategoryL1,
    selectedCategoryL2,
    isLoading,
    viewMode,
    categoriesL1,
    categoriesL2,
    filteredNotes,
    orphanedAttachments,
    loadList,
    scanAttachments,
    deleteOrphanedAttachment,
    openNote,
    newNote,
    saveActive,
    deleteOne,
    setTitle,
    setLatLng,
    setCategoryL1,
    setCategoryL2,
    setRating,
    setDate,
    setCover,
    setBody,
  }
})
