import { defineStore } from 'pinia'
import { ref, reactive, computed } from 'vue'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { writeTextFile, readTextFile, exists, mkdir, remove } from '@tauri-apps/plugin-fs'
import { appDataDir } from '@tauri-apps/api/path'
import { useAiSettingsStore, calculateModelCost } from './aiSettings'
import { useChatSettingsStore } from './chatSettings'
import { useWebSearchStore } from './webSearch'
import { performSearch, formatSearchResultsForContext } from '../services/webSearch'
import { getBackendConfig } from '../utils/backendConfig'
import { apiPut } from '../services/api'
import { ocrImage } from '../utils/ocr'
import type { AttachmentMeta, MessageUsage, WebSearchResult } from '../utils/storage'
import { resolveDataRoot } from '../utils/path'
import { beginSyncOp, endSyncOp, failSyncOp, setSyncModule } from './syncStatus'
import { setClientUsage, getClientUsage } from '../services/clientUsage'

// ─── Paper Copilot usage tracking ────────────────────────────────────────────

export interface PaperCopilotDailyStat {
  inputTokens: number
  outputTokens: number
  costUsd: number
  requests: number
}

const PAPER_COPILOT_STATS_KEY = 'paper-copilot-stats'

export async function recordPaperCopilotUsage(inputTokens: number, outputTokens: number, costUsd: number): Promise<void> {
  try {
    const path = `${await resolveDataRoot()}/paper-copilot-stats.json`
    let stats: Record<string, PaperCopilotDailyStat> = {}
    try { if (await exists(path)) stats = JSON.parse(await readTextFile(path)) } catch {}
    const date = new Date().toISOString().slice(0, 10)
    const s = stats[date] ?? { inputTokens: 0, outputTokens: 0, costUsd: 0, requests: 0 }
    s.inputTokens  += inputTokens ?? 0
    s.outputTokens += outputTokens ?? 0
    s.costUsd      += costUsd ?? 0
    s.requests     += 1
    stats[date] = s
    await writeTextFile(path, JSON.stringify(stats))
    // Also push to backend via client-usage
    await setClientUsage(PAPER_COPILOT_STATS_KEY, stats)
  } catch { /* non-critical */ }
}

export async function loadPaperCopilotStatsFromServer(): Promise<Record<string, PaperCopilotDailyStat> | null> {
  return getClientUsage<Record<string, PaperCopilotDailyStat>>(PAPER_COPILOT_STATS_KEY)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaperMessageVariant {
  id: string
  content: string
  reasoning?: string
  model?: string
  providerId?: string
  usage?: MessageUsage
  error?: boolean
}

export interface PaperChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  model?: string
  providerId?: string
  error?: boolean
  reasoning?: string
  usage?: MessageUsage
  timestamp: string
  attachments?: AttachmentMeta[]
  variants?: PaperMessageVariant[]
  activeVariantIdx?: number
  webSearchResults?: WebSearchResult[]
}

export interface PaperConversation {
  id: string
  paperId: string
  paperSource: string
  title: string
  providerId?: string
  model?: string
  createdAt: string
  updatedAt: string
  messageCount: number
  messages: PaperChatMessage[]
  contextCutoffPoints?: string[]
}

export interface PaperConversationMeta {
  id: string
  paperId: string
  paperSource: string
  title: string
  providerId?: string
  model?: string
  createdAt: string
  updatedAt: string
  messageCount: number
  messages?: PaperChatMessage[]
  contextCutoffPoints?: string[]
}

// ─── Streaming types ──────────────────────────────────────────────────────────

interface StreamChunkHandler {
  onToken:           (token: string) => void
  onDone:            (usage: MessageUsage) => void | Promise<void>
  onError:           (err: string) => void | Promise<void>
  onReasoningToken?: (token: string) => void
}

// ─── Pending upload persistence ───────────────────────────────────────────────
// Survives app restarts: binary saved as base64 text + metadata in queue.json.

interface PendingUpload {
  paperId: string
  source:  string
  convId:  string
  msgId:   string
  att: { id: string; name: string; mimeType: string; extractedText?: string }
}

async function _pendingDir(): Promise<string> {
  const base = await appDataDir()
  const dir  = `${base}/paper_copilot_pending`
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

async function _loadPendingQueue(): Promise<PendingUpload[]> {
  try {
    const dir  = await _pendingDir()
    const path = `${dir}/queue.json`
    if (!(await exists(path))) return []
    return JSON.parse(await readTextFile(path)) as PendingUpload[]
  } catch { return [] }
}

async function _savePendingQueue(queue: PendingUpload[]): Promise<void> {
  try {
    const dir = await _pendingDir()
    await writeTextFile(`${dir}/queue.json`, JSON.stringify(queue))
  } catch { /* ignore */ }
}

async function _persistPendingUpload(
  paperId: string, source: string, convId: string, msgId: string, att: AttachmentMeta,
): Promise<void> {
  try {
    if (!att.data) return
    const dir = await _pendingDir()
    await writeTextFile(`${dir}/${att.id}.b64`, att.data)
    const queue = await _loadPendingQueue()
    if (!queue.some(q => q.att.id === att.id)) {
      queue.push({ paperId, source, convId, msgId, att: { id: att.id, name: att.name, mimeType: att.mimeType, extractedText: att.extractedText } })
      await _savePendingQueue(queue)
    }
  } catch { /* ignore */ }
}

async function _clearPendingUpload(attId: string): Promise<void> {
  try {
    const dir      = await _pendingDir()
    const filePath = `${dir}/${attId}.b64`
    if (await exists(filePath)) await remove(filePath)
    const queue    = await _loadPendingQueue()
    const filtered = queue.filter(q => q.att.id !== attId)
    if (filtered.length !== queue.length) await _savePendingQueue(filtered)
  } catch { /* ignore */ }
}

// ─── Stream helpers ────────────────────────────────────────────────────────────

function isOpenRouter(baseUrl: string): boolean {
  return baseUrl.includes('openrouter.ai')
}

// ─── Stream functions (copied from chat.ts) ───────────────────────────────────

async function streamOpenAI(
  baseUrl: string, apiKey: string, model: string,
  messages: { role: string; content: unknown }[],
  handler: StreamChunkHandler, signal: AbortSignal,
  systemPrompt?: string, temperature?: number, maxTokens?: number,
) {
  const allMessages = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages
  const reqBody: Record<string, unknown> = { model, messages: allMessages, stream: true, stream_options: { include_usage: true } }
  if (temperature !== undefined) reqBody.temperature = temperature
  if (maxTokens   !== undefined) reqBody.max_tokens  = maxTokens
  const resp = await tauriFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody), signal,
  })
  if (!resp.ok) { handler.onError(`API error ${resp.status}: ${await resp.text()}`); return }
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const usage: MessageUsage = {}
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') { await handler.onDone(usage); return }
      try {
        const parsed = JSON.parse(data)
        const raw = parsed.choices?.[0]?.delta?.content
        if (raw && typeof raw === 'string') handler.onToken(raw)
        const reasoning = parsed.choices?.[0]?.delta?.reasoning ?? parsed.choices?.[0]?.delta?.reasoning_content ?? parsed.choices?.[0]?.delta?.thinking
        if (reasoning && handler.onReasoningToken) handler.onReasoningToken(reasoning)
        if (parsed.usage) {
          usage.inputTokens  = parsed.usage.prompt_tokens
          usage.outputTokens = parsed.usage.completion_tokens
          if (parsed.usage.cost      != null) usage.costUsd = parsed.usage.cost
          if (parsed.usage.total_cost != null) usage.costUsd = parsed.usage.total_cost
        }
      } catch { /* skip */ }
    }
  }
  await handler.onDone(usage)
}

async function streamDeepSeek(
  baseUrl: string, apiKey: string, model: string,
  messages: { role: string; content: unknown }[],
  handler: StreamChunkHandler, signal: AbortSignal,
  systemPrompt?: string, temperature?: number, maxTokens?: number,
) {
  const allMessages = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages
  const reqBody: Record<string, unknown> = { model, messages: allMessages, stream: true, stream_options: { include_usage: true }, thinking: { type: 'disabled' } }
  if (temperature !== undefined) reqBody.temperature = temperature
  if (maxTokens   !== undefined) reqBody.max_tokens  = maxTokens
  const resp = await tauriFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody), signal,
  })
  if (!resp.ok) { handler.onError(`API error ${resp.status}: ${await resp.text()}`); return }
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const usage: MessageUsage = {}
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') { await handler.onDone(usage); return }
      try {
        const parsed = JSON.parse(data)
        const raw = parsed.choices?.[0]?.delta?.content
        if (raw && typeof raw === 'string') handler.onToken(raw)
        if (parsed.usage) {
          usage.inputTokens  = parsed.usage.prompt_tokens
          usage.outputTokens = parsed.usage.completion_tokens
        }
      } catch { /* skip */ }
    }
  }
  await handler.onDone(usage)
}

