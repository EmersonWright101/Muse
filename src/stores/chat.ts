/**
 * Chat Store
 *
 * Manages conversation list (metadata) and the currently active conversation.
 * Full conversation data is persisted to disk via storage.ts.
 * AI streaming is handled here for all supported providers.
 */

import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
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

export type { ConversationMeta, Conversation, ChatMessage, AttachmentMeta, MessageVariant }

// ─── Streaming helpers ────────────────────────────────────────────────────────

interface StreamChunkHandler {
  onToken:           (token: string) => void
  onDone:            (usage: MessageUsage) => void
  onError:           (err: string) => void
  onReasoningToken?: (token: string) => void
  onMediaOutput?:    (mimeType: string, data: string, isUrl?: boolean) => void
}

async function streamOpenAI(
  baseUrl: string, apiKey: string, model: string,
  messages: { role: string; content: unknown }[],
  handler: StreamChunkHandler,
  signal: AbortSignal,
  systemPrompt?: string,
  reasoningEffort?: 'low' | 'medium' | 'high',
) {
  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages
  const reqBody: Record<string, unknown> = { model, messages: allMessages, stream: true, stream_options: { include_usage: true } }
  if (reasoningEffort) reqBody.reasoning_effort = reasoningEffort
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
                const u = blk.image_url.url
                if (u.startsWith('data:')) {
                  const comma = u.indexOf(',')
                  handler.onMediaOutput(u.slice(5, comma).replace(';base64', ''), u.slice(comma + 1))
                } else {
                  handler.onMediaOutput('image/png', u, true)
                }
              }
            }
          }
        }
        const reasoningContent = parsed.choices?.[0]?.delta?.reasoning_content
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
) {
  const body: Record<string, unknown> = { model, messages, max_tokens: 8192, stream: true }
  if (systemPrompt) body.system = systemPrompt
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

// ─── PDF provider routing (mirrors Cherry Studio's PDF_NATIVE_PROVIDER_TYPES) ─

const PDF_NATIVE_PROVIDERS = new Set(['anthropic', 'google'])

// ─── Build message payload ────────────────────────────────────────────────────

function buildPayload(
  messages: ChatMessage[],
  providerType: string,
): { role: string; content: unknown }[] {
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

      // OpenAI-compatible / OpenRouter: PDFs → extracted text; images → image_url
      // (matches Cherry Studio's pdfCompatibilityPlugin fallback for non-native providers)
      if (pdfs.length > 0 || images.length > 0) {
        const contentParts: unknown[] = []
        for (const img of images) {
          contentParts.push({
            type:      'image_url',
            image_url: { url: `data:${img.mimeType};base64,${img.data}` },
          })
        }
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
  const isStreaming        = ref(false)
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

  let _abortController: AbortController | null = null

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
    // Persist immediately so the conversation appears in the list (and in filtered views)
    saveConversation(conv).then(() => loadList())
    return conv
  }

  // ─── Send message (with streaming) ─────────────────────────────────────

  async function sendMessage(userContent: string, attachments?: AttachmentMeta[]) {
    if (!userContent.trim() && !attachments?.length) return
    if (isStreaming.value) return

    const aiStore = useAiSettingsStore()

    if (!activeConv.value) newConversation()
    const conv = activeConv.value!

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

    // Auto-title from first user message
    if (conv.messages.filter(m => m.role === 'user').length === 1) {
      conv.title = userContent.slice(0, 30).replace(/\n/g, ' ')
        || attachments?.find(a => a.mimeType === 'application/pdf')?.name
        || '新对话'
    }

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

    isStreaming.value    = true
    streamingText.value  = ''
    streamingMsgId.value = assistantMsg.id
    error.value          = null
    _abortController     = new AbortController()

    await saveConversation(conv)
    await loadList()

    const provider = aiStore.providers.find(p => p.id === pid)
    if (!provider || !provider.apiKey) {
      assistantMsg.content = '请先在设置中配置 AI 供应商的 API Key。'
      assistantMsg.error   = true
      isStreaming.value    = false
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
    const payload   = buildPayload(msgsForApi, provider.type)
    const startedAt = Date.now()

    const assistantsStore = useAssistantsStore()
    const assistant = conv.assistantId
      ? assistantsStore.assistants.find(a => a.id === conv.assistantId)
      : undefined
    const systemPrompt = assistant?.systemPrompt || undefined

    const budgetMap = { low: 1024, medium: 8000, high: 32000 } as const

    const handler: StreamChunkHandler = {
      onToken(token) {
        streamingText.value  += token
        assistantMsg.content  = streamingText.value
      },
      onReasoningToken(token) {
        streamingReasoning.value += token
        assistantMsg.reasoning    = streamingReasoning.value
      },
      onMediaOutput(mimeType, data, isUrl) {
        if (!assistantMsg.mediaOutputs) assistantMsg.mediaOutputs = []
        assistantMsg.mediaOutputs.push(isUrl ? { mimeType, url: data } : { mimeType, data })
      },
      async onDone(usage) {
        // Fallback: if full accumulated text is a data URL or image URL, convert to media output
        const txt = streamingText.value.trim()
        if (txt.startsWith('data:image/') || txt.startsWith('data:video/')) {
          const comma = txt.indexOf(',')
          if (comma > 0) {
            if (!assistantMsg.mediaOutputs) assistantMsg.mediaOutputs = []
            assistantMsg.mediaOutputs.push({ mimeType: txt.slice(5, comma).replace(';base64', ''), data: txt.slice(comma + 1) })
            assistantMsg.content = ''
            streamingText.value  = ''
          }
        } else {
          const modelInfo = provider?.models.find(m => m.id === mid)
          if (modelInfo?.imageOutput && /^https?:\/\//.test(txt)) {
            if (!assistantMsg.mediaOutputs) assistantMsg.mediaOutputs = []
            assistantMsg.mediaOutputs.push({ mimeType: 'image/png', url: txt })
            assistantMsg.content = ''
            streamingText.value  = ''
          }
        }
        assistantMsg.usage       = { ...usage, durationMs: Date.now() - startedAt }
        isStreaming.value        = false
        streamingMsgId.value     = null
        streamingText.value      = ''
        streamingReasoning.value = ''
        conv.updatedAt = new Date().toISOString()
        await saveConversation(conv)
        await loadList()
      },
      async onError(err) {
        assistantMsg.content     = `Error: ${err}`
        assistantMsg.error       = true
        isStreaming.value        = false
        streamingMsgId.value     = null
        streamingText.value      = ''
        streamingReasoning.value = ''
        await saveConversation(conv)
        await loadList()
      },
    }

    try {
      if (provider.type === 'anthropic') {
        const budget = useReasoning.value ? budgetMap[reasoningLevel.value] : undefined
        await streamAnthropic(provider.baseUrl, provider.apiKey, mid, payload, handler, _abortController.signal, systemPrompt, budget)
      } else if (provider.type === 'google') {
        await streamGoogle(provider.baseUrl, provider.apiKey, mid, payload, handler, _abortController.signal, systemPrompt)
      } else {
        // openai / custom — pass reasoning_effort for o-series and compatible providers
        const effort = useReasoning.value ? reasoningLevel.value : undefined
        await streamOpenAI(provider.baseUrl, provider.apiKey, mid, payload, handler, _abortController.signal, systemPrompt, effort)
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        handler.onError(e instanceof Error ? e.message : String(e))
      } else {
        isStreaming.value        = false
        streamingMsgId.value     = null
        streamingText.value      = ''
        streamingReasoning.value = ''
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
    if (!provider || !provider.apiKey) return

    // Context = everything before this assistant message
    const msgsForApi = conv.messages.slice(0, msgIdx)
    const payload    = buildPayload(msgsForApi, provider.type)

    // Push a plain object — msg is already reactive (part of activeConv),
    // so mutations via msg.variants[vi] go through the reactive proxy safely.
    const msg = conv.messages[msgIdx]
    if (!msg.variants) msg.variants = []
    msg.variants.push({ id: newId(), content: '', model: modelId, providerId })
    const vi = msg.variants.length - 1
    msg.activeVariantIdx = msg.variants.length  // switch to new variant right away

    isStreaming.value           = true
    streamingVariantMsgId.value = messageId
    _abortController            = new AbortController()

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
        msg.variants![vi].usage     = { ...usage, durationMs: Date.now() - startedAt }
        isStreaming.value           = false
        streamingVariantMsgId.value = null
        conv.updatedAt = new Date().toISOString()
        await saveConversation(conv)
        await loadList()
      },
      async onError(err) {
        msg.variants![vi].content   = `Error: ${err}`
        msg.variants![vi].error     = true
        isStreaming.value           = false
        streamingVariantMsgId.value = null
        await saveConversation(conv)
        await loadList()
      },
    }

    try {
      const budgetMap = { low: 1024, medium: 8000, high: 32000 } as const
      if (provider.type === 'anthropic') {
        const budget = useReasoning.value ? budgetMap[reasoningLevel.value] : undefined
        await streamAnthropic(provider.baseUrl, provider.apiKey, modelId, payload, handler, _abortController.signal, systemPrompt, budget)
      } else if (provider.type === 'google') {
        await streamGoogle(provider.baseUrl, provider.apiKey, modelId, payload, handler, _abortController.signal, systemPrompt)
      } else {
        const effort = useReasoning.value ? reasoningLevel.value : undefined
        await streamOpenAI(provider.baseUrl, provider.apiKey, modelId, payload, handler, _abortController.signal, systemPrompt, effort)
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        handler.onError(e instanceof Error ? e.message : String(e))
      } else {
        isStreaming.value           = false
        streamingVariantMsgId.value = null
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
    _abortController?.abort()
    isStreaming.value = false
  }

  // ─── Delete ─────────────────────────────────────────────────────────────

  async function deleteOne(id: string) {
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
    error, selectedConvIds, batchMode,
    loadList, openConversation, newConversation, sendMessage, stopStreaming,
    editAndResend, editMessage, regenerate,
    deleteOne, deleteBatch, toggleBatchMode, toggleSelect, selectAll, clearSelection,
    togglePin, renameConversation, streamingText, streamingMsgId,
    clearContext, removeContextCutoff,
    useReasoning, reasoningLevel, setReasoning, setReasoningLevel,
    regenerateWithModel, setActiveVariant, streamingVariantMsgId,
  }
})
