<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Markdown as TiptapMarkdown } from 'tiptap-markdown'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import markdown from 'highlight.js/lib/languages/markdown'
import yaml from 'highlight.js/lib/languages/yaml'
import plaintext from 'highlight.js/lib/languages/plaintext'
import L from 'leaflet'
import { Star, Crosshair, Check, X, Pencil, Sparkles } from 'lucide-vue-next'
import { useTravelStore } from '../../../stores/travel'
import { useTravelCopilotStore } from '../../../stores/travelCopilot'
import { useAiSettingsStore } from '../../../stores/aiSettings'
import { streamCopilotCompletion } from '../../../composables/useCopilotStream'
import { writeFile, mkdir, exists } from '@tauri-apps/plugin-fs'
import { travelNotesDir } from '../../../utils/path'
import { initImageAssetBase, resolveImageUrl } from '../../../utils/imageAsset'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('plaintext', plaintext)

const { t } = useI18n()
const store   = useTravelStore()
const copilot = useTravelCopilotStore()
const aiStore = useAiSettingsStore()

// ─── AI Copilot state ─────────────────────────────────────────────────────────

const textareaRef         = ref<HTMLTextAreaElement | null>(null)
const ghostRef            = ref<HTMLDivElement | null>(null)
const suggestion          = ref('')
const suggestionCursor    = ref(0)
const showCopilotSettings = ref(false)
let _copilotAbort: AbortController | null = null
let _copilotTimer: ReturnType<typeof setTimeout> | null = null
let _acceptingChunk = false

const configuredProviders = computed(() =>
  aiStore.providers.filter(p => p.enabled && (p.apiKey || p.type === 'ollama'))
)
// Exclude reasoning models from copilot — they are slow/expensive for autocomplete
const copilotProviderModels = computed(() =>
  (aiStore.providers.find(p => p.id === copilot.providerId)?.models ?? []).filter(m => !m.reasoning)
)

const ghostContent = computed(() => {
  if (!suggestion.value) return ''
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return (
    `<span style="color:transparent">${esc(body.value)}</span>` +
    `<span class="copilot-ghost-text">${esc(suggestion.value)}</span>`
  )
})

function syncGhostScroll() {
  if (ghostRef.value && textareaRef.value) {
    ghostRef.value.scrollTop  = textareaRef.value.scrollTop
    ghostRef.value.scrollLeft = textareaRef.value.scrollLeft
  }
}

function dismissSuggestion() {
  if (_copilotAbort) { _copilotAbort.abort(); _copilotAbort = null }
  suggestion.value = ''
}

function acceptSuggestion() {
  if (!suggestion.value) return
  if (_copilotAbort) { _copilotAbort.abort(); _copilotAbort = null }
  const sugg   = suggestion.value
  const cursor = suggestionCursor.value
  suggestion.value = ''
  body.value = body.value.slice(0, cursor) + sugg + body.value.slice(cursor)
  nextTick(() => {
    if (textareaRef.value) {
      const pos = cursor + sugg.length
      textareaRef.value.setSelectionRange(pos, pos)
      textareaRef.value.focus()
    }
  })
}

async function requestCompletion() {
  if (!copilot.enabled) return
  const ta = textareaRef.value
  if (!ta) return
  const cursor = ta.selectionStart ?? body.value.length
  if (cursor !== body.value.length) return          // only suggest at end of text
  if (body.value.trim().length < 8) return          // need some context

  const provider = aiStore.providers.find(p => p.id === copilot.providerId && p.enabled)
  if (!provider) return
  if (!provider.apiKey && provider.type !== 'ollama') return

  const modelId = copilot.modelId || provider.selectedModelId
  if (!modelId) return

  if (_copilotAbort) _copilotAbort.abort()
  const ac = new AbortController()
  _copilotAbort   = ac
  suggestionCursor.value = cursor
  suggestion.value = ''

  const words       = copilot.completionWords
  const contextText = body.value.slice(Math.max(0, cursor - copilot.contextChars), cursor)
  const system = `You are a travel writing assistant. Continue writing naturally in the same language and style. Output ONLY the continuation (max ${words} words), nothing else.`

  try {
    await streamCopilotCompletion(provider, modelId, contextText, system, words * 6, ac.signal,
      token => { suggestion.value += token },
    )
  } catch {
    if (!ac.signal.aborted) suggestion.value = ''
  }
  if (!ac.signal.aborted) _copilotAbort = null
}

function onCopilotBodyChange() {
  if (!copilot.enabled) return
  if (_acceptingChunk) return   // chunk-accept mutates body without dismissing
  if (suggestion.value) dismissSuggestion()
  if (_copilotTimer) clearTimeout(_copilotTimer)
  _copilotTimer = setTimeout(() => { _copilotTimer = null; requestCompletion() }, copilot.triggerDelay)
}

