<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditor, EditorContent, VueNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import CodeBlock from '@tiptap/extension-code-block'
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
import Image from '@tiptap/extension-image'
import { Star, Crosshair, Check, X, Pencil, Sparkles, Loader2, Plus, Hash, Search } from 'lucide-vue-next'
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

// ─── AI Copilot + Editor state ───────────────────────────────────────────────

const editableRef         = ref<HTMLDivElement | null>(null)
const showCopilotSettings = ref(false)
const isGenerating        = ref(false)
const hasGhostSuggestion  = ref(false)
let _ghostSpan:    HTMLSpanElement | null = null
let _copilotAbort: AbortController | null = null
let _copilotTimer: ReturnType<typeof setTimeout> | null = null
let _skipBodyWatch  = false   // prevents body-watch from overwriting DOM while user is typing
let _acceptingChunk = false   // prevents onCopilotBodyChange from dismissing ghost during chunk accept

const configuredProviders = computed(() =>
  aiStore.providers.filter(p => p.enabled && (p.apiKey || p.type === 'ollama'))
)
const copilotProviderModels = computed(() =>
  (aiStore.providers.find(p => p.id === copilot.providerId)?.models ?? []).filter(m => !m.reasoning)
)

// Read the contenteditable text, stripping the ghost span
function getCleanText(): string {
  const el = editableRef.value
  if (!el) return ''
  if (!_ghostSpan) return el.innerText.replace(/\n$/, '')
  const clone = el.cloneNode(true) as HTMLDivElement
  clone.querySelectorAll('.copilot-ghost-text').forEach(n => n.remove())
  return clone.innerText.replace(/\n$/, '')
}

// Restores cursor to a character offset inside the contenteditable div.
// Accounts for <br> elements (each counts as 1 char, matching innerText behaviour).
function setBodyCursorOffset(targetOffset: number) {
  const el = editableRef.value
  if (!el) return
  const sel = window.getSelection()
  if (!sel) return
  const s = sel  // narrowed non-null for use inside nested function

  let remaining = targetOffset
  let placed = false

  function walk(node: Node): void {
    if (placed) return
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node as Text).length
      if (remaining <= len) {
        const range = document.createRange()
        range.setStart(node, remaining)
        range.collapse(true)
        s.removeAllRanges()
        s.addRange(range)
        placed = true
        return
      }
      remaining -= len
      return
    }
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') {
      if (remaining === 0) {
        const range = document.createRange()
        range.setStartBefore(node)
        range.collapse(true)
        s.removeAllRanges()
        s.addRange(range)
        placed = true
        return
      }
      remaining -= 1
      return
    }
    for (const child of Array.from(node.childNodes)) {
      walk(child)
      if (placed) return
    }
  }

  walk(el)
  if (!placed) {
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    s.removeAllRanges()
    s.addRange(range)
  }
}

// Returns char-offset of cursor in the clean body text (ghost span excluded).
// Attaches a temporary styled div to the document so innerText correctly handles
// <br> elements and white-space:pre-wrap, matching what getCleanText() returns.
function getBodyCursorOffset(): number {
  const el = editableRef.value
  if (!el) return body.value.length
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return body.value.length
  const range = document.createRange()
  range.selectNodeContents(el)
  range.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset)
  const tmp = document.createElement('div')
  tmp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:500px;white-space:pre-wrap;word-break:break-word;visibility:hidden;pointer-events:none;'
  tmp.appendChild(range.cloneContents())
  tmp.querySelectorAll('.copilot-ghost-text').forEach(n => n.remove())
  document.body.appendChild(tmp)
  const text = tmp.innerText.replace(/\n$/, '')
  document.body.removeChild(tmp)
  return text.length
}

// Insert an empty ghost span at the current cursor; returns false if no selection
function insertGhostAtCursor(): boolean {
  removeGhostSpan(false)
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  if (!range.collapsed) range.deleteContents()
  _ghostSpan = document.createElement('span')
  _ghostSpan.className = 'copilot-ghost-text'
  _ghostSpan.setAttribute('contenteditable', 'false')
  _ghostSpan.textContent = ''
  range.insertNode(_ghostSpan)
  // Keep caret just before the ghost span
  const newRange = document.createRange()
  newRange.setStartBefore(_ghostSpan)
  newRange.setEndBefore(_ghostSpan)
  sel.removeAllRanges()
  sel.addRange(newRange)
  hasGhostSuggestion.value = true
  return true
}