async function streamAnthropic(
  baseUrl: string, apiKey: string, model: string,
  messages: { role: string; content: unknown }[],
  handler: StreamChunkHandler, signal: AbortSignal,
  systemPrompt?: string, thinkingBudget?: number, temperature?: number, maxTokens?: number,
) {
  const body: Record<string, unknown> = { model, messages, max_tokens: maxTokens ?? 8192, stream: true }
  if (systemPrompt) body.system = systemPrompt
  if (temperature !== undefined) body.temperature = temperature
  if (thinkingBudget) {
    body.thinking   = { type: 'enabled', budget_tokens: thinkingBudget }
    body.max_tokens = Math.max(16384, thinkingBudget + 4096)
  }
  const resp = await tauriFetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal,
  })
  if (!resp.ok) { handler.onError(`API error ${resp.status}: ${await resp.text()}`); return }
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const usage: MessageUsage = {}
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      try {
        const parsed = JSON.parse(trimmed.slice(6))
        if (parsed.type === 'message_start')   usage.inputTokens  = parsed.message?.usage?.input_tokens
        if (parsed.type === 'message_delta')   usage.outputTokens = parsed.usage?.output_tokens
        if (parsed.type === 'content_block_delta') {
          if (parsed.delta?.type === 'thinking_delta' && handler.onReasoningToken) handler.onReasoningToken(parsed.delta.thinking)
          else if (parsed.delta?.type === 'text_delta') handler.onToken(parsed.delta.text)
        }
        if (parsed.type === 'message_stop') { await handler.onDone(usage); return }
      } catch { /* skip */ }
    }
  }
  await handler.onDone(usage)
}

async function streamGoogle(
  baseUrl: string, apiKey: string, model: string,
  messages: { role: string; content: unknown }[],
  handler: StreamChunkHandler, signal: AbortSignal,
  systemPrompt?: string, temperature?: number, maxTokens?: number,
) {
  const geminiMessages = messages.map(m => ({
    role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
    parts: Array.isArray(m.content) ? m.content : [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }))
  const reqBody: Record<string, unknown> = { contents: geminiMessages }
  if (systemPrompt) reqBody.systemInstruction = { parts: [{ text: systemPrompt }] }
  if (temperature !== undefined || maxTokens !== undefined) {
    const cfg: Record<string, unknown> = {}
    if (temperature !== undefined) cfg.temperature     = temperature
    if (maxTokens   !== undefined) cfg.maxOutputTokens = maxTokens
    reqBody.generationConfig = cfg
  }
  const resp = await tauriFetch(
    `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody), signal },
  )
  if (!resp.ok) { handler.onError(`API error ${resp.status}: ${await resp.text()}`); return }
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const usage: MessageUsage = {}
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      try {
        const parsed = JSON.parse(trimmed.slice(6))
        const parts: Array<{ text?: string }> = parsed.candidates?.[0]?.content?.parts ?? []
        for (const part of parts) { if (part.text) handler.onToken(part.text) }
        if (parsed.usageMetadata) {
          usage.inputTokens  = parsed.usageMetadata.promptTokenCount
          usage.outputTokens = parsed.usageMetadata.candidatesTokenCount
        }
      } catch { /* skip */ }
    }
  }
  await handler.onDone(usage)
}

async function streamOllama(
  baseUrl: string, model: string,
  messages: { role: string; content: unknown }[],
  handler: StreamChunkHandler, signal: AbortSignal,
  systemPrompt?: string, temperature?: number, maxTokens?: number,
) {
  const allMessages = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : [...messages]
  const reqBody: Record<string, unknown> = { model, messages: allMessages, stream: true }
  const options: Record<string, unknown> = {}
  if (temperature !== undefined) options.temperature = temperature
  if (maxTokens   !== undefined) options.num_predict = maxTokens
  if (Object.keys(options).length) reqBody.options = options
  const resp = await tauriFetch(`${baseUrl}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody), signal,
  })
  if (resp.status === 404) {
    await streamOpenAI(`${baseUrl}/v1`, '', model, allMessages, handler, signal, undefined, temperature, maxTokens)
    return
  }
  if (!resp.ok) { handler.onError(`Ollama error ${resp.status}: ${await resp.text()}`); return }
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed.message?.thinking && handler.onReasoningToken) handler.onReasoningToken(parsed.message.thinking)
        if (parsed.message?.content) handler.onToken(parsed.message.content)
        if (parsed.done) {
          const usage: MessageUsage = {}
          if (parsed.prompt_eval_count != null) usage.inputTokens  = parsed.prompt_eval_count
          if (parsed.eval_count        != null) usage.outputTokens = parsed.eval_count
          await handler.onDone(usage)
          return
        }
      } catch { /* skip */ }
    }
  }
  await handler.onDone({})
}

async function _dispatchStream(
  provider: { type: string; baseUrl: string; apiKey: string },
  modelId: string,
  payload: { role: string; content: unknown }[],
  handler: StreamChunkHandler,
  signal: AbortSignal,
  systemPrompt?: string,
  thinkingBudget?: number,
  temperature?: number,
  maxTokens?: number,
) {
  if (provider.type === 'anthropic') {
    await streamAnthropic(provider.baseUrl, provider.apiKey, modelId, payload, handler, signal, systemPrompt, thinkingBudget, temperature, maxTokens)
  } else if (provider.type === 'google') {
    await streamGoogle(provider.baseUrl, provider.apiKey, modelId, payload, handler, signal, systemPrompt, temperature, maxTokens)
  } else if (provider.type === 'ollama') {
    await streamOllama(provider.baseUrl, modelId, payload, handler, signal, systemPrompt, temperature, maxTokens)
  } else if (provider.type === 'deepseek' || provider.baseUrl.includes('deepseek')) {
    await streamDeepSeek(provider.baseUrl, provider.apiKey, modelId, payload, handler, signal, systemPrompt, temperature, maxTokens)
  } else {
    await streamOpenAI(provider.baseUrl, provider.apiKey, modelId, payload, handler, signal, systemPrompt, temperature, maxTokens)
  }
}

function buildPayload(
  messages: PaperChatMessage[],
  providerType: string,
  baseUrl?: string,
): { role: string; content: unknown }[] {
  const openRouter = baseUrl ? isOpenRouter(baseUrl) : false
  return messages.filter(m => !m.error).map(m => {
    const atts   = m.attachments ?? []
    const images = atts.filter(a => a.mimeType?.startsWith('image/') && a.data)
    const pdfs   = atts.filter(a => a.mimeType === 'application/pdf'  && a.data)

    if (providerType === 'google') {
      const parts: unknown[] = []
      for (const pdf of pdfs)   parts.push({ inlineData: { mimeType: 'application/pdf', data: pdf.data } })
      for (const img of images) parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } })
      if (m.content) parts.push({ text: m.content })
      return { role: m.role === 'assistant' ? 'model' : 'user', content: parts.length > 0 ? parts : [{ text: m.content }] }
    }

    if (providerType === 'anthropic') {
      const blocks: unknown[] = []
      for (const pdf of pdfs)   blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.data } })
      for (const img of images) blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } })
      if (m.content) blocks.push({ type: 'text', text: m.content })
      if (blocks.length > 1 || pdfs.length > 0 || images.length > 0) return { role: m.role, content: blocks }
      return { role: m.role, content: m.content }
    }

    if (pdfs.length > 0 || images.length > 0) {
      const imagesForUrl = images.filter(img => !img.extractedText)
      const imagesAsText = images.filter(img =>  img.extractedText)
      const contentParts: unknown[] = []
      if (openRouter) {
        const ocrTexts  = imagesAsText.map(img => `[图片OCR内容]\n${img.extractedText}`)
        const textParts = [...ocrTexts, m.content].filter(Boolean).join('\n\n---\n\n')
        if (textParts) contentParts.push({ type: 'text', text: textParts })
        for (const pdf of pdfs)   contentParts.push({ type: 'file', file: { filename: pdf.name || 'document.pdf', file_data: `data:application/pdf;base64,${pdf.data}` } })
        for (const img of imagesForUrl) contentParts.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } })
        return { role: m.role, content: contentParts }
      }
      const ocrTexts = imagesAsText.map(img => `[图片OCR内容]\n${img.extractedText}`)
      const pdfTexts = pdfs.map(pdf => `${pdf.name}\n${pdf.extractedText || '（无法提取文字内容）'}`)
      const fullText = [...ocrTexts, ...pdfTexts].length > 0 ? `${[...ocrTexts, ...pdfTexts].join('\n\n')}\n\n---\n\n${m.content}` : m.content
      if (imagesForUrl.length > 0) {
        contentParts.push({ type: 'text', text: fullText })
        for (const img of imagesForUrl) contentParts.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } })
        return { role: m.role, content: contentParts }
      }
      return { role: m.role, content: fullText }
    }
    return { role: m.role, content: m.content }
  })
}