function acceptNextChunk() {
  if (!suggestion.value) return
  // Match up to and including the next punctuation mark (Chinese + English), plus trailing whitespace.
  // Falls back to the whole suggestion when no punctuation is found.
  const match = suggestion.value.match(/^([\s\S]*?[，。！？；：、…—""''【】,!?;:.]+\s*)/)
  const chunk = match ? match[1] : suggestion.value
  const cursor = suggestionCursor.value
  const remaining = suggestion.value.slice(chunk.length)

  _acceptingChunk = true
  suggestion.value = remaining
  suggestionCursor.value = cursor + chunk.length
  body.value = body.value.slice(0, cursor) + chunk + body.value.slice(cursor)
  nextTick(() => {
    _acceptingChunk = false
    if (textareaRef.value) {
      const pos = cursor + chunk.length
      textareaRef.value.setSelectionRange(pos, pos)
    }
    if (!remaining && _copilotAbort) { _copilotAbort.abort(); _copilotAbort = null }
  })
}

function onTextareaKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab' && suggestion.value) {
    e.preventDefault()
    e.stopPropagation()
    acceptSuggestion()
    return
  }
  // Cmd/Ctrl+→ accepts one word at a time
  if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowRight' && suggestion.value) {
    e.preventDefault()
    e.stopPropagation()
    acceptNextChunk()
    return
  }
  if (e.key === 'Escape' && suggestion.value) {
    dismissSuggestion()
    return
  }
  if (suggestion.value && (e.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(e.key))) {
    dismissSuggestion()
  }
}

function onCopilotSettingsClickOutside(e: MouseEvent) {
  if (!showCopilotSettings.value) return
  const el = (e.target as HTMLElement).closest('.copilot-wrap')
  if (!el) showCopilotSettings.value = false
}
onMounted(()   => document.addEventListener('click', onCopilotSettingsClickOutside))
onUnmounted(() => document.removeEventListener('click', onCopilotSettingsClickOutside))

// Editor layout: 'split' | 'edit' | 'preview' | 'wysiwyg'
const layout = ref<'split' | 'edit' | 'preview' | 'wysiwyg'>('split')

// ─── WYSIWYG editor (Tiptap) ──────────────────────────────────────────────────
let _wysiwygSyncing = false   // guard against feedback loop

const wysiwygEditor = useEditor({
  extensions: [
    StarterKit,
    TiptapMarkdown.configure({ html: false, tightLists: true }),
  ],
  content: '',
  onUpdate({ editor }) {
    if (_wysiwygSyncing) return
    _wysiwygSyncing = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body.value = (editor.storage as any).markdown.getMarkdown()
    _wysiwygSyncing = false
  },
})

// Sync body → wysiwyg editor when switching to wysiwyg mode or when the note changes
watch(layout, (val) => {
  if (val === 'wysiwyg' && wysiwygEditor.value) {
    _wysiwygSyncing = true
    wysiwygEditor.value.commands.setContent(body.value)
    _wysiwygSyncing = false
  }
})

onUnmounted(() => { wysiwygEditor.value?.destroy() })

const note = computed(() => store.activeNote!)

// Reload wysiwyg content when the active note changes
watch(() => note.value?.id, () => {
  if (layout.value === 'wysiwyg' && wysiwygEditor.value) {
    _wysiwygSyncing = true
    wysiwygEditor.value.commands.setContent(body.value)
    _wysiwygSyncing = false
  }
})

// Body without frontmatter for editing
const body = computed({
  get() {
    const raw = note.value.content
    const m = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)$/)
    return m ? m[1] : raw
  },
  set(val: string) {
    store.setBody(val)
  },
})

// Markdown setup with code highlighting
const md = new MarkdownIt({ breaks: true, linkify: true })

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const lang = token.info.trim() || 'plaintext'
  const validLang = hljs.getLanguage(lang) ? lang : 'plaintext'
  const highlighted = hljs.highlight(token.content, { language: validLang }).value
  return `<div class="md-code-wrap"><div class="md-code-header"><span class="md-code-lang">${validLang}</span><button class="md-code-copy">复制</button></div><pre><code class="hljs">${highlighted}</code></pre></div>`
}

md.renderer.rules.code_inline = (tokens, idx) => {
  return `<code class="md-code-inline">${tokens[idx].content}</code>`
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').trim()
}

// Title editing
const editingTitle = ref(false)
const titleDraft = ref('')
const titleInputRef = ref<HTMLInputElement>()

function startEditTitle() {
  titleDraft.value = note.value.title
  editingTitle.value = true
  nextTick(() => titleInputRef.value?.focus())
}

function confirmTitle() {
  const t = titleDraft.value.trim()
  if (t) {
    store.setTitle(t)
    const sanitized = sanitizeFilename(t)
    if (sanitized) note.value.id = sanitized
  }
  editingTitle.value = false
}

function cancelTitle() {
  editingTitle.value = false
}

// Copy code block
function onPreviewClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('.md-code-copy') as HTMLElement | null
  if (!btn) return
  const code = btn.closest('.md-code-wrap')?.querySelector('code')?.textContent ?? ''
  navigator.clipboard.writeText(code)
  btn.textContent = '已复制'
  setTimeout(() => { btn.textContent = '复制' }, 1500)
}

