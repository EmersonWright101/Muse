<script setup lang="ts">
import {
  ref, computed, watch, nextTick, onMounted,
} from 'vue'
import {
  Send, Square, Paperclip, MessageSquare, X, FileText,
} from 'lucide-vue-next'
import { useChatStore }      from '../../stores/chat'
import MessageItem           from './components/MessageItem.vue'
import ModelSelector         from './components/ModelSelector.vue'
import type { AttachmentMeta } from '../../stores/chat'
import { processPdfFile }    from '../../utils/pdf'

const chat = useChatStore()

// ─── Input state ──────────────────────────────────────────────────────────────

const inputText      = ref('')
const pendingImages  = ref<AttachmentMeta[]>([])
const messagesEl     = ref<HTMLElement>()
const textareaEl     = ref<HTMLTextAreaElement>()
let _compositionEndedAt = 0

function onCompositionStart() { _compositionEndedAt = 0 }
function onCompositionEnd()   { _compositionEndedAt = Date.now() }

function isIMEActive() {
  return Date.now() - _compositionEndedAt < 100
}

// ─── Computed ─────────────────────────────────────────────────────────────────

const hasConv    = computed(() => !!chat.activeConv)
const messages   = computed(() => chat.activeConv?.messages ?? [])
const canSend    = computed(() => (inputText.value.trim() || pendingImages.value.length > 0) && !chat.isStreaming)

// ─── Auto-scroll ─────────────────────────────────────────────────────────────

function scrollToBottom(force = false) {
  nextTick(() => {
    const el = messagesEl.value
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (force || atBottom) el.scrollTop = el.scrollHeight
  })
}

watch(() => messages.value.length, () => scrollToBottom())
watch(() => chat.streamingText, () => scrollToBottom(true))

onMounted(() => scrollToBottom(true))

// ─── Auto-resize textarea ────────────────────────────────────────────────────

function adjustHeight() {
  nextTick(() => {
    const el = textareaEl.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  })
}

watch(inputText, adjustHeight)

// ─── Send ─────────────────────────────────────────────────────────────────────

async function send() {
  if (!canSend.value) return
  const text   = inputText.value.trim()
  const images = [...pendingImages.value]
  inputText.value     = ''
  pendingImages.value = []
  await nextTick()
  adjustHeight()
  await chat.sendMessage(text, images.length ? images : undefined)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !isIMEActive()) {
    e.preventDefault()
    send()
  }
}

// ─── Image / PDF paste ───────────────────────────────────────────────────────

async function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const blob = item.getAsFile()
      if (!blob) continue
      const reader = new FileReader()
      reader.onload = (ev) => {
        const base64 = (ev.target?.result as string).split(',')[1]
        pendingImages.value.push({
          id:       crypto.randomUUID(),
          name:     'image.png',
          mimeType: item.type,
          data:     base64,
        })
      }
      reader.readAsDataURL(blob)
    } else if (item.type === 'application/pdf') {
      e.preventDefault()
      const file = item.getAsFile()
      if (!file) continue
      pdfLoading.value = true
      try {
        const meta = await processPdfFile(file)
        pendingImages.value.push({
          id:            crypto.randomUUID(),
          name:          file.name || 'document.pdf',
          mimeType:      'application/pdf',
          data:          meta.base64,
          size:          file.size,
          extractedText: meta.extractedText,
          pageCount:     meta.pageCount,
        })
      } catch {
        const reader = new FileReader()
        reader.onload = (ev) => {
          const base64 = (ev.target?.result as string).split(',')[1]
          pendingImages.value.push({
            id:       crypto.randomUUID(),
            name:     file.name || 'document.pdf',
            mimeType: 'application/pdf',
            data:     base64,
            size:     file.size,
          })
        }
        reader.readAsDataURL(file)
      } finally {
        pdfLoading.value = false
      }
    }
  }
}

// ─── File picker ─────────────────────────────────────────────────────────────

const fileInput  = ref<HTMLInputElement>()
const pdfLoading = ref(false)

function pickFile() {
  fileInput.value?.click()
}

