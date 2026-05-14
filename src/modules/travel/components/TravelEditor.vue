<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditor, EditorContent, VueNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
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
import {
  Bold, Italic, Strikethrough, Code, List, ListOrdered, Quote, Minus, FileCode,
  Star, Crosshair, Check, X, Pencil, Sparkles, Loader2, Plus, Hash, Search,
  Calendar, MapPin, Folder,
} from 'lucide-vue-next'
import { useTravelStore } from '../../../stores/travel'
import { useTravelCopilotStore } from '../../../stores/travelCopilot'
import { useAiSettingsStore } from '../../../stores/aiSettings'
import { streamCopilotCompletion } from '../../../composables/useCopilotStream'
import { writeFile, mkdir, exists } from '@tauri-apps/plugin-fs'
import { travelNotesDir } from '../../../utils/path'
import { initImageAssetBase, resolveImageUrl } from '../../../utils/imageAsset'
import { uploadTravelImage, randomTravelEmoji } from '../../../utils/travelStorage'

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
let _skipBodyWatch  = false
let _acceptingChunk = false
let _skipIdSync     = false

const configuredProviders = computed(() =>
  aiStore.providers.filter(p => p.enabled && (p.apiKey || p.type === 'ollama'))
)
const copilotProviderModels = computed(() =>
  aiStore.providers.find(p => p.id === copilot.providerId)?.models ?? []
)

function getCleanText(): string {
  const el = editableRef.value
  if (!el) return ''
  if (!_ghostSpan) return el.innerText.replace(/\n$/, '')
  const clone = el.cloneNode(true) as HTMLDivElement
  clone.querySelectorAll('.copilot-ghost-text').forEach(n => n.remove())
  return clone.innerText.replace(/\n$/, '')
}

function setBodyCursorOffset(targetOffset: number) {
  const el = editableRef.value
  if (!el) return
  const sel = window.getSelection()
  if (!sel) return
  const s = sel

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

  const chunkNode = document.createTextNode(chunk)
  _ghostSpan.parentNode?.insertBefore(chunkNode, _ghostSpan)
  _ghostSpan.textContent = remaining

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
    await streamCopilotCompletion(provider, modelId, contextText, system, words * 6, ac.signal, {
      onToken(token: string) { if (_ghostSpan) _ghostSpan.textContent = (_ghostSpan.textContent ?? '') + token },
    })
  } catch {
    if (!ac.signal.aborted) removeGhostSpan(false)
  }

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

// ─── Layout ──────────────────────────────────────────────────────────────────
const layout = ref<'split' | 'edit' | 'preview' | 'wysiwyg'>('split')

// ─── WYSIWYG (Tiptap) ────────────────────────────────────────────────────────
let _wysiwygSyncing = false

const _copySvg  = `<svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" style="display:inline-block;vertical-align:middle"><rect x="4" y="4" width="8" height="8" rx="1.2"/><path d="M2 10V2.8A.8.8 0 0 1 2.8 2H10"/></svg>`
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

const lowlight = createLowlight(common)
const CustomCodeBlock = CodeBlockLowlight.configure({ lowlight }).extend({
  addNodeView() { return VueNodeViewRenderer(CodeBlockView as any) },
})

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

const editorState = ref(0)

const wysiwygEditor = useEditor({
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    TiptapMarkdown.configure({ html: false, tightLists: true }),
    CustomCodeBlock,
    TravelImage.configure({ inline: true }),
  ],
  content: '',
  editorProps: {
    handlePaste(_view: unknown, event: ClipboardEvent) {
      const items = event.clipboardData?.items
      if (!items) return false
      for (const item of Array.from(items)) {
        if (!item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (!file) continue
        const mimeType = item.type
        ;(async () => {
          const buffer = await file.arrayBuffer()
          const bytes = new Uint8Array(buffer)
          const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType.replace('image/', '')
          const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
          const baseDir = await travelNotesDir()
          const imgDir = `${baseDir}/images`
          if (!(await exists(imgDir))) await mkdir(imgDir, { recursive: true })
          await writeFile(`${imgDir}/${filename}`, bytes)
          uploadTravelImage(filename, note.value.id, bytes, mimeType).catch(() => {})
          wysiwygEditor.value?.chain().focus().setImage({ src: `images/${filename}` }).run()
        })()
        return true
      }
      return false
    },
  },
  onUpdate({ editor }) {
    if (_wysiwygSyncing) return
    _wysiwygSyncing = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body.value = (editor.storage as any).markdown.getMarkdown()
    _wysiwygSyncing = false
  },
  onTransaction() { editorState.value++ },
  onSelectionUpdate() { editorState.value++ },
})

function isActive(name: string, attrs?: Record<string, unknown>): boolean {
  editorState.value // register reactive dependency
  return wysiwygEditor.value?.isActive(name, attrs) ?? false
}

function fmtBold()      { wysiwygEditor.value?.chain().focus().toggleBold().run() }
function fmtItalic()    { wysiwygEditor.value?.chain().focus().toggleItalic().run() }
function fmtStrike()    { wysiwygEditor.value?.chain().focus().toggleStrike().run() }
function fmtCode()      { wysiwygEditor.value?.chain().focus().toggleCode().run() }
function fmtH(level: 1 | 2 | 3) { wysiwygEditor.value?.chain().focus().toggleHeading({ level }).run() }
function fmtBullet()    { wysiwygEditor.value?.chain().focus().toggleBulletList().run() }
function fmtOrdered()   { wysiwygEditor.value?.chain().focus().toggleOrderedList().run() }
function fmtQuote()     { wysiwygEditor.value?.chain().focus().toggleBlockquote().run() }
function fmtCodeBlock() { wysiwygEditor.value?.chain().focus().toggleCodeBlock().run() }
function fmtHr()        { wysiwygEditor.value?.chain().focus().setHorizontalRule().run() }

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

