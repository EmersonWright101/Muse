<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { Node } from '@tiptap/core'
import { useEditor, EditorContent, VueNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { Markdown as TiptapMarkdown } from 'tiptap-markdown'
import katex from 'katex'
import MarkdownIt from 'markdown-it'
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
import Image from '@tiptap/extension-image'
import {
  Bold, Italic, Strikethrough, Code, List, ListOrdered, Quote, Minus, FileCode,
  Sparkles, Loader2, Plus, Hash, Calendar, Folder, ChevronDown,
} from 'lucide-vue-next'
import { useNotesStore } from '../../../stores/notes'
import { useNotesCopilotStore } from '../../../stores/notesCopilot'
import { useAiSettingsStore } from '../../../stores/aiSettings'
import { streamCopilotCompletion } from '../../../composables/useCopilotStream'
import { writeFile, mkdir, exists } from '@tauri-apps/plugin-fs'
import { notesDir, uploadNoteImage, resolveNoteImageUrl, initNotesImageAssetBase, randomNoteEmoji } from '../../../utils/notesStorage'

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
const store   = useNotesStore()
const copilot = useNotesCopilotStore()
const aiStore = useAiSettingsStore()

// ─── AI Copilot ──────────────────────────────────────────────────────────────

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
  function walk(node: globalThis.Node): void {
    if (placed) return
    if (node.nodeType === globalThis.Node.TEXT_NODE) {
      const len = (node as Text).length
      if (remaining <= len) {
        const range = document.createRange()
        range.setStart(node, remaining)
        range.collapse(true)
        s.removeAllRanges(); s.addRange(range)
        placed = true; return
      }
      remaining -= len; return
    }
    if (node.nodeType === globalThis.Node.ELEMENT_NODE && (node as Element).tagName === 'BR') {
      if (remaining === 0) {
        const range = document.createRange()
        range.setStartBefore(node); range.collapse(true)
        s.removeAllRanges(); s.addRange(range)
        placed = true; return
      }
      remaining -= 1; return
    }
    for (const child of Array.from(node.childNodes)) { walk(child); if (placed) return }
  }
  walk(el)
  if (!placed) {
    const range = document.createRange()
    range.selectNodeContents(el); range.collapse(false)
    s.removeAllRanges(); s.addRange(range)
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
  sel.removeAllRanges(); sel.addRange(newRange)
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
      r.setStartAfter(textNode); r.setEndAfter(textNode)
      sel.removeAllRanges(); sel.addRange(r)
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
  const match = full.match(/^([\s\S]*?[，。！？；：、…—""''【】,.!?;:.]+\s*)/)
  const chunk = match ? match[1] : full
  const remaining = full.slice(chunk.length)
  if (!remaining) { acceptSuggestion(); return }
  const chunkNode = document.createTextNode(chunk)
  _ghostSpan.parentNode?.insertBefore(chunkNode, _ghostSpan)
  _ghostSpan.textContent = remaining
  const sel = window.getSelection()
  if (sel) {
    const r = document.createRange()
    r.setStartAfter(chunkNode); r.setEndAfter(chunkNode)
    sel.removeAllRanges(); sel.addRange(r)
  }
  const text = getCleanText()
  _acceptingChunk = true; _skipBodyWatch = true
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
  const contextText = body.value.slice(Math.max(0, cursorOffset - copilot.contextChars), cursorOffset)
  if (_copilotAbort) _copilotAbort.abort()
  const ac = new AbortController()
  _copilotAbort = ac
  isGenerating.value = true
  if (!insertGhostAtCursor()) { isGenerating.value = false; _copilotAbort = null; return }
  const words = copilot.completionWords
  const system = `You are a note-writing assistant. Your job is to continue the text the user has already written. Output ONLY the NEW continuation text (max ${words} words). Do NOT repeat, echo, or restate any text that already exists. Begin your output with the very next character or word that comes after the existing text.`
  try {
    await streamCopilotCompletion(provider, modelId, contextText, system, words * 6, ac.signal, {
      onToken(token: string) { if (_ghostSpan) _ghostSpan.textContent = (_ghostSpan.textContent ?? '') + token },
    })
  } catch {
    if (!ac.signal.aborted) removeGhostSpan(false)
  }
  if (!ac.signal.aborted && _ghostSpan) {
    const raw = _ghostSpan.textContent ?? ''
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

function onEditableCompositionStart() { if (_ghostSpan) dismissSuggestion() }

function onEditableKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab' && _ghostSpan) {
    e.preventDefault(); e.stopPropagation(); acceptSuggestion(); return
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowRight' && _ghostSpan) {
    e.preventDefault(); e.stopPropagation(); acceptNextChunk(); return
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

// ─── Layout: wysiwyg (default) | source | split ──────────────────────────────
const layout = ref<'wysiwyg' | 'source' | 'split'>('wysiwyg')

// ─── WYSIWYG editor (Tiptap) ──────────────────────────────────────────────────
let _wysiwygSyncing = false

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

const lowlight = createLowlight(common)

const CustomCodeBlock = CodeBlockLowlight.configure({ lowlight }).extend({
  addNodeView() { return VueNodeViewRenderer(CodeBlockView as any) },
})

// ─── Math escape helper ───────────────────────────────────────────────────────
function _escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── MathInline node ($...$  and inline $$...$$) ──────────────────────────────
const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      latex:   { default: '', parseHTML: (el) => el.getAttribute('latex') ?? '' },
      display: { default: false, parseHTML: (el) => el.getAttribute('display') === 'true' },
    }
  },
  parseHTML() { return [{ tag: 'math-inline' }] },
  renderHTML({ node }) {
    return ['math-inline', { latex: node.attrs.latex, ...(node.attrs.display ? { display: 'true' } : {}) }]
  },
  addNodeView() {
    return ({ node }) => {
      const span = document.createElement('span')
      span.className = 'math-inline-view'
      span.setAttribute('contenteditable', 'false')
      try {
        span.innerHTML = katex.renderToString(node.attrs.latex as string, {
          displayMode: !!node.attrs.display, throwOnError: false, strict: false,
        })
      } catch { span.textContent = node.attrs.display ? `$$${node.attrs.latex}$$` : `$${node.attrs.latex}$` }
      return { dom: span }
    }
  },
  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          state.write(node.attrs.display ? `$$${node.attrs.latex}$$` : `$${node.attrs.latex}$`)
        },
        parse: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setup(md: any) {
            // inline $...$ — register first so math_display_inline can be inserted before it
            md.inline.ruler.before('escape', 'math_inline_tok', function (state: any, silent: boolean) {
              if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false
              const start = state.pos + 1
              const end = state.src.indexOf('$', start)
              if (end === -1 || end === start) return false
              if (!silent) { const t = state.push('math_inline_tok', '', 0); t.content = state.src.slice(start, end).trim() }
              state.pos = end + 1; return true
            })
            // inline $$...$$ — inserted before math_inline_tok so it takes priority
            md.inline.ruler.before('math_inline_tok', 'math_display_inline_tok', function (state: any, silent: boolean) {
              if (state.src[state.pos] !== '$' || state.src[state.pos + 1] !== '$') return false
              const start = state.pos + 2
              const end = state.src.indexOf('$$', start)
              if (end === -1) return false
              if (!silent) { const t = state.push('math_display_inline_tok', '', 0); t.content = state.src.slice(start, end).trim() }
              state.pos = end + 2; return true
            })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            md.renderer.rules.math_inline_tok = (tokens: any[], idx: number) =>
              `<math-inline latex="${_escHtml(tokens[idx].content)}"></math-inline>`
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            md.renderer.rules.math_display_inline_tok = (tokens: any[], idx: number) =>
              `<math-inline display="true" latex="${_escHtml(tokens[idx].content)}"></math-inline>`
          },
        },
      },
    }
  },
})