function removeGhostSpan(accept: boolean) {
  if (!_ghostSpan) return
  hasGhostSuggestion.value = false
  if (accept) {
    // Move caret to after the ghost text, then unwrap
    const sel = window.getSelection()
    const textNode = document.createTextNode(_ghostSpan.textContent ?? '')
    _ghostSpan.parentNode?.replaceChild(textNode, _ghostSpan)
    if (sel) {
      const r = document.createRange()
      r.setStartAfter(textNode)
      r.setEndAfter(textNode)
      sel.removeAllRanges()
      sel.addRange(r)
    }
  } else {
    _ghostSpan.parentNode?.removeChild(_ghostSpan)
  }
  _ghostSpan = null
}

function dismissSuggestion() {
  if (_copilotAbort) { _copilotAbort.abort(); _copilotAbort = null }
  removeGhostSpan(false)
  isGenerating.value = false
}

function acceptSuggestion() {
  if (!_ghostSpan) return
  if (_copilotAbort) { _copilotAbort.abort(); _copilotAbort = null }
  removeGhostSpan(true)
  const text = getCleanText()
  _skipBodyWatch = true
  body.value = text
  nextTick(() => { _skipBodyWatch = false; editableRef.value?.focus() })
  isGenerating.value = false
}

function acceptNextChunk() {
  if (!_ghostSpan) return
  const full = _ghostSpan.textContent ?? ''
  const match = full.match(/^([\s\S]*?[，。！？；：、…—""''【】,!?;:.]+\s*)/)
  const chunk     = match ? match[1] : full
  const remaining = full.slice(chunk.length)
  if (!remaining) { acceptSuggestion(); return }

  // Replace ghost content with accepted chunk (as text) and keep rest in ghost span
  const chunkNode = document.createTextNode(chunk)
  _ghostSpan.parentNode?.insertBefore(chunkNode, _ghostSpan)
  _ghostSpan.textContent = remaining

  // Move caret between chunk and ghost span
  const sel = window.getSelection()
  if (sel) {
    const r = document.createRange()
    r.setStartAfter(chunkNode)
    r.setEndAfter(chunkNode)
    sel.removeAllRanges()
    sel.addRange(r)
  }

  const text = getCleanText()
  _acceptingChunk = true
  _skipBodyWatch  = true
  body.value = text
  nextTick(() => { _skipBodyWatch = false; _acceptingChunk = false })
}

async function requestCompletion() {
  if (!copilot.enabled) return
  if (!editableRef.value) return
  if (body.value.trim().length < 8) return

  const provider = aiStore.providers.find(p => p.id === copilot.providerId && p.enabled)
  if (!provider) return
  if (!provider.apiKey && provider.type !== 'ollama') return
  const modelId = copilot.modelId || provider.selectedModelId
  if (!modelId) return

  // Capture cursor context before inserting ghost span
  const cursorOffset = getBodyCursorOffset()
  const contextText  = body.value.slice(Math.max(0, cursorOffset - copilot.contextChars), cursorOffset)

  if (_copilotAbort) _copilotAbort.abort()
  const ac = new AbortController()
  _copilotAbort = ac
  isGenerating.value = true

  if (!insertGhostAtCursor()) { isGenerating.value = false; _copilotAbort = null; return }

  const words  = copilot.completionWords
  const system = `You are a travel writing assistant. Your job is to continue the text the user has already written. Output ONLY the NEW continuation text (max ${words} words). Do NOT repeat, echo, or restate any text that already exists. Begin your output with the very next character or word that comes after the existing text.`

  try {
    await streamCopilotCompletion(provider, modelId, contextText, system, words * 6, ac.signal,
      token => { if (_ghostSpan) _ghostSpan.textContent = (_ghostSpan.textContent ?? '') + token },
    )
  } catch {
    if (!ac.signal.aborted) removeGhostSpan(false)
  }

  // Strip any leading repetition the model may have echoed from the context
  if (!ac.signal.aborted && _ghostSpan) {
    const raw  = _ghostSpan.textContent ?? ''
    const tail = contextText.slice(-Math.min(60, contextText.length))
    let stripped = raw
    for (let len = Math.min(tail.length, raw.length); len > 2; len--) {
      if (raw.startsWith(tail.slice(-len))) { stripped = raw.slice(len); break }
    }
    if (stripped !== raw) _ghostSpan.textContent = stripped
    if (!stripped) removeGhostSpan(false)
  }

  if (!ac.signal.aborted) { _copilotAbort = null; isGenerating.value = false }
}

