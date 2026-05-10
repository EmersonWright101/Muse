<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, reactive } from 'vue'
import {
  Send, Square, SquarePen, Plus, X, Trash2, FileText,
  ChevronDown, Globe, Brain, Paperclip, Check, Eraser,
  Settings, Eye, Copy, Pencil, RefreshCw, AtSign,
  Columns2, Rows3,
} from 'lucide-vue-next'
import { usePaperCopilotStore } from '../../../stores/paperCopilot'
import type { PaperChatMessage } from '../../../stores/paperCopilot'
import { useAiSettingsStore }   from '../../../stores/aiSettings'
import { useWebSearchStore }    from '../../../stores/webSearch'
import { useStatisticsStore }   from '../../../stores/statistics'
import ModelSelector            from '../../chat/components/ModelSelector.vue'
import type { Paper }           from '../../../stores/papers'
import { processPdfFile }       from '../../../utils/pdf'
import { marked, type Tokens }  from 'marked'
import hljs                     from 'highlight.js/lib/core'
import copilotIcon from '../../../assets/icons/copilot.svg'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python     from 'highlight.js/lib/languages/python'
import java       from 'highlight.js/lib/languages/java'
import go         from 'highlight.js/lib/languages/go'
import rust       from 'highlight.js/lib/languages/rust'
import cpp        from 'highlight.js/lib/languages/cpp'
import c          from 'highlight.js/lib/languages/c'
import csharp     from 'highlight.js/lib/languages/csharp'
import bash       from 'highlight.js/lib/languages/bash'
import json       from 'highlight.js/lib/languages/json'
import xml        from 'highlight.js/lib/languages/xml'
import css        from 'highlight.js/lib/languages/css'
import sql        from 'highlight.js/lib/languages/sql'
import yaml       from 'highlight.js/lib/languages/yaml'
import plaintext  from 'highlight.js/lib/languages/plaintext'
import DOMPurify  from 'dompurify'
import type { AttachmentMeta } from '../../../stores/chat'

hljs.registerLanguage('javascript', javascript); hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript); hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python);         hljs.registerLanguage('py', python)
hljs.registerLanguage('java', java);             hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust);             hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', c);                   hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('bash', bash);             hljs.registerLanguage('sh', bash)
hljs.registerLanguage('json', json);             hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml);              hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql);               hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('plaintext', plaintext)

const props = defineProps<{ paper: Paper }>()

const copilot = usePaperCopilotStore()
const aiStore = useAiSettingsStore()
const wsStore = useWebSearchStore()
const statsStore = useStatisticsStore()

// ─── Model logo lookup ────────────────────────────────────────────────────────

const modelSvgModules = import.meta.glob<{ default: string }>('/src/assets/models/*.svg', { eager: true })
function buildSvgMap(mods: Record<string, { default: string }>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [path, mod] of Object.entries(mods)) map[path.replace(/^.*\//, '').replace(/\.svg$/, '')] = mod.default
  return map
}
function lookupLogoUrl(model: string, providerId: string): string | null {
  const mid = model.toLowerCase(); const pid = providerId.toLowerCase()
  const svgMap = buildSvgMap(modelSvgModules)
  if (mid.startsWith('gpt-') && svgMap['openai']) return svgMap['openai']
  for (const name of Object.keys(svgMap)) { if (mid.includes(name)) return svgMap[name] }
  for (const name of Object.keys(svgMap)) { if (pid.includes(name)) return svgMap[name] }
  return null
}

// ─── Markdown rendering ────────────────────────────────────────────────────────

const mdRenderer = new marked.Renderer()
mdRenderer.code = ({ text, lang }: Tokens.Code) => {
  const validLang = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
  const highlighted = hljs.highlight(text, { language: validLang }).value
  return `<div class="code-block"><div class="code-header"><span class="code-lang">${validLang}</span><button class="copy-btn" onclick="this.closest('.code-block').querySelector('code').dispatchEvent(new CustomEvent('copy-code',{bubbles:true}));this.textContent='已复制';setTimeout(()=>this.textContent='复制',2000)">复制</button></div><pre><code class="hljs ${validLang}">${highlighted}</code></pre></div>`
}
mdRenderer.codespan = ({ text }: Tokens.Codespan) => `<code class="inline-code">${text}</code>`
mdRenderer.link = ({ href, title, text }: Tokens.Link) =>
  `<a data-href="${href.replace(/"/g,'&quot;')}" class="markdown-link" title="${title ?? ''}">${text}</a>`
marked.setOptions({ renderer: mdRenderer, breaks: true })

function renderMarkdown(content: string): string {
  try {
    const raw = marked.parse(content) as string
    if (typeof raw !== 'string') return content
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['onclick', 'data-href', 'title'] })
  } catch { return content }
}

// ─── Resize ───────────────────────────────────────────────────────────────────

const panelWidth = ref(420)
const isResizing = ref(false)

function startResize(e: MouseEvent) {
  isResizing.value = true
  const startX = e.clientX; const startW = panelWidth.value
  const onMove = (ev: MouseEvent) => { panelWidth.value = Math.max(300, Math.min(720, startW - (ev.clientX - startX))) }
  const onUp   = () => { isResizing.value = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// ─── Computed ─────────────────────────────────────────────────────────────────

const messages = computed(() => copilot.activeConv?.messages ?? [])
const isFullTextUnavailable = computed(() => copilot.contextMode === 'fulltext' && !props.paper.pdf_downloaded)
const canSend  = computed(() => !isFullTextUnavailable.value && (inputText.value.trim().length > 0 || pendingFiles.value.length > 0) && !copilot.isStreaming)

const secondProvider = computed(() => copilot.secondProviderId ? aiStore.providers.find(p => p.id === copilot.secondProviderId) : null)
const secondModel    = computed(() => secondProvider.value?.models.find(m => m.id === copilot.secondModelId) ?? null)
const configuredProviders = computed(() => aiStore.configuredProviders())
const hasWebSearch   = computed(() => wsStore.hasApiKey(wsStore.activeProviderId))
const isDeepSeek     = computed(() => {
  const p = aiStore.providers.find(pr => pr.id === aiStore.activeProviderId)
  return p?.id === 'deepseek' || p?.baseUrl?.includes('deepseek')
})
const activeProviderType = computed(() => aiStore.providers.find(p => p.id === aiStore.activeProviderId)?.type)

// Context text for preview
const contextPreviewText = computed(() => {
  if (copilot.contextMode === 'fulltext') return copilot.paperFullText ?? ''
  return copilot.paperAbstractText ?? ''
})

// ─── Input state ──────────────────────────────────────────────────────────────

const inputText    = ref('')
const pendingFiles = ref<AttachmentMeta[]>([])
const messagesEl   = ref<HTMLElement>()
const textareaEl   = ref<HTMLTextAreaElement>()
const fileInput    = ref<HTMLInputElement>()
const pdfLoading   = ref(false)
const pdfWarning   = ref('')
let _compositionEndedAt = 0
function onCompositionStart() { _compositionEndedAt = 0 }
function onCompositionEnd()   { _compositionEndedAt = Date.now() }
function isIMEActive()        { return Date.now() - _compositionEndedAt < 100 }

// ─── Scroll ───────────────────────────────────────────────────────────────────

function scrollToBottom(force = false) {
  nextTick(() => {
    const el = messagesEl.value
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (force || atBottom) el.scrollTop = el.scrollHeight
  })
}
watch(() => messages.value.length, () => scrollToBottom(true))
watch(() => copilot.streamingText,        () => scrollToBottom())
watch(() => copilot.streamingVariantText, () => scrollToBottom())

// ─── Textarea auto-resize ─────────────────────────────────────────────────────

function adjustHeight() {
  nextTick(() => {
    const el = textareaEl.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  })
}
watch(inputText, adjustHeight)

// ─── Context mode ─────────────────────────────────────────────────────────────

const showContextPreview = ref(false)
const showSettingsPopover = ref(false)
const settingsRoot = ref<HTMLElement>()

async function setContextMode(mode: 'abstract' | 'fulltext') {
  copilot.contextMode = mode
  if (mode === 'abstract') {
    copilot.prepareAbstractText(props.paper.title, props.paper.authors, props.paper.abstract)
  } else if (mode === 'fulltext' && !copilot.paperFullText && !copilot.fullTextError) {
    await copilot.extractFullText(props.paper.id, props.paper.source ?? 'arxiv')
  }
}

function handleSettingsOutside(e: MouseEvent) {
  if (settingsRoot.value && !settingsRoot.value.contains(e.target as Node)) showSettingsPopover.value = false
}

async function maybeAutoExtract() {
  if (copilot.defaultContextMode === 'fulltext' && props.paper.pdf_downloaded
    && !copilot.paperFullText && !copilot.fullTextError) {
    copilot.contextMode = 'fulltext'
    await copilot.extractFullText(props.paper.id, props.paper.source ?? 'arxiv')
  }
}

// Init abstract text on mount
onMounted(async () => {
  copilot.prepareAbstractText(props.paper.title, props.paper.authors, props.paper.abstract)
  await maybeAutoExtract()
  scrollToBottom(true)
  nextTick(() => textareaEl.value?.focus())
})

watch(() => props.paper.id, async () => {
  await nextTick()
  copilot.prepareAbstractText(props.paper.title, props.paper.authors, props.paper.abstract)
  await maybeAutoExtract()
})

// ─── Conversation management ──────────────────────────────────────────────────

const showConvList  = ref(false)

async function newConv() {
  showConvList.value = false
  await copilot.createConversation()
  nextTick(() => textareaEl.value?.focus())
}
async function switchConv(id: string) {
  showConvList.value = false
  await copilot.openConversation(id)
}
async function deleteConv(id: string, e: MouseEvent) {
  e.stopPropagation()
  if (!confirm('删除此对话？')) return
  await copilot.deleteConversation(id)
}

// ─── Second model ─────────────────────────────────────────────────────────────

const secondModelOpen = ref(false)
const secondModelRoot = ref<HTMLElement>()
function selectSecondModel(pid: string, mid: string) { copilot.setSecondModel(pid, mid); secondModelOpen.value = false }
function clearSecondModel() { copilot.setSecondModel(null, null); secondModelOpen.value = false }
function handleSecondModelOutside(e: MouseEvent) {
  if (secondModelRoot.value && !secondModelRoot.value.contains(e.target as Node)) secondModelOpen.value = false
}

// ─── Reasoning popover ────────────────────────────────────────────────────────

const reasoningOpen = ref(false)
const reasoningRoot = ref<HTMLElement>()
function handleReasoningOutside(e: MouseEvent) {
  if (reasoningRoot.value && !reasoningRoot.value.contains(e.target as Node)) reasoningOpen.value = false
}

// ─── File attachment ──────────────────────────────────────────────────────────

function pickFile() { fileInput.value?.click() }

async function handleFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const b64 = (ev.target?.result as string).split(',')[1]
        pendingFiles.value.push({ id: crypto.randomUUID(), name: file.name, mimeType: file.type, data: b64, size: file.size })
      }
      reader.readAsDataURL(file)
    } else if (file.type === 'application/pdf') {
      pdfLoading.value = true; pdfWarning.value = ''
      try {
        const meta = await processPdfFile(file)
        if (!meta.extractedText) pdfWarning.value = '该 PDF 可能为扫描件，文字无法提取。'
        pendingFiles.value.push({ id: crypto.randomUUID(), name: file.name, mimeType: 'application/pdf', data: meta.base64, size: file.size, extractedText: meta.extractedText, pageCount: meta.pageCount })
      } catch { pdfWarning.value = 'PDF 解析失败。' } finally { pdfLoading.value = false }
    }
  }
  if (fileInput.value) fileInput.value.value = ''
}

