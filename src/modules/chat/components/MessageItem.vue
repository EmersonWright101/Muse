<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { marked, type Tokens } from 'marked'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import java from 'highlight.js/lib/languages/java'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'
import csharp from 'highlight.js/lib/languages/csharp'
import bash from 'highlight.js/lib/languages/bash'
import shell from 'highlight.js/lib/languages/shell'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import markdown from 'highlight.js/lib/languages/markdown'
import yaml from 'highlight.js/lib/languages/yaml'
import plaintext from 'highlight.js/lib/languages/plaintext'
import kotlin from 'highlight.js/lib/languages/kotlin'
import swift from 'highlight.js/lib/languages/swift'
import ruby from 'highlight.js/lib/languages/ruby'
import php from 'highlight.js/lib/languages/php'
import r from 'highlight.js/lib/languages/r'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('java', java)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c++', cpp)
hljs.registerLanguage('c', c)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('cs', csharp)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', shell)
hljs.registerLanguage('json', json)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('plaintext', plaintext)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('swift', swift)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('rb', ruby)
hljs.registerLanguage('php', php)
hljs.registerLanguage('r', r)
import DOMPurify from 'dompurify'
import { Copy, Check, Pencil, RefreshCw, FileText, ChevronDown, Maximize2, Minimize2, Bot, AtSign, Download, Clock, ThumbsUp, ThumbsDown, Trash2, Rows3, Columns2, Globe } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { ChatMessage } from '../../../stores/chat'
import { useChatStore } from '../../../stores/chat'
import { useAiSettingsStore } from '../../../stores/aiSettings'

const props = defineProps<{ message: ChatMessage; streaming?: boolean }>()

const chat = useChatStore()
const ai   = useAiSettingsStore()
const { t } = useI18n()

// ─── Copy + edit ─────────────────────────────────────────────────────────────

const copyDone  = ref(false)
const copyDoneSlot = ref<number | null>(null)
const isEditing = ref(false)
const editText  = ref('')

async function copyContent() {
  await navigator.clipboard.writeText(props.message.content).catch(() => {})
  copyDone.value = true
  setTimeout(() => { copyDone.value = false }, 2000)
}

async function copySlotContent(msg: typeof props.message, idx: number) {
  const text = slotContent(msg, idx)
  await navigator.clipboard.writeText(text).catch(() => {})
  copyDoneSlot.value = idx
  setTimeout(() => { copyDoneSlot.value = null }, 2000)
}

function startEdit() {
  editText.value  = props.message.content
  isEditing.value = true
}

async function confirmEdit() {
  if (!editText.value.trim()) return
  isEditing.value = false
  if (props.message.role === 'user') {
    await chat.editAndResend(props.message.id, editText.value)
  } else {
    await chat.editMessage(props.message.id, editText.value)
  }
}

function cancelEdit() {
  isEditing.value = false
}

// ─── Markdown setup ───────────────────────────────────────────────────────────

const renderer = new marked.Renderer()

renderer.code = ({ text, lang }: Tokens.Code) => {
  const validLang = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
  const highlighted = hljs.highlight(text, { language: validLang }).value
  return `<div class="code-block"><div class="code-header"><span class="code-lang">${validLang}</span><button class="copy-btn" onclick="this.closest('.code-block').querySelector('code').dispatchEvent(new CustomEvent('copy-code',{bubbles:true}));this.textContent='已复制';setTimeout(()=>this.textContent='复制',2000)">复制</button></div><pre><code class="hljs ${validLang}">${highlighted}</code></pre></div>`
}

renderer.codespan = ({ text }: Tokens.Codespan) =>
  `<code class="inline-code">${text}</code>`

