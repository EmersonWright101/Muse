<script setup lang="ts">
import {
  ref, computed, watch, nextTick, onMounted,
} from 'vue'
import {
  Send, Square, MessageSquare, SquarePen, Eraser, X,
  BookOpen, ExternalLink, FileText, Cpu, ChevronDown, ChevronUp, ChevronLeft,
} from 'lucide-vue-next'
import { useAssistantStore } from '../../stores/assistant'
import { usePapersStore } from '../../stores/papers'
import type { Paper } from '../../stores/papers'
import MessageItem from '../chat/components/MessageItem.vue'

const assistant = useAssistantStore()
const papers    = usePapersStore()

// Load papers when papers view is shown
watch(() => assistant.papersViewMode, async (mode) => {
  if (mode === 'papers' && papers.isConfigured) {
    if (papers.sources.length === 0) await papers.fetchSources()
    if (papers.pushPapers.length === 0) {
      await papers.fetchPushPapers()
      await papers.fetchStats()
      await papers.fetchScheduler()
    }
  }
}, { immediate: true })

// Scroll to active paper when sidebar selects one
watch(() => assistant.activePaperId, (id) => {
  if (!id || assistant.papersViewMode !== 'papers') return
  nextTick(() => {
    const el = document.getElementById(`paper-${id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
})

// ─── Input state ──────────────────────────────────────────────────────────────

const inputText  = ref('')
const messagesEl = ref<HTMLElement>()
const textareaEl = ref<HTMLTextAreaElement>()
let _compositionEndedAt = 0

function onCompositionStart() { _compositionEndedAt = 0 }
function onCompositionEnd()   { _compositionEndedAt = Date.now() }
function isIMEActive()        { return Date.now() - _compositionEndedAt < 100 }

// ─── Computed ─────────────────────────────────────────────────────────────────

const activePaper = computed(() =>
  assistant.activePaperId
    ? papers.pushPapers.find(p => p.id === assistant.activePaperId) ?? null
    : null,
)

const hasConv  = computed(() => !!assistant.activeConv)
const messages = computed(() => assistant.activeConv?.messages ?? [])
const canSend  = computed(() => inputText.value.trim().length > 0 && !assistant.isStreaming)

// ─── Auto-scroll ──────────────────────────────────────────────────────────────

function scrollToBottom(force = false) {
  nextTick(() => {
    const el = messagesEl.value
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (force || atBottom) el.scrollTop = el.scrollHeight
  })
}

watch(() => messages.value.length, () => scrollToBottom(true))
watch(() => assistant.streamingText,  () => scrollToBottom())

onMounted(() => scrollToBottom(true))

// ─── Auto-resize textarea ─────────────────────────────────────────────────────

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
  const text = inputText.value.trim()
  inputText.value = ''
  await nextTick()
  adjustHeight()
  await assistant.sendMessage(text)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !isIMEActive()) {
    e.preventDefault()
    send()
  }
}

// ─── New chat ─────────────────────────────────────────────────────────────────

function startNewChat() {
  assistant.newConversation()
  nextTick(() => textareaEl.value?.focus())
}

// ─── ArXiv channel ────────────────────────────────────────────────────────────

const papersFeedEl = ref<HTMLElement>()

// Expanded cards (to show full abstract / contributions)
const expandedCards = ref<Set<string>>(new Set())

function toggleExpand(id: string) {
  const s = new Set(expandedCards.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expandedCards.value = s
}

function scoreColor(score: number | null): string {
  if (score === null) return '#aeaeb2'
  if (score >= 8) return '#34c759'
  if (score >= 5) return '#ff9500'
  return '#ff3b30'
}

function scoreBg(score: number | null): string {
  if (score === null) return 'rgba(0,0,0,0.05)'
  if (score >= 8) return 'rgba(52,199,89,0.10)'
  if (score >= 5) return 'rgba(255,149,0,0.10)'
  return 'rgba(255,59,48,0.10)'
}

function formatPaperDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' })
}

function authorsDisplay(authors: string[]): string {
  if (authors.length <= 3) return authors.join(', ')
  return authors.slice(0, 2).join(', ') + ` 等 ${authors.length} 人`
}

async function handleAnalyze(paper: Paper) {
  await papers.analyzePaper(paper.id)
}

function sourceDisplayName(source: string): string {
  if (source === 'huggingface') return 'HuggingFace'
  if (source === 'arxiv') return 'ArXiv'
  return source
}

function sourceBadgeStyle(source: string): Record<string, string> {
  if (source === 'huggingface') {
    return { background: 'rgba(255, 188, 0, 0.12)', color: '#7a5700' }
  }
  return { background: 'rgba(34, 63, 121, 0.09)', color: '#223F79' }
}

async function selectSource(source: string | null) {
  papers.selectedSource = source
  await papers.fetchPushPapers()
}


</script>

<template>
  <div class="assistant-main">

    <!-- Floating view toggle -->
    <div class="floating-toggle">
      <button
        class="toggle-btn papers"
        :class="{ active: assistant.papersViewMode === 'papers' }"
        @click="assistant.papersViewMode = 'papers'"
      >
        <BookOpen :size="14" />
        论文推送
      </button>
      <button
        class="toggle-btn chat"
        :class="{ active: assistant.papersViewMode === 'chat' }"
        @click="assistant.papersViewMode = 'chat'"
      >
        <MessageSquare :size="14" />
        智能回答
      </button>
    </div>

    <!-- Papers view -->
    <template v-if="assistant.papersViewMode === 'papers'">
      <!-- Not configured -->
      <div v-if="!papers.isConfigured" class="papers-not-configured">
        <div class="papers-nc-icon"><BookOpen :size="32" /></div>
        <h3 class="papers-nc-title">尚未配置后端</h3>
        <p class="papers-nc-desc">请前往「设置 → 通用 → 后端服务器配置」填写服务地址和 API Key，然后在「设置 → 私人助手」配置爬取参数。</p>
      </div>

      <!-- Paper detail view -->
      <div v-else-if="activePaper" class="paper-detail">
        <div class="detail-topbar">
          <button class="detail-back-btn" @click="assistant.activePaperId = null">
            <ChevronLeft :size="15" />
            论文列表
          </button>
          <div class="detail-topbar-actions">
            <button
              v-if="!activePaper.analyzed"
              class="paper-btn analyze"
              :disabled="papers.analyzingIds.has(activePaper.id)"
              @click="handleAnalyze(activePaper)"
            >
              <span v-if="papers.analyzingIds.has(activePaper.id)" class="btn-spin" />
              <Cpu v-else :size="11" />
              {{ papers.analyzingIds.has(activePaper.id) ? 'AI 分析中…' : 'AI 分析' }}
            </button>
            <span v-else class="paper-analyzed-badge">✓ 已分析</span>
            <a :href="activePaper.source_url" target="_blank" class="paper-btn link">
              <ExternalLink :size="11" />
              原文
            </a>
            <a :href="activePaper.pdf_url" target="_blank" class="paper-btn pdf">
              <FileText :size="11" />
              PDF
            </a>
            <button
              v-if="!activePaper.pdf_downloaded"
              class="paper-btn pdf"
              @click="papers.downloadPdf(activePaper.id)"
            >下载 PDF</button>
            <button
              v-else
              class="paper-btn pdf active"
              @click="papers.openPdf(activePaper.id)"
            >查看 PDF</button>
          </div>
        </div>

        <div class="detail-scroll">
          <!-- Badges row -->
          <div class="detail-badges">
            <span
              v-if="activePaper.relevance_score !== null"
              class="paper-score"
              :style="{ color: scoreColor(activePaper.relevance_score), background: scoreBg(activePaper.relevance_score) }"
            >{{ activePaper.relevance_score.toFixed(1) }}</span>
            <span v-if="activePaper.source" class="paper-source-badge" :style="sourceBadgeStyle(activePaper.source)">
              {{ sourceDisplayName(activePaper.source) }}
            </span>
            <span
              v-for="cat in activePaper.categories"
              :key="cat"
              class="detail-cat-badge"
            >{{ cat }}</span>
          </div>

          <!-- Title -->
          <h1 class="detail-title">{{ activePaper.title }}</h1>

          <!-- Authors -->
          <div class="detail-authors">{{ activePaper.authors.join(', ') }}</div>

          <!-- Dates -->
          <div class="detail-dates">
            <span>发表 {{ formatPaperDate(activePaper.published_at) }}</span>
            <template v-if="activePaper.updated_at_source">
              <span class="detail-date-sep">·</span>
              <span>更新 {{ formatPaperDate(activePaper.updated_at_source) }}</span>
            </template>
          </div>

          <!-- AI Summary -->
          <div v-if="activePaper.analyzed && activePaper.ai_summary" class="detail-section">
            <div class="detail-section-label">AI 摘要</div>
            <div class="detail-ai-summary">{{ activePaper.ai_summary }}</div>
          </div>

          <!-- Relevance reason -->
          <div v-if="activePaper.relevance_reason" class="detail-section">
            <div class="detail-section-label">相关原因</div>
            <div class="detail-text">{{ activePaper.relevance_reason }}</div>
          </div>

          <!-- Key contributions -->
          <div v-if="activePaper.key_contributions?.length" class="detail-section">
            <div class="detail-section-label">关键贡献</div>
            <ul class="detail-contributions">
              <li v-for="(k, i) in activePaper.key_contributions" :key="i">{{ k }}</li>
            </ul>
          </div>

          <!-- Abstract -->
          <div class="detail-section">
            <div class="detail-section-label">摘要 (Abstract)</div>
            <div class="detail-abstract">{{ activePaper.abstract }}</div>
          </div>

          <!-- Comment / Journal / DOI -->
          <div
            v-if="activePaper.comment || activePaper.journal_ref || activePaper.doi"
            class="detail-section detail-meta-block"
          >
            <div v-if="activePaper.comment" class="detail-meta-row">
              <span class="detail-meta-key">Comment</span>
              <span class="detail-meta-val">{{ activePaper.comment }}</span>
            </div>
            <div v-if="activePaper.journal_ref" class="detail-meta-row">
              <span class="detail-meta-key">Journal</span>
              <span class="detail-meta-val">{{ activePaper.journal_ref }}</span>
            </div>
            <div v-if="activePaper.doi" class="detail-meta-row">
              <span class="detail-meta-key">DOI</span>
              <span class="detail-meta-val">{{ activePaper.doi }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Feed -->
      <div v-else ref="papersFeedEl" class="papers-feed">
        <!-- Loading -->
        <div v-if="papers.isFetchingPush" class="papers-loading">
          <div class="papers-loading-dot" />
          <div class="papers-loading-dot" style="animation-delay:0.2s" />
          <div class="papers-loading-dot" style="animation-delay:0.4s" />
        </div>

        <!-- Error -->
        <div v-else-if="papers.pushError" class="papers-error">
          {{ papers.pushError }}
        </div>

        <!-- Empty -->
        <div v-else-if="papers.pushPapers.length === 0" class="papers-empty">
          <BookOpen :size="36" />
          <p>{{ papers.pushDate }} 暂无论文</p>
          <p class="papers-empty-hint">可点击右上角「爬取」按钮拉取最新论文</p>
        </div>

        <!-- Papers -->
        <template v-else>
          <div class="papers-feed-meta">
            共 <strong>{{ papers.pushTotal }}</strong> 篇 &nbsp;·&nbsp;
            <template v-if="papers.stats">
              已分析 <strong>{{ papers.stats.analyzed_papers }}</strong> 篇
            </template>
          </div>

          <!-- Source filter tabs -->
          <div v-if="papers.sources.length > 0" class="papers-source-tabs">
            <button
              class="papers-source-tab"
              :class="{ active: papers.selectedSource === null }"
              @click="selectSource(null)"
            >全部</button>
            <button
              v-for="s in papers.sources"
              :key="s.source"
              class="papers-source-tab"
              :class="{ active: papers.selectedSource === s.source }"
              @click="selectSource(s.source)"
            >
              {{ sourceDisplayName(s.source) }}
              <span class="papers-source-count">{{ s.total }}</span>
            </button>
          </div>

          <div class="papers-messages">
            <!-- Bot avatar header (WeChat-style once) -->
            <div class="papers-bot-row">
              <div class="papers-bot-avatar">AI</div>
              <div class="papers-bot-label">论文推送 · {{ papers.pushDate }}</div>
            </div>

            <!-- Paper cards as bot messages -->
            <div
              v-for="paper in papers.pushPapers"
              :key="paper.id"
              :id="'paper-' + paper.id"
              class="papers-paper-card"
              :class="{ expanded: expandedCards.has(paper.id), active: assistant.activePaperId === paper.id }"
            >
              <!-- Card header: score + title + category -->
              <div class="paper-card-header">
                <span
                  v-if="paper.relevance_score !== null"
                  class="paper-score"
                  :style="{ color: scoreColor(paper.relevance_score), background: scoreBg(paper.relevance_score) }"
                >{{ paper.relevance_score.toFixed(1) }}</span>
                <span v-else class="paper-score unscored">—</span>
                <span class="paper-category">{{ paper.primary_category }}</span>
                <span
                  v-if="paper.source"
                  class="paper-source-badge"
                  :style="sourceBadgeStyle(paper.source)"
                >{{ sourceDisplayName(paper.source) }}</span>
                <span class="paper-date">{{ formatPaperDate(paper.published_at) }}</span>
              </div>

              <!-- Title -->
              <div class="paper-title">{{ paper.title }}</div>

              <!-- Authors -->
              <div class="paper-authors">{{ authorsDisplay(paper.authors) }}</div>

              <!-- AI Summary or Abstract -->
              <div v-if="paper.analyzed && paper.ai_summary" class="paper-summary">
                <span class="paper-summary-label">AI 摘要</span>
                {{ paper.ai_summary }}
              </div>
              <div v-else-if="expandedCards.has(paper.id) || !paper.analyzed" class="paper-abstract">
                {{ expandedCards.has(paper.id) ? paper.abstract : paper.abstract.slice(0, 160) + (paper.abstract.length > 160 ? '…' : '') }}
              </div>

              <!-- Relevance reason -->
              <div v-if="paper.relevance_reason" class="paper-reason">
                <span class="paper-reason-label">相关原因：</span>{{ paper.relevance_reason }}
              </div>

              <!-- Key contributions -->
              <ul v-if="paper.key_contributions?.length" class="paper-contributions">
                <li v-for="(k, i) in paper.key_contributions" :key="i">{{ k }}</li>
              </ul>

              <!-- Expand toggle -->
              <button
                v-if="paper.abstract.length > 160 && !(paper.analyzed && paper.ai_summary)"
                class="paper-expand-btn"
                @click="toggleExpand(paper.id)"
              >
                <component :is="expandedCards.has(paper.id) ? ChevronUp : ChevronDown" :size="11" />
                {{ expandedCards.has(paper.id) ? '收起' : '展开摘要' }}
              </button>

              <!-- Actions -->
              <div class="paper-actions">
                <button
                  v-if="!paper.analyzed"
                  class="paper-btn analyze"
                  :disabled="papers.analyzingIds.has(paper.id)"
                  @click="handleAnalyze(paper)"
                >
                  <span v-if="papers.analyzingIds.has(paper.id)" class="btn-spin" />
                  <Cpu v-else :size="11" />
                  {{ papers.analyzingIds.has(paper.id) ? 'AI 分析中…' : 'AI 分析' }}
                </button>
                <span v-else class="paper-analyzed-badge">✓ 已分析</span>

                <a :href="paper.source_url" target="_blank" class="paper-btn link">
                  <ExternalLink :size="11" />
                  原文
                </a>

                <button
                  v-if="!paper.pdf_downloaded"
                  class="paper-btn pdf"
                  @click="papers.downloadPdf(paper.id)"
                >
                  <FileText :size="11" />
                  下载 PDF
                </button>
                <button
                  v-else
                  class="paper-btn pdf active"
                  @click="papers.openPdf(paper.id)"
                >
                  <FileText :size="11" />
                  查看 PDF
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- Chat view -->
    <template v-else>
      <!-- Empty state: no active conversation -->
      <div v-if="!hasConv" class="empty-state">
        <div class="empty-icon">
          <MessageSquare :size="42" />
        </div>
        <h2 class="empty-title">私人助手</h2>
        <p class="empty-sub">从左侧选择一个对话，或开始一次新的聊天。</p>
        <button class="new-chat-btn" @click="startNewChat()">新建对话</button>
      </div>

      <!-- Active conversation -->
      <template v-else>
        <!-- Messages area -->
        <div ref="messagesEl" class="messages-area">
          <div class="messages-inner">
            <div v-if="messages.length === 0" class="conv-placeholder">
              <div class="placeholder-logo">
                <div class="logo-mark-sm">M</div>
              </div>
              <p class="placeholder-hint">有什么可以帮您？</p>
            </div>

            <template v-for="(msg, i) in messages" :key="msg.id">
              <MessageItem
                :message="({ ...msg, timestamp: msg.createdAt } as any)"
                :streaming="assistant.isStreaming && i === messages.length - 1 && msg.role === 'assistant'"
              />
              <div v-if="msg.id === assistant.activeConv?.contextCutoffMsgId" class="context-divider">
                <div class="context-divider-line" />
                <span class="context-divider-label">以下为发送给 AI 的上下文</span>
                <button class="context-divider-remove" title="取消清除" @click="assistant.removeContextCutoff()">
                  <X :size="11" />
                </button>
                <div class="context-divider-line" />
              </div>
            </template>
          </div>
        </div>

        <!-- Input area -->
        <div class="input-area">
          <div class="input-box">
            <textarea
              ref="textareaEl"
              v-model="inputText"
              class="input-textarea"
              placeholder="输入消息…"
              rows="1"
              @keydown="handleKeydown"
              @compositionstart="onCompositionStart"
              @compositionend="onCompositionEnd"
            />
            <div class="input-toolbar">
              <button class="toolbar-btn" title="新建对话" @click="startNewChat()">
                <SquarePen :size="15" />
              </button>
              <button
                class="toolbar-btn"
                :class="{ 'toolbar-btn-active': !!assistant.activeConv?.contextCutoffMsgId }"
                title="清除上下文（不删除记录，仅减少发送给 AI 的历史）"
                @click="assistant.clearContext()"
              >
                <Eraser :size="15" />
              </button>
              <span class="toolbar-spacer" />
              <button
                v-if="assistant.isStreaming"
                class="send-btn stop"
                title="停止生成"
                @click="assistant.stopStreaming()"
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
    </template>

    <!-- Toast notification -->
    <Transition name="papers-toast">
      <div v-if="papers.toast" class="papers-toast" :class="papers.toast.type">
        {{ papers.toast.msg }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.assistant-main {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

/* ── Floating toggle (like Travel) ──────────────────────────────────────────── */

.floating-toggle {
  position: fixed;
  top: 56px;
  left: calc(50% + 38px);
  transform: translateX(-50%);
  z-index: 900;
  display: flex;
  gap: 2px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border-radius: 8px;
  padding: 3px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.10), 0 0 0 0.5px rgba(0, 0, 0, 0.06) inset;
}

.floating-toggle .toggle-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  color: #8e8e93;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s;
  font-weight: 500;
}

.floating-toggle .toggle-btn.papers.active {
  background: rgba(228, 152, 61, 0.12);
  color: #c47a2a;
  box-shadow: 0 1px 3px rgba(228, 152, 61, 0.15);
}

.floating-toggle .toggle-btn.chat.active {
  background: rgba(34, 63, 121, 0.10);
  color: #223F79;
  box-shadow: 0 1px 3px rgba(34, 63, 121, 0.12);
}

/* ── ArXiv chat placeholder ─────────────────────────────────────────────────── */

/* ── Empty state ─────────────────────────────────────────────────────────────── */

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

/* ── Header ──────────────────────────────────────────────────────────────────── */

.conv-header {
  height: 46px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

/* ── Not configured state ──────────────────────────────────────────────────── */

.papers-not-configured {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  text-align: center;
  color: #8e8e93;
}

.papers-nc-icon { color: #c7c7cc; }

.papers-nc-title {
  font-size: 16px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0;
}

.papers-nc-desc {
  font-size: 13px;
  color: #8e8e93;
  margin: 0;
  max-width: 360px;
  line-height: 1.6;
}

/* ── Feed ────────────────────────────────────────────────────────────────────── */

.papers-feed {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 0;
  position: relative;
}

.papers-feed::-webkit-scrollbar { width: 4px; }
.papers-feed::-webkit-scrollbar-track { background: transparent; }
.papers-feed::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.10); border-radius: 2px; }

/* Loading dots */
.papers-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 48px 0;
  flex: 1;
}

.papers-loading-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #E4983D;
  animation: papers-pulse 1.2s ease-in-out infinite;
}

@keyframes papers-pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.7); }
  50%       { opacity: 1;   transform: scale(1); }
}

/* Error / empty */
.papers-error {
  padding: 32px;
  text-align: center;
  font-size: 13px;
  color: #ff3b30;
  background: rgba(255, 59, 48, 0.06);
  border-radius: 12px;
}

.papers-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  padding: 48px 0;
  color: #aeaeb2;
  text-align: center;
}

.papers-empty p { margin: 0; font-size: 14px; }
.papers-empty-hint { font-size: 12px !important; color: #c7c7cc !important; }

/* Meta bar */
.papers-feed-meta {
  font-size: 12px;
  color: #8e8e93;
  margin-bottom: 16px;
}

.papers-feed-meta strong { color: #3c3c43; }

/* Messages layout */
.papers-messages {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 780px;
}

.papers-bot-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.papers-bot-avatar {
  width: 28px; height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, #E4983D, #c47a2a);
  display: flex; align-items: center; justify-content: center;
  color: white;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.papers-bot-label {
  font-size: 12px;
  font-weight: 600;
  color: #8e8e93;
}

/* ── Paper detail view ───────────────────────────────────────────────────────── */

.paper-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.detail-topbar {
  height: 48px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
  gap: 12px;
}

.detail-back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: #8e8e93;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 7px;
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
}
.detail-back-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }

.detail-topbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.detail-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px 40px;
  max-width: 760px;
}

.detail-scroll::-webkit-scrollbar { width: 4px; }
.detail-scroll::-webkit-scrollbar-track { background: transparent; }
.detail-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

.detail-badges {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}

.detail-cat-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 5px;
  background: rgba(0,0,0,0.05);
  color: #6e6e73;
}

.detail-title {
  font-size: 19px;
  font-weight: 700;
  color: #1c1c1e;
  line-height: 1.35;
  margin: 0 0 10px;
}

.detail-authors {
  font-size: 12.5px;
  color: #6e6e73;
  line-height: 1.55;
  margin-bottom: 6px;
}

.detail-dates {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: #aeaeb2;
  margin-bottom: 22px;
}

.detail-date-sep { color: #d1d1d6; }

.detail-section {
  margin-bottom: 20px;
}

.detail-section-label {
  font-size: 10.5px;
  font-weight: 700;
  color: #aeaeb2;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 7px;
}

.detail-ai-summary {
  font-size: 13px;
  color: #3c3c43;
  line-height: 1.65;
  background: rgba(34, 63, 121, 0.04);
  border-left: 2.5px solid rgba(34, 63, 121, 0.22);
  padding: 10px 14px;
  border-radius: 0 8px 8px 0;
}

.detail-text {
  font-size: 13px;
  color: #3c3c43;
  line-height: 1.65;
}

.detail-abstract {
  font-size: 13px;
  color: #3c3c43;
  line-height: 1.75;
  white-space: pre-wrap;
}

.detail-contributions {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-contributions li {
  font-size: 13px;
  color: #3c3c43;
  line-height: 1.6;
}

.detail-meta-block {
  background: rgba(0,0,0,0.025);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-meta-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.detail-meta-key {
  font-size: 11px;
  font-weight: 600;
  color: #aeaeb2;
  width: 56px;
  flex-shrink: 0;
  padding-top: 1px;
}

.detail-meta-val {
  font-size: 12.5px;
  color: #3c3c43;
  line-height: 1.55;
}

/* ── Source filter tabs ──────────────────────────────────────────────────────── */

.papers-source-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.papers-source-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 11px;
  border-radius: 20px;
  border: 1.5px solid transparent;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.04);
  color: #6e6e73;
  transition: all 0.12s;
}

.papers-source-tab:hover { background: rgba(0, 0, 0, 0.08); color: #3c3c43; }

.papers-source-tab.active {
  background: rgba(34, 63, 121, 0.10);
  border-color: rgba(34, 63, 121, 0.20);
  color: #223F79;
}

.papers-source-count {
  font-size: 10.5px;
  opacity: 0.65;
}

/* ── Paper card ──────────────────────────────────────────────────────────────── */

.papers-paper-card {
  background: #f9f9fb;
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 14px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: box-shadow 0.15s;
  margin-left: 36px;
}

.papers-paper-card:hover { box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07); }
.papers-paper-card.active {
  box-shadow: 0 0 0 2px rgba(228, 152, 61, 0.35);
  background: rgba(228, 152, 61, 0.03);
}

.paper-card-header {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.paper-score {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  flex-shrink: 0;
  letter-spacing: 0.02em;
}

.paper-score.unscored { color: #aeaeb2; background: rgba(0,0,0,0.04); }

.paper-category {
  font-size: 10.5px;
  font-weight: 600;
  color: #8e8e93;
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 7px;
  border-radius: 5px;
  flex-shrink: 0;
}

.paper-source-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
  letter-spacing: 0.01em;
}

.paper-date {
  font-size: 10.5px;
  color: #aeaeb2;
  margin-left: auto;
}

.paper-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #1c1c1e;
  line-height: 1.4;
}

.paper-authors {
  font-size: 11.5px;
  color: #8e8e93;
}

.paper-summary {
  font-size: 12px;
  color: #3c3c43;
  line-height: 1.6;
  background: rgba(34, 63, 121, 0.04);
  border-left: 2.5px solid rgba(34, 63, 121, 0.2);
  padding: 7px 10px;
  border-radius: 0 6px 6px 0;
}

.paper-summary-label {
  font-size: 10px;
  font-weight: 700;
  color: #223F79;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  display: block;
  margin-bottom: 3px;
}

.paper-abstract {
  font-size: 12px;
  color: #6e6e73;
  line-height: 1.6;
}

.paper-reason {
  font-size: 11.5px;
  color: #8e8e93;
  line-height: 1.5;
}

.paper-reason-label {
  font-weight: 600;
  color: #6e6e73;
}

.paper-contributions {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.paper-contributions li {
  font-size: 12px;
  color: #3c3c43;
  line-height: 1.5;
}

.paper-expand-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: #8e8e93;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  transition: color 0.1s;
}
.paper-expand-btn:hover { color: #3c3c43; }

/* Actions row */
.paper-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 4px;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}

.paper-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 7px;
  border: 1.5px solid transparent;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s;
  text-decoration: none;
  color: inherit;
  background: transparent;
}

.paper-btn.analyze {
  background: rgba(34, 63, 121, 0.07);
  border-color: rgba(34, 63, 121, 0.15);
  color: #223F79;
}
.paper-btn.analyze:hover:not(:disabled) { background: rgba(34, 63, 121, 0.13); }
.paper-btn.analyze:disabled { opacity: 0.6; cursor: not-allowed; }

.paper-btn.link {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.08);
  color: #3c3c43;
}
.paper-btn.link:hover { background: rgba(0, 0, 0, 0.08); }

.paper-btn.pdf {
  background: rgba(255, 149, 0, 0.07);
  border-color: rgba(255, 149, 0, 0.18);
  color: #c47a00;
}
.paper-btn.pdf:hover { background: rgba(255, 149, 0, 0.13); }
.paper-btn.pdf.active {
  background: rgba(52, 199, 89, 0.08);
  border-color: rgba(52, 199, 89, 0.2);
  color: #25a244;
}
.paper-btn.pdf.active:hover { background: rgba(52, 199, 89, 0.14); }

.paper-analyzed-badge {
  font-size: 11px;
  color: #34c759;
  font-weight: 500;
}

.btn-spin {
  display: inline-block;
  width: 10px; height: 10px;
  border: 1.5px solid rgba(34, 63, 121, 0.25);
  border-top-color: #223F79;
  border-radius: 50%;
  animation: papers-rotate 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes papers-rotate { to { transform: rotate(360deg); } }

/* ── Regular conv styles ─────────────────────────────────────────────────────── */

.conv-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  cursor: text;
  border-radius: 4px;
  padding: 2px 4px;
  margin: -2px -4px;
  transition: background 0.1s;
}

.conv-title:hover { background: rgba(0, 0, 0, 0.05); }

.conv-title-input {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  border: 1px solid #223F79;
  border-radius: 4px;
  padding: 1px 6px;
  outline: none;
  background: #fff;
  min-width: 0;
}

.messages-area {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.messages-area::-webkit-scrollbar { width: 4px; }
.messages-area::-webkit-scrollbar-track { background: transparent; }
.messages-area::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.10); border-radius: 2px; }

.messages-inner {
  padding: 24px 20px 0;
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

.placeholder-logo { opacity: 0.15; }

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

.input-area {
  flex-shrink: 0;
  padding: 12px 24px 16px;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
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

.send-btn.active { background: #22c55e; color: white; cursor: pointer; }
.send-btn.active:hover { background: #16a34a; }
.send-btn.stop { background: rgba(0, 0, 0, 0.12); color: #3c3c43; cursor: pointer; }
.send-btn.stop:hover { background: rgba(0, 0, 0, 0.18); }

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

/* ── Toast ───────────────────────────────────────────────────────────────────── */

.papers-toast {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 18px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  z-index: 100;
}

.papers-toast.ok   { background: #1c1c1e; color: white; }
.papers-toast.info { background: #1c1c1e; color: white; }
.papers-toast.err  { background: #ff3b30; color: white; }

.papers-toast-enter-active, .papers-toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.papers-toast-enter-from, .papers-toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

/* ── Spinner ─────────────────────────────────────────────────────────────────── */

.spin { animation: papers-rotate 0.8s linear infinite; }
</style>