async function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const blob = item.getAsFile(); if (!blob) continue
      const reader = new FileReader()
      reader.onload = (ev) => {
        const b64 = (ev.target?.result as string).split(',')[1]
        pendingFiles.value.push({ id: crypto.randomUUID(), name: 'image.png', mimeType: item.type, data: b64 })
      }
      reader.readAsDataURL(blob)
    }
  }
}

function removeFile(id: string) { pendingFiles.value = pendingFiles.value.filter(f => f.id !== id) }

// ─── PDF inline preview ───────────────────────────────────────────────────────

const pdfPreviewSrc = ref<string | null>(null)
function openPdfPreview(data: string) { pdfPreviewSrc.value = `data:application/pdf;base64,${data}` }
function closePdfPreview() { pdfPreviewSrc.value = null }

// ─── Send ─────────────────────────────────────────────────────────────────────

async function send() {
  if (!canSend.value) return
  const text = inputText.value.trim()
  const files = [...pendingFiles.value]
  inputText.value = ''; pendingFiles.value = []; pdfWarning.value = ''
  await nextTick(); adjustHeight()
  await copilot.sendMessage(text, files.length ? files : undefined)
}
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !isIMEActive()) { e.preventDefault(); send() }
}

// ─── Link clicks in rendered markdown ────────────────────────────────────────

function handleMsgClick(e: MouseEvent) {
  const link = (e.target as HTMLElement).closest('[data-href]') as HTMLElement | null
  if (link) {
    e.preventDefault()
    import('@tauri-apps/plugin-opener').then(m => m.openUrl(link.dataset.href ?? '')).catch(() => {})
  }
}

// ─── Variant tabs ─────────────────────────────────────────────────────────────

const variantLayout = ref<'tab' | 'horizontal'>('tab')
const msgTabIdx = reactive<Record<string, number>>({})

function getDisplay(msg: typeof messages.value[0]) {
  if (msg.role !== 'assistant') return { content: msg.content, reasoning: msg.reasoning, model: msg.model, providerId: msg.providerId }
  const idx = msgTabIdx[msg.id] ?? 0
  if (!idx) return { content: msg.content, reasoning: msg.reasoning, model: msg.model, providerId: msg.providerId }
  const v = msg.variants?.[idx - 1]
  return { content: v?.content ?? '', reasoning: v?.reasoning, model: v?.model, providerId: v?.providerId }
}
function setTab(msg: typeof messages.value[0], idx: number) { msgTabIdx[msg.id] = idx }

function getVariantSlots(msg: typeof messages.value[0]) {
  return [
    { model: msg.model ?? '', providerId: msg.providerId ?? '' },
    ...(msg.variants ?? []).map(v => ({ model: v.model ?? '', providerId: v.providerId ?? '' })),
  ]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function modelLabel(pid?: string, mid?: string) {
  if (!pid || !mid) return ''
  const p = aiStore.providers.find(x => x.id === pid)
  const modelName = p?.models.find(m => m.id === mid)?.name ?? mid
  const providerName = p?.name ?? pid
  return `${providerName} | ${modelName}`
}

// ─── Edit state ───────────────────────────────────────────────────────────────

const editingMsgId = ref<string | null>(null)
const editText     = ref('')

function startEdit(msg: PaperChatMessage) {
  editingMsgId.value = msg.id
  editText.value     = msg.content
}
async function confirmEdit(msg: PaperChatMessage) {
  if (!editText.value.trim()) return
  editingMsgId.value = null
  if (msg.role === 'user') {
    await copilot.editAndResend(msg.id, editText.value)
  } else {
    await copilot.editMessage(msg.id, editText.value)
  }
}
function cancelEdit() { editingMsgId.value = null }

// ─── Copy state ───────────────────────────────────────────────────────────────

const copyDoneIds = ref(new Set<string>())
async function copyMsg(msg: PaperChatMessage) {
  const content = getDisplay(msg).content
  await navigator.clipboard.writeText(content).catch(() => {})
  copyDoneIds.value.add(msg.id)
  setTimeout(() => { copyDoneIds.value.delete(msg.id); copyDoneIds.value = new Set(copyDoneIds.value) }, 2000)
}

// ─── @ Model picker ───────────────────────────────────────────────────────────

const pickerMsgId = ref<string | null>(null)
const pickerRoot  = ref<HTMLElement>()
function togglePicker(msgId: string) {
  pickerMsgId.value = pickerMsgId.value === msgId ? null : msgId
}
function handlePickerOutside(e: MouseEvent) {
  if (pickerRoot.value && !pickerRoot.value.contains(e.target as Node)) pickerMsgId.value = null
}
function selectModelAndRegenerate(msg: PaperChatMessage, pid: string, mid: string) {
  pickerMsgId.value = null
  copilot.regenerate(msg.id, pid, mid)
}

// ─── Variant auto-switch listener ─────────────────────────────────────────────

function handleVariantAdded(e: Event) {
  const detail = (e as CustomEvent).detail as { msgId: string; variantIdx: number }
  msgTabIdx[detail.msgId] = detail.variantIdx
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  document.addEventListener('mousedown', handleSecondModelOutside)
  document.addEventListener('mousedown', handleReasoningOutside)
  document.addEventListener('mousedown', handleSettingsOutside)
  document.addEventListener('mousedown', handlePickerOutside)
  window.addEventListener('paper-copilot-variant-added', handleVariantAdded)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', handleSecondModelOutside)
  document.removeEventListener('mousedown', handleReasoningOutside)
  document.removeEventListener('mousedown', handleSettingsOutside)
  document.removeEventListener('mousedown', handlePickerOutside)
  window.removeEventListener('paper-copilot-variant-added', handleVariantAdded)
})
</script>

