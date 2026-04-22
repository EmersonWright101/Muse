<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
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
import { Star, Crosshair, Check, X, Pencil } from 'lucide-vue-next'
import { useTravelStore } from '../../../stores/travel'
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
const store = useTravelStore()

// Editor layout: 'split' | 'edit' | 'preview'
const layout = ref<'split' | 'edit' | 'preview'>('split')

const note = computed(() => store.activeNote!)

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

// Category input
const categoryInput = ref('')
const showCategorySuggestions = ref(false)
const categorySuggestions = computed(() => {
  const q = categoryInput.value.toLowerCase()
  return store.categories.filter(c => c.toLowerCase().includes(q) && c !== note.value.category)
})

watch(() => note.value.category, (v) => { categoryInput.value = v }, { immediate: true })

function applyCategory(cat: string) {
  store.setCategory(cat)
  categoryInput.value = cat
  showCategorySuggestions.value = false
}

function onCategoryBlur() {
  setTimeout(() => { showCategorySuggestions.value = false }, 150)
  if (categoryInput.value && categoryInput.value !== note.value.category) {
    store.setCategory(categoryInput.value)
  }
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
watch(() => note.value.title, triggerAutoSave)
watch(() => note.value.lat, triggerAutoSave)
watch(() => note.value.lng, triggerAutoSave)
watch(() => note.value.category, triggerAutoSave)
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
    const filename = `${note.value.id}_${Date.now()}.${ext}`

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
      <div class="meta-row">
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

        <!-- Category -->
        <div class="meta-field category-field">
          <span class="meta-label">{{ t('travel.category') }}</span>
          <input
            v-model="categoryInput"
            class="meta-input category-input"
            :placeholder="t('travel.category')"
            @focus="showCategorySuggestions = true"
            @blur="onCategoryBlur"
          />
          <div v-if="showCategorySuggestions && categorySuggestions.length" class="suggestions">
            <button
              v-for="cat in categorySuggestions"
              :key="cat"
              class="suggestion-item"
              @mousedown.prevent="applyCategory(cat)"
            >
              {{ cat }}
            </button>
          </div>
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
      </div>
      <div class="toolbar-right">
        <span v-if="autoSaveStatus === 'saving'" class="save-status">{{ t('travel.saving') }}</span>
        <span v-else-if="autoSaveStatus === 'saved'" class="save-status success">{{ t('travel.saved') }}</span>
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
      <!-- Edit pane -->
      <div v-show="layout !== 'preview'" class="edit-pane">
        <textarea
          v-model="body"
          class="md-textarea"
          :placeholder="t('travel.editorPlaceholder')"
          spellcheck="false"
          @paste="onPaste"
        />
      </div>

      <!-- Preview pane -->
      <div v-show="layout !== 'edit'" class="preview-pane">
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
.category-input { width: 110px; }

.category-field { position: relative; }

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
}

.preview-pane {
  background: white;
  padding: 14px;
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