watch(() => note.value?.id, () => {
  if (_skipIdSync) return
  nextTick(syncEditorContent)
})

onMounted(() => { if (note.value) nextTick(syncEditorContent) })

// Body without frontmatter
const body = computed({
  get() {
    const raw = note.value.content
    const m = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)$/)
    return m ? m[1].trimStart() : raw
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

// ─── Title (direct input, no pencil-click) ────────────────────────────────────
const titleInputRef = ref<HTMLInputElement>()
const titleDraft = ref('')

watch(() => note.value?.id, () => {
  titleDraft.value = note.value?.title ?? ''
}, { immediate: true })

function confirmTitle() {
  const v = titleDraft.value.trim()
  if (v) {
    store.setTitle(v)
    const sanitized = sanitizeFilename(v)
    if (sanitized) {
      _skipIdSync = true
      note.value.id = sanitized
      nextTick(() => { _skipIdSync = false })
    }
  }
}

// ─── Cover emoji ──────────────────────────────────────────────────────────────
const isCoverEmoji = computed(() => {
  const c = note.value?.cover ?? ''
  return c && !c.includes('.') && !c.startsWith('http') && !c.startsWith('/')
})

function changeCoverEmoji() {
  store.setCover(randomTravelEmoji())
}

// ─── Tags ─────────────────────────────────────────────────────────────────────
const tagInputVisible = ref(false)
const tagInputValue = ref('')
const tagInputRef = ref<HTMLInputElement>()
const tagSuggestionsVisible = ref(false)

const tagSuggestions = computed(() => {
  const q = tagInputValue.value.trim().toLowerCase()
  const existing = new Set(note.value.tags)
  return store.allTags
    .filter(tg => !existing.has(tg) && (q === '' || tg.toLowerCase().includes(q)))
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
  setTimeout(() => {
    tagInputVisible.value = false
    tagSuggestionsVisible.value = false
    tagInputValue.value = ''
  }, 150)
}

function removeTag(tag: string) {
  store.setTags(note.value.tags.filter(tg => tg !== tag))
  triggerAutoSave()
}

// ─── Preview click (copy code) ────────────────────────────────────────────────
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

// ─── Category editing ────────────────────────────────────────────────────────
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

// ─── Rating ───────────────────────────────────────────────────────────────────
function setRating(r: number) {
  store.setRating(note.value.rating === r ? 0 : r)
}

// ─── Auto-save ────────────────────────────────────────────────────────────────
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
watch(() => body.value, (val) => {
  if (_skipBodyWatch) return
  const el = editableRef.value
  if (!el) return
  const cur = el.innerText.replace(/\n$/, '')
  if (cur !== val) {
    if (_ghostSpan) removeGhostSpan(false)
    const focused = document.activeElement === el
    const offset  = focused ? getBodyCursorOffset() : -1
    el.innerText = val
    if (focused && offset >= 0) nextTick(() => setBodyCursorOffset(offset))
  }
}, { flush: 'sync' })
watch(() => note.value.title,      triggerAutoSave)
watch(() => note.value.lat,        triggerAutoSave)
watch(() => note.value.lng,        triggerAutoSave)
watch(() => note.value.categoryL1, triggerAutoSave)
watch(() => note.value.categoryL2, triggerAutoSave)
watch(() => note.value.rating,     triggerAutoSave)
watch(() => note.value.date,       triggerAutoSave)
watch(() => note.value.cover,      triggerAutoSave)
watch(() => note.value.status,     triggerAutoSave)

// ─── Save shortcut ────────────────────────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    store.saveActive()
  }
}

// ─── Paste handler ────────────────────────────────────────────────────────────
async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return

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
    uploadTravelImage(filename, note.value.id, bytes, item.type).catch(() => {})

    const mdText   = `![${filename}](images/${filename})`
    const offset   = getBodyCursorOffset()
    const newBody  = body.value.slice(0, offset) + mdText + body.value.slice(offset)
    const el       = editableRef.value
    _skipBodyWatch = true
    body.value     = newBody
    if (el) el.innerText = newBody
    const newOffset = offset + mdText.length
    nextTick(() => {
      _skipBodyWatch = false
      el?.focus()
      setBodyCursorOffset(newOffset)
    })
    return
  }

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

// ─── Split-mode synchronized scrolling ───────────────────────────────────────
const sourcePaneRef  = ref<HTMLDivElement>()
const previewPaneRef = ref<HTMLDivElement>()
let _activeScrollPane: 'source' | 'preview' | null = null
function setScrollSource()  { _activeScrollPane = 'source' }
function setScrollPreview() { _activeScrollPane = 'preview' }
function clearScrollPane()  { _activeScrollPane = null }

function onSourceScroll() {
  if (layout.value !== 'split' || _activeScrollPane !== 'source') return
  const src = sourcePaneRef.value
  const dst = previewPaneRef.value
  if (!src || !dst) return
  const ratio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight)
  dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight)
}

function onPreviewScroll() {
  if (layout.value !== 'split' || _activeScrollPane !== 'preview') return
  const src = previewPaneRef.value
  const dst = sourcePaneRef.value
  if (!src || !dst) return
  const ratio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight)
  dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight)
}

// ─── Map picker ───────────────────────────────────────────────────────────────
const showMapPicker = ref(false)
const pickerMapContainer = ref<HTMLElement>()
let pickerMap: L.Map | null = null
let pickerMarker: L.Marker | null = null

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

initImageAssetBase()
</script>