<template>
  <div class="copilot-panel" :style="{ width: panelWidth + 'px' }" :class="{ resizing: isResizing }">

    <!-- Resize handle -->
    <div class="resize-handle" @mousedown.prevent="startResize" />

    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <div class="copilot-header">
      <div class="header-left">
        <img :src="copilotIcon" class="copilot-header-icon" alt="Copilot" />
        <span class="copilot-title">AI Copilot</span>
        <span class="copilot-subtitle">· {{ paper.title.slice(0, 22) }}{{ paper.title.length > 22 ? '…' : '' }}</span>
      </div>
      <div class="header-right">
        <!-- Settings -->
        <div ref="settingsRoot" class="settings-wrap">
          <button class="hdr-btn" title="Copilot 设置" @click="showSettingsPopover = !showSettingsPopover">
            <Settings :size="13" />
          </button>
          <div v-if="showSettingsPopover" class="settings-popover">
            <div class="sp-title">默认上下文模式</div>
            <button
              class="sp-option"
              :class="{ active: copilot.defaultContextMode === 'abstract' }"
              @click="copilot.setDefaultContextMode('abstract')"
            >
              <Check v-if="copilot.defaultContextMode === 'abstract'" :size="10" />
              <span v-else class="sp-dot" />
              摘要输入（推荐）
            </button>
            <button
              class="sp-option"
              :class="{ active: copilot.defaultContextMode === 'fulltext' }"
              @click="copilot.setDefaultContextMode('fulltext')"
            >
              <Check v-if="copilot.defaultContextMode === 'fulltext'" :size="10" />
              <span v-else class="sp-dot" />
              全文输入
            </button>
            <div class="sp-divider" />
            <div class="sp-title">话题生成模型</div>
            <div class="sp-model-row">
              <ModelSelector
                compact
                drop-down
                :provider-id="aiStore.titleGenProviderId || aiStore.activeProviderId"
                :model-id="aiStore.titleGenModelId || aiStore.activeModelId()"
                save-to="titleGen"
                @select="showSettingsPopover = false"
              />
              <button
                v-if="aiStore.titleGenProviderId"
                class="sp-clear-btn"
                title="清除话题生成模型（使用第一句话作为标题）"
                @click="aiStore.clearTitleGenModel(); showSettingsPopover = false"
              >
                <X :size="10" />
              </button>
            </div>
            <div class="sp-hint">未配置时使用第一句话作为标题</div>
          </div>
        </div>
        <!-- Conversation switcher -->
        <div class="conv-wrap" style="position:relative">
          <button class="hdr-btn" title="新建对话" @click="newConv"><Plus :size="13" /></button>
          <button v-if="copilot.currentPaperConversations.length > 0" class="hdr-btn" title="切换对话" @click="showConvList = !showConvList">
            <ChevronDown :size="13" :style="{ transform: showConvList ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }" />
          </button>
          <div v-if="showConvList" class="conv-dropdown">
            <div
              v-for="conv in copilot.currentPaperConversations"
              :key="conv.id"
              class="conv-item"
              :class="{ active: conv.id === copilot.activeConvId }"
              @click="switchConv(conv.id)"
            >
              <span class="conv-item-title">{{ conv.title || '新对话' }}</span>
              <span class="conv-item-count">{{ conv.messageCount }}</span>
              <button class="conv-item-del" @click="deleteConv(conv.id, $event)"><Trash2 :size="10" /></button>
            </div>
          </div>
        </div>
        <button class="hdr-btn" title="关闭" @click="copilot.close()"><X :size="13" /></button>
      </div>
    </div>

    <!-- ── Sub-header: Compare + Model (transparent floating) ─────────────── -->
    <div class="copilot-subheader">
      <!-- Second model -->
      <div ref="secondModelRoot" class="second-model-wrap">
        <button
          v-if="!copilot.secondProviderId"
          class="compare-add-btn"
          @click="secondModelOpen = !secondModelOpen"
        >
          <Plus :size="10" /><span>对比</span>
        </button>
        <div v-else class="compare-set">
          <button class="compare-label" @click="secondModelOpen = !secondModelOpen">
            <span>{{ secondProvider?.name }} · {{ secondModel?.name ?? '…' }}</span>
          </button>
          <button class="compare-clear" @click="clearSecondModel"><X :size="10" /></button>
        </div>
        <Transition name="sm-drop">
          <div v-if="secondModelOpen" class="second-model-dropdown">
            <div v-if="configuredProviders.length === 0" class="sm-empty">请先在设置中添加 API Key</div>
            <template v-else>
              <div v-for="p in configuredProviders" :key="p.id" class="sm-group">
                <div class="sm-group-label">{{ p.name }}</div>
                <button
                  v-for="m in p.models" :key="m.id"
                  class="sm-model-btn"
                  :class="{ active: copilot.secondProviderId === p.id && copilot.secondModelId === m.id }"
                  @click="selectSecondModel(p.id, m.id)"
                >
                  {{ m.name }}
                  <Check v-if="copilot.secondProviderId === p.id && copilot.secondModelId === m.id" :size="10" />
                  <span v-else class="sm-ph" />
                </button>
              </div>
            </template>
          </div>
        </Transition>
      </div>

      <ModelSelector
        :compact="!!copilot.secondProviderId"
        drop-down
        class="cp-model-sel"
        :provider-id="aiStore.paperDefaultProviderId || aiStore.activeProviderId"
        :model-id="aiStore.paperDefaultModelId || aiStore.activeModelId()"
        save-to="paper"
      />
    </div>

    <!-- ── Messages ───────────────────────────────────────────────────────── -->
    <div ref="messagesEl" class="copilot-messages" @click="handleMsgClick">
      <div v-if="copilot.isLoadingMessages" class="cp-loading">
        <div class="cp-dot" /><div class="cp-dot" style="animation-delay:.2s" /><div class="cp-dot" style="animation-delay:.4s" />
      </div>
      <div v-else-if="messages.length === 0" class="cp-empty">
        <img :src="copilotIcon" class="empty-icon-copilot" alt="Copilot" />
        <p>基于此论文开始对话</p>
        <p class="cp-empty-sub">当前使用「{{ copilot.contextMode === 'abstract' ? '摘要' : '全文' }}」模式注入上下文</p>
      </div>
      <template v-else>
        <div v-for="(msg, i) in messages" :key="msg.id" class="cp-msg" :class="msg.role">
          <!-- Context cutoff divider -->
          <div v-if="copilot.activeConv?.contextCutoffPoints?.includes(msg.id)" class="context-divider">
            <div class="context-divider-line" />
            <span class="context-divider-label">以下为发送给 AI 的上下文</span>
            <button class="context-divider-remove" title="取消此清除" @click="copilot.removeContextCutoff(msg.id)">
              <X :size="11" />
            </button>
            <div class="context-divider-line" />
          </div>
          <!-- User -->
          <template v-if="msg.role === 'user'">
            <div v-if="msg.webSearchResults?.length" class="ws-badge">
              <Globe :size="10" /> 搜索了 {{ msg.webSearchResults.length }} 条结果
            </div>
            <!-- Paper context PDF chip (first message, fulltext mode) -->
            <div v-if="i === 0 && copilot.contextMode === 'fulltext' && copilot.paperFullTextBase64" class="att-row">
              <div class="att-chip user paper-ctx-chip" @click.stop="openPdfPreview(copilot.paperFullTextBase64!)">
                <FileText :size="10" /><span>{{ paper.title.slice(0, 28) }}{{ paper.title.length > 28 ? '…' : '' }}.pdf</span>
                <button class="att-view">预览</button>
              </div>
            </div>
            <div v-if="msg.attachments?.length" class="att-row">
              <div v-for="att in msg.attachments" :key="att.id" class="att-chip user">
                <FileText :size="10" /><span>{{ att.name }}</span>
                <button v-if="att.mimeType === 'application/pdf' && att.data" class="att-view" @click.stop="openPdfPreview(att.data!)">预览</button>
              </div>
            </div>
            <!-- Edit mode -->
            <div v-if="editingMsgId === msg.id" class="edit-box">
              <textarea v-model="editText" class="edit-textarea" @keydown.esc="cancelEdit" />
              <div class="edit-actions">
                <button class="edit-cancel" @click="cancelEdit">取消</button>
                <button class="edit-confirm" @click="confirmEdit(msg)">确认</button>
              </div>
            </div>
            <template v-else>
              <div class="bubble user-bubble">
                <div class="msg-text">{{ msg.content }}</div>
              </div>
              <div class="msg-footer user-footer">
                <div class="msg-actions">
                  <button class="action-btn" :class="{ done: copyDoneIds.has(msg.id) }" title="复制" @click="copyMsg(msg)">
                    <Check v-if="copyDoneIds.has(msg.id)" :size="12" />
                    <Copy v-else :size="12" />
                  </button>
                  <button v-if="!copilot.isStreaming" class="action-btn" title="编辑并重新发送" @click="startEdit(msg)">
                    <Pencil :size="12" />
                  </button>
                  <button v-if="!copilot.isStreaming" class="action-btn danger" title="删除" @click="copilot.deleteMessage(msg.id)">
                    <Trash2 :size="12" />
                  </button>
                </div>
              </div>
            </template>
          </template>
          <!-- Assistant -->
          <template v-else-if="msg.role === 'assistant'">
            <!-- Horizontal compare mode -->
            <div v-if="msg.variants?.length && variantLayout === 'horizontal'" class="compare-cols">
              <div class="compare-col" :class="{ streaming: copilot.streamingMsgId === msg.id }">
                <div class="compare-col-header">
                  <img v-if="lookupLogoUrl(msg.model ?? '', msg.providerId ?? '')"
                       :src="lookupLogoUrl(msg.model ?? '', msg.providerId ?? '')!"
                       class="compare-logo" alt="" />
                  <img v-else :src="copilotIcon" class="compare-copilot-icon" alt="" />
                  <span class="compare-model-name">{{ modelLabel(msg.providerId, msg.model) || '模型 1' }}</span>
                  <span v-if="copilot.streamingMsgId === msg.id" class="compare-dot" />
                </div>
                <div class="msg-text markdown-body compare-content"
                  :class="{ streaming: copilot.streamingMsgId === msg.id }"
                  v-html="renderMarkdown(
                    copilot.isStreaming && i === messages.length - 1 ? copilot.streamingText : msg.content
                  )" />
              </div>
              <div v-for="v in msg.variants" :key="v.id" class="compare-col"
                   :class="{ streaming: copilot.streamingVariantMsgIds.has(msg.id) }">
                <div class="compare-col-header">
                  <img v-if="lookupLogoUrl(v.model ?? '', v.providerId ?? '')"
                       :src="lookupLogoUrl(v.model ?? '', v.providerId ?? '')!"
                       class="compare-logo" alt="" />
                  <img v-else :src="copilotIcon" class="compare-copilot-icon" alt="" />
                  <span class="compare-model-name">{{ modelLabel(v.providerId, v.model) || '模型 2' }}</span>
                  <span v-if="copilot.streamingVariantMsgIds.has(msg.id)" class="compare-dot" />
                </div>
                <div class="msg-text markdown-body compare-content"
                  :class="{ streaming: copilot.streamingVariantMsgIds.has(msg.id) }"
                  v-html="renderMarkdown(v.content)" />
              </div>
            </div>

            <!-- Tab mode (single bubble) -->
            <div v-else class="asst-msg-wrap">
              <!-- Model header row: icon + name -->
              <div class="asst-model-header">
                <img v-if="lookupLogoUrl(getDisplay(msg).model ?? '', getDisplay(msg).providerId ?? '')"
                     :src="lookupLogoUrl(getDisplay(msg).model ?? '', getDisplay(msg).providerId ?? '')!"
                     class="asst-model-logo" alt="" />
                <img v-else :src="copilotIcon" class="asst-model-copilot" alt="" />
                <span class="asst-model-name">{{ modelLabel(getDisplay(msg).providerId, getDisplay(msg).model) }}</span>
                <span v-if="copilot.isStreaming && i === messages.length - 1 && !(msgTabIdx[msg.id] ?? 0)" class="asst-streaming-dot" />
                <span v-if="copilot.streamingVariantMsgIds.has(msg.id) && (msgTabIdx[msg.id] ?? 0)" class="asst-streaming-dot" />
              </div>
              <div class="bubble asst-bubble">
                <!-- Reasoning -->
                <details v-if="getDisplay(msg).reasoning" class="reasoning-block">
                  <summary><Brain :size="11" /> 思考过程</summary>
                  <div class="reasoning-text">{{ getDisplay(msg).reasoning }}</div>
                </details>
                <!-- Content -->
                <div
                  class="msg-text markdown-body"
                  v-html="renderMarkdown(
                    copilot.isStreaming && i === messages.length - 1 && !(msgTabIdx[msg.id] ?? 0)
                      ? copilot.streamingText
                      : copilot.streamingVariantMsgIds.has(msg.id) && (msgTabIdx[msg.id] ?? 0)
                        ? copilot.streamingVariantText || getDisplay(msg).content
                        : getDisplay(msg).content
                  ) || (copilot.isStreaming && i === messages.length - 1 && !copilot.streamingText ? '' : undefined)"
                />
                <span
                  v-if="(copilot.isStreaming && i === messages.length - 1 && !(msgTabIdx[msg.id] ?? 0) && !copilot.streamingText)
                    || (copilot.streamingVariantMsgIds.has(msg.id) && (msgTabIdx[msg.id] ?? 0) && !copilot.streamingVariantText)"
                  class="cursor-blink"
                />
                <div v-if="msg.attachments?.length" class="att-row">
                  <div v-for="att in msg.attachments" :key="att.id" class="att-chip">
                    <FileText :size="10" /><span>{{ att.name }}</span>
                  </div>
                </div>
              </div>
            </div>
            <!-- Per-message footer (actions + usage) -->
            <div v-if="editingMsgId !== msg.id" class="msg-footer asst-footer">
              <div class="msg-actions">
                <button class="action-btn" :class="{ done: copyDoneIds.has(msg.id) }" title="复制" @click="copyMsg(msg)">
                  <Check v-if="copyDoneIds.has(msg.id)" :size="12" /><Copy v-else :size="12" />
                </button>
                <button v-if="!copilot.isStreaming" class="action-btn" title="编辑" @click="startEdit(msg)">
                  <Pencil :size="12" />
                </button>
                <button v-if="!copilot.isStreaming" class="action-btn" title="重新生成" @click="copilot.regenerate(msg.id)">
                  <RefreshCw :size="12" />
                </button>
                <!-- @ model picker -->
                <div v-if="!copilot.isStreaming" ref="pickerRoot" class="picker-wrap">
                  <button class="action-btn" title="用其他模型回答" @click="togglePicker(msg.id)">
                    <AtSign :size="12" />
                  </button>
                  <div v-if="pickerMsgId === msg.id" class="model-picker-popup">
                    <div v-if="configuredProviders.length === 0" class="picker-empty">请先配置 API Key</div>
                    <template v-else>
                      <div v-for="p in configuredProviders" :key="p.id" class="picker-group">
                        <div class="picker-group-label">{{ p.name }}</div>
                        <button v-for="m in p.models" :key="m.id" class="picker-model-item"
                          @click="selectModelAndRegenerate(msg, p.id, m.id)">{{ m.name || m.id }}</button>
                      </div>
                    </template>
                  </div>
                </div>
                <button v-if="!copilot.isStreaming" class="action-btn danger" title="删除" @click="copilot.deleteMessage(msg.id)">
                  <Trash2 :size="12" />
                </button>
              </div>
              <!-- Usage stats -->
              <div v-if="(!copilot.isStreaming || copilot.streamingMsgId !== msg.id) && msg.usage" class="msg-usage">
                <span v-if="msg.usage.inputTokens != null" class="usage-tokens">↑{{ msg.usage.inputTokens }}</span>
                <span v-if="msg.usage.outputTokens != null" class="usage-tokens">↓{{ msg.usage.outputTokens }}</span>
                <span v-if="msg.usage.costUsd != null" class="msg-cost">{{ statsStore.formatCost(msg.usage.costUsd) }}</span>
              </div>
            </div>

            <!-- Variant bar: layout toggle + model icon tabs -->
            <div v-if="msg.variants?.length" class="var-bar">
              <button class="var-layout-btn"
                      :title="variantLayout === 'tab' ? '分栏对比' : '标签切换'"
                      @click="variantLayout = variantLayout === 'tab' ? 'horizontal' : 'tab'">
                <Columns2 v-if="variantLayout === 'tab'" :size="13" />
                <Rows3 v-else :size="13" />
              </button>
              <div v-for="(slot, idx) in getVariantSlots(msg)" :key="idx" class="var-slot">
                <button
                  class="var-btn"
                  :class="{
                    active: variantLayout === 'tab' && (msgTabIdx[msg.id] ?? 0) === idx,
                    streaming: idx === 0 ? copilot.streamingMsgId === msg.id : copilot.streamingVariantMsgIds.has(msg.id),
                  }"
                  @click="variantLayout === 'tab' ? setTab(msg, idx) : null"
                >
                  <img v-if="lookupLogoUrl(slot.model, slot.providerId)"
                       :src="lookupLogoUrl(slot.model, slot.providerId)!"
                       class="var-btn-logo" alt="" />
                  <span v-else class="var-btn-letter">{{ slot.model.charAt(0).toUpperCase() }}</span>
                </button>
                <span class="var-tooltip">{{ modelLabel(slot.providerId, slot.model) || slot.model }}</span>
              </div>
            </div>
            <!-- Edit mode for assistant -->
            <div v-if="editingMsgId === msg.id" class="edit-box">
              <textarea v-model="editText" class="edit-textarea" @keydown.esc="cancelEdit" />
              <div class="edit-actions">
                <button class="edit-cancel" @click="cancelEdit">取消</button>
                <button class="edit-confirm" @click="confirmEdit(msg)">确认</button>
              </div>
            </div>
          </template>
        </div>
      </template>
    </div>

    <!-- ── Input area ─────────────────────────────────────────────────────── -->
    <div class="input-area">

      <!-- Context mode bar -->
      <div class="context-bar">
        <div class="context-tabs">
          <button
            class="ctx-tab"
            :class="{ active: copilot.contextMode === 'abstract' }"
            @click="setContextMode('abstract')"
          >摘要</button>
          <button
            class="ctx-tab"
            :class="{ active: copilot.contextMode === 'fulltext' }"
            :disabled="copilot.isExtractingText || !paper.pdf_downloaded"
            :title="!paper.pdf_downloaded ? '需要先下载论文才能使用全文模式' : undefined"
            @click="setContextMode('fulltext')"
          >
            <span v-if="copilot.isExtractingText" class="btn-spin-sm" />
            {{ copilot.isExtractingText ? '提取中…' : '全文' }}
          </button>
        </div>
        <button
          v-if="contextPreviewText"
          class="ctx-view-btn"
          title="查看注入内容"
          @click="showContextPreview = !showContextPreview"
        >
          <Eye :size="11" />
          查看
        </button>
      </div>

      <!-- Full text error -->
      <div v-if="copilot.fullTextError && copilot.contextMode === 'fulltext'" class="fulltext-error">
        {{ copilot.fullTextError }}
        <button @click="copilot.extractFullText(paper.id, paper.source ?? 'arxiv')">重试</button>
      </div>

      <!-- Context preview -->
      <div v-if="showContextPreview && contextPreviewText" class="ctx-preview">
        <div class="ctx-preview-header">
          <span>{{ copilot.contextMode === 'abstract' ? '摘要内容' : '全文内容' }}（将注入为 System Prompt）</span>
          <button @click="showContextPreview = false"><X :size="11" /></button>
        </div>
        <div class="ctx-preview-body">{{ contextPreviewText }}</div>
      </div>

      <!-- Pending files -->
      <div v-if="pendingFiles.length > 0 || pdfLoading" class="pending-files">
        <div v-if="pdfLoading" class="file-chip loading"><FileText :size="12" /><span>正在解析…</span></div>
        <template v-for="f in pendingFiles" :key="f.id">
          <div v-if="f.mimeType?.startsWith('image/')" class="img-wrap">
            <img :src="`data:${f.mimeType};base64,${f.data}`" class="thumb" />
            <button class="rm-btn" @click="removeFile(f.id)"><X :size="9" /></button>
          </div>
          <div v-else class="file-chip">
            <FileText :size="12" /><span>{{ f.name }}</span>
            <span v-if="f.pageCount" class="chip-pages">{{ f.pageCount }}页</span>
            <button class="rm-btn inline" @click="removeFile(f.id)"><X :size="9" /></button>
          </div>
        </template>
      </div>
      <div v-if="pdfWarning" class="pdf-warn">{{ pdfWarning }}</div>

      <!-- Input box -->
      <div class="input-box">
        <textarea
          ref="textareaEl"
          v-model="inputText"
          class="input-textarea"
          :placeholder="isFullTextUnavailable ? '请先下载论文以使用全文分析功能' : '输入消息…'"
          rows="1"
          :disabled="isFullTextUnavailable"
          @keydown="handleKeydown"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @paste="handlePaste"
        />

        <!-- Toolbar — identical order to ChatPanel -->
        <div class="input-toolbar">
          <!-- New conversation -->
          <button class="toolbar-btn" title="新建对话" @click="newConv">
            <SquarePen :size="15" />
          </button>
          <!-- Attach file -->
          <button class="toolbar-btn" title="附加图片或 PDF" :disabled="pdfLoading" @click="pickFile">
            <Paperclip :size="15" />
          </button>
          <!-- Web search -->
          <button
            class="toolbar-btn"
            :class="{ 'toolbar-btn-active': copilot.webSearchEnabled }"
            :title="hasWebSearch ? '联网搜索' : '联网搜索（请先在设置中配置 API Key）'"
            @click="hasWebSearch && (copilot.webSearchEnabled = !copilot.webSearchEnabled)"
          >
            <Globe :size="15" />
          </button>
          <!-- Reasoning -->
          <div ref="reasoningRoot" class="reasoning-wrap">
            <button
              class="toolbar-btn"
              :class="[
                { 'toolbar-btn-active': copilot.useReasoning },
                copilot.useReasoning ? `reasoning-active-${copilot.reasoningLevel}` : ''
              ]"
              title="推理设置"
              @click="reasoningOpen = !reasoningOpen"
            >
              <Brain :size="15" />
              <span v-if="copilot.useReasoning" class="reasoning-badge">
                {{ copilot.reasoningLevel === 'low' ? '低' : copilot.reasoningLevel === 'medium' ? '中' : '高' }}
              </span>
            </button>
            <Transition name="reasoning-drop">
              <div v-if="reasoningOpen" class="reasoning-popover">
                <div class="reasoning-row">
                  <span class="reasoning-label">推理模式</span>
                  <button
                    class="reasoning-toggle"
                    :class="{ on: copilot.useReasoning }"
                    @click="copilot.setReasoning(!copilot.useReasoning)"
                  ><span class="toggle-knob" /></button>
                </div>
                <div v-if="copilot.useReasoning && activeProviderType !== 'ollama' && activeProviderType !== 'google'" class="reasoning-levels">
                  <template v-if="isDeepSeek">
                    <button
                      v-for="lv in (['high', 'max'] as const)"
                      :key="lv"
                      class="level-btn"
                      :class="{ active: lv === 'high' ? copilot.reasoningLevel === 'medium' : copilot.reasoningLevel === 'high' }"
                      @click="copilot.setReasoningLevel(lv === 'high' ? 'medium' : 'high')"
                    >{{ lv }}</button>
                  </template>
                  <template v-else>
                    <button
                      v-for="lv in (['low', 'medium', 'high'] as const)"
                      :key="lv"
                      class="level-btn"
                      :class="{ active: copilot.reasoningLevel === lv }"
                      @click="copilot.setReasoningLevel(lv)"
                    >{{ lv === 'low' ? '低' : lv === 'medium' ? '中' : '高' }}</button>
                  </template>
                </div>
                <div v-if="activeProviderType === 'google'" class="reasoning-hint">Google 暂不支持推理模式</div>
              </div>
            </Transition>
          </div>
          <!-- Clear context -->
          <button
            class="toolbar-btn"
            :class="{ 'toolbar-btn-active': !!(copilot.activeConv?.contextCutoffPoints?.length) }"
            title="清除上下文（不删除记录，仅减少发送给 AI 的历史）"
            @click="copilot.clearContext()"
          >
            <Eraser :size="15" />
          </button>

          <span class="toolbar-spacer" />

          <!-- Stop / Send -->
          <button v-if="copilot.isStreaming" class="send-btn stop" @click="copilot.stopStreaming()">
            <Square :size="15" />
          </button>
          <button v-else class="send-btn" :class="{ active: canSend }" :disabled="!canSend" @click="send()">
            <Send :size="15" />
          </button>
        </div>
      </div>

      <input ref="fileInput" type="file" class="hidden-input" accept="image/*,.pdf" multiple @change="handleFileChange" />
    </div>

    <!-- PDF preview -->
    <Teleport to="body">
      <div v-if="pdfPreviewSrc" class="pdf-overlay" @click.self="closePdfPreview">
        <div class="pdf-modal">
          <button class="pdf-close" @click="closePdfPreview">✕</button>
          <iframe :src="pdfPreviewSrc" class="pdf-frame" />
        </div>
      </div>
    </Teleport>

  </div>
