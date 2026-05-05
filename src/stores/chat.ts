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
  trashConversation,
  listTrashedConversations,
  restoreConversationFromTrash,
  permanentDeleteFromTrash,
  purgeExpiredTrash,
  newId,
  getDeletedConversations,
  applyRemoteDeletedConversations,
  mergeConversation,
  loadTrashedConversation,
  type ConversationMeta,
  type TrashedConversationMeta,
  type Conversation,
  type ChatMessage,
  type AttachmentMeta,
  type MessageUsage,
  type MessageVariant,
} from '../utils/storage'
import { useAiSettingsStore, calculateModelCost } from './aiSettings'
import { useAssistantsStore }   from './assistants'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useChatSettingsStore, DEFAULT_TITLE_PROMPT } from './chatSettings'
import { useWebSearchStore } from './webSearch'
import { performSearch, formatSearchResultsForContext } from '../services/webSearch'
import type { WebSearchResult } from '../utils/storage'
import { ocrImage } from '../utils/ocr'

export type { ConversationMeta, TrashedConversationMeta, Conversation, ChatMessage, AttachmentMeta, MessageVariant }

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

// Extract plain text from a payload content field that may be a string or a content-parts array
function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter(p => p.type === 'text' || !p.type)
      .map(p => p.text ?? '')
      .join(' ')
      .trim()
  }
  return ''
}


async function callImageGeneration(
  baseUrl: string, apiKey: string, model: string,
  prompt: string, size: string,
  handler: StreamChunkHandler,
  signal: AbortSignal,
): Promise<void> {
  const resp = await tauriFetch(`${baseUrl}/images/generations`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model, prompt, n: 1, size }),
    signal,
  })
  if (!resp.ok) {
    const err = await resp.text()
    handler.onError(`API error ${resp.status}: ${err}`)
    return
  }
  try {
    const data = await resp.json() as { data?: Array<{ url?: string; b64_json?: string }> }
    const img = data.data?.[0]
    if (img?.url) {
      handler.onMediaOutput?.('image/png', img.url, true)
    } else if (img?.b64_json) {
      handler.onMediaOutput?.('image/png', img.b64_json)
    }
    handler.onDone({})
  } catch (e) {
    handler.onError(e instanceof Error ? e.message : String(e))
  }
}

async function callImageEdit(
  baseUrl: string, apiKey: string, model: string,
  prompt: string, imageBase64: string, imageMimeType: string,
  size: string,
  handler: StreamChunkHandler,
  signal: AbortSignal,
): Promise<void> {
  const imageBytes = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0))
  const imageBlob  = new Blob([imageBytes], { type: imageMimeType })

  const form = new FormData()
  form.append('image', imageBlob, 'image.png')
  form.append('prompt', prompt)
  form.append('model', model)
  form.append('n', '1')
  form.append('size', size)

  const resp = await tauriFetch(`${baseUrl}/images/edits`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body:    form,
    signal,
  })
  if (!resp.ok) {
    const err = await resp.text()
    handler.onError(`API error ${resp.status}: ${err}`)
    return
  }
  try {
    const data = await resp.json() as { data?: Array<{ url?: string; b64_json?: string }> }
    const img = data.data?.[0]
    if (img?.url) {
      handler.onMediaOutput?.('image/png', img.url, true)
    } else if (img?.b64_json) {
      handler.onMediaOutput?.('image/png', img.b64_json)
    }
    handler.onDone({})
  } catch (e) {
    handler.onError(e instanceof Error ? e.message : String(e))
  }
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
  ollamaThink?: boolean,
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
  // Ollama OpenAI-compatible endpoint uses think: bool to toggle reasoning
  if (ollamaThink !== undefined) reqBody.think = ollamaThink
  if (modalities?.length) reqBody.modalities = modalities
  if (temperature !== undefined) reqBody.temperature = temperature
  if (maxTokens   !== undefined) reqBody.max_tokens  = maxTokens
  const resp = await tauriFetch(`${baseUrl}/chat/completions`, {
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
  let reasoningText = ''
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
        // OpenRouter uses delta.reasoning; DeepSeek uses delta.reasoning_content; Ollama OpenAI-compat uses delta.thinking
        const reasoningContent = parsed.choices?.[0]?.delta?.reasoning
          ?? parsed.choices?.[0]?.delta?.reasoning_content
          ?? parsed.choices?.[0]?.delta?.thinking
        if (reasoningContent && handler.onReasoningToken) {
          reasoningText += reasoningContent
          handler.onReasoningToken(reasoningContent)
        }
        if (parsed.usage) {
          usage.inputTokens  = parsed.usage.prompt_tokens
          usage.outputTokens = parsed.usage.completion_tokens
          if (parsed.usage.completion_tokens_details?.reasoning_tokens != null) {
            usage.reasoningTokens = parsed.usage.completion_tokens_details.reasoning_tokens
          }
          if (parsed.usage.cost != null)       usage.costUsd = parsed.usage.cost
          if (parsed.usage.total_cost != null) usage.costUsd = parsed.usage.total_cost
        }
      } catch { /* skip malformed */ }
    }
  }
  // Fallback: estimate reasoning tokens when API does not include them in outputTokens
  if (!usage.reasoningTokens && reasoningText) {
    usage.reasoningTokens = Math.max(1, Math.ceil(reasoningText.length / 4))
  }
  handler.onDone(usage)
}

// ─── DeepSeek (OpenAI-compatible with thinking mode) ──────────────────────────