function renderMarkdown(content: string): string {
  try {
    const fixed = content.replace(/!\[([^\]]*)\]\n\(([^)]+)\)/g, '![$1]($2)')
    const raw = md.render(fixed)
    const sanitized = DOMPurify.sanitize(raw)
    // Post-process img srcs after DOMPurify to bypass URI scheme filtering
    const tmp = document.createElement('div')
    tmp.innerHTML = sanitized
    tmp.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src')
      if (src) img.src = resolveImageUrl(src)
    })
    return tmp.innerHTML
  } catch {
    return content
  }
}

const previewHtml = computed(() => renderMarkdown(body.value))

// Category L1/L2 editing (pencil-button controlled, same pattern as title)
const editingCategory = ref(false)
const categoryL1Draft = ref('')
const categoryL2Draft = ref('')
const showL1Suggestions = ref(false)
const showL2Suggestions = ref(false)

const l1Suggestions = computed(() => {
  const q = categoryL1Draft.value.toLowerCase()
  return store.categoriesL1.filter(c => c.toLowerCase().includes(q) && c !== categoryL1Draft.value)
})
const l2Suggestions = computed(() => {
  const q = categoryL2Draft.value.toLowerCase()
  return store.categoriesL2.filter(c => c.toLowerCase().includes(q) && c !== categoryL2Draft.value)
})

watch(() => note.value.categoryL1, (v) => { categoryL1Draft.value = v }, { immediate: true })
watch(() => note.value.categoryL2, (v) => { categoryL2Draft.value = v }, { immediate: true })

function startEditCategory() {
  categoryL1Draft.value = note.value.categoryL1
  categoryL2Draft.value = note.value.categoryL2
  editingCategory.value = true
}

function confirmCategory() {
  store.setCategoryL1(categoryL1Draft.value)
  store.setCategoryL2(categoryL2Draft.value)
  editingCategory.value = false
  showL1Suggestions.value = false
  showL2Suggestions.value = false
}

function cancelCategory() {
  editingCategory.value = false
  showL1Suggestions.value = false
  showL2Suggestions.value = false
}

function applyL1(cat: string) {
  categoryL1Draft.value = cat
  showL1Suggestions.value = false
}

function applyL2(cat: string) {
  categoryL2Draft.value = cat
  showL2Suggestions.value = false
}

function onL1Blur() {
  setTimeout(() => { showL1Suggestions.value = false }, 150)
}

function onL2Blur() {
  setTimeout(() => { showL2Suggestions.value = false }, 150)
}

// Rating
function setRating(r: number) {
  if (note.value.rating === r) {
    store.setRating(0)
  } else {
    store.setRating(r)
  }
}

// Auto-save
const autoSaveTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const autoSaveStatus = ref<'idle' | 'saving' | 'saved'>('idle')

function triggerAutoSave() {
  if (autoSaveTimer.value) clearTimeout(autoSaveTimer.value)
  autoSaveStatus.value = 'idle'
  autoSaveTimer.value = setTimeout(async () => {
    autoSaveStatus.value = 'saving'
    await store.saveActive()
    autoSaveStatus.value = 'saved'
    setTimeout(() => { if (autoSaveStatus.value === 'saved') autoSaveStatus.value = 'idle' }, 2000)
  }, 1500)
}

watch(() => body.value, triggerAutoSave)
watch(() => body.value, onCopilotBodyChange)
watch(() => note.value.title, triggerAutoSave)
watch(() => note.value.lat, triggerAutoSave)
watch(() => note.value.lng, triggerAutoSave)
watch(() => note.value.categoryL1, triggerAutoSave)
watch(() => note.value.categoryL2, triggerAutoSave)
watch(() => note.value.rating, triggerAutoSave)
watch(() => note.value.date, triggerAutoSave)
watch(() => note.value.cover, triggerAutoSave)

// Save shortcut
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    store.saveActive()
  }
}

// Paste image handler
async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return

  for (const item of items) {
    if (!item.type.startsWith('image/')) continue

    const file = item.getAsFile()
    if (!file) continue

    e.preventDefault()

    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    const ext = item.type === 'image/jpeg' ? 'jpg' : item.type.replace('image/', '')
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

    const baseDir = await travelNotesDir()
    const imgDir = `${baseDir}/images`
    if (!(await exists(imgDir))) {
      await mkdir(imgDir, { recursive: true })
    }

    const filePath = `${imgDir}/${filename}`
    await writeFile(filePath, bytes)

    // Insert markdown at cursor position
    const textarea = e.target as HTMLTextAreaElement
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const md = `![${filename}](images/${filename})`

    const before = body.value.slice(0, start)
    const after = body.value.slice(end)
    const newBody = before + md + after
    body.value = newBody

    nextTick(() => {
      const pos = start + md.length
      textarea.selectionStart = pos
      textarea.selectionEnd = pos
      textarea.focus()
    })

    break // Handle first image only
  }
}