</template>

<style scoped>
/* ── Panel ────────────────────────────────────────────────────────────────── */
.copilot-panel {
  min-width: 300px;
  max-width: 720px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f5f5f7;
  border-left: 1px solid rgba(0,0,0,0.06);
  flex-shrink: 0;
  position: relative;
  user-select: none;
}
.copilot-panel.resizing { cursor: col-resize; }

.resize-handle {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 5px;
  cursor: col-resize;
  z-index: 10;
}
.resize-handle:hover,
.copilot-panel.resizing .resize-handle { background: rgba(74,123,200,0.2); }

/* ── Header ───────────────────────────────────────────────────────────────── */
.copilot-header {
  height: 44px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  background: #ffffff;
  flex-shrink: 0;
  gap: 6px;
}
.header-left {
  display: flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; flex: 1;
}
.copilot-header-icon { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.7; }
.copilot-title { font-size: 12.5px; font-weight: 600; color: #1c1c1e; flex-shrink: 0; }
.copilot-subtitle { font-size: 11px; color: #8e8e93; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header-right { display: flex; align-items: center; gap: 1px; flex-shrink: 0; }

.hdr-btn {
  width: 26px; height: 26px;
  border: none; background: transparent; color: #8e8e93;
  border-radius: 7px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.12s, color 0.12s;
}
.hdr-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }

/* Settings popover */
.settings-wrap { position: relative; }
.settings-popover {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  width: 180px;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.10);
  z-index: 300;
  padding: 4px 0;
}
.sp-title { padding: 5px 12px 3px; font-size: 10.5px; font-weight: 600; color: #8e8e93; }
.sp-option {
  display: flex; align-items: center; gap: 7px;
  width: 100%; padding: 6px 12px;
  background: transparent; border: none; text-align: left;
  font-size: 12px; color: #1c1c1e; cursor: pointer;
}
.sp-option:hover { background: rgba(0,0,0,0.04); }
.sp-option.active { color: #4a7bc8; }
.sp-dot { width: 10px; height: 10px; flex-shrink: 0; }
.sp-divider { height: 1px; background: rgba(0,0,0,0.06); margin: 6px 10px; }
.sp-model-row {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 10px;
}
.sp-clear-btn {
  width: 22px; height: 22px;
  border: none; background: transparent; color: #c7c7cc;
  border-radius: 5px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
}
.sp-clear-btn:hover { background: rgba(0,0,0,0.06); color: #ff3b30; }
.sp-hint {
  padding: 2px 12px 6px;
  font-size: 10px; color: #aeaeb2;
}

/* Conversation dropdown */
.conv-wrap { position: relative; display: flex; }
.conv-dropdown {
  position: absolute;
  top: calc(100% + 4px); right: 0;
  width: 210px; background: #fff;
  border: 1px solid rgba(0,0,0,0.08); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.10);
  z-index: 200; max-height: 240px; overflow-y: auto; padding: 3px 0;
}
.conv-item {
  display: flex; align-items: center; gap: 7px;
  padding: 7px 12px; cursor: pointer; transition: background 0.1s;
}
.conv-item:hover { background: rgba(0,0,0,0.04); }
.conv-item.active { background: rgba(74,123,200,0.07); }
.conv-item-title { flex: 1; font-size: 12px; color: #1c1c1e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conv-item-count { font-size: 10.5px; color: #aeaeb2; }
.conv-item-del {
  border: none; background: transparent; color: #c7c7cc;
  width: 18px; height: 18px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0;
}
.conv-item:hover .conv-item-del { opacity: 1; }
.conv-item-del:hover { color: #ef4444; }

/* ── Sub-header ───────────────────────────────────────────────────────────── */
.copilot-subheader {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px 5px 14px;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(0,0,0,0.05);
  flex-shrink: 0;
}

.cp-model-sel { min-width: 0; }

/* Second model */
.second-model-wrap { position: relative; flex-shrink: 0; margin-left: auto; }
.compare-add-btn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 9px;
  border: 1px solid rgba(0,0,0,0.12); border-radius: 6px;
  background: transparent; color: #6e6e73; font-size: 11.5px;
  cursor: pointer; transition: all 0.12s;
}
.compare-add-btn:hover { background: rgba(0,0,0,0.05); border-color: rgba(0,0,0,0.18); }
.compare-set { display: flex; align-items: center; gap: 2px; }
.compare-label {
  display: inline-flex; align-items: center;
  padding: 3px 8px;
  border: 1px solid rgba(74,123,200,0.3); border-radius: 6px 0 0 6px;
  background: rgba(74,123,200,0.07); color: #4a7bc8; font-size: 11.5px;
  cursor: pointer;
}
.compare-clear {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  border: 1px solid rgba(74,123,200,0.3); border-left: none; border-radius: 0 6px 6px 0;
  background: rgba(74,123,200,0.07); color: #4a7bc8; cursor: pointer;
}
.compare-clear:hover { background: rgba(239,68,68,0.07); color: #ef4444; border-color: rgba(239,68,68,0.2); }

.second-model-dropdown {
  position: absolute; top: calc(100% + 4px); left: 0;
  width: 220px; background: #fff;
  border: 1px solid rgba(0,0,0,0.08); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.10);
  z-index: 300; max-height: 280px; overflow-y: auto; padding: 4px 0;
}
.sm-empty { padding: 10px 12px; font-size: 12px; color: #aeaeb2; }
.sm-group { border-top: 1px solid rgba(0,0,0,0.05); }
.sm-group:first-of-type { border-top: none; }
.sm-group-label { padding: 5px 12px 2px; font-size: 10.5px; color: #8e8e93; font-weight: 500; }
.sm-model-btn {
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 5px 12px;
  background: transparent; border: none;
  font-size: 12px; color: #1c1c1e; text-align: left; cursor: pointer;
}
.sm-model-btn:hover { background: rgba(0,0,0,0.04); }
.sm-model-btn.active { color: #4a7bc8; background: rgba(74,123,200,0.06); }
.sm-ph { width: 10px; flex-shrink: 0; }

/* ── Messages ─────────────────────────────────────────────────────────────── */
.copilot-messages {
  flex: 1; overflow-y: auto;
  padding: 12px 12px 6px;
  display: flex; flex-direction: column; gap: 10px;
  min-height: 0; user-select: text;
}
.copilot-messages::-webkit-scrollbar { width: 3px; }
.copilot-messages::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.08); border-radius: 2px; }

.cp-loading { display: flex; align-items: center; justify-content: center; gap: 5px; padding: 20px 0; }
.cp-dot { width: 6px; height: 6px; border-radius: 50%; background: #4a7bc8; animation: cp-pulse 1.2s ease-in-out infinite; }
@keyframes cp-pulse { 0%,100%{opacity:.3;transform:scale(.7)} 50%{opacity:1;transform:scale(1)} }

.cp-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; padding: 24px 12px; text-align: center; color: #aeaeb2; gap: 6px;
}
.empty-icon-copilot { width: 28px; height: 28px; opacity: 0.35; margin-bottom: 4px; }
.cp-empty p { margin: 0; font-size: 12.5px; }
.cp-empty-sub { font-size: 11px !important; color: #c7c7cc !important; }

.cp-msg { display: flex; flex-direction: column; gap: 3px; }
.cp-msg.user { align-items: flex-end; }
.cp-msg.assistant { align-items: flex-start; }

.ws-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10.5px; color: #4a7bc8;
  background: rgba(74,123,200,0.08); padding: 2px 7px; border-radius: 5px;
}
.att-row { display: flex; flex-wrap: wrap; gap: 4px; }
.att-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; background: rgba(0,0,0,0.05); border-radius: 6px;
  font-size: 11px; color: #6e6e73;
}
.att-chip.user { background: rgba(0,0,0,0.06); color: #6e6e73; }
.att-view { cursor: pointer; text-decoration: underline; font-size: 10.5px; margin-left: 3px; }

.bubble.user-bubble {
  background: #f0f0f5; color: #1c1c1e;
  border-radius: 16px 4px 16px 16px;
  padding: 8px 12px 5px; max-width: 88%;
  border: 1px solid rgba(0, 0, 0, 0.06);
}
.bubble-wrap { display: flex; align-items: flex-start; gap: 5px; max-width: 96%; width: 100%; }
.cp-avatar {
  width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 2px; color: #8e8e93;
}
.cp-avatar-logo { width: 22px; height: 22px; object-fit: contain; }
.cp-avatar-copilot { width: 22px; height: 22px; opacity: 0.6; }
.bubble.asst-bubble {
  display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1;
}

/* ─── Assistant message with model header ──────────────────────────────── */
.asst-msg-wrap { display: flex; flex-direction: column; gap: 4px; max-width: 96%; width: 100%; }
.asst-model-header {
  display: flex; align-items: center; gap: 5px;
  padding-left: 0; margin-bottom: 2px;
}
.asst-model-logo { width: 21px; height: 21px; object-fit: contain; flex-shrink: 0; }
.asst-model-copilot { width: 14px; height: 14px; opacity: 0.6; flex-shrink: 0; }
.asst-model-name { font-size: 11.5px; color: #6e6e73; font-weight: 500; }

.asst-streaming-dot {
  width: 5px; height: 5px; border-radius: 50%; background: #4a7bc8;
  animation: cp-blink 1s step-end infinite;
}

/* ─── Horizontal compare layout ─────────────────────────────────────────── */
.compare-cols {
  display: flex; gap: 8px; width: 100%; min-width: 0;
}
.compare-col {
  flex: 1; min-width: 0; border: 1px solid rgba(0,0,0,0.08); border-radius: 10px;
  background: #fff; overflow: hidden;
}
.compare-col-header {
  display: flex; align-items: center; gap: 5px; padding: 6px 10px;
  background: rgba(0,0,0,0.025); border-bottom: 1px solid rgba(0,0,0,0.06);
  font-size: 11px; color: #6e6e73;
}
.compare-logo { width: 13px; height: 13px; object-fit: contain; flex-shrink: 0; }
.compare-copilot-icon { width: 12px; height: 12px; opacity: 0.6; }
.compare-model-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: #6e6e73; }
.compare-dot { width: 6px; height: 6px; border-radius: 50%; background: #4a7bc8; flex-shrink: 0; animation: cp-blink 1s step-end infinite; }
.compare-content { padding: 8px 10px; font-size: 13px; }

/* ─── Variant bar ────────────────────────────────────────────────────────── */
.var-bar {
  display: flex; align-items: center; gap: 4px; padding-left: 29px; margin-top: 4px;
  padding-top: 6px; border-top: 1px solid rgba(0,0,0,0.06);
}
.var-layout-btn {
  width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.10);
  background: transparent; color: #8e8e93; display: flex; align-items: center;
  justify-content: center; cursor: pointer; transition: background 0.12s, color 0.12s;
  flex-shrink: 0; margin-right: 2px;
}
.var-layout-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }

.var-slot { position: relative; }
.var-btn {
  width: 26px; height: 26px; border-radius: 8px; border: 2px solid transparent;
  background: rgba(0,0,0,0.04); padding: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.12s, background 0.12s; overflow: hidden;
}
.var-btn:hover { background: rgba(0,0,0,0.08); }
.var-btn.active { border-color: #4a7bc8; background: rgba(74,123,200,0.08); }
@keyframes var-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(74,123,200,0.4); }
  70%  { box-shadow: 0 0 0 4px rgba(74,123,200,0); }
  100% { box-shadow: 0 0 0 0 rgba(74,123,200,0); }
}
.var-btn.streaming { animation: var-pulse 1.2s ease-out infinite; }
.var-btn-logo { width: 20px; height: 20px; object-fit: contain; }
.var-btn-letter { font-size: 11px; font-weight: 700; color: #8e8e93; }
.var-tooltip {
  position: absolute; bottom: calc(100% + 5px); left: 50%; transform: translateX(-50%);
  background: rgba(28,28,30,0.88); color: white; font-size: 10px; white-space: nowrap;
  padding: 3px 7px; border-radius: 5px; pointer-events: none; opacity: 0;
  transition: opacity 0.08s; z-index: 10;
}
.var-slot:hover .var-tooltip { opacity: 1; }

/* Reasoning */
.reasoning-block {
  border: 1px solid rgba(74,123,200,0.15); border-radius: 8px;
  background: rgba(74,123,200,0.04); overflow: hidden;
}
.reasoning-block summary {
  padding: 5px 10px; font-size: 11px; color: #4a7bc8;
  cursor: pointer; font-weight: 500; user-select: none;
  display: flex; align-items: center; gap: 5px;
}
.reasoning-text {
  padding: 5px 10px 8px; font-size: 11.5px; color: #6e6e73;
  line-height: 1.6; white-space: pre-wrap;
  border-top: 1px solid rgba(74,123,200,0.1); max-height: 200px; overflow-y: auto;
}

.msg-text { font-size: 13px; line-height: 1.65; word-break: break-word; }
.bubble.user-bubble .msg-text { color: #1c1c1e; white-space: pre-wrap; }
.bubble.asst-bubble .msg-text.markdown-body {
  background: transparent;
  border-radius: 4px 14px 14px 14px; padding: 10px 13px;
}
.compare-content.streaming::after {
  content: '▋';
  display: inline-block;
  animation: cp-blink 0.7s step-end infinite;
  color: #4a7bc8;
  margin-left: 2px;
}

.cursor-blink {
  display: inline-block; width: 2px; height: 13px;
  background: #4a7bc8; vertical-align: middle; margin-left: 1px;
  animation: cp-blink 1s step-end infinite;
}
@keyframes cp-blink { 0%,100%{opacity:1} 50%{opacity:0} }

/* Markdown */
:deep(.markdown-body) { user-select: text; }
:deep(.markdown-body p) { margin: 0 0 0.6em; }
:deep(.markdown-body p:last-child) { margin-bottom: 0; }
:deep(.markdown-body h1),:deep(.markdown-body h2),:deep(.markdown-body h3) { font-weight: 600; margin: 0.8em 0 0.4em; line-height: 1.3; }
:deep(.markdown-body h1) { font-size: 1.15em; }
:deep(.markdown-body h2) { font-size: 1.05em; }
:deep(.markdown-body h3) { font-size: 0.95em; }
:deep(.markdown-body ul),:deep(.markdown-body ol) { padding-left: 1.4em; margin: 0.4em 0; }
:deep(.markdown-body li) { margin: 0.15em 0; }
:deep(.markdown-body blockquote) {
  border-left: 3px solid rgba(74,123,200,0.35); margin: 0.5em 0;
  padding: 0.2em 0.8em; color: #6e6e73; background: rgba(0,0,0,0.02); border-radius: 0 6px 6px 0;
}
:deep(.inline-code) { background: rgba(0,0,0,0.06); border-radius: 3px; padding: 1px 5px; font-family: 'SF Mono', monospace; font-size: 0.88em; }
:deep(.code-block) { background: #1e1e2e; border-radius: 8px; overflow: hidden; margin: 0.5em 0; font-size: 12px; }
:deep(.code-header) { display: flex; align-items: center; justify-content: space-between; padding: 5px 12px; background: rgba(255,255,255,0.06); }
:deep(.code-lang) { font-size: 11px; color: rgba(255,255,255,0.45); font-family: 'SF Mono', monospace; }
:deep(.copy-btn) { background: transparent; border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.5); border-radius: 4px; padding: 1px 8px; font-size: 10.5px; cursor: pointer; }
:deep(.copy-btn:hover) { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.8); }
:deep(.code-block pre) { margin: 0; padding: 10px 14px; overflow-x: auto; }
:deep(.code-block code) { font-family: 'SF Mono', 'Fira Code', monospace; line-height: 1.55; }
:deep(.markdown-link) { color: #4a7bc8; text-decoration: underline; cursor: pointer; }
:deep(table) { border-collapse: collapse; width: 100%; margin: 0.4em 0; font-size: 12.5px; }
:deep(th),:deep(td) { border: 1px solid rgba(0,0,0,0.1); padding: 4px 10px; }
:deep(th) { background: rgba(0,0,0,0.04); font-weight: 600; }

/* ── Input area ───────────────────────────────────────────────────────────── */
.input-area {
  flex-shrink: 0;
  padding: 6px 10px 10px;
  background: #f5f5f7;
  display: flex; flex-direction: column; gap: 5px;
}

/* Context bar */
.context-bar {
  display: flex; align-items: center; gap: 6px; padding: 0 2px;
}
.context-tabs { display: flex; gap: 2px; }
.ctx-tab {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 10px;
  border: 1.5px solid rgba(0,0,0,0.08); border-radius: 6px;
  background: rgba(255,255,255,0.7); color: #6e6e73;
  font-size: 11.5px; font-weight: 500; cursor: pointer; transition: all 0.12s;
}
.ctx-tab.active { background: rgba(74,123,200,0.1); border-color: rgba(74,123,200,0.25); color: #4a7bc8; }
.ctx-tab:disabled { opacity: 0.6; cursor: not-allowed; }
.ctx-view-btn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 8px;
  border: 1px solid rgba(0,0,0,0.08); border-radius: 6px;
  background: transparent; color: #8e8e93; font-size: 11px;
  cursor: pointer; margin-left: auto;
}
.ctx-view-btn:hover { background: rgba(0,0,0,0.05); color: #3c3c43; }

.btn-spin-sm {
  display: inline-block; width: 9px; height: 9px;
  border: 1.5px solid rgba(74,123,200,0.2); border-top-color: #4a7bc8;
  border-radius: 50%; animation: cp-rotate 0.7s linear infinite;
}
@keyframes cp-rotate { to { transform: rotate(360deg); } }

/* Context preview */
.ctx-preview {
  background: rgba(255,255,255,0.9); border: 1px solid rgba(0,0,0,0.07);
  border-radius: 8px; overflow: hidden; max-height: 180px; display: flex; flex-direction: column;
}
.ctx-preview-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 10px; background: rgba(0,0,0,0.03);
  font-size: 11px; color: #6e6e73; font-weight: 500; flex-shrink: 0;
}
.ctx-preview-header button { border: none; background: transparent; color: #8e8e93; cursor: pointer; display: flex; align-items: center; }
.ctx-preview-body {
  padding: 6px 10px 8px; font-size: 11.5px; line-height: 1.55; color: #3c3c43;
  overflow-y: auto; white-space: pre-wrap; word-break: break-word;
}
.ctx-preview-body::-webkit-scrollbar { width: 3px; }
.ctx-preview-body::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.08); border-radius: 2px; }

/* Pending files */
.pending-files { display: flex; flex-wrap: wrap; gap: 5px; }
.img-wrap { position: relative; display: inline-block; }
.thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; border: 1px solid rgba(0,0,0,0.08); }
.file-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; background: rgba(74,123,200,0.08);
  border: 1px solid rgba(74,123,200,0.15); border-radius: 6px;
  font-size: 11px; color: #4a7bc8; max-width: 180px;
}
.file-chip.loading { color: #8e8e93; background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.08); }
.file-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-pages { color: #aeaeb2; font-size: 10px; flex-shrink: 0; }
.rm-btn {
  position: absolute; top: -4px; right: -4px;
  width: 16px; height: 16px; border-radius: 50%;
  background: rgba(0,0,0,0.55); border: none; color: white;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.rm-btn.inline { position: static; background: transparent; color: #aeaeb2; width: 14px; height: 14px; flex-shrink: 0; }
.rm-btn.inline:hover { color: #ef4444; }
.pdf-warn { font-size: 11px; color: #b45309; background: #fef3c7; border: 1px solid #fde68a; border-radius: 6px; padding: 4px 9px; }

.fulltext-error {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 5px 10px; background: #fef2f2; border: 1px solid #fecaca;
  border-radius: 7px; font-size: 11.5px; color: #b91c1c;
}
.fulltext-error button {
  flex-shrink: 0; padding: 2px 8px; border: 1px solid #f87171;
  border-radius: 5px; background: transparent; color: #b91c1c;
  font-size: 11px; cursor: pointer;
}
.fulltext-error button:hover { background: rgba(239,68,68,0.08); }

.paper-ctx-chip { cursor: pointer; }
.paper-ctx-chip:hover { background: rgba(74,123,200,0.14) !important; }

/* Input box */
.input-box {
  background: #fff;
  border: 1.5px solid rgba(0,0,0,0.08); border-radius: 13px;
  display: flex; flex-direction: column;
}
.input-box:focus-within { border-color: rgba(74,123,200,0.35); }

.input-textarea {
  width: 100%; background: transparent; border: none; outline: none; resize: none;
  font-size: 13px; line-height: 1.55; color: #1c1c1e; font-family: inherit;
  max-height: 160px; overflow-y: auto; padding: 10px 12px 0; user-select: text;
}
.input-textarea::placeholder { color: #aeaeb2; }
.input-textarea:disabled { cursor: not-allowed; }
.input-textarea::-webkit-scrollbar { width: 2px; }
.input-textarea::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.08); border-radius: 2px; }

/* Toolbar */
.input-toolbar {
  display: flex; align-items: center;
  padding: 5px 7px 7px; gap: 1px;
}
.toolbar-spacer { flex: 1; }

.toolbar-btn {
  width: 30px; height: 30px; border: none; background: transparent;
  color: #8e8e93; border-radius: 8px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.12s, color 0.12s; position: relative; flex-shrink: 0;
}
.toolbar-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }
.toolbar-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.toolbar-btn-active { color: #4a7bc8 !important; background: rgba(74,123,200,0.08) !important; }

/* Reasoning */
.reasoning-wrap { position: relative; }
.reasoning-badge {
  position: absolute; top: 2px; right: 2px;
  font-size: 8px; font-weight: 700; color: #4a7bc8;
  background: rgba(74,123,200,0.15); border-radius: 3px; padding: 0 2px; line-height: 1.4;
}
.reasoning-popover {
  position: absolute; bottom: calc(100% + 6px); left: 0;
  width: 176px; background: #fff;
  border: 1px solid rgba(0,0,0,0.08); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.10); z-index: 300; padding: 10px;
}
.reasoning-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.reasoning-label { font-size: 12.5px; color: #1c1c1e; font-weight: 500; }
.reasoning-toggle {
  width: 34px; height: 20px; border-radius: 10px;
  background: #d1d1d6; border: none; cursor: pointer;
  position: relative; transition: background 0.2s;
}
.reasoning-toggle.on { background: #4a7bc8; }
.toggle-knob {
  position: absolute; top: 2px; left: 2px;
  width: 16px; height: 16px; border-radius: 50%; background: white;
  transition: transform 0.2s; display: block;
}
.reasoning-toggle.on .toggle-knob { transform: translateX(14px); }
.reasoning-levels { display: flex; gap: 4px; }
.level-btn {
  flex: 1; padding: 4px 0;
  border: 1px solid rgba(0,0,0,0.08); border-radius: 6px;
  background: transparent; font-size: 12px; color: #6e6e73; cursor: pointer;
}
.level-btn.active { background: rgba(74,123,200,0.1); border-color: rgba(74,123,200,0.25); color: #4a7bc8; }
.reasoning-hint { font-size: 11px; color: #8e8e93; margin-top: 6px; }
.reasoning-drop-enter-active, .reasoning-drop-leave-active { transition: opacity 0.1s, transform 0.1s; }
.reasoning-drop-enter-from, .reasoning-drop-leave-to { opacity: 0; transform: translateY(4px); }

.send-btn {
  width: 30px; height: 30px; border: none; border-radius: 8px;
  background: rgba(0,0,0,0.07); color: rgba(0,0,0,0.22);
  display: flex; align-items: center; justify-content: center;
  cursor: not-allowed; transition: background 0.15s, color 0.15s; flex-shrink: 0;
}
.send-btn.active { background: #4a7bc8; color: white; cursor: pointer; }
.send-btn.active:hover { background: #264178; }
.send-btn.stop { background: rgba(0,0,0,0.09); color: #3c3c43; cursor: pointer; }
.send-btn.stop:hover { background: rgba(0,0,0,0.15); }

.hidden-input { display: none; }

/* ── Context divider ──────────────────────────────────────────────────────── */
.context-divider {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 0; user-select: none;
}
.context-divider-line {
  flex: 1; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(34, 63, 121, 0.25), transparent);
}
.context-divider-label {
  font-size: 11px; color: rgba(34, 63, 121, 0.6);
  white-space: nowrap; font-weight: 500;
}
.context-divider-remove {
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border: none;
  background: rgba(34, 63, 121, 0.08); color: rgba(34, 63, 121, 0.5);
  border-radius: 50%; cursor: pointer; flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}
.context-divider-remove:hover {
  background: rgba(34, 63, 121, 0.16); color: rgba(34, 63, 121, 0.8);
}

/* ── PDF preview ──────────────────────────────────────────────────────────── */
.pdf-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 9999;
  display: flex; align-items: center; justify-content: center;
}
.pdf-modal {
  position: relative; width: 82vw; height: 88vh;
  background: #fff; border-radius: 12px; overflow: hidden;
  box-shadow: 0 24px 64px rgba(0,0,0,0.35);
}
.pdf-frame { width: 100%; height: 100%; border: none; }
.pdf-close {
  position: absolute; top: 10px; right: 14px; z-index: 1;
  background: rgba(0,0,0,0.12); border: none; border-radius: 50%;
  width: 28px; height: 28px; font-size: 13px; cursor: pointer; color: #333;
  display: flex; align-items: center; justify-content: center;
}
.pdf-close:hover { background: rgba(0,0,0,0.22); }

.sm-drop-enter-active, .sm-drop-leave-active { transition: opacity 0.1s, transform 0.1s; }
.sm-drop-enter-from, .sm-drop-leave-to { opacity: 0; transform: translateY(-4px); }

/* ── Per-message footer ───────────────────────────────────────────────────── */
.msg-footer {
  display: flex;
  align-items: center;
  min-height: 22px;
  gap: 4px;
  padding-left: 0;
  opacity: 0;
  transition: opacity 0.15s;
  justify-content: space-between;
}
.cp-msg.assistant:hover .msg-footer { opacity: 1; }
.user-footer { justify-content: flex-end; padding-left: 0; padding-right: 2px; opacity: 0; transition: opacity 0.15s; }
.cp-msg.user:hover .user-footer { opacity: 1; }

.msg-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.action-btn {
  width: 24px; height: 24px;
  border: none; background: transparent;
  color: #aeaeb2; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}
.action-btn:hover { background: rgba(0,0,0,0.07); color: #3c3c43; }
.action-btn.done  { color: #22c55e; }
.action-btn.danger:hover { background: rgba(239,68,68,0.10); color: #ef4444; }

/* Edit inline */
.edit-box { display: flex; flex-direction: column; gap: 6px; width: 100%; margin-top: 4px; }
.edit-textarea {
  width: 100%; min-height: 80px; max-height: 240px;
  padding: 8px 10px; font-size: 13px; line-height: 1.55; font-family: inherit;
  border: 1.5px solid rgba(74,123,200,0.35); border-radius: 8px;
  background: #fff; outline: none; resize: vertical; color: #1c1c1e; box-sizing: border-box;
}
.edit-actions { display: flex; gap: 6px; justify-content: flex-end; }
.edit-cancel, .edit-confirm {
  padding: 5px 13px; border-radius: 7px; font-size: 12px; font-weight: 500; cursor: pointer; border: none;
}
.edit-cancel  { background: rgba(0,0,0,0.06); color: #3c3c43; }
.edit-cancel:hover  { background: rgba(0,0,0,0.10); }
.edit-confirm { background: #4a7bc8; color: white; }
.edit-confirm:hover { background: #264178; }

/* @ model picker */
.picker-wrap { position: relative; }
.model-picker-popup {
  position: absolute; bottom: calc(100% + 4px); left: 0;
  width: 200px; background: #fff; border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  z-index: 400; max-height: 240px; overflow-y: auto; padding: 4px 0;
}
.picker-group { }
.picker-group-label {
  padding: 5px 12px 2px; font-size: 10.5px; color: #8e8e93; font-weight: 500;
}
.picker-model-item {
  display: block; width: 100%; padding: 5px 12px; background: transparent;
  border: none; font-size: 12px; color: #1c1c1e; text-align: left; cursor: pointer;
}
.picker-model-item:hover { background: rgba(0,0,0,0.04); }

/* Usage stats */
.msg-usage {
  display: flex; align-items: center; flex-wrap: wrap; gap: 5px;
  font-size: 10.5px; color: #aeaeb2;
  margin-left: auto;
  padding-left: 8px;
  justify-content: flex-end;
  flex: 1;
}
.msg-model-name {
  display: inline-flex; align-items: center; gap: 3px; color: #c7c7cc;
}
.msg-model-logo { width: 11px; height: 11px; object-fit: contain; opacity: 0.7; }
.msg-model-copilot { width: 11px; height: 11px; opacity: 0.4; }
.msg-cost { color: #f59e0b; }
.msg-duration {
  display: inline-flex; align-items: center; gap: 2px;
}

</style>
