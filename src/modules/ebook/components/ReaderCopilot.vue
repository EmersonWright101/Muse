<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted, reactive } from 'vue'
import {
  Send, Square, X, Eraser, SquarePen, Paperclip, Globe, Brain,
  FileText, Check, Plus, Eye, Copy, RefreshCw, History, Trash2, AtSign, Pencil,
  Columns2, Rows3, Download,
} from 'lucide-vue-next'
import AudioPlayer from '../../chat/components/AudioPlayer.vue'
import copilotIcon from '../../../assets/icons/copilot.svg'
import { useAiSettingsStore, calculateModelCost } from '../../../stores/aiSettings'
import { recordEbookCopilotUsage } from '../../../stores/ebook'
import { useWebSearchStore } from '../../../stores/webSearch'
import { useEbookStore, type CopilotSession } from '../../../stores/ebook'
import { streamCopilotCompletion, type CopilotStreamHandler } from '../../../composables/useCopilotStream'
import { performSearch, formatSearchResultsForContext } from '../../../services/webSearch'
import { processPdfFile } from '../../../utils/pdf'
import ModelSelector from '../../chat/components/ModelSelector.vue'
import MarkdownBody from '../../../components/MarkdownBody.vue'
import type { AttachmentMeta } from '../../../stores/chat'
import type { Book } from '../../../stores/ebook'

const props = defineProps<{
  book: Book
  chapterText: string
  pageText: string
  chapterTitle: string
  selectedText: string
}>()

const emit = defineEmits<{ close: [] }>()

interface ChatVariant {
  id: string
  content: string
  model?: string
  providerId?: string
  error?: boolean
  mediaOutputs?: Array<{ mimeType: string; data?: string; url?: string }>
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  model?: string
  providerId?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    costUsd?: number
    durationMs?: number
  }
  error?: boolean
  attachments?: AttachmentMeta[]
  webSearchCount?: number
  variants?: ChatVariant[]
  activeVariantIdx?: number
  mediaOutputs?: Array<{ mimeType: string; data?: string; url?: string }>
}

const aiStore = useAiSettingsStore()
const wsStore = useWebSearchStore()
const ebookStore = useEbookStore()

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

const panelWidth = ref(420)
const isResizing = ref(false)
const dragState = ref<{ startX: number; startW: number } | null>(null)
const messages = ref<ChatMessage[]>([])
const contextCutoffIds = ref<string[]>([])
const inputText = ref('')
const pendingFiles = ref<AttachmentMeta[]>([])
const isStreaming = ref(false)
const streamingVariantMsgIds = ref(new Set<string>())
const messagesEl = ref<HTMLElement>()
const textareaEl = ref<HTMLTextAreaElement>()
const fileInput = ref<HTMLInputElement>()
const pdfLoading = ref(false)
const pdfWarning = ref('')
const showContextPreview = ref(false)
const contextMode = ref<'page' | 'chapter' | 'selection' | 'none'>(props.selectedText.trim() ? 'selection' : 'page')
const currentSessionId = ref<string>(crypto.randomUUID())
const sessionCreatedAt = ref<number>(Date.now())
const showHistory = ref(false)
const historyRoot = ref<HTMLElement>()
let abortCtrl: AbortController | null = null
let abortCtrl2: AbortController | null = null
let _compositionEndedAt = 0

// Use ebook-specific default model (falls back to global active model if not set)
const activeProvider = computed(() => {
  const pid = aiStore.ebookDefaultProviderId || aiStore.activeProviderId
  return aiStore.providers.find(p => p.id === pid) ?? aiStore.activeProvider()
})
const activeModelId = computed(() => {
  const pid = aiStore.ebookDefaultProviderId || aiStore.activeProviderId
  const p = aiStore.providers.find(p => p.id === pid)
  return aiStore.ebookDefaultModelId || p?.selectedModelId || aiStore.activeModelId()
})
const activeProviderType = computed(() => activeProvider.value?.type)
const configuredProviders = computed(() => aiStore.configuredProviders())
const hasWebSearch = computed(() => wsStore.hasApiKey(wsStore.activeProviderId))
const canSend = computed(() =>
  !isStreaming.value && (inputText.value.trim().length > 0 || pendingFiles.value.length > 0),
)
const isDeepSeek = computed(() => {
  const p = activeProvider.value
  return p?.id === 'deepseek' || p?.baseUrl?.includes('deepseek')
})

const webSearchEnabled = ref(false)
const useReasoning = ref(false)
const reasoningLevel = ref<'low' | 'medium' | 'high'>('medium')
const reasoningOpen = ref(false)
const reasoningRoot = ref<HTMLElement>()

const secondProviderId = ref<string | null>(null)
const secondModelId = ref<string | null>(null)
const secondModelOpen = ref(false)
const secondModelRoot = ref<HTMLElement>()
const secondProvider = computed(() => secondProviderId.value ? aiStore.providers.find(p => p.id === secondProviderId.value) : null)
const secondModel = computed(() => secondProvider.value?.models.find(m => m.id === secondModelId.value) ?? null)

if (props.selectedText.trim()) {
  inputText.value = `关于这段话，帮我解释一下：\n\n"${props.selectedText.slice(0, 500)}"`
}

watch(() => props.selectedText, (text) => {
  if (!text.trim()) return
  contextMode.value = 'selection'
  if (!inputText.value.trim()) {
    inputText.value = `关于这段话，帮我解释一下：\n\n"${text.slice(0, 500)}"`
  }
})

function startResize(e: MouseEvent) {
  isResizing.value = true
  dragState.value = { startX: e.clientX, startW: panelWidth.value }
}

function onResizeMove(e: MouseEvent) {
  if (!dragState.value) return
  panelWidth.value = Math.max(320, Math.min(760, dragState.value.startW - (e.clientX - dragState.value.startX)))
}

function onResizeEnd() {
  isResizing.value = false
  dragState.value = null
}

function handleOutside(e: MouseEvent) {
  if (reasoningRoot.value && !reasoningRoot.value.contains(e.target as Node)) reasoningOpen.value = false
  if (secondModelRoot.value && !secondModelRoot.value.contains(e.target as Node)) secondModelOpen.value = false
  if (historyRoot.value && !historyRoot.value.contains(e.target as Node)) showHistory.value = false
  if (msgPickerOpenId.value && !(e.target as HTMLElement).closest('.msg-picker-wrap')) msgPickerOpenId.value = null
}

onMounted(() => {
  document.addEventListener('mousedown', handleOutside)
  // Load most recent copilot session for this book
  const sessions = ebookStore.getCopilotSessions(props.book.id)
  if (sessions.length > 0) {
    const latest = sessions[0]
    currentSessionId.value = latest.id
    sessionCreatedAt.value = latest.createdAt
    messages.value = latest.messages as ChatMessage[]
    nextTick(() => scrollToBottom(true))
  }
})
onUnmounted(() => {
  document.removeEventListener('mousedown', handleOutside)
  saveCurrentSession()  // save state but keep stream running in background
})

function saveCurrentSession() {
  if (!messages.value.length) return
  ebookStore.saveCopilotSession({
    id: currentSessionId.value,
    bookId: props.book.id,
    createdAt: sessionCreatedAt.value,
    updatedAt: Date.now(),
    messages: messages.value.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      model: m.model,
      providerId: m.providerId,
      usage: m.usage,
      error: m.error,
      webSearchCount: m.webSearchCount,
      mediaOutputs: m.mediaOutputs?.length ? m.mediaOutputs : undefined,
      variants: m.variants?.length
        ? m.variants.map(v => ({ id: v.id, content: v.content, model: v.model, providerId: v.providerId, error: v.error, mediaOutputs: v.mediaOutputs?.length ? v.mediaOutputs : undefined }))
        : undefined,
    })),
  })
}

watch(isStreaming, (streaming) => { if (!streaming) saveCurrentSession() })
watch(() => messages.value.length, () => { if (!isStreaming.value) saveCurrentSession() })

function scrollToBottom(force = false) {
  nextTick(() => {
    const el = messagesEl.value
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (force || atBottom) el.scrollTop = el.scrollHeight
  })
}

watch(() => messages.value.length, () => scrollToBottom(true))

function adjustHeight() {
  nextTick(() => {
    const el = textareaEl.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  })
}
watch(inputText, adjustHeight)

function onCompositionStart() { _compositionEndedAt = 0 }
function onCompositionEnd() { _compositionEndedAt = Date.now() }
function isIMEActive() { return Date.now() - _compositionEndedAt < 100 }