// Image asset base
initImageAssetBase()

// Map picker
const showMapPicker = ref(false)
const pickerMapContainer = ref<HTMLElement>()
let pickerMap: L.Map | null = null
let pickerMarker: L.Marker | null = null

function openMapPicker() {
  showMapPicker.value = true
  nextTick(() => {
    initPickerMap()
  })
}

function initPickerMap() {
  if (!pickerMapContainer.value) return
  const lat = note.value.lat || 35.8617
  const lng = note.value.lng || 104.1954
  pickerMap = L.map(pickerMapContainer.value, {
    zoomControl: false,
    attributionControl: false,
  }).setView([lat, lng], lat === 0 && lng === 0 ? 3 : 12)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(pickerMap)

  L.control.zoom({ position: 'bottomright' }).addTo(pickerMap)

  pickerMarker = L.marker([lat, lng], { draggable: true }).addTo(pickerMap)

  pickerMap.on('click', (e: L.LeafletMouseEvent) => {
    pickerMarker?.setLatLng(e.latlng)
  })
}

function confirmPicker() {
  if (pickerMarker) {
    const latlng = pickerMarker.getLatLng()
    store.setLatLng(latlng.lat, latlng.lng)
  }
  closePicker()
}

function closePicker() {
  showMapPicker.value = false
  if (pickerMap) {
    pickerMap.remove()
    pickerMap = null
  }
  pickerMarker = null
}
</script>

