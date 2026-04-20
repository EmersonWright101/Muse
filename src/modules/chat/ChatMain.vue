<script setup lang="ts">
import {
  ref, computed, watch, nextTick, onMounted, onUnmounted,
} from 'vue'
import {
  Send, Square, Paperclip, MessageSquare, X, FileText, Eraser, SquarePen, Brain,
} from 'lucide-vue-next'
import { useChatStore }         from '../../stores/chat'
import { useAssistantsStore }   from '../../stores/assistants'
import { useAiSettingsStore }   from '../../stores/aiSettings'
import MessageItem              from './components/MessageItem.vue'
import ModelSelector            from './components/ModelSelector.vue'
import type { AttachmentMeta }  from '../../stores/chat'
import { processPdfFile }       from '../../utils/pdf'

const chat       = useChatStore()
const assistants = useAssistantsStore()
const aiSettings = useAiSettingsStore()

// Providers that accept PDFs natively — skip local text extraction for these
const pdfNative = computed(() => {
  const p = aiSettings.providers.find(pr => pr.id === aiSettings.activeProviderId)
  if (!p) return false
  return p.type === 'anthropic' || p.type === 'google' || p.baseUrl.includes('openrouter.ai')
})

const activeAssistant = computed(() => {
  const id = chat.activeConv?.assistantId
  return id ? assistants.assistants.find(a => a.id === id) : undefined
})

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
  pdfWarning.value    = ''
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
      if (pdfNative.value) {
        // Native PDF provider (OpenRouter / Anthropic / Google) — just read base64, no text extraction needed
        const reader = new FileReader()
        reader.onload = (ev) => {
          const base64 = (ev.target?.result as string).split(',')[1]
          pendingImages.value.push({ id: crypto.randomUUID(), name: file.name || 'document.pdf', mimeType: 'application/pdf', data: base64, size: file.size })
          pdfLoading.value = false
        }
        reader.onerror = () => { pdfLoading.value = false }
        reader.readAsDataURL(file)
      } else {
        try {
          const meta = await processPdfFile(file)
          if (!meta.extractedText) pdfWarning.value = '该 PDF 可能为扫描件，文字无法提取。建议改用 Claude 或 Gemini。'
          pendingImages.value.push({ id: crypto.randomUUID(), name: file.name || 'document.pdf', mimeType: 'application/pdf', data: meta.base64, size: file.size, extractedText: meta.extractedText, pageCount: meta.pageCount })
        } catch {
          pdfWarning.value = 'PDF 解析失败，文字无法提取。建议改用 Claude 或 Gemini。'
          const reader = new FileReader()
          reader.onload = (ev) => {
            const base64 = (ev.target?.result as string).split(',')[1]
            pendingImages.value.push({ id: crypto.randomUUID(), name: file.name || 'document.pdf', mimeType: 'application/pdf', data: base64, size: file.size })
          }
          reader.readAsDataURL(file)
        } finally {
          pdfLoading.value = false
        }
      }
    }
  }
}

// ─── File picker ─────────────────────────────────────────────────────────────