async function handleFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const base64 = (ev.target?.result as string).split(',')[1]
        pendingImages.value.push({
          id:       crypto.randomUUID(),
          name:     file.name,
          mimeType: file.type,
          data:     base64,
          size:     file.size,
        })
      }
      reader.readAsDataURL(file)
    } else if (file.type === 'application/pdf') {
      pdfLoading.value = true
      try {
        const meta = await processPdfFile(file)
        pendingImages.value.push({
          id:            crypto.randomUUID(),
          name:          file.name,
          mimeType:      'application/pdf',
          data:          meta.base64,
          size:          file.size,
          extractedText: meta.extractedText,
          pageCount:     meta.pageCount,
        })
      } catch {
        // If text extraction fails, still attach the PDF without extracted text
        const reader = new FileReader()
        reader.onload = (ev) => {
          const base64 = (ev.target?.result as string).split(',')[1]
          pendingImages.value.push({
            id:       crypto.randomUUID(),
            name:     file.name,
            mimeType: 'application/pdf',
            data:     base64,
            size:     file.size,
          })
        }
        reader.readAsDataURL(file)
      } finally {
        pdfLoading.value = false
      }
    }
  }
  // Reset so same file can be picked again
  if (fileInput.value) fileInput.value.value = ''
}

function removeImage(id: string) {
  pendingImages.value = pendingImages.value.filter(i => i.id !== id)
}

// ─── New chat ─────────────────────────────────────────────────────────────────

function startNewChat() {
  chat.newConversation()
  nextTick(() => textareaEl.value?.focus())
}
</script>

<template>
  <div class="chat-main">
    <!-- Empty state: no active conversation -->
    <div v-if="!hasConv" class="empty-state">
      <div class="empty-icon">
        <MessageSquare :size="42" />
      </div>
      <h2 class="empty-title">开始新对话</h2>
      <p class="empty-sub">从左侧选择一个对话，或开始一次新的聊天。</p>
      <button class="new-chat-btn" @click="startNewChat()">
        新建对话
      </button>
    </div>

    <!-- Active conversation -->
    <template v-else>
      <!-- Conv title bar -->
      <div class="conv-header">
        <span class="conv-title">{{ chat.activeConv?.title }}</span>
        <span class="conv-model">{{ chat.activeConv?.model }}</span>
      </div>

      <!-- Messages area -->
      <div ref="messagesEl" class="messages-area">
        <div class="messages-inner">
          <!-- Placeholder when no messages -->
          <div v-if="messages.length === 0" class="conv-placeholder">
            <div class="placeholder-logo">
              <div class="logo-mark-sm">M</div>
            </div>
            <p class="placeholder-hint">有什么可以帮您？</p>
          </div>

          <!-- Message list -->
          <MessageItem
            v-for="(msg, i) in messages"
            :key="msg.id"
            :message="msg"
            :streaming="chat.isStreaming && i === messages.length - 1 && msg.role === 'assistant'"
          />
        </div>
      </div>

      <!-- Input area -->
      <div class="input-area">
        <!-- Pending attachment previews -->
        <div v-if="pendingImages.length > 0 || pdfLoading" class="pending-images">
          <!-- PDF loading indicator -->
          <div v-if="pdfLoading" class="pending-pdf-chip loading">
            <FileText :size="14" class="pdf-chip-icon" />
            <span class="pdf-chip-name">正在解析…</span>
          </div>
          <template v-for="att in pendingImages" :key="att.id">
            <!-- Image preview -->
            <div v-if="att.mimeType.startsWith('image/')" class="pending-img-wrap">
              <img :src="`data:${att.mimeType};base64,${att.data}`" class="pending-img" :alt="att.name" />
              <button class="remove-img-btn" @click="removeImage(att.id)"><X :size="10" /></button>
            </div>
            <!-- PDF chip -->
            <div v-else-if="att.mimeType === 'application/pdf'" class="pending-pdf-chip">
              <FileText :size="14" class="pdf-chip-icon" />
              <div class="pdf-chip-info">
                <span class="pdf-chip-name">{{ att.name }}</span>
                <span v-if="att.pageCount" class="pdf-chip-pages">{{ att.pageCount }} 页</span>
              </div>
              <button class="remove-img-btn pdf-remove" @click="removeImage(att.id)"><X :size="10" /></button>
            </div>
          </template>
        </div>

        <!-- Text input -->
        <div class="input-box">
          <textarea
            ref="textareaEl"
            v-model="inputText"
            class="input-textarea"
            placeholder="输入消息… (Enter 发送，Shift+Enter 换行)"
            rows="1"
            @keydown="handleKeydown"
            @compositionstart="onCompositionStart"
            @compositionend="onCompositionEnd"
            @paste="handlePaste"
          />
          <div class="input-actions">
            <button class="tool-btn" title="附加图片或 PDF" @click="pickFile">
              <Paperclip :size="16" />
            </button>
            <button
              v-if="chat.isStreaming"
              class="send-btn stop"
              title="停止生成"
              @click="chat.stopStreaming()"
            >
              <Square :size="15" />
            </button>
            <button
              v-else
              class="send-btn"
              :class="{ disabled: !canSend }"
              title="发送 (Enter)"
              :disabled="!canSend"
              @click="send()"
            >
              <Send :size="15" />
            </button>
          </div>
        </div>

        <!-- Bottom bar: model selector + hint -->
        <div class="bottom-bar">
          <ModelSelector />
          <span class="input-hint">Enter 发送 · Shift+Enter 换行</span>
        </div>
      </div>
    </template>

    <!-- Hidden file input -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*,application/pdf"
      multiple
      class="hidden-file-input"
      @change="handleFileChange"
    />
  </div>
