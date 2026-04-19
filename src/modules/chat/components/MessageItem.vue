<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { marked, type Tokens } from 'marked'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import { Copy, Check, Pencil, RefreshCw, FileText } from 'lucide-vue-next'
import type { ChatMessage } from '../../../stores/chat'
import { useChatStore } from '../../../stores/chat'

const props = defineProps<{ message: ChatMessage; streaming?: boolean }>()

const chat = useChatStore()

// ─── Hover + copy + edit ──────────────────────────────────────────────────────

const isHovered = ref(false)
const copyDone  = ref(false)
const isEditing = ref(false)
const editText  = ref('')

async function copyContent() {
  await navigator.clipboard.writeText(props.message.content).catch(() => {})
  copyDone.value = true
  setTimeout(() => { copyDone.value = false }, 2000)
}

function startEdit() {
  editText.value  = props.message.content
  isEditing.value = true
}

async function confirmEdit() {
  if (!editText.value.trim()) return
  isEditing.value = false
  if (props.message.role === 'user') {
    await chat.editAndResend(props.message.id, editText.value)
  } else {
    await chat.editMessage(props.message.id, editText.value)
  }
}

function cancelEdit() {
  isEditing.value = false
}

// ─── Markdown setup ───────────────────────────────────────────────────────────

const renderer = new marked.Renderer()

renderer.code = ({ text, lang }: Tokens.Code) => {
  const validLang = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
  const highlighted = hljs.highlight(text, { language: validLang }).value
  return `<div class="code-block"><div class="code-header"><span class="code-lang">${validLang}</span><button class="copy-btn" onclick="this.closest('.code-block').querySelector('code').dispatchEvent(new CustomEvent('copy-code',{bubbles:true}));this.textContent='已复制';setTimeout(()=>this.textContent='复制',2000)">复制</button></div><pre><code class="hljs ${validLang}">${highlighted}</code></pre></div>`
}

renderer.codespan = ({ text }: Tokens.Codespan) =>
  `<code class="inline-code">${text}</code>`

marked.setOptions({ renderer, breaks: true })

function renderMarkdown(content: string): string {
  try {
    const raw = marked.parse(content) as string
    if (typeof raw !== 'string') return content
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['onclick'] })
  } catch {
    return content
  }
}

// ─── Rendered content: computed directly from props.message.content ───────────
// assistantMsg in the store is reactive(), so content mutations are tracked
// automatically and this computed re-evaluates on every token.

const msgEl = ref<HTMLElement>()

const renderedContent = computed(() =>
  props.message.role === 'user' ? '' : renderMarkdown(props.message.content ?? '')
)

onMounted(() => {
  msgEl.value?.addEventListener('copy-code', (e: Event) => {
    const code = (e.target as HTMLElement).textContent ?? ''
    navigator.clipboard.writeText(code).catch(() => {})
  })
})

// ─── Avatar ───────────────────────────────────────────────────────────────────

const isUser = computed(() => props.message.role === 'user')
</script>