function onCopilotBodyChange() {
  if (!copilot.enabled) return
  if (_acceptingChunk) return
  if (_ghostSpan) dismissSuggestion()
  if (_copilotTimer) clearTimeout(_copilotTimer)
  _copilotTimer = setTimeout(() => { _copilotTimer = null; requestCompletion() }, copilot.triggerDelay)
}

// Called on every input event from the contenteditable
function onEditableInput() {
  if (_ghostSpan) removeGhostSpan(false)
  const text = getCleanText()
  _skipBodyWatch = true
  body.value = text
  nextTick(() => { _skipBodyWatch = false })
}

function onEditableBeforeInput(e: InputEvent) {
  if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
    if (_ghostSpan) removeGhostSpan(false)
  }
}

// Dismiss ghost span the moment IME composition starts — the caret sits right
// before a contenteditable=false span which confuses the IME and causes pinyin
// to be output raw instead of converted.
function onEditableCompositionStart() {
  if (_ghostSpan) dismissSuggestion()
}

function onEditableKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab' && _ghostSpan) {
    e.preventDefault(); e.stopPropagation()
    acceptSuggestion(); return
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowRight' && _ghostSpan) {
    e.preventDefault(); e.stopPropagation()
    acceptNextChunk(); return
  }
  if (e.key === 'Escape' && _ghostSpan) { dismissSuggestion(); return }
  if (_ghostSpan && (e.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(e.key))) {
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
let _wysiwygSyncing = false

// Code block NodeView — adds a copy button to every code block in the WYSIWYG editor
const _copySvg = `<svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" style="display:inline-block;vertical-align:middle"><rect x="4" y="4" width="8" height="8" rx="1.2"/><path d="M2 10V2.8A.8.8 0 0 1 2.8 2H10"/></svg>`
const _checkSvg = `<svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="#34c759" stroke-width="2.2" style="display:inline-block;vertical-align:middle"><path d="M1.5 7l3.5 3.5L12.5 3"/></svg>`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CodeBlockView = {
  props: ['node', 'extension', 'getPos', 'editor', 'decorations', 'innerDecorations', 'selected', 'updateAttributes'],
  setup(props: any) {
    const copied = ref(false)
    function doCopy(e: MouseEvent) {
      e.stopPropagation()
      navigator.clipboard.writeText(props.node?.textContent ?? '')
      copied.value = true
      setTimeout(() => { copied.value = false }, 2000)
    }
    return () => h(NodeViewWrapper, { class: 'md-code-wrap', as: 'div' }, () => [
      h('div', { class: 'md-code-header' }, [
        h('span', { class: 'md-code-lang' }, props.node?.attrs?.language || 'code'),
        h('button', {
          class: 'md-code-copy',
          contenteditable: 'false',
          'data-copied': copied.value ? '' : null,
          onClick: doCopy,
        }, [
          copied.value
            ? h('span', { innerHTML: _checkSvg + ' 已复制', style: { color: '#34c759' } })
            : h('span', { innerHTML: _copySvg + ' 复制' }),
        ]),
      ]),
      h('pre', null, h(NodeViewContent, { as: 'code' })),
    ])
  },
}

const CustomCodeBlock = CodeBlock.extend({
  addNodeView() { return VueNodeViewRenderer(CodeBlockView as any) },
})

// Image NodeView: resolves relative paths to Tauri asset URLs at render time
const TravelImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement('img')
      img.src = resolveImageUrl(node.attrs.src)
      img.alt = node.attrs.alt ?? ''
      img.style.maxWidth = '100%'
      img.style.display = 'block'
      return {
        dom: img,
        update(updatedNode) {
          img.src = resolveImageUrl(updatedNode.attrs.src)
          img.alt = updatedNode.attrs.alt ?? ''
          return true
        },
      }
    }
  },
})