async function applyOcrToMessages(messages: PaperChatMessage[]): Promise<PaperChatMessage[]> {
  return Promise.all(messages.map(async msg => {
    if (msg.role !== 'user' || !msg.attachments) return msg
    const needsOcr = msg.attachments.some(a => a.mimeType?.startsWith('image/') && a.data && !a.extractedText)
    if (!needsOcr) return msg
    const atts = await Promise.all(msg.attachments.map(async att => {
      if (att.mimeType?.startsWith('image/') && att.data && !att.extractedText) {
        const text = await ocrImage(att.data, att.mimeType)
        return { ...att, extractedText: text || '（图片内容无法识别）' }
      }
      return att
    }))
    return { ...msg, attachments: atts }
  }))
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const usePaperCopilotStore = defineStore('paperCopilot', () => {
  // ── Panel state ────────────────────────────────────────────────────────────
  const isOpen            = ref(false)
  const activePaperId     = ref<string | null>(null)
  const activePaperSource = ref<string>('arxiv')

  // ── Conversation state ─────────────────────────────────────────────────────
  // conversations holds ALL papers' conversations (single source of truth)
  const conversations     = ref<PaperConversationMeta[]>([])
  // Filtered view for the currently active paper
  const currentPaperConversations = computed(() =>
    conversations.value
      .filter(c => c.paperId === activePaperId.value && c.paperSource === activePaperSource.value)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  )
  const activeConvId      = ref<string | null>(null)
  const activeConv        = ref<PaperConversation | null>(null)
  const isLoadingConvs    = ref(false)
  const isLoadingMessages = ref(false)

  // ── Primary streaming state ────────────────────────────────────────────────
  const isStreaming        = ref(false)
  const streamingText      = ref('')
  const streamingReasoning = ref('')
  const streamingMsgId     = ref<string | null>(null)
  const _abortCtrl         = ref<AbortController | null>(null)

  // ── Second model streaming state ───────────────────────────────────────────
  const streamingVariantMsgIds    = reactive<Set<string>>(new Set())
  const streamingVariantText      = ref('')
  const streamingVariantReasoning = ref('')
  const _abortCtrl2               = ref<AbortController | null>(null)

  // Tracks attachment IDs whose binary has been successfully uploaded this session.
  // Prevents redundant re-uploads and enables retry-on-switch for failed uploads.
  const _uploadedAttachmentIds = new Set<string>()

  // ── Global chat options ────────────────────────────────────────────────────
  const webSearchEnabled = ref(false)
  const useReasoning     = ref(false)
  const reasoningLevel   = ref<'low' | 'medium' | 'high'>('medium')
  const secondProviderId = ref<string | null>(null)
  const secondModelId    = ref<string | null>(null)

  // ── Context mode ───────────────────────────────────────────────────────────
  const _DEFAULT_KEY = 'paperCopilot.defaultContextMode'
  const defaultContextMode = ref<'abstract' | 'fulltext' | 'none'>(
    (localStorage.getItem(_DEFAULT_KEY) as 'abstract' | 'fulltext' | 'none') ?? 'abstract',
  )
  const contextMode      = ref<'abstract' | 'fulltext' | 'none'>(defaultContextMode.value)
  const includeFullText  = computed(() => contextMode.value === 'fulltext')
  const paperFullText    = ref<string | null>(null)
  const paperFullTextBase64 = ref<string | null>(null)
  const paperAbstractText = ref<string | null>(null)
  const isExtractingText = ref(false)
  const fullTextError    = ref<string | null>(null)

  function setDefaultContextMode(mode: 'abstract' | 'fulltext' | 'none') {
    defaultContextMode.value = mode
    localStorage.setItem(_DEFAULT_KEY, mode)
    pushSettingsToServer().catch(() => {})
  }

  async function pushSettingsToServer() {
    await apiPut('/api/settings/paperCopilot', {
      value: { defaultContextMode: defaultContextMode.value },
    }).catch(() => {})
  }

  async function syncSettingsFromServer(allSettings: Record<string, unknown>) {
    const s = allSettings.paperCopilot as { defaultContextMode?: 'abstract' | 'fulltext' | 'none' } | undefined
    if (!s?.defaultContextMode) return
    defaultContextMode.value = s.defaultContextMode
    contextMode.value = s.defaultContextMode
    localStorage.setItem(_DEFAULT_KEY, s.defaultContextMode)
  }

  // ─── Local persistence for conversations ─────────────────────────────────────

  const LS_CONVERSATIONS = 'muse-paper-copilot-conversations'

  function loadConversationsFromStorage(): PaperConversation[] {
    try {
      const raw = localStorage.getItem(LS_CONVERSATIONS)
      if (!raw) return []
      return JSON.parse(raw) as PaperConversation[]
    } catch { return [] }
  }

  function saveConversationsToStorage() {
    try {
      localStorage.setItem(LS_CONVERSATIONS, JSON.stringify(conversations.value))
    } catch { /* ignore */ }
  }

  // Initialize from localStorage - load ALL conversations, filter per paper in loadConversations()
  const _storedConversations = loadConversationsFromStorage()
  if (_storedConversations.length) {
    conversations.value = _storedConversations.map(c => ({
      ...c,
      messages: c.messages ?? [],
      contextCutoffPoints: c.contextCutoffPoints ?? [],
    }))
  }

  // ── API helpers ────────────────────────────────────────────────────────────

  function _conn() {
    const c = getBackendConfig()
    return { baseUrl: c?.url ?? '', apiKey: c?.apiKey ?? '' }
  }
  function _headers() {
    return { Authorization: `Bearer ${_conn().apiKey}`, 'Content-Type': 'application/json' }
  }
  function _url(path: string) { return `${_conn().baseUrl}/api/papers${path}` }

  // ── Open / close ───────────────────────────────────────────────────────────

  async function openForPaper(paperId: string, paperSource: string) {
    const changed = paperId !== activePaperId.value || paperSource !== activePaperSource.value
    activePaperId.value     = paperId
    activePaperSource.value = paperSource
    isOpen.value            = true
    // Retry any binary uploads that didn't complete before the last app exit.
    retryPendingUploads().catch(() => {})
    if (changed) {
      paperFullText.value       = null
      paperFullTextBase64.value = null
      paperAbstractText.value   = null
      fullTextError.value       = null
      contextMode.value         = defaultContextMode.value
      activeConv.value       = null
      activeConvId.value     = null
      await loadConversations()
      const paperConvs = currentPaperConversations.value
      if (paperConvs.length > 0) await openConversation(paperConvs[0].id)
      else await createConversation()
    }
  }

  function close() { isOpen.value = false }

  // ── Content-based dedup helpers ───────────────────────────────────────────

  function _getConversationFingerprint(conv: PaperConversationMeta): string {
    const firstUser = conv.messages?.find(m => m.role === 'user')
    const firstUserContent = firstUser?.content ?? ''
    if (conv.title === '新对话') {
      return `${conv.paperId}|${conv.paperSource}|${firstUserContent}`
    }
    return `${conv.paperId}|${conv.paperSource}|${conv.title}|${firstUserContent}`
  }

  function _mergeConversationGroup(group: PaperConversationMeta[]): PaperConversationMeta {
    // Keep lexicographically smallest id
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id))
    const canonical = sorted[0]

    // Deduplicate messages by id, keep latest content
    const messageMap = new Map<string, PaperChatMessage>()
    for (const conv of group) {
      for (const msg of conv.messages ?? []) {
        const existing = messageMap.get(msg.id)
        if (!existing) {
          messageMap.set(msg.id, { ...msg })
        } else {
          if (msg.timestamp > existing.timestamp) {
            messageMap.set(msg.id, { ...msg })
          } else if (msg.timestamp === existing.timestamp) {
            // Prefer message with attachment binary data
            const hasData = (m: PaperChatMessage) => m.attachments?.some(a => a.data)
            if (hasData(msg) && !hasData(existing)) {
              messageMap.set(msg.id, { ...msg })
            }
          }
        }
      }
    }

    const mergedMessages = Array.from(messageMap.values()).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    const latestUpdatedAt = group.reduce((latest, c) => c.updatedAt > latest ? c.updatedAt : latest, group[0].updatedAt)

    return {
      ...canonical,
      messages: mergedMessages,
      messageCount: mergedMessages.length,
      updatedAt: latestUpdatedAt,
      contextCutoffPoints: canonical.contextCutoffPoints ?? [],
    }
  }

  async function _fetchMessagesForConv(convId: string): Promise<PaperChatMessage[] | null> {
    if (!activePaperId.value) return null
    try {
      const resp = await tauriFetch(
        _url(`/${activePaperId.value}/conversations/${convId}?source=${activePaperSource.value}`),
        { method: 'GET', headers: _headers() },
      )
      if (!resp.ok) return null
      const data = await resp.json() as Record<string, unknown>
      const rawMsgs = (data.messages ?? []) as any[]
      return rawMsgs.map((m: any) => ({
        id: m.id, role: m.role, content: m.content ?? '',
        timestamp: m.created_at, model: m.model, providerId: m.provider_id,
        error: m.error ?? false, reasoning: m.reasoning,
        usage: m.usage ? { inputTokens: m.usage.input_tokens, outputTokens: m.usage.output_tokens, costUsd: m.usage.cost } : undefined,
        attachments: (m.attachments ?? []).map((a: any) => ({
          id: a.id, name: a.name, mimeType: a.mime_type, size: a.size, pageCount: a.page_count,
        })),
      }))
    } catch { return null }
  }

  // Remap table: discarded id -> canonical id
  const _idRemap = new Map<string, string>()

  // ── Conversations CRUD ─────────────────────────────────────────────────────

  async function loadConversations() {
    if (!activePaperId.value) return
    isLoadingConvs.value = true
    beginSyncOp()
    setSyncModule('论文 Copilot')
    try {
      // Try backend first
      const resp = await tauriFetch(
        _url(`/${activePaperId.value}/conversations?source=${activePaperSource.value}`),
        { method: 'GET', headers: _headers() },
      )
      if (resp.ok) {
        const serverConvs = await resp.json() as PaperConversationMeta[]
        // Merge server conversations into the global list (preserving other papers' data)
        const origLocalIds = new Set(conversations.value.map(c => c.id))
        for (const sc of serverConvs) {
          if (!origLocalIds.has(sc.id)) {
            conversations.value.push({ ...sc, messages: sc.messages ?? [], contextCutoffPoints: sc.contextCutoffPoints ?? [] })
          } else {
            const idx = conversations.value.findIndex(c => c.id === sc.id)
            if (idx >= 0 && sc.updatedAt > conversations.value[idx].updatedAt) {
              // Preserve local messages if server meta is newer but has no messages
              const localMessages = conversations.value[idx].messages
              const localCutoffs = conversations.value[idx].contextCutoffPoints
              conversations.value[idx] = {
                ...conversations.value[idx],
                ...sc,
                messages: localMessages ?? [],
                contextCutoffPoints: localCutoffs ?? [],
              }
            }
          }
        }

        // ── Content-based deduplication ──────────────────────────────────────
        // Fetch messages for remote conversations that don't have them yet
        for (const conv of conversations.value) {
          if (!origLocalIds.has(conv.id) && (!conv.messages || conv.messages.length === 0)) {
            const msgs = await _fetchMessagesForConv(conv.id)
            if (msgs) {
              const idx = conversations.value.findIndex(c => c.id === conv.id)
              if (idx >= 0) {
                conversations.value[idx] = { ...conversations.value[idx], messages: msgs }
              }
            }
          }
        }

        // Group by content fingerprint
        const groups = new Map<string, PaperConversationMeta[]>()
        for (const conv of conversations.value) {
          const fp = _getConversationFingerprint(conv)
          if (!groups.has(fp)) groups.set(fp, [])
          groups.get(fp)!.push(conv)
        }

        const canonicalConvs: PaperConversationMeta[] = []
        const discardedRemoteIds: string[] = []
        _idRemap.clear()

        for (const group of groups.values()) {
          if (group.length === 1) {
            canonicalConvs.push(group[0])
            continue
          }
          const merged = _mergeConversationGroup(group)
          canonicalConvs.push(merged)

          for (const c of group) {
            if (c.id !== merged.id) {
              _idRemap.set(c.id, merged.id)
              if (!origLocalIds.has(c.id)) {
                discardedRemoteIds.push(c.id)
              }
            }
          }
        }

        // Update active conversation if its ID was remapped
        if (activeConvId.value && _idRemap.has(activeConvId.value)) {
          const newId = _idRemap.get(activeConvId.value)!
          activeConvId.value = newId
          if (activeConv.value) {
            activeConv.value.id = newId
          }
        }

        // Delete discarded remote conversations
        for (const id of discardedRemoteIds) {
          try {
            await tauriFetch(
              _url(`/${activePaperId.value}/conversations/${id}?source=${activePaperSource.value}`),
              { method: 'DELETE', headers: _headers() },
            )
          } catch { /* ignore */ }
        }

        conversations.value = canonicalConvs
        saveConversationsToStorage()
      }
      endSyncOp()
    } catch (e) { failSyncOp(e) } finally { isLoadingConvs.value = false }
  }

  async function createConversation(): Promise<PaperConversation | null> {
    if (!activePaperId.value) return null
    const aiStore = useAiSettingsStore()
    const id  = crypto.randomUUID()
    const pid = aiStore.paperDefaultProviderId || aiStore.activeProviderId
    const mid = aiStore.paperDefaultModelId || aiStore.activeModelId()
    const now = new Date().toISOString()
    const localConv: PaperConversation = {
      id, paperId: activePaperId.value, paperSource: activePaperSource.value,
      title: '新对话', providerId: pid, model: mid,
      createdAt: now, updatedAt: now, messageCount: 0, messages: [],
    }
    beginSyncOp()
    setSyncModule('论文 Copilot')
    try {
      const resp = await tauriFetch(
        _url(`/${activePaperId.value}/conversations?source=${activePaperSource.value}`),
        { method: 'POST', headers: _headers(), body: JSON.stringify({ id, provider_id: pid, model: mid }) },
      )
      if (resp.ok) Object.assign(localConv, await resp.json() as PaperConversationMeta)
      endSyncOp()
    } catch (e) { failSyncOp(e) }
    conversations.value.unshift({ ...localConv })
    activeConv.value   = localConv
    activeConvId.value = localConv.id
    saveConversationsToStorage()
    return localConv
  }

  async function openConversation(convId: string) {
    convId = _idRemap.get(convId) ?? convId
    if (activeConvId.value && _idRemap.has(activeConvId.value)) {
      activeConvId.value = _idRemap.get(activeConvId.value)!
      if (activeConv.value) activeConv.value.id = activeConvId.value
    }
    if (convId === activeConvId.value) return

    // Before switching away, retry any binary uploads that failed earlier this session.
    // Only fires for attachments that are still in memory (data present) but not yet
    // confirmed as uploaded (_uploadedAttachmentIds). Covers network-hiccup retry.
    const outgoing = activeConv.value
    if (outgoing) {
      for (const msg of outgoing.messages) {
        if (msg.role === 'user' && msg.attachments?.some(a => a.data && !_uploadedAttachmentIds.has(a.id))) {
          _uploadAttachmentBinaries(outgoing.id, msg.id, msg.attachments!).catch(() => {})
        }
      }
    }

    isLoadingMessages.value = true
    beginSyncOp()
    setSyncModule('论文 Copilot')
    let serverMessages: PaperChatMessage[] | null = null
    try {
      const resp = await tauriFetch(
        _url(`/${activePaperId.value}/conversations/${convId}?source=${activePaperSource.value}`),
        { method: 'GET', headers: _headers() },
      )
      if (resp.ok) {
        const data = await resp.json() as Record<string, unknown>
        const rawMsgs = (data.messages ?? []) as any[]
        serverMessages = rawMsgs.map((m: any) => ({
          id: m.id, role: m.role, content: m.content ?? '',
          timestamp: m.created_at, model: m.model, providerId: m.provider_id,
          error: m.error ?? false, reasoning: m.reasoning,
          usage: m.usage ? { inputTokens: m.usage.input_tokens, outputTokens: m.usage.output_tokens, costUsd: m.usage.cost } : undefined,
          attachments: (m.attachments ?? []).map((a: any) => ({
            id: a.id, name: a.name, mimeType: a.mime_type, size: a.size, pageCount: a.page_count,
          })),
        }))
        // Restore attachment binaries from server (for multi-device sync).
        // Only user messages can have attachments; fetch each binary in parallel.
        await Promise.all(serverMessages.flatMap(msg =>
          msg.role === 'user' && msg.attachments?.length
            ? msg.attachments.map(async att => {
                try {
                  const r = await tauriFetch(
                    _url(`/${activePaperId.value}/conversations/${convId}/attachments/${att.id}?source=${activePaperSource.value}`),
                    { method: 'GET', headers: _headers() },
                  )
                  if (r.ok) {
                    const bytes = new Uint8Array(await (await r.blob()).arrayBuffer())
                    let bin = ''
                    for (let i = 0; i < bytes.length; i += 8192) {
                      bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + 8192)))
                    }
                    att.data = btoa(bin)
                    _uploadedAttachmentIds.add(att.id)
                  }
                } catch { /* binary not uploaded yet or unavailable */ }
              })
            : [],
        ))
      }
      endSyncOp()
    } catch (e) { failSyncOp(e) }

    // Use server messages if available, otherwise fall back to local messages
    const idx = conversations.value.findIndex(c => c.id === convId)
    const localMeta = idx >= 0 ? conversations.value[idx] : null
    const messages = serverMessages ?? (localMeta?.messages ?? [])

    if (localMeta) {
      activeConv.value   = { ...localMeta, messages }
      activeConvId.value = convId
      // Update local storage with server messages (if fetched)
      if (serverMessages) {
        conversations.value[idx] = { ...localMeta, messages, messageCount: messages.length }
        saveConversationsToStorage()
      }
    }

    isLoadingMessages.value = false
  }

  async function deleteConversation(convId: string) {
    beginSyncOp()
    setSyncModule('论文 Copilot')
    try {
      await tauriFetch(
        _url(`/${activePaperId.value}/conversations/${convId}?source=${activePaperSource.value}`),
        { method: 'DELETE', headers: _headers() },
      )
      endSyncOp()
    } catch (e) { failSyncOp(e) }
    conversations.value = conversations.value.filter(c => c.id !== convId)
    saveConversationsToStorage()
    if (activeConvId.value === convId) {
      activeConv.value   = null
      activeConvId.value = null
      const paperConvs = currentPaperConversations.value
      if (paperConvs.length > 0) await openConversation(paperConvs[0].id)
      else await createConversation()
    }
  }

  // ── Backend sync ───────────────────────────────────────────────────────────

  async function _syncMessages(convId: string, msgs: PaperChatMessage[]) {
    if (!activePaperId.value) return
    beginSyncOp()
    setSyncModule('论文 Copilot')
    try {
      await tauriFetch(
        _url(`/${activePaperId.value}/conversations/${convId}/messages?source=${activePaperSource.value}`),
        {
          method: 'POST', headers: _headers(),
          body: JSON.stringify({
            messages: msgs.map(m => ({
              id: m.id, role: m.role, content: m.content,
              model: m.model ?? null, provider_id: m.providerId ?? null,
              error: m.error ?? false, reasoning: m.reasoning ?? null,
              usage: m.usage ? { input_tokens: m.usage.inputTokens, output_tokens: m.usage.outputTokens, cost: m.usage.costUsd } : null,
              created_at: m.timestamp,
              attachments: (m.attachments ?? []).map(a => ({
                id: a.id, name: a.name, mime_type: a.mimeType, size: a.size ?? 0, page_count: a.pageCount ?? null, extracted_text: a.extractedText ?? null,
              })),
            })),
          }),
        },
      )
      endSyncOp()
    } catch (e) { failSyncOp(e) }
  }

  async function _uploadAttachmentBinaries(convId: string, msgId: string, attachments: AttachmentMeta[]) {
    if (!activePaperId.value) return
    const paperId = activePaperId.value
    const source  = activePaperSource.value
    beginSyncOp()
    setSyncModule('论文 Copilot')
    try {
      for (const att of attachments) {
        if (!att.data || _uploadedAttachmentIds.has(att.id)) continue
        // Persist to disk before attempting upload so a restart can retry this.
        await _persistPendingUpload(paperId, source, convId, msgId, att)
        const binary = Uint8Array.from(atob(att.data), c => c.charCodeAt(0))
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const form = new FormData()
            form.append('file', new Blob([binary], { type: att.mimeType }), att.name)
            form.append('attachment_id', att.id)
            form.append('message_id', msgId)
            form.append('name', att.name)
            form.append('mime_type', att.mimeType)
            if (att.extractedText) form.append('extracted_text', att.extractedText)
            const r = await tauriFetch(
              _url(`/${paperId}/conversations/${convId}/attachments?source=${source}`),
              { method: 'POST', headers: { Authorization: `Bearer ${_conn().apiKey}` }, body: form },
            )
            if (r.ok) {
              _uploadedAttachmentIds.add(att.id)
              _clearPendingUpload(att.id).catch(() => {})
              break
            }
          } catch { /* retry */ }
        }
      }
      endSyncOp()
    } catch (e) { failSyncOp(e) }
  }

  async function retryPendingUploads(): Promise<void> {
    if (!getBackendConfig()) return
    let queue: PendingUpload[]
    try { queue = await _loadPendingQueue() } catch { return }
    if (queue.length === 0) return
    beginSyncOp()
    setSyncModule('论文 Copilot')
    const dir = await _pendingDir()
    try {
      for (const item of queue) {
      if (_uploadedAttachmentIds.has(item.att.id)) {
        _clearPendingUpload(item.att.id).catch(() => {})
        continue
      }
      const filePath = `${dir}/${item.att.id}.b64`
      if (!(await exists(filePath))) continue
      try {
        const b64    = await readTextFile(filePath)
        const binary = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const form = new FormData()
            form.append('file', new Blob([binary], { type: item.att.mimeType }), item.att.name)
            form.append('attachment_id', item.att.id)
            form.append('message_id', item.msgId)
            form.append('name', item.att.name)
            form.append('mime_type', item.att.mimeType)
            if (item.att.extractedText) form.append('extracted_text', item.att.extractedText)
            const r = await tauriFetch(
              _url(`/${item.paperId}/conversations/${item.convId}/attachments?source=${item.source}`),
              { method: 'POST', headers: { Authorization: `Bearer ${_conn().apiKey}` }, body: form },
            )
            if (r.ok) {
              _uploadedAttachmentIds.add(item.att.id)
              _clearPendingUpload(item.att.id).catch(() => {})
              break
            }
          } catch { /* retry */ }
        }
      } catch { /* skip this item */ }
      }
      endSyncOp()
    } catch (e) { failSyncOp(e) }
  }

  async function _updateTitle(convId: string, title: string) {
    if (!activePaperId.value) return
    beginSyncOp()
    setSyncModule('论文 Copilot')
    try {
      await tauriFetch(
        _url(`/${activePaperId.value}/conversations/${convId}?source=${activePaperSource.value}`),
        { method: 'PUT', headers: _headers(), body: JSON.stringify({ title }) },
      )
      endSyncOp()
    } catch (e) { failSyncOp(e) }
  }

  async function _generateTitleWithAI(firstUserContent: string): Promise<string | null> {
    const aiStore = useAiSettingsStore()
    const pid = aiStore.titleGenProviderId
    const mid = aiStore.titleGenModelId
    if (!pid || !mid) return null
    const provider = aiStore.providers.find(p => p.id === pid)
    if (!provider || (!provider.apiKey && provider.type !== 'ollama')) return null

    const prompt = `请为以下对话生成一个简短的标题（不超过15个字），直接返回标题文本，不要加引号或其他格式：\n\n用户问题：${firstUserContent.slice(0, 200)}`
    try {
      const resp = await tauriFetch(
        `${provider.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: mid,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 30,
            temperature: 0.5,
          }),
        },
      )
      if (!resp.ok) return null
      const data = await resp.json() as any
      const title = data.choices?.[0]?.message?.content?.trim()
      if (title) {
        // Clean up: remove quotes, limit length
        return title.replace(/^["'"'「『]|["'"'」』]$/g, '').slice(0, 30)
      }
    } catch { /* ignore */ }
    return null
  }

  // ── Send message ───────────────────────────────────────────────────────────

  async function sendMessage(userContent: string, attachments?: AttachmentMeta[]) {
    if (!userContent.trim() && !attachments?.length) return
    if (isStreaming.value) return
    if (!activeConv.value) await createConversation()
    const conv = activeConv.value!

    const aiStore      = useAiSettingsStore()
    const chatSettings = useChatSettingsStore()
    const pid = aiStore.paperDefaultProviderId || aiStore.activeProviderId
    const mid = aiStore.paperDefaultModelId || aiStore.activeModelId()
    const provider = aiStore.providers.find(p => p.id === pid)
    if (!provider || (!provider.apiKey && provider.type !== 'ollama')) {
      return
    }

    // Paper context system prompt based on contextMode
    const isPdfNative = provider.type === 'anthropic' || provider.type === 'google' || isOpenRouter(provider.baseUrl)
    let systemPrompt: string | undefined
    if (contextMode.value === 'fulltext') {
      if (!isPdfNative && paperFullText.value) {
        systemPrompt = `以下是论文的完整内容，请基于此内容回答用户的问题：\n\n${paperFullText.value}`
      }
    } else if (contextMode.value === 'abstract' && paperAbstractText.value) {
      systemPrompt = `以下是论文的基本信息，请基于此内容回答用户的问题：\n\n${paperAbstractText.value}`
    }

    // Wait for fulltext extraction if in fulltext mode and text not ready yet
    if (contextMode.value === 'fulltext' && !isPdfNative && !paperFullText.value && !fullTextError.value) {
      // Try to extract and wait
      try {
        await extractFullText(activePaperId.value!, activePaperSource.value)
        if (paperFullText.value) {
          systemPrompt = `以下是论文的完整内容，请基于此内容回答用户的问题：\n\n${paperFullText.value}`
        }
      } catch { /* ignore, will proceed without full text */ }
    }

    // Web search injection
    const wsStore = useWebSearchStore()
    const userMsg: PaperChatMessage = {
      id: crypto.randomUUID(), role: 'user', content: userContent,
      timestamp: new Date().toISOString(),
      attachments: attachments?.length ? attachments : undefined,
    }
    if (webSearchEnabled.value && wsStore.hasApiKey(wsStore.activeProviderId) && userContent.trim()) {
      try {
        const wsKey     = await wsStore.getApiKey(wsStore.activeProviderId)
        const wsOptions = wsStore.getSearchOptions(wsStore.activeProviderId)
        const wsResults = await performSearch(wsStore.activeProviderId, wsKey, userContent.trim(), wsOptions) as WebSearchResult[]
        if (wsResults.length > 0) {
          userMsg.webSearchResults = wsResults
          const ctx = formatSearchResultsForContext(wsResults, userContent.trim())
          systemPrompt = systemPrompt ? `${systemPrompt}\n\n${ctx}` : ctx
          wsStore.incrementUsage(wsStore.activeProviderId)
        }
      } catch { /* skip on search error */ }
    }

    const assistantMsg = reactive<PaperChatMessage>({
      id: crypto.randomUUID(), role: 'assistant', content: '',
      timestamp: new Date().toISOString(), model: mid, providerId: pid,
    })

    conv.messages.push(userMsg)
    conv.messages.push(assistantMsg)
    conv.updatedAt    = new Date().toISOString()
    conv.messageCount = conv.messages.length

    isStreaming.value        = true
    streamingText.value      = ''
    streamingReasoning.value = ''
    streamingMsgId.value     = assistantMsg.id

    const ac = new AbortController()
    _abortCtrl.value = ac

    // Build payload
    let msgsForApi = conv.messages.slice(0, -1)
    // Apply context cutoff
    if (conv.contextCutoffPoints?.length) {
      const cutoffIdx = conv.messages.findIndex(m => conv.contextCutoffPoints!.includes(m.id))
      if (cutoffIdx >= 0) {
        msgsForApi = conv.messages.slice(cutoffIdx)
        // Remove the last assistant message (currently being generated)
        if (msgsForApi.length && msgsForApi[msgsForApi.length - 1].role === 'assistant') {
          msgsForApi = msgsForApi.slice(0, -1)
        }
      }
    }
    // For native PDF providers in fulltext mode, inject the paper PDF as a virtual message
    if (contextMode.value === 'fulltext' && isPdfNative && paperFullTextBase64.value) {
      msgsForApi = [
        {
          role: 'user',
          content: '以下是一篇论文，请基于其内容回答后续问题。',
          attachments: [{
            id: 'paper-pdf', name: 'paper.pdf', mimeType: 'application/pdf',
            data: paperFullTextBase64.value, extractedText: paperFullText.value || undefined,
          }],
        } as PaperChatMessage,
        ...msgsForApi,
      ]
    }
    const modelInfo = provider.models.find(m => m.id === mid)
    const needsOcr  = provider.type !== 'anthropic' && provider.type !== 'google'
      && provider.type !== 'ollama' && !isOpenRouter(provider.baseUrl)
      && !modelInfo?.multimodal && !modelInfo?.imageOutput
    if (needsOcr) msgsForApi = await applyOcrToMessages(msgsForApi)
    const payload    = buildPayload(msgsForApi, provider.type, provider.baseUrl)
    const startedAt  = Date.now()
    const temperature = chatSettings.temperature
    const maxTokens   = chatSettings.maxTokens
    const budgetMap   = { low: 1024, medium: 8000, high: 32000 } as const
    const thinkingBudget = useReasoning.value && provider.type === 'anthropic'
      ? budgetMap[reasoningLevel.value] : undefined

    let localText      = ''
    let localReasoning = ''

    const handler: StreamChunkHandler = {
      onToken(t) {
        localText            += t
        assistantMsg.content  = localText
        streamingText.value   = localText
      },
      onReasoningToken(t) {
        localReasoning           += t
        assistantMsg.reasoning    = localReasoning
        streamingReasoning.value  = localReasoning
      },
      async onDone(usage) {
        if (usage.costUsd == null) {
          const c = calculateModelCost(aiStore.providers, pid, mid, usage.inputTokens, usage.outputTokens)
          if (c != null) usage.costUsd = c
        }
        assistantMsg.usage = { ...usage, durationMs: Date.now() - startedAt }
        recordPaperCopilotUsage(usage.inputTokens ?? 0, usage.outputTokens ?? 0, usage.costUsd ?? 0).catch(() => {})
        _finishStream()
        if (conv.title === '新对话') {
          const first = conv.messages.find(m => m.role === 'user')
          if (first?.content) {
            // Try AI title generation first, fallback to first message truncation
            const aiTitle = await _generateTitleWithAI(first.content)
            const title = aiTitle ?? (first.content.slice(0, 30) + (first.content.length > 30 ? '…' : ''))
            conv.title = title
            const meta = conversations.value.find(c => c.id === conv.id)
            if (meta) meta.title = title
            _updateTitle(conv.id, title)
          }
        }
        await _syncMessages(conv.id, conv.messages)
        if (userMsg.attachments?.length) {
          _uploadAttachmentBinaries(conv.id, userMsg.id, userMsg.attachments).catch(() => {})
        }
        // Save to localStorage after each message exchange
        const convIdx = conversations.value.findIndex(c => c.id === conv.id)
        if (convIdx >= 0) {
          conversations.value[convIdx] = { ...conversations.value[convIdx], messages: [...conv.messages], messageCount: conv.messages.length, updatedAt: conv.updatedAt, title: conv.title }
          saveConversationsToStorage()
        }
      },
      async onError(err) {
        assistantMsg.content = `Error: ${err}`
        assistantMsg.error   = true
        _finishStream()
        await _syncMessages(conv.id, conv.messages)
        if (userMsg.attachments?.length) {
          _uploadAttachmentBinaries(conv.id, userMsg.id, userMsg.attachments).catch(() => {})
        }
        // Save error state to localStorage
        const convIdx = conversations.value.findIndex(c => c.id === conv.id)
        if (convIdx >= 0) {
          conversations.value[convIdx] = { ...conversations.value[convIdx], messages: [...conv.messages], messageCount: conv.messages.length, updatedAt: conv.updatedAt }
          saveConversationsToStorage()
        }
      },
    }

    // Fire second model concurrently if configured
    const pid2 = secondProviderId.value
    const mid2 = secondModelId.value
    if (pid2 && mid2 && (pid2 !== pid || mid2 !== mid)) {
      const p2 = aiStore.providers.find(p => p.id === pid2)
      if (p2 && (p2.apiKey || p2.type === 'ollama')) {
        _streamSecondModel(conv, assistantMsg, p2, mid2, payload, systemPrompt, temperature, maxTokens)
      }
    }

    try {
      await _dispatchStream(provider, mid, payload, handler, ac.signal, systemPrompt, thinkingBudget, temperature, maxTokens)
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') handler.onError(e instanceof Error ? e.message : String(e))
      else _finishStream()
    }
  }

  async function _streamSecondModel(
    _conv: PaperConversation,
    assistantMsg: PaperChatMessage,
    provider: { type: string; baseUrl: string; apiKey: string; id?: string },
    modelId: string,
    payload: { role: string; content: unknown }[],
    systemPrompt?: string,
    temperature?: number,
    maxTokens?: number,
  ) {
    if (!assistantMsg.variants) assistantMsg.variants = []
    const variant = reactive<PaperMessageVariant>({
      id: crypto.randomUUID(), content: '', model: modelId, providerId: (provider as any).id,
    })
    assistantMsg.variants.push(variant)
    streamingVariantMsgIds.add(assistantMsg.id)

    const ac2 = new AbortController()
    _abortCtrl2.value = ac2
    const startedAt2 = Date.now()
    const aiStore = useAiSettingsStore()

    let localText2      = ''
    let localReasoning2 = ''

    const handler2: StreamChunkHandler = {
      onToken(t) {
        localText2         += t
        variant.content     = localText2
        streamingVariantText.value = localText2
      },
      onReasoningToken(t) {
        localReasoning2              += t
        variant.reasoning             = localReasoning2
        streamingVariantReasoning.value = localReasoning2
      },
      onDone(usage) {
        const pid2 = (provider as any).id ?? ''
        if (usage.costUsd == null) {
          const c = calculateModelCost(aiStore.providers, pid2, modelId, usage.inputTokens, usage.outputTokens)
          if (c != null) usage.costUsd = c
        }
        variant.usage = { ...usage, durationMs: Date.now() - startedAt2 }
        streamingVariantMsgIds.delete(assistantMsg.id)
        streamingVariantText.value      = ''
        streamingVariantReasoning.value = ''
        _abortCtrl2.value = null
      },
      onError(err) {
        variant.content = `Error: ${err}`
        variant.error   = true
        streamingVariantMsgIds.delete(assistantMsg.id)
        streamingVariantText.value      = ''
        streamingVariantReasoning.value = ''
        _abortCtrl2.value = null
      },
    }

    try {
      await _dispatchStream(provider, modelId, payload, handler2, ac2.signal, systemPrompt, undefined, temperature, maxTokens)
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') handler2.onError(e instanceof Error ? e.message : String(e))
      else {
        streamingVariantMsgIds.delete(assistantMsg.id)
        _abortCtrl2.value = null
      }
    }
  }

  function _finishStream() {
    isStreaming.value        = false
    streamingText.value      = ''
    streamingReasoning.value = ''
    streamingMsgId.value     = null
    _abortCtrl.value         = null
  }

  function stopStreaming() {
    _abortCtrl.value?.abort()
    _abortCtrl2.value?.abort()
    _finishStream()
    streamingVariantMsgIds.clear()
    streamingVariantText.value      = ''
    streamingVariantReasoning.value = ''
    _abortCtrl2.value = null
  }

  // ── Per-message actions ────────────────────────────────────────────────────

  async function _restream(conv: PaperConversation, overrideProviderId?: string, overrideModelId?: string) {
    const aiStore      = useAiSettingsStore()
    const chatSettings = useChatSettingsStore()
    const pid = overrideProviderId ?? aiStore.paperDefaultProviderId ?? aiStore.activeProviderId
    const mid = overrideModelId   ?? aiStore.paperDefaultModelId ?? aiStore.activeModelId()
    const provider = aiStore.providers.find(p => p.id === pid)
    if (!provider || (!provider.apiKey && provider.type !== 'ollama')) return

    const isPdfNative = provider.type === 'anthropic' || provider.type === 'google' || isOpenRouter(provider.baseUrl)
    let systemPrompt: string | undefined
    if (contextMode.value === 'fulltext') {
      if (!isPdfNative && paperFullText.value) {
        systemPrompt = `以下是论文的完整内容，请基于此内容回答用户的问题：\n\n${paperFullText.value}`
      }
    } else if (contextMode.value === 'abstract' && paperAbstractText.value) {
      systemPrompt = `以下是论文的基本信息，请基于此内容回答用户的问题：\n\n${paperAbstractText.value}`
    }

    const assistantMsg = reactive<PaperChatMessage>({
      id: crypto.randomUUID(), role: 'assistant', content: '',
      timestamp: new Date().toISOString(), model: mid, providerId: pid,
    })
    conv.messages.push(assistantMsg)
    conv.updatedAt    = new Date().toISOString()
    conv.messageCount = conv.messages.length

    isStreaming.value        = true
    streamingText.value      = ''
    streamingReasoning.value = ''
    streamingMsgId.value     = assistantMsg.id

    const ac = new AbortController()
    _abortCtrl.value = ac

    // Build payload — all messages except the new assistant placeholder
    let msgsForApi = conv.messages.slice(0, -1)
    // Apply context cutoff
    if (conv.contextCutoffPoints?.length) {
      const cutoffIdx = conv.messages.findIndex(m => conv.contextCutoffPoints!.includes(m.id))
      if (cutoffIdx >= 0) {
        msgsForApi = conv.messages.slice(cutoffIdx)
        if (msgsForApi.length && msgsForApi[msgsForApi.length - 1].role === 'assistant') {
          msgsForApi = msgsForApi.slice(0, -1)
        }
      }
    }
    // Inject PDF for native providers in fulltext mode
    if (contextMode.value === 'fulltext' && isPdfNative && paperFullTextBase64.value) {
      msgsForApi = [
        {
          role: 'user',
          content: '以下是一篇论文，请基于其内容回答后续问题。',
          attachments: [{
            id: 'paper-pdf', name: 'paper.pdf', mimeType: 'application/pdf',
            data: paperFullTextBase64.value, extractedText: paperFullText.value || undefined,
          }],
        } as PaperChatMessage,
        ...msgsForApi,
      ]
    }
    const modelInfo = provider.models.find(m => m.id === mid)
    const needsOcr  = provider.type !== 'anthropic' && provider.type !== 'google'
      && provider.type !== 'ollama' && !isOpenRouter(provider.baseUrl)
      && !modelInfo?.multimodal && !modelInfo?.imageOutput
    if (needsOcr) msgsForApi = await applyOcrToMessages(msgsForApi)
    const payload    = buildPayload(msgsForApi, provider.type, provider.baseUrl)
    const startedAt  = Date.now()
    const temperature = chatSettings.temperature
    const maxTokens   = chatSettings.maxTokens
    const budgetMap   = { low: 1024, medium: 8000, high: 32000 } as const
    const thinkingBudget = useReasoning.value && provider.type === 'anthropic'
      ? budgetMap[reasoningLevel.value] : undefined

    let localText      = ''
    let localReasoning = ''

    const handler: StreamChunkHandler = {
      onToken(t) {
        localText            += t
        assistantMsg.content  = localText
        streamingText.value   = localText
      },
      onReasoningToken(t) {
        localReasoning           += t
        assistantMsg.reasoning    = localReasoning
        streamingReasoning.value  = localReasoning
      },
      async onDone(usage) {
        if (usage.costUsd == null) {
          const c = calculateModelCost(aiStore.providers, pid, mid, usage.inputTokens, usage.outputTokens)
          if (c != null) usage.costUsd = c
        }
        assistantMsg.usage = { ...usage, durationMs: Date.now() - startedAt }
        recordPaperCopilotUsage(usage.inputTokens ?? 0, usage.outputTokens ?? 0, usage.costUsd ?? 0).catch(() => {})
        _finishStream()
        await _syncMessages(conv.id, conv.messages)
        // Save to localStorage
        const convIdx = conversations.value.findIndex(c => c.id === conv.id)
        if (convIdx >= 0) {
          conversations.value[convIdx] = { ...conversations.value[convIdx], messages: [...conv.messages], messageCount: conv.messages.length, updatedAt: conv.updatedAt }
          saveConversationsToStorage()
        }
      },
      async onError(err) {
        assistantMsg.content = `Error: ${err}`
        assistantMsg.error   = true
        _finishStream()
        await _syncMessages(conv.id, conv.messages)
        // Save error state to localStorage
        const convIdx = conversations.value.findIndex(c => c.id === conv.id)
        if (convIdx >= 0) {
          conversations.value[convIdx] = { ...conversations.value[convIdx], messages: [...conv.messages], messageCount: conv.messages.length, updatedAt: conv.updatedAt }
          saveConversationsToStorage()
        }
      },
    }

    try {
      await _dispatchStream(provider, mid, payload, handler, ac.signal, systemPrompt, thinkingBudget, temperature, maxTokens)
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') handler.onError(e instanceof Error ? e.message : String(e))
      else _finishStream()
    }
  }

  async function deleteMessage(msgId: string) {
    if (isStreaming.value) return
    const conv = activeConv.value
    if (!conv) return
    conv.messages = conv.messages.filter(m => m.id !== msgId)
    conv.messageCount = conv.messages.length
    await _syncMessages(conv.id, conv.messages)
    saveConversationsToStorage()
  }

  async function editMessage(msgId: string, content: string) {
    const conv = activeConv.value
    if (!conv) return
    const msg = conv.messages.find(m => m.id === msgId)
    if (!msg) return
    msg.content = content
    await _syncMessages(conv.id, [msg])
    saveConversationsToStorage()
  }

  async function editAndResend(msgId: string, content: string) {
    if (isStreaming.value) return
    const conv = activeConv.value
    if (!conv) return
    const idx = conv.messages.findIndex(m => m.id === msgId)
    if (idx < 0) return
    conv.messages[idx].content = content
    conv.messages.splice(idx + 1)
    saveConversationsToStorage()
    await _restream(conv)
  }

  async function regenerate(msgId: string, overrideProviderId?: string, overrideModelId?: string) {
    if (isStreaming.value) return
    const conv = activeConv.value
    if (!conv) return
    const idx = conv.messages.findIndex(m => m.id === msgId)
    if (idx < 0) return

    // If regenerating with a different model, add as a variant instead of replacing
    const msg = conv.messages[idx]
    if (overrideProviderId && overrideModelId && (overrideProviderId !== msg.providerId || overrideModelId !== msg.model)) {
      const variant = reactive<PaperMessageVariant>({
        id: crypto.randomUUID(), content: '', model: overrideModelId, providerId: overrideProviderId,
      })
      if (!msg.variants) msg.variants = []
      msg.variants.push(variant)
      // Auto-switch to the new variant tab (component listens to msgTabIdx)
      // We emit a custom event that the component can listen to
      window.dispatchEvent(new CustomEvent('paper-copilot-variant-added', { detail: { msgId, variantIdx: msg.variants.length } }))

      const aiStore = useAiSettingsStore()
      const chatSettings = useChatSettingsStore()
      const provider = aiStore.providers.find(p => p.id === overrideProviderId)
      if (!provider || (!provider.apiKey && provider.type !== 'ollama')) return

      // Build context (same as sendMessage)
      const isPdfNative = provider.type === 'anthropic' || provider.type === 'google' || isOpenRouter(provider.baseUrl)
      let systemPrompt: string | undefined
      if (contextMode.value === 'fulltext') {
        if (!isPdfNative && paperFullText.value) {
          systemPrompt = `以下是论文的完整内容，请基于此内容回答用户的问题：\n\n${paperFullText.value}`
        }
      } else if (contextMode.value === 'abstract' && paperAbstractText.value) {
        systemPrompt = `以下是论文的基本信息，请基于此内容回答用户的问题：\n\n${paperAbstractText.value}`
      }

      // Find user message
      const before = conv.messages.slice(0, idx)
      const userMsg = before[before.map(m => m.role).lastIndexOf('user')]
      if (!userMsg) return

      // Build payload from history up to this point
      let msgsForApi = conv.messages.slice(0, idx)
      if (conv.contextCutoffPoints?.length) {
        const cutoffIdx = conv.messages.findIndex(m => conv.contextCutoffPoints!.includes(m.id))
        if (cutoffIdx >= 0) msgsForApi = conv.messages.slice(cutoffIdx, idx)
      }
      if (contextMode.value === 'fulltext' && isPdfNative && paperFullTextBase64.value) {
        msgsForApi = [
          {
            role: 'user',
            content: '以下是一篇论文，请基于其内容回答后续问题。',
            attachments: [{
              id: 'paper-pdf', name: 'paper.pdf', mimeType: 'application/pdf',
              data: paperFullTextBase64.value, extractedText: paperFullText.value || undefined,
            }],
          } as PaperChatMessage,
          ...msgsForApi,
        ]
      }
      const modelInfo = provider.models.find(m => m.id === overrideModelId)
      const needsOcr = provider.type !== 'anthropic' && provider.type !== 'google'
        && provider.type !== 'ollama' && !isOpenRouter(provider.baseUrl)
        && !modelInfo?.multimodal && !modelInfo?.imageOutput
      const processedMsgs = needsOcr ? await applyOcrToMessages(msgsForApi) : msgsForApi
      const payload = buildPayload(processedMsgs, provider.type, provider.baseUrl)
      const temperature = chatSettings.temperature
      const maxTokens = chatSettings.maxTokens
      const budgetMap = { low: 1024, medium: 8000, high: 32000 } as const
      const thinkingBudget = useReasoning.value && provider.type === 'anthropic'
        ? budgetMap[reasoningLevel.value] : undefined

      streamingVariantMsgIds.add(msgId)
      const ac2 = new AbortController()
      _abortCtrl2.value = ac2
      const startedAt2 = Date.now()

      let localText2 = ''
      let localReasoning2 = ''

      const handler2: StreamChunkHandler = {
        onToken(t) {
          localText2 += t
          variant.content = localText2
          streamingVariantText.value = localText2
        },
        onReasoningToken(t) {
          localReasoning2 += t
          variant.reasoning = localReasoning2
          streamingVariantReasoning.value = localReasoning2
        },
        onDone(usage) {
          if (usage.costUsd == null) {
            const c = calculateModelCost(aiStore.providers, overrideProviderId, overrideModelId, usage.inputTokens, usage.outputTokens)
            if (c != null) usage.costUsd = c
          }
          variant.usage = { ...usage, durationMs: Date.now() - startedAt2 }
          streamingVariantMsgIds.delete(msgId)
          streamingVariantText.value = ''
          streamingVariantReasoning.value = ''
          _abortCtrl2.value = null
          recordPaperCopilotUsage(usage.inputTokens ?? 0, usage.outputTokens ?? 0, usage.costUsd ?? 0).catch(() => {})
          saveConversationsToStorage()
        },
        onError(err) {
          variant.content = `Error: ${err}`
          variant.error = true
          streamingVariantMsgIds.delete(msgId)
          streamingVariantText.value = ''
          streamingVariantReasoning.value = ''
          _abortCtrl2.value = null
          saveConversationsToStorage()
        },
      }

      try {
        await _dispatchStream(provider, overrideModelId, payload, handler2, ac2.signal, systemPrompt, thinkingBudget, temperature, maxTokens)
      } catch (e: unknown) {
        if ((e as Error).name !== 'AbortError') handler2.onError(e instanceof Error ? e.message : String(e))
        else {
          streamingVariantMsgIds.delete(msgId)
          _abortCtrl2.value = null
        }
      }
      return
    }

    // Same-model regeneration: replace as before
    conv.messages.splice(idx)
    saveConversationsToStorage()
    await _restream(conv, overrideProviderId, overrideModelId)
  }

  function setSecondModel(pid: string | null, mid: string | null) {
    secondProviderId.value = pid
    secondModelId.value    = mid
  }

  function setReasoning(v: boolean) { useReasoning.value = v }
  function setReasoningLevel(v: 'low' | 'medium' | 'high') { reasoningLevel.value = v }

  function clearContext() {
    const conv = activeConv.value
    if (!conv || isStreaming.value) return
    const lastMsg = conv.messages.at(-1)
    if (!lastMsg) return
    if (!conv.contextCutoffPoints) conv.contextCutoffPoints = []
    if (!conv.contextCutoffPoints.includes(lastMsg.id)) conv.contextCutoffPoints.push(lastMsg.id)
    conv.updatedAt = new Date().toISOString()
    saveConversationsToStorage()
  }

  function removeContextCutoff(msgId: string) {
    const conv = activeConv.value
    if (!conv) return
    if (conv.contextCutoffPoints) {
      conv.contextCutoffPoints = conv.contextCutoffPoints.filter(id => id !== msgId)
    }
    conv.updatedAt = new Date().toISOString()
    saveConversationsToStorage()
  }

  // ── Paper text preparation ─────────────────────────────────────────────────

  function prepareAbstractText(title: string, authors: string[], abstract: string) {
    if (paperAbstractText.value) return
    const lines: string[] = []
    lines.push(`标题：${title}`)
    if (authors.length) lines.push(`作者：${authors.join(', ')}`)
    lines.push(`摘要：\n${abstract}`)
    paperAbstractText.value = lines.join('\n')
  }

  async function extractFullText(paperId: string, paperSource: string) {
    if (paperFullText.value && paperFullTextBase64.value) return
    isExtractingText.value = true
    fullTextError.value    = null
    try {
      const resp = await tauriFetch(
        _url(`/papers/${paperId}/pdf?source=${paperSource}`),
        { method: 'GET', headers: _headers() },
      )
      if (!resp.ok) {
        fullTextError.value = `PDF 获取失败（${resp.status}）`
        return
      }
      const { processPdfFile } = await import('../utils/pdf')
      const bytes = await resp.arrayBuffer()
      const file  = new File([bytes], 'paper.pdf', { type: 'application/pdf' })
      const meta  = await processPdfFile(file)
      if (!meta.base64) {
        fullTextError.value = 'PDF 解析失败，无法提取文字'
        return
      }
      paperFullText.value       = meta.extractedText
      paperFullTextBase64.value = meta.base64
    } catch (e) {
      fullTextError.value = `网络错误：${e instanceof Error ? e.message : String(e)}`
    } finally {
      isExtractingText.value = false
    }
  }

  return {
    isOpen, activePaperId, activePaperSource,
    conversations, currentPaperConversations, activeConvId, activeConv,
    isLoadingConvs, isLoadingMessages,
    isStreaming, streamingText, streamingReasoning, streamingMsgId,
    streamingVariantMsgIds, streamingVariantText, streamingVariantReasoning,
    webSearchEnabled, useReasoning, reasoningLevel,
    secondProviderId, secondModelId,
    contextMode, defaultContextMode, includeFullText,
    paperFullText, paperFullTextBase64, paperAbstractText, isExtractingText, fullTextError,
    openForPaper, close, setSecondModel,
    setReasoning, setReasoningLevel, setDefaultContextMode,
    pushToServer: pushSettingsToServer, syncFromServer: syncSettingsFromServer, retryPendingUploads,
    prepareAbstractText, extractFullText,
    loadConversations, createConversation, openConversation, deleteConversation,
    sendMessage, stopStreaming, clearContext, removeContextCutoff,
    deleteMessage, editMessage, editAndResend, regenerate,
  }
})