</template>

<style scoped>
.chat-main {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  min-width: 0;
  overflow: hidden;
}

/* ─── Empty state ──────────────────────────────────────────────────────────── */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  padding: 40px;
  color: #8e8e93;
}

.empty-icon { color: #c7c7cc; }

.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0;
}

.empty-sub {
  font-size: 14px;
  color: #8e8e93;
  margin: 0;
  max-width: 300px;
}

.new-chat-btn {
  margin-top: 8px;
  padding: 9px 22px;
  background: #223F79;
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.12s;
}

.new-chat-btn:hover { opacity: 0.88; }

/* ─── Conversation header ──────────────────────────────────────────────────── */
.conv-header {
  height: 46px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.conv-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.conv-model {
  font-size: 11px;
  color: #8e8e93;
  flex-shrink: 0;
  margin-left: 12px;
}

/* ─── Messages ─────────────────────────────────────────────────────────────── */
.messages-area {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.messages-area::-webkit-scrollbar { width: 4px; }
.messages-area::-webkit-scrollbar-track { background: transparent; }
.messages-area::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.10); border-radius: 2px; }

.messages-inner {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 24px 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 100%;
}

.conv-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  flex: 1;
  padding: 60px 0;
}

.placeholder-logo {
  opacity: 0.15;
}

.logo-mark-sm {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: linear-gradient(145deg, #E4983D 0%, #223F79 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 24px;
  font-weight: 700;
}

.placeholder-hint {
  font-size: 18px;
  color: #8e8e93;
  margin: 0;
}

/* ─── Input area ───────────────────────────────────────────────────────────── */
.input-area {
  flex-shrink: 0;
  padding: 12px 24px 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}

.pending-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.pending-img-wrap {
  position: relative;
}

.pending-img {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.10);
}

.remove-img-btn {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: rgba(60, 60, 67, 0.7);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.input-box {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: #f5f5f7;
  border: 1.5px solid rgba(0, 0, 0, 0.09);
  border-radius: 14px;
  padding: 10px 10px 10px 14px;
  transition: border-color 0.15s;
}

.input-box:focus-within {
  border-color: rgba(34, 63, 121, 0.35);
  background: #fafafa;
}

.input-textarea {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  font-size: 14px;
  line-height: 1.55;
  color: #1c1c1e;
  font-family: inherit;
  max-height: 180px;
  overflow-y: auto;
}

.input-textarea::placeholder { color: #aeaeb2; }

.input-textarea::-webkit-scrollbar { width: 3px; }
.input-textarea::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

.input-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.tool-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: #8e8e93;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.tool-btn:hover { background: rgba(0, 0, 0, 0.06); color: #3c3c43; }

.send-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 9px;
  background: #223F79;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity 0.12s, background 0.12s;
  flex-shrink: 0;
}

.send-btn:hover { opacity: 0.85; }
.send-btn.disabled { opacity: 0.35; cursor: not-allowed; }
.send-btn.stop { background: rgba(0, 0, 0, 0.12); color: #3c3c43; }
.send-btn.stop:hover { background: rgba(0, 0, 0, 0.18); opacity: 1; }

.bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding: 0 2px;
}

.input-hint {
  font-size: 11px;
  color: #aeaeb2;
}

.hidden-file-input {
  display: none;
}

/* PDF attachment chip */
.pending-pdf-chip {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px 7px 9px;
  background: rgba(34, 63, 121, 0.07);
  border: 1px solid rgba(34, 63, 121, 0.15);
  border-radius: 10px;
  max-width: 220px;
  position: relative;
}

.pending-pdf-chip.loading {
  opacity: 0.6;
}

.pdf-chip-icon {
  color: #223F79;
  flex-shrink: 0;
}

.pdf-chip-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.pdf-chip-name {
  font-size: 12px;
  font-weight: 500;
  color: #1c1c1e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
}

.pdf-chip-pages {
  font-size: 10px;
  color: #8e8e93;
}

.pdf-remove {
  margin-left: auto;
  flex-shrink: 0;
}
</style>