const wysiwygEditor = useEditor({
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    TiptapMarkdown.configure({ html: false, tightLists: true }),
    CustomCodeBlock,
    TravelImage.configure({ inline: true }),
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

function syncEditorContent() {
  if (layout.value === 'wysiwyg' && wysiwygEditor.value) {
    _wysiwygSyncing = true
    wysiwygEditor.value.commands.setContent(body.value)
    _wysiwygSyncing = false
  }
  const el = editableRef.value
  if (el) el.innerText = body.value
}

// Reload editor content when the active note changes
watch(() => note.value?.id, () => { nextTick(syncEditorContent) })

// Also sync on mount so content shows when navigating back to an already-selected note
onMounted(() => { if (note.value) nextTick(syncEditorContent) })

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
  const btn = `<button class="md-code-copy"><span class="copy-label">${_copySvg} 复制</span><span class="copy-done">${_checkSvg} 已复制</span></button>`
  return `<div class="md-code-wrap"><div class="md-code-header"><span class="md-code-lang">${validLang}</span>${btn}</div><pre><code class="hljs">${highlighted}</code></pre></div>`
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

// Tag editing
const tagInputVisible = ref(false)
const tagInputValue = ref('')
const tagInputRef = ref<HTMLInputElement>()
const tagSuggestionsVisible = ref(false)

const tagSuggestions = computed(() => {
  const q = tagInputValue.value.trim().toLowerCase()
  const existing = new Set(note.value.tags)
  return store.allTags
    .filter(t => !existing.has(t) && (q === '' || t.toLowerCase().includes(q)))
    .slice(0, 8)
})

function startAddTag() {
  tagInputVisible.value = true
  tagSuggestionsVisible.value = true
  nextTick(() => tagInputRef.value?.focus())
}

function applyTag(tag: string) {
  if (!note.value.tags.includes(tag)) {
    store.setTags([...note.value.tags, tag])
    triggerAutoSave()
  }
  tagInputValue.value = ''
  tagInputVisible.value = false
  tagSuggestionsVisible.value = false
}

function addTag() {
  const v = tagInputValue.value.trim()
  if (v) applyTag(v)
  else {
    tagInputValue.value = ''
    tagInputVisible.value = false
    tagSuggestionsVisible.value = false
  }
}

function onTagInputBlur() {
  // Delay so mousedown on suggestion fires first
  setTimeout(() => {
    tagInputVisible.value = false
    tagSuggestionsVisible.value = false
    tagInputValue.value = ''
  }, 150)
}

function removeTag(tag: string) {
  store.setTags(note.value.tags.filter(t => t !== tag))
  triggerAutoSave()
}

// Copy code block (preview pane)
function onPreviewClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('.md-code-copy') as HTMLElement | null
  if (!btn) return
  const code = btn.closest('.md-code-wrap')?.querySelector('code')?.textContent ?? ''
  navigator.clipboard.writeText(code)
  btn.setAttribute('data-copied', '')
  setTimeout(() => btn.removeAttribute('data-copied'), 2000)
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
// Sync external body changes (note switch, programmatic) → contenteditable DOM
watch(() => body.value, (val) => {
  if (_skipBodyWatch) return
  const el = editableRef.value
  if (!el) return
  const cur = el.innerText.replace(/\n$/, '')
  if (cur !== val) {
    if (_ghostSpan) removeGhostSpan(false)
    el.innerText = val
  }
}, { flush: 'sync' })
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

// Paste handler (image files → markdown; plain text → insert at cursor)
async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return

  // Image paste: save file and insert markdown
  for (const item of Array.from(items)) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue

    const buffer   = await file.arrayBuffer()
    const bytes    = new Uint8Array(buffer)
    const ext      = item.type === 'image/jpeg' ? 'jpg' : item.type.replace('image/', '')
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

    const baseDir = await travelNotesDir()
    const imgDir  = `${baseDir}/images`
    if (!(await exists(imgDir))) await mkdir(imgDir, { recursive: true })
    await writeFile(`${imgDir}/${filename}`, bytes)

    const mdText      = `![${filename}](images/${filename})`
    const offset      = getBodyCursorOffset()
    const newBody     = body.value.slice(0, offset) + mdText + body.value.slice(offset)
    const el          = editableRef.value
    _skipBodyWatch    = true
    body.value        = newBody
    if (el) el.innerText = newBody
    const newOffset   = offset + mdText.length
    nextTick(() => {
      _skipBodyWatch = false
      el?.focus()
      setBodyCursorOffset(newOffset)
    })
    return
  }

  // Plain-text paste: insert at cursor as text node
  const text = e.clipboardData?.getData('text/plain')
  if (!text) return
  if (_ghostSpan) removeGhostSpan(false)
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.setEndAfter(node)
  sel.removeAllRanges()
  sel.addRange(range)
  const newText  = getCleanText()
  _skipBodyWatch = true
  body.value     = newText
  nextTick(() => { _skipBodyWatch = false })
}

