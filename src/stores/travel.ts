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
  type TravelNoteMeta,
  type TravelNote,
} from '../utils/travelStorage'

export type { TravelNoteMeta, TravelNote }

export const useTravelStore = defineStore('travel', () => {
  const notes = ref<TravelNoteMeta[]>([])
  const activeNoteId = ref<string | null>(null)
  const activeNote = ref<TravelNote | null>(null)
  const searchQuery = ref('')
  const selectedCategory = ref<string>('')
  const isLoading = ref(false)
  const viewMode = ref<'map' | 'editor'>('map')

  const categories = computed(() => {
    const set = new Set<string>()
    for (const n of notes.value) if (n.category) set.add(n.category)
    return Array.from(set).sort()
  })

  const filteredNotes = computed(() => {
    let list = notes.value
    if (selectedCategory.value) {
      list = list.filter(n => n.category === selectedCategory.value)
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter(
        n =>
          n.title.toLowerCase().includes(q) ||
          n.preview.toLowerCase().includes(q) ||
          n.category.toLowerCase().includes(q)
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

  // ─── Open note ─────────────────────────────────────────────────────────────

  async function openNote(id: string) {
    if (activeNoteId.value === id) return
    isLoading.value = true
    const note = await loadTravelNote(id)
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

  function setCategory(category: string) {
    if (activeNote.value) activeNote.value.category = category
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
      // Rebuild full content with current meta + new body
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
    selectedCategory,
    isLoading,
    viewMode,
    categories,
    filteredNotes,
    loadList,
    openNote,
    newNote,
    saveActive,
    deleteOne,
    setTitle,
    setLatLng,
    setCategory,
    setRating,
    setDate,
    setCover,
    setBody,
  }
})