<template>
  <div
    class="message-row"
    :class="{ 'user-row': isUser, 'assistant-row': !isUser }"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- Assistant avatar -->
    <div v-if="!isUser" class="avatar">
      <div class="avatar-mark">M</div>
    </div>

    <!-- Message bubble -->
    <div class="bubble-wrap">
      <!-- Attachments -->
      <div v-if="message.attachments?.length" class="attachments">
        <div v-for="att in message.attachments" :key="att.id">
          <img
            v-if="att.mimeType?.startsWith('image/') && att.data"
            :src="`data:${att.mimeType};base64,${att.data}`"
            class="attachment-img"
            :alt="att.name"
          />
          <div v-else-if="att.mimeType === 'application/pdf'" class="attachment-pdf">
            <FileText :size="15" class="pdf-att-icon" />
            <div class="pdf-att-info">
              <span class="pdf-att-name">{{ att.name }}</span>
              <span v-if="att.pageCount" class="pdf-att-pages">{{ att.pageCount }} 页</span>
            </div>
          </div>
          <div v-else class="attachment-file">
            <span class="file-icon">📎</span>
            <span class="file-name">{{ att.name }}</span>
          </div>
        </div>
      </div>

      <!-- User message: plain text or inline edit -->
      <div v-if="isUser" class="bubble user-bubble">
        <template v-if="isEditing">
          <textarea
            v-model="editText"
            class="edit-textarea"
            rows="3"
            @keydown.enter.exact.prevent="confirmEdit"
            @keydown.esc="cancelEdit"
          />
          <div class="edit-actions">
            <button class="edit-confirm-btn" @click="confirmEdit">发送</button>
            <button class="edit-cancel-btn" @click="cancelEdit">取消</button>
          </div>
        </template>
        <span v-else class="user-text">{{ message.content }}</span>
      </div>

      <!-- Assistant message: rendered markdown or inline edit -->
      <template v-else>
        <template v-if="isEditing">
          <textarea
            v-model="editText"
            class="edit-textarea assistant-edit-textarea"
            rows="6"
            @keydown.esc="cancelEdit"
          />
          <div class="edit-actions">
            <button class="edit-confirm-btn" @click="confirmEdit">保存</button>
            <button class="edit-cancel-btn" @click="cancelEdit">取消</button>
          </div>
        </template>
        <div
          v-else
          ref="msgEl"
          class="bubble assistant-bubble markdown-body"
          :class="{ error: message.error, streaming }"
          v-html="renderedContent"
        />
      </template>

      <!-- Footer: action buttons left, usage stats right -->
      <div v-if="!isEditing" class="msg-footer">
        <div class="msg-actions" :style="{ opacity: isHovered ? 1 : 0 }">
          <button class="action-btn" :class="{ done: copyDone }" title="复制" @click="copyContent">
            <Check v-if="copyDone" :size="13" />
            <Copy v-else :size="13" />
          </button>
          <button v-if="!streaming" class="action-btn" title="编辑" @click="startEdit">
            <Pencil :size="13" />
          </button>
          <button v-if="!isUser && !streaming" class="action-btn" title="重新生成" @click="chat.regenerate(message.id)">
            <RefreshCw :size="13" />
          </button>
        </div>
        <div v-if="!isUser && message.usage && !streaming" class="msg-usage">
          <span v-if="message.usage.inputTokens != null">↑{{ message.usage.inputTokens }}</span>
          <span v-if="message.usage.outputTokens != null">↓{{ message.usage.outputTokens }}</span>
          <span v-if="message.usage.durationMs != null">{{ (message.usage.durationMs / 1000).toFixed(1) }}s</span>
          <span v-if="message.usage.costUsd != null">${{ message.usage.costUsd.toFixed(4) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-row {
  display: flex;
  gap: 12px;
  max-width: 860px;
  margin: 0 auto;
  width: 100%;
  padding: 4px 0;
}

.user-row {
  flex-direction: row-reverse;
}

.assistant-row {
  flex-direction: row;
  align-items: flex-start;
}

.avatar {
  flex-shrink: 0;
  margin-top: 4px;
}

.avatar-mark {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: linear-gradient(145deg, #E4983D 0%, #223F79 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 13px;
  font-weight: 700;
}

.bubble-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.user-row .bubble-wrap {
  align-items: flex-end;
}

.bubble {
  max-width: 100%;
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.65;
  word-break: break-word;
}

.user-bubble {
  background: #223F79;
  color: white;
  border-radius: 16px 4px 16px 16px;
  max-width: 76%;
}

.user-text {
  white-space: pre-wrap;
}

.assistant-bubble {
  background: transparent;
  color: #1c1c1e;
  padding: 4px 0;
  border-radius: 0;
}

.assistant-bubble.error {
  color: #ff3b30;
}

.assistant-bubble.streaming::after {
  content: '▋';
  display: inline-block;
  animation: blink 0.7s step-end infinite;
  color: #223F79;
  margin-left: 2px;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}

.attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-img {
  max-width: 280px;
  max-height: 200px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.attachment-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  font-size: 12px;
}

.file-name {
  color: #3c3c43;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-pdf {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px 7px 10px;
  background: rgba(34, 63, 121, 0.07);
  border: 1px solid rgba(34, 63, 121, 0.14);
  border-radius: 10px;
  max-width: 240px;
}

.pdf-att-icon {
  color: #223F79;
  flex-shrink: 0;
}

.pdf-att-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.pdf-att-name {
  font-size: 12px;
  font-weight: 500;
  color: #1c1c1e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pdf-att-pages {
  font-size: 10px;
  color: #8e8e93;
}

.msg-footer {
  display: flex;
  align-items: center;
  height: 22px;
}

.msg-actions {
  display: flex;
  gap: 2px;
  align-items: center;
  opacity: 0;
  transition: opacity 0.15s;
}


.msg-usage {
  margin-left: auto;
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: #8e8e93;
}

.action-btn {
  width: 24px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #aeaeb2;
  background: none;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
}

.action-btn:hover {
  background: rgba(0, 0, 0, 0.07);
  color: #3c3c43;
}

.action-btn.done {
  color: #34c759;
}

.edit-textarea {
  width: 100%;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  outline: none;
  resize: none;
  font-size: 14px;
  line-height: 1.55;
  color: white;
  font-family: inherit;
  border-radius: 8px;
  padding: 6px 8px;
  box-sizing: border-box;
}

.assistant-edit-textarea {
  background: #f5f5f7;
  color: #1c1c1e;
  border: 1.5px solid rgba(34, 63, 121, 0.25);
}

.edit-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  justify-content: flex-end;
}

.edit-confirm-btn {
  font-size: 12px;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
}

.edit-cancel-btn {
  font-size: 12px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  border: none;
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
}
</style>

<!-- Markdown + code block styles (not scoped so they apply to v-html content) -->
<style>
.markdown-body p { margin: 0 0 10px; }
.markdown-body p:last-child { margin-bottom: 0; }
.markdown-body ul, .markdown-body ol { padding-left: 1.4em; margin: 6px 0; }
.markdown-body li { margin: 2px 0; }
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  margin: 14px 0 6px;
  font-weight: 600;
  line-height: 1.3;
}
.markdown-body h1 { font-size: 1.25em; }
.markdown-body h2 { font-size: 1.1em; }
.markdown-body h3 { font-size: 1em; }
.markdown-body blockquote {
  margin: 8px 0;
  padding: 6px 12px;
  border-left: 3px solid rgba(34, 63, 121, 0.3);
  color: #6e6e73;
  font-style: italic;
}
.markdown-body table {
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 13px;
}
.markdown-body th, .markdown-body td {
  border: 1px solid rgba(0, 0, 0, 0.12);
  padding: 6px 10px;
}
.markdown-body th { background: rgba(0, 0, 0, 0.03); font-weight: 600; }
.markdown-body a { color: #223F79; text-decoration: underline; }
.markdown-body hr { border: none; border-top: 1px solid rgba(0,0,0,0.10); margin: 12px 0; }

/* Inline code */
.inline-code {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 0.88em;
  color: #c7254e;
}

/* Code blocks */
.code-block {
  margin: 10px 0;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.10);
  background: #1e1e2e;
}

.code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.code-lang {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  font-family: 'SF Mono', 'Menlo', monospace;
  text-transform: lowercase;
}

.copy-btn {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.12s, color 0.12s;
}

.copy-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}

.code-block pre {
  margin: 0;
  padding: 14px 16px;
  overflow-x: auto;
  font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.55;
}

.code-block code {
  display: block;
  font-family: inherit;
}

/* highlight.js atom-one-dark-ish */
.hljs { color: #abb2bf; background: transparent; }
.hljs-comment, .hljs-quote { color: #5c6370; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-subst { color: #c678dd; }
.hljs-number, .hljs-literal, .hljs-variable, .hljs-template-variable { color: #d19a66; }
.hljs-string, .hljs-doctag { color: #98c379; }
.hljs-title, .hljs-section, .hljs-selector-id { color: #61aeee; font-weight: bold; }
.hljs-type, .hljs-class .hljs-title { color: #e6c07b; }
.hljs-tag, .hljs-name, .hljs-attribute { color: #e06c75; }
.hljs-regexp, .hljs-link { color: #98c379; }
.hljs-symbol, .hljs-bullet { color: #61aeee; }
.hljs-built_in, .hljs-builtin-name { color: #e06c75; }
.hljs-meta { color: #999; font-weight: bold; }
.hljs-deletion { background: #2d2d2d; }
.hljs-addition { background: #2d2d2d; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }
</style>
