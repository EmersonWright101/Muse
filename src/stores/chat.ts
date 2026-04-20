/**
 * Chat Store
 *
 * Manages conversation list (metadata) and the currently active conversation.
 * Full conversation data is persisted to disk via storage.ts.
 * AI streaming is handled here for all supported providers.
 *
 * Multi-conversation streaming: multiple conversations can stream simultaneously
 * in the background. streamingConvIds tracks all active streams; isStreaming is
 * a computed that reflects only the currently-visible conversation.
 */

import { defineStore } from 'pinia'
import { ref, reactive, computed } from 'vue'
import {
  listConversations,
  loadConversation,
  saveConversation,
  deleteConversation,
  deleteConversations,
  newId,
  type ConversationMeta,
  type Conversation,
  type ChatMessage,
  type AttachmentMeta,
  type MessageUsage,
  type MessageVariant,
} from '../utils/storage'
import { useAiSettingsStore }    from './aiSettings'
import { useAssistantsStore }   from './assistants'
import { useChatSettingsStore, DEFAULT_TITLE_PROMPT } from './chatSettings'

export type { ConversationMeta, Conversation, ChatMessage, AttachmentMeta, MessageVariant }

// ─── Streaming helpers ────────────────────────────────────────────────────────

interface StreamChunkHandler {
  onToken:           (token: string) => void
  onDone:            (usage: MessageUsage) => void
  onError:           (err: string) => void
  onReasoningToken?: (token: string) => void
  onMediaOutput?:    (mimeType: string, data: string, isUrl?: boolean) => void
}

function isOpenRouter(baseUrl: string): boolean {
  return baseUrl.includes('openrouter.ai')
}

function handleMediaUrl(url: string, handler: StreamChunkHandler) {
  if (!handler.onMediaOutput) return
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    if (comma > 0) handler.onMediaOutput(url.slice(5, comma).replace(';base64', ''), url.slice(comma + 1))
  } else {
    handler.onMediaOutput('image/png', url, true)
  }
}

async function streamOpenAI(
  baseUrl: string, apiKey: string, model: string,
  messages: { role: string; content: unknown }[],
  handler: StreamChunkHandler,
  signal: AbortSignal,
  systemPrompt?: string,
  reasoningEffort?: 'low' | 'medium' | 'high',
  modalities?: string[],
  temperature?: number,
  maxTokens?: number,
) {
  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages
  const reqBody: Record<string, unknown> = { model, messages: allMessages, stream: true, stream_options: { include_usage: true } }
  if (reasoningEffort) {
    if (isOpenRouter(baseUrl)) {
      // OpenRouter uses { reasoning: { effort } } instead of reasoning_effort
      reqBody.reasoning = { effort: reasoningEffort, exclude: false }
    } else {
      reqBody.reasoning_effort = reasoningEffort
    }
  }
  if (modalities?.length) reqBody.modalities = modalities
  if (temperature !== undefined) reqBody.temperature = temperature
  if (maxTokens   !== undefined) reqBody.max_tokens  = maxTokens
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(reqBody),
    signal,
  })
  if (!resp.ok) {
    const err = await resp.text()
    handler.onError(`API error ${resp.status}: ${err}`)
    return
  }
  const reader  = resp.body!.getReader()
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
        const parsed  = JSON.parse(data)

        // OpenRouter image generation: images arrive in choices[0].delta.images
        const deltaImages = parsed.choices?.[0]?.delta?.images
        if (deltaImages && handler.onMediaOutput) {
          for (const img of deltaImages as Array<{ image_url?: { url?: string } }>) {
            if (img.image_url?.url) handleMediaUrl(img.image_url.url, handler)
          }
        }

        const rawContent = parsed.choices?.[0]?.delta?.content
        if (rawContent) {
          if (typeof rawContent === 'string') {
            if ((rawContent.startsWith('data:image/') || rawContent.startsWith('data:video/')) && handler.onMediaOutput) {
              const comma = rawContent.indexOf(',')
              if (comma > 0) handler.onMediaOutput(rawContent.slice(5, comma).replace(';base64', ''), rawContent.slice(comma + 1))
            } else {
              handler.onToken(rawContent)
            }
          } else if (Array.isArray(rawContent)) {
            for (const blk of rawContent as Array<{ type?: string; text?: string; image_url?: { url?: string } }>) {
              if (blk.text) {
                handler.onToken(blk.text)
              } else if (blk.image_url?.url && handler.onMediaOutput) {
                handleMediaUrl(blk.image_url.url, handler)
              }
            }
          }
        }
        // OpenRouter uses delta.reasoning; DeepSeek uses delta.reasoning_content
        const reasoningContent = parsed.choices?.[0]?.delta?.reasoning
          ?? parsed.choices?.[0]?.delta?.reasoning_content
        if (reasoningContent && handler.onReasoningToken) handler.onReasoningToken(reasoningContent)
        if (parsed.usage) {
          usage.inputTokens  = parsed.usage.prompt_tokens
          usage.outputTokens = parsed.usage.completion_tokens
          if (parsed.usage.cost != null)       usage.costUsd = parsed.usage.cost
          if (parsed.usage.total_cost != null) usage.costUsd = parsed.usage.total_cost
        }
      } catch { /* skip malformed */ }
    }
  }
  handler.onDone(usage)
}