<template>
  <div class="travel-editor" @keydown="onKeydown">
    <!-- Meta bar -->
    <div class="meta-bar">
      <div class="meta-row title-row">
        <!-- Category area (left of title) -->
        <div class="category-area">
          <template v-if="editingCategory">
            <div class="cat-input-wrap">
              <input
                v-model="categoryL1Draft"
                class="meta-input category-input"
                :placeholder="t('travel.categoryPlaceholder')"
                @focus="showL1Suggestions = true"
                @blur="onL1Blur"
              />
              <div v-if="showL1Suggestions && l1Suggestions.length" class="suggestions">
                <button
                  v-for="cat in l1Suggestions"
                  :key="cat"
                  class="suggestion-item"
                  @mousedown.prevent="applyL1(cat)"
                >{{ cat }}</button>
              </div>
            </div>
            <span class="cat-sep-edit">·</span>
            <div class="cat-input-wrap">
              <input
                v-model="categoryL2Draft"
                class="meta-input category-input"
                :placeholder="t('travel.categoryPlaceholder')"
                @focus="showL2Suggestions = true"
                @blur="onL2Blur"
              />
              <div v-if="showL2Suggestions && l2Suggestions.length" class="suggestions">
                <button
                  v-for="cat in l2Suggestions"
                  :key="cat"
                  class="suggestion-item"
                  @mousedown.prevent="applyL2(cat)"
                >{{ cat }}</button>
              </div>
            </div>
            <button class="title-action-btn" @mousedown.prevent="confirmCategory"><Check :size="13" /></button>
            <button class="title-action-btn" @mousedown.prevent="cancelCategory"><X :size="13" /></button>
          </template>
          <template v-else>
            <span class="cat-text">{{ note.categoryL1 || '—' }}</span>
            <span class="cat-sep">·</span>
            <span class="cat-text">{{ note.categoryL2 || '—' }}</span>
            <button class="title-action-btn cat-edit-btn" @click="startEditCategory"><Pencil :size="11" /></button>
          </template>
        </div>

        <!-- Title display / edit -->
        <div class="title-area">
          <template v-if="editingTitle">
            <input
              ref="titleInputRef"
              v-model="titleDraft"
              class="meta-input title-edit-input"
              @keydown.enter="confirmTitle"
              @keydown.escape="cancelTitle"
              @blur="confirmTitle"
            />
            <button class="title-action-btn" @mousedown.prevent="confirmTitle"><Check :size="13" /></button>
            <button class="title-action-btn" @mousedown.prevent="cancelTitle"><X :size="13" /></button>
          </template>
          <template v-else>
            <span class="title-display">{{ note.title || t('travel.titlePlaceholder') }}</span>
            <button class="title-action-btn" @click="startEditTitle"><Pencil :size="13" /></button>
          </template>
        </div>
      </div>

      <div class="meta-row">
        <!-- Lat -->
        <div class="meta-field">
          <span class="meta-label">{{ t('travel.lat') }}</span>
          <input
            :value="note.lat"
            type="number"
            step="any"
            class="meta-input coord-input"
            :placeholder="t('travel.lat')"
            @input="store.setLatLng(Number(($event.target as HTMLInputElement).value), note.lng)"
          />
        </div>

        <!-- Lng -->
        <div class="meta-field">
          <span class="meta-label">{{ t('travel.lng') }}</span>
          <input
            :value="note.lng"
            type="number"
            step="any"
            class="meta-input coord-input"
            :placeholder="t('travel.lng')"
            @input="store.setLatLng(note.lat, Number(($event.target as HTMLInputElement).value))"
          />
        </div>

        <!-- Map picker -->
        <button class="picker-btn" :title="t('travel.mapPick')" @click="openMapPicker">
          <Crosshair :size="14" />
        </button>

        <!-- Date -->
        <div class="meta-field">
          <span class="meta-label">{{ t('travel.date') }}</span>
          <input
            v-model="note.date"
            type="date"
            class="meta-input date-input"
            @input="store.setDate(note.date)"
          />
        </div>

        <!-- Rating -->
        <div class="meta-field rating-field">
          <span class="meta-label">{{ t('travel.rating') }}</span>
          <div class="star-row">
            <button
              v-for="i in 5"
              :key="i"
              class="star-btn"
              :class="{ filled: i <= note.rating }"
              @click="setRating(i)"
            >
              <Star :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="editor-toolbar">
      <div class="layout-switch">
        <button
          class="layout-btn"
          :class="{ active: layout === 'edit' }"
          @click="layout = 'edit'"
        >{{ t('travel.editMode') }}</button>
        <button
          class="layout-btn"
          :class="{ active: layout === 'split' }"
          @click="layout = 'split'"
        >{{ t('travel.splitMode') }}</button>
        <button
          class="layout-btn"
          :class="{ active: layout === 'preview' }"
          @click="layout = 'preview'"
        >{{ t('travel.previewMode') }}</button>
        <button
          class="layout-btn"
          :class="{ active: layout === 'wysiwyg' }"
          @click="layout = 'wysiwyg'"
        >{{ t('travel.wysiwygMode') }}</button>
      </div>
      <div class="toolbar-right">
        <span v-if="suggestion" class="copilot-hint">
          <kbd>Tab</kbd> {{ t('travel.copilot.accept') }} &middot;
          <kbd>⌘→</kbd> {{ t('travel.copilot.acceptWord') }} &middot;
          <kbd>Esc</kbd> {{ t('travel.copilot.dismiss') }}
        </span>
        <span v-else-if="autoSaveStatus === 'saving'" class="save-status">{{ t('travel.saving') }}</span>
        <span v-else-if="autoSaveStatus === 'saved'" class="save-status success">{{ t('travel.saved') }}</span>

        <!-- Copilot toggle + settings -->
        <div class="copilot-wrap" @click.stop>
          <button
            class="copilot-btn"
            :class="{ active: copilot.enabled }"
            :title="t('travel.copilot.label')"
            @click.stop="showCopilotSettings = !showCopilotSettings"
          >
            <Sparkles :size="13" />
          </button>
          <div v-if="showCopilotSettings" class="copilot-panel">
            <label class="copilot-toggle-row">
              <span class="copilot-panel-title">{{ t('travel.copilot.label') }}</span>
              <input
                type="checkbox"
                class="copilot-checkbox"
                :checked="copilot.enabled"
                @change="copilot.setEnabled(($event.target as HTMLInputElement).checked)"
              />
            </label>
            <template v-if="copilot.enabled">
              <div class="copilot-row">
                <span class="copilot-label">{{ t('travel.copilot.provider') }}</span>
                <select
                  class="copilot-select"
                  :value="copilot.providerId"
                  @change="copilot.setProvider(($event.target as HTMLSelectElement).value)"
                >
                  <option value="" disabled>{{ t('travel.copilot.selectProvider') }}</option>
                  <option v-for="p in configuredProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </div>
              <div class="copilot-row">
                <span class="copilot-label">{{ t('travel.copilot.model') }}</span>
                <select
                  class="copilot-select"
                  :value="copilot.modelId"
                  @change="copilot.setModel(($event.target as HTMLSelectElement).value)"
                >
                  <option value="" disabled>{{ t('travel.copilot.selectModel') }}</option>
                  <option v-for="m in copilotProviderModels" :key="m.id" :value="m.id">{{ m.name }}</option>
                </select>
              </div>
              <div class="copilot-row">
                <span class="copilot-label">{{ t('travel.copilot.words') }}</span>
                <input
                  type="number"
                  class="copilot-number"
                  :value="copilot.completionWords"
                  min="1"
                  max="100"
                  @change="copilot.setWords(Number(($event.target as HTMLInputElement).value))"
                />
              </div>
              <div class="copilot-row">
                <span class="copilot-label">{{ t('travel.copilot.delay') }}</span>
                <div class="copilot-delay-wrap">
                  <input
                    type="number"
                    class="copilot-number"
                    :value="copilot.triggerDelay"
                    min="200"
                    max="5000"
                    step="100"
                    @change="copilot.setDelay(Number(($event.target as HTMLInputElement).value))"
                  />
                  <span class="copilot-unit">ms</span>
                </div>
              </div>
              <div class="copilot-row">
                <span class="copilot-label">{{ t('travel.copilot.context') }}</span>
                <div class="copilot-delay-wrap">
                  <input
                    type="number"
                    class="copilot-number copilot-number--wide"
                    :value="copilot.contextChars"
                    min="200"
                    max="10000"
                    step="200"
                    @change="copilot.setContext(Number(($event.target as HTMLInputElement).value))"
                  />
                  <span class="copilot-unit">{{ t('travel.copilot.chars') }}</span>
                </div>
              </div>
            </template>
          </div>
        </div>

        <button class="save-btn" @click="store.saveActive()">
          {{ t('common.save') }}
        </button>
      </div>
    </div>

    <!-- Map picker modal -->
    <Teleport to="body">
      <div v-if="showMapPicker" class="picker-overlay" @click="closePicker">
        <div class="picker-dialog" @click.stop>
          <div class="picker-header">
            <h3 class="picker-title">{{ t('travel.mapPick') }}</h3>
            <button class="picker-close" @click="closePicker">
              <X :size="16" />
            </button>
          </div>
          <div ref="pickerMapContainer" class="picker-map" />
          <div class="picker-footer">
            <button class="picker-confirm" @click="confirmPicker">
              <Check :size="14" />
              {{ t('common.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Content area -->
    <div class="editor-content" :class="`layout-${layout}`">
      <!-- WYSIWYG pane (Typora-style) -->
      <div v-if="layout === 'wysiwyg'" class="wysiwyg-pane">
        <EditorContent :editor="wysiwygEditor" class="wysiwyg-editor" />
      </div>

      <!-- Edit pane -->
      <div v-show="layout !== 'preview' && layout !== 'wysiwyg'" class="edit-pane">
        <div
          v-if="suggestion"
          ref="ghostRef"
          class="ghost-overlay"
          aria-hidden="true"
          v-html="ghostContent"
        />
        <textarea
          ref="textareaRef"
          v-model="body"
          class="md-textarea"
          :class="{ 'md-textarea--ghost': !!suggestion }"
          :placeholder="t('travel.editorPlaceholder')"
          spellcheck="false"
          @paste="onPaste"
          @keydown="onTextareaKeydown"
          @scroll="syncGhostScroll"
        />
      </div>

      <!-- Preview pane -->
      <div v-show="layout !== 'edit' && layout !== 'wysiwyg'" class="preview-pane">
        <div class="markdown-body" v-html="previewHtml" @click="onPreviewClick" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.travel-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
}

/* Meta bar */
.meta-bar {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
  background: rgba(250, 250, 250, 0.8);
}

.meta-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.meta-field {
  display: flex;
  align-items: center;
  gap: 5px;
  position: relative;
}

.meta-label {
  font-size: 11px;
  color: #8e8e93;
  flex-shrink: 0;
  font-weight: 500;
  white-space: nowrap;
}

.meta-input {
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: white;
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  color: #1c1c1e;
  outline: none;
  transition: border-color 0.12s;
}

.meta-input:focus {
  border-color: rgba(34, 63, 121, 0.35);
}

.title-row {
  gap: 6px;
  flex-wrap: nowrap;
}

.category-area {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.cat-text {
  font-size: 12px;
  font-weight: 500;
  color: #8e8e93;
  white-space: nowrap;
}

.cat-sep {
  font-size: 12px;
  color: #c7c7cc;
}

.cat-sep-edit {
  font-size: 12px;
  color: #c7c7cc;
  flex-shrink: 0;
}

.cat-edit-btn {
  opacity: 0;
  transition: opacity 0.12s;
}

.category-area:hover .cat-edit-btn {
  opacity: 1;
}

.title-area {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.title-display {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.title-edit-input {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 14px;
}

.title-action-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: #8e8e93;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}

.title-action-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #3c3c43;
}

.coord-input { width: 130px; }
.date-input { width: 130px; }
.category-input { width: 90px; }

.category-field { position: relative; flex-wrap: wrap; }

.cat-input-wrap { position: relative; }

.category-display {
  font-size: 12px;
  color: #1c1c1e;
  padding: 0 4px;
}

.suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 140px;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.10);
  padding: 4px;
  z-index: 50;
  max-height: 160px;
  overflow-y: auto;
}

.suggestion-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 5px 8px;
  border-radius: 5px;
  border: none;
  background: none;
  font-size: 12px;
  color: #1c1c1e;
  cursor: pointer;
}

.suggestion-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.rating-field {
  display: flex;
  align-items: center;
  gap: 4px;
}

.star-row {
  display: flex;
  gap: 1px;
}

.star-btn {
  border: none;
  background: none;
  padding: 2px;
  cursor: pointer;
  color: #d1d1d6;
  transition: color 0.12s;
}

.star-btn:hover,
.star-btn.filled {
  color: #ff9500;
}

.star-btn.filled :deep(svg) {
  fill: #ff9500;
}

/* Toolbar */
.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
  background: white;
}