const fileInput  = ref<HTMLInputElement>()
const pdfLoading = ref(false)
const pdfWarning = ref('')

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
      if (pdfNative.value) {
        const reader = new FileReader()
        reader.onload = (ev) => {
          const base64 = (ev.target?.result as string).split(',')[1]
          pendingImages.value.push({ id: crypto.randomUUID(), name: file.name, mimeType: 'application/pdf', data: base64, size: file.size })
          pdfLoading.value = false
        }
        reader.onerror = () => { pdfLoading.value = false }
        reader.readAsDataURL(file)
      } else {
        try {
          const meta = await processPdfFile(file)
          if (!meta.extractedText) pdfWarning.value = '该 PDF 可能为扫描件，文字无法提取。建议改用 Claude 或 Gemini。'
          pendingImages.value.push({ id: crypto.randomUUID(), name: file.name, mimeType: 'application/pdf', data: meta.base64, size: file.size, extractedText: meta.extractedText, pageCount: meta.pageCount })
        } catch {
          pdfWarning.value = 'PDF 解析失败，文字无法提取。建议改用 Claude 或 Gemini。'
          const reader = new FileReader()
          reader.onload = (ev) => {
            const base64 = (ev.target?.result as string).split(',')[1]
            pendingImages.value.push({ id: crypto.randomUUID(), name: file.name, mimeType: 'application/pdf', data: base64, size: file.size })
          }
          reader.readAsDataURL(file)
        } finally {
          pdfLoading.value = false
        }
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

// ─── Reasoning popover ────────────────────────────────────────────────────────

const reasoningOpen = ref(false)
const reasoningRoot = ref<HTMLElement>()

function handleReasoningOutside(e: MouseEvent) {
  if (reasoningRoot.value && !reasoningRoot.value.contains(e.target as Node)) {
    reasoningOpen.value = false
  }
}

onMounted(()  => document.addEventListener('mousedown', handleReasoningOutside))
onUnmounted(() => document.removeEventListener('mousedown', handleReasoningOutside))
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
        <div class="conv-meta">
          <span
            v-if="activeAssistant"
            class="conv-assistant-badge"
            :style="{ background: activeAssistant.color + '22', color: activeAssistant.color, borderColor: activeAssistant.color + '44' }"
          >
            <span class="badge-dot" :style="{ background: activeAssistant.color }" />
            {{ activeAssistant.name }}
          </span>
          <ModelSelector drop-down />
        </div>
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

          <!-- Message list with context divider -->
          <template v-for="(msg, i) in messages" :key="msg.id">
            <MessageItem
              :message="msg"
              :streaming="chat.isStreaming && i === messages.length - 1 && msg.role === 'assistant'"
            />
            <!-- Context cutoff divider appears after the cutoff message -->
            <div v-if="msg.id === chat.activeConv?.contextCutoffMsgId" class="context-divider">
              <div class="context-divider-line" />
              <span class="context-divider-label">以下为发送给 AI 的上下文</span>
              <button class="context-divider-remove" title="取消清除" @click="chat.removeContextCutoff()">
                <X :size="11" />
              </button>
              <div class="context-divider-line" />
            </div>
          </template>
        </div>
      </div>

      <!-- Input area -->
      <div class="input-area">
        <!-- PDF warning -->
        <div v-if="pdfWarning" class="pdf-warning">{{ pdfWarning }}</div>

        <!-- Unified input box -->
        <div class="input-box">
          <!-- Attachment previews — only rendered when there are attachments -->
          <div v-if="pendingImages.length > 0 || pdfLoading" class="pending-images">
            <div v-if="pdfLoading" class="pending-pdf-chip loading">
              <FileText :size="14" class="pdf-chip-icon" />
              <span class="pdf-chip-name">正在解析…</span>
            </div>
            <template v-for="att in pendingImages" :key="att.id">
              <div v-if="att.mimeType.startsWith('image/')" class="pending-img-wrap">
                <img :src="`data:${att.mimeType};base64,${att.data}`" class="pending-img" :alt="att.name" />
                <button class="remove-img-btn" @click="removeImage(att.id)"><X :size="10" /></button>
              </div>
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

          <!-- Textarea -->
          <textarea
            ref="textareaEl"
            v-model="inputText"
            class="input-textarea"
            placeholder="输入消息…"
            rows="1"
            @keydown="handleKeydown"
            @compositionstart="onCompositionStart"
            @compositionend="onCompositionEnd"
            @paste="handlePaste"
          />

          <!-- Bottom toolbar -->
          <div class="input-toolbar">
            <button class="toolbar-btn" title="新建对话" @click="startNewChat()">
              <SquarePen :size="15" />
            </button>
            <button class="toolbar-btn" title="附加图片或 PDF" @click="pickFile">
              <Paperclip :size="15" />
            </button>
            <!-- Reasoning picker -->
            <div ref="reasoningRoot" class="reasoning-picker">
              <button
                class="toolbar-btn"
                :class="{ 'toolbar-btn-active': chat.useReasoning }"
                title="推理设置"
                @click="reasoningOpen = !reasoningOpen"
              >
                <Brain :size="15" />
              </button>
              <Transition name="reasoning-drop">
                <div v-if="reasoningOpen" class="reasoning-popover">
                  <div class="reasoning-row">
                    <span class="reasoning-label">推理模式</span>
                    <button
                      class="reasoning-toggle-btn"
                      :class="{ on: chat.useReasoning }"
                      @click="chat.setReasoning(!chat.useReasoning)"
                    >
                      <span class="toggle-knob" />
                    </button>
                  </div>
                  <div v-if="chat.useReasoning" class="reasoning-levels">
                    <button
                      v-for="lv in (['low', 'medium', 'high'] as const)"
                      :key="lv"
                      class="level-btn"
                      :class="{ active: chat.reasoningLevel === lv }"
                      @click="chat.setReasoningLevel(lv)"
                    >
                      {{ lv === 'low' ? '低' : lv === 'medium' ? '中' : '高' }}
                    </button>
                  </div>
                </div>
              </Transition>
            </div>
            <button
              class="toolbar-btn"
              :class="{ 'toolbar-btn-active': !!chat.activeConv?.contextCutoffMsgId }"
              title="清除上下文（不删除记录，仅减少发送给 AI 的历史）"
              @click="chat.clearContext()"
            >
              <Eraser :size="15" />
            </button>
            <span class="toolbar-spacer" />
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
              :class="{ active: canSend }"
              title="发送 (Enter)"
              :disabled="!canSend"
              @click="send()"
            >
              <Send :size="15" />
            </button>
          </div>
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
.pdf-warning {
  font-size: 12px;
  color: #b45309;
  background: #fef3c7;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 6px 10px;
  margin: 0 0 6px;
}

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

.conv-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: 12px;
}