// Image asset base
initImageAssetBase()

// Map picker
const showMapPicker = ref(false)
const pickerMapContainer = ref<HTMLElement>()
let pickerMap: L.Map | null = null
let pickerMarker: L.Marker | null = null

// Search
const pickerSearchQuery   = ref('')
const pickerSearchResults = ref<{ display_name: string; lat: string; lon: string }[]>([])
const pickerSearchLoading = ref(false)
let _searchTimer: ReturnType<typeof setTimeout> | null = null

function openMapPicker() {
  showMapPicker.value = true
  pickerSearchQuery.value = ''
  pickerSearchResults.value = []
  nextTick(() => { initPickerMap() })
}

const _pinIcon = L.divIcon({
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36"><path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22S28 24.5 28 14C28 6.268 21.732 0 14 0z" fill="#ef4444"/><circle cx="14" cy="14" r="6" fill="white"/></svg>`,
  className: '',
  iconSize: [28, 36],
  iconAnchor: [14, 36],
  popupAnchor: [0, -36],
})

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

  pickerMarker = L.marker([lat, lng], { icon: _pinIcon, draggable: true }).addTo(pickerMap)

  pickerMap.on('click', (e: L.LeafletMouseEvent) => {
    pickerMarker?.setLatLng(e.latlng)
    pickerSearchResults.value = []
  })
}

async function searchPickerLocation() {
  const q = pickerSearchQuery.value.trim()
  if (!q) { pickerSearchResults.value = []; return }
  if (_searchTimer) clearTimeout(_searchTimer)
  _searchTimer = setTimeout(async () => {
    pickerSearchLoading.value = true
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6`
      const res = await fetch(url, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' } })
      pickerSearchResults.value = await res.json()
    } catch { pickerSearchResults.value = [] }
    pickerSearchLoading.value = false
  }, 400)
}