const contextOptions = computed(() => [
  { id: 'page' as const, label: '本页', available: !!props.pageText.trim() },
  { id: 'chapter' as const, label: '本章', available: !!props.chapterText.trim() },
  { id: 'selection' as const, label: '选中', available: !!props.selectedText.trim() },
  { id: 'none' as const, label: '无', available: true },
])

const activeContextLabel = computed(() => {
  if (contextMode.value === 'page') return props.chapterTitle ? `本页 · ${props.chapterTitle}` : '本页'
  if (contextMode.value === 'chapter') return props.chapterTitle ? `本章 · ${props.chapterTitle}` : '本章'
  if (contextMode.value === 'selection') return '选中内容'
  return '无上下文'
})

const activeContextText = computed(() => {
  if (contextMode.value === 'page') return props.pageText.trim()
  if (contextMode.value === 'chapter') return props.chapterText.trim()
  if (contextMode.value === 'selection') return props.selectedText.trim()
  return ''
})

watch([() => props.pageText, () => props.chapterText, () => props.selectedText], () => {
  const current = contextOptions.value.find(o => o.id === contextMode.value)
  if (current?.available) return
  contextMode.value =
    contextOptions.value.find(o => o.id === 'page' && o.available)?.id ??
    contextOptions.value.find(o => o.id === 'chapter' && o.available)?.id ??
    'none'
})

function setContextMode(mode: 'page' | 'chapter' | 'selection' | 'none') {
  const opt = contextOptions.value.find(o => o.id === mode)
  if (!opt?.available) return
  contextMode.value = mode
}

function buildSystemPrompt(extraContext = ''): string {
  const parts = [
    `你是一个专业的阅读助理。用户正在阅读《${props.book.title}》（作者：${props.book.author || '未知'}）。`,
  ]
  if (activeContextText.value) {
    const label = activeContextLabel.value
    parts.push(`${label}内容：\n${activeContextText.value.slice(0, contextMode.value === 'chapter' ? 8000 : 5000)}`)
  }
  if (useReasoning.value) {
    parts.push(`请使用${reasoningLevel.value === 'low' ? '轻量' : reasoningLevel.value === 'medium' ? '中等' : '深入'}推理来组织答案，但最终回复保持清晰简洁。`)
  }
  if (extraContext) parts.push(extraContext)
  parts.push('请优先基于用户选择的阅读上下文回答；如果需要推测，请明确说明。')
  return parts.join('\n\n')
}

function messagesForContext(): ChatMessage[] {
  if (!contextCutoffIds.value.length) return messages.value
  const lastCutoff = contextCutoffIds.value.at(-1)
  const idx = messages.value.findIndex(m => m.id === lastCutoff)
  return idx >= 0 ? messages.value.slice(idx + 1) : messages.value
}

function buildPrompt(userText: string, attachments: AttachmentMeta[]): string {
  const parts: string[] = []
  const history = messagesForContext()
    .map(m => `${m.role === 'user' ? '用户' : '助理'}：${m.content}`)
    .join('\n')
  if (history) parts.push(`历史对话：\n${history}`)
  if (attachments.length) {
    const attachmentText = attachments.map((a) => {
      if (a.mimeType === 'application/pdf' && a.extractedText) {
        return `PDF：${a.name}\n${a.extractedText.slice(0, 4000)}`
      }
      if (a.mimeType?.startsWith('image/')) {
        return `图片：${a.name}（当前阅读 Copilot 会记录附件，但此通道主要按文本上下文回答。）`
      }
      return `附件：${a.name}`
    }).join('\n\n')
    parts.push(`用户附件：\n${attachmentText}`)
  }
  parts.push(`当前用户消息：\n${userText || '请根据附件和当前章节继续分析。'}`)
  return parts.join('\n\n')
}

async function collectWebContext(text: string, userMsg: ChatMessage): Promise<string> {
  if (!webSearchEnabled.value || !hasWebSearch.value || !text.trim()) return ''
  try {
    const wsKey = await wsStore.getApiKey(wsStore.activeProviderId)
    const wsOptions = wsStore.getSearchOptions(wsStore.activeProviderId)
    const results = await performSearch(wsStore.activeProviderId, wsKey, text.trim(), wsOptions)
    if (!results.length) return ''
    userMsg.webSearchCount = results.length
    wsStore.incrementUsage(wsStore.activeProviderId)
    return formatSearchResultsForContext(results, text.trim())
  } catch {
    return ''
  }
}

async function runStream(target: ChatMessage | ChatVariant, providerId: string, modelId: string, prompt: string, systemPrompt: string, signal: AbortSignal) {
  const provider = aiStore.providers.find(p => p.id === providerId)
  if (!provider) return
  const startedAt = Date.now()
  let content = ''
  const handler: CopilotStreamHandler = {
    onToken(token) {
      content += token
      target.content = content
      scrollToBottom()
    },
    onMediaOutput(mimeType, data, isUrl) {
      if (!target.mediaOutputs) target.mediaOutputs = []
      target.mediaOutputs.push(isUrl ? { mimeType, url: data } : { mimeType, data })
    },
  }
  const usage = await streamCopilotCompletion(
    provider,
    modelId,
    prompt,
    systemPrompt,
    4096,
    signal,
    handler,
  )
  if ('usage' in target) {
    if (usage.costUsd == null) {
      const cost = calculateModelCost(aiStore.providers, providerId, modelId, usage.inputTokens, usage.outputTokens)
      if (cost != null) usage.costUsd = cost
    }
    target.usage = { ...usage, durationMs: Date.now() - startedAt }
    recordEbookCopilotUsage(usage.inputTokens ?? 0, usage.outputTokens ?? 0, usage.costUsd ?? 0).catch(() => {})
  }
}

async function send() {
  if (!canSend.value) return
  const provider = activeProvider.value
  const modelId = activeModelId.value
  if (!provider || !modelId) return

  const text = inputText.value.trim()
  const files = [...pendingFiles.value]
  inputText.value = ''
  pendingFiles.value = []
  pdfWarning.value = ''
  await nextTick()
  adjustHeight()

  const userMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: text || '请分析我附加的内容。',
    attachments: files.length ? files : undefined,
  }
  const webContext = await collectWebContext(text, userMsg)
  const prompt = buildPrompt(text, files)
  const assistantMsg = reactive<ChatMessage>({
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    providerId: provider.id,
    model: modelId,
    usage: undefined,
  })
  messages.value.push(userMsg, assistantMsg)
  scrollToBottom(true)

  isStreaming.value = true
  streamingMsgId.value = assistantMsg.id
  abortCtrl = new AbortController()
  const systemPrompt = buildSystemPrompt(webContext)

  const pid2 = secondProviderId.value
  const mid2 = secondModelId.value
  if (pid2 && mid2 && (pid2 !== provider.id || mid2 !== modelId)) {
    const variant = reactive<ChatVariant>({ id: crypto.randomUUID(), content: '', providerId: pid2, model: mid2 })
    assistantMsg.variants = [variant]
    streamingVariantMsgIds.value.add(assistantMsg.id)
    abortCtrl2 = new AbortController()
    runStream(variant, pid2, mid2, prompt, systemPrompt, abortCtrl2.signal)
      .catch((e: unknown) => {
        if ((e as Error)?.name !== 'AbortError') {
          variant.content = `Error: ${e instanceof Error ? e.message : String(e)}`
          variant.error = true
        }
      })
      .finally(() => {
        streamingVariantMsgIds.value.delete(assistantMsg.id)
        streamingVariantMsgIds.value = new Set(streamingVariantMsgIds.value)
        abortCtrl2 = null
        saveCurrentSession()
      })
  }

  try {
    await runStream(assistantMsg, provider.id, modelId, prompt, systemPrompt, abortCtrl.signal)
  } catch (e: unknown) {
    if ((e as Error)?.name !== 'AbortError') {
      assistantMsg.content = `Error: ${e instanceof Error ? e.message : String(e)}`
      assistantMsg.error = true
    }
  } finally {
    isStreaming.value = false
    streamingMsgId.value = null
    abortCtrl = null
    scrollToBottom()
    saveCurrentSession()
  }
}

const copiedMsgId = ref<string | null>(null)
const msgPickerOpenId = ref<string | null>(null)
const streamingMsgId = ref<string | null>(null)
const variantLayout = ref<'tab' | 'horizontal'>('tab')
const msgTabIdx = reactive<Record<string, number>>({})

// ─── Media lightbox ───────────────────────────────────────────────────────────
const lightboxSrc = ref<string | null>(null)

function openLightbox(mimeType: string, data: string) {
  lightboxSrc.value = `data:${mimeType};base64,${data}`
}

function openLightboxUrl(url: string) {
  lightboxSrc.value = url
}