.layout-switch {
  display: flex;
  gap: 2px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 6px;
  padding: 2px;
}

.layout-btn {
  border: none;
  background: transparent;
  color: #8e8e93;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s;
}

.layout-btn.active {
  background: white;
  color: #1c1c1e;
  box-shadow: 0 1px 2px rgba(0,0,0,0.08);
}

.save-btn {
  border: none;
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 14px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}

.save-btn:hover {
  background: rgba(34, 63, 121, 0.18);
}

:deep(.save-status) {
  font-size: 11px;
  color: #8e8e93;
  margin-right: 8px;
}

:deep(.save-status.success) {
  color: #34c759;
}

.toolbar-right {
  display: flex;
  align-items: center;
}

.picker-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: rgba(34, 63, 121, 0.08);
  color: #223F79;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s;
  flex-shrink: 0;
}

.picker-btn:hover {
  background: rgba(34, 63, 121, 0.15);
}

/* Map picker modal */
.picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  backdrop-filter: blur(2px);
}

.picker-dialog {
  background: white;
  border-radius: 14px;
  width: 520px;
  height: 420px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
}

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.picker-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0;
}

.picker-close {
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
  transition: background 0.12s;
}

.picker-close:hover {
  background: rgba(0, 0, 0, 0.06);
}