// ─── MathBlock node (standalone $$\nformula\n$$) ─────────────────────────────
const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { latex: { default: '', parseHTML: (el) => el.getAttribute('latex') ?? '' } }
  },
  parseHTML() { return [{ tag: 'math-block' }] },
  renderHTML({ node }) { return ['math-block', { latex: node.attrs.latex }] },
  addNodeView() {
    return ({ node }) => {
      const div = document.createElement('div')
      div.className = 'math-block-view'
      div.setAttribute('contenteditable', 'false')
      try {
        div.innerHTML = katex.renderToString(node.attrs.latex as string, {
          displayMode: true, throwOnError: false, strict: false,
        })
      } catch { div.textContent = `$$\n${node.attrs.latex}\n$$` }
      return { dom: div }
    }
  },
  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          state.write(`$$\n${node.attrs.latex}\n$$`)
          state.closeBlock(node)
        },
        parse: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setup(md: any) {
            md.block.ruler.before('fence', 'math_block_tok', function (
              state: any, startLine: number, endLine: number, silent: boolean,
            ) {
              const pos = state.bMarks[startLine] + state.tShift[startLine]
              const firstLine = state.src.slice(pos, state.eMarks[startLine]).trim()
              if (!firstLine.startsWith('$$')) return false
              if (silent) return true
              let latex = '', nextLine = startLine
              if (firstLine.length > 2) {
                latex = firstLine.slice(2).replace(/\$\$$/, '').trim()
                nextLine = startLine + 1
              } else {
                nextLine = startLine + 1
                const lines: string[] = []
                while (nextLine < endLine) {
                  const lp = state.bMarks[nextLine] + state.tShift[nextLine]
                  const line = state.src.slice(lp, state.eMarks[nextLine]).trim()
                  if (line === '$$') break
                  lines.push(state.src.slice(lp, state.eMarks[nextLine]))
                  nextLine++
                }
                latex = lines.join('\n')
                if (nextLine < endLine) nextLine++
              }
              state.line = nextLine
              const token = state.push('math_block_tok', '', 0)
              token.content = latex; token.markup = '$$'; token.map = [startLine, state.line]
              return true
            })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            md.renderer.rules.math_block_tok = (tokens: any[], idx: number) =>
              `<math-block latex="${_escHtml(tokens[idx].content)}"></math-block>\n`
          },
        },
      },
    }
  },
})

const NotesImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement('img')
      img.src = resolveNoteImageUrl(node.attrs.src)
      img.alt = node.attrs.alt ?? ''
      img.style.maxWidth = '100%'
      img.style.display = 'block'
      return {
        dom: img,
        update(updatedNode) {
          img.src = resolveNoteImageUrl(updatedNode.attrs.src)
          img.alt = updatedNode.attrs.alt ?? ''
          return true
        },
      }
    }
  },
})

// Reactive state for formatting button active status
const editorState = ref(0)

const wysiwygEditor = useEditor({
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    TiptapMarkdown.configure({ html: false, tightLists: true }),
    CustomCodeBlock,
    NotesImage.configure({ inline: true }),
    MathInline,
    MathBlock,
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
          const baseDir = await notesDir()
          const imgDir = `${baseDir}/images`
          if (!(await exists(imgDir))) await mkdir(imgDir, { recursive: true })
          await writeFile(`${imgDir}/${filename}`, bytes)
          uploadNoteImage(filename, note.value.id, bytes, mimeType).catch(() => {})
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

// Formatting actions
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
  if (val !== 'source' && wysiwygEditor.value) {
    _wysiwygSyncing = true
    wysiwygEditor.value.commands.setContent(body.value)
    _wysiwygSyncing = false
  }
})

onUnmounted(() => { wysiwygEditor.value?.destroy() })

const note = computed(() => store.activeNote!)

function syncEditorContent() {
  if (layout.value !== 'source' && wysiwygEditor.value) {
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

onMounted(() => {
  initNotesImageAssetBase()
  if (note.value) nextTick(syncEditorContent)
})

const body = computed({
  get() {
    const raw = note.value.content
    const m = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)$/)
    return m ? m[1].trimStart() : raw
  },
  set(val: string) { store.setBody(val) },
})

const md = new MarkdownIt({ html: true, breaks: true, linkify: true })

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const lang = token.info.trim() || 'plaintext'
  const validLang = hljs.getLanguage(lang) ? lang : 'plaintext'
  const highlighted = hljs.highlight(token.content, { language: validLang }).value
  const btn = `<button class="md-code-copy"><span class="copy-label">${_copySvg} 复制</span><span class="copy-done">${_checkSvg} 已复制</span></button>`
  return `<div class="md-code-wrap"><div class="md-code-header"><span class="md-code-lang">${validLang}</span>${btn}</div><pre><code class="hljs">${highlighted}</code></pre></div>`
}

