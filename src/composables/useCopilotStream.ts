/**
 * Lightweight streaming completion helper for the travel copilot.
 * Handles all four provider types, text tokens only (no media / reasoning).
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import type { AIProvider } from '../stores/aiSettings'

export interface CopilotUsage {
  inputTokens?:  number
  outputTokens?: number
  costUsd?:      number
}

export interface CopilotStreamHandler {
  onToken: (token: string) => void
  onMediaOutput?: (mimeType: string, data: string, isUrl?: boolean) => void
}

export async function streamCopilotCompletion(
  provider: AIProvider,
  modelId: string,
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
  signal: AbortSignal,
  handler: CopilotStreamHandler,
): Promise<CopilotUsage> {
  switch (provider.type) {
    case 'anthropic': return streamAnthropic(provider, modelId, prompt, systemPrompt, maxTokens, signal, handler)
    case 'google':    return streamGoogle(provider, modelId, prompt, systemPrompt, maxTokens, signal, handler)
    case 'ollama':    return streamOllama(provider, modelId, prompt, systemPrompt, maxTokens, signal, handler)
    default:          return streamOpenAI(provider, modelId, prompt, systemPrompt, maxTokens, signal, handler)
  }
}

// ─── Shared SSE reader ────────────────────────────────────────────────────────

async function readSSE(
  resp: Response,
  signal: AbortSignal,
  extractToken: (parsed: unknown) => string | undefined,
  onToken: (token: string) => void,
  onUsage?: (parsed: unknown) => void,
  onMediaOutput?: (mimeType: string, data: string, isUrl?: boolean) => void,
): Promise<void> {
  const reader  = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    if (signal.aborted) { reader.cancel(); return }
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data: ')) continue
      const data = t.slice(6)
      if (data === '[DONE]') return
      try {
        const parsed = JSON.parse(data)
        const token = extractToken(parsed)
        if (token) onToken(token)
        if (onUsage) onUsage(parsed)
        // Handle inline media outputs from stream (data URLs, images, audio)
        if (onMediaOutput) {
          const rawContent = (parsed as { choices?: { delta?: { content?: unknown } }[] })?.choices?.[0]?.delta?.content
          if (typeof rawContent === 'string') {
            if (rawContent.startsWith('data:image/') || rawContent.startsWith('data:video/') || rawContent.startsWith('data:audio/')) {
              const comma = rawContent.indexOf(',')
              if (comma > 0) onMediaOutput(rawContent.slice(5, comma).replace(';base64', ''), rawContent.slice(comma + 1))
            }
          } else if (Array.isArray(rawContent)) {
            for (const blk of rawContent as Array<{ type?: string; text?: string; data?: string; audio?: string; mimeType?: string; mime_type?: string; image_url?: { url?: string } }>) {
              if (blk.type === 'audio') {
                const audioData = blk.data ?? blk.audio
                if (audioData) onMediaOutput(blk.mimeType ?? blk.mime_type ?? 'audio/wav', audioData)
              } else if (blk.image_url?.url) {
                if (blk.image_url.url.startsWith('data:')) {
                  const comma = blk.image_url.url.indexOf(',')
                  if (comma > 0) onMediaOutput(blk.image_url.url.slice(5, comma).replace(';base64', ''), blk.image_url.url.slice(comma + 1))
                } else {
                  onMediaOutput('image/png', blk.image_url.url, true)
                }
              }
            }
          }
          // OpenRouter image generation in delta.images
          const deltaImages = (parsed as { choices?: { delta?: { images?: Array<{ image_url?: { url?: string } }> } }[] })?.choices?.[0]?.delta?.images
          if (deltaImages) {
            for (const img of deltaImages) {
              if (img.image_url?.url) {
                if (img.image_url.url.startsWith('data:')) {
                  const comma = img.image_url.url.indexOf(',')
                  if (comma > 0) onMediaOutput(img.image_url.url.slice(5, comma).replace(';base64', ''), img.image_url.url.slice(comma + 1))
                } else {
                  onMediaOutput('image/png', img.image_url.url, true)
                }
              }
            }
          }
          // OpenAI native audio: delta.audio as incremental chunks
          const deltaAudio = (parsed as { choices?: { delta?: { audio?: { data?: string; wav?: string; base64?: string } | string } }[] })?.choices?.[0]?.delta?.audio
          if (deltaAudio) {
            const chunk = typeof deltaAudio === 'string' ? deltaAudio : (deltaAudio.data ?? deltaAudio.wav ?? deltaAudio.base64 ?? '')
            if (chunk && onMediaOutput) onMediaOutput('audio/wav', chunk)
          }
        }
      } catch { /* skip malformed lines */ }
    }
  }
}

// ─── OpenAI-compatible ────────────────────────────────────────────────────────