async function streamAnthropic(
  baseUrl: string, apiKey: string, model: string,
  messages: { role: string; content: unknown }[],
  handler: StreamChunkHandler,
  signal: AbortSignal,
  systemPrompt?: string,
  thinkingBudget?: number,
  temperature?: number,
  maxTokens?: number,
) {
  const body: Record<string, unknown> = { model, messages, max_tokens: maxTokens ?? 8192, stream: true }
  if (systemPrompt) body.system = systemPrompt
  if (temperature !== undefined) body.temperature = temperature
  if (thinkingBudget) {
    body.thinking    = { type: 'enabled', budget_tokens: thinkingBudget }
    body.max_tokens  = Math.max(16384, thinkingBudget + 4096)
  }
  const resp = await fetch(`${baseUrl}/v1/messages`, {
    method:  'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!resp.ok) {
    const err = await resp.text()
    handler.onError(`API error ${resp.status}: ${err}`)
    return
  }
  const reader  = resp.body!.getReader()
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
      try {
        const parsed = JSON.parse(data)
        if (parsed.type === 'message_start') {
          usage.inputTokens = parsed.message?.usage?.input_tokens
        }
        if (parsed.type === 'content_block_delta') {
          if (parsed.delta?.type === 'thinking_delta' && handler.onReasoningToken) {
            handler.onReasoningToken(parsed.delta.thinking)
          } else if (parsed.delta?.type === 'text_delta') {
            handler.onToken(parsed.delta.text)
          }
        }
        if (parsed.type === 'message_delta' && parsed.usage) {
          usage.outputTokens = parsed.usage.output_tokens
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
  handler: StreamChunkHandler,
  signal: AbortSignal,
  systemPrompt?: string,
  temperature?: number,
  maxTokens?: number,
) {
  // Convert to Gemini format — content may already be a parts array (from buildPayload)
  const geminiMessages = messages.map(m => ({
    role:  m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
    parts: Array.isArray(m.content)
      ? m.content
      : [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }))
  const reqBody: Record<string, unknown> = { contents: geminiMessages }
  if (systemPrompt) reqBody.systemInstruction = { parts: [{ text: systemPrompt }] }
  if (temperature !== undefined || maxTokens !== undefined) {
    const cfg: Record<string, unknown> = {}
    if (temperature !== undefined) cfg.temperature     = temperature
    if (maxTokens   !== undefined) cfg.maxOutputTokens = maxTokens
    reqBody.generationConfig = cfg
  }
  const resp = await fetch(
    `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(reqBody),
      signal,
    },
  )
  if (!resp.ok) {
    const err = await resp.text()
    handler.onError(`API error ${resp.status}: ${err}`)
    return
  }
  const reader  = resp.body!.getReader()
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
      try {
        const parsed = JSON.parse(data)
        const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>
          = parsed.candidates?.[0]?.content?.parts ?? []
        for (const part of parts) {
          if (part.text) handler.onToken(part.text)
          if (part.inlineData?.data && handler.onMediaOutput) {
            handler.onMediaOutput(part.inlineData.mimeType, part.inlineData.data)
          }
        }
        if (parsed.usageMetadata) {
          usage.inputTokens  = parsed.usageMetadata.promptTokenCount
          usage.outputTokens = parsed.usageMetadata.candidatesTokenCount
        }
      } catch { /* skip */ }
    }
  }
  handler.onDone(usage)
}

// Ollama native API: POST /api/chat, no auth, newline-delimited JSON stream
async function streamOllama(
  baseUrl: string,
  model: string,
  messages: { role: string; content: unknown }[],
  handler: StreamChunkHandler,
  signal: AbortSignal,
  systemPrompt?: string,
  temperature?: number,
  maxTokens?: number,
) {
  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages
  const reqBody: Record<string, unknown> = { model, messages: allMessages, stream: true }
  const options: Record<string, unknown> = {}
  if (temperature !== undefined) options.temperature = temperature
  if (maxTokens   !== undefined) options.num_predict = maxTokens
  if (Object.keys(options).length) reqBody.options = options

  const resp = await fetch(`${baseUrl}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(reqBody),
    signal,
  })
  if (resp.status === 404) {
    // Fall back to OpenAI-compatible endpoint (e.g. DGX-Spark / Ollama proxies that
    // expose /v1/chat/completions but not the native /api/chat route)
    await streamOpenAI(`${baseUrl}/v1`, '', model, allMessages, handler, signal, undefined, undefined, undefined, temperature, maxTokens)
    return
  }
  if (!resp.ok) {
    const err = await resp.text()
    handler.onError(`Ollama error ${resp.status}: ${err}`)
    return
  }
  const reader  = resp.body!.getReader()
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
        // Thinking models (e.g. qwen3:thinking) return reasoning in message.thinking
        if (parsed.message?.thinking && handler.onReasoningToken) {
          handler.onReasoningToken(parsed.message.thinking)
        }
        if (parsed.message?.content) {
          handler.onToken(parsed.message.content)
        }
        if (parsed.done) {
          handler.onDone({})
          return
        }
      } catch { /* skip malformed */ }
    }
  }
  handler.onDone({})
}