function selectSearchResult(r: { lat: string; lon: string }) {
  const lat = parseFloat(r.lat)
  const lng = parseFloat(r.lon)
  pickerMarker?.setLatLng([lat, lng])
  pickerMap?.setView([lat, lng], 14)
  pickerSearchResults.value = []
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
            <button class="title-action-btn" @mousedown.prevent="confirmTitle"><Check :size="13" /></button>
            <button class="title-action-btn" @mousedown.prevent="cancelTitle"><X :size="13" /></button>
            <input
              ref="titleInputRef"
              v-model="titleDraft"
              class="meta-input title-edit-input"
              @keydown.enter="confirmTitle"
              @keydown.escape="cancelTitle"
              @blur="confirmTitle"
            />
          </template>
          <template v-else>
            <button class="title-action-btn title-edit-trigger" @click="startEditTitle"><Pencil :size="13" /></button>
            <span class="title-display">{{ note.title || t('travel.titlePlaceholder') }}</span>
          </template>
        </div>

        <!-- Tag area -->
        <div class="tag-area">
          <span
            v-for="tag in note.tags"
            :key="tag"
            class="tag-chip"
          >
            <Hash :size="10" class="tag-hash" />{{ tag }}
            <button class="tag-remove-btn" @mousedown.prevent="removeTag(tag)"><X :size="9" /></button>
          </span>
          <div v-if="tagInputVisible" class="tag-input-wrap">
            <input
              ref="tagInputRef"
              v-model="tagInputValue"
              class="tag-input"
              :placeholder="t('travel.tagPlaceholder')"
              @keydown.enter.prevent="addTag"
              @keydown.escape="tagInputVisible = false; tagSuggestionsVisible = false; tagInputValue = ''"
              @blur="onTagInputBlur"
            />
            <div v-if="tagSuggestionsVisible && tagSuggestions.length" class="tag-suggestions">
              <button
                v-for="sug in tagSuggestions"
                :key="sug"
                class="tag-suggestion-item"
                @mousedown.prevent="applyTag(sug)"
              >#{{ sug }}</button>
            </div>
          </div>
          <button v-else class="tag-add-btn" :title="t('travel.tags')" @click="startAddTag">
            <Plus :size="11" />
          </button>
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
        <span v-if="hasGhostSuggestion" class="copilot-hint">
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
            :class="{ active: copilot.enabled, generating: isGenerating }"
            :title="t('travel.copilot.label')"
            @click.stop="showCopilotSettings = !showCopilotSettings"
          >
            <Loader2 v-if="isGenerating" :size="14" />
            <Sparkles v-else :size="13" />
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
          <!-- Search bar -->
          <div class="picker-search-wrap">
            <Search :size="13" class="picker-search-icon" />
            <input
              v-model="pickerSearchQuery"
              class="picker-search-input"
              :placeholder="t('travel.mapSearch')"
              @input="searchPickerLocation"
              @keydown.enter.prevent="searchPickerLocation"
            />
            <Loader2 v-if="pickerSearchLoading" :size="13" class="picker-search-spin" />
          </div>
          <!-- Search results -->
          <div v-if="pickerSearchResults.length" class="picker-search-results">
            <button
              v-for="r in pickerSearchResults"
              :key="r.lat + r.lon"
              class="picker-result-item"
              @click="selectSearchResult(r)"
            >{{ r.display_name }}</button>
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
          ref="editableRef"
          class="md-editor"
          contenteditable="true"
          spellcheck="false"
          :data-placeholder="t('travel.editorPlaceholder')"
          @input="onEditableInput"
          @beforeinput="onEditableBeforeInput"
          @compositionstart="onEditableCompositionStart"
          @keydown="onEditableKeydown"
          @paste.prevent="onPaste"
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

/* ─── Tag area ────────────────────────────────────────────────────────────── */

.tag-area {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  flex-wrap: nowrap;
  max-width: 220px;
  min-width: 0;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 5px 2px 4px;
  background: rgba(34, 63, 121, 0.08);
  color: #223F79;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.tag-hash {
  opacity: 0.6;
  flex-shrink: 0;
}

.tag-remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border: none;
  background: transparent;
  color: #223F79;
  opacity: 0.5;
  cursor: pointer;
  padding: 0;
  border-radius: 3px;
  flex-shrink: 0;
  transition: opacity 0.12s;
}

.tag-remove-btn:hover {
  opacity: 1;
}

.tag-add-btn {
  width: 20px;
  height: 20px;
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

.tag-add-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #3c3c43;
}

.tag-input-wrap {
  position: relative;
}

.tag-input {
  width: 80px;
  height: 22px;
  border: 1px solid rgba(34, 63, 121, 0.3);
  border-radius: 5px;
  padding: 0 6px;
  font-size: 11px;
  background: rgba(34, 63, 121, 0.04);
  color: #1c1c1e;
  outline: none;
}

.tag-input:focus {
  border-color: rgba(34, 63, 121, 0.5);
}

.tag-suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 120px;
  background: rgba(250, 250, 252, 0.98);
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  padding: 4px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tag-suggestion-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 5px 8px;
  border-radius: 5px;
  border: none;
  background: none;
  font-size: 11.5px;
  color: #223F79;
  cursor: pointer;
  transition: background 0.10s;
}

.tag-suggestion-item:hover {
  background: rgba(34, 63, 121, 0.08);
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

.picker-search-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  position: relative;
}

.picker-search-icon {
  color: #8e8e93;
  flex-shrink: 0;
}

.picker-search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 12.5px;
  color: #1c1c1e;
  background: transparent;
}

.picker-search-input::placeholder {
  color: #aeaeb2;
}

.picker-search-spin {
  color: #8e8e93;
  animation: copilot-spin 0.7s linear infinite;
  flex-shrink: 0;
}