async function downloadMedia(src: string, filename: string, filters: { name: string; extensions: string[] }[]) {
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
    const savePath = await save({ defaultPath: filename, filters })
    if (!savePath) return
    await writeFile(savePath, bytes)
    showToast('已保存')
  } catch {
    const a = document.createElement('a')
    a.href = src.startsWith('data:') ? src : URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer]))
    a.download = filename
    a.click()
    showToast('已保存到下载文件夹')
  }
}

function showToast(msg: string) {
  const el = document.createElement('div')
  el.textContent = msg
  el.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:6px 14px;border-radius:8px;font-size:12px;z-index:9999;pointer-events:none;transition:opacity 0.3s;'
  document.body.appendChild(el)
  setTimeout(() => { el.style.opacity = '0' }, 2000)
  setTimeout(() => { el.remove() }, 2300)
}

function deleteMessage(msgId: string) {
  const idx = messages.value.findIndex(m => m.id === msgId)
  if (idx === -1) return
  messages.value.splice(idx, 1)
}

function editUserMessage(msg: ChatMessage) {
  const idx = messages.value.indexOf(msg)
  if (idx === -1) return
  inputText.value = msg.content
  const next = messages.value[idx + 1]
  messages.value.splice(idx, next?.role === 'assistant' ? 2 : 1)
  nextTick(() => textareaEl.value?.focus())
}

async function copyMessage(msg: ChatMessage) {
  const text = getDisplay(msg).content
  await navigator.clipboard.writeText(text).catch(() => {})
  copiedMsgId.value = msg.id
  setTimeout(() => { copiedMsgId.value = null }, 2000)
}

async function regenerate(msg: ChatMessage) {
  if (isStreaming.value) return
  // Find the user message before this assistant message
  const idx = messages.value.indexOf(msg)
  const before = messages.value.slice(0, idx)
  const userMsg = before[before.map((m: ChatMessage) => m.role).lastIndexOf('user')]
  if (!userMsg) return

  const provider = activeProvider.value
  const modelId = activeModelId.value
  if (!provider || !modelId) return

  msg.content = ''
  msg.usage = undefined
  msg.error = false
  msg.providerId = provider.id
  msg.model = modelId

  const prompt = buildPrompt(userMsg.content, userMsg.attachments ?? [])
  const systemPrompt = buildSystemPrompt()

  isStreaming.value = true
  streamingMsgId.value = msg.id
  abortCtrl = new AbortController()
  try {
    await runStream(msg, provider.id, modelId, prompt, systemPrompt, abortCtrl.signal)
  } catch (e: unknown) {
    if ((e as Error)?.name !== 'AbortError') {
      msg.content = `Error: ${e instanceof Error ? e.message : String(e)}`
      msg.error = true
    }
  } finally {
    isStreaming.value = false
    streamingMsgId.value = null
    abortCtrl = null
    scrollToBottom()
    saveCurrentSession()
  }
}

async function regenerateWithModel(msg: ChatMessage, providerId: string, modelId: string) {
  msgPickerOpenId.value = null
  if (isStreaming.value || streamingVariantMsgIds.value.has(msg.id)) return
  const idx = messages.value.indexOf(msg)
  const before = messages.value.slice(0, idx)
  const userMsg = before[before.map((m: ChatMessage) => m.role).lastIndexOf('user')]
  if (!userMsg) return
  const provider = aiStore.providers.find(p => p.id === providerId)
  if (!provider) return

  // Add as a new variant tab — keeps the original response intact
  const variant = reactive<ChatVariant>({ id: crypto.randomUUID(), content: '', providerId, model: modelId })
  if (!msg.variants) msg.variants = []
  msg.variants.push(variant)
  setTab(msg, msg.variants.length) // auto-switch to the new tab

  const prompt = buildPrompt(userMsg.content, userMsg.attachments ?? [])
  const systemPrompt = buildSystemPrompt()

  streamingVariantMsgIds.value = new Set([...streamingVariantMsgIds.value, msg.id])
  abortCtrl2 = new AbortController()
  try {
    await runStream(variant, providerId, modelId, prompt, systemPrompt, abortCtrl2.signal)
  } catch (e: unknown) {
    if ((e as Error)?.name !== 'AbortError') {
      variant.content = `Error: ${e instanceof Error ? e.message : String(e)}`
      variant.error = true
    }
  } finally {
    streamingVariantMsgIds.value.delete(msg.id)
    streamingVariantMsgIds.value = new Set(streamingVariantMsgIds.value)
    abortCtrl2 = null
    scrollToBottom()
    saveCurrentSession()
  }
}

function stopStreaming() {
  abortCtrl?.abort()
  abortCtrl2?.abort()
  isStreaming.value = false
  streamingVariantMsgIds.value.clear()
  streamingVariantMsgIds.value = new Set(streamingVariantMsgIds.value)
  abortCtrl = null
  abortCtrl2 = null
}

function newChat() {
  saveCurrentSession()
  stopStreaming()
  messages.value = []
  contextCutoffIds.value = []
  currentSessionId.value = crypto.randomUUID()
  sessionCreatedAt.value = Date.now()
  inputText.value = ''
  pendingFiles.value = []
  nextTick(() => textareaEl.value?.focus())
}

function clearContext() {
  const last = messages.value.at(-1)
  if (!last || isStreaming.value) return
  if (!contextCutoffIds.value.includes(last.id)) contextCutoffIds.value.push(last.id)
}

function removeContextCutoff(id: string) {
  contextCutoffIds.value = contextCutoffIds.value.filter(x => x !== id)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !isIMEActive()) {
    e.preventDefault()
    send()
  }
}

function selectSecondModel(pid: string, mid: string) {
  secondProviderId.value = pid
  secondModelId.value = mid
  secondModelOpen.value = false
}

function clearSecondModel() {
  secondProviderId.value = null
  secondModelId.value = null
  secondModelOpen.value = false
}

function setReasoning(v: boolean) { useReasoning.value = v }
function setReasoningLevel(v: 'low' | 'medium' | 'high') { reasoningLevel.value = v }

function pickFile() { fileInput.value?.click() }

async function handleFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  for (const file of files) await addFile(file)
  if (fileInput.value) fileInput.value.value = ''
}

async function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/') || item.type === 'application/pdf') {
      const file = item.getAsFile()
      if (!file) continue
      e.preventDefault()
      await addFile(file)
    }
  }
}

async function addFile(file: File) {
  if (file.type.startsWith('image/')) {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const base64 = (ev.target?.result as string).split(',')[1]
      pendingFiles.value.push({
        id: crypto.randomUUID(),
        name: file.name || 'image.png',
        mimeType: file.type,
        data: base64,
        size: file.size,
      })
    }
    reader.readAsDataURL(file)
  } else if (file.type === 'application/pdf') {
    pdfLoading.value = true
    pdfWarning.value = ''
    try {
      const meta = await processPdfFile(file)
      if (!meta.extractedText) pdfWarning.value = '该 PDF 可能为扫描件，文字无法提取。'
      pendingFiles.value.push({
        id: crypto.randomUUID(),
        name: file.name || 'document.pdf',
        mimeType: 'application/pdf',
        data: meta.base64,
        size: file.size,
        extractedText: meta.extractedText,
        pageCount: meta.pageCount,
      })
    } catch {
      pdfWarning.value = 'PDF 解析失败。'
    } finally {
      pdfLoading.value = false
    }
  }
}

function removeFile(id: string) {
  pendingFiles.value = pendingFiles.value.filter(f => f.id !== id)
}

function getDisplay(msg: ChatMessage) {
  if (msg.role !== 'assistant') return { content: msg.content, model: msg.model, providerId: msg.providerId }
  const idx = msgTabIdx[msg.id] ?? 0
  if (!idx) return { content: msg.content, model: msg.model, providerId: msg.providerId }
  const v = msg.variants?.[idx - 1]
  return { content: v?.content ?? '', model: v?.model, providerId: v?.providerId }
}

function setTab(msg: ChatMessage, idx: number) { msgTabIdx[msg.id] = idx }

function getVariantSlots(msg: ChatMessage) {
  return [
    { model: msg.model ?? '', providerId: msg.providerId ?? '' },
    ...(msg.variants ?? []).map(v => ({ model: v.model ?? '', providerId: v.providerId ?? '' })),
  ]
}

function modelLabel(pid?: string, mid?: string) {
  if (!pid || !mid) return ''
  const p = aiStore.providers.find(x => x.id === pid)
  return p?.models.find(m => m.id === mid)?.name ?? mid
}

const allSessions = computed(() => ebookStore.getCopilotSessions(props.book.id))

function loadSession(s: CopilotSession) {
  saveCurrentSession()
  currentSessionId.value = s.id
  sessionCreatedAt.value = s.createdAt
  messages.value = s.messages as ChatMessage[]
  contextCutoffIds.value = []
  showHistory.value = false
  nextTick(() => scrollToBottom(true))
}

