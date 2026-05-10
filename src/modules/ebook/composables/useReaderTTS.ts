/**
 * AI Text-to-Speech composable for the ebook reader.
 * Uses a dedicated TTS server configured independently in Settings → Books.
 * Calls POST {baseUrl}/audio/speech with an OpenAI-compatible request body.
 */

import { ref } from 'vue'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

export interface TtsConfig {
  baseUrl: string
  apiKey:  string
  model:   string
}

export interface TtsState {
  active:  boolean
  loading: boolean
  paused:  boolean
  voice:   string
  speed:   number    // 0.25 – 4.0
  error:   string | null
}

const MAX_CHUNK_CHARS = 4000

// In-memory cache: hash → ArrayBuffer  (session lifetime, avoids re-fetching)
const _memCache = new Map<string, ArrayBuffer>()

async function chunkHash(text: string, model: string, voice: string, speed: number): Promise<string> {
  const raw = new TextEncoder().encode(`${model}|${voice}|${speed}|${text}`)
  const buf = await crypto.subtle.digest('SHA-256', raw)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function useReaderTTS() {
  const state = ref<TtsState>({
    active:  false,
    loading: false,
    paused:  false,
    voice:   'nova',
    speed:   1.0,
    error:   null,
  })

  let _audio: HTMLAudioElement | null = null
  let _blobUrl: string | null = null
  let _pendingChunks: string[] = []
  let _isPlayingChunks = false

  function splitIntoChunks(text: string): string[] {
    const chunks: string[] = []
    let remaining = text.trim()
    while (remaining.length > 0) {
      if (remaining.length <= MAX_CHUNK_CHARS) { chunks.push(remaining); break }
      let cutAt = remaining.lastIndexOf('. ', MAX_CHUNK_CHARS)
      if (cutAt < MAX_CHUNK_CHARS * 0.5) cutAt = MAX_CHUNK_CHARS
      chunks.push(remaining.slice(0, cutAt + 1).trim())
      remaining = remaining.slice(cutAt + 1).trim()
    }
    return chunks.filter(c => c.length > 0)
  }

  async function fetchChunk(text: string, cfg: TtsConfig): Promise<string> {
    const hash = await chunkHash(text, cfg.model, state.value.voice, state.value.speed)

    if (_memCache.has(hash)) {
      const blob = new Blob([_memCache.get(hash)!], { type: 'audio/mpeg' })
      return URL.createObjectURL(blob)
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`

    const resp = await tauriFetch(`${cfg.baseUrl}/audio/speech`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model,
        input: text,
        voice: state.value.voice,
        speed: state.value.speed,
      }),
    })
    if (!resp.ok) throw new Error(`TTS 请求失败: ${resp.status}`)
    const buf = await resp.arrayBuffer()
    _memCache.set(hash, buf)
    const blob = new Blob([buf], { type: 'audio/mpeg' })
    return URL.createObjectURL(blob)
  }

  function releaseAudio() {
    if (_audio) { _audio.pause(); _audio.src = ''; _audio = null }
    if (_blobUrl) { URL.revokeObjectURL(_blobUrl); _blobUrl = null }
  }

  async function playChunks(chunks: string[], cfg: TtsConfig) {
    _pendingChunks = chunks
    _isPlayingChunks = true

    for (let i = 0; i < _pendingChunks.length; i++) {
      if (!_isPlayingChunks) break
      state.value.loading = true
      try {
        const url = await fetchChunk(_pendingChunks[i], cfg)
        if (!_isPlayingChunks) { URL.revokeObjectURL(url); break }
        releaseAudio()
        _blobUrl = url
        _audio = new Audio(url)
        _audio.playbackRate = state.value.speed
        state.value.loading = false
        await new Promise<void>((resolve, reject) => {
          _audio!.onended = () => resolve()
          _audio!.onerror = () => reject(new Error('音频播放错误'))
          _audio!.onpause = () => { if (!state.value.paused) resolve() }
          _audio!.play().catch(reject)
        })
      } catch (e) {
        state.value.error = String(e)
        state.value.loading = false
        break
      }
    }

    _isPlayingChunks = false
    if (state.value.active && !state.value.paused) {
      state.value.active = false
      state.value.loading = false
    }
  }

  async function speak(text: string, cfg: TtsConfig | null) {
    if (!cfg?.baseUrl) {
      state.value.error = '请在设置 → 图书 中配置 TTS 服务地址'
      return
    }
    stop()
    state.value.active = true
    state.value.error = null
    state.value.paused = false
    const chunks = splitIntoChunks(text)
    if (chunks.length === 0) { state.value.active = false; return }
    await playChunks(chunks, cfg)
  }

  function pause()  {
    if (_audio && !_audio.paused) { _audio.pause(); state.value.paused = true }
  }
  function resume() {
    if (_audio && _audio.paused)  { _audio.play().catch(() => {}); state.value.paused = false }
  }
  function stop() {
    _isPlayingChunks = false
    _pendingChunks = []
    releaseAudio()
    state.value.active = state.value.loading = state.value.paused = false
    state.value.error = null
  }

  /** Play a list of pre-fetched audio URLs sequentially (no TTS API call). Caller passes ownership; URLs are revoked as each part finishes. */
  async function speakFromUrls(
    urls: string[],
    callbacks?: {
      onChunkStart?: (index: number) => Promise<void> | void
      onChunkEnd?: (index: number) => void
      onFinished?: () => void
    },
  ): Promise<void> {
    if (urls.length === 0) return
    stop()
    state.value.active = true
    state.value.error = null
    state.value.paused = false
    _isPlayingChunks = true

    for (let i = 0; i < urls.length; i++) {
      if (!_isPlayingChunks) break
      releaseAudio()
      _blobUrl = urls[i]
      _audio = new Audio(urls[i])
      _audio.playbackRate = state.value.speed
      await callbacks?.onChunkStart?.(i)
      if (!_isPlayingChunks) break
      try {
        await new Promise<void>((resolve, reject) => {
          _audio!.onended = () => resolve()
          _audio!.onerror = () => reject(new Error('音频播放错误'))
          _audio!.onpause = () => { if (!state.value.paused) resolve() }
          _audio!.play().catch(reject)
        })
      } catch (e) {
        state.value.error = String(e)
        callbacks?.onChunkEnd?.(i)
        break
      }
      callbacks?.onChunkEnd?.(i)
    }

    _isPlayingChunks = false
    if (state.value.active && !state.value.paused) {
      state.value.active = false
      state.value.loading = false
      callbacks?.onFinished?.()
    }
  }

  function setVoice(v: string) { state.value.voice = v }
  function setSpeed(s: number) { state.value.speed = s; if (_audio) _audio.playbackRate = s }

  return { state, speak, speakFromUrls, pause, resume, stop, setVoice, setSpeed }
}