.picker-map {
  flex: 1;
  min-height: 0;
  background: #e5e7eb;
}

.picker-footer {
  padding: 10px 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  justify-content: flex-end;
}

.picker-confirm {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s;
}

.picker-confirm:hover {
  background: rgba(34, 63, 121, 0.18);
}

/* Editor content */
.editor-content {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.edit-pane,
.preview-pane {
  flex: 1;
  min-width: 0;
  overflow: auto;
}

.edit-pane {
  border-right: 1px solid rgba(0, 0, 0, 0.06);
  position: relative;
  background: #fafafa;
}

.layout-edit .edit-pane { border-right: none; }
.layout-preview .preview-pane { border-right: none; }

.md-textarea {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 14px;
  font-size: 13px;
  line-height: 1.7;
  color: #1c1c1e;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
  background: #fafafa;
  box-sizing: border-box;
  position: relative;
  z-index: 1;
}
.md-textarea--ghost {
  background: transparent;
  caret-color: #1c1c1e;
}

/* Ghost text overlay — sits behind the textarea and mirrors its layout */
.ghost-overlay {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: auto;
  scrollbar-width: none;
  padding: 14px;
  font-size: 13px;
  line-height: 1.7;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  box-sizing: border-box;
  color: transparent;
}
.ghost-overlay::-webkit-scrollbar { display: none; }

/* Copilot toolbar elements */
.copilot-hint {
  font-size: 11px;
  color: #8e8e93;
  display: flex;
  align-items: center;
  gap: 3px;
}
.copilot-hint kbd {
  font-family: inherit;
  font-size: 10px;
  background: rgba(0,0,0,0.06);
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 3px;
  padding: 0 4px;
  line-height: 16px;
}
.copilot-wrap {
  position: relative;
}
.copilot-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: #8e8e93;
  transition: color 0.15s, background 0.15s;
}
.copilot-btn:hover { background: rgba(0,0,0,0.05); color: #3c3c43; }
.copilot-btn.active { color: #223F79; background: rgba(34,63,121,0.08); border-color: rgba(34,63,121,0.25); }

.copilot-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 200;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.1);
  padding: 12px;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.copilot-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}
.copilot-panel-title {
  font-size: 12px;
  font-weight: 600;
  color: #1c1c1e;
}
.copilot-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #223F79;
}
.copilot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.copilot-label {
  font-size: 11px;
  color: #6e6e73;
  white-space: nowrap;
}
.copilot-select {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 5px;
  padding: 3px 5px;
  background: #f5f5f7;
  color: #1c1c1e;
  outline: none;
}
.copilot-number {
  width: 52px;
  font-size: 11px;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 5px;
  padding: 3px 5px;
  background: #f5f5f7;
  color: #1c1c1e;
  outline: none;
  text-align: center;
}
.copilot-delay-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}
.copilot-unit {
  font-size: 11px;
  color: #8e8e93;
}
.copilot-number--wide { width: 68px; }

.preview-pane {
  background: white;
  padding: 14px;
}

/* ─── WYSIWYG (Tiptap) ─────────────────────────────────────── */
.wysiwyg-pane {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: #ffffff;
  padding: 14px 20px;
}

.wysiwyg-editor {
  height: 100%;
}

.wysiwyg-editor :deep(.ProseMirror) {
  outline: none;
  min-height: 100%;
  font-size: 14px;
  line-height: 1.75;
  color: #1c1c1e;
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  max-width: 720px;
  margin: 0 auto;
  padding-bottom: 80px;
}

