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

export async function streamCopilotCompletion(
  provider: AIProvider,
  modelId: string,
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
  signal: AbortSignal,
  onToken: (token: string) => void,
): Promise<CopilotUsage> {
  switch (provider.type) {
    case 'anthropic': return streamAnthropic(provider, modelId, prompt, systemPrompt, maxTokens, signal, onToken)
    case 'google':    return streamGoogle(provider, modelId, prompt, systemPrompt, maxTokens, signal, onToken)
    case 'ollama':    return streamOllama(provider, modelId, prompt, systemPrompt, maxTokens, signal, onToken)
    default:          return streamOpenAI(provider, modelId, prompt, systemPrompt, maxTokens, signal, onToken)
  }
}

// ─── Shared SSE reader ────────────────────────────────────────────────────────

async function readSSE(
  resp: Response,
  signal: AbortSignal,
  extractToken: (parsed: unknown) => string | undefined,
  onToken: (token: string) => void,
  onUsage?: (parsed: unknown) => void,
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
  onToken: (token: string) => void,
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
    onToken,
    (d) => {
      const u = (d as { usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; total_cost?: number } }).usage
      if (!u) return
      if (u.prompt_tokens     != null) usage.inputTokens  = u.prompt_tokens
      if (u.completion_tokens != null) usage.outputTokens = u.completion_tokens
      if (u.cost              != null) usage.costUsd       = u.cost
      if (u.total_cost        != null) usage.costUsd       = u.total_cost
    },
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
  onToken: (token: string) => void,
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
  }, onToken)
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
  onToken: (token: string) => void,
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
    const chunk = d as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }
    if (chunk.usageMetadata) {
      if (chunk.usageMetadata.promptTokenCount     != null) usage.inputTokens  = chunk.usageMetadata.promptTokenCount
      if (chunk.usageMetadata.candidatesTokenCount != null) usage.outputTokens = chunk.usageMetadata.candidatesTokenCount
    }
    return chunk.candidates?.[0]?.content?.parts?.[0]?.text
  }, onToken)
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
  onToken: (token: string) => void,
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
    return streamOpenAI(provider, modelId, prompt, systemPrompt, maxTokens, signal, onToken)
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
        if (ev.message?.content) onToken(ev.message.content)
        if (ev.done) return {}
      } catch { /* skip */ }
    }
  }
  return {}
}
