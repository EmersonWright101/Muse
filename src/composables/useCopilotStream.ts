/**
 * Lightweight streaming completion helper for the travel copilot.
 * Handles all four provider types, text tokens only (no media / reasoning).
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import type { AIProvider } from '../stores/aiSettings'

export async function streamCopilotCompletion(
  provider: AIProvider,
  modelId: string,
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
  signal: AbortSignal,
  onToken: (token: string) => void,
): Promise<void> {
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
        const token = extractToken(JSON.parse(data))
        if (token) onToken(token)
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
): Promise<void> {
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
      stream:     true,
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  })
  if (!resp.ok) return
  await readSSE(resp, signal, (d) => (d as { choices?: { delta?: { content?: string } }[] })?.choices?.[0]?.delta?.content, onToken)
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
): Promise<void> {
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
  if (!resp.ok) return
  await readSSE(resp, signal, (d) => {
    const ev = d as { type?: string; delta?: { type?: string; text?: string } }
    return ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' ? ev.delta.text : undefined
  }, onToken)
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
): Promise<void> {
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
  if (!resp.ok) return
  await readSSE(resp, signal, (d) =>
    (d as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
      ?.candidates?.[0]?.content?.parts?.[0]?.text,
    onToken,
  )
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
): Promise<void> {
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
  if (!resp.ok) return
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
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line) as { message?: { content?: string }; done?: boolean }
        if (ev.message?.content) onToken(ev.message.content)
        if (ev.done) return
      } catch { /* skip */ }
    }
  }
}