<template>
  <div class="travel-editor" @keydown="onKeydown">

    <!-- ── Toolbar ──────────────────────────────────────────────────────────── -->
    <div class="editor-toolbar">
      <!-- Icon + title: always left -->
      <div class="toolbar-title-area">
        <button class="toolbar-cover-btn" :title="t('travel.changeCover')" @click="changeCoverEmoji">
          <span v-if="isCoverEmoji" class="toolbar-cover-emoji">{{ note.cover }}</span>
          <span v-else class="toolbar-cover-emoji toolbar-cover-emoji--default">✈️</span>
        </button>
        <input
          ref="titleInputRef"
          v-model="titleDraft"
          class="toolbar-title-input"
          :placeholder="t('travel.titlePlaceholder')"
          @keydown.enter.prevent="confirmTitle(); ($event.target as HTMLInputElement).blur()"
          @blur="confirmTitle"
        />
      </div>

      <!-- Format buttons: always visible -->
      <div class="fmt-group">
        <button class="fmt-btn" :class="{ active: isActive('bold') }" title="Bold" @mousedown.prevent="fmtBold"><Bold :size="13" /></button>
        <button class="fmt-btn" :class="{ active: isActive('italic') }" title="Italic" @mousedown.prevent="fmtItalic"><Italic :size="13" /></button>
        <button class="fmt-btn" :class="{ active: isActive('strike') }" title="Strikethrough" @mousedown.prevent="fmtStrike"><Strikethrough :size="13" /></button>
        <button class="fmt-btn" :class="{ active: isActive('code') }" title="Inline Code" @mousedown.prevent="fmtCode"><Code :size="13" /></button>
        <div class="fmt-sep" />
        <button class="fmt-btn fmt-btn--text" :class="{ active: isActive('heading', { level: 1 }) }" title="Heading 1" @mousedown.prevent="fmtH(1)">H1</button>
        <button class="fmt-btn fmt-btn--text" :class="{ active: isActive('heading', { level: 2 }) }" title="Heading 2" @mousedown.prevent="fmtH(2)">H2</button>
        <button class="fmt-btn fmt-btn--text" :class="{ active: isActive('heading', { level: 3 }) }" title="Heading 3" @mousedown.prevent="fmtH(3)">H3</button>
        <div class="fmt-sep" />
        <button class="fmt-btn" :class="{ active: isActive('bulletList') }" title="Bullet List" @mousedown.prevent="fmtBullet"><List :size="13" /></button>
        <button class="fmt-btn" :class="{ active: isActive('orderedList') }" title="Numbered List" @mousedown.prevent="fmtOrdered"><ListOrdered :size="13" /></button>
        <button class="fmt-btn" :class="{ active: isActive('blockquote') }" title="Blockquote" @mousedown.prevent="fmtQuote"><Quote :size="13" /></button>
        <button class="fmt-btn" :class="{ active: isActive('codeBlock') }" title="Code Block" @mousedown.prevent="fmtCodeBlock"><FileCode :size="13" /></button>
        <button class="fmt-btn" title="Horizontal Rule" @mousedown.prevent="fmtHr"><Minus :size="13" /></button>
      </div>

      <div class="toolbar-spacer" />

      <div class="toolbar-right">
        <span v-if="hasGhostSuggestion" class="copilot-hint">
          <kbd>Tab</kbd> {{ t('travel.copilot.accept') }} &middot;
          <kbd>⌘→</kbd> {{ t('travel.copilot.acceptWord') }} &middot;
          <kbd>Esc</kbd> {{ t('travel.copilot.dismiss') }}
        </span>
        <span v-else-if="autoSaveStatus === 'saving'" class="save-status">{{ t('travel.saving') }}</span>
        <span v-else-if="autoSaveStatus === 'saved'" class="save-status saved">{{ t('travel.saved') }}</span>

        <div class="mode-switch">
          <button class="mode-btn" :class="{ active: layout === 'wysiwyg' }" @click="layout = 'wysiwyg'">{{ t('travel.wysiwygMode') }}</button>
          <button class="mode-btn" :class="{ active: layout === 'split' }" @click="layout = 'split'">{{ t('travel.splitMode') }}</button>
          <button class="mode-btn" :class="{ active: layout === 'edit' }" @click="layout = 'edit'">{{ t('travel.editMode') }}</button>
          <button class="mode-btn" :class="{ active: layout === 'preview' }" @click="layout = 'preview'">{{ t('travel.previewMode') }}</button>
        </div>

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

    <!-- ── Document header (cover + title + meta) ───────────────────────────── -->
    <div class="doc-header">
      <div class="doc-inner">
        <div class="doc-meta">

          <!-- Category (pencil-click edit) -->
          <div class="meta-item meta-category" :class="{ 'meta-category--editing': editingCategory }">
            <Folder :size="11" class="meta-icon" />
            <template v-if="editingCategory">
              <div class="cat-input-wrap">
                <input
                  v-model="categoryL1Draft"
                  class="meta-cat-input"
                  :placeholder="t('travel.categoryPlaceholder')"
                  @focus="showL1Suggestions = true"
                  @blur="onL1Blur"
                />
                <div v-if="showL1Suggestions && l1Suggestions.length" class="suggestions">
                  <button v-for="cat in l1Suggestions" :key="cat" class="suggestion-item" @mousedown.prevent="applyL1(cat)">{{ cat }}</button>
                </div>
              </div>
              <span class="meta-cat-sep">·</span>
              <div class="cat-input-wrap">
                <input
                  v-model="categoryL2Draft"
                  class="meta-cat-input"
                  :placeholder="t('travel.categoryPlaceholder')"
                  @focus="showL2Suggestions = true"
                  @blur="onL2Blur"
                />
                <div v-if="showL2Suggestions && l2Suggestions.length" class="suggestions">
                  <button v-for="cat in l2Suggestions" :key="cat" class="suggestion-item" @mousedown.prevent="applyL2(cat)">{{ cat }}</button>
                </div>
              </div>
              <button class="meta-action-btn" @mousedown.prevent="confirmCategory"><Check :size="11" /></button>
              <button class="meta-action-btn" @mousedown.prevent="cancelCategory"><X :size="11" /></button>
            </template>
            <template v-else>
              <span class="meta-cat-text">{{ note.categoryL1 || '—' }}</span>
              <span class="meta-cat-sep">·</span>
              <span class="meta-cat-text">{{ note.categoryL2 || '—' }}</span>
              <button class="meta-action-btn meta-cat-edit-btn" @click="startEditCategory"><Pencil :size="10" /></button>
            </template>
          </div>

          <span class="meta-dot">·</span>

          <!-- Date -->
          <div class="meta-item">
            <Calendar :size="11" class="meta-icon" />
            <input v-model="note.date" type="date" class="meta-date-input" @input="store.setDate(note.date)" />
          </div>

          <span class="meta-dot">·</span>

          <!-- Coordinates + map picker -->
          <div class="meta-item meta-coords">
            <MapPin :size="11" class="meta-icon" />
            <input
              :value="note.lat || ''"
              type="number"
              step="any"
              class="meta-coord-input"
              :placeholder="t('travel.lat')"
              @input="store.setLatLng(Number(($event.target as HTMLInputElement).value), note.lng)"
            />
            <span class="meta-coord-comma">,</span>
            <input
              :value="note.lng || ''"
              type="number"
              step="any"
              class="meta-coord-input"
              :placeholder="t('travel.lng')"
              @input="store.setLatLng(note.lat, Number(($event.target as HTMLInputElement).value))"
            />
            <button class="meta-action-btn meta-picker-btn" :title="t('travel.mapPick')" @click="openMapPicker">
              <Crosshair :size="11" />
            </button>
          </div>

          <span class="meta-dot">·</span>

          <!-- Rating -->
          <div class="meta-item">
            <div class="star-row">
              <button
                v-for="i in 5"
                :key="i"
                class="star-btn"
                :class="{ filled: i <= note.rating }"
                @click="setRating(i)"
              >
                <Star :size="12" />
              </button>
            </div>
          </div>

          <span class="meta-dot">·</span>

          <!-- Status -->
          <div class="meta-item">
            <div class="status-toggle">
              <button
                class="status-btn"
                :class="{ active: note.status === 'visited' }"
                @click="store.setStatus('visited')"
              >{{ t('travel.visited') }}</button>
              <button
                class="status-btn"
                :class="{ active: note.status === 'upcoming' }"
                @click="store.setStatus('upcoming')"
              >{{ t('travel.upcoming') }}</button>
            </div>
          </div>

          <span class="meta-dot">·</span>

          <!-- Tags -->
          <div class="meta-tags">
            <span v-for="tag in note.tags" :key="tag" class="tag-chip">
              <Hash :size="9" class="tag-hash" />{{ tag }}
              <button class="tag-remove-btn" @mousedown.prevent="removeTag(tag)">×</button>
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
                <button v-for="sug in tagSuggestions" :key="sug" class="tag-suggestion-item" @mousedown.prevent="applyTag(sug)">#{{ sug }}</button>
              </div>
            </div>
            <button v-else class="tag-add-btn" :title="t('travel.tags')" @click="startAddTag">
              <Plus :size="10" />
              <span v-if="note.tags.length === 0" class="tag-add-label">{{ t('travel.tags') }}</span>
            </button>
          </div>

        </div>
      </div>
    </div>

    <!-- ── Map picker modal ──────────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showMapPicker" class="picker-overlay" @click="closePicker">
        <div class="picker-dialog" @click.stop>
          <div class="picker-header">
            <h3 class="picker-title">{{ t('travel.mapPick') }}</h3>
            <button class="picker-close" @click="closePicker">
              <X :size="16" />
            </button>
          </div>
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

    <!-- ── Content area ──────────────────────────────────────────────────────── -->
    <div class="editor-content" :class="`layout-${layout}`">

      <!-- WYSIWYG pane -->
      <div v-show="layout === 'wysiwyg'" class="wysiwyg-pane">
        <EditorContent :editor="wysiwygEditor" class="wysiwyg-editor" />
      </div>

      <!-- Source pane (edit + split) -->
      <div
        ref="sourcePaneRef"
        v-show="layout === 'edit' || layout === 'split'"
        class="source-pane"
        @scroll="onSourceScroll"
        @pointerenter="setScrollSource"
        @pointerleave="clearScrollPane"
      >
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

      <!-- Preview pane (preview + split) -->
      <div
        ref="previewPaneRef"
        v-show="layout === 'preview' || layout === 'split'"
        class="preview-pane"
        @scroll="onPreviewScroll"
        @pointerenter="setScrollPreview"
        @pointerleave="clearScrollPane"
      >
        <div class="markdown-body" v-html="previewHtml" @click="onPreviewClick" />
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ── Root ─────────────────────────────────────────────────────────────────── */
.travel-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
}

