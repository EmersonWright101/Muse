import { defineStore } from 'pinia'
import { ref, reactive, computed } from 'vue'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useAiSettingsStore, calculateModelCost } from './aiSettings'
import { useChatSettingsStore } from './chatSettings'
import { useWebSearchStore } from './webSearch'
import { performSearch, formatSearchResultsForContext } from '../services/webSearch'
import { getBackendConfig } from '../utils/backendConfig'
import { ocrImage } from '../utils/ocr'
import type { AttachmentMeta, MessageUsage, WebSearchResult } from '../utils/storage'

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
}

export interface PaperConversation extends PaperConversationMeta {
  messages: PaperChatMessage[]
  contextCutoffPoints?: string[]
}

// ─── Streaming types ──────────────────────────────────────────────────────────

interface StreamChunkHandler {
  onToken:           (token: string) => void
  onDone:            (usage: MessageUsage) => void
  onError:           (err: string) => void
  onReasoningToken?: (token: string) => void
}

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
      if (data === '[DONE]') { handler.onDone(usage); return }
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
  handler.onDone(usage)
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
      if (data === '[DONE]') { handler.onDone(usage); return }
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
  handler.onDone(usage)
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
        if (parsed.type === 'message_stop') { handler.onDone(usage); return }
      } catch { /* skip */ }
    }
  }
  handler.onDone(usage)
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
  handler.onDone(usage)
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
          handler.onDone(usage)
          return
        }
      } catch { /* skip */ }
    }
  }
  handler.onDone({})
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
  const conversations     = ref<PaperConversationMeta[]>([])
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

  // ── Global chat options ────────────────────────────────────────────────────
  const webSearchEnabled = ref(false)
  const useReasoning     = ref(false)
  const reasoningLevel   = ref<'low' | 'medium' | 'high'>('medium')
  const secondProviderId = ref<string | null>(null)
  const secondModelId    = ref<string | null>(null)

  // ── Context mode ───────────────────────────────────────────────────────────
  const _DEFAULT_KEY = 'paperCopilot.defaultContextMode'
  const defaultContextMode = ref<'abstract' | 'fulltext'>(
    (localStorage.getItem(_DEFAULT_KEY) as 'abstract' | 'fulltext') ?? 'abstract',
  )
  const contextMode      = ref<'abstract' | 'fulltext'>(defaultContextMode.value)
  const includeFullText  = computed(() => contextMode.value === 'fulltext')
  const paperFullText    = ref<string | null>(null)
  const paperFullTextBase64 = ref<string | null>(null)
  const paperAbstractText = ref<string | null>(null)
  const isExtractingText = ref(false)
  const fullTextError    = ref<string | null>(null)

  function setDefaultContextMode(mode: 'abstract' | 'fulltext') {
    defaultContextMode.value = mode
    localStorage.setItem(_DEFAULT_KEY, mode)
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
    if (changed) {
      paperFullText.value       = null
      paperFullTextBase64.value = null
      paperAbstractText.value   = null
      fullTextError.value       = null
      contextMode.value         = defaultContextMode.value
      activeConv.value       = null
      activeConvId.value     = null
      await loadConversations()
      if (conversations.value.length > 0) await openConversation(conversations.value[0].id)
      else await createConversation()
    }
  }

  function close() { isOpen.value = false }

  // ── Conversations CRUD ─────────────────────────────────────────────────────

  async function loadConversations() {
    if (!activePaperId.value) return
    isLoadingConvs.value = true
    try {
      const resp = await tauriFetch(
        _url(`/${activePaperId.value}/conversations?source=${activePaperSource.value}`),
        { method: 'GET', headers: _headers() },
      )
      if (resp.ok) conversations.value = await resp.json() as PaperConversationMeta[]
    } catch { /* ignore */ } finally { isLoadingConvs.value = false }
  }

  async function createConversation(): Promise<PaperConversation | null> {
    if (!activePaperId.value) return null
    const aiStore = useAiSettingsStore()
    const id  = crypto.randomUUID()
    const pid = aiStore.activeProviderId
    const mid = aiStore.activeModelId()
    const now = new Date().toISOString()
    const localConv: PaperConversation = {
      id, paperId: activePaperId.value, paperSource: activePaperSource.value,
      title: '新对话', providerId: pid, model: mid,
      createdAt: now, updatedAt: now, messageCount: 0, messages: [],
    }
    try {
      const resp = await tauriFetch(
        _url(`/${activePaperId.value}/conversations?source=${activePaperSource.value}`),
        { method: 'POST', headers: _headers(), body: JSON.stringify({ id, provider_id: pid, model: mid }) },
      )
      if (resp.ok) Object.assign(localConv, await resp.json() as PaperConversationMeta)
    } catch { /* use local */ }
    conversations.value.unshift({ ...localConv })
    activeConv.value   = localConv
    activeConvId.value = localConv.id
    return localConv
  }

  async function openConversation(convId: string) {
    if (convId === activeConvId.value) return
    isLoadingMessages.value = true
    try {
      const resp = await tauriFetch(
        _url(`/${activePaperId.value}/conversations/${convId}?source=${activePaperSource.value}`),
        { method: 'GET', headers: _headers() },
      )
      if (resp.ok) {
        const data = await resp.json() as Record<string, unknown>
        const rawMsgs = (data.messages ?? []) as any[]
        const messages: PaperChatMessage[] = rawMsgs.map((m: any) => ({
          id: m.id, role: m.role, content: m.content ?? '',
          timestamp: m.created_at, model: m.model, providerId: m.provider_id,
          error: m.error ?? false, reasoning: m.reasoning,
          usage: m.usage ? { inputTokens: m.usage.input_tokens, outputTokens: m.usage.output_tokens, costUsd: m.usage.cost } : undefined,
          attachments: (m.attachments ?? []).map((a: any) => ({
            id: a.id, name: a.name, mimeType: a.mime_type, size: a.size, pageCount: a.page_count,
          })),
        }))
        const meta = conversations.value.find(c => c.id === convId)
        activeConv.value   = { ...(meta as PaperConversationMeta), messages }
        activeConvId.value = convId
      }
    } catch { /* ignore */ } finally { isLoadingMessages.value = false }
  }

  async function deleteConversation(convId: string) {
    try {
      await tauriFetch(
        _url(`/${activePaperId.value}/conversations/${convId}?source=${activePaperSource.value}`),
        { method: 'DELETE', headers: _headers() },
      )
    } catch { /* ignore */ }
    conversations.value = conversations.value.filter(c => c.id !== convId)
    if (activeConvId.value === convId) {
      activeConv.value   = null
      activeConvId.value = null
      if (conversations.value.length > 0) await openConversation(conversations.value[0].id)
      else await createConversation()
    }
  }

  // ── Backend sync ───────────────────────────────────────────────────────────

  async function _syncMessages(convId: string, msgs: PaperChatMessage[]) {
    if (!activePaperId.value) return
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
    } catch { /* silently ignore */ }
  }

  async function _updateTitle(convId: string, title: string) {
    if (!activePaperId.value) return
    try {
      await tauriFetch(
        _url(`/${activePaperId.value}/conversations/${convId}?source=${activePaperSource.value}`),
        { method: 'PUT', headers: _headers(), body: JSON.stringify({ title }) },
      )
    } catch { /* ignore */ }
  }

  // ── Send message ───────────────────────────────────────────────────────────

  async function sendMessage(userContent: string, attachments?: AttachmentMeta[]) {
    if (!userContent.trim() && !attachments?.length) return
    if (isStreaming.value) return
    if (!activeConv.value) await createConversation()
    const conv = activeConv.value!

    const aiStore      = useAiSettingsStore()
    const chatSettings = useChatSettingsStore()
    const pid = aiStore.activeProviderId
    const mid = aiStore.activeModelId()
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
        _finishStream()
        if (conv.title === '新对话') {
          const first = conv.messages.find(m => m.role === 'user')
          if (first?.content) {
            const title = first.content.slice(0, 30) + (first.content.length > 30 ? '…' : '')
            conv.title = title
            const meta = conversations.value.find(c => c.id === conv.id)
            if (meta) meta.title = title
            _updateTitle(conv.id, title)
          }
        }
        await _syncMessages(conv.id, [userMsg, assistantMsg])
      },
      async onError(err) {
        assistantMsg.content = `Error: ${err}`
        assistantMsg.error   = true
        _finishStream()
        await _syncMessages(conv.id, [userMsg, assistantMsg])
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
    const pid = overrideProviderId ?? aiStore.activeProviderId
    const mid = overrideModelId   ?? aiStore.activeModelId()
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
        _finishStream()
        await _syncMessages(conv.id, [assistantMsg])
      },
      async onError(err) {
        assistantMsg.content = `Error: ${err}`
        assistantMsg.error   = true
        _finishStream()
        await _syncMessages(conv.id, [assistantMsg])
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
  }

  async function editMessage(msgId: string, content: string) {
    const conv = activeConv.value
    if (!conv) return
    const msg = conv.messages.find(m => m.id === msgId)
    if (!msg) return
    msg.content = content
    await _syncMessages(conv.id, [msg])
  }

  async function editAndResend(msgId: string, content: string) {
    if (isStreaming.value) return
    const conv = activeConv.value
    if (!conv) return
    const idx = conv.messages.findIndex(m => m.id === msgId)
    if (idx < 0) return
    conv.messages[idx].content = content
    conv.messages.splice(idx + 1)
    await _restream(conv)
  }

  async function regenerate(msgId: string, overrideProviderId?: string, overrideModelId?: string) {
    if (isStreaming.value) return
    const conv = activeConv.value
    if (!conv) return
    const idx = conv.messages.findIndex(m => m.id === msgId)
    if (idx < 0) return
    conv.messages.splice(idx)
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
  }

  function removeContextCutoff(msgId: string) {
    const conv = activeConv.value
    if (!conv) return
    if (conv.contextCutoffPoints) {
      conv.contextCutoffPoints = conv.contextCutoffPoints.filter(id => id !== msgId)
    }
    conv.updatedAt = new Date().toISOString()
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
    conversations, activeConvId, activeConv,
    isLoadingConvs, isLoadingMessages,
    isStreaming, streamingText, streamingReasoning, streamingMsgId,
    streamingVariantMsgIds, streamingVariantText, streamingVariantReasoning,
    webSearchEnabled, useReasoning, reasoningLevel,
    secondProviderId, secondModelId,
    contextMode, defaultContextMode, includeFullText,
    paperFullText, paperFullTextBase64, paperAbstractText, isExtractingText, fullTextError,
    openForPaper, close, setSecondModel,
    setReasoning, setReasoningLevel, setDefaultContextMode,
    prepareAbstractText, extractFullText,
    loadConversations, createConversation, openConversation, deleteConversation,
    sendMessage, stopStreaming, clearContext, removeContextCutoff,
    deleteMessage, editMessage, editAndResend, regenerate,
  }
})