// ─── PDF provider routing (mirrors Cherry Studio's PDF_NATIVE_PROVIDER_TYPES) ─

const PDF_NATIVE_PROVIDERS = new Set(['anthropic', 'google'])

// ─── Build message payload ────────────────────────────────────────────────────

function buildPayload(
  messages: ChatMessage[],
  providerType: string,
  baseUrl?: string,
): { role: string; content: unknown }[] {
  const openRouter = baseUrl ? isOpenRouter(baseUrl) : false
  return messages
    .filter(m => !m.error)
    .map(m => {
      const atts   = m.attachments ?? []
      const images = atts.filter(a => a.mimeType?.startsWith('image/') && a.data)
      const pdfs   = atts.filter(a => a.mimeType === 'application/pdf' && a.data)

      if (providerType === 'google') {
        const parts: unknown[] = []
        for (const pdf of pdfs) {
          parts.push({ inlineData: { mimeType: 'application/pdf', data: pdf.data } })
        }
        for (const img of images) {
          parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } })
        }
        if (m.content) parts.push({ text: m.content })
        return {
          role:    m.role === 'assistant' ? 'model' : 'user',
          content: parts.length > 0 ? parts : [{ text: m.content }],
        }
      }

      if (providerType === 'anthropic') {
        const blocks: unknown[] = []
        for (const pdf of pdfs) {
          blocks.push({
            type:   'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdf.data },
          })
        }
        for (const img of images) {
          blocks.push({
            type:   'image',
            source: { type: 'base64', media_type: img.mimeType, data: img.data },
          })
        }
        if (m.content) blocks.push({ type: 'text', text: m.content })
        if (blocks.length > 1 || pdfs.length > 0 || images.length > 0) {
          return { role: m.role, content: blocks }
        }
        return { role: m.role, content: m.content }
      }

      // OpenAI-compatible: images → image_url; PDFs → native file block (OpenRouter) or extracted text (others)
      if (pdfs.length > 0 || images.length > 0) {
        const contentParts: unknown[] = []
        for (const img of images) {
          contentParts.push({
            type:      'image_url',
            image_url: { url: `data:${img.mimeType};base64,${img.data}` },
          })
        }
        if (openRouter) {
          // OpenRouter supports native PDF via inline file block — underlying models read it directly
          for (const pdf of pdfs) {
            contentParts.push({
              type: 'file',
              file: {
                filename:  pdf.name || 'document.pdf',
                file_data: `data:application/pdf;base64,${pdf.data}`,
              },
            })
          }
          if (m.content) contentParts.push({ type: 'text', text: m.content })
          return { role: m.role, content: contentParts }
        }
        // Fallback for other OpenAI-compatible providers: extract PDF text
        const pdfTexts = pdfs.map(
          pdf => `${pdf.name}\n${pdf.extractedText || '（无法提取文字内容，该 PDF 可能为扫描件）'}`,
        )
        const fullText = pdfTexts.length > 0
          ? `${pdfTexts.join('\n\n')}\n\n---\n\n${m.content}`
          : m.content
        if (images.length > 0) {
          contentParts.push({ type: 'text', text: fullText })
          return { role: m.role, content: contentParts }
        }
        return { role: m.role, content: fullText }
      }

      return { role: m.role, content: m.content }
    })
}