/* ── Toolbar ──────────────────────────────────────────────────────────────── */
.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 8px;
  height: 42px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
  background: rgba(250, 250, 250, 0.96);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  gap: 8px;
  user-select: none;
  -webkit-user-select: none;
  position: relative;
  z-index: 10;
}

.fmt-group {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}

.toolbar-title-area {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 260px;
  flex-shrink: 1;
  overflow: hidden;
  margin-right: 8px;
}

.toolbar-cover-btn {
  flex-shrink: 0;
  background: none;
  border: none;
  padding: 0 2px;
  cursor: pointer;
  line-height: 1;
  border-radius: 4px;
  transition: transform 0.12s;
}
.toolbar-cover-btn:hover { transform: scale(1.15); }

.toolbar-cover-emoji {
  font-size: 20px;
  line-height: 1;
  display: block;
  user-select: none;
}
.toolbar-cover-emoji--default { opacity: 0.3; }

.toolbar-title-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  outline: none;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.12s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toolbar-title-input:hover  { background: rgba(0,0,0,0.04); }
.toolbar-title-input:focus  { background: rgba(0,0,0,0.05); }
.toolbar-title-input::placeholder { color: #d1d1d6; font-weight: 600; }

.fmt-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: #6e6e73;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
}

.fmt-btn:hover { background: rgba(0, 0, 0, 0.06); color: #1c1c1e; }
.fmt-btn.active { background: rgba(34, 63, 121, 0.10); color: #223F79; }

.fmt-btn--text {
  font-size: 11px;
  font-weight: 700;
  width: 28px;
  letter-spacing: -0.3px;
}

.fmt-sep {
  width: 1px;
  height: 16px;
  background: rgba(0, 0, 0, 0.08);
  margin: 0 3px;
  flex-shrink: 0;
}

.toolbar-spacer { flex: 1; }

/* Mode switch */
.mode-switch {
  display: flex;
  gap: 1px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 7px;
  padding: 2px;
  flex-shrink: 0;
}

.mode-btn {
  border: none;
  background: transparent;
  color: #8e8e93;
  font-size: 10.5px;
  font-weight: 500;
  padding: 3px 9px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.mode-btn.active {
  background: #fff;
  color: #1c1c1e;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.10), 0 0 0 0.5px rgba(0, 0, 0, 0.04);
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.save-btn {
  border: none;
  background: rgba(34, 63, 121, 0.09);
  color: #223F79;
  font-size: 11.5px;
  font-weight: 500;
  padding: 4px 13px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}

.save-btn:hover { background: rgba(34, 63, 121, 0.16); }

.save-status { font-size: 11px; color: #aeaeb2; }
.save-status.saved { color: #34c759; }

/* Copilot */
.copilot-hint {
  font-size: 10.5px; color: #8e8e93;
  display: flex; align-items: center; gap: 3px;
}
.copilot-hint kbd {
  font-family: inherit; font-size: 10px;
  background: rgba(0,0,0,0.06); border: 1px solid rgba(0,0,0,0.12);
  border-radius: 3px; padding: 0 4px; line-height: 16px;
}
.copilot-wrap { position: relative; }
.copilot-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px;
  border: 1px solid rgba(0,0,0,0.10); border-radius: 6px;
  background: transparent; cursor: pointer; color: #8e8e93;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.copilot-btn:hover { background: rgba(0,0,0,0.04); color: #3c3c43; }
.copilot-btn.active { color: #223F79; background: rgba(34,63,121,0.07); border-color: rgba(34,63,121,0.22); }

@keyframes copilot-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes rainbow-btn {
  0%   { border-color: #ff3b30; color: #ff3b30; box-shadow: 0 0 8px 2px #ff3b3040; background: #ff3b3012; }
  16%  { border-color: #ff9500; color: #ff9500; box-shadow: 0 0 8px 2px #ff950040; background: #ff950012; }
  33%  { border-color: #ffcc00; color: #b38600; box-shadow: 0 0 8px 2px #ffcc0040; background: #ffcc0012; }
  50%  { border-color: #34c759; color: #34c759; box-shadow: 0 0 8px 2px #34c75940; background: #34c75912; }
  66%  { border-color: #007aff; color: #007aff; box-shadow: 0 0 8px 2px #007aff40; background: #007aff12; }
  83%  { border-color: #af52de; color: #af52de; box-shadow: 0 0 8px 2px #af52de40; background: #af52de12; }
  100% { border-color: #ff3b30; color: #ff3b30; box-shadow: 0 0 8px 2px #ff3b3040; background: #ff3b3012; }
}
.copilot-btn.generating { animation: rainbow-btn 1.8s linear infinite; }
.copilot-btn.generating :deep(svg) { animation: copilot-spin 0.7s linear infinite; }

.copilot-panel {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 200;
  background: #fff; border: 1px solid rgba(0,0,0,0.10); border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
  padding: 14px; min-width: 230px; display: flex; flex-direction: column; gap: 10px;
}
.copilot-toggle-row { display: flex; align-items: center; justify-content: space-between; cursor: pointer; }
.copilot-panel-title { font-size: 12px; font-weight: 600; color: #1c1c1e; }
.copilot-checkbox { width: 16px; height: 16px; cursor: pointer; accent-color: #223F79; }
.copilot-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.copilot-label { font-size: 11px; color: #6e6e73; white-space: nowrap; }
.copilot-select { flex: 1; min-width: 0; font-size: 11px; border: 1px solid rgba(0,0,0,0.12); border-radius: 5px; padding: 3px 5px; background: #f5f5f7; color: #1c1c1e; outline: none; }
.copilot-number { width: 52px; font-size: 11px; border: 1px solid rgba(0,0,0,0.12); border-radius: 5px; padding: 3px 5px; background: #f5f5f7; color: #1c1c1e; outline: none; text-align: center; }
.copilot-delay-wrap { display: flex; align-items: center; gap: 4px; }
.copilot-unit { font-size: 11px; color: #8e8e93; }
.copilot-number--wide { width: 68px; }

/* ── Document header ──────────────────────────────────────────────────────── */
.doc-header {
  flex-shrink: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  padding: 10px 0 0;
  background: #fff;
  user-select: none;
  -webkit-user-select: none;
}

.doc-inner {
  padding: 0 40px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.cover-btn {
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; padding: 0;
  cursor: pointer; border-radius: 8px; flex-shrink: 0;
  transition: transform 0.18s ease, opacity 0.15s;
}
.cover-btn:hover { transform: scale(1.12); opacity: 0.85; }
.cover-emoji { font-size: 32px; line-height: 1; display: block; user-select: none; }
.cover-emoji--default { opacity: 0.3; }

.title-input {
  flex: 1; min-width: 0;
  border: none; outline: none; background: transparent;
  font-size: 28px; font-weight: 700; color: #1c1c1e; line-height: 1.25; padding: 0;
  letter-spacing: -0.3px; caret-color: #223F79; box-sizing: border-box;
  user-select: text; -webkit-user-select: text;
}
.title-input::placeholder { color: #d1d1d6; font-weight: 600; }

/* Doc meta row */
.doc-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  padding-bottom: 14px;
}

.meta-dot { font-size: 11px; color: #d1d1d6; flex-shrink: 0; }
.meta-item { display: flex; align-items: center; gap: 4px; position: relative; }
.meta-icon { color: #aeaeb2; flex-shrink: 0; }

/* Category */
.meta-category { gap: 4px; }
.meta-cat-text { font-size: 11.5px; color: #6e6e73; white-space: nowrap; }
.meta-cat-sep  { font-size: 11px; color: #c7c7cc; }
.meta-cat-edit-btn { opacity: 0; transition: opacity 0.12s; }
.meta-category:hover .meta-cat-edit-btn { opacity: 1; }
.cat-input-wrap { position: relative; }
.meta-cat-input {
  width: 80px; font-size: 11px;
  border: 1px solid rgba(0,0,0,0.12); border-radius: 4px;
  padding: 2px 6px; outline: none; background: white; color: #1c1c1e; font-family: inherit;
}
.meta-cat-input:focus { border-color: rgba(34,63,121,0.35); }

.suggestions {
  position: absolute; top: calc(100% + 4px); left: 0; min-width: 130px;
  background: rgba(252,252,254,0.98); border: 1px solid rgba(0,0,0,0.09);
  border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  padding: 4px; z-index: 60; display: flex; flex-direction: column; gap: 1px;
}
.suggestion-item {
  display: block; width: 100%; text-align: left; padding: 5px 9px;
  border-radius: 6px; border: none; background: none; font-size: 11.5px;
  color: #1c1c1e; cursor: pointer; transition: background 0.10s; font-family: inherit;
}
.suggestion-item:hover { background: rgba(0,0,0,0.05); }

/* Date */
.meta-date-input {
  border: none; background: transparent; outline: none;
  font-size: 11.5px; color: #6e6e73; cursor: pointer; font-family: inherit; padding: 0;
}
.meta-date-input:hover { color: #3c3c43; }

/* Coordinates */
.meta-coords { gap: 3px; }
.meta-coord-input {
  width: 72px; border: none; background: transparent; outline: none;
  font-size: 11.5px; color: #6e6e73; font-family: inherit; padding: 0; text-align: center;
}
.meta-coord-input:focus { color: #1c1c1e; }
.meta-coord-comma { font-size: 11px; color: #c7c7cc; flex-shrink: 0; }

/* Action buttons (check, x, pencil, crosshair) */
.meta-action-btn {
  width: 18px; height: 18px;
  border: none; background: transparent; color: #8e8e93;
  border-radius: 4px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; padding: 0; flex-shrink: 0; transition: background 0.12s, color 0.12s;
}
.meta-action-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }
.meta-picker-btn { color: #223F79; opacity: 0.7; }
.meta-picker-btn:hover { opacity: 1; background: rgba(34,63,121,0.08); }

/* Rating */
.star-row { display: flex; gap: 1px; }
.star-btn { border: none; background: none; padding: 1px; cursor: pointer; color: #d1d1d6; transition: color 0.12s; }
.star-btn:hover, .star-btn.filled { color: #ff9500; }
.star-btn.filled :deep(svg) { fill: #ff9500; }

/* Status toggle */
.status-toggle {
  display: flex; border-radius: 5px; overflow: hidden;
  border: 1px solid rgba(0,0,0,0.10);
}
.status-btn {
  padding: 2px 9px; border: none; background: white;
  font-size: 10.5px; font-weight: 500; color: #8e8e93;
  cursor: pointer; transition: background 0.12s, color 0.12s;
}
.status-btn:hover { background: rgba(0,0,0,0.04); }
.status-btn.active { background: #223F79; color: white; }

/* Tags */
.meta-tags { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.tag-chip { display: inline-flex; align-items: center; gap: 2px; padding: 2px 6px 2px 5px; background: rgba(34,63,121,0.07); color: #223F79; border-radius: 5px; font-size: 11px; font-weight: 500; white-space: nowrap; }
.tag-hash { opacity: 0.5; flex-shrink: 0; }
.tag-remove-btn { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border: none; background: transparent; color: #223F79; opacity: 0.45; cursor: pointer; padding: 0; border-radius: 3px; font-size: 13px; line-height: 1; flex-shrink: 0; transition: opacity 0.12s; }
.tag-remove-btn:hover { opacity: 0.9; }
.tag-add-btn { display: inline-flex; align-items: center; gap: 3px; border: none; background: transparent; color: #aeaeb2; border-radius: 5px; padding: 2px 5px; font-size: 11px; cursor: pointer; transition: background 0.12s, color 0.12s; }
.tag-add-btn:hover { background: rgba(0,0,0,0.05); color: #6e6e73; }
.tag-add-label { font-size: 11px; }
.tag-input-wrap { position: relative; }
.tag-input { width: 80px; height: 22px; border: 1px solid rgba(34,63,121,0.28); border-radius: 5px; padding: 0 7px; font-size: 11px; background: rgba(34,63,121,0.04); color: #1c1c1e; outline: none; font-family: inherit; }
.tag-input:focus { border-color: rgba(34,63,121,0.5); }
.tag-suggestions { position: absolute; top: calc(100% + 4px); left: 0; min-width: 130px; background: rgba(252,252,254,0.98); border: 1px solid rgba(0,0,0,0.09); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); padding: 4px; z-index: 60; display: flex; flex-direction: column; gap: 1px; }
.tag-suggestion-item { display: block; width: 100%; text-align: left; padding: 5px 9px; border-radius: 6px; border: none; background: none; font-size: 11.5px; color: #223F79; cursor: pointer; transition: background 0.10s; font-family: inherit; }
.tag-suggestion-item:hover { background: rgba(34,63,121,0.08); }

/* ── Map picker modal ─────────────────────────────────────────────────────── */
.picker-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.25);
  display: flex; align-items: center; justify-content: center;
  z-index: 200; backdrop-filter: blur(2px);
}
.picker-dialog {
  background: white; border-radius: 14px; width: 520px; height: 420px;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,0.15);
}
.picker-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid rgba(0,0,0,0.06);
}
.picker-title { font-size: 14px; font-weight: 600; color: #1c1c1e; margin: 0; }
.picker-close {
  width: 26px; height: 26px; border: none; background: transparent;
  color: #8e8e93; border-radius: 6px; display: flex; align-items: center;
  justify-content: center; cursor: pointer; transition: background 0.12s;
}
.picker-close:hover { background: rgba(0,0,0,0.06); }
.picker-search-wrap {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  border-bottom: 1px solid rgba(0,0,0,0.06); position: relative;
}
.picker-search-icon { color: #8e8e93; flex-shrink: 0; }
.picker-search-input { flex: 1; border: none; outline: none; font-size: 12.5px; color: #1c1c1e; background: transparent; }
.picker-search-input::placeholder { color: #aeaeb2; }
.picker-search-spin { color: #8e8e93; animation: copilot-spin 0.7s linear infinite; flex-shrink: 0; }
.picker-search-results { border-bottom: 1px solid rgba(0,0,0,0.06); max-height: 160px; overflow-y: auto; display: flex; flex-direction: column; }
.picker-result-item { text-align: left; padding: 7px 14px; font-size: 12px; color: #1c1c1e; border: none; background: none; cursor: pointer; line-height: 1.4; border-bottom: 1px solid rgba(0,0,0,0.04); }
.picker-result-item:last-child { border-bottom: none; }
.picker-result-item:hover { background: rgba(34,63,121,0.06); }
.picker-map { flex: 1; min-height: 0; background: #e5e7eb; }
.picker-footer { padding: 10px 16px; border-top: 1px solid rgba(0,0,0,0.06); display: flex; justify-content: flex-end; }
.picker-confirm { display: flex; align-items: center; gap: 4px; padding: 6px 14px; border-radius: 8px; border: none; background: rgba(34,63,121,0.10); color: #223F79; font-size: 12px; font-weight: 500; cursor: pointer; transition: background 0.12s; }
.picker-confirm:hover { background: rgba(34,63,121,0.18); }

/* ── Content area ─────────────────────────────────────────────────────────── */
.editor-content {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

/* WYSIWYG pane */
.wysiwyg-pane {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: #fff;
}

.wysiwyg-editor { height: 100%; }

.wysiwyg-editor :deep(.ProseMirror) {
  outline: none; min-height: 100%;
  font-size: 15px; line-height: 1.80; color: #1c1c1e;
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  padding: 24px 40px 100px;
}

.wysiwyg-editor :deep(.ProseMirror h1) { font-size: 26px; font-weight: 700; margin: 28px 0 10px; line-height: 1.25; color: #1c1c1e; letter-spacing: -0.3px; }
.wysiwyg-editor :deep(.ProseMirror h2) { font-size: 20px; font-weight: 650; margin: 22px 0 8px; color: #1c1c1e; }
.wysiwyg-editor :deep(.ProseMirror h3) { font-size: 16px; font-weight: 620; margin: 16px 0 6px; color: #2c2c2e; }
.wysiwyg-editor :deep(.ProseMirror p) { margin: 8px 0; }
.wysiwyg-editor :deep(.ProseMirror ul), .wysiwyg-editor :deep(.ProseMirror ol) { padding-left: 22px; margin: 8px 0; }
.wysiwyg-editor :deep(.ProseMirror li) { margin: 4px 0; }
.wysiwyg-editor :deep(.ProseMirror strong) { font-weight: 650; color: #1c1c1e; }
.wysiwyg-editor :deep(.ProseMirror em) { font-style: italic; color: #3c3c43; }
.wysiwyg-editor :deep(.ProseMirror s) { color: #8e8e93; }
.wysiwyg-editor :deep(.ProseMirror code) {
  background: rgba(0,0,0,0.055); padding: 2px 5px; border-radius: 4px;
  font-size: 13.5px; font-family: ui-monospace,'SF Mono',Menlo,monospace; color: #d63384;
}
.wysiwyg-editor :deep(.ProseMirror pre) {
  background: #f8f9fb; border: 1px solid rgba(0,0,0,0.07); border-radius: 10px;
  padding: 12px 14px; margin: 14px 0; overflow-x: auto;
}
.wysiwyg-editor :deep(.ProseMirror pre code) { background: none; padding: 0; font-size: 13px; color: #24292e; }
.wysiwyg-editor :deep(.ProseMirror blockquote) {
  border-left: 3px solid rgba(34,63,121,0.22); margin: 10px 0;
  padding: 4px 0 4px 14px; color: #6e6e73; background: rgba(34,63,121,0.03); border-radius: 0 6px 6px 0;
}
.wysiwyg-editor :deep(.ProseMirror img) { max-width: 100%; border-radius: 8px; margin: 8px 0; }
.wysiwyg-editor :deep(.ProseMirror hr) { border: none; border-top: 1px solid rgba(0,0,0,0.08); margin: 20px 0; }
.wysiwyg-editor :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder); color: #c7c7cc; pointer-events: none; float: left; height: 0;
}

/* Source pane */
.source-pane {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: #fafafa;
  border-right: 1px solid rgba(0,0,0,0.05);
}

.layout-edit .source-pane { border-right: none; }

.md-editor {
  min-height: 100%;
  outline: none;
  padding: 24px 40px 100px;
  font-size: 13.5px;
  line-height: 1.75;
  color: #2c2c2e;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  box-sizing: border-box;
  caret-color: #223F79;
}
.md-editor:empty::before { content: attr(data-placeholder); color: #c7c7cc; pointer-events: none; }

/* Preview pane */
.preview-pane {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: #fff;
}

.markdown-body {
  padding: 24px 40px 100px;
  font-size: 15px; line-height: 1.80; color: #1c1c1e;
}
.markdown-body :deep(h1) { font-size: 26px; font-weight: 700; margin: 28px 0 10px; letter-spacing: -0.3px; }
.markdown-body :deep(h2) { font-size: 20px; font-weight: 650; margin: 22px 0 8px; }
.markdown-body :deep(h3) { font-size: 16px; font-weight: 620; margin: 16px 0 6px; }
.markdown-body :deep(p) { margin: 8px 0; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { margin: 8px 0; padding-left: 22px; }
.markdown-body :deep(li) { margin: 4px 0; }
.markdown-body :deep(.md-code-inline) { background: rgba(0,0,0,0.055); padding: 2px 5px; border-radius: 4px; font-size: 13px; font-family: ui-monospace,'SF Mono',Menlo,Monaco,monospace; color: #d63384; }
.markdown-body :deep(.md-code-wrap) { background: #f8f9fb; border: 1px solid rgba(0,0,0,0.07); border-radius: 10px; margin: 14px 0; overflow: hidden; }
.markdown-body :deep(.md-code-header) { display: flex; align-items: center; justify-content: space-between; padding: 5px 12px 5px 14px; border-bottom: 1px solid rgba(0,0,0,0.06); background: rgba(0,0,0,0.02); }
.markdown-body :deep(.md-code-lang) { font-size: 10px; font-weight: 600; color: #8e8e93; font-family: ui-monospace,'SF Mono',Menlo,monospace; text-transform: uppercase; letter-spacing: 0.08em; }
.markdown-body :deep(.md-code-copy) { font-size: 10px; color: #8e8e93; background: transparent; border: none; cursor: pointer; padding: 2px 7px; border-radius: 4px; opacity: 0; transition: opacity 0.15s, background 0.12s; font-family: inherit; display: flex; align-items: center; gap: 3px; }
.markdown-body :deep(.md-code-wrap:hover .md-code-copy) { opacity: 1; }
.markdown-body :deep(.md-code-copy:hover) { background: rgba(0,0,0,0.06); }
.markdown-body :deep(.md-code-copy .copy-done) { display: none; color: #34c759; }
.markdown-body :deep(.md-code-copy[data-copied]) { opacity: 1; color: #34c759; }
.markdown-body :deep(.md-code-copy[data-copied] .copy-label) { display: none; }
.markdown-body :deep(.md-code-copy[data-copied] .copy-done) { display: flex; align-items: center; gap: 3px; }
.markdown-body :deep(.md-code-wrap pre) { margin: 0; padding: 12px 14px; background: transparent; overflow-x: auto; }
.markdown-body :deep(.md-code-wrap pre code) { background: none; padding: 0; font-size: 13px; font-family: ui-monospace,'SF Mono',Menlo,Monaco,monospace; color: #24292e; line-height: 1.6; }
.markdown-body :deep(blockquote) { border-left: 3px solid rgba(34,63,121,0.22); margin: 10px 0; padding: 4px 0 4px 14px; color: #6e6e73; background: rgba(34,63,121,0.03); border-radius: 0 6px 6px 0; }
.markdown-body :deep(img) { max-width: 100%; border-radius: 8px; margin: 8px 0; display: block; }
.markdown-body :deep(a) { color: #223F79; text-decoration: underline; text-decoration-color: rgba(34,63,121,0.35); }
.markdown-body :deep(a:hover) { text-decoration-color: rgba(34,63,121,0.8); }
.markdown-body :deep(hr) { border: none; border-top: 1px solid rgba(0,0,0,0.08); margin: 20px 0; }
.markdown-body :deep(table) { border-collapse: collapse; width: 100%; margin: 12px 0; }
.markdown-body :deep(th), .markdown-body :deep(td) { border: 1px solid rgba(0,0,0,0.08); padding: 7px 12px; font-size: 14px; }
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

/* Copilot ghost suggestion text */
.copilot-ghost-text { color: #b0b7c0; }

/* WYSIWYG code block (NodeView renders outside scoped CSS) */
.wysiwyg-editor .md-code-wrap { background: #f8f9fb; border: 1px solid rgba(0,0,0,0.07); border-radius: 10px; margin: 14px 0; overflow: hidden; }
.wysiwyg-editor .md-code-header { display: flex; align-items: center; justify-content: space-between; padding: 5px 12px 5px 14px; border-bottom: 1px solid rgba(0,0,0,0.06); background: rgba(0,0,0,0.02); }
.wysiwyg-editor .md-code-lang { font-size: 10px; font-weight: 600; color: #8e8e93; font-family: ui-monospace,'SF Mono',Menlo,monospace; text-transform: uppercase; letter-spacing: 0.08em; }
.wysiwyg-editor .md-code-copy { font-size: 10px; color: #8e8e93; background: transparent; border: none; cursor: pointer; padding: 2px 7px; border-radius: 4px; opacity: 0; transition: opacity 0.15s, color 0.15s; font-family: inherit; display: flex; align-items: center; gap: 3px; }
.wysiwyg-editor .md-code-wrap:hover .md-code-copy { opacity: 1; }
.wysiwyg-editor .md-code-copy:hover { background: rgba(0,0,0,0.06); }
.wysiwyg-editor .md-code-copy[data-copied] { opacity: 1; color: #34c759; }
.wysiwyg-editor .md-code-wrap pre { margin: 0; padding: 12px 14px; background: transparent; overflow-x: auto; }
.wysiwyg-editor .md-code-wrap pre code { background: none; padding: 0; font-size: 13px; font-family: ui-monospace,'SF Mono',Menlo,Monaco,monospace; }
</style>