function deleteSession(id: string) {
  const isActive = id === currentSessionId.value
  ebookStore.deleteCopilotSession(id)
  if (isActive) {
    const remaining = ebookStore.getCopilotSessions(props.book.id)
    if (remaining.length > 0) {
      loadSession(remaining[0])
    } else {
      messages.value = []
      contextCutoffIds.value = []
      currentSessionId.value = crypto.randomUUID()
      sessionCreatedAt.value = Date.now()
    }
  }
}

function formatSessionTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400_000)
  if (diffDays < 7) return `${diffDays}天前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function getSessionPreview(s: CopilotSession): string {
  const first = s.messages.find(m => m.role === 'user')
  if (!first) return '空对话'
  return first.content.length > 36 ? first.content.slice(0, 36) + '…' : first.content
}
</script>

<template>
  <div class="reader-copilot" :style="{ width: panelWidth + 'px' }" :class="[{ resizing: isResizing }, `cp-theme-${ebookStore.settings.theme}`]">
    <div class="resize-handle" @mousedown.prevent="startResize" />

    <div class="copilot-header">
      <div class="header-left">
        <img :src="copilotIcon" class="copilot-header-icon" alt="Copilot" />
        <span class="copilot-title">AI Copilot</span>
        <span class="book-hint">· {{ book.title }}</span>
      </div>
      <div ref="historyRoot" class="history-wrap">
        <button class="hdr-btn" title="新建对话" @click="newChat(); showHistory = false">
          <Plus :size="13" />
        </button>
        <button class="hdr-btn" :class="{ 'hdr-btn-active': showHistory }" title="历史对话" @click="showHistory = !showHistory">
          <History :size="13" />
        </button>
        <Transition name="hist-drop">
          <div v-if="showHistory" class="history-dropdown">
            <div class="history-header-row">历史对话</div>
            <div v-if="allSessions.length === 0" class="history-empty">暂无历史记录</div>
            <div v-else class="history-list">
              <div
                v-for="s in allSessions"
                :key="s.id"
                class="history-item"
                :class="{ active: s.id === currentSessionId }"
                @click="loadSession(s)"
              >
                <div class="history-item-meta">
                  <span class="history-item-time">{{ formatSessionTime(s.updatedAt) }}</span>
                  <span class="history-item-count">{{ s.messages.length }} 条</span>
                </div>
                <div class="history-item-preview">{{ getSessionPreview(s) }}</div>
                <button class="history-del-btn" title="删除" @click.stop="deleteSession(s.id)">
                  <Trash2 :size="11" />
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
      <button class="hdr-btn" title="关闭" @click="emit('close')">
        <X :size="13" />
      </button>
    </div>

    <div class="copilot-subheader">
      <div ref="secondModelRoot" class="second-model-wrap">
        <button v-if="!secondProviderId" class="compare-add-btn" @click="secondModelOpen = !secondModelOpen">
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
                  v-for="m in p.models"
                  :key="m.id"
                  class="sm-model-btn"
                  :class="{ active: secondProviderId === p.id && secondModelId === m.id }"
                  @click="selectSecondModel(p.id, m.id)"
                >
                  {{ m.name }}
                  <Check v-if="secondProviderId === p.id && secondModelId === m.id" :size="10" />
                  <span v-else class="sm-ph" />
                </button>
              </div>
            </template>
          </div>
        </Transition>
      </div>

      <ModelSelector
        :compact="!!secondProviderId"
        drop-down
        class="cp-model-sel"
        :provider-id="aiStore.ebookDefaultProviderId || aiStore.activeProviderId"
        :model-id="aiStore.ebookDefaultModelId || aiStore.activeModelId()"
        save-to="ebook"
      />
    </div>

    <div ref="messagesEl" class="copilot-messages">
      <div v-if="messages.length === 0" class="messages-empty">
        <img :src="copilotIcon" class="empty-icon-copilot" alt="Copilot" />
        <p>基于{{ activeContextLabel }}开始对话</p>
        <div class="quick-actions">
          <button class="quick-btn" @click="inputText = contextMode === 'page' ? '用一段话总结本页内容' : '用一段话总结这一章的主要内容'; send()">总结内容</button>
          <button class="quick-btn" @click="inputText = '这里有哪些值得关注的重要观点？'">重要观点</button>
          <button class="quick-btn" @click="inputText = '这里涉及哪些专有名词？请解释一下。'">名词解释</button>
        </div>
      </div>

      <template v-else>
        <div v-for="msg in messages" :key="msg.id" class="cp-msg" :class="msg.role">
          <template v-if="msg.role === 'user'">
            <div v-if="msg.webSearchCount" class="ws-badge">
              <Globe :size="10" /> 搜索了 {{ msg.webSearchCount }} 条结果
            </div>
            <div v-if="msg.attachments?.length" class="att-row">
              <div v-for="att in msg.attachments" :key="att.id" class="att-chip user">
                <FileText :size="10" />
                <span>{{ att.name }}</span>
                <span v-if="att.pageCount" class="chip-pages">{{ att.pageCount }}页</span>
              </div>
            </div>
            <div class="bubble user-bubble">
              <div class="msg-text user-text">{{ msg.content }}</div>
            </div>
            <div class="user-msg-footer">
              <button class="msg-action-btn" title="复制" @click="copyMessage(msg)">
                <Check v-if="copiedMsgId === msg.id" :size="12" />
                <Copy v-else :size="12" />
              </button>
              <button class="msg-action-btn" title="编辑（恢复到输入框）" @click="editUserMessage(msg)">
                <Pencil :size="12" />
              </button>
              <button class="msg-action-btn danger" title="删除" @click="deleteMessage(msg.id)">
                <Trash2 :size="12" />
              </button>
            </div>
          </template>

          <template v-else>
            <!-- Horizontal compare mode -->
            <div v-if="msg.variants?.length && variantLayout === 'horizontal'" class="compare-cols">
              <div class="compare-col" :class="{ streaming: streamingMsgId === msg.id }">
                <div class="compare-col-header">
                  <img v-if="lookupLogoUrl(msg.model ?? '', msg.providerId ?? '')"
                       :src="lookupLogoUrl(msg.model ?? '', msg.providerId ?? '')!"
                       class="compare-logo" alt="" />
                  <img v-else :src="copilotIcon" class="compare-copilot-icon" alt="" />
                  <span class="compare-model-name">{{ modelLabel(msg.providerId, msg.model) || '模型 1' }}</span>
                  <span v-if="streamingMsgId === msg.id" class="compare-dot" />
                </div>
                <MarkdownBody class="msg-text compare-content"
                  :class="{ streaming: streamingMsgId === msg.id }"
                  :content="msg.content"
                  :streaming="streamingMsgId === msg.id" />
              </div>
              <div v-for="v in msg.variants" :key="v.id" class="compare-col"
                   :class="{ streaming: streamingVariantMsgIds.has(msg.id) }">
                <div class="compare-col-header">
                  <img v-if="lookupLogoUrl(v.model ?? '', v.providerId ?? '')"
                       :src="lookupLogoUrl(v.model ?? '', v.providerId ?? '')!"
                       class="compare-logo" alt="" />
                  <img v-else :src="copilotIcon" class="compare-copilot-icon" alt="" />
                  <span class="compare-model-name">{{ modelLabel(v.providerId, v.model) || '模型 2' }}</span>
                  <span v-if="streamingVariantMsgIds.has(msg.id)" class="compare-dot" />
                </div>
                <MarkdownBody class="msg-text compare-content"
                  :class="{ streaming: streamingVariantMsgIds.has(msg.id) }"
                  :content="v.content"
                  :streaming="streamingVariantMsgIds.has(msg.id)" />
              </div>
            </div>

            <!-- Tab mode (single bubble) -->
            <div v-else class="bubble-wrap">
              <div class="cp-avatar">
                <img v-if="lookupLogoUrl(msg.model ?? '', msg.providerId ?? '')"
                     :src="lookupLogoUrl(msg.model ?? '', msg.providerId ?? '')!"
                     class="cp-avatar-logo" alt="" />
                <img v-else :src="copilotIcon" class="cp-avatar-copilot" alt="" />
              </div>
              <div class="bubble asst-bubble" :class="{ streaming: streamingMsgId === msg.id }">
                <MarkdownBody
                  class="msg-text"
                  :content="getDisplay(msg).content"
                  :streaming="streamingMsgId === msg.id"
                />
                <!-- Media outputs -->
                <div v-if="getDisplay(msg).mediaOutputs?.length" class="media-outputs">
                  <template v-for="(out, idx) in getDisplay(msg).mediaOutputs" :key="idx">
                    <div v-if="out.mimeType.startsWith('image/')" class="media-img-wrap">
                      <img
                        :src="out.url ?? `data:${out.mimeType};base64,${out.data}`"
                        class="media-img"
                        :alt="`生成图片 ${idx + 1}`"
                        @click="out.url ? openLightboxUrl(out.url) : openLightbox(out.mimeType, out.data!)"
                      />
                      <button class="media-download-btn" title="下载原图" @click.stop="downloadMedia(out.url ?? `data:${out.mimeType};base64,${out.data}`, `muse-image-${idx + 1}.png`, [{ name: 'Image', extensions: ['png', 'jpg', 'webp'] }])">
                        <Download :size="14" />
                      </button>
                    </div>
                    <div v-else-if="out.mimeType.startsWith('video/')" class="media-video-wrap">
                      <video
                        :src="out.url ?? `data:${out.mimeType};base64,${out.data}`"
                        class="media-video"
                        controls
                        preload="auto"
                      />
                      <button class="media-video-download-btn" title="下载视频" @click.stop="downloadMedia(out.url ?? `data:${out.mimeType};base64,${out.data}`, `muse-video-${idx + 1}.mp4`, [{ name: 'Video', extensions: ['mp4', 'mov', 'webm'] }])">
                        <Download :size="14" />
                      </button>
                    </div>
                    <AudioPlayer
                      v-else-if="out.mimeType.startsWith('audio/')"
                      :src="out.url ?? `data:${out.mimeType};base64,${out.data}`"
                    />
                  </template>
                </div>
              </div>
            </div>

            <!-- Footer: action buttons only -->
            <div class="msg-footer">
              <div class="msg-actions">
                <button class="msg-action-btn" title="复制" @click="copyMessage(msg)">
                  <Check v-if="copiedMsgId === msg.id" :size="12" />
                  <Copy v-else :size="12" />
                </button>
                <button class="msg-action-btn" title="重新生成" :disabled="isStreaming" @click="regenerate(msg)">
                  <RefreshCw :size="12" />
                </button>
                <div class="msg-picker-wrap">
                  <button class="msg-action-btn" title="用其他模型回答" :disabled="isStreaming" @click="msgPickerOpenId = msgPickerOpenId === msg.id ? null : msg.id">
                    <AtSign :size="12" />
                  </button>
                  <Transition name="picker-pop">
                    <div v-if="msgPickerOpenId === msg.id" class="msg-model-picker">
                      <div v-if="configuredProviders.length === 0" class="picker-empty">请先配置 API Key</div>
                      <template v-else>
                        <div v-for="p in configuredProviders" :key="p.id" class="picker-group">
                          <div class="picker-group-label">{{ p.name }}</div>
                          <button v-for="m in p.models" :key="m.id" class="picker-model-item" @click="regenerateWithModel(msg, p.id, m.id)">
                            {{ m.name || m.id }}
                          </button>
                        </div>
                      </template>
                    </div>
                  </Transition>
                </div>
                <button class="msg-action-btn danger" title="删除" :disabled="isStreaming" @click="deleteMessage(msg.id)">
                  <Trash2 :size="12" />
                </button>
              </div>
            </div>

            <!-- Variant bar: layout toggle + model icon tabs (same style as chat module) -->
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
                    streaming: idx === 0 ? streamingMsgId === msg.id : streamingVariantMsgIds.has(msg.id),
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
          </template>

          <div v-if="contextCutoffIds.includes(msg.id)" class="context-divider">
            <div class="context-divider-line" />
            <span class="context-divider-label">以下为发送给 AI 的上下文</span>
            <button class="context-divider-remove" title="取消此清除" @click="removeContextCutoff(msg.id)">
              <X :size="11" />
            </button>
            <div class="context-divider-line" />
          </div>
        </div>
      </template>
    </div>

    <div class="input-area">
      <div class="context-bar">
        <div class="context-tabs" aria-label="上下文范围">
          <button
            v-for="option in contextOptions"
            :key="option.id"
            class="ctx-tab"
            :class="{ active: contextMode === option.id }"
            :disabled="!option.available"
            @click="setContextMode(option.id)"
          >
            {{ option.label }}
          </button>
        </div>
        <button v-if="activeContextText" class="ctx-view-btn" title="查看注入内容" @click="showContextPreview = !showContextPreview">
          <Eye :size="11" /> 查看
        </button>
      </div>

      <div v-if="showContextPreview && activeContextText" class="ctx-preview">
        <div class="ctx-preview-header">
          <span>{{ activeContextLabel }}内容（节选）</span>
          <button @click="showContextPreview = false"><X :size="11" /></button>
        </div>
        <div class="ctx-preview-body">{{ activeContextText }}</div>
      </div>

      <div v-if="pendingFiles.length > 0 || pdfLoading" class="pending-files">
        <div v-if="pdfLoading" class="file-chip loading"><FileText :size="12" /><span>正在解析…</span></div>
        <template v-for="f in pendingFiles" :key="f.id">
          <div v-if="f.mimeType?.startsWith('image/')" class="img-wrap">
            <img :src="`data:${f.mimeType};base64,${f.data}`" class="thumb" />
            <button class="rm-btn" @click="removeFile(f.id)"><X :size="9" /></button>
          </div>
          <div v-else class="file-chip">
            <FileText :size="12" />
            <span>{{ f.name }}</span>
            <span v-if="f.pageCount" class="chip-pages">{{ f.pageCount }}页</span>
            <button class="rm-btn inline" @click="removeFile(f.id)"><X :size="9" /></button>
          </div>
        </template>
      </div>
      <div v-if="pdfWarning" class="pdf-warn">{{ pdfWarning }}</div>

      <div class="input-box">
        <textarea
          ref="textareaEl"
          v-model="inputText"
          class="input-textarea"
          placeholder="输入消息…"
          rows="1"
          @keydown="onKeydown"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @paste="handlePaste"
        />

        <div class="input-toolbar">
          <button class="toolbar-btn" title="新建对话" @click="newChat">
            <SquarePen :size="15" />
          </button>
          <button class="toolbar-btn" title="附加图片或 PDF" :disabled="pdfLoading" @click="pickFile">
            <Paperclip :size="15" />
          </button>
          <button
            class="toolbar-btn"
            :class="{ 'toolbar-btn-active': webSearchEnabled }"
            :title="hasWebSearch ? '联网搜索' : '联网搜索（请先在设置中配置 API Key）'"
            @click="hasWebSearch && (webSearchEnabled = !webSearchEnabled)"
          >
            <Globe :size="15" />
          </button>
          <div ref="reasoningRoot" class="reasoning-wrap">
            <button
              class="toolbar-btn"
              :class="{ 'toolbar-btn-active': useReasoning }"
              title="推理设置"
              @click="reasoningOpen = !reasoningOpen"
            >
              <Brain :size="15" />
              <span v-if="useReasoning" class="reasoning-badge">
                {{ reasoningLevel === 'low' ? '低' : reasoningLevel === 'medium' ? '中' : '高' }}
              </span>
            </button>
            <Transition name="reasoning-drop">
              <div v-if="reasoningOpen" class="reasoning-popover">
                <div class="reasoning-row">
                  <span class="reasoning-label">推理模式</span>
                  <button class="reasoning-toggle" :class="{ on: useReasoning }" @click="setReasoning(!useReasoning)">
                    <span class="toggle-knob" />
                  </button>
                </div>
                <div v-if="useReasoning && activeProviderType !== 'ollama' && activeProviderType !== 'google'" class="reasoning-levels">
                  <template v-if="isDeepSeek">
                    <button
                      v-for="lv in (['high', 'max'] as const)"
                      :key="lv"
                      class="level-btn"
                      :class="{ active: lv === 'high' ? reasoningLevel === 'medium' : reasoningLevel === 'high' }"
                      @click="setReasoningLevel(lv === 'high' ? 'medium' : 'high')"
                    >{{ lv }}</button>
                  </template>
                  <template v-else>
                    <button
                      v-for="lv in (['low', 'medium', 'high'] as const)"
                      :key="lv"
                      class="level-btn"
                      :class="{ active: reasoningLevel === lv }"
                      @click="setReasoningLevel(lv)"
                    >{{ lv === 'low' ? '低' : lv === 'medium' ? '中' : '高' }}</button>
                  </template>
                </div>
                <div v-if="activeProviderType === 'google'" class="reasoning-hint">Google 暂不支持推理模式</div>
              </div>
            </Transition>
          </div>
          <button
            class="toolbar-btn"
            :class="{ 'toolbar-btn-active': contextCutoffIds.length > 0 }"
            title="清除上下文（不删除记录，仅减少发送给 AI 的历史）"
            @click="clearContext"
          >
            <Eraser :size="15" />
          </button>

          <span class="toolbar-spacer" />

          <button v-if="isStreaming" class="send-btn stop" title="停止生成" @click="stopStreaming">
            <Square :size="15" />
          </button>
          <button v-else class="send-btn" :class="{ active: canSend }" :disabled="!canSend" title="发送 (Enter)" @click="send">
            <Send :size="15" />
          </button>
        </div>
      </div>

      <input ref="fileInput" type="file" class="hidden-input" accept="image/*,application/pdf,.pdf" multiple @change="handleFileChange" />
    </div>
  </div>

  <Teleport to="body">
    <div v-if="isResizing" class="cp-resize-overlay" @mousemove="onResizeMove" @mouseup="onResizeEnd" />
  </Teleport>

  <!-- Image lightbox -->
  <Teleport to="body">
    <div v-if="lightboxSrc" class="lightbox-overlay" @click="lightboxSrc = null">
      <img :src="lightboxSrc" class="lightbox-img" @click.stop />
      <button class="lightbox-close" @click="lightboxSrc = null">✕</button>
    </div>
  </Teleport>
</template>

<style scoped>
.reader-copilot {
  min-width: 320px;
  max-width: min(760px, 72vw);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid rgba(0,0,0,0.08);
  background: #f5f5f7;
  height: 100%;
  min-height: 0;
  position: relative;
  user-select: none;
  isolation: isolate;     /* own stacking context so epub iframe can't bleed through */
  will-change: transform; /* force compositing layer in WKWebView */
}
.reader-copilot.resizing { cursor: col-resize; }

.resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 10px;
  cursor: col-resize;
  z-index: 20;
}
.resize-handle:hover,
.reader-copilot.resizing .resize-handle { background: rgba(74,123,200,0.18); }

.cp-resize-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  cursor: col-resize;
}

.copilot-header {
  height: 44px;
  padding: 0 8px 0 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  flex-shrink: 0;
  gap: 6px;
}
.header-left { display: flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; flex: 1; }
.copilot-header-icon { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.7; }
.empty-icon-copilot { width: 28px; height: 28px; opacity: 0.35; margin-bottom: 4px; }
.compare-copilot-icon { width: 12px; height: 12px; opacity: 0.6; }
.cp-avatar-copilot { width: 18px; height: 18px; opacity: 0.6; }
.copilot-title { font-size: 12.5px; font-weight: 600; color: #1c1c1e; flex-shrink: 0; }
.book-hint { font-size: 11px; color: #8e8e93; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hdr-btn {
  width: 26px; height: 26px; border: none; background: transparent; color: #8e8e93;
  border-radius: 7px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.12s, color 0.12s; flex-shrink: 0;
}
.hdr-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }
.hdr-btn-active { background: rgba(74,123,200,0.10) !important; color: #4a7bc8 !important; }

.history-wrap { position: relative; flex-shrink: 0; display: flex; align-items: center; gap: 2px; }
.history-dropdown {
  position: absolute; top: calc(100% + 6px); right: 0;
  width: 260px; max-height: 340px; display: flex; flex-direction: column;
  background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.12); z-index: 500; overflow: hidden;
}
.history-header-row {
  padding: 9px 12px 7px; font-size: 11.5px; font-weight: 600; color: #3c3c43;
  border-bottom: 1px solid rgba(0,0,0,0.06); flex-shrink: 0;
}
.history-empty { padding: 20px 12px; font-size: 12px; color: #aeaeb2; text-align: center; }
.history-list { overflow-y: auto; flex: 1; padding: 4px 0; }
.history-list::-webkit-scrollbar { width: 3px; }
.history-list::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }
.history-item {
  padding: 7px 10px 7px 12px; cursor: pointer; position: relative;
  display: flex; flex-direction: column; gap: 2px;
  transition: background 0.1s;
}
.history-item:hover { background: rgba(0,0,0,0.03); }
.history-item.active { background: rgba(74,123,200,0.07); }
.history-item-meta { display: flex; align-items: center; gap: 6px; }
.history-item-time { font-size: 10.5px; color: #8e8e93; }
.history-item-count { font-size: 10px; color: #c7c7cc; }
.history-item-preview {
  font-size: 12px; color: #3c3c43; line-height: 1.4;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 24px;
}
.history-item.active .history-item-preview { color: #4a7bc8; }
.history-del-btn {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  width: 22px; height: 22px; border: none; background: transparent; color: #c7c7cc;
  border-radius: 5px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0; transition: opacity 0.12s, background 0.12s, color 0.12s;
}
.history-item:hover .history-del-btn { opacity: 1; }
.history-del-btn:hover { background: rgba(239,68,68,0.1); color: #ef4444; }

.hist-drop-enter-active, .hist-drop-leave-active { transition: opacity 0.12s, transform 0.12s; }
.hist-drop-enter-from, .hist-drop-leave-to { opacity: 0; transform: translateY(-6px); }

.copilot-subheader {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  background: #fff;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  flex-shrink: 0;
  position: relative;
  z-index: 30;
}
.cp-theme-sepia .copilot-subheader { background: #f4ecd8; border-bottom-color: rgba(0,0,0,0.07); }
.cp-theme-dark .copilot-subheader { background: #3a3a3c; border-bottom-color: rgba(255,255,255,0.08); }
.cp-model-sel { min-width: 0; }
:deep(.cp-model-sel .selector-btn) { max-width: 100%; overflow: hidden; }
:deep(.cp-model-sel .selector-label) { max-width: min(220px, 40vw); min-width: 0; }
:deep(.cp-model-sel .dropdown.drop-down) {
  top: calc(100% + 8px);
  bottom: auto;
  right: 0;
  left: auto;
  min-width: 0;
  width: max-content;
  max-width: min(280px, calc(100vw - 24px));
  max-height: min(360px, calc(100vh - 170px));
  z-index: 600;
}

.second-model-wrap { position: relative; flex-shrink: 0; margin-left: auto; }
.compare-add-btn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 9px; border: 1px solid rgba(0,0,0,0.12); border-radius: 6px;
  background: transparent; color: #6e6e73; font-size: 11.5px; cursor: pointer;
}
.compare-add-btn:hover { background: rgba(0,0,0,0.05); }
.compare-set { display: flex; align-items: center; gap: 2px; max-width: 170px; }
.compare-label {
  min-width: 0; border: 1px solid rgba(74,123,200,0.22); border-radius: 6px;
  background: rgba(74,123,200,0.08); color: #4a7bc8; padding: 3px 7px;
  font-size: 11.5px; cursor: pointer;
}
.compare-label span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.compare-clear {
  width: 20px; height: 20px; border: none; border-radius: 5px; background: rgba(0,0,0,0.05);
  color: #8e8e93; display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.second-model-dropdown {
  position: absolute; top: calc(100% + 6px); right: 0;
  width: 220px; max-height: 300px; overflow-y: auto; padding: 4px 0;
  background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 700;
}
.sm-empty { padding: 12px; font-size: 12px; color: #8e8e93; text-align: center; }
.sm-group-label { padding: 5px 12px 2px; font-size: 10.5px; color: #8e8e93; font-weight: 600; }
.sm-model-btn {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 12px;
  background: transparent; border: none; font-size: 12px; color: #1c1c1e;
  text-align: left; cursor: pointer;
}
.sm-model-btn:hover { background: rgba(0,0,0,0.04); }
.sm-model-btn.active { color: #4a7bc8; background: rgba(74,123,200,0.08); }
.sm-model-btn svg, .sm-ph { margin-left: auto; flex-shrink: 0; }
.sm-ph { width: 10px; }

.copilot-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.copilot-messages::-webkit-scrollbar { width: 4px; }
.copilot-messages::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

.messages-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 20px 0; color: #8e8e93; font-size: 13px;
}
.empty-icon { color: #c7c7cc; }
.messages-empty p { margin: 0; }
.quick-actions { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.quick-btn {
  padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.10);
  background: white; font-size: 13px; color: #3c3c43; cursor: pointer; text-align: left;
}
.quick-btn:hover { background: rgba(74,123,200,0.06); border-color: rgba(74,123,200,0.18); }

.cp-msg { display: flex; flex-direction: column; gap: 5px; }
.cp-msg.user { align-items: flex-end; }
.cp-msg.assistant { align-items: stretch; }
.bubble-wrap { display: flex; gap: 7px; align-items: flex-start; }
.cp-avatar {
  width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 2px; color: #8e8e93;
}
.cp-avatar-logo { width: 18px; height: 18px; object-fit: contain; }
.bubble { max-width: 92%; border-radius: 12px; padding: 8px 11px; }
.user-bubble { background: #223F79; color: #fff; border-radius: 12px 12px 3px 12px; }
.asst-bubble {
  background: #fff; color: #1c1c1e; border: 1px solid rgba(0,0,0,0.08);
  border-radius: 3px 12px 12px 12px; min-width: 0;
}
.msg-text { font-size: 13px; line-height: 1.65; word-break: break-word; user-select: text; }
.user-text { color: #fff; white-space: pre-wrap; }
.ws-badge {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border-radius: 6px;
  background: rgba(34,197,94,0.10); color: #16a34a; font-size: 10.5px;
}
.att-row { display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end; }
.att-chip {
  display: inline-flex; align-items: center; gap: 4px; max-width: 180px;
  padding: 4px 8px; background: rgba(74,123,200,0.08);
  border: 1px solid rgba(74,123,200,0.15); border-radius: 6px;
  font-size: 11px; color: #4a7bc8;
}
.att-chip.user { background: rgba(34,63,121,0.08); color: #223F79; }
.att-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-pages { color: #aeaeb2; font-size: 10px; flex-shrink: 0; }

.asst-bubble.streaming::after {
  content: '▋';
  display: inline-block;
  animation: cp-blink 0.7s step-end infinite;
  color: #4a7bc8;
  margin-left: 2px;
}
.compare-content.streaming::after {
  content: '▋';
  display: inline-block;
  animation: cp-blink 0.7s step-end infinite;
  color: #4a7bc8;
  margin-left: 2px;
}
@keyframes cp-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
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

.msg-footer {
  display: flex; align-items: center; gap: 5px;
  font-size: 10.5px; color: #aeaeb2; padding-left: 29px;
  opacity: 0; transition: opacity 0.15s;
}
.cp-msg.assistant:hover .msg-footer { opacity: 1; }
.msg-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.msg-action-btn {
  width: 24px; height: 24px; border: none; border-radius: 6px; background: transparent;
  color: #aeaeb2; display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.12s, color 0.12s;
}
.msg-action-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }
.msg-action-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.msg-action-btn.danger:hover { background: rgba(239,68,68,0.10); color: #ef4444; }

.user-msg-footer {
  display: flex; align-items: center; gap: 2px; justify-content: flex-end;
  padding-right: 2px; opacity: 0; transition: opacity 0.15s;
}
.cp-msg.user:hover .user-msg-footer { opacity: 1; }

.msg-picker-wrap { position: relative; }
.msg-model-picker {
  position: absolute; bottom: calc(100% + 4px); left: 0;
  width: 200px; max-height: 280px; overflow-y: auto;
  background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 400; padding: 4px 0;
}
.picker-empty { padding: 10px 12px; font-size: 12px; color: #8e8e93; }
.picker-group-label { padding: 5px 12px 2px; font-size: 10.5px; color: #8e8e93; font-weight: 600; }
.picker-model-item {
  display: block; width: 100%; padding: 6px 12px; background: transparent;
  border: none; font-size: 12px; color: #1c1c1e; text-align: left; cursor: pointer;
}
.picker-model-item:hover { background: rgba(0,0,0,0.04); }
.picker-pop-enter-active, .picker-pop-leave-active { transition: opacity 0.1s, transform 0.1s; }
.picker-pop-enter-from, .picker-pop-leave-to { opacity: 0; transform: translateY(4px); }


.context-divider { display: flex; align-items: center; gap: 8px; padding: 4px 0; width: 100%; user-select: none; }
.context-divider-line { flex: 1; height: 1px; background: linear-gradient(90deg, transparent, rgba(34,63,121,0.25), transparent); }
.context-divider-label { font-size: 11px; color: rgba(34,63,121,0.6); white-space: nowrap; font-weight: 500; }
.context-divider-remove {
  width: 18px; height: 18px; border: none; background: rgba(34,63,121,0.08);
  color: rgba(34,63,121,0.5); border-radius: 50%; display: flex; align-items: center;
  justify-content: center; cursor: pointer; flex-shrink: 0;
}

.input-area {
  padding: 10px 12px 12px;
  background: #f5f5f7;
  border-top: 1px solid rgba(0,0,0,0.06);
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex-shrink: 0;
}
.context-bar { display: flex; align-items: center; justify-content: space-between; min-height: 26px; gap: 8px; }
.context-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: rgba(0,0,0,0.05);
  border-radius: 8px;
  min-width: 0;
}
.ctx-tab {
  min-width: 38px;
  height: 22px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #6e6e73;
  font-size: 11.5px;
  cursor: pointer;
  white-space: nowrap;
}
.ctx-tab:hover:not(:disabled) { background: rgba(255,255,255,0.75); color: #3c3c43; }
.ctx-tab.active { background: #fff; color: #4a7bc8; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.ctx-tab:disabled { opacity: 0.38; cursor: not-allowed; }
.ctx-view-btn {
  display: inline-flex; align-items: center; gap: 4px; border: none; background: transparent;
  color: #8e8e93; font-size: 11.5px; cursor: pointer; border-radius: 6px; padding: 3px 6px;
}
.ctx-view-btn:hover { background: rgba(0,0,0,0.05); color: #3c3c43; }
.ctx-preview {
  max-height: 150px; display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid rgba(0,0,0,0.08); border-radius: 8px; background: #fff;
}
.ctx-preview-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 10px; background: rgba(0,0,0,0.03);
  font-size: 11px; color: #6e6e73; font-weight: 500; flex-shrink: 0;
}
.ctx-preview-header button { border: none; background: transparent; color: #8e8e93; cursor: pointer; display: flex; }
.ctx-preview-body {
  padding: 6px 10px 8px; font-size: 11.5px; line-height: 1.55; color: #3c3c43;
  overflow-y: auto; white-space: pre-wrap; word-break: break-word;
}

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
.rm-btn {
  position: absolute; top: -4px; right: -4px; width: 16px; height: 16px; border-radius: 50%;
  background: rgba(0,0,0,0.55); border: none; color: white; display: flex; align-items: center;
  justify-content: center; cursor: pointer;
}
.rm-btn.inline { position: static; background: transparent; color: #aeaeb2; width: 14px; height: 14px; flex-shrink: 0; }
.rm-btn.inline:hover { color: #ef4444; }
.pdf-warn { font-size: 11px; color: #b45309; background: #fef3c7; border: 1px solid #fde68a; border-radius: 6px; padding: 4px 9px; }

.input-box {
  background: #fff;
  border: 1.5px solid rgba(0,0,0,0.08);
  border-radius: 13px;
  display: flex;
  flex-direction: column;
}
.input-box:focus-within { border-color: rgba(74,123,200,0.35); }
.input-textarea {
  width: 100%; background: transparent; border: none; outline: none; resize: none;
  font-size: 13px; line-height: 1.55; color: #1c1c1e; font-family: inherit;
  max-height: 160px; overflow-y: auto; padding: 10px 12px 0; user-select: text;
}
.input-textarea::placeholder { color: #aeaeb2; }
.input-toolbar { display: flex; align-items: center; padding: 5px 7px 7px; gap: 1px; }
.toolbar-spacer { flex: 1; }
.toolbar-btn {
  width: 30px; height: 30px; border: none; background: transparent;
  color: #8e8e93; border-radius: 8px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.12s, color 0.12s; position: relative; flex-shrink: 0;
}
.toolbar-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }
.toolbar-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.toolbar-btn-active { color: #4a7bc8 !important; background: rgba(74,123,200,0.08) !important; }

.reasoning-wrap { position: relative; }
.reasoning-badge {
  position: absolute; top: 2px; right: 2px; font-size: 8px; font-weight: 700;
  color: #4a7bc8; background: rgba(74,123,200,0.15); border-radius: 3px; padding: 0 2px; line-height: 1.4;
}
.reasoning-popover {
  position: absolute; bottom: calc(100% + 6px); left: 0; width: 176px; background: #fff;
  border: 1px solid rgba(0,0,0,0.08); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.10); z-index: 300; padding: 10px;
}
.reasoning-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.reasoning-label { font-size: 12.5px; color: #1c1c1e; font-weight: 500; }
.reasoning-toggle {
  width: 34px; height: 20px; border-radius: 10px; background: #d1d1d6; border: none;
  cursor: pointer; position: relative; transition: background 0.2s;
}
.reasoning-toggle.on { background: #4a7bc8; }
.toggle-knob {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: white; transition: transform 0.2s; display: block;
}
.reasoning-toggle.on .toggle-knob { transform: translateX(14px); }
.reasoning-levels { display: flex; gap: 4px; }
.level-btn {
  flex: 1; padding: 4px 0; border: 1px solid rgba(0,0,0,0.08); border-radius: 6px;
  background: transparent; font-size: 12px; color: #6e6e73; cursor: pointer;
}
.level-btn.active { background: rgba(74,123,200,0.1); border-color: rgba(74,123,200,0.25); color: #4a7bc8; }
.reasoning-hint { font-size: 11px; color: #8e8e93; margin-top: 6px; }

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

.sm-drop-enter-active, .sm-drop-leave-active,
.reasoning-drop-enter-active, .reasoning-drop-leave-active { transition: opacity 0.1s, transform 0.1s; }
.sm-drop-enter-from, .sm-drop-leave-to { opacity: 0; transform: translateY(-4px); }
.reasoning-drop-enter-from, .reasoning-drop-leave-to { opacity: 0; transform: translateY(4px); }

/* ─── Theme variants ─────────────────────────────────────────────────────── */
.cp-theme-sepia.reader-copilot { background: #ede7d3; color: #3b2e1a; }
.cp-theme-sepia .copilot-header { border-bottom-color: rgba(0,0,0,0.08); }
.cp-theme-sepia .asst-bubble { background: #f4ecd8; border-color: rgba(0,0,0,0.07); color: #3b2e1a; }
.cp-theme-sepia .input-area { background: #e6dfc8; border-top-color: rgba(0,0,0,0.07); }
.cp-theme-sepia.reader-copilot .input-box { background: #f4ecd8; border-color: rgba(0,0,0,0.10); color: #3b2e1a; }
.cp-theme-sepia.reader-copilot .input-box:focus-within { border-color: rgba(58,46,26,0.3); }
.cp-theme-sepia.reader-copilot .input-textarea { color: #3b2e1a; }
.cp-theme-sepia.reader-copilot .input-textarea::placeholder { color: rgba(59,46,26,0.4); }
.cp-theme-sepia.reader-copilot .context-tabs { background: rgba(0,0,0,0.06); }
.cp-theme-sepia.reader-copilot .ctx-tab.active { background: #f4ecd8; }
.cp-theme-sepia .msg-input { color: #3b2e1a; }
.cp-theme-sepia .msg-input::placeholder { color: rgba(59,46,26,0.4); }
.cp-theme-sepia .history-dropdown { background: #f4ecd8; border-color: rgba(0,0,0,0.10); }
.cp-theme-sepia .history-item:hover { background: rgba(0,0,0,0.05); }
.cp-theme-sepia .history-item.active { background: rgba(0,0,0,0.06); }
.cp-theme-sepia .quick-btn { background: #f4ecd8; border-color: rgba(0,0,0,0.10); color: #3b2e1a; }
.cp-theme-sepia .context-bar-label { color: #3b2e1a; }
.cp-theme-sepia .compare-col { background: #f4ecd8; border-color: rgba(0,0,0,0.08); }
.cp-theme-sepia .compare-col-header { background: rgba(0,0,0,0.03); border-bottom-color: rgba(0,0,0,0.06); color: #7a6a52; }
.cp-theme-sepia .var-btn { background: rgba(0,0,0,0.05); }
.cp-theme-sepia .var-btn.active { border-color: #7a6a52; background: rgba(0,0,0,0.08); }
.cp-theme-sepia .var-layout-btn { border-color: rgba(0,0,0,0.12); }
.cp-theme-sepia .msg-model-picker { background: #f4ecd8; border-color: rgba(0,0,0,0.10); }
.cp-theme-sepia .picker-model-item { color: #3b2e1a; }
.cp-theme-sepia .picker-model-item:hover { background: rgba(0,0,0,0.05); }
.cp-theme-sepia .compare-add-btn { border-color: rgba(0,0,0,0.15); color: #7a6a52; }
.cp-theme-sepia .second-model-dropdown { background: #f4ecd8; border-color: rgba(0,0,0,0.10); }
.cp-theme-sepia .sm-model-btn { color: #3b2e1a; }
.cp-theme-sepia .sm-model-btn:hover { background: rgba(0,0,0,0.05); }

.cp-theme-dark.reader-copilot { background: #2c2c2e; color: #e5e5ea; }
.cp-theme-dark .copilot-header { border-bottom-color: rgba(255,255,255,0.08); }
.cp-theme-dark .asst-bubble { background: #3a3a3c; border-color: rgba(255,255,255,0.08); color: #e5e5ea; }
.cp-theme-dark .input-area { background: #1c1c1e; border-top-color: rgba(255,255,255,0.08); }
.cp-theme-dark.reader-copilot .input-box { background: #3a3a3c; border-color: rgba(255,255,255,0.10); color: #e5e5ea; }
.cp-theme-dark.reader-copilot .input-box:focus-within { border-color: rgba(109,155,239,0.4); }
.cp-theme-dark.reader-copilot .input-textarea { color: #e5e5ea; }
.cp-theme-dark.reader-copilot .input-textarea::placeholder { color: rgba(229,229,234,0.35); }
.cp-theme-dark.reader-copilot .context-tabs { background: rgba(255,255,255,0.07); }
.cp-theme-dark.reader-copilot .ctx-tab.active { background: #3a3a3c; }
.cp-theme-dark .msg-input { color: #e5e5ea; }
.cp-theme-dark .msg-input::placeholder { color: rgba(229,229,234,0.35); }
.cp-theme-dark .history-dropdown { background: #3a3a3c; border-color: rgba(255,255,255,0.10); }
.cp-theme-dark .history-item { border-bottom-color: rgba(255,255,255,0.05); color: #e5e5ea; }
.cp-theme-dark .history-item:hover { background: rgba(255,255,255,0.06); }
.cp-theme-dark .history-item.active { background: rgba(109,155,239,0.12); }
.cp-theme-dark .quick-btn { background: #3a3a3c; border-color: rgba(255,255,255,0.10); color: #e5e5ea; }
.cp-theme-dark .compare-col { background: #3a3a3c; border-color: rgba(255,255,255,0.08); }
.cp-theme-dark .compare-col-header { background: rgba(255,255,255,0.04); border-bottom-color: rgba(255,255,255,0.06); color: #aeaeb2; }
.cp-theme-dark .var-btn { background: rgba(255,255,255,0.06); }
.cp-theme-dark .var-btn.active { border-color: #6d9bef; background: rgba(109,155,239,0.12); }
.cp-theme-dark .var-layout-btn { border-color: rgba(255,255,255,0.12); color: #aeaeb2; }
.cp-theme-dark .var-bar { border-top-color: rgba(255,255,255,0.08); }
.cp-theme-dark .hdr-btn { color: #e5e5ea; }
.cp-theme-dark .hdr-btn:hover { background: rgba(255,255,255,0.10); }
.cp-theme-dark .toolbar-btn { color: #aeaeb2; }
.cp-theme-dark .toolbar-btn:hover { background: rgba(255,255,255,0.08); }
.cp-theme-dark .context-bar-label { color: #aeaeb2; }
.cp-theme-dark .msg-model-picker { background: #3a3a3c; border-color: rgba(255,255,255,0.10); }
.cp-theme-dark .picker-model-item { color: #e5e5ea; }
.cp-theme-dark .picker-model-item:hover { background: rgba(255,255,255,0.07); }
.cp-theme-dark .compare-add-btn { border-color: rgba(255,255,255,0.15); color: #aeaeb2; }
.cp-theme-dark .second-model-dropdown { background: #3a3a3c; border-color: rgba(255,255,255,0.10); }
.cp-theme-dark .sm-model-btn { color: #e5e5ea; }
.cp-theme-dark .sm-model-btn:hover { background: rgba(255,255,255,0.07); }
.cp-theme-dark .input-textarea { color: #e5e5ea; }

/* ─── Media outputs ─────────────────────────────────────────────────────────── */
.media-outputs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}
.media-img-wrap {
  position: relative;
  display: inline-block;
  border-radius: 12px;
  overflow: hidden;
}
.media-img {
  display: block;
  max-width: 280px;
  max-height: 280px;
  width: auto;
  height: auto;
  border-radius: 12px;
  cursor: zoom-in;
  object-fit: contain;
}
.media-download-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s, background 0.15s;
  z-index: 2;
}
.media-img-wrap:hover .media-download-btn {
  opacity: 1;
}
.media-download-btn:hover {
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
}
.media-video-wrap {
  position: relative;
  display: inline-block;
  max-width: 320px;
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
}
.media-video-wrap .media-video {
  width: 100%;
  display: block;
  border-radius: 12px;
  background: #000;
}
.media-video-download-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s, background 0.15s;
  z-index: 2;
}
.media-video-wrap:hover .media-video-download-btn {
  opacity: 1;
}
.media-video-download-btn:hover {
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
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
</style>