async function streamOpenAI(
  provider: AIProvider,
  modelId: string,
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
  signal: AbortSignal,
  handler: CopilotStreamHandler,
): Promise<CopilotUsage> {
  const usage: CopilotUsage = {}
  const resp = await tauriFetch(`${provider.baseUrl}/chat/completions`, {
    method:  'POST',
    signal,
    headers: { 'Authorization': `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: prompt },
      ],
      stream:              true,
      stream_options:      { include_usage: true },
      max_tokens:          maxTokens,
      temperature:         0.7,
    }),
  })
  if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status} ${resp.statusText}`)
  await readSSE(
    resp, signal,
    (d) => (d as { choices?: { delta?: { content?: string } }[] })?.choices?.[0]?.delta?.content,
    handler.onToken,
    (d) => {
      const u = (d as { usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; total_cost?: number } }).usage
      if (!u) return
      if (u.prompt_tokens     != null) usage.inputTokens  = u.prompt_tokens
      if (u.completion_tokens != null) usage.outputTokens = u.completion_tokens
      if (u.cost              != null) usage.costUsd       = u.cost
      if (u.total_cost        != null) usage.costUsd       = u.total_cost
    },
    handler.onMediaOutput,
  )
  return usage
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

async function streamAnthropic(
  provider: AIProvider,
  modelId: string,
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
  signal: AbortSignal,
  handler: CopilotStreamHandler,
): Promise<CopilotUsage> {
  const usage: CopilotUsage = {}
  const resp = await tauriFetch(`${provider.baseUrl}/v1/messages`, {
    method:  'POST',
    signal,
    headers: {
      'x-api-key':         provider.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({
      model:      modelId,
      messages:   [{ role: 'user', content: prompt }],
      system:     systemPrompt,
      stream:     true,
      max_tokens: maxTokens,
    }),
  })
  if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status} ${resp.statusText}`)
  await readSSE(resp, signal, (d) => {
    const ev = d as { type?: string; delta?: { type?: string; text?: string }; usage?: { input_tokens?: number; output_tokens?: number } }
    if (ev.usage) {
      if (ev.usage.input_tokens  != null) usage.inputTokens  = ev.usage.input_tokens
      if (ev.usage.output_tokens != null) usage.outputTokens = (usage.outputTokens ?? 0) + ev.usage.output_tokens
    }
    return ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' ? ev.delta.text : undefined
  }, handler.onToken)
  return usage
}

// ─── Google Gemini ────────────────────────────────────────────────────────────

async function streamGoogle(
  provider: AIProvider,
  modelId: string,
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
  signal: AbortSignal,
  handler: CopilotStreamHandler,
): Promise<CopilotUsage> {
  const usage: CopilotUsage = {}
  const resp = await tauriFetch(
    `${provider.baseUrl}/models/${modelId}:streamGenerateContent?alt=sse&key=${provider.apiKey}`,
    {
      method:  'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig:  { maxOutputTokens: maxTokens, temperature: 0.7 },
      }),
    },
  )
  if (!resp.ok) throw new Error(`Google API error: ${resp.status} ${resp.statusText}`)
  await readSSE(resp, signal, (d) => {
    const chunk = d as { candidates?: { content?: { parts?: { text?: string; inlineData?: { mimeType: string; data: string } }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }
    if (chunk.usageMetadata) {
      if (chunk.usageMetadata.promptTokenCount     != null) usage.inputTokens  = chunk.usageMetadata.promptTokenCount
      if (chunk.usageMetadata.candidatesTokenCount != null) usage.outputTokens = chunk.usageMetadata.candidatesTokenCount
    }
    // Handle Gemini inlineData (images/audio/video)
    const parts = chunk.candidates?.[0]?.content?.parts
    if (parts && handler.onMediaOutput) {
      for (const part of parts) {
        if (part.inlineData?.data) {
          handler.onMediaOutput(part.inlineData.mimeType, part.inlineData.data)
        }
      }
    }
    return chunk.candidates?.[0]?.content?.parts?.[0]?.text
  }, handler.onToken)
  return usage
}

// ─── Ollama ───────────────────────────────────────────────────────────────────

async function streamOllama(
  provider: AIProvider,
  modelId: string,
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
  signal: AbortSignal,
  handler: CopilotStreamHandler,
): Promise<CopilotUsage> {
  const resp = await tauriFetch(`${provider.baseUrl}/api/chat`, {
    method:  'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: prompt },
      ],
      stream:  true,
      options: { temperature: 0.7, num_predict: maxTokens },
    }),
  })
  // Fall back to OpenAI-compatible endpoint for proxies that don't expose /api/chat (e.g. DGX-Spark)
  if (resp.status === 404) {
    return streamOpenAI(provider, modelId, prompt, systemPrompt, maxTokens, signal, handler)
  }
  if (!resp.ok) throw new Error(`Ollama API error: ${resp.status} ${resp.statusText}`)
  const reader  = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    if (signal.aborted) { reader.cancel(); return {} }
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line) as { message?: { content?: string }; done?: boolean }
        if (ev.message?.content) handler.onToken(ev.message.content)
        if (ev.done) return {}
      } catch { /* skip */ }
    }
  }
  return {}
}