const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`
const DOWNLOAD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

renderer.image = ({ href, text }: Tokens.Image) => {
  const safeHref = escapeHtmlAttr(href)
  const safeText = escapeHtmlAttr(text)
  return `<span class="markdown-img-wrap" style="display:inline-block;vertical-align:bottom;position:relative;width:min(480px,100%)"><img src="${safeHref}" alt="${safeText}" class="markdown-img" style="display:block;width:100%;height:auto;max-height:520px;border-radius:12px;cursor:zoom-in;object-fit:contain" /><button class="markdown-copy-btn" data-action="copy-image" data-src="${safeHref}" title="复制图片">${COPY_SVG}</button><button class="markdown-download-btn" data-action="download-image" data-src="${safeHref}" title="下载原图">${DOWNLOAD_SVG}</button></span>`
}

renderer.link = ({ href, title, text }: Tokens.Link) => {
  const safeHref = escapeHtmlAttr(href)
  const safeTitle = title ? ` title="${escapeHtmlAttr(title)}"` : ''
  return `<a data-action="open-url" data-href="${safeHref}"${safeTitle} class="markdown-link">${text}</a>`
}

marked.setOptions({ renderer, breaks: true })

function renderMarkdown(content: string): string {
  try {
    const raw = marked.parse(content) as string
    if (typeof raw !== 'string') return content
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['onclick', 'data-action', 'data-src', 'data-href', 'title'] })
  } catch {
    return content
  }
}

// ─── Rendered content: computed directly from props.message.content ───────────
// assistantMsg in the store is reactive(), so content mutations are tracked
// automatically and this computed re-evaluates on every token.

const msgEl = ref<HTMLElement>()

const renderedContent = computed(() =>
  props.message.role === 'user' ? '' : renderMarkdown(displayedContent.value)
)

onMounted(() => {
  msgEl.value?.addEventListener('copy-code', (e: Event) => {
    const code = (e.target as HTMLElement).textContent ?? ''
    navigator.clipboard.writeText(code).catch(() => {})
  })
})

// ─── Avatar ───────────────────────────────────────────────────────────────────

const isUser = computed(() => props.message.role === 'user')

// Auto-discover model SVGs from assets/models/*.svg via Vite glob.
// Each module's .default is the resolved asset URL (same as a plain SVG import).
// Adding a new <name>.svg to that folder is all that's needed to support a new model.
const modelSvgModules = import.meta.glob<{ default: string }>('/src/assets/models/*.svg', { eager: true })

function buildSvgMap(modules: Record<string, { default: string }>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [path, mod] of Object.entries(modules)) {
    map[path.replace(/^.*\//, '').replace(/\.svg$/, '')] = mod.default
  }
  return map
}

// Helper: look up SVG URL for any model/provider pair
function lookupLogoUrl(model: string, providerId: string): string | null {
  const mid = model.toLowerCase()
  const pid = providerId.toLowerCase()
  const svgMap = buildSvgMap(modelSvgModules)
  // GPT-* models (e.g. gpt-image-2) are OpenAI models even when served through other providers
  if (mid.startsWith('gpt-')) {
    const openaiSvg = svgMap['openai']
    if (openaiSvg) return openaiSvg
  }
  for (const name of Object.keys(svgMap)) { if (mid.includes(name)) return svgMap[name] }
  for (const name of Object.keys(svgMap)) { if (pid.includes(name)) return svgMap[name] }
  return null
}


const modelLogoUrl = computed<string | null>(() =>
  lookupLogoUrl(displayedModel.value, displayedProviderId.value)
)


const providerDisplayName = computed(() =>
  ai.providers.find(p => p.id === displayedProviderId.value)?.name ?? ''
)

// ─── Variants (multi-model responses) ────────────────────────────────────────

// The currently displayed response: idx 0 = original message, 1+ = variants[idx-1]
const activeVariantIdx = computed(() => props.message.activeVariantIdx ?? 0)

// ─── Variant context menu ────────────────────────────────────────────────────
const variantMenuOpen = ref(false)
const variantMenuIdx = ref(0)
const variantMenuPos = ref({ x: 0, y: 0 })

function openVariantMenu(e: MouseEvent, idx: number) {
  variantMenuIdx.value = idx
  variantMenuPos.value = { x: e.clientX, y: e.clientY }
  variantMenuOpen.value = true
}

function closeVariantMenu() {
  variantMenuOpen.value = false
}

function confirmDeleteVariant() {
  const idx = variantMenuIdx.value
  if (confirm('确定要删除这个模型的回答吗？')) {
    chat.deleteVariant(props.message.id, idx)
  }
  variantMenuOpen.value = false
}

onMounted(() => document.addEventListener('click', closeVariantMenu))
onUnmounted(() => document.removeEventListener('click', closeVariantMenu))

const activeVariantData = computed(() => {
  const idx = activeVariantIdx.value
  if (idx === 0 || !props.message.variants?.length) return null
  return props.message.variants[idx - 1] ?? null
})

// All "slots": [{model, providerId}] — original first, then each variant
const allVariantSlots = computed(() => {
  const orig = [{ model: props.message.model ?? '', providerId: props.message.providerId ?? '' }]
  const extras = (props.message.variants ?? []).map(v => ({ model: v.model, providerId: v.providerId }))
  return [...orig, ...extras]
})

// Content / model / usage shown in the bubble come from the active slot
const displayedModel      = computed(() => activeVariantData.value?.model      ?? props.message.model      ?? '')
const displayedProviderId = computed(() => activeVariantData.value?.providerId ?? props.message.providerId ?? '')
const displayedContent    = computed(() => activeVariantData.value?.content    ?? props.message.content    ?? '')
const displayedUsage      = computed(() => activeVariantData.value?.usage      ?? props.message.usage)
const displayedReasoning  = computed(() => {
  const idx = activeVariantIdx.value
  if (idx === 0 || !props.message.variants?.length) return props.message.reasoning
  return activeVariantData.value?.reasoning
})
const displayedError      = computed(() => activeVariantData.value?.error      ?? props.message.error)
const displayedFeedback   = computed(() => activeVariantData.value?.feedback   ?? props.message.feedback   ?? null)

// Short display name: strip provider prefix
const modelDisplayName = computed(() => {
  const raw   = displayedModel.value
  const slash = raw.indexOf('/')
  return slash > 0 ? raw.slice(slash + 1) : raw
})

// ─── Layout mode (tab | horizontal) ──────────────────────────────────────────
// Persisted globally in localStorage so all messages share the same preference.

const LAYOUT_LS_KEY = 'muse-variant-layout'
const variantLayout = ref<'tab' | 'horizontal'>(
  (localStorage.getItem(LAYOUT_LS_KEY) as 'tab' | 'horizontal') ?? 'tab'
)

function toggleLayout() {
  variantLayout.value = variantLayout.value === 'tab' ? 'horizontal' : 'tab'
  localStorage.setItem(LAYOUT_LS_KEY, variantLayout.value)
  localStorage.setItem('muse-variant-layout-modified-at', new Date().toISOString())
}

// Per-slot streaming detection
function isSlotStreaming(msgId: string, slotIdx: number): boolean {
  if (slotIdx === 0) return chat.streamingMsgId === msgId
  return chat.streamingVariantMsgIds.has(msgId)
}

// Whether the currently-active tab/slot is streaming (used for bubble animation + button visibility)
const activeSlotStreaming = computed(() => isSlotStreaming(props.message.id, activeVariantIdx.value))

// Per-slot feedback getter/setter for horizontal mode
function slotFeedback(msg: typeof props.message, slotIdx: number): 'positive' | 'negative' | null {
  if (slotIdx === 0) return msg.feedback ?? null
  return msg.variants?.[slotIdx - 1]?.feedback ?? null
}

function setSlotFeedback(msgId: string, slotIdx: number, fb: 'positive' | 'negative' | null) {
  chat.setVariantFeedbackBySlot(msgId, slotIdx, fb)
}

function slotContent(msg: typeof props.message, slotIdx: number): string {
  return slotIdx === 0 ? (msg.content ?? '') : (msg.variants?.[slotIdx - 1]?.content ?? '')
}

function slotReasoning(msg: typeof props.message, slotIdx: number): string | undefined {
  return slotIdx === 0 ? msg.reasoning : msg.variants?.[slotIdx - 1]?.reasoning
}

function slotUsage(msg: typeof props.message, slotIdx: number) {
  return slotIdx === 0 ? msg.usage : msg.variants?.[slotIdx - 1]?.usage
}

function slotError(msg: typeof props.message, slotIdx: number): boolean {
  return slotIdx === 0 ? !!msg.error : !!(msg.variants?.[slotIdx - 1]?.error)
}

function slotMediaOutputs(msg: typeof props.message, slotIdx: number) {
  return slotIdx === 0 ? msg.mediaOutputs : msg.variants?.[slotIdx - 1]?.mediaOutputs
}

// Media outputs for the currently active tab (slot 0 = primary, slots 1+ = variants)
const displayedMediaOutputs = computed(() =>
  activeVariantData.value?.mediaOutputs ?? props.message.mediaOutputs
)

// ─── @ Model picker ───────────────────────────────────────────────────────────

const pickerOpen = ref(false)
const pickerRoot = ref<HTMLElement>()

function togglePicker() { pickerOpen.value = !pickerOpen.value }

function selectModelForVariant(providerId: string, modelId: string) {
  pickerOpen.value = false
  chat.regenerateWithModel(props.message.id, providerId, modelId)
}

function handleOutside(e: MouseEvent) {
  if (pickerRoot.value && !pickerRoot.value.contains(e.target as Node)) pickerOpen.value = false
}

onMounted(()    => document.addEventListener('mousedown', handleOutside))
onUnmounted(()  => document.removeEventListener('mousedown', handleOutside))

const configuredProviders = computed(() => ai.configuredProviders())

// ─── Reasoning collapse ───────────────────────────────────────────────────────

type ReasoningView = 'collapsed' | 'preview' | 'expanded'
const reasoningView = ref<ReasoningView>('preview')

function countWords(text: string): number {
  const matches = text.match(/[\u4e00-\u9fff]|[a-zA-Z0-9]+/g)
  return matches ? matches.length : 0
}

const reasoningWordCount = computed(() => countWords(displayedReasoning.value || ''))

// ─── Media lightbox ───────────────────────────────────────────────────────────

const lightboxSrc = ref<string | null>(null)

function openLightbox(mimeType: string, data: string) {
  lightboxSrc.value = `data:${mimeType};base64,${data}`
}

function openLightboxUrl(url: string) {
  lightboxSrc.value = url
}

const saveToast = ref('')
let _saveToastTimer: ReturnType<typeof setTimeout> | null = null

async function copyImageToClipboard(src: string) {
  try {
    let blob: Blob
    if (src.startsWith('data:')) {
      const [header, b64] = src.split(',')
      const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png'
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      blob = new Blob([bytes], { type: mime })
    } else {
      blob = await fetch(src).then(r => r.blob())
    }
    // Always write as image/png — required by Clipboard API
    let pngBlob = blob
    if (blob.type !== 'image/png') {
      const bmp = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bmp.width
      canvas.height = bmp.height
      canvas.getContext('2d')!.drawImage(bmp, 0, 0)
      pngBlob = await new Promise<Blob>(res => canvas.toBlob(b => res(b!), 'image/png'))
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
    showSaveToast('图片已复制到剪贴板')
  } catch {
    showSaveToast('复制失败，请尝试下载')
  }
}

async function onMarkdownBodyClick(e: MouseEvent) {
  const target = e.target as HTMLElement

  // Link: open in system browser
  const link = target.closest('a[data-action="open-url"]') as HTMLElement | null
  if (link) {
    e.preventDefault()
    e.stopPropagation()
    const url = link.dataset.href
    if (url) {
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener')
        await openUrl(url)
      } catch { /* ignore */ }
    }
    return
  }

  const btn = target.closest('button[data-action]') as HTMLButtonElement | null
  if (btn) {
    e.preventDefault()
    e.stopPropagation()
    const src = btn.dataset.src
    if (!src) return
    if (btn.dataset.action === 'copy-image') {
      copyImageToClipboard(src)
    } else if (btn.dataset.action === 'download-image') {
      downloadImage(src)
    }
    return
  }
  const img = target.closest('img') as HTMLImageElement | null
  if (img && img.closest('.markdown-img-wrap')) {
    openLightboxUrl(img.src)
  }
}

async function downloadImage(src: string, filename = 'muse-image.png') {
  // Convert src to Uint8Array
  let bytes: Uint8Array
  if (src.startsWith('data:')) {
    const b64 = src.split(',')[1]
    const bin = atob(b64)
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  } else {
    const buf = await fetch(src).then(r => r.arrayBuffer())
    bytes = new Uint8Array(buf)
  }

  try {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')

    const savePath = await save({
      defaultPath: filename,
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'webp'] }],
    })
    if (!savePath) return  // user cancelled

    await writeFile(savePath, bytes)
    showSaveToast('已保存')
  } catch {
    // Fallback: data-URL download (works for most cases)
    const a = document.createElement('a')
    a.href = src.startsWith('data:') ? src : URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer]))
    a.download = filename
    a.click()
    showSaveToast('已保存到下载文件夹')
  }
}

function showSaveToast(msg: string) {
  saveToast.value = msg
  if (_saveToastTimer) clearTimeout(_saveToastTimer)
  _saveToastTimer = setTimeout(() => { saveToast.value = '' }, 2500)
}

// ─── PDF preview ─────────────────────────────────────────────────────────────

const pdfPreviewSrc = ref<string | null>(null)

function openPdfPreview(att: { mimeType: string; data?: string; name: string }) {
  if (att.data) pdfPreviewSrc.value = `data:application/pdf;base64,${att.data}`
}

// ─── Web search results panel ─────────────────────────────────────────────────

const searchResultsOpen = ref(false)

async function openResultUrl(url: string) {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } catch { /* ignore */ }
}

function resultDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}
</script>

<template>
  <!-- Save toast -->
  <Teleport to="body">
    <div v-if="saveToast" class="save-toast">{{ saveToast }}</div>
  </Teleport>

  <!-- PDF preview modal -->
  <Teleport to="body">
    <div v-if="pdfPreviewSrc" class="pdf-preview-overlay" @click.self="pdfPreviewSrc = null">
      <div class="pdf-preview-container">
        <button class="pdf-preview-close" @click="pdfPreviewSrc = null">✕</button>
        <embed :src="pdfPreviewSrc" type="application/pdf" class="pdf-preview-embed" />
      </div>
    </div>
  </Teleport>

  <!-- Image lightbox -->
  <Teleport to="body">
    <div v-if="lightboxSrc" class="lightbox-overlay" @click="lightboxSrc = null">
      <img :src="lightboxSrc" class="lightbox-img" @click.stop />
      <button class="lightbox-close" @click="lightboxSrc = null">✕</button>
      <button class="lightbox-copy" @click.stop="copyImageToClipboard(lightboxSrc!)">
        <Copy :size="18" />
      </button>
      <button class="lightbox-download" @click.stop="downloadImage(lightboxSrc!)">
        <Download :size="18" />
      </button>
    </div>
  </Teleport>

  <div
    class="message-row"
    :class="{ 'user-row': isUser, 'assistant-row': !isUser }"
  >
    <!-- Assistant avatar -->
    <div v-if="!isUser" class="avatar">
      <img v-if="modelLogoUrl" :src="modelLogoUrl" class="avatar-logo" alt="" />
      <div v-else class="avatar-mark">M</div>
    </div>

    <!-- Message bubble -->
    <div class="bubble-wrap">
      <!-- Attachments -->
      <div v-if="message.attachments?.length" class="attachments">
        <div v-for="att in message.attachments" :key="att.id">
          <img
            v-if="att.mimeType?.startsWith('image/') && att.data"
            :src="`data:${att.mimeType};base64,${att.data}`"
            class="attachment-img"
            :alt="att.name"
          style="cursor: zoom-in"
          @click="openLightbox(att.mimeType, att.data!)"
          />
          <div
            v-else-if="att.mimeType === 'application/pdf'"
            class="attachment-pdf"
            :class="{ 'pdf-previewable': !!att.data }"
            :title="att.data ? '点击预览 PDF' : ''"
            @click="att.data && openPdfPreview(att)"
          >
            <FileText :size="15" class="pdf-att-icon" />
            <div class="pdf-att-info">
              <span class="pdf-att-name">{{ att.name }}</span>
              <span v-if="att.pageCount" class="pdf-att-pages">{{ att.pageCount }} 页</span>
            </div>
          </div>
          <div v-else class="attachment-file">
            <span class="file-icon">📎</span>
            <span class="file-name">{{ att.name }}</span>
          </div>
        </div>
      </div>

      <!-- User message: plain text or inline edit -->
      <div v-if="isUser" class="bubble user-bubble">
        <template v-if="isEditing">
          <textarea
            v-model="editText"
            class="edit-textarea"
            rows="3"
            @keydown.enter.exact.prevent="confirmEdit"
            @keydown.esc="cancelEdit"
          />
          <div class="edit-actions">
            <button class="edit-confirm-btn" @click="confirmEdit">发送</button>
            <button class="edit-cancel-btn" @click="cancelEdit">取消</button>
          </div>
        </template>
        <span v-else class="user-text">{{ message.content }}</span>
      </div>

      <!-- Web search results (user messages only) -->
      <div v-if="isUser && message.webSearchResults?.length" class="search-sources-wrap">
        <button class="search-sources-toggle" @click="searchResultsOpen = !searchResultsOpen">
          <Globe :size="11" class="search-sources-globe" />
          <span>{{ message.webSearchResults.length }} 条网络来源</span>
          <ChevronDown :size="10" class="search-sources-chevron" :class="{ open: searchResultsOpen }" />
        </button>
        <Transition name="sources-drop">
          <div v-if="searchResultsOpen" class="search-sources-list">
            <a
              v-for="(r, idx) in message.webSearchResults"
              :key="idx"
              class="search-source-item"
              @click.prevent="openResultUrl(r.url)"
            >
              <span class="source-num">{{ idx + 1 }}</span>
              <div class="source-info">
                <span class="source-title">{{ r.title || resultDomain(r.url) }}</span>
                <span class="source-domain">{{ resultDomain(r.url) }}</span>
              </div>
            </a>
          </div>
        </Transition>
      </div>

      <!-- In horizontal compare mode, collapse main content (only compare strip is shown) -->
      <template v-if="!isUser && allVariantSlots.length > 1 && variantLayout === 'horizontal'" />

      <!-- Reasoning block (collapsible) — hidden in horizontal mode when multi-variant -->
      <div v-if="!isUser && displayedReasoning && !(allVariantSlots.length > 1 && variantLayout === 'horizontal')" class="reasoning-block">
        <button
          class="reasoning-header"
          @click="reasoningView = reasoningView === 'collapsed' ? 'preview' : 'collapsed'"
        >
          <ChevronDown :size="12" class="reasoning-chevron" :class="{ expanded: reasoningView !== 'collapsed' }" />
          <span class="reasoning-header-label">思考过程</span>
          <span class="reasoning-meta">{{ reasoningWordCount }} 词 · {{ displayedReasoning.length }} 字符</span>
          <component
            :is="reasoningView === 'expanded' ? Minimize2 : Maximize2"
            :size="12"
            class="reasoning-expand-icon"
            @click.stop="reasoningView = reasoningView === 'expanded' ? 'preview' : 'expanded'"
          />
        </button>
        <div
          v-if="reasoningView !== 'collapsed'"
          class="reasoning-content"
          :class="{ 'reasoning-full': reasoningView === 'expanded' }"
        >
          {{ displayedReasoning }}
        </div>
      </div>

      <!-- Assistant message: rendered markdown or inline edit (hidden in horizontal compare) -->
      <template v-if="!isUser && !(allVariantSlots.length > 1 && variantLayout === 'horizontal')">
        <template v-if="isEditing">
          <textarea
            v-model="editText"
            class="edit-textarea assistant-edit-textarea"
            rows="6"
            @keydown.esc="cancelEdit"
          />
          <div class="edit-actions">
            <button class="edit-confirm-btn" @click="confirmEdit">保存</button>
            <button class="edit-cancel-btn" @click="cancelEdit">取消</button>
          </div>
        </template>
        <div
          v-else
          ref="msgEl"
          class="bubble assistant-bubble markdown-body"
          :class="{ error: displayedError, streaming: activeSlotStreaming }"
          v-html="renderedContent"
          @click="onMarkdownBodyClick"
        />
      </template>

      <!-- Media outputs — hidden in horizontal compare mode (shown per-column there instead) -->
      <div v-if="!isUser && displayedMediaOutputs?.length && !(allVariantSlots.length > 1 && variantLayout === 'horizontal')" class="media-outputs">
        <template v-for="(out, idx) in displayedMediaOutputs" :key="idx">
          <div v-if="out.mimeType.startsWith('image/')" class="media-img-wrap">
            <img
              :src="out.url ?? `data:${out.mimeType};base64,${out.data}`"
              class="media-img"
              :alt="`生成图片 ${idx + 1}`"
              @click="out.url ? openLightboxUrl(out.url) : openLightbox(out.mimeType, out.data!)"
            />
            <button
              class="media-copy-btn"
              title="复制图片"
              @click.stop="copyImageToClipboard(out.url ?? `data:${out.mimeType};base64,${out.data}`)"
            >
              <Copy :size="15" />
            </button>
            <button
              class="media-download-btn"
              title="下载原图"
              @click.stop="downloadImage(out.url ?? `data:${out.mimeType};base64,${out.data}`, `muse-image-${idx + 1}.png`)"
            >
              <Download :size="15" />
            </button>
          </div>
          <video
            v-else-if="out.mimeType.startsWith('video/')"
            :src="out.url ?? `data:${out.mimeType};base64,${out.data}`"
            class="media-video"
            controls
            preload="metadata"
          />
        </template>
      </div>

      <!-- Footer: action buttons left, usage stats right (hidden in horizontal mode) -->
      <div v-if="!isEditing && !(allVariantSlots.length > 1 && variantLayout === 'horizontal')" class="msg-footer">
        <div class="msg-actions">
          <button class="action-btn" :class="{ done: copyDone }" title="复制" @click="copyContent">
            <Check v-if="copyDone" :size="13" />
            <Copy v-else :size="13" />
          </button>
          <button v-if="!activeSlotStreaming" class="action-btn" title="编辑" @click="startEdit">
            <Pencil :size="13" />
          </button>
          <button v-if="!isUser && !activeSlotStreaming" class="action-btn" title="重新生成" @click="chat.regenerate(message.id, activeVariantIdx)">
            <RefreshCw :size="13" />
          </button>
          <!-- @ button: pick another model to answer -->
          <div v-if="!isUser && !activeSlotStreaming" ref="pickerRoot" class="picker-wrap">
            <button class="action-btn" title="用其他模型回答" @click="togglePicker">
              <AtSign :size="13" />
            </button>
            <Transition name="picker-pop">
              <div v-if="pickerOpen" class="model-picker-popup">
                <div v-for="p in configuredProviders" :key="p.id" class="picker-group">
                  <div class="picker-group-label">{{ p.name }}</div>
                  <button
                    v-for="m in p.models"
                    :key="m.id"
                    class="picker-model-item"
                    @click="selectModelForVariant(p.id, m.id)"
                  >{{ m.name || m.id }}</button>
                </div>
              </div>
            </Transition>
          </div>
          <!-- Feedback buttons -->
          <button
            v-if="!isUser && !activeSlotStreaming"
            class="action-btn"
            :class="{ positive: displayedFeedback === 'positive' }"
            :title="t('chat.feedbackPositive')"
            @click="chat.setMessageFeedback(message.id, displayedFeedback === 'positive' ? null : 'positive')"
          >
            <ThumbsUp :size="13" />
          </button>
          <button
            v-if="!isUser && !activeSlotStreaming"
            class="action-btn"
            :class="{ negative: displayedFeedback === 'negative' }"
            :title="t('chat.feedbackNegative')"
            @click="chat.setMessageFeedback(message.id, displayedFeedback === 'negative' ? null : 'negative')"
          >
            <ThumbsDown :size="13" />
          </button>
        </div>

        <div v-if="!isUser && (displayedUsage || modelDisplayName) && !activeSlotStreaming" class="msg-usage">
          <span v-if="modelDisplayName" class="msg-model-name">
            <Bot :size="10" />
            <template v-if="providerDisplayName">{{ providerDisplayName }} · </template>{{ modelDisplayName }}
          </span>
          <span v-if="displayedUsage?.inputTokens != null">↑{{ displayedUsage.inputTokens }}</span>
          <span v-if="displayedUsage?.outputTokens != null">↓{{ displayedUsage.outputTokens }}</span>
          <span v-if="displayedUsage?.tokensPerSecond != null">{{ displayedUsage.tokensPerSecond }} t/s</span>
          <span
            v-else-if="displayedUsage?.outputTokens != null && displayedUsage?.durationMs != null && displayedUsage.durationMs > 0"
          >{{ Math.round(((displayedUsage.outputTokens ?? 0) + (displayedUsage.reasoningTokens ?? 0)) / (displayedUsage.durationMs / 1000)) }} t/s</span>
          <span v-if="displayedUsage?.durationMs != null" class="msg-duration">
            <Clock :size="9" />{{ (displayedUsage.durationMs / 1000).toFixed(1) }}s
          </span>
          <span v-if="displayedUsage?.costUsd != null">${{ displayedUsage.costUsd.toFixed(4) }}</span>
        </div>
      </div>

      <!-- Horizontal compare view -->
      <div v-if="!isUser && allVariantSlots.length > 1 && variantLayout === 'horizontal'" class="compare-strip">
        <div class="compare-cols">
        <div
          v-for="(slot, idx) in allVariantSlots"
          :key="idx"
          class="compare-col"
          :class="{ 'compare-col-streaming': isSlotStreaming(message.id, idx) }"
          @contextmenu.prevent="openVariantMenu($event, idx)"
        >
          <!-- Column header -->
          <div class="compare-col-header">
            <img
              v-if="lookupLogoUrl(slot.model, slot.providerId)"
              :src="lookupLogoUrl(slot.model, slot.providerId)!"
              class="compare-logo"
              alt=""
            />
            <span v-else class="compare-letter">{{ slot.model.charAt(0).toUpperCase() }}</span>
            <span class="compare-model-name">{{ slot.model.includes('/') ? slot.model.split('/').at(-1) : slot.model }}</span>
            <span v-if="isSlotStreaming(message.id, idx)" class="compare-streaming-dot" />
          </div>

          <!-- Column reasoning (collapsible) -->
          <details
            v-if="slotReasoning(message, idx)"
            class="compare-reasoning"
          >
            <summary class="compare-reasoning-summary">思考过程</summary>
            <div class="compare-reasoning-body">{{ slotReasoning(message, idx) }}</div>
          </details>

          <!-- Column content -->
          <div
            class="compare-content markdown-body"
            :class="{ error: slotError(message, idx), streaming: isSlotStreaming(message.id, idx) }"
            v-html="renderMarkdown(slotContent(message, idx))"
            @click="onMarkdownBodyClick"
          />

          <!-- Column media outputs -->
          <div v-if="slotMediaOutputs(message, idx)?.length" class="compare-media-outputs">
            <template v-for="(out, oidx) in slotMediaOutputs(message, idx)" :key="oidx">
              <div v-if="out.mimeType.startsWith('image/')" class="media-img-wrap">
                <img
                  :src="out.url ?? `data:${out.mimeType};base64,${out.data}`"
                  class="media-img"
                  :alt="`生成图片 ${oidx + 1}`"
                  @click="out.url ? openLightboxUrl(out.url) : openLightbox(out.mimeType, out.data!)"
                />
                <button
                  class="media-copy-btn"
                  title="复制图片"
                  @click.stop="copyImageToClipboard(out.url ?? `data:${out.mimeType};base64,${out.data}`)"
                >
                  <Copy :size="15" />
                </button>
                <button
                  class="media-download-btn"
                  title="下载原图"
                  @click.stop="downloadImage(out.url ?? `data:${out.mimeType};base64,${out.data}`, `muse-image-${oidx + 1}.png`)"
                >
                  <Download :size="15" />
                </button>
              </div>
              <video
                v-else-if="out.mimeType.startsWith('video/')"
                :src="out.url ?? `data:${out.mimeType};base64,${out.data}`"
                class="media-video"
                controls
                preload="metadata"
              />
            </template>
          </div>

          <!-- Column footer: feedback + usage -->
          <div class="compare-footer">
            <div class="compare-feedback">
              <button
                class="action-btn"
                :class="{ done: copyDoneSlot === idx }"
                title="复制"
                @click.stop="copySlotContent(message, idx)"
              >
                <Check v-if="copyDoneSlot === idx" :size="12" />
                <Copy v-else :size="12" />
              </button>
              <button
                class="action-btn"
                :class="{ positive: slotFeedback(message, idx) === 'positive' }"
                :title="t('chat.feedbackPositive')"
                @click.stop="setSlotFeedback(message.id, idx, slotFeedback(message, idx) === 'positive' ? null : 'positive')"
              >
                <ThumbsUp :size="12" />
              </button>
              <button
                class="action-btn"
                :class="{ negative: slotFeedback(message, idx) === 'negative' }"
                :title="t('chat.feedbackNegative')"
                @click.stop="setSlotFeedback(message.id, idx, slotFeedback(message, idx) === 'negative' ? null : 'negative')"
              >
                <ThumbsDown :size="12" />
              </button>
            </div>
            <div class="compare-usage">
              <span v-if="slotUsage(message, idx)?.inputTokens != null">↑{{ slotUsage(message, idx)!.inputTokens }}</span>
              <span v-if="slotUsage(message, idx)?.outputTokens != null">↓{{ slotUsage(message, idx)!.outputTokens }}</span>
              <span v-if="slotUsage(message, idx)?.tokensPerSecond != null">{{ slotUsage(message, idx)!.tokensPerSecond }} t/s</span>
              <span
                v-else-if="slotUsage(message, idx)?.outputTokens != null && slotUsage(message, idx)?.durationMs != null && slotUsage(message, idx)!.durationMs! > 0"
              >{{ Math.round(((slotUsage(message, idx)!.outputTokens ?? 0)) / (slotUsage(message, idx)!.durationMs! / 1000)) }} t/s</span>
              <span v-if="slotUsage(message, idx)?.durationMs != null" class="msg-duration">
                <Clock :size="9" />{{ (slotUsage(message, idx)!.durationMs! / 1000).toFixed(1) }}s
              </span>
              <span v-if="slotUsage(message, idx)?.costUsd != null">${{ slotUsage(message, idx)!.costUsd!.toFixed(4) }}</span>
            </div>
          </div>
        </div>
        </div>
      </div>

      <!-- Variant controls: layout toggle + model tabs (shown in both tab and horizontal mode) -->
      <div v-if="!isUser && allVariantSlots.length > 1" class="variant-bar">
        <button class="layout-toggle-btn" :title="variantLayout === 'tab' ? '切换为横向对比视图' : '切换为标签页视图'" @click="toggleLayout">
          <Columns2 v-if="variantLayout === 'tab'" :size="13" />
          <Rows3 v-else :size="13" />
        </button>
        <div
          v-for="(slot, idx) in allVariantSlots"
          :key="idx"
          class="variant-slot"
        >
          <button
            class="variant-btn"
            :class="{
              active: variantLayout === 'tab' && activeVariantIdx === idx,
              streaming: isSlotStreaming(message.id, idx)
            }"
            @click="variantLayout === 'tab' ? chat.setActiveVariant(message.id, idx) : null"
            @contextmenu.prevent="openVariantMenu($event, idx)"
          >
            <img
              v-if="lookupLogoUrl(slot.model, slot.providerId)"
              :src="lookupLogoUrl(slot.model, slot.providerId)!"
              class="variant-logo"
              alt=""
            />
            <span v-else class="variant-letter">{{ slot.model.charAt(0).toUpperCase() }}</span>
          </button>
          <span class="variant-tooltip">{{ slot.model }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Variant context menu -->
  <div
    v-if="variantMenuOpen"
    class="variant-context-menu"
    :style="{ left: variantMenuPos.x + 'px', top: variantMenuPos.y + 'px' }"
    @click.stop
  >
    <button class="variant-menu-item delete" @click="confirmDeleteVariant">
      <Trash2 :size="14" />
      <span>删除此回答</span>
    </button>
  </div>
</template>

<style scoped>
.message-row {
  display: flex;
  gap: 8px;
  max-width: 860px;
  margin: 0 auto;
  width: 100%;
  padding: 4px 0;
}

.user-row {
  flex-direction: row-reverse;
}

.assistant-row {
  flex-direction: row;
  align-items: flex-start;
}

.avatar {
  flex-shrink: 0;
  margin-top: 4px;
}

.avatar-mark {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: linear-gradient(145deg, #E4983D 0%, #223F79 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 13px;
  font-weight: 700;
}

.avatar-logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  object-fit: contain;
}

.bubble-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.user-row .bubble-wrap {
  align-items: flex-end;
}

.bubble {
  max-width: 100%;
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.65;
  word-break: break-word;
}

.user-bubble {
  background: #223F79;
  color: white;
  border-radius: 16px 4px 16px 16px;
  max-width: 76%;
}

.user-text {
  white-space: pre-wrap;
}

.assistant-bubble {
  background: transparent;
  color: #1c1c1e;
  padding: 4px 0;
  border-radius: 0;
}

.assistant-bubble.error {
  color: #ff3b30;
}

.assistant-bubble.streaming::after {
  content: '▋';
  display: inline-block;
  animation: blink 0.7s step-end infinite;
  color: #223F79;
  margin-left: 2px;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}

.attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-img {
  max-width: 280px;
  max-height: 200px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.attachment-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  font-size: 12px;
}

.file-name {
  color: #3c3c43;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-pdf {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px 7px 10px;
  background: rgba(34, 63, 121, 0.07);
  border: 1px solid rgba(34, 63, 121, 0.14);
  border-radius: 10px;
  max-width: 240px;
}

.pdf-att-icon {
  color: #223F79;
  flex-shrink: 0;
}

.pdf-att-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.pdf-att-name {
  font-size: 12px;
  font-weight: 500;
  color: #1c1c1e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pdf-att-pages {
  font-size: 10px;
  color: #8e8e93;
}

.msg-footer {
  display: flex;
  align-items: center;
  height: 22px;
}

.msg-actions {
  display: flex;
  gap: 2px;
  align-items: center;
  opacity: 0;
  transition: opacity 0.15s;
  will-change: opacity;
}

.message-row:hover .msg-actions {
  opacity: 1;
}


.msg-usage {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #8e8e93;
}

.msg-model-name {
  display: flex;
  align-items: center;
  gap: 3px;
  padding-right: 6px;
  border-right: 1px solid rgba(0, 0, 0, 0.10);
}


.msg-duration {
  display: flex;
  align-items: center;
  gap: 3px;
  padding-left: 6px;
  border-left: 1px solid rgba(0, 0, 0, 0.10);
}

/* ─── @ Model picker ────────────────────────────────────────────────────────── */
.picker-wrap {
  position: relative;
}

.model-picker-popup {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 6px;
  min-width: 180px;
  max-height: 320px;
  overflow-y: auto;
  z-index: 100;
}

.model-picker-popup::-webkit-scrollbar { width: 3px; }
.model-picker-popup::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

.picker-group { margin-bottom: 4px; }
.picker-group:last-child { margin-bottom: 0; }

.picker-group-label {
  font-size: 10px;
  font-weight: 600;
  color: #aeaeb2;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 4px 8px 2px;
}

.picker-model-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 5px 8px;
  font-size: 12px;
  color: #1c1c1e;
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.picker-model-item:hover { background: rgba(0, 0, 0, 0.05); }

.picker-pop-enter-active, .picker-pop-leave-active { transition: opacity 0.12s, transform 0.12s; }
.picker-pop-enter-from, .picker-pop-leave-to { opacity: 0; transform: translateY(4px); }

/* ─── Variant bar (layout toggle + tab switcher) ────────────────────────────── */
.variant-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.layout-toggle-btn {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.10);
  background: transparent;
  color: #8e8e93;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
  margin-right: 2px;
}

.layout-toggle-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }

/* ─── Horizontal compare strip ───────────────────────────────────────────────── */
.compare-strip {
  display: flex;
  flex-direction: column;
  margin-top: 8px;
  border: 1px solid rgba(0, 0, 0, 0.09);
  border-radius: 12px;
  overflow: hidden;
}


.compare-cols {
  display: flex;
  overflow-x: auto;
  overflow-y: visible;
  scrollbar-width: thin;
}

.compare-cols::-webkit-scrollbar { height: 4px; }
.compare-cols::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

.compare-col {
  min-width: 320px;
  max-width: 460px;
  flex: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(0, 0, 0, 0.07);
  transition: background 0.12s;
}

.compare-col:last-child { border-right: none; }

.compare-col-streaming { background: rgba(34, 63, 121, 0.02); }

.compare-col-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.015);
}

.compare-logo {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  object-fit: contain;
  flex-shrink: 0;
}

.compare-letter {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: rgba(0,0,0,0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #8e8e93;
  flex-shrink: 0;
}

.compare-model-name {
  font-size: 11px;
  font-weight: 600;
  color: #3c3c43;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compare-streaming-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #223F79;
  flex-shrink: 0;
  animation: pulse-dot 1.2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.compare-reasoning {
  margin: 6px 10px 0;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 8px;
  background: rgba(248,248,252,0.9);
  overflow: hidden;
}
.compare-reasoning-summary {
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  color: #8e8e93;
  padding: 5px 10px;
  user-select: none;
  list-style: none;
}
.compare-reasoning-summary::-webkit-details-marker { display: none; }
.compare-reasoning-summary::before {
  content: '▶ ';
  font-size: 9px;
  transition: transform 0.15s;
}
details[open] .compare-reasoning-summary::before { content: '▼ '; }
.compare-reasoning-body {
  padding: 6px 10px 8px;
  font-size: 11.5px;
  line-height: 1.6;
  color: #8e8e93;
  white-space: pre-wrap;
  word-break: break-word;
  border-top: 1px solid rgba(0,0,0,0.06);
  max-height: 200px;
  overflow-y: auto;
}

.compare-content {
  flex: 1;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.65;
  color: #1c1c1e;
  word-break: break-word;
  min-height: 60px;
}

.compare-content.error { color: #ff3b30; }

.compare-media-outputs {
  padding: 0 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.compare-content.streaming::after {
  content: '▋';
  display: inline-block;
  animation: blink 0.7s step-end infinite;
  color: #223F79;
  margin-left: 2px;
}

.compare-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 8px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.compare-feedback {
  display: flex;
  gap: 2px;
}

.compare-usage {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: #aeaeb2;
}

/* ─── Variant switcher (tab mode) ────────────────────────────────────────────── */
.variant-switcher {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.variant-slot {
  position: relative;
}

.variant-btn {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 2px solid transparent;
  background: rgba(0, 0, 0, 0.04);
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.12s, background 0.12s;
  overflow: hidden;
}

.variant-btn:hover { background: rgba(0, 0, 0, 0.08); }
.variant-btn.active { border-color: #223F79; background: rgba(34, 63, 121, 0.06); }

@keyframes pulse-ring {
  0%   { box-shadow: 0 0 0 0 rgba(34, 63, 121, 0.4); }
  70%  { box-shadow: 0 0 0 4px rgba(34, 63, 121, 0); }
  100% { box-shadow: 0 0 0 0 rgba(34, 63, 121, 0); }
}
.variant-btn.streaming { animation: pulse-ring 1.2s ease-out infinite; }

.variant-logo {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.variant-letter {
  font-size: 11px;
  font-weight: 700;
  color: #8e8e93;
}

/* Instant CSS tooltip — no delay */
.variant-tooltip {
  position: absolute;
  bottom: calc(100% + 5px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(28, 28, 30, 0.88);
  color: white;
  font-size: 10px;
  white-space: nowrap;
  padding: 3px 7px;
  border-radius: 5px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.08s;
  z-index: 10;
}

.variant-slot:hover .variant-tooltip { opacity: 1; }

.action-btn {
  width: 24px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #aeaeb2;
  background: none;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
}

.action-btn:hover {
  background: rgba(0, 0, 0, 0.07);
  color: #3c3c43;
}

.action-btn.done {
  color: #34c759;
}

.action-btn.positive {
  color: #34c759;
}

.action-btn.negative {
  color: #ff3b30;
}

.edit-textarea {
  width: 100%;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  outline: none;
  resize: none;
  font-size: 14px;
  line-height: 1.55;
  color: white;
  font-family: inherit;
  border-radius: 8px;
  padding: 6px 8px;
  box-sizing: border-box;
}

.assistant-edit-textarea {
  background: #f5f5f7;
  color: #1c1c1e;
  border: 1.5px solid rgba(34, 63, 121, 0.25);
}

.edit-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  justify-content: flex-end;
}

.edit-confirm-btn {
  font-size: 12px;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
}

.edit-cancel-btn {
  font-size: 12px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  border: none;
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
}

/* ─── Reasoning block ───────────────────────────────────────────────────────── */
.reasoning-block {
  border: 1px solid rgba(34, 63, 121, 0.12);
  border-radius: 10px;
  background: rgba(34, 63, 121, 0.03);
  overflow: hidden;
  margin-bottom: 6px;
}

.reasoning-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
}

.reasoning-header:hover { background: rgba(34, 63, 121, 0.05); }

.reasoning-chevron {
  color: #8e8e93;
  transition: transform 0.15s;
  flex-shrink: 0;
}

.reasoning-chevron.expanded { transform: rotate(180deg); }

.reasoning-header-label {
  font-size: 12px;
  font-weight: 500;
  color: rgba(34, 63, 121, 0.7);
}

.reasoning-meta {
  margin-left: auto;
  font-size: 10px;
  color: #aeaeb2;
}

.reasoning-expand-icon {
  color: #8e8e93;
  flex-shrink: 0;
  transition: color 0.12s;
}

.reasoning-header:hover .reasoning-expand-icon {
  color: rgba(34, 63, 121, 0.7);
}

.reasoning-content {
  padding: 8px 10px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: #6e6e73;
  white-space: pre-wrap;
  word-break: break-word;
  border-top: 1px solid rgba(34, 63, 121, 0.08);
  max-height: 200px;
  overflow-y: auto;
}

.reasoning-content.reasoning-full {
  max-height: none;
}

.reasoning-content::-webkit-scrollbar { width: 3px; }
.reasoning-content::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

/* ─── Media outputs ─────────────────────────────────────────────────────────── */
.media-outputs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 4px;
}

.media-img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 520px;
  border-radius: 12px;
  cursor: zoom-in;
  object-fit: contain;
  transition: opacity 0.12s;
}

.media-img:hover { opacity: 0.92; }

.media-video {
  max-width: 520px;
  width: 100%;
  border-radius: 12px;
  background: #000;
  outline: none;
}

/* ─── Lightbox ──────────────────────────────────────────────────────────────── */
.lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.lightbox-img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 10px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  cursor: default;
}

.lightbox-close {
  position: absolute;
  top: 20px;
  right: 24px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s;
}

.lightbox-close:hover { background: rgba(255, 255, 255, 0.25); }

.lightbox-copy {
  position: absolute;
  bottom: 20px;
  right: 64px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s;
}
.lightbox-copy:hover { background: rgba(255, 255, 255, 0.25); }

.lightbox-download {
  position: absolute;
  bottom: 20px;
  right: 20px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s;
}
.lightbox-download:hover { background: rgba(255, 255, 255, 0.25); }

.save-toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(30, 30, 30, 0.88);
  color: #fff;
  padding: 8px 20px;
  border-radius: 20px;
  font-size: 13px;
  pointer-events: none;
  z-index: 99999;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.media-img-wrap {
  position: relative;
  display: block;
  max-width: min(480px, 100%);
}
.media-img-wrap:hover .media-download-btn,
.media-img-wrap:hover .media-copy-btn { opacity: 1; }

.media-copy-btn {
  position: absolute;
  bottom: 8px;
  right: 46px;
  opacity: 0;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s, background 0.12s;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.media-copy-btn:hover { background: rgba(0, 0, 0, 0.75); }

.media-download-btn {
  position: absolute;
  bottom: 8px;
  right: 8px;
  opacity: 0;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s, background 0.12s;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.media-download-btn:hover { background: rgba(0, 0, 0, 0.75); }
</style>

<!-- Markdown + code block styles (not scoped so they apply to v-html content) -->
<style>
.markdown-body p { margin: 0 0 10px; }
.markdown-body p:last-child { margin-bottom: 0; }
.markdown-body ul, .markdown-body ol { padding-left: 1.4em; margin: 6px 0; }
.markdown-body li { margin: 2px 0; }
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  margin: 14px 0 6px;
  font-weight: 600;
  line-height: 1.3;
}
.markdown-body h1 { font-size: 1.25em; }
.markdown-body h2 { font-size: 1.1em; }
.markdown-body h3 { font-size: 1em; }
.markdown-body blockquote {
  margin: 8px 0;
  padding: 6px 12px;
  border-left: 3px solid rgba(34, 63, 121, 0.3);
  color: #6e6e73;
  font-style: italic;
}
.markdown-body table {
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 13px;
}
.markdown-body th, .markdown-body td {
  border: 1px solid rgba(0, 0, 0, 0.12);
  padding: 6px 10px;
}
.markdown-body th { background: rgba(0, 0, 0, 0.03); font-weight: 600; }
.markdown-body a, .markdown-body .markdown-link { color: #223F79; text-decoration: underline; cursor: pointer; }
.markdown-body hr { border: none; border-top: 1px solid rgba(0,0,0,0.10); margin: 12px 0; }
.markdown-body img { max-width: 100%; height: auto; border-radius: 12px; display: block; }

.markdown-img-wrap { position: relative; display: inline-block; vertical-align: bottom; width: min(480px, 100%); }
.markdown-img-wrap:hover .markdown-download-btn,
.markdown-img-wrap:hover .markdown-copy-btn { opacity: 1; }

.markdown-copy-btn {
  position: absolute;
  bottom: 8px;
  right: 46px;
  opacity: 0;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s, background 0.12s;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.markdown-copy-btn:hover { background: rgba(0, 0, 0, 0.75); }

.markdown-download-btn {
  position: absolute;
  bottom: 8px;
  right: 8px;
  opacity: 0;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s, background 0.12s;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.markdown-download-btn:hover { background: rgba(0, 0, 0, 0.75); }

/* Inline code */
.inline-code {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 0.88em;
  color: #c7254e;
}

/* Code blocks */
.code-block {
  margin: 10px 0;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.10);
  background: #1e1e2e;
}

.code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.code-lang {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  font-family: 'SF Mono', 'Menlo', monospace;
  text-transform: lowercase;
}

.copy-btn {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.12s, color 0.12s;
}

.copy-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}

.code-block pre {
  margin: 0;
  padding: 14px 16px;
  overflow-x: auto;
  font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.55;
}

.code-block code {
  display: block;
  font-family: inherit;
}

/* highlight.js atom-one-dark-ish */
.hljs { color: #abb2bf; background: transparent; }
.hljs-comment, .hljs-quote { color: #5c6370; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-subst { color: #c678dd; }
.hljs-number, .hljs-literal, .hljs-variable, .hljs-template-variable { color: #d19a66; }
.hljs-string, .hljs-doctag { color: #98c379; }
.hljs-title, .hljs-section, .hljs-selector-id { color: #61aeee; font-weight: bold; }
.hljs-type, .hljs-class .hljs-title { color: #e6c07b; }
.hljs-tag, .hljs-name, .hljs-attribute { color: #e06c75; }
.hljs-regexp, .hljs-link { color: #98c379; }
.hljs-symbol, .hljs-bullet { color: #61aeee; }
.hljs-built_in, .hljs-builtin-name { color: #e06c75; }
.hljs-meta { color: #999; font-weight: bold; }
.hljs-deletion { background: #2d2d2d; }
.hljs-addition { background: #2d2d2d; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }

/* Variant context menu */
.variant-context-menu {
  position: fixed;
  z-index: 1000;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  padding: 4px;
  min-width: 120px;
}

.variant-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  border-radius: 6px;
  font-size: 13px;
  color: #3c3c43;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}

.variant-menu-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.variant-menu-item.delete {
  color: #ff3b30;
}

.variant-menu-item.delete:hover {
  background: rgba(255, 59, 48, 0.08);
}

/* ─── PDF attachment preview ─────────────────────────────────────────────────── */
.attachment-pdf.pdf-previewable {
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.attachment-pdf.pdf-previewable:hover {
  background: rgba(34, 63, 121, 0.12);
  border-color: rgba(34, 63, 121, 0.25);
}

.pdf-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.pdf-preview-container {
  position: relative;
  width: 90vw;
  height: 90vh;
  border-radius: 12px;
  overflow: hidden;
  background: white;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
}

.pdf-preview-close {
  position: absolute;
  top: 12px;
  right: 16px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.15);
  color: #3c3c43;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: background 0.12s;
}
.pdf-preview-close:hover { background: rgba(0, 0, 0, 0.25); }

.pdf-preview-embed {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}

/* ─── Web search sources ─────────────────────────────────────────────────────── */
.search-sources-wrap {
  align-self: flex-end;
  margin-top: 4px;
  max-width: 76%;
}

.search-sources-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  background: rgba(34, 63, 121, 0.08);
  border: 1px solid rgba(34, 63, 121, 0.15);
  border-radius: 20px;
  font-size: 11px;
  color: rgba(34, 63, 121, 0.8);
  cursor: pointer;
  transition: background 0.12s;
  white-space: nowrap;
}

.search-sources-toggle:hover { background: rgba(34, 63, 121, 0.13); }

.search-sources-globe { color: #223F79; flex-shrink: 0; }

.search-sources-chevron {
  color: rgba(34, 63, 121, 0.5);
  transition: transform 0.15s;
  flex-shrink: 0;
}
.search-sources-chevron.open { transform: rotate(180deg); }

.search-sources-list {
  margin-top: 6px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(0, 0, 0, 0.09);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.search-source-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  cursor: pointer;
  text-decoration: none;
  transition: background 0.10s;
}
.search-source-item:last-child { border-bottom: none; }
.search-source-item:hover { background: rgba(34, 63, 121, 0.04); }

.source-num {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.source-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.source-title {
  font-size: 11.5px;
  font-weight: 500;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-domain {
  font-size: 9.5px;
  color: #8e8e93;
}

.sources-drop-enter-active, .sources-drop-leave-active {
  transition: opacity 0.12s, transform 0.12s;
}
.sources-drop-enter-from, .sources-drop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