md.renderer.rules.code_inline = (tokens, idx) =>
  `<code class="md-code-inline">${tokens[idx].content}</code>`

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').trim()
}

// ─── Title (direct input) ─────────────────────────────────────────────────────
const titleInputRef = ref<HTMLInputElement>()
const titleDraft = ref('')

watch(() => note.value?.id, () => {
  titleDraft.value = note.value?.title ?? ''
}, { immediate: true })

watch(() => note.value?.title, (v) => {
  if (!v && document.activeElement !== titleInputRef.value) {
    nextTick(() => titleInputRef.value?.focus())
  }
})

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
  store.setCover(randomNoteEmoji())
  triggerAutoSave()
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
    .filter(t => !existing.has(t) && (q === '' || t.toLowerCase().includes(q)))
    .slice(0, 8)
})

function startAddTag() {
  tagInputVisible.value = true
  tagSuggestionsVisible.value = true
  nextTick(() => tagInputRef.value?.focus())
}

function applyTag(tag: string) {
  if (!note.value.tags.includes(tag)) { store.setTags([...note.value.tags, tag]); triggerAutoSave() }
  tagInputValue.value = ''; tagInputVisible.value = false; tagSuggestionsVisible.value = false
}

function addTag() {
  const v = tagInputValue.value.trim()
  if (v) applyTag(v)
  else { tagInputValue.value = ''; tagInputVisible.value = false; tagSuggestionsVisible.value = false }
}

function onTagInputBlur() {
  setTimeout(() => { tagInputVisible.value = false; tagSuggestionsVisible.value = false; tagInputValue.value = '' }, 150)
}