.wysiwyg-editor :deep(.ProseMirror h1) { font-size: 26px; font-weight: 700; margin: 20px 0 10px; line-height: 1.3; }
.wysiwyg-editor :deep(.ProseMirror h2) { font-size: 21px; font-weight: 650; margin: 18px 0 8px; line-height: 1.35; }
.wysiwyg-editor :deep(.ProseMirror h3) { font-size: 17px; font-weight: 620; margin: 14px 0 6px; }
.wysiwyg-editor :deep(.ProseMirror p) { margin: 6px 0; }
.wysiwyg-editor :deep(.ProseMirror ul), .wysiwyg-editor :deep(.ProseMirror ol) { padding-left: 22px; margin: 6px 0; }
.wysiwyg-editor :deep(.ProseMirror li) { margin: 3px 0; }
.wysiwyg-editor :deep(.ProseMirror strong) { font-weight: 600; }
.wysiwyg-editor :deep(.ProseMirror em) { font-style: italic; }
.wysiwyg-editor :deep(.ProseMirror code) {
  background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 4px;
  font-size: 12.5px; font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}
.wysiwyg-editor :deep(.ProseMirror pre) {
  background: #f6f8fa; border: 1px solid rgba(0,0,0,0.08); border-radius: 8px;
  padding: 10px 14px; margin: 10px 0; overflow-x: auto;
}
.wysiwyg-editor :deep(.ProseMirror pre code) {
  background: none; padding: 0; font-size: 12.5px;
}
.wysiwyg-editor :deep(.ProseMirror blockquote) {
  border-left: 3px solid rgba(34, 63, 121, 0.3); margin: 8px 0; padding-left: 12px; color: #555;
}
.wysiwyg-editor :deep(.ProseMirror img) { max-width: 100%; border-radius: 8px; margin: 6px 0; }
.wysiwyg-editor :deep(.ProseMirror hr) { border: none; border-top: 1px solid rgba(0,0,0,0.08); margin: 14px 0; }

.wysiwyg-editor :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: #aeaeb2;
  pointer-events: none;
  float: left;
  height: 0;
}

.markdown-body {
  font-size: 13px;
  line-height: 1.7;
  color: #1c1c1e;
}

.markdown-body :deep(h1) { font-size: 18px; font-weight: 700; margin: 16px 0 8px; }
.markdown-body :deep(h2) { font-size: 16px; font-weight: 600; margin: 14px 0 7px; }
.markdown-body :deep(h3) { font-size: 14px; font-weight: 600; margin: 12px 0 6px; }
.markdown-body :deep(p) { margin: 8px 0; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { margin: 8px 0; padding-left: 20px; }
.markdown-body :deep(li) { margin: 3px 0; }
.markdown-body :deep(.md-code-inline) {
  background: rgba(0,0,0,0.06);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
}
.markdown-body :deep(.md-code-wrap) {
  background: #f6f8fa;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 8px;
  margin: 10px 0;
  overflow: hidden;
  position: relative;
}
.markdown-body :deep(.md-code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 4px 12px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
.markdown-body :deep(.md-code-lang) {
  font-size: 10px;
  font-weight: 500;
  color: #8e8e93;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.markdown-body :deep(.md-code-copy) {
  font-size: 10px;
  color: #8e8e93;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.15s, background 0.12s;
  font-family: inherit;
}
.markdown-body :deep(.md-code-wrap:hover .md-code-copy) {
  opacity: 1;
}
.markdown-body :deep(.md-code-copy:hover) {
  background: rgba(0,0,0,0.06);
  color: #3c3c43;
}
.markdown-body :deep(.md-code-wrap pre) {
  margin: 0;
  padding: 10px 12px;
  background: transparent;
  border-radius: 0;
  overflow-x: auto;
}
.markdown-body :deep(.md-code-wrap pre code) {
  background: none;
  padding: 0;
  font-size: 12px;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
  color: #24292e;
}
.markdown-body :deep(blockquote) {
  border-left: 3px solid rgba(34, 63, 121, 0.25);
  margin: 8px 0;
  padding-left: 10px;
  color: #555;
}
.markdown-body :deep(img) { max-width: 100%; border-radius: 6px; }
.markdown-body :deep(a) { color: #223F79; }
.markdown-body :deep(hr) { border: none; border-top: 1px solid rgba(0,0,0,0.08); margin: 12px 0; }
.markdown-body :deep(table) { border-collapse: collapse; width: 100%; margin: 8px 0; }
.markdown-body :deep(th), .markdown-body :deep(td) { border: 1px solid rgba(0,0,0,0.08); padding: 5px 8px; font-size: 12px; }
.markdown-body :deep(th) { background: #f5f5f7; font-weight: 600; }
</style>

<style>
/* highlight.js token colors (light theme) */
.hljs-keyword, .hljs-selector-tag, .hljs-built_in { color: #d73a49; }

/* Copilot ghost suggestion text — must be global because it lives inside v-html */
.copilot-ghost-text { color: #b0b7c0; }
.hljs-string, .hljs-attr { color: #032f62; }
.hljs-comment { color: #6a737d; font-style: italic; }
.hljs-number, .hljs-literal { color: #005cc5; }
.hljs-title, .hljs-section { color: #6f42c1; }
.hljs-variable, .hljs-template-variable { color: #e36209; }
.hljs-tag { color: #22863a; }
.hljs-name { color: #22863a; }
.hljs-type { color: #6f42c1; }
.hljs-meta { color: #999; }
</style>