export { PDF_NATIVE_PROVIDERS }

// ─── Store ────────────────────────────────────────────────────────────────────

export const useChatStore = defineStore('chat', () => {
  const conversations      = ref<ConversationMeta[]>([])
  const activeConvId       = ref<string | null>(null)
  const activeConv         = ref<Conversation | null>(null)
  // Per-conversation streaming tracker; isStreaming reflects the active conversation only
  const streamingConvIds   = reactive<Set<string>>(new Set())
  const isStreaming        = computed(() => !!activeConvId.value && streamingConvIds.has(activeConvId.value))
  const isLoading          = ref(false)
  const error              = ref<string | null>(null)
  const selectedConvIds    = reactive<Set<string>>(new Set())
  const batchMode          = ref(false)
  const streamingText         = ref('')
  const streamingMsgId        = ref<string | null>(null)
  const streamingReasoning    = ref('')
  const streamingVariantMsgId = ref<string | null>(null)
  const useReasoning       = ref(false)
  const reasoningLevel     = ref<'low' | 'medium' | 'high'>('medium')

  // One AbortController per in-flight conversation stream
  const _abortControllers = new Map<string, AbortController>()

  // ─── Load conversation list ─────────────────────────────────────────────

  async function loadList() {
    conversations.value = await listConversations()
  }

  // ─── Open conversation ──────────────────────────────────────────────────

  async function openConversation(id: string) {
    if (activeConvId.value === id) return
    isLoading.value = true
    const conv = await loadConversation(id)
    if (conv) {
      activeConv.value   = conv
      activeConvId.value = id
      // Restore streaming UI state if this conversation is still streaming
      if (streamingConvIds.has(id)) {
        const lastAssistant = [...conv.messages].reverse().find(m => m.role === 'assistant' && !m.error)
        streamingMsgId.value = lastAssistant?.id ?? null
      } else {
        streamingMsgId.value = null
        streamingText.value  = ''
      }
    }
    isLoading.value = false
  }

  // ─── New conversation ───────────────────────────────────────────────────

  function newConversation(providerId?: string, modelId?: string, assistantId?: string): Conversation {
    const aiStore = useAiSettingsStore()
    const pid = providerId ?? aiStore.activeProviderId
    const mid = modelId   ?? aiStore.activeModelId()

    const conv: Conversation = {
      id:          newId(),
      title:       '新对话',
      createdAt:   new Date().toISOString(),
      updatedAt:   new Date().toISOString(),
      providerId:  pid,
      model:       mid,
      messages:    [],
      assistantId: assistantId || undefined,
    }
    activeConv.value   = conv
    activeConvId.value = conv.id
    streamingMsgId.value = null
    streamingText.value  = ''
    // Persist immediately so the conversation appears in the list (and in filtered views)
    saveConversation(conv).then(() => loadList())
    return conv
  }

  // ─── AI title generation ────────────────────────────────────────────────

  async function generateTitle(conv: Conversation) {
    const chatSettings = useChatSettingsStore()
    const aiStore      = useAiSettingsStore()
    const pid = chatSettings.titleGenProviderId
    const mid = chatSettings.titleGenModelId
    if (!pid || !mid) return

    const provider = aiStore.providers.find(p => p.id === pid)
    if (!provider || (!provider.apiKey && provider.type !== 'ollama')) return

    const userMsg = conv.messages.find(m => m.role === 'user' && m.content)
    const aiMsg   = conv.messages.filter(m => m.role === 'assistant' && m.content && !m.error).at(-1)
    if (!userMsg || !aiMsg) return

    const promptTpl = chatSettings.titleGenPrompt || DEFAULT_TITLE_PROMPT
    const prompt    = promptTpl
      .replace('{user}',     userMsg.content.slice(0, 300))
      .replace('{response}', aiMsg.content.slice(0, 300))

    let title = ''
    const ac  = new AbortController()

    const handler: StreamChunkHandler = {
      onToken(token) { title += token },
      async onDone() {
        // Strip surrounding quotes/brackets that models sometimes add
        const cleaned = title.trim()
          .replace(/^["'「」『』【】《》""'']+|["'「」『』【】《》""'']+$/g, '')
          .slice(0, 50)
        if (cleaned) {
          conv.title          = cleaned
          conv.titleGenerated = true
          await saveConversation(conv)
          await loadList()
        }
      },
      onError() { /* silently ignore title generation errors */ },
    }

    try {
      const msgs = [{ role: 'user', content: prompt }]
      if (provider.type === 'anthropic') {
        await streamAnthropic(provider.baseUrl, provider.apiKey, mid, msgs, handler, ac.signal)
      } else if (provider.type === 'google') {
        await streamGoogle(provider.baseUrl, provider.apiKey, mid, msgs, handler, ac.signal)
      } else if (provider.type === 'ollama') {
        await streamOllama(provider.baseUrl, mid, msgs, handler, ac.signal)
      } else {
        await streamOpenAI(provider.baseUrl, provider.apiKey, mid, msgs, handler, ac.signal)
      }
    } catch { /* ignore */ }
  }

  // ─── Send message (with streaming) ─────────────────────────────────────

  async function sendMessage(userContent: string, attachments?: AttachmentMeta[]) {
    if (!userContent.trim() && !attachments?.length) return

    const aiStore = useAiSettingsStore()

    if (!activeConv.value) newConversation()
    const conv = activeConv.value!

    // Block only if THIS conversation is already streaming
    if (streamingConvIds.has(conv.id)) return

    // Update provider/model if changed
    const pid   = aiStore.activeProviderId
    const mid   = aiStore.activeModelId()
    conv.providerId = pid
    conv.model      = mid

    // Add user message
    const userMsg: ChatMessage = {
      id:          newId(),
      role:        'user',
      content:     userContent,
      timestamp:   new Date().toISOString(),
      attachments: attachments?.length ? attachments : undefined,
    }
    conv.messages.push(userMsg)

    // Add empty assistant message — wrap in reactive() so property mutations
    // (content updates during streaming) are tracked by Vue immediately.
    const assistantMsg = reactive<ChatMessage>({
      id:        newId(),
      role:      'assistant',
      content:   '',
      timestamp: new Date().toISOString(),
      model:     mid,
      providerId: pid,
    })
    conv.messages.push(assistantMsg)
    conv.updatedAt = new Date().toISOString()

    // Mark this conversation as streaming
    streamingConvIds.add(conv.id)
    // Update UI streaming refs only when this is the visible conversation
    if (activeConvId.value === conv.id) {
      streamingText.value  = ''
      streamingMsgId.value = assistantMsg.id
    }
    error.value = null

    const ac = new AbortController()
    _abortControllers.set(conv.id, ac)

    await saveConversation(conv)
    await loadList()

    const provider = aiStore.providers.find(p => p.id === pid)
    if (!provider || (!provider.apiKey && provider.type !== 'ollama')) {
      assistantMsg.content = '请先在设置中配置 AI 供应商的 API Key。'
      assistantMsg.error   = true
      streamingConvIds.delete(conv.id)
      _abortControllers.delete(conv.id)
      if (activeConvId.value === conv.id) {
        streamingMsgId.value = null
        streamingText.value  = ''
      }
      await saveConversation(conv)
      await loadList()
      return
    }

    // Messages sent to API: everything after the context cutoff (if set), minus the empty assistant msg
    let msgsForApi = conv.messages.slice(0, -1)
    if (conv.contextCutoffMsgId) {
      const cutoffIdx = msgsForApi.findIndex(m => m.id === conv.contextCutoffMsgId)
      if (cutoffIdx >= 0) msgsForApi = msgsForApi.slice(cutoffIdx + 1)
    }
    const payload   = buildPayload(msgsForApi, provider.type, provider.baseUrl)
    const startedAt = Date.now()

    const assistantsStore = useAssistantsStore()
    const assistant = conv.assistantId
      ? assistantsStore.assistants.find(a => a.id === conv.assistantId)
      : undefined
    const systemPrompt = assistant?.systemPrompt || undefined

    const budgetMap = { low: 1024, medium: 8000, high: 32000 } as const
    const chatSettings = useChatSettingsStore()
    const temperature  = chatSettings.temperature
    const maxTokens    = chatSettings.maxTokens

    // Local accumulators — avoids shared ref contamination when multiple convs stream simultaneously
    let localText      = ''
    let localReasoning = ''

    const shouldGenTitle = !conv.titleGenerated

    const handler: StreamChunkHandler = {
      onToken(token) {
        localText            += token
        assistantMsg.content  = localText
        // Only push to the shared streamingText ref when this conv is visible (drives scroll)
        if (activeConvId.value === conv.id) streamingText.value = localText
      },
      onReasoningToken(token) {
        localReasoning         += token
        assistantMsg.reasoning  = localReasoning
        if (activeConvId.value === conv.id) streamingReasoning.value = localReasoning
      },
      onMediaOutput(mimeType, data, isUrl) {
        if (!assistantMsg.mediaOutputs) assistantMsg.mediaOutputs = []
        assistantMsg.mediaOutputs.push(isUrl ? { mimeType, url: data } : { mimeType, data })
      },
      async onDone(usage) {
        // Fallback: if full accumulated text is a data URL or image URL, convert to media output
        const txt = localText.trim()
        if (txt.startsWith('data:image/') || txt.startsWith('data:video/')) {
          const comma = txt.indexOf(',')
          if (comma > 0) {
            if (!assistantMsg.mediaOutputs) assistantMsg.mediaOutputs = []
            assistantMsg.mediaOutputs.push({ mimeType: txt.slice(5, comma).replace(';base64', ''), data: txt.slice(comma + 1) })
            assistantMsg.content = ''
            localText            = ''
          }
        } else {
          const modelInfo = provider?.models.find(m => m.id === mid)
          if (modelInfo?.imageOutput && /^https?:\/\//.test(txt)) {
            if (!assistantMsg.mediaOutputs) assistantMsg.mediaOutputs = []
            assistantMsg.mediaOutputs.push({ mimeType: 'image/png', url: txt })
            assistantMsg.content = ''
            localText            = ''
          }
        }
        assistantMsg.usage = { ...usage, durationMs: Date.now() - startedAt }
        streamingConvIds.delete(conv.id)
        _abortControllers.delete(conv.id)
        if (activeConvId.value === conv.id) {
          streamingMsgId.value     = null
          streamingText.value      = ''
          streamingReasoning.value = ''
        }
        conv.updatedAt = new Date().toISOString()
        await saveConversation(conv)
        await loadList()
        // Generate AI title after the first completed assistant reply
        if (shouldGenTitle) generateTitle(conv).catch(() => {})
      },
      async onError(err) {
        assistantMsg.content = `Error: ${err}`
        assistantMsg.error   = true
        streamingConvIds.delete(conv.id)
        _abortControllers.delete(conv.id)
        if (activeConvId.value === conv.id) {
          streamingMsgId.value     = null
          streamingText.value      = ''
          streamingReasoning.value = ''
        }
        await saveConversation(conv)
        await loadList()
      },
    }

    try {
      if (provider.type === 'anthropic') {
        const budget = useReasoning.value ? budgetMap[reasoningLevel.value] : undefined
        await streamAnthropic(provider.baseUrl, provider.apiKey, mid, payload, handler, ac.signal, systemPrompt, budget, temperature, maxTokens)
      } else if (provider.type === 'google') {
        await streamGoogle(provider.baseUrl, provider.apiKey, mid, payload, handler, ac.signal, systemPrompt, temperature, maxTokens)
      } else if (provider.type === 'ollama') {
        await streamOllama(provider.baseUrl, mid, payload, handler, ac.signal, systemPrompt, temperature, maxTokens)
      } else {
        // openai / custom — pass reasoning_effort for o-series and compatible providers
        const effort = useReasoning.value ? reasoningLevel.value : undefined
        // OpenRouter image-output models require the modalities parameter
        let modalities: string[] | undefined
        if (isOpenRouter(provider.baseUrl)) {
          const modelInfo = provider.models.find(m => m.id === mid)
          if (modelInfo?.imageOutput) {
            modalities = modelInfo.multimodal ? ['image', 'text'] : ['image']
          }
        }
        await streamOpenAI(provider.baseUrl, provider.apiKey, mid, payload, handler, ac.signal, systemPrompt, effort, modalities, temperature, maxTokens)
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        handler.onError(e instanceof Error ? e.message : String(e))
      } else {
        streamingConvIds.delete(conv.id)
        _abortControllers.delete(conv.id)
        if (activeConvId.value === conv.id) {
          streamingMsgId.value     = null
          streamingText.value      = ''
          streamingReasoning.value = ''
        }
      }
    }
  }

  // ─── Edit and resend ────────────────────────────────────────────────────

  async function editAndResend(messageId: string, newContent: string) {
    if (!activeConv.value || isStreaming.value) return
    const conv = activeConv.value
    const idx  = conv.messages.findIndex(m => m.id === messageId)
    if (idx < 0 || conv.messages[idx].role !== 'user') return
    conv.messages.splice(idx)
    await sendMessage(newContent)
  }

  async function editMessage(messageId: string, newContent: string) {
    if (!activeConv.value) return
    const conv = activeConv.value
    const msg  = conv.messages.find(m => m.id === messageId)
    if (!msg) return
    msg.content    = newContent
    conv.updatedAt = new Date().toISOString()
    await saveConversation(conv)
  }

  async function regenerate(messageId: string) {
    if (!activeConv.value || isStreaming.value) return
    const conv = activeConv.value
    const idx  = conv.messages.findIndex(m => m.id === messageId)
    if (idx < 0) return
    // Remove this assistant message and everything after it
    conv.messages.splice(idx)
    // Find the last user message to use as the prompt
    const lastUser = [...conv.messages].reverse().find(m => m.role === 'user')
    if (!lastUser) return
    // Remove the last user message too, then re-send it
    const userIdx = conv.messages.lastIndexOf(lastUser)
    conv.messages.splice(userIdx)
    await sendMessage(lastUser.content, lastUser.attachments)
  }

  // ─── Variant: regenerate with a different model ─────────────────────────

  async function regenerateWithModel(messageId: string, providerId: string, modelId: string) {
    if (!activeConv.value || isStreaming.value) return
    const conv   = activeConv.value
    const msgIdx = conv.messages.findIndex(m => m.id === messageId)
    if (msgIdx < 0) return

    const aiStore  = useAiSettingsStore()
    const provider = aiStore.providers.find(p => p.id === providerId)
    if (!provider || (!provider.apiKey && provider.type !== 'ollama')) return

    // Context = everything before this assistant message
    const msgsForApi = conv.messages.slice(0, msgIdx)
    const payload    = buildPayload(msgsForApi, provider.type)

    const msg = conv.messages[msgIdx]
    if (!msg.variants) msg.variants = []
    msg.variants.push({ id: newId(), content: '', model: modelId, providerId })
    const vi = msg.variants.length - 1
    msg.activeVariantIdx = msg.variants.length  // switch to new variant right away

    streamingConvIds.add(conv.id)
    if (activeConvId.value === conv.id) streamingVariantMsgId.value = messageId
    const ac = new AbortController()
    _abortControllers.set(conv.id, ac)

    const startedAt = Date.now()

    const assistantsStore = useAssistantsStore()
    const assistant = conv.assistantId
      ? assistantsStore.assistants.find(a => a.id === conv.assistantId)
      : undefined
    const systemPrompt = assistant?.systemPrompt || undefined

    const handler: StreamChunkHandler = {
      onToken(token) { msg.variants![vi].content += token },
      onReasoningToken(token) {
        const v = msg.variants![vi]
        v.reasoning = (v.reasoning ?? '') + token
      },
      onMediaOutput(mimeType, data, isUrl) {
        const v = msg.variants![vi]
        if (!v.mediaOutputs) v.mediaOutputs = []
        v.mediaOutputs.push(isUrl ? { mimeType, url: data } : { mimeType, data })
      },
      async onDone(usage) {
        msg.variants![vi].usage = { ...usage, durationMs: Date.now() - startedAt }
        streamingConvIds.delete(conv.id)
        _abortControllers.delete(conv.id)
        if (activeConvId.value === conv.id) streamingVariantMsgId.value = null
        conv.updatedAt = new Date().toISOString()
        await saveConversation(conv)
        await loadList()
      },
      async onError(err) {
        msg.variants![vi].content = `Error: ${err}`
        msg.variants![vi].error   = true
        streamingConvIds.delete(conv.id)
        _abortControllers.delete(conv.id)
        if (activeConvId.value === conv.id) streamingVariantMsgId.value = null
        await saveConversation(conv)
        await loadList()
      },
    }

    try {
      const budgetMap    = { low: 1024, medium: 8000, high: 32000 } as const
      const chatSettings = useChatSettingsStore()
      if (provider.type === 'anthropic') {
        const budget = useReasoning.value ? budgetMap[reasoningLevel.value] : undefined
        await streamAnthropic(provider.baseUrl, provider.apiKey, modelId, payload, handler, ac.signal, systemPrompt, budget, chatSettings.temperature, chatSettings.maxTokens)
      } else if (provider.type === 'google') {
        await streamGoogle(provider.baseUrl, provider.apiKey, modelId, payload, handler, ac.signal, systemPrompt, chatSettings.temperature, chatSettings.maxTokens)
      } else if (provider.type === 'ollama') {
        await streamOllama(provider.baseUrl, modelId, payload, handler, ac.signal, systemPrompt, chatSettings.temperature, chatSettings.maxTokens)
      } else {
        const effort = useReasoning.value ? reasoningLevel.value : undefined
        await streamOpenAI(provider.baseUrl, provider.apiKey, modelId, payload, handler, ac.signal, systemPrompt, effort, undefined, chatSettings.temperature, chatSettings.maxTokens)
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        handler.onError(e instanceof Error ? e.message : String(e))
      } else {
        streamingConvIds.delete(conv.id)
        _abortControllers.delete(conv.id)
        if (activeConvId.value === conv.id) streamingVariantMsgId.value = null
      }
    }
  }

  function setActiveVariant(messageId: string, idx: number) {
    const msg = activeConv.value?.messages.find(m => m.id === messageId)
    if (msg) msg.activeVariantIdx = idx
  }

  // ─── Context cutoff ─────────────────────────────────────────────────────

  function clearContext() {
    if (!activeConv.value || isStreaming.value) return
    const conv    = activeConv.value
    const lastMsg = conv.messages.at(-1)
    if (!lastMsg) return
    conv.contextCutoffMsgId = lastMsg.id
    conv.updatedAt          = new Date().toISOString()
    saveConversation(conv)
  }

  function removeContextCutoff() {
    if (!activeConv.value) return
    const conv = activeConv.value
    conv.contextCutoffMsgId = undefined
    conv.updatedAt          = new Date().toISOString()
    saveConversation(conv)
  }

  // ─── Stop streaming ─────────────────────────────────────────────────────

  function stopStreaming() {
    const cid = activeConvId.value
    if (cid) {
      _abortControllers.get(cid)?.abort()
      _abortControllers.delete(cid)
    }
  }

  // ─── Delete ─────────────────────────────────────────────────────────────

  async function deleteOne(id: string) {
    // Abort any in-flight stream before deleting
    _abortControllers.get(id)?.abort()
    _abortControllers.delete(id)
    streamingConvIds.delete(id)
    await deleteConversation(id)
    if (activeConvId.value === id) {
      activeConv.value   = null
      activeConvId.value = null
    }
    selectedConvIds.delete(id)
    await loadList()
  }

  async function deleteBatch() {
    const ids = [...selectedConvIds]
    for (const id of ids) {
      _abortControllers.get(id)?.abort()
      _abortControllers.delete(id)
      streamingConvIds.delete(id)
    }
    await deleteConversations(ids)
    if (activeConvId.value && selectedConvIds.has(activeConvId.value)) {
      activeConv.value   = null
      activeConvId.value = null
    }
    selectedConvIds.clear()
    batchMode.value = false
    await loadList()
  }

  // ─── Batch select ───────────────────────────────────────────────────────

  function toggleBatchMode() {
    batchMode.value = !batchMode.value
    if (!batchMode.value) selectedConvIds.clear()
  }

  function toggleSelect(id: string) {
    if (selectedConvIds.has(id)) selectedConvIds.delete(id)
    else selectedConvIds.add(id)
  }

  function selectAll() {
    conversations.value.forEach(c => selectedConvIds.add(c.id))
  }

  function clearSelection() {
    selectedConvIds.clear()
  }

  // ─── Pin ────────────────────────────────────────────────────────────────

  async function togglePin(id: string) {
    const conv = await loadConversation(id)
    if (!conv) return
    conv.pinned = !conv.pinned
    await saveConversation(conv)
    if (activeConvId.value === id && activeConv.value) {
      activeConv.value.pinned = conv.pinned
    }
    await loadList()
  }

  // ─── Rename ─────────────────────────────────────────────────────────────

  async function renameConversation(id: string, title: string) {
    const conv = await loadConversation(id)
    if (!conv) return
    conv.title      = title
    conv.updatedAt  = new Date().toISOString()
    await saveConversation(conv)
    if (activeConvId.value === id && activeConv.value) {
      activeConv.value.title = title
    }
    await loadList()
  }

  // ─── Reasoning ──────────────────────────────────────────────────────────

  function setReasoning(v: boolean) { useReasoning.value = v }
  function setReasoningLevel(v: 'low' | 'medium' | 'high') { reasoningLevel.value = v }

  // Init
  loadList()

  return {
    conversations, activeConvId, activeConv, isStreaming, isLoading,
    error, selectedConvIds, batchMode, streamingConvIds,
    loadList, openConversation, newConversation, sendMessage, stopStreaming,
    editAndResend, editMessage, regenerate,
    deleteOne, deleteBatch, toggleBatchMode, toggleSelect, selectAll, clearSelection,
    togglePin, renameConversation, streamingText, streamingReasoning, streamingMsgId,
    clearContext, removeContextCutoff,
    useReasoning, reasoningLevel, setReasoning, setReasoningLevel,
    regenerateWithModel, setActiveVariant, streamingVariantMsgId,
  }
})