function removeTag(tag: string) { store.setTags(note.value.tags.filter(t => t !== tag)); triggerAutoSave() }

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

    // 1. Protect code blocks
    const codeBlocks: string[] = []
    let protectedMd = fixed.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match)
      return `<!--CODE_BLOCK_${codeBlocks.length - 1}-->`
    })

    // 2. Protect inline code
    const inlineCodes: string[] = []
    protectedMd = protectedMd.replace(/`[^`]+`/g, (match) => {
      inlineCodes.push(match)
      return `<!--INLINE_CODE_${inlineCodes.length - 1}-->`
    })

    // 3. Protect display math $$...$$
    const displayMaths: string[] = []
    protectedMd = protectedMd.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
      displayMaths.push(tex.trim())
      return `<!--DISPLAY_MATH_${displayMaths.length - 1}-->`
    })

    // 4. Protect inline math $...$ (manual scan for compatibility)
    const inlineMaths: string[] = []
    let mi = 0
    while (mi < protectedMd.length) {
      const start = protectedMd.indexOf('$', mi)
      if (start === -1) break
      if (protectedMd[start + 1] === '$') { mi = start + 2; continue }
      const end = protectedMd.indexOf('$', start + 1)
      if (end === -1) break
      if (protectedMd[end + 1] === '$') { mi = end + 2; continue }
      const tex = protectedMd.slice(start + 1, end).trim()
      inlineMaths.push(tex)
      const ph = `<!--INLINE_MATH_${inlineMaths.length - 1}-->`
      protectedMd = protectedMd.slice(0, start) + ph + protectedMd.slice(end + 1)
      mi = start + ph.length
    }

    // 5. Render markdown
    let html = md.render(protectedMd)

    // 6. Restore display math with KaTeX
    html = html.replace(/<!--DISPLAY_MATH_(\d+)-->/g, (_, idx) => {
      try {
        return katex.renderToString(displayMaths[+idx], { displayMode: true, throwOnError: false, strict: false })
      } catch {
        return `<code>$$${displayMaths[+idx]}$$</code>`
      }
    })

    // 7. Restore inline math with KaTeX
    html = html.replace(/<!--INLINE_MATH_(\d+)-->/g, (_, idx) => {
      try {
        return katex.renderToString(inlineMaths[+idx], { displayMode: false, throwOnError: false, strict: false })
      } catch {
        return `<code>$${inlineMaths[+idx]}$</code>`
      }
    })

    // 8. Restore code blocks
    html = html.replace(/<!--CODE_BLOCK_(\d+)-->/g, (_, idx) => md.render(codeBlocks[+idx]))

    // 9. Restore inline code
    html = html.replace(/<!--INLINE_CODE_(\d+)-->/g, (_, idx) => md.renderInline(inlineCodes[+idx]))

    // 10. Resolve image URLs
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    tmp.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src')
      if (src) img.src = resolveNoteImageUrl(src)
    })
    return tmp.innerHTML
  } catch { return content }
}

const previewHtml = computed(() => renderMarkdown(body.value))

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
watch(() => body.value, (val) => {
  if (_skipBodyWatch) return
  const el = editableRef.value
  if (!el) return
  const cur = el.innerText.replace(/\n$/, '')
  if (cur !== val) {
    if (_ghostSpan) removeGhostSpan(false)
    const focused = document.activeElement === el
    const offset = focused ? getBodyCursorOffset() : -1
    el.innerText = val
    if (focused && offset >= 0) nextTick(() => setBodyCursorOffset(offset))
  }
}, { flush: 'sync' })
watch(() => note.value.title, triggerAutoSave)
watch(() => note.value.date, triggerAutoSave)
watch(() => note.value.groupId, triggerAutoSave)
watch(() => note.value.cover, triggerAutoSave)
watch(() => note.value.tags, triggerAutoSave, { deep: true })

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); store.saveActive() }
}

async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of Array.from(items)) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const ext = item.type === 'image/jpeg' ? 'jpg' : item.type.replace('image/', '')
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    const baseDir = await notesDir()
    const imgDir = `${baseDir}/images`
    if (!(await exists(imgDir))) await mkdir(imgDir, { recursive: true })
    await writeFile(`${imgDir}/${filename}`, bytes)
    uploadNoteImage(filename, note.value.id, bytes, item.type).catch(() => {})
    const mdText = `![${filename}](images/${filename})`
    const offset = getBodyCursorOffset()
    const newBody = body.value.slice(0, offset) + mdText + body.value.slice(offset)
    const el = editableRef.value
    _skipBodyWatch = true
    body.value = newBody
    if (el) el.innerText = newBody
    const newOffset = offset + mdText.length
    nextTick(() => { _skipBodyWatch = false; el?.focus(); setBodyCursorOffset(newOffset) })
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
  range.setStartAfter(node); range.setEndAfter(node)
  sel.removeAllRanges(); sel.addRange(range)
  const newText = getCleanText()
  _skipBodyWatch = true
  body.value = newText
  nextTick(() => { _skipBodyWatch = false })
}

// ─── Split-mode synchronized scrolling ───────────────────────────────────────
// Only sync from the pane the user's pointer is over, so programmatic scroll
// events on the destination pane are ignored and can't bounce back.
const sourcePaneRef = ref<HTMLDivElement>()
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

initNotesImageAssetBase()
</script>

<template>
  <div class="notes-editor" @keydown="onKeydown">

    <!-- ── Toolbar ──────────────────────────────────────────────────────────── -->
    <div class="editor-toolbar">

      <!-- Formatting buttons (WYSIWYG / split mode) -->
      <div class="fmt-group" :class="{ hidden: layout === 'source' }">
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

      <!-- Spacer when in source mode -->
      <div v-if="layout === 'source'" class="fmt-source-label">
        {{ t('notes.sourceMode') }}
      </div>

      <div class="toolbar-right">
        <!-- Copilot hint / save status -->
        <span v-if="hasGhostSuggestion" class="copilot-hint">
          <kbd>Tab</kbd> {{ t('notes.copilot.accept') }} &middot;
          <kbd>⌘→</kbd> {{ t('notes.copilot.acceptWord') }} &middot;
          <kbd>Esc</kbd> {{ t('notes.copilot.dismiss') }}
        </span>
        <span v-else-if="autoSaveStatus === 'saving'" class="save-status">{{ t('notes.saving') }}</span>
        <span v-else-if="autoSaveStatus === 'saved'" class="save-status saved">{{ t('notes.saved') }}</span>

        <!-- Mode switch -->
        <div class="mode-switch">
          <button class="mode-btn" :class="{ active: layout === 'wysiwyg' }" :title="t('notes.wysiwygMode')" @click="layout = 'wysiwyg'">{{ t('notes.wysiwygMode') }}</button>
          <button class="mode-btn" :class="{ active: layout === 'split' }" :title="t('notes.splitMode')" @click="layout = 'split'">{{ t('notes.splitMode') }}</button>
          <button class="mode-btn" :class="{ active: layout === 'source' }" :title="t('notes.sourceMode')" @click="layout = 'source'">{{ t('notes.sourceMode') }}</button>
        </div>

        <!-- Copilot -->
        <div class="copilot-wrap" @click.stop>
          <button
            class="copilot-btn"
            :class="{ active: copilot.enabled, generating: isGenerating }"
            :title="t('notes.copilot.label')"
            @click.stop="showCopilotSettings = !showCopilotSettings"
          >
            <Loader2 v-if="isGenerating" :size="14" />
            <Sparkles v-else :size="13" />
          </button>
          <div v-if="showCopilotSettings" class="copilot-panel">
            <label class="copilot-toggle-row">
              <span class="copilot-panel-title">{{ t('notes.copilot.label') }}</span>
              <input type="checkbox" class="copilot-checkbox" :checked="copilot.enabled" @change="copilot.setEnabled(($event.target as HTMLInputElement).checked)" />
            </label>
            <template v-if="copilot.enabled">
              <div class="copilot-row">
                <span class="copilot-label">{{ t('notes.copilot.provider') }}</span>
                <select class="copilot-select" :value="copilot.providerId" @change="copilot.setProvider(($event.target as HTMLSelectElement).value)">
                  <option value="" disabled>{{ t('notes.copilot.selectProvider') }}</option>
                  <option v-for="p in configuredProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </div>
              <div class="copilot-row">
                <span class="copilot-label">{{ t('notes.copilot.model') }}</span>
                <select class="copilot-select" :value="copilot.modelId" @change="copilot.setModel(($event.target as HTMLSelectElement).value)">
                  <option value="" disabled>{{ t('notes.copilot.selectModel') }}</option>
                  <option v-for="m in copilotProviderModels" :key="m.id" :value="m.id">{{ m.name }}</option>
                </select>
              </div>
              <div class="copilot-row">
                <span class="copilot-label">{{ t('notes.copilot.words') }}</span>
                <input type="number" class="copilot-number" :value="copilot.completionWords" min="1" max="100" @change="copilot.setWords(Number(($event.target as HTMLInputElement).value))" />
              </div>
              <div class="copilot-row">
                <span class="copilot-label">{{ t('notes.copilot.delay') }}</span>
                <div class="copilot-delay-wrap">
                  <input type="number" class="copilot-number" :value="copilot.triggerDelay" min="200" max="5000" step="100" @change="copilot.setDelay(Number(($event.target as HTMLInputElement).value))" />
                  <span class="copilot-unit">ms</span>
                </div>
              </div>
              <div class="copilot-row">
                <span class="copilot-label">{{ t('notes.copilot.context') }}</span>
                <div class="copilot-delay-wrap">
                  <input type="number" class="copilot-number copilot-number--wide" :value="copilot.contextChars" min="200" max="10000" step="200" @change="copilot.setContext(Number(($event.target as HTMLInputElement).value))" />
                  <span class="copilot-unit">{{ t('notes.copilot.chars') }}</span>
                </div>
              </div>
            </template>
          </div>
        </div>

        <button class="save-btn" @click="store.saveActive()">{{ t('common.save') }}</button>
      </div>
    </div>

    <!-- ── Document header (cover + title + meta) ───────────────────────────── -->
    <div class="doc-header">
      <div class="doc-inner">
        <div class="title-row">
          <button class="cover-btn" :title="t('notes.changeCover')" @click="changeCoverEmoji">
            <span v-if="isCoverEmoji" class="cover-emoji">{{ note.cover }}</span>
            <span v-else class="cover-emoji cover-emoji--default">📝</span>
          </button>
          <input
            ref="titleInputRef"
            v-model="titleDraft"
            class="title-input"
            :placeholder="t('notes.titlePlaceholder')"
            @keydown.enter.prevent="confirmTitle(); ($event.target as HTMLInputElement).blur()"
            @blur="confirmTitle"
          />
        </div>

        <div class="doc-meta">
          <div class="meta-item">
            <Calendar :size="11" class="meta-icon" />
            <input v-model="note.date" type="date" class="meta-date-input" @input="store.setDate(note.date)" />
          </div>
          <span class="meta-dot">·</span>
          <div class="meta-item">
            <Folder :size="11" class="meta-icon" />
            <div class="meta-select-wrap">
              <select :value="note.groupId" class="meta-group-select" @change="store.setGroupId(($event.target as HTMLSelectElement).value)">
                <option value="">{{ t('notes.noGroup') }}</option>
                <option v-for="g in store.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
              </select>
              <ChevronDown :size="9" class="meta-select-chevron" />
            </div>
          </div>
          <span class="meta-dot">·</span>
          <div class="meta-tags">
            <span v-for="tag in note.tags" :key="tag" class="tag-chip">
              <Hash :size="9" class="tag-hash" />{{ tag }}
              <button class="tag-remove-btn" @mousedown.prevent="removeTag(tag)">×</button>
            </span>
            <div v-if="tagInputVisible" class="tag-input-wrap">
              <input ref="tagInputRef" v-model="tagInputValue" class="tag-input" :placeholder="t('notes.tagPlaceholder')" @keydown.enter.prevent="addTag" @keydown.escape="tagInputVisible = false; tagSuggestionsVisible = false; tagInputValue = ''" @blur="onTagInputBlur" />
              <div v-if="tagSuggestionsVisible && tagSuggestions.length" class="tag-suggestions">
                <button v-for="sug in tagSuggestions" :key="sug" class="tag-suggestion-item" @mousedown.prevent="applyTag(sug)">#{{ sug }}</button>
              </div>
            </div>
            <button v-else class="tag-add-btn" :title="t('notes.tags')" @click="startAddTag">
              <Plus :size="10" />
              <span v-if="note.tags.length === 0" class="tag-add-label">{{ t('notes.tags') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Content area ──────────────────────────────────────────────────────── -->
    <div class="editor-content" :class="`layout-${layout}`">

      <!-- WYSIWYG pane (default) -->
      <div v-show="layout === 'wysiwyg'" class="wysiwyg-pane">
        <EditorContent :editor="wysiwygEditor" class="wysiwyg-editor" />
      </div>

      <!-- Source / split: raw markdown -->
      <div ref="sourcePaneRef" v-show="layout !== 'wysiwyg'" class="source-pane" @scroll="onSourceScroll" @pointerenter="setScrollSource" @pointerleave="clearScrollPane">
        <div
          ref="editableRef"
          class="md-editor"
          contenteditable="true"
          spellcheck="false"
          :data-placeholder="t('notes.editorPlaceholder')"
          @input="onEditableInput"
          @beforeinput="onEditableBeforeInput"
          @compositionstart="onEditableCompositionStart"
          @keydown="onEditableKeydown"
          @paste.prevent="onPaste"
        />
      </div>

      <!-- Split: rendered preview -->
      <div ref="previewPaneRef" v-show="layout === 'split'" class="preview-pane" @scroll="onPreviewScroll" @pointerenter="setScrollPreview" @pointerleave="clearScrollPane">
        <div class="markdown-body" v-html="previewHtml" @click="onPreviewClick" />
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ── Root ─────────────────────────────────────────────────────────────────── */
.notes-editor {
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
}

/* Formatting button group */
.fmt-group {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.fmt-group.hidden {
  visibility: hidden;
  pointer-events: none;
}

.fmt-source-label {
  flex: 1;
  font-size: 11.5px;
  font-weight: 500;
  color: #8e8e93;
  padding-left: 4px;
}

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

.fmt-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #1c1c1e;
}

.fmt-btn.active {
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
}

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

/* Toolbar right */
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
  padding: 20px 0 16px;
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
  margin-bottom: 14px;
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

.doc-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.meta-dot { font-size: 11px; color: #c7c7cc; flex-shrink: 0; }
.meta-item { display: flex; align-items: center; gap: 4px; }
.meta-icon { color: #aeaeb2; flex-shrink: 0; }
.meta-date-input { border: none; background: transparent; outline: none; font-size: 11.5px; color: #6e6e73; cursor: pointer; font-family: inherit; padding: 0; }
.meta-date-input:hover { color: #3c3c43; }
.meta-select-wrap { position: relative; display: flex; align-items: center; }
.meta-group-select { border: none; background: transparent; outline: none; font-size: 11.5px; color: #6e6e73; cursor: pointer; font-family: inherit; appearance: none; -webkit-appearance: none; padding-right: 14px; }
.meta-group-select:hover { color: #3c3c43; }
.meta-select-chevron { position: absolute; right: 0; color: #aeaeb2; pointer-events: none; }

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

.wysiwyg-editor {
  height: 100%;
}

.wysiwyg-editor :deep(.ProseMirror) {
  outline: none;
  min-height: 100%;
  font-size: 15px;
  line-height: 1.80;
  color: #1c1c1e;
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

/* Source pane (raw markdown) */
.source-pane {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: #fafafa;
  border-right: 1px solid rgba(0, 0, 0, 0.05);
}

.layout-source .source-pane { border-right: none; }

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

.md-editor:empty::before {
  content: attr(data-placeholder);
  color: #c7c7cc;
  pointer-events: none;
}

/* Preview pane (split right) */
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
.markdown-body :deep(strong) { font-weight: 650; color: #1c1c1e; }
.markdown-body :deep(em) { font-style: italic; color: #3c3c43; }
</style>

<style>
/* ── highlight.js ─────────────────────────────────────────────────────────── */
.hljs-keyword, .hljs-selector-tag, .hljs-built_in { color: #d63384; }
.hljs-string, .hljs-attr { color: #032f62; }
.hljs-comment { color: #6a737d; font-style: italic; }
.hljs-number, .hljs-literal { color: #005cc5; }
.hljs-title, .hljs-section { color: #6f42c1; }
.hljs-variable, .hljs-template-variable { color: #e36209; }
.hljs-tag, .hljs-name { color: #22863a; }
.hljs-type { color: #6f42c1; }
.hljs-meta { color: #999; }

/* Copilot ghost */
.copilot-ghost-text { color: #b0b7c0; }

/* Math node views */
.math-inline-view {
  display: inline;
  vertical-align: middle;
  cursor: default;
  user-select: none;
}
.math-inline-view.ProseMirror-selectednode { outline: 2px solid rgba(34,63,121,0.35); border-radius: 3px; }

.math-block-view {
  display: block;
  text-align: center;
  padding: 12px 0;
  cursor: default;
  user-select: none;
  overflow-x: auto;
}
.math-block-view.ProseMirror-selectednode { outline: 2px solid rgba(34,63,121,0.35); border-radius: 6px; }

/* WYSIWYG code block NodeView */
.wysiwyg-editor .md-code-wrap { background: #f8f9fb; border: 1px solid rgba(0,0,0,0.07); border-radius: 10px; margin: 14px 0; overflow: hidden; }
.wysiwyg-editor .md-code-header { display: flex; align-items: center; justify-content: space-between; padding: 5px 12px 5px 14px; border-bottom: 1px solid rgba(0,0,0,0.06); background: rgba(0,0,0,0.02); }
.wysiwyg-editor .md-code-lang { font-size: 10px; font-weight: 600; color: #8e8e93; font-family: ui-monospace,'SF Mono',Menlo,monospace; text-transform: uppercase; letter-spacing: 0.08em; }
.wysiwyg-editor .md-code-copy { font-size: 10px; color: #8e8e93; background: transparent; border: none; cursor: pointer; padding: 2px 7px; border-radius: 4px; opacity: 0; transition: opacity 0.15s, color 0.15s; font-family: inherit; display: flex; align-items: center; gap: 3px; }
.wysiwyg-editor .md-code-wrap:hover .md-code-copy { opacity: 1; }
.wysiwyg-editor .md-code-copy:hover { background: rgba(0,0,0,0.06); }
.wysiwyg-editor .md-code-copy[data-copied] { opacity: 1; color: #34c759; }
.wysiwyg-editor .md-code-wrap pre { margin: 0; padding: 12px 14px; background: transparent; overflow-x: auto; }
.wysiwyg-editor .md-code-wrap pre code { background: none; padding: 0; font-size: 13px; font-family: ui-monospace,'SF Mono',Menlo,Monaco,monospace; line-height: 1.6; }
</style>
