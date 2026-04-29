import { ref } from 'vue'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile, writeFile, mkdir, exists } from '@tauri-apps/plugin-fs'
import { listConversations, loadConversation } from '../utils/storage'
import type { ChatMessage } from '../utils/storage'

const MIME_EXT: Record<string, string> = {
  'image/png':     'png',
  'image/jpeg':    'jpg',
  'image/gif':     'gif',
  'image/webp':    'webp',
  'image/svg+xml': 'svg',
  'image/bmp':     'bmp',
  'application/pdf': 'pdf',
}

function mimeToExt(mime: string): string {
  return MIME_EXT[mime] ?? 'bin'
}

function b64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

function getEffectiveFeedback(msg: ChatMessage): 'positive' | 'negative' | null | undefined {
  const idx = msg.activeVariantIdx ?? 0
  if (idx === 0) return msg.feedback
  return msg.variants?.[idx - 1]?.feedback
}

interface PendingFile {
  absPath: string
  data:    string  // base64
}

interface ProcessedAttachment {
  name:          string
  mimeType:      string
  path?:         string
  extractedText?: string
}

interface ProcessedMediaOutput {
  mimeType: string
  path?:    string
  url?:     string
}

interface ProcessedMessage {
  role:         string
  content:      string
  timestamp:    string
  model?:       string
  feedback?:    'positive' | 'negative' | null
  attachments?: ProcessedAttachment[]
  mediaOutputs?: ProcessedMediaOutput[]
}

function processMessage(
  msg:         ChatMessage,
  convId:      string,
  imgDirAbs:   string,
  imgDirRel:   string,
  pending:     PendingFile[],
): ProcessedMessage {
  const idx     = msg.activeVariantIdx ?? 0
  const variant = idx > 0 ? msg.variants?.[idx - 1] : null

  const content    = variant?.content    ?? msg.content
  const feedback   = variant?.feedback   ?? msg.feedback
  const model      = variant?.model      ?? msg.model
  const mediaOuts  = variant?.mediaOutputs ?? msg.mediaOutputs

  const attachments: ProcessedAttachment[] = (msg.attachments ?? []).map((att, i) => {
    const base: ProcessedAttachment = { name: att.name, mimeType: att.mimeType }
    if (att.extractedText) base.extractedText = att.extractedText
    if (att.data) {
      const ext   = mimeToExt(att.mimeType)
      const fname = `${convId}_${msg.id}_att${i}.${ext}`
      pending.push({ absPath: `${imgDirAbs}/${fname}`, data: att.data })
      base.path = `${imgDirRel}/${fname}`
    }
    return base
  })

  const mediaOutputs: ProcessedMediaOutput[] = (mediaOuts ?? []).map((mo, i) => {
    if (mo.data) {
      const ext   = mimeToExt(mo.mimeType)
      const fname = `${convId}_${msg.id}_media${i}.${ext}`
      pending.push({ absPath: `${imgDirAbs}/${fname}`, data: mo.data })
      return { mimeType: mo.mimeType, path: `${imgDirRel}/${fname}` }
    }
    return { mimeType: mo.mimeType, url: mo.url }
  })

  const result: ProcessedMessage = { role: msg.role, content, timestamp: msg.timestamp }
  if (model)              result.model        = model
  if (feedback != null)   result.feedback     = feedback
  if (attachments.length) result.attachments  = attachments
  if (mediaOutputs.length) result.mediaOutputs = mediaOutputs
  return result
}

async function flushPendingFiles(imgDirAbs: string, pending: PendingFile[]): Promise<void> {
  if (!pending.length) return
  if (!(await exists(imgDirAbs))) {
    await mkdir(imgDirAbs, { recursive: true })
  }
  for (const { absPath, data } of pending) {
    await writeFile(absPath, b64ToUint8Array(data))
  }
}

export type ExportFilter = 'all' | 'positive' | 'negative'

export function useChatExport() {
  const exporting   = ref(false)
  const exportError = ref<string | null>(null)

  async function exportChat(filter: ExportFilter) {
    const dateStr  = new Date().toISOString().slice(0, 10)
    const savePath = await save({
      defaultPath: `muse-chat-${filter}-${dateStr}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!savePath) return

    exporting.value   = true
    exportError.value = null

    try {
      const sep        = savePath.includes('\\') ? '\\' : '/'
      const dir        = savePath.slice(0, savePath.lastIndexOf(sep))
      const imgDirRel  = 'muse-chat-images'
      const imgDirAbs  = `${dir}${sep}${imgDirRel}`
      const allMeta    = await listConversations()
      const pending:   PendingFile[] = []

      let output: unknown

      if (filter === 'all') {
        const conversations = []
        for (const meta of allMeta) {
          const conv = await loadConversation(meta.id)
          if (!conv) continue
          const messages = conv.messages
            .filter(m => !m.error)
            .map(m => processMessage(m, conv.id, imgDirAbs, imgDirRel, pending))
          conversations.push({
            id:        conv.id,
            title:     conv.title,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
            messages,
          })
        }
        output = { exportedAt: new Date().toISOString(), filter: 'all', conversations }
      } else {
        // feedback-filtered export: each entry is a user→assistant Q&A pair
        const entries = []
        for (const meta of allMeta) {
          const conv = await loadConversation(meta.id)
          if (!conv) continue
          const msgs = conv.messages.filter(m => !m.error)
          for (let i = 0; i < msgs.length; i++) {
            const msg = msgs[i]
            if (msg.role !== 'assistant') continue
            if (getEffectiveFeedback(msg) !== filter) continue
            const userMsg = [...msgs.slice(0, i)].reverse().find(m => m.role === 'user')
            entries.push({
              convId:           conv.id,
              convTitle:        conv.title,
              userMessage:      userMsg
                ? processMessage(userMsg, conv.id, imgDirAbs, imgDirRel, pending)
                : null,
              assistantMessage: processMessage(msg, conv.id, imgDirAbs, imgDirRel, pending),
            })
          }
        }
        output = { exportedAt: new Date().toISOString(), filter, entries }
      }

      await flushPendingFiles(imgDirAbs, pending)
      await writeTextFile(savePath, JSON.stringify(output, null, 2))
    } catch (e: unknown) {
      exportError.value = e instanceof Error ? e.message : String(e)
    } finally {
      exporting.value = false
    }
  }

  return { exportChat, exporting, exportError }
}