.conv-assistant-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px;
  border-radius: 5px;
  border: 1px solid;
  font-size: 11px;
  font-weight: 500;
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
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
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}

.pending-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0 10px;
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
  flex-direction: column;
  background: #f5f5f7;
  border: 1.5px solid rgba(0, 0, 0, 0.09);
  border-radius: 14px;
  padding: 12px 12px 8px 14px;
  transition: border-color 0.15s;
}

.input-box:focus-within {
  border-color: rgba(34, 63, 121, 0.35);
  background: #fafafa;
}

.input-textarea {
  width: 100%;
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
  box-sizing: border-box;
}

.input-textarea::placeholder { color: #aeaeb2; }

.input-textarea::-webkit-scrollbar { width: 3px; }
.input-textarea::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

.input-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 8px;
}

.toolbar-spacer { flex: 1; }

.toolbar-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #8e8e93;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
}

.toolbar-btn:hover { background: rgba(0, 0, 0, 0.06); color: #3c3c43; }
.toolbar-btn-active { color: #223F79 !important; background: rgba(34, 63, 121, 0.08) !important; }

.send-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.10);
  color: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: not-allowed;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.send-btn.active {
  background: #22c55e;
  color: white;
  cursor: pointer;
}

.send-btn.active:hover { background: #16a34a; }

.send-btn.stop {
  background: rgba(0, 0, 0, 0.12);
  color: #3c3c43;
  cursor: pointer;
}

.send-btn.stop:hover { background: rgba(0, 0, 0, 0.18); }

/* ─── Context divider ──────────────────────────────────────────────────────── */
.context-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  user-select: none;
}

.context-divider-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(34, 63, 121, 0.25), transparent);
}

.context-divider-label {
  font-size: 11px;
  color: rgba(34, 63, 121, 0.6);
  white-space: nowrap;
  font-weight: 500;
}

.context-divider-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: rgba(34, 63, 121, 0.08);
  color: rgba(34, 63, 121, 0.5);
  border-radius: 50%;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}

.context-divider-remove:hover {
  background: rgba(34, 63, 121, 0.16);
  color: rgba(34, 63, 121, 0.8);
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

/* ─── Reasoning popover ─────────────────────────────────────────────────────── */
.reasoning-picker {
  position: relative;
}

.reasoning-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  min-width: 168px;
  background: rgba(250, 250, 252, 0.97);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  padding: 10px;
  z-index: 100;
}

.reasoning-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.reasoning-label {
  font-size: 12px;
  font-weight: 500;
  color: #1c1c1e;
}

.reasoning-toggle-btn {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  border: none;
  background: rgba(0, 0, 0, 0.15);
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
  padding: 0;
  flex-shrink: 0;
}

.reasoning-toggle-btn.on { background: #22c55e; }

.toggle-knob {
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  top: 2px;
  left: 2px;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.reasoning-toggle-btn.on .toggle-knob { transform: translateX(16px); }

.reasoning-levels {
  display: flex;
  gap: 4px;
  margin-top: 8px;
}

.level-btn {
  flex: 1;
  padding: 4px 0;
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  color: #3c3c43;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.level-btn:hover { background: rgba(0, 0, 0, 0.05); }

.level-btn.active {
  background: rgba(34, 63, 121, 0.10);
  border-color: rgba(34, 63, 121, 0.30);
  color: #223F79;
  font-weight: 500;
}

.reasoning-drop-enter-active, .reasoning-drop-leave-active {
  transition: opacity 0.12s, transform 0.12s;
}
.reasoning-drop-enter-from, .reasoning-drop-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