.picker-search-results {
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  max-height: 160px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.picker-result-item {
  text-align: left;
  padding: 7px 14px;
  font-size: 12px;
  color: #1c1c1e;
  border: none;
  background: none;
  cursor: pointer;
  line-height: 1.4;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
}

.picker-result-item:last-child {
  border-bottom: none;
}

.picker-result-item:hover {
  background: rgba(34, 63, 121, 0.06);
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

.md-editor {
  min-height: 100%;
  outline: none;
  padding: 14px;
  font-size: 13px;
  line-height: 1.7;
  color: #1c1c1e;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  box-sizing: border-box;
  caret-color: #1c1c1e;
}
.md-editor:empty::before {
  content: attr(data-placeholder);
  color: #aeaeb2;
  pointer-events: none;
}

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

@keyframes copilot-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes rainbow-btn {
  0%   { border-color: #ff3b30; color: #ff3b30; box-shadow: 0 0 8px 2px #ff3b3040; background: #ff3b3012; }
  16%  { border-color: #ff9500; color: #ff9500; box-shadow: 0 0 8px 2px #ff950040; background: #ff950012; }
  33%  { border-color: #ffcc00; color: #b38600; box-shadow: 0 0 8px 2px #ffcc0040; background: #ffcc0012; }
  50%  { border-color: #34c759; color: #34c759; box-shadow: 0 0 8px 2px #34c75940; background: #34c75912; }
  66%  { border-color: #007aff; color: #007aff; box-shadow: 0 0 8px 2px #007aff40; background: #007aff12; }
  83%  { border-color: #af52de; color: #af52de; box-shadow: 0 0 8px 2px #af52de40; background: #af52de12; }
  100% { border-color: #ff3b30; color: #ff3b30; box-shadow: 0 0 8px 2px #ff3b3040; background: #ff3b3012; }
}
.copilot-btn.generating {
  animation: rainbow-btn 1.8s linear infinite;
}
.copilot-btn.generating :deep(svg) {
  animation: copilot-spin 0.7s linear infinite;
}

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
  transition: opacity 0.15s, background 0.12s, color 0.15s;
  font-family: inherit;
  display: flex;
  align-items: center;
  gap: 3px;
}
.markdown-body :deep(.md-code-wrap:hover .md-code-copy) { opacity: 1; }
.markdown-body :deep(.md-code-copy:hover) { background: rgba(0,0,0,0.06); color: #3c3c43; }
.markdown-body :deep(.md-code-copy .copy-done) { display: none; color: #34c759; }
.markdown-body :deep(.md-code-copy[data-copied]) { opacity: 1; color: #34c759; }
.markdown-body :deep(.md-code-copy[data-copied] .copy-label) { display: none; }
.markdown-body :deep(.md-code-copy[data-copied] .copy-done) { display: flex; align-items: center; gap: 3px; }
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

/* WYSIWYG code block copy button (NodeView renders outside scoped CSS) */
.wysiwyg-editor .md-code-wrap { background: #f6f8fa; border: 1px solid rgba(0,0,0,0.08); border-radius: 8px; margin: 10px 0; overflow: hidden; }
.wysiwyg-editor .md-code-header { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px 4px 12px; border-bottom: 1px solid rgba(0,0,0,0.06); }
.wysiwyg-editor .md-code-lang { font-size: 10px; font-weight: 500; color: #8e8e93; font-family: ui-monospace, 'SF Mono', Menlo, monospace; text-transform: uppercase; letter-spacing: 0.06em; }
.wysiwyg-editor .md-code-copy { font-size: 10px; color: #8e8e93; background: transparent; border: none; cursor: pointer; padding: 2px 6px; border-radius: 4px; opacity: 0; transition: opacity 0.15s, color 0.15s; font-family: inherit; display: flex; align-items: center; gap: 3px; }
.wysiwyg-editor .md-code-wrap:hover .md-code-copy { opacity: 1; }
.wysiwyg-editor .md-code-copy:hover { background: rgba(0,0,0,0.06); }
.wysiwyg-editor .md-code-copy[data-copied] { opacity: 1; color: #34c759; }
.wysiwyg-editor .md-code-wrap pre { margin: 0; padding: 10px 12px; background: transparent; overflow-x: auto; }
.wysiwyg-editor .md-code-wrap pre code { background: none; padding: 0; font-size: 12px; font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace; }
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