async function streamDeepSeek(
  baseUrl: string, apiKey: string, model: string,
  messages: { role: string; content: unknown }[],
  handler: StreamChunkHandler,
  signal: AbortSignal,
  systemPrompt?: string,
  useReasoning?: boolean,
  reasoningEffort?: 'low' | 'medium' | 'high',
  temperature?: number,
  maxTokens?: number,
) {
  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages

  const reqBody: Record<string, unknown> = {
    model,
    messages: allMessages,
    stream: true,
    stream_options: { include_usage: true },
  }

  if (useReasoning) {
    reqBody.thinking = { type: 'enabled' }
    // DeepSeek maps: low/medium -> high, high -> max
    const effortMap = { low: 'high', medium: 'high', high: 'max' } as const
    reqBody.reasoning_effort = effortMap[reasoningEffort ?? 'high']
  } else {
    reqBody.thinking = { type: 'disabled' }
    if (temperature !== undefined) {
      reqBody.temperature = temperature
    }
  }
  if (maxTokens !== undefined) reqBody.max_tokens = maxTokens

  const resp = await tauriFetch(`${baseUrl}/chat/completions`, {
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
  let reasoningText = ''
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
        const rawContent = parsed.choices?.[0]?.delta?.content
        if (rawContent && typeof rawContent === 'string') {
          handler.onToken(rawContent)
        }
        const reasoningContent = parsed.choices?.[0]?.delta?.reasoning_content
        if (reasoningContent && handler.onReasoningToken) {
          reasoningText += reasoningContent
          handler.onReasoningToken(reasoningContent)
        }
        if (parsed.usage) {
          usage.inputTokens  = parsed.usage.prompt_tokens
          usage.outputTokens = parsed.usage.completion_tokens
          if (parsed.usage.completion_tokens_details?.reasoning_tokens != null) {
            usage.reasoningTokens = parsed.usage.completion_tokens_details.reasoning_tokens
          }
          if (parsed.usage.cost != null)       usage.costUsd = parsed.usage.cost
          if (parsed.usage.total_cost != null) usage.costUsd = parsed.usage.total_cost
        }
      } catch { /* skip malformed */ }
    }
  }
  if (!usage.reasoningTokens && reasoningText) {
    usage.reasoningTokens = Math.max(1, Math.ceil(reasoningText.length / 4))
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
  const resp = await tauriFetch(`${baseUrl}/v1/messages`, {
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
  const resp = await tauriFetch(
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
  useReasoning?: boolean,
) {
  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : [...messages]

  const reqBody: Record<string, unknown> = { model, messages: allMessages, stream: true }
  if (useReasoning != null) {
    reqBody.think = useReasoning
  }
  const options: Record<string, unknown> = {}
  if (temperature !== undefined) options.temperature = temperature
  if (maxTokens   !== undefined) options.num_predict = maxTokens
  if (Object.keys(options).length) reqBody.options = options

  const resp = await tauriFetch(`${baseUrl}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(reqBody),
    signal,
  })
  if (resp.status === 404) {
    // Fall back to OpenAI-compatible endpoint (e.g. DGX-Spark / Ollama proxies that
    // expose /v1/chat/completions but not the native /api/chat route).
    // Pass think: useReasoning so reasoning mode is still controllable in this path.
    await streamOpenAI(`${baseUrl}/v1`, '', model, allMessages, handler, signal, undefined, undefined, undefined, temperature, maxTokens, useReasoning)
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
          const usage: MessageUsage = {}
          if (parsed.prompt_eval_count != null) usage.inputTokens  = parsed.prompt_eval_count
          if (parsed.eval_count        != null) usage.outputTokens = parsed.eval_count
          if (parsed.eval_count != null && parsed.eval_duration > 0) {
            usage.tokensPerSecond = Math.round(parsed.eval_count / (parsed.eval_duration / 1e9))
          }
          handler.onDone(usage)
          return
        }
      } catch { /* skip malformed */ }
    }
  }
  handler.onDone({})
}

// ─── OCR pre-processing for non-multimodal OpenAI-compatible providers ────────

async function applyOcrToImages(messages: ChatMessage[]): Promise<ChatMessage[]> {
  return Promise.all(messages.map(async msg => {
    if (msg.role !== 'user' || !msg.attachments) return msg
    const needsOcr = msg.attachments.some(
      a => a.mimeType?.startsWith('image/') && a.data && !a.extractedText,
    )
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
      // In compare mode, use the actively-selected variant as the context for the next turn
      const activeVariant = m.role === 'assistant' && m.activeVariantIdx && m.activeVariantIdx > 0
        ? m.variants?.[m.activeVariantIdx - 1] ?? null
        : null
      const effectiveContent  = activeVariant?.content  ?? m.content
      const effectiveReasoning = activeVariant?.reasoning ?? m.reasoning
      // Rebuild a view of the message with effective content for payload building
      const msg = activeVariant ? { ...m, content: effectiveContent, reasoning: effectiveReasoning } : m

      const atts   = msg.attachments ?? []
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
        if (msg.content) parts.push({ text: msg.content })
        return {
          role:    msg.role === 'assistant' ? 'model' : 'user',
          content: parts.length > 0 ? parts : [{ text: msg.content }],
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
        if (msg.content) blocks.push({ type: 'text', text: msg.content })
        if (blocks.length > 1 || pdfs.length > 0 || images.length > 0) {
          return { role: msg.role, content: blocks }
        }
        return { role: msg.role, content: msg.content }
      }

      // OpenAI-compatible: images → image_url (or OCR text if pre-processed); PDFs → native (OpenRouter) or extracted text
      if (pdfs.length > 0 || images.length > 0) {
        // Images with extractedText were OCR'd for non-multimodal providers — treat as text, not image_url
        const imagesForUrl  = images.filter(img => !img.extractedText)
        const imagesAsText  = images.filter(img =>  img.extractedText)

        const contentParts: unknown[] = []

        if (openRouter) {
          // OpenRouter recommends sending the text prompt first, then images.
          // PDFs are sent via native file block; images via image_url.
          const ocrTexts = imagesAsText.map(img => `[图片OCR内容]\n${img.extractedText}`)
          const textParts = [...ocrTexts, msg.content].filter(Boolean).join('\n\n---\n\n')
          if (textParts) contentParts.push({ type: 'text', text: textParts })

          for (const pdf of pdfs) {
            contentParts.push({
              type: 'file',
              file: {
                filename:  pdf.name || 'document.pdf',
                file_data: `data:application/pdf;base64,${pdf.data}`,
              },
            })
          }

          for (const img of imagesForUrl) {
            contentParts.push({
              type:      'image_url',
              image_url: { url: `data:${img.mimeType};base64,${img.data}` },
            })
          }
          return { role: msg.role, content: contentParts }
        }

        // Fallback for other OpenAI-compatible providers: extracted PDF text + OCR text
        const ocrTexts = imagesAsText.map(img => `[图片OCR内容]\n${img.extractedText}`)
        const pdfTexts = pdfs.map(
          pdf => `${pdf.name}\n${pdf.extractedText || '（无法提取文字内容，该 PDF 可能为扫描件）'}`,
        )
        const allTexts = [...ocrTexts, ...pdfTexts]
        const fullText = allTexts.length > 0
          ? `${allTexts.join('\n\n')}\n\n---\n\n${msg.content}`
          : msg.content

        // Put text before images for better compatibility with OpenAI-compatible endpoints
        if (imagesForUrl.length > 0) {
          contentParts.push({ type: 'text', text: fullText })
        }
        for (const img of imagesForUrl) {
          contentParts.push({
            type:      'image_url',
            image_url: { url: `data:${img.mimeType};base64,${img.data}` },
          })
        }
        if (imagesForUrl.length > 0) {
          return { role: msg.role, content: contentParts }
        }
        return { role: msg.role, content: fullText }
      }

      // DeepSeek: reasoning_content is ignored by API for non-tool-calling turns,
      // but required for tool-calling turns, so it's safe to always include it.
      if (baseUrl?.includes('deepseek') && msg.role === 'assistant' && msg.reasoning) {
        return { role: msg.role, content: msg.content, reasoning_content: msg.reasoning }
      }

      return { role: msg.role, content: msg.content }
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

  // Per-conversation streaming UI state (supports split view)
  const _streamingTexts = reactive(new Map<string, string>())
  const _streamingReasonings = reactive(new Map<string, string>())
  const _streamingMsgIds = reactive(new Map<string, string | null>())

  // Backward-compatible computed refs (based on active conversation)
  const streamingText = computed({
    get: () => activeConvId.value ? (_streamingTexts.get(activeConvId.value) ?? '') : '',
    set: (v: string) => { if (activeConvId.value) _streamingTexts.set(activeConvId.value, v) }
  })
  const streamingReasoning = computed({
    get: () => activeConvId.value ? (_streamingReasonings.get(activeConvId.value) ?? '') : '',
    set: (v: string) => { if (activeConvId.value) _streamingReasonings.set(activeConvId.value, v) }
  })
  const streamingMsgId = computed({
    get: () => activeConvId.value ? (_streamingMsgIds.get(activeConvId.value) ?? null) : null,
    set: (v: string | null) => { if (activeConvId.value) _streamingMsgIds.set(activeConvId.value, v) }
  })

  // Set of message IDs that currently have at least one variant streaming
  const streamingVariantMsgIds = reactive<Set<string>>(new Set())
  const useReasoning       = ref(false)
  const reasoningLevel     = ref<'low' | 'medium' | 'high'>('medium')
  const webSearchEnabled     = ref(false)
  const trashedConversations = ref<TrashedConversationMeta[]>([])
  const previewTrashedConv = ref<Conversation | null>(null)

  // Optional second model for simultaneous dual-model generation
  const secondProviderId = ref<string | null>(null)
  const secondModelId_   = ref<string | null>(null)

  // Split view / secondary conversation
  const splitView = ref(false)
  const secondaryActiveConvId = ref<string | null>(null)
  const secondaryActiveConv = ref<Conversation | null>(null)

  // Focus tracking: which panel receives the next sidebar click
  const focusedPanel = ref<'left' | 'right'>('left')

  function setFocusedPanel(panel: 'left' | 'right') {
    focusedPanel.value = panel
  }

  // Independent popup-window conversations (keyed by conv ID)
  const _windowConvs = reactive(new Map<string, Conversation>())

  function getStreamingText(convId: string): string { return _streamingTexts.get(convId) ?? '' }
  function getStreamingReasoning(convId: string): string { return _streamingReasonings.get(convId) ?? '' }
  function getStreamingMsgId(convId: string): string | null { return _streamingMsgIds.get(convId) ?? null }
  function isStreamingFor(convId: string): boolean { return streamingConvIds.has(convId) }

  function setSecondModel(pid: string | null, mid: string | null) {
    secondProviderId.value = pid
    secondModelId_.value   = mid
  }

  function registerWindowConv(conv: Conversation) {
    _windowConvs.set(conv.id, conv)
  }
  function unregisterWindowConv(id: string) {
    _windowConvs.delete(id)
  }

  async function fetchConversation(id: string): Promise<Conversation | null> {
    return loadConversation(id)
  }

  // One AbortController per in-flight conversation main-message stream
  const _abortControllers = new Map<string, AbortController>()
  // Per-variant abort controllers: key = `${msgId}:${variantIdx}`
  const _variantAbortControllers = new Map<string, AbortController>()

  // ─── Load conversation list ─────────────────────────────────────────────

  async function loadList() {
    conversations.value = await listConversations()
  }

  async function loadTrashList() {
    trashedConversations.value = await listTrashedConversations()
  }

  // Coalesces rapid back-to-back loadList() calls (e.g. concurrent stream completions).
  let _loadListTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleLoadList() {
    if (_loadListTimer) clearTimeout(_loadListTimer)
    _loadListTimer = setTimeout(() => { _loadListTimer = null; loadList() }, 50)
  }

  // ─── Open conversation ──────────────────────────────────────────────────

  async function openConversation(id: string) {
    if (activeConvId.value === id) return
    isLoading.value = true
    const conv = await loadConversation(id)
    if (conv) {
      activeConv.value   = conv
      activeConvId.value = id
      // Note: we intentionally do NOT sync the global model selector when
      // opening an existing conversation. The user may have manually switched
      // models in the middle of a chat, and we should respect the current
      // selector state. Default model only applies to *new* conversations.
      // Restore streaming UI state if this conversation is still streaming
      if (streamingConvIds.has(id)) {
        const lastAssistant = [...conv.messages].reverse().find(m => m.role === 'assistant' && !m.error)
        streamingMsgId.value = lastAssistant?.id ?? null
      } else {
        streamingMsgId.value     = null
        streamingText.value      = ''
        streamingReasoning.value = ''
      }
    }
    isLoading.value = false
  }

  // ─── New conversation ───────────────────────────────────────────────────

  function newConversation(providerId?: string, modelId?: string, assistantId?: string): Conversation {
    const aiStore = useAiSettingsStore()
    // For regular conversations, use the global default model if set.
    let pid = providerId
    let mid = modelId
    if (!pid && !mid && !assistantId) {
      pid = aiStore.defaultProviderId || aiStore.activeProviderId
      mid = aiStore.defaultModelId    || aiStore.activeModelId()
    }
    pid ??= aiStore.activeProviderId
    mid ??= aiStore.activeModelId()
    // Sync global model state so the selector reflects the conversation's model
    if (pid) {
      aiStore.setActiveProvider(pid)
    }
    if (pid && mid) {
      aiStore.setModelForProvider(pid, mid)
    }

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
    streamingMsgId.value     = null
    streamingText.value      = ''
    streamingReasoning.value = ''
    // Persist immediately so the conversation appears in the list (and in filtered views)
    saveConversation(conv).then(() => loadList())
    return conv
  }

  function _buildNewConv(providerId?: string, modelId?: string, assistantId?: string): Conversation {
    const aiStore = useAiSettingsStore()
    let pid = providerId ?? aiStore.activeProviderId
    let mid = modelId    ?? aiStore.activeModelId()
    return {
      id:          newId(),
      title:       '新对话',
      createdAt:   new Date().toISOString(),
      updatedAt:   new Date().toISOString(),
      providerId:  pid,
      model:       mid,
      messages:    [],
      assistantId: assistantId || undefined,
    }
  }

  // Creates and saves a new conversation without affecting any panel's active state
  function newConversationSilent(providerId?: string, modelId?: string, assistantId?: string): Conversation {
    const conv = _buildNewConv(providerId, modelId, assistantId)
    saveConversation(conv).then(() => loadList())
    return conv
  }

  // Creates a new conversation and opens it in the right (secondary) panel
  function newConversationForSecondary(providerId?: string, modelId?: string, assistantId?: string): Conversation {
    const conv = _buildNewConv(providerId, modelId, assistantId)
    secondaryActiveConv.value   = conv
    secondaryActiveConvId.value = conv.id
    splitView.value = true
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

    let userMsg = conv.messages.find(m => m.role === 'user' && m.content)
    if (!userMsg) {
      // Image-only message: run OCR on the fly so we have text for title generation
      const imgOnlyMsg = conv.messages.find(m => m.role === 'user' && m.attachments?.some(a => a.mimeType?.startsWith('image/') && a.data))
      if (imgOnlyMsg) {
        const [processed] = await applyOcrToImages([imgOnlyMsg])
        userMsg = processed
      }
    }
    const aiMsg = conv.messages.filter(m => m.role === 'assistant' && !m.error && (m.content || m.mediaOutputs?.length)).at(-1)
    if (!userMsg || !aiMsg) return

    const promptTpl = chatSettings.titleGenPrompt || DEFAULT_TITLE_PROMPT
    // For image-only responses use a placeholder so the title reflects the user request
    const aiContent = aiMsg.content || (aiMsg.mediaOutputs?.length ? '[图片]' : '')
    const userContent = userMsg.content || userMsg.attachments?.map(a => a.extractedText).filter(Boolean).join(' ') || ''
    const prompt    = promptTpl
      .replace('{user}',     userContent.slice(0, 300))
      .replace('{response}', aiContent.slice(0, 300))

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

  async function _sendToConv(
    conv: Conversation,
    userContent: string,
    attachments?: AttachmentMeta[],
    skipSecondModel = false,
    useConvModel = false,
  ) {
    if (!userContent.trim() && !attachments?.length) return

    const aiStore = useAiSettingsStore()

    // Block only if THIS conversation is already streaming
    if (streamingConvIds.has(conv.id)) return

    // Update provider/model if changed
    const pid = useConvModel ? (conv.providerId || aiStore.activeProviderId) : aiStore.activeProviderId
    const mid = useConvModel ? (conv.model || aiStore.activeModelId()) : aiStore.activeModelId()
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
    _streamingTexts.set(conv.id, '')
    _streamingReasonings.set(conv.id, '')
    _streamingMsgIds.set(conv.id, assistantMsg.id)
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
      _streamingMsgIds.delete(conv.id)
      _streamingTexts.delete(conv.id)
      await saveConversation(conv)
      await loadList()
      return
    }

    // Messages sent to API: everything after the context cutoff (if set), minus the empty assistant msg
    let msgsForApi = conv.messages.slice(0, -1)
    if (conv.contextCutoffMsgId) {
      const cutoffIdx = msgsForApi.findIndex(m => m.id === conv.contextCutoffMsgId)
      if (cutoffIdx >= 0) msgsForApi = msgsForApi.slice(cutoffIdx + 1)
      // Clear after applying so future messages use full context
      conv.contextCutoffMsgId = undefined
    }

    // For providers that don't support multimodal input, OCR images into text before sending
    const modelInfo0 = provider.models.find(m => m.id === mid)
    const needsOcr0  = provider.type !== 'anthropic'
      && provider.type !== 'google'
      && provider.type !== 'ollama'
      && !isOpenRouter(provider.baseUrl)
      && !modelInfo0?.multimodal
      && !modelInfo0?.imageOutput
    if (needsOcr0) {
      const ocrMessages = await applyOcrToImages(msgsForApi)
      // Write OCR results back to conv.messages so UI and persistence see extractedText
      for (const ocrMsg of ocrMessages) {
        const origMsg = conv.messages.find(m => m.id === ocrMsg.id)
        if (origMsg?.attachments && ocrMsg.attachments) {
          for (let j = 0; j < origMsg.attachments.length; j++) {
            const ocrAtt = ocrMsg.attachments[j]
            if (ocrAtt.extractedText && !origMsg.attachments[j].extractedText) {
              origMsg.attachments[j].extractedText = ocrAtt.extractedText
            }
          }
        }
      }
      msgsForApi = ocrMessages
    }

    const payload   = buildPayload(msgsForApi, provider.type, provider.baseUrl)
    const startedAt = Date.now()

    const assistantsStore = useAssistantsStore()
    const assistant = conv.assistantId
      ? assistantsStore.assistants.find(a => a.id === conv.assistantId)
      : undefined
    let systemPrompt = assistant?.systemPrompt || undefined

    // ─── Web search injection ─────────────────────────────────────────────
    const wsStore = useWebSearchStore()
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
      } catch { /* silently skip on search error */ }
    }

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
        _streamingTexts.set(conv.id, localText)
      },
      onReasoningToken(token) {
        localReasoning         += token
        assistantMsg.reasoning  = localReasoning
        _streamingReasonings.set(conv.id, localReasoning)
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
        // Fallback cost calculation if API didn't return cost
        if (usage.costUsd == null) {
          const computed = calculateModelCost(aiStore.providers, pid, mid, usage.inputTokens, usage.outputTokens)
          if (computed != null) usage.costUsd = computed
        }
        assistantMsg.usage = { ...usage, durationMs: Date.now() - startedAt }
        streamingConvIds.delete(conv.id)
        _abortControllers.delete(conv.id)
        _streamingMsgIds.delete(conv.id)
        _streamingTexts.delete(conv.id)
        _streamingReasonings.delete(conv.id)
        conv.updatedAt = new Date().toISOString()
        await saveConversation(conv)
        scheduleLoadList()
        // Generate AI title after the first completed assistant reply
        if (shouldGenTitle) generateTitle(conv).catch(() => {})
      },
      async onError(err) {
        assistantMsg.content = `Error: ${err}`
        assistantMsg.error   = true
        streamingConvIds.delete(conv.id)
        _abortControllers.delete(conv.id)
        _streamingMsgIds.delete(conv.id)
        _streamingTexts.delete(conv.id)
        _streamingReasonings.delete(conv.id)
        await saveConversation(conv)
        scheduleLoadList()
      },
    }

    // Fire second model concurrently if configured (force=true bypasses streaming check)
    const pid2 = secondProviderId.value
    const mid2 = secondModelId_.value
    if (!skipSecondModel && pid2 && mid2 && (pid2 !== pid || mid2 !== mid)) {
      const p2 = aiStore.providers.find(p => p.id === pid2)
      if (p2 && (p2.apiKey || p2.type === 'ollama')) {
        setConvLayout(conv.id, 'horizontal')
        regenerateWithModel(assistantMsg.id, pid2, mid2, true).catch(() => {})
      }
    }

    try {
      if (provider.type === 'anthropic') {
        const budget = useReasoning.value ? budgetMap[reasoningLevel.value] : undefined
        await streamAnthropic(provider.baseUrl, provider.apiKey, mid, payload, handler, ac.signal, systemPrompt, budget, temperature, maxTokens)
      } else if (provider.type === 'google') {
        await streamGoogle(provider.baseUrl, provider.apiKey, mid, payload, handler, ac.signal, systemPrompt, temperature, maxTokens)
      } else if (provider.type === 'ollama') {
        await streamOllama(provider.baseUrl, mid, payload, handler, ac.signal, systemPrompt, temperature, maxTokens, useReasoning.value)
      } else if (provider.id === 'deepseek' || provider.baseUrl.includes('deepseek')) {
        // DeepSeek uses OpenAI-compatible endpoint with extra thinking/reasoning_effort params
        const modelInfo = provider.models.find(m => m.id === mid)
        if (modelInfo?.imageOutput) {
          const userPrompt = extractTextFromContent(payload.filter(m => m.role === 'user').at(-1)?.content)
          const size       = modelInfo.imageSize ?? '1024x1024'
          const imageAtt   = msgsForApi.filter(m => m.role === 'user').at(-1)?.attachments?.find(a => a.mimeType?.startsWith('image/') && a.data)
          if (imageAtt) {
            await callImageEdit(provider.baseUrl, provider.apiKey, mid, userPrompt, imageAtt.data!, imageAtt.mimeType!, size, handler, ac.signal)
          } else {
            await callImageGeneration(provider.baseUrl, provider.apiKey, mid, userPrompt, size, handler, ac.signal)
          }
        } else {
          await streamDeepSeek(provider.baseUrl, provider.apiKey, mid, payload, handler, ac.signal, systemPrompt, useReasoning.value, reasoningLevel.value, temperature, maxTokens)
        }
      } else {
        // openai / custom — pass reasoning_effort for o-series and compatible providers
        const effort = useReasoning.value ? reasoningLevel.value : undefined
        const modelInfo = provider.models.find(m => m.id === mid)
        if (!isOpenRouter(provider.baseUrl) && modelInfo?.imageOutput) {
          // Non-OpenRouter image-generation models use /images/generations or /images/edits
          const userPrompt = extractTextFromContent(payload.filter(m => m.role === 'user').at(-1)?.content)
          const size       = modelInfo.imageSize ?? '1024x1024'
          const imageAtt   = msgsForApi.filter(m => m.role === 'user').at(-1)?.attachments?.find(a => a.mimeType?.startsWith('image/') && a.data)
          if (imageAtt) {
            await callImageEdit(provider.baseUrl, provider.apiKey, mid, userPrompt, imageAtt.data!, imageAtt.mimeType!, size, handler, ac.signal)
          } else {
            await callImageGeneration(provider.baseUrl, provider.apiKey, mid, userPrompt, size, handler, ac.signal)
          }
        } else {
          // OpenRouter image-output models require the modalities parameter
          let modalities: string[] | undefined
          if (isOpenRouter(provider.baseUrl) && modelInfo?.imageOutput) {
            modalities = modelInfo.multimodal ? ['image', 'text'] : ['image']
          }
          await streamOpenAI(provider.baseUrl, provider.apiKey, mid, payload, handler, ac.signal, systemPrompt, effort, modalities, temperature, maxTokens)
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        handler.onError(e instanceof Error ? e.message : String(e))
      } else {
        streamingConvIds.delete(conv.id)
        _abortControllers.delete(conv.id)
        _streamingMsgIds.delete(conv.id)
        _streamingTexts.delete(conv.id)
        _streamingReasonings.delete(conv.id)
      }
    }
  }

  async function sendMessage(userContent: string, attachments?: AttachmentMeta[], skipSecondModel = false) {
    if (!activeConv.value) newConversation()
    const conv = activeConv.value!
    await _sendToConv(conv, userContent, attachments, skipSecondModel, false)
  }

  async function sendMessageTo(convId: string, userContent: string, attachments?: AttachmentMeta[]) {
    if (convId === activeConvId.value && activeConv.value) {
      return sendMessage(userContent, attachments)
    }
    if (convId === secondaryActiveConvId.value && secondaryActiveConv.value) {
      return _sendToConv(secondaryActiveConv.value, userContent, attachments, true, true)
    }
    // Window conv: reuse the already-loaded reactive object so UI updates live
    const windowConv = _windowConvs.get(convId)
    if (windowConv) {
      return _sendToConv(windowConv, userContent, attachments, true, true)
    }
    // Fallback: load conversation on the fly
    const conv = await loadConversation(convId)
    if (!conv) return
    return _sendToConv(conv, userContent, attachments, true, true)
  }

  async function openSecondaryConversation(id: string) {
    if (id === activeConvId.value) return
    const conv = await loadConversation(id)
    if (conv) {
      secondaryActiveConv.value = conv
      secondaryActiveConvId.value = id
      splitView.value = true
    }
  }

  function closeSecondaryConversation() {
    // Abort any active stream on the secondary conversation
    if (secondaryActiveConvId.value) {
      _abortControllers.get(secondaryActiveConvId.value)?.abort()
      _abortControllers.delete(secondaryActiveConvId.value)
      streamingConvIds.delete(secondaryActiveConvId.value)
      _streamingMsgIds.delete(secondaryActiveConvId.value)
      _streamingTexts.delete(secondaryActiveConvId.value)
      _streamingReasonings.delete(secondaryActiveConvId.value)
    }
    secondaryActiveConv.value = null
    secondaryActiveConvId.value = null
    splitView.value = false
  }

  function closeLeftPanel() {
    if (secondaryActiveConvId.value) {
      // Promote secondary to active, preserving any live stream on it
      activeConv.value   = secondaryActiveConv.value
      activeConvId.value = secondaryActiveConvId.value
    }
    // Clear secondary refs without aborting streams (promoted conv may still be streaming)
    secondaryActiveConv.value   = null
    secondaryActiveConvId.value = null
    splitView.value             = false
  }

  function swapPanels() {
    if (!splitView.value) return
    const leftId   = activeConvId.value
    const leftConv = activeConv.value
    activeConvId.value = secondaryActiveConvId.value
    activeConv.value   = secondaryActiveConv.value
    secondaryActiveConvId.value = leftId
    secondaryActiveConv.value   = leftConv
    if (focusedPanel.value === 'left') focusedPanel.value = 'right'
    else if (focusedPanel.value === 'right') focusedPanel.value = 'left'
  }

  async function openInFocusedPanel(id: string) {
    if (focusedPanel.value === 'right' && splitView.value) {
      return openSecondaryConversation(id)
    }
    return openConversation(id)
  }

  function toggleSplitView() {
    if (splitView.value) {
      closeSecondaryConversation()
    } else {
      // Try to open the most recent conversation that is not the active one
      const other = conversations.value.find(c => c.id !== activeConvId.value)
      if (other) {
        openSecondaryConversation(other.id)
      } else {
        splitView.value = true
      }
    }
  }

  async function openConversationWindow(convId: string) {
    // Detect if running inside Tauri
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

    if (!isTauri) {
      // Fallback for browser dev mode: open in new tab
      window.open('/#/chat-window?convId=' + encodeURIComponent(convId), '_blank')
      return
    }

    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      const conv = await loadConversation(convId)
      const title = conv?.title ?? 'Muse Chat'
      const label = 'chat-window-' + convId

      // Check if window already exists
      const existing = await WebviewWindow.getByLabel(label)
      if (existing) {
        await existing.setFocus()
        return
      }

      const isMac = navigator.userAgent.toLowerCase().includes('macintosh')

      const webview = new WebviewWindow(label, {
        url: '/#/chat-window?convId=' + encodeURIComponent(convId),
        title,
        width: 900,
        height: 720,
        minWidth: 400,
        minHeight: 500,
        center: true,
        decorations: isMac,
        titleBarStyle: isMac ? 'overlay' : undefined,
        hiddenTitle: isMac,
        transparent: true,
        shadow: true,
      })

      webview.once('tauri://created', () => {
        console.log('Chat window created:', label)
      })
      webview.once('tauri://error', (e) => {
        console.error('Failed to create chat window:', e)
      })
    } catch (err) {
      console.error('Error creating chat window:', err)
    }
  }

  // ─── Edit and resend ────────────────────────────────────────────────────

  function _getConvForMessage(messageId: string): Conversation | null {
    if (activeConv.value) {
      const hasMsg = activeConv.value.messages.some(m => m.id === messageId)
      if (hasMsg) return activeConv.value
    }
    if (secondaryActiveConv.value) {
      const hasMsg = secondaryActiveConv.value.messages.some(m => m.id === messageId)
      if (hasMsg) return secondaryActiveConv.value
    }
    return null
  }

  async function editAndResend(messageId: string, newContent: string) {
    const conv = _getConvForMessage(messageId)
    if (!conv) return
    const isSec = secondaryActiveConv.value?.id === conv.id
    if (!isSec && isStreaming.value) return
    if (isSec && streamingConvIds.has(conv.id)) return
    const idx  = conv.messages.findIndex(m => m.id === messageId)
    if (idx < 0 || conv.messages[idx].role !== 'user') return
    conv.messages.splice(idx)
    if (isSec) {
      await _sendToConv(conv, newContent, undefined, true, true)
    } else {
      await sendMessage(newContent)
    }
  }

  async function editMessage(messageId: string, newContent: string) {
    const conv = _getConvForMessage(messageId)
    if (!conv) return
    const msg  = conv.messages.find(m => m.id === messageId)
    if (!msg) return
    msg.content    = newContent
    conv.updatedAt = new Date().toISOString()
    await saveConversation(conv)
  }

  function deleteMessage(messageId: string) {
    const conv = _getConvForMessage(messageId)
    if (!conv) return
    const idx = conv.messages.findIndex(m => m.id === messageId)
    if (idx < 0) return
    conv.messages.splice(idx, 1)
    saveConversation(conv)
  }

  async function regenerate(messageId: string, slotIdx = 0) {
    const conv = _getConvForMessage(messageId)
    if (!conv) return
    const isSec = secondaryActiveConv.value?.id === conv.id
    if (!isSec && isStreaming.value) return
    if (isSec && streamingConvIds.has(conv.id)) return
    const idx  = conv.messages.findIndex(m => m.id === messageId)
    if (idx < 0) return
    const msg = conv.messages[idx]

    // If regenerating a specific variant slot, only re-generate that model.
    if (slotIdx > 0 && msg.variants && slotIdx <= msg.variants.length) {
      const variant = msg.variants[slotIdx - 1]
      await regenerateWithModel(messageId, variant.providerId, variant.model, true, slotIdx - 1)
      return
    }

    // If this is the last message, use the old tail-splice behavior
    if (idx === conv.messages.length - 1) {
      conv.messages.splice(idx)
      const lastUser = [...conv.messages].reverse().find(m => m.role === 'user')
      if (!lastUser) return
      const userIdx = conv.messages.lastIndexOf(lastUser)
      conv.messages.splice(userIdx)
      if (isSec) {
        await _sendToConv(conv, lastUser.content, lastUser.attachments, true, true)
      } else {
        await sendMessage(lastUser.content, lastUser.attachments, true)
      }
      return
    }

    // Middle regeneration: regenerate in-place using current conversation model
    const aiStore = useAiSettingsStore()
    const pid = conv.providerId ?? aiStore.activeProviderId
    const mid = conv.model ?? aiStore.activeModelId()
    if (!pid || !mid) return
    await regenerateWithModel(messageId, pid, mid, false, -1)
  }

  // ─── Variant: regenerate with a different model ─────────────────────────
  // Allows simultaneous variant streams — only blocks if the main message is streaming.

  // replaceVariantIdx: if set, replaces an existing variant slot in-place instead of pushing a new one
  async function regenerateWithModel(messageId: string, providerId: string, modelId: string, _force = false, replaceVariantIdx?: number) {
    const conv = _getConvForMessage(messageId)
    if (!conv) return
    // Block only if main message of this conv is streaming — unless forced (dual-model simultaneous)
    if (!_force && _streamingMsgIds.has(conv.id) && streamingConvIds.has(conv.id)) return
    const msgIdx = conv.messages.findIndex(m => m.id === messageId)
    if (msgIdx < 0) return

    const aiStore  = useAiSettingsStore()
    const provider = aiStore.providers.find(p => p.id === providerId)
    if (!provider || (!provider.apiKey && provider.type !== 'ollama')) return

    // Context = everything before this assistant message
    let msgsForApi = conv.messages.slice(0, msgIdx)

    // OCR images for non-multimodal providers
    const modelInfo1 = provider.models.find(m => m.id === modelId)
    const needsOcr1  = provider.type !== 'anthropic'
      && provider.type !== 'google'
      && provider.type !== 'ollama'
      && !isOpenRouter(provider.baseUrl)
      && !modelInfo1?.multimodal
      && !modelInfo1?.imageOutput
    if (needsOcr1) msgsForApi = await applyOcrToImages(msgsForApi)

    const payload    = buildPayload(msgsForApi, provider.type, provider.baseUrl)

    const msg = conv.messages[msgIdx]
    const isPrimary = replaceVariantIdx === -1
    let vi: number
    if (isPrimary) {
      // Replace primary slot in-place
      msg.content = ''
      msg.reasoning = undefined
      msg.usage = undefined
      msg.error = undefined
      msg.mediaOutputs = undefined
      msg.feedback = undefined
      msg.model = modelId
      msg.providerId = providerId
      msg.activeVariantIdx = 0
      vi = -1
    } else if (replaceVariantIdx !== undefined) {
      // Replace existing variant slot in-place (clears old content + mediaOutputs)
      if (!msg.variants) msg.variants = []
      msg.variants[replaceVariantIdx] = { id: newId(), content: '', model: modelId, providerId }
      vi = replaceVariantIdx
      msg.activeVariantIdx = vi + 1  // slot index in UI (0 = primary, 1+ = variants)
    } else {
      if (!msg.variants) msg.variants = []
      msg.variants.push({ id: newId(), content: '', model: modelId, providerId })
      vi = msg.variants.length - 1
      msg.activeVariantIdx = msg.variants.length  // switch to new variant right away
    }

    // Track streaming
    let ac: AbortController
    if (isPrimary) {
      streamingConvIds.add(conv.id)
      _streamingTexts.set(conv.id, '')
      _streamingReasonings.set(conv.id, '')
      _streamingMsgIds.set(conv.id, msg.id)
      ac = new AbortController()
      _abortControllers.set(conv.id, ac)
    } else {
      const varKey = `${messageId}:${vi}`
      streamingVariantMsgIds.add(messageId)
      ac = new AbortController()
      _variantAbortControllers.set(varKey, ac)
    }

    const startedAt = Date.now()

    const assistantsStore = useAssistantsStore()
    const assistant = conv.assistantId
      ? assistantsStore.assistants.find(a => a.id === conv.assistantId)
      : undefined
    let systemPrompt = assistant?.systemPrompt || undefined

    // Inject web search results from the last user message (same results as primary model)
    const lastUserMsg = msgsForApi.filter(m => m.role === 'user').at(-1)
    if (lastUserMsg?.webSearchResults?.length) {
      const ctx = formatSearchResultsForContext(lastUserMsg.webSearchResults, lastUserMsg.content ?? '')
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${ctx}` : ctx
    }

    const targetConv = conv!
    function cleanupVariant() {
      if (isPrimary) {
        _abortControllers.delete(targetConv.id)
        streamingConvIds.delete(targetConv.id)
        _streamingMsgIds.delete(targetConv.id)
        _streamingTexts.delete(targetConv.id)
        _streamingReasonings.delete(targetConv.id)
        return
      }
      const varKey = `${messageId}:${vi}`
      _variantAbortControllers.delete(varKey)
      // Remove from streaming set only when no more variants of this msg are streaming
      const stillStreaming = [..._variantAbortControllers.keys()].some(k => k.startsWith(messageId + ':'))
      if (!stillStreaming) streamingVariantMsgIds.delete(messageId)
    }

    const handler: StreamChunkHandler = {
      onToken(token) {
        if (isPrimary) {
          msg.content += token
          _streamingTexts.set(conv.id, msg.content)
        } else {
          msg.variants![vi].content += token
        }
      },
      onReasoningToken(token) {
        if (isPrimary) {
          msg.reasoning = (msg.reasoning ?? '') + token
          _streamingReasonings.set(conv.id, msg.reasoning)
        } else {
          const v = msg.variants![vi]
          v.reasoning = (v.reasoning ?? '') + token
        }
      },
      onMediaOutput(mimeType, data, isUrl) {
        if (isPrimary) {
          if (!msg.mediaOutputs) msg.mediaOutputs = []
          msg.mediaOutputs.push(isUrl ? { mimeType, url: data } : { mimeType, data })
        } else {
          const v = msg.variants![vi]
          if (!v.mediaOutputs) v.mediaOutputs = []
          v.mediaOutputs.push(isUrl ? { mimeType, url: data } : { mimeType, data })
        }
      },
      async onDone(usage) {
        if (usage.costUsd == null) {
          const computed = calculateModelCost(aiStore.providers, providerId, modelId, usage.inputTokens, usage.outputTokens)
          if (computed != null) usage.costUsd = computed
        }
        const usageWithDuration = { ...usage, durationMs: Date.now() - startedAt }
        if (isPrimary) {
          msg.usage = usageWithDuration
        } else {
          msg.variants![vi].usage = usageWithDuration
        }
        cleanupVariant()
        conv.updatedAt = new Date().toISOString()
        await saveConversation(conv)
        await loadList()
      },
      async onError(err) {
        if (isPrimary) {
          msg.content = `Error: ${err}`
          msg.error = true
        } else {
          msg.variants![vi].content = `Error: ${err}`
          msg.variants![vi].error   = true
        }
        cleanupVariant()
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
        await streamOllama(provider.baseUrl, modelId, payload, handler, ac.signal, systemPrompt, chatSettings.temperature, chatSettings.maxTokens, useReasoning.value)
      } else if (provider.id === 'deepseek' || provider.baseUrl.includes('deepseek')) {
        const mInfo = provider.models.find(m => m.id === modelId)
        if (mInfo?.imageOutput) {
          const userPrompt = extractTextFromContent(payload.filter(m => m.role === 'user').at(-1)?.content)
          const size       = mInfo.imageSize ?? '1024x1024'
          const imageAtt   = msgsForApi.filter(m => m.role === 'user').at(-1)?.attachments?.find(a => a.mimeType?.startsWith('image/') && a.data)
          if (imageAtt) {
            await callImageEdit(provider.baseUrl, provider.apiKey, modelId, userPrompt, imageAtt.data!, imageAtt.mimeType!, size, handler, ac.signal)
          } else {
            await callImageGeneration(provider.baseUrl, provider.apiKey, modelId, userPrompt, size, handler, ac.signal)
          }
        } else {
          await streamDeepSeek(provider.baseUrl, provider.apiKey, modelId, payload, handler, ac.signal, systemPrompt, useReasoning.value, reasoningLevel.value, chatSettings.temperature, chatSettings.maxTokens)
        }
      } else {
        const effort = useReasoning.value ? reasoningLevel.value : undefined
        const mInfo = provider.models.find(m => m.id === modelId)
        if (!isOpenRouter(provider.baseUrl) && mInfo?.imageOutput) {
          const userPrompt = extractTextFromContent(payload.filter(m => m.role === 'user').at(-1)?.content)
          const size       = mInfo.imageSize ?? '1024x1024'
          const imageAtt   = msgsForApi.filter(m => m.role === 'user').at(-1)?.attachments?.find(a => a.mimeType?.startsWith('image/') && a.data)
          if (imageAtt) {
            await callImageEdit(provider.baseUrl, provider.apiKey, modelId, userPrompt, imageAtt.data!, imageAtt.mimeType!, size, handler, ac.signal)
          } else {
            await callImageGeneration(provider.baseUrl, provider.apiKey, modelId, userPrompt, size, handler, ac.signal)
          }
        } else {
          let modalities: string[] | undefined
          if (isOpenRouter(provider.baseUrl) && mInfo?.imageOutput) {
            modalities = mInfo.multimodal ? ['image', 'text'] : ['image']
          }
          await streamOpenAI(provider.baseUrl, provider.apiKey, modelId, payload, handler, ac.signal, systemPrompt, effort, modalities, chatSettings.temperature, chatSettings.maxTokens)
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        handler.onError(e instanceof Error ? e.message : String(e))
      } else {
        cleanupVariant()
      }
    }
  }

  function setActiveVariant(messageId: string, idx: number) {
    const conv = _getConvForMessage(messageId)
    const msg = conv?.messages.find(m => m.id === messageId)
    if (msg) msg.activeVariantIdx = idx
  }

  function deleteVariant(messageId: string, idx: number) {
    const conv = _getConvForMessage(messageId)
    if (!conv) return
    const isSec = secondaryActiveConv.value?.id === conv.id
    if (!isSec && isStreaming.value) return
    if (isSec && streamingConvIds.has(conv.id)) return

    if (idx === 0) {
      const msg = conv.messages.find(m => m.id === messageId)
      if (!msg) return
      if (!msg.variants?.length) {
        // No variants — delete the entire assistant message
        const msgIdx = conv.messages.findIndex(m => m.id === messageId)
        if (msgIdx >= 0) conv.messages.splice(msgIdx, 1)
      } else {
        // Promote the first variant to become the main message body
        const first = msg.variants[0]
        msg.content    = first.content
        msg.model      = first.model
        msg.providerId = first.providerId
        msg.reasoning  = first.reasoning
        msg.usage      = first.usage
        msg.feedback   = first.feedback ?? msg.feedback
        msg.error      = first.error
        msg.variants.splice(0, 1)
        // Adjust active index: the promoted slot (was 1) is now 0
        const active = msg.activeVariantIdx ?? 0
        msg.activeVariantIdx = active <= 1 ? 0 : active - 1
      }
      saveConversation(conv)
      return
    }

    const msg = conv.messages.find(m => m.id === messageId)
    if (!msg || !msg.variants) return
    const vi = idx - 1
    if (vi < 0 || vi >= msg.variants.length) return
    msg.variants.splice(vi, 1)
    // Adjust active variant index if it now points out of bounds
    const maxIdx = msg.variants.length
    if ((msg.activeVariantIdx ?? 0) > maxIdx) {
      msg.activeVariantIdx = maxIdx
    }
    saveConversation(conv)
  }

  function setMessageFeedback(messageId: string, feedback: 'positive' | 'negative' | null) {
    const conv = _getConvForMessage(messageId)
    if (!conv) return
    const msg = conv.messages.find(m => m.id === messageId)
    if (!msg) return
    const idx = msg.activeVariantIdx ?? 0
    setVariantFeedbackBySlot(messageId, idx, feedback)
  }

  // Set feedback for an explicit slot index (0 = main, 1+ = variants[idx-1])
  function setVariantFeedbackBySlot(messageId: string, slotIdx: number, feedback: 'positive' | 'negative' | null) {
    const conv = _getConvForMessage(messageId)
    if (!conv) return
    const msg = conv.messages.find(m => m.id === messageId)
    if (!msg) return
    if (slotIdx === 0) {
      msg.feedback = feedback ?? undefined
    } else if (msg.variants && msg.variants[slotIdx - 1]) {
      msg.variants[slotIdx - 1].feedback = feedback ?? undefined
    }
    saveConversation(conv)
  }

  // ─── Context cutoff ─────────────────────────────────────────────────────

  function clearContext(cid?: string) {
    const targetId = cid ?? activeConvId.value
    if (!targetId) return
    if (!cid && isStreaming.value) return
    if (cid && streamingConvIds.has(cid)) return
    const conv = targetId === activeConvId.value
      ? activeConv.value
      : targetId === secondaryActiveConvId.value
        ? secondaryActiveConv.value
        : _windowConvs.get(targetId) ?? null
    if (!conv) return
    const lastMsg = conv.messages.at(-1)
    if (!lastMsg) return
    conv.contextCutoffMsgId = lastMsg.id
    conv.updatedAt          = new Date().toISOString()
    saveConversation(conv)
  }

  function removeContextCutoff(cid?: string) {
    const targetId = cid ?? activeConvId.value
    if (!targetId) return
    const conv = targetId === activeConvId.value
      ? activeConv.value
      : targetId === secondaryActiveConvId.value
        ? secondaryActiveConv.value
        : _windowConvs.get(targetId) ?? null
    if (!conv) return
    conv.contextCutoffMsgId = undefined
    conv.updatedAt          = new Date().toISOString()
    saveConversation(conv)
  }

  // ─── Stop streaming ─────────────────────────────────────────────────────

  function stopStreaming(cid?: string) {
    const target = cid ?? activeConvId.value
    if (target) {
      _abortControllers.get(target)?.abort()
      _abortControllers.delete(target)
    }
  }

  // ─── Delete ─────────────────────────────────────────────────────────────

  async function deleteOne(id: string) {
    _abortControllers.get(id)?.abort()
    _abortControllers.delete(id)
    streamingConvIds.delete(id)
    _streamingMsgIds.delete(id)
    _streamingTexts.delete(id)
    _streamingReasonings.delete(id)
    await trashConversation(id)
    if (activeConvId.value === id) {
      activeConv.value   = null
      activeConvId.value = null
    }
    if (secondaryActiveConvId.value === id) {
      secondaryActiveConv.value = null
      secondaryActiveConvId.value = null
    }
    selectedConvIds.delete(id)
    await loadList()
    await loadTrashList()
  }

  async function deleteBatch() {
    const ids = [...selectedConvIds]
    for (const id of ids) {
      _abortControllers.get(id)?.abort()
      _abortControllers.delete(id)
      streamingConvIds.delete(id)
      _streamingMsgIds.delete(id)
      _streamingTexts.delete(id)
      _streamingReasonings.delete(id)
    }
    for (const id of ids) {
      await trashConversation(id)
    }
    if (activeConvId.value && selectedConvIds.has(activeConvId.value)) {
      activeConv.value   = null
      activeConvId.value = null
    }
    if (secondaryActiveConvId.value && selectedConvIds.has(secondaryActiveConvId.value)) {
      secondaryActiveConv.value = null
      secondaryActiveConvId.value = null
    }
    selectedConvIds.clear()
    batchMode.value = false
    await loadList()
    await loadTrashList()
  }

  async function restoreFromTrash(id: string) {
    await restoreConversationFromTrash(id)
    await loadList()
    await loadTrashList()
  }

  async function permanentDeleteOne(id: string) {
    await permanentDeleteFromTrash(id)
    await loadTrashList()
  }

  async function clearAllTrash() {
    for (const item of trashedConversations.value) {
      await permanentDeleteFromTrash(item.id)
    }
    trashedConversations.value = []
  }

  async function openTrashPreview(id: string) {
    const conv = await loadTrashedConversation(id)
    if (conv) previewTrashedConv.value = conv
  }

  function closeTrashPreview() {
    previewTrashedConv.value = null
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

  async function setConversationAssistant(id: string, assistantId: string | undefined) {
    // Find the live in-memory object and mutate it so the UI updates instantly
    let target: Conversation | null = null
    if (id === activeConvId.value) target = activeConv.value
    else if (id === secondaryActiveConvId.value) target = secondaryActiveConv.value
    else target = _windowConvs.get(id) ?? null
    if (!target) {
      target = await loadConversation(id)
    }
    if (!target) return
    target.assistantId = assistantId
    target.updatedAt   = new Date().toISOString()
    await saveConversation(target)
    await loadList()
  }

  // ─── Reasoning ──────────────────────────────────────────────────────────

  function setReasoning(v: boolean) { useReasoning.value = v }
  function setReasoningLevel(v: 'low' | 'medium' | 'high') { reasoningLevel.value = v }

  // ─── Per-conversation variant layout ─────────────────────────────────────

  const LS_CONV_LAYOUTS = 'muse-variant-layout'
  const LS_CONV_LAYOUTS_AT = 'muse-variant-layout-modified-at'

  const convLayouts = reactive(new Map<string, 'tab' | 'horizontal'>())

  // Load persisted layouts on init
  try {
    const raw = localStorage.getItem(LS_CONV_LAYOUTS)
    if (raw) {
      for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
        convLayouts.set(k, v as 'tab' | 'horizontal')
      }
    }
  } catch { /* ignore */ }

  function getConvLayout(convId: string): 'tab' | 'horizontal' {
    return convLayouts.get(convId) ?? 'tab'
  }

  function setConvLayout(convId: string, layout: 'tab' | 'horizontal') {
    convLayouts.set(convId, layout)
    localStorage.setItem(LS_CONV_LAYOUTS, JSON.stringify(Object.fromEntries(convLayouts)))
    localStorage.setItem(LS_CONV_LAYOUTS_AT, new Date().toISOString())
  }

  // Init
  loadList()
  purgeExpiredTrash(30).then(() => loadTrashList()).catch(() => loadTrashList())


  return {
    conversations, activeConvId, activeConv, isStreaming, isLoading,
    error, selectedConvIds, batchMode, streamingConvIds,
    loadList, openConversation, newConversation, newConversationSilent, newConversationForSecondary, sendMessage, stopStreaming,
    editAndResend, editMessage, regenerate, deleteMessage,
    deleteOne, deleteBatch, toggleBatchMode, toggleSelect, selectAll, clearSelection,
    togglePin, renameConversation, setConversationAssistant, streamingText, streamingReasoning, streamingMsgId,
    clearContext, removeContextCutoff,
    useReasoning, reasoningLevel, setReasoning, setReasoningLevel,
    webSearchEnabled,
    regenerateWithModel, setActiveVariant, deleteVariant, streamingVariantMsgIds,
    setMessageFeedback, setVariantFeedbackBySlot,
    secondProviderId, secondModelId: secondModelId_, setSecondModel,
    trashedConversations, loadTrashList, restoreFromTrash, permanentDeleteOne, clearAllTrash,
    previewTrashedConv, openTrashPreview, closeTrashPreview,
    getConvLayout, setConvLayout,
    // Split view
    splitView, secondaryActiveConvId, secondaryActiveConv,
    openSecondaryConversation, closeSecondaryConversation, closeLeftPanel, toggleSplitView,
    swapPanels, openInFocusedPanel,
    focusedPanel, setFocusedPanel,
    sendMessageTo,
    openConversationWindow,
    registerWindowConv, unregisterWindowConv, fetchConversation,
    getStreamingText, getStreamingReasoning, getStreamingMsgId, isStreamingFor,
  }
})

// ─── Sync module ─────────────────────────────────────────────────────────────

import { syncService } from '../services/sync'
import type { SyncModule } from '../services/sync/types'

const MOD_CONV = 'conversations'

interface ConversationsPayload {
  list: ConversationMeta[]
  deletedConversations: Record<string, string>
}

const conversationsSyncModule: SyncModule = {
  id: MOD_CONV,
  remoteDirs: ['conversations'],
  getLocalTimestamp() {
    return localStorage.getItem('muse-ts-conversations') ?? new Date(0).toISOString()
  },
  async sync(ctx, localChanged) {
    ctx.setProgress('同步对话历史…')

    const localList = await listConversations()
    const idxPath = ctx.rp('conversations/index.enc')

    const raw = await ctx.getEncrypted<ConversationsPayload | ConversationMeta[]>(idxPath, { list: [], deletedConversations: {} })
    const remotePayload: ConversationsPayload = Array.isArray(raw)
      ? { list: raw, deletedConversations: {} }
      : raw

    applyRemoteDeletedConversations(remotePayload.deletedConversations ?? {})
    const mergedDeleted = getDeletedConversations()

    function isDeleted(id: string, updatedAt: string): boolean {
      const ts = mergedDeleted[id]
      return !!ts && ts > updatedAt
    }

    const remoteList = remotePayload.list
    const localIds = new Set(localList.map(c => c.id))
    const remoteIds = new Set(remoteList.map(c => c.id))
    const remoteTombstones = new Set(Object.keys(remotePayload.deletedConversations ?? {}))

    let indexChanged = false

    // ① Apply tombstones
    for (const meta of localList) {
      if (isDeleted(meta.id, meta.updatedAt)) await deleteConversation(meta.id)
    }
    for (const [id] of Object.entries(mergedDeleted)) {
      if (!remoteTombstones.has(id)) {
        await ctx.webdavDelete(ctx.rp(`conversations/${id}.enc`))
        indexChanged = true
      }
    }

    // ② Download conversations that only exist on remote
    for (const meta of remoteList) {
      if (localIds.has(meta.id)) continue
      if (isDeleted(meta.id, meta.updatedAt)) continue
      const resp = await ctx.webdavGet(ctx.rp(`conversations/${meta.id}.enc`))
      if (!resp.ok) continue
      try {
        const conv = JSON.parse(await ctx.decrypt(resp.body)) as Conversation
        if (!isDeleted(conv.id, conv.updatedAt)) await saveConversation(conv)
      } catch { /* skip corrupt remote entry */ }
    }

    // ③ Upload conversations that only exist locally
    if (localChanged) {
      for (const meta of localList) {
        if (remoteIds.has(meta.id)) continue
        if (isDeleted(meta.id, meta.updatedAt)) continue
        const conv = await loadConversation(meta.id)
        if (!conv) continue
        await ctx.putEncrypted(ctx.rp(`conversations/${meta.id}.enc`), conv)
        indexChanged = true
      }
    }

    // ④ Merge conversations that exist on both sides but differ
    for (const localMeta of localList) {
      if (isDeleted(localMeta.id, localMeta.updatedAt)) continue
      const remoteMeta = remoteList.find(r => r.id === localMeta.id)
      if (!remoteMeta || localMeta.updatedAt === remoteMeta.updatedAt) continue

      const localConv = await loadConversation(localMeta.id)
      if (!localConv) continue

      const convPath = ctx.rp(`conversations/${localMeta.id}.enc`)
      const remoteResp = await ctx.webdavGet(convPath)

      if (!remoteResp.ok) {
        if (localChanged && localMeta.updatedAt > remoteMeta.updatedAt) {
          await ctx.putEncrypted(convPath, localConv)
          indexChanged = true
        }
        continue
      }

      try {
        const remoteConv = JSON.parse(await ctx.decrypt(remoteResp.body)) as Conversation
        const { merged, localChanged: convLocalChanged, remoteChanged: convRemoteChanged } = mergeConversation(localConv, remoteConv)
        if (convLocalChanged) await saveConversation(merged)
        if (convRemoteChanged && localChanged) {
          await ctx.putEncrypted(convPath, merged)
          indexChanged = true
        }
      } catch {
        if (localChanged && localMeta.updatedAt > remoteMeta.updatedAt) {
          await ctx.putEncrypted(convPath, localConv)
          indexChanged = true
        }
      }
    }

    if (!localChanged && !indexChanged) return

    // Prune tombstones older than 6 months
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
    for (const [id, ts] of Object.entries(mergedDeleted)) {
      if (ts < sixMonthsAgo) delete mergedDeleted[id]
    }
    localStorage.setItem('muse-deleted-conversations', JSON.stringify(mergedDeleted))

    const finalIndex = await listConversations()
    await ctx.putEncrypted(idxPath, {
      list: finalIndex,
      deletedConversations: mergedDeleted,
    } satisfies ConversationsPayload)
  },
  async onSynced() {
    await useChatStore().loadList()
  },
}

syncService.register(conversationsSyncModule)
