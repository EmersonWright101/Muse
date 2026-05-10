<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Search, BookOpen, Check, BookMarked, Plus, Trash2, X, Settings, Volume2, ChevronDown, Headphones, Play, Pause, RefreshCw, AlertCircle, Square, VolumeX } from 'lucide-vue-next'
import { useEbookStore } from '../../stores/ebook'
import { useAiSettingsStore } from '../../stores/aiSettings'
import { useEbookTtsGenerator } from './composables/useEbookTtsGenerator'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const store = useEbookStore()
const ai    = useAiSettingsStore()

// ─── Filter / search ──────────────────────────────────────────────────────────

const searchQuery = ref('')
const activeFilter = ref<'all' | 'reading' | 'want_to_read' | 'finished'>('all')

const filters = [
  { id: 'all',          labelKey: 'ebook.sidebar.all',        icon: BookOpen },
  { id: 'reading',      labelKey: 'ebook.sidebar.reading',    icon: BookOpen },
  { id: 'want_to_read', labelKey: 'ebook.sidebar.wantToRead', icon: BookMarked },
  { id: 'finished',     labelKey: 'ebook.sidebar.finished',   icon: Check },
]

const filteredBooks = computed(() => {
  let list = store.books
  if (activeFilter.value !== 'all') {
    list = list.filter(b => b.readStatus === activeFilter.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(b =>
      b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
    )
  }
  return [...list].sort((a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt))
})

const stats = computed(() => ({
  total:      store.books.length,
  reading:    store.books.filter(b => b.readStatus === 'reading').length,
  wantToRead: store.books.filter(b => b.readStatus === 'want_to_read').length,
  finished:   store.books.filter(b => b.readStatus === 'finished').length,
}))

// ─── Collections ─────────────────────────────────────────────────────────────

const activeCollectionId = ref<string | null>(null)
const addingCollection   = ref(false)
const newColName         = ref('')

function selectCollection(id: string | null) {
  activeCollectionId.value = id
  activeFilter.value = 'all'
  searchQuery.value = ''
}

const booksInActiveCollection = computed(() => {
  if (!activeCollectionId.value) return null
  return store.books.filter(b => b.collectionIds?.includes(activeCollectionId.value!))
})

function submitNewCollection() {
  const name = newColName.value.trim()
  if (name) store.addCollection(name)
  newColName.value = ''
  addingCollection.value = false
}

function openBook(id: string) {
  store.setActiveBook(id)
}

// Clicking a library filter while reading → close reader and go to that filter
function selectFilter(id: 'all' | 'reading' | 'want_to_read' | 'finished') {
  activeFilter.value = id
  activeCollectionId.value = null
  if (store.activeBookId) store.setActiveBook(null)
}

const activeTheme = computed(() => store.activeBookId ? store.settings.theme : 'light')

const showTts = ref(false)
const ttsSettings = computed(() => store.ttsSettings)

// Providers that have at least one audio-capable model
const audioProviders = computed(() =>
  ai.providers.filter(p => p.enabled && p.models.some(m => m.audio))
)
// Audio models for the currently selected provider
const audioModels = computed(() => {
  const p = ai.providers.find(x => x.id === ttsSettings.value.providerId)
  return p ? p.models.filter(m => m.audio) : []
})

// ─── Voice list fetched from GET /audio/voices ────────────────────────────────

interface ModelVoice { id: string; name: string; language?: string; description?: string; sample?: string }

const fetchedVoices = ref<ModelVoice[]>([])
const voicesFetching = ref(false)
const customVoice = ref(false)  // true when user picks "自定义…"
const playingVoiceId = ref<string | null>(null)
let _sampleAudio: HTMLAudioElement | null = null

async function fetchVoices() {
  const ts = ttsSettings.value
  const provider = ai.providers.find(p => p.id === ts.providerId)
  if (!provider || !ts.modelId) { fetchedVoices.value = []; return }

  voicesFetching.value = true
  try {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    const resp = await tauriFetch(`${provider.baseUrl}/audio/voices?model=${encodeURIComponent(ts.modelId)}`, {
      headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
    })
    if (!resp.ok) throw new Error(String(resp.status))
    const data = await resp.json() as { voices?: ModelVoice[] }
    fetchedVoices.value = data.voices ?? []
  } catch {
    // Fallback to /v1/models voices field
    try {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
      const resp = await tauriFetch(`${provider.baseUrl}/models`, {
        headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
      })
      if (!resp.ok) throw new Error(String(resp.status))
      const data = await resp.json() as {
        data?: Array<{ id: string; supports_audio_output?: boolean; voices?: ModelVoice[] }>
      }
      const entry = data.data?.find(m => m.id === ts.modelId)
      fetchedVoices.value = entry?.voices ?? []
    } catch {
      fetchedVoices.value = []
    }
  } finally {
    voicesFetching.value = false
  }
}

function stopSample() {
  if (_sampleAudio) { _sampleAudio.pause(); _sampleAudio = null }
  playingVoiceId.value = null
}

function playSample(voice: ModelVoice) {
  if (!voice.sample) return
  if (playingVoiceId.value === voice.id) { stopSample(); return }
  stopSample()
  const binary = atob(voice.sample)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
  const audio = new Audio(url)
  _sampleAudio = audio
  playingVoiceId.value = voice.id
  audio.play()
  audio.onended = () => { playingVoiceId.value = null; URL.revokeObjectURL(url); _sampleAudio = null }
}

// Refresh voices when provider or model changes
watch(
  () => [ttsSettings.value.providerId, ttsSettings.value.modelId],
  ([pid, mid]) => { if (pid && mid) { fetchVoices() } else { fetchedVoices.value = [] } },
  { immediate: true },
)

function onSelectVoice(e: Event) {
  const val = (e.target as HTMLSelectElement).value
  if (val === '__custom__') {
    customVoice.value = true
  } else {
    customVoice.value = false
    store.updateTtsSettings({ voice: val })
  }
}

function countForFilter(id: string): number {
  if (id === 'all') return stats.value.total
  if (id === 'reading') return stats.value.reading
  if (id === 'want_to_read') return stats.value.wantToRead
  if (id === 'finished') return stats.value.finished
  return 0
}

const displayBooks = computed(() =>
  activeCollectionId.value ? (booksInActiveCollection.value ?? []) : filteredBooks.value
)

// ─── Audiobook generation ─────────────────────────────────────────────────────

const ttsGen = useEbookTtsGenerator()
const showAudiobook     = ref(false)
const clearConfirmBookId = ref<string | null>(null)

async function doClearAudiobook(bookId: string) {
  clearConfirmBookId.value = null
  if (ttsGen.isRunning(bookId)) ttsGen.pauseGeneration(bookId)
  await store.clearAudiobook(bookId)
}

/** All books that have any TTS job state (running/paused/complete/error). */
const audiobookEntries = computed(() =>
  Object.entries(store.ttsJobStates)
    .map(([bookId, job]) => ({ bookId, job, book: store.books.find(b => b.id === bookId) }))
    .filter(e => e.book && e.job.status !== 'idle')
    .sort((a, b) => b.job.lastActivity - a.job.lastActivity)
)

function jobPct(entry: { job: { doneChunks: number; totalChunks: number } }): number {
  if (!entry.job.totalChunks) return 0
  return Math.round((entry.job.doneChunks / entry.job.totalChunks) * 100)
}

function jobPhaseLabel(entry: { job: { phase: string; status: string } }): string {
  if (entry.job.phase === 'extracting') return '提取文本…'
  if (entry.job.phase === 'scanning')   return '扫描进度…'
  if (entry.job.phase === 'generating') return '生成中…'
  if (entry.job.status === 'complete')  return '已完成'
  if (entry.job.status === 'paused')    return '已暂停'
  if (entry.job.status === 'error')     return '出错'
  return ''
}

const currentBookHasJob = computed(() =>
  store.activeBookId ? (store.ttsJobStates[store.activeBookId]?.status ?? 'idle') !== 'idle' : false
)
</script>

<template>
  <div class="ebook-sidebar" :class="`sidebar-theme-${activeTheme}`">
    <!-- Search -->
    <div class="search-wrap">
      <Search :size="13" class="search-icon" />
      <input
        v-model="searchQuery"
        class="search-input"
        :placeholder="t('ebook.sidebar.search')"
        @focus="activeCollectionId = null"
      />
    </div>

    <!-- Library section -->
    <div class="section-label">{{ t('ebook.sidebar.library') }}</div>
    <div class="filter-list">
      <button
        v-for="f in filters"
        :key="f.id"
        class="filter-item"
        :class="{ active: activeFilter === f.id && !activeCollectionId }"
        @click="selectFilter(f.id as 'all' | 'reading' | 'want_to_read' | 'finished')"
      >
        <component :is="f.icon" :size="14" class="fi-icon" />
        <span class="fi-label">{{ t(f.labelKey) }}</span>
        <span v-if="countForFilter(f.id) > 0" class="fi-count">{{ countForFilter(f.id) }}</span>
      </button>
    </div>

    <!-- Collections -->
    <div class="section-label section-label-row">
      <span>{{ t('ebook.sidebar.collections') }}</span>
      <button class="add-col-btn" @click="addingCollection = true"><Plus :size="13" /></button>
    </div>
    <div class="filter-list">
      <div v-if="addingCollection" class="new-col-wrap">
        <input
          v-model="newColName"
          class="new-col-input"
          :placeholder="t('ebook.sidebar.collectionName')"
          autofocus
          @keydown.enter="submitNewCollection"
          @keydown.esc="addingCollection = false; newColName = ''"
        />
        <button class="icon-btn" @click="submitNewCollection"><Check :size="13" /></button>
        <button class="icon-btn" @click="addingCollection = false; newColName = ''"><X :size="13" /></button>
      </div>
      <div
        v-for="col in store.collections"
        :key="col.id"
        class="filter-item"
        :class="{ active: activeCollectionId === col.id }"
        role="button"
        tabindex="0"
        @click="selectCollection(col.id)"
        @keydown.enter="selectCollection(col.id)"
      >
        <BookMarked :size="14" class="fi-icon" />
        <span class="fi-label">{{ col.name }}</span>
        <span class="fi-count">{{ store.books.filter(b => b.collectionIds?.includes(col.id)).length }}</span>
        <button class="del-col-btn" @click.stop="store.removeCollection(col.id)">
          <Trash2 :size="11" />
        </button>
      </div>
    </div>

    <!-- Book mini-list (shown when searching or filter active) -->
    <div v-if="searchQuery || activeFilter !== 'all' || activeCollectionId" class="mini-book-list">
      <div class="section-label">结果 ({{ displayBooks.length }})</div>
      <div
        v-for="book in displayBooks"
        :key="book.id"
        class="mini-book-item"
        :class="{ 'is-active': store.activeBookId === book.id }"
        @click="openBook(book.id)"
      >
        <div class="mb-cover">
          <img v-if="book.cover" :src="book.cover" alt="" class="mb-cover-img" />
          <BookOpen v-else :size="14" class="mb-cover-icon" />
        </div>
        <div class="mb-info">
          <p class="mb-title">{{ book.title }}</p>
          <p v-if="book.author" class="mb-author">{{ book.author }}</p>
        </div>
        <span v-if="book.totalProgress > 0" class="mb-pct">{{ book.totalProgress }}%</span>
      </div>
    </div>

    <!-- Settings — always at the bottom -->
    <div class="tts-section">
      <button class="tts-header" @click="showTts = !showTts">
        <Settings :size="13" class="tts-hdr-icon" />
        <span class="tts-hdr-label">设置</span>
        <ChevronDown :size="13" class="tts-chevron" :class="{ open: showTts }" />
      </button>
      <div v-if="showTts" class="tts-body">
        <!-- TTS subsection -->
        <div class="tts-subsection">
          <div class="tts-subheader">
            <Volume2 :size="12" class="tts-subicon" />
            <span class="tts-sublabel">朗读设置</span>
          </div>
          <div class="tts-row">
            <span class="tts-lbl">启用</span>
            <label class="tts-toggle">
              <input type="checkbox" :checked="ttsSettings.enabled"
                @change="store.updateTtsSettings({ enabled: ($event.target as HTMLInputElement).checked })" />
              <span class="tts-knob" />
            </label>
          </div>
          <template v-if="ttsSettings.enabled">
            <div class="tts-field">
              <span class="tts-lbl">Provider</span>
              <select class="tts-select"
                :value="ttsSettings.providerId"
                @change="store.updateTtsSettings({ providerId: ($event.target as HTMLSelectElement).value, modelId: '' })">
                <option value="">— 请选择 —</option>
                <option v-for="p in audioProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </div>
            <div class="tts-field">
              <span class="tts-lbl">模型</span>
              <select class="tts-select"
                :value="ttsSettings.modelId"
                :disabled="!ttsSettings.providerId"
                @change="store.updateTtsSettings({ modelId: ($event.target as HTMLSelectElement).value })">
                <option value="">— 请选择 —</option>
                <option v-for="m in audioModels" :key="m.id" :value="m.id">{{ m.name || m.id }}</option>
              </select>
            </div>
            <div v-if="ttsSettings.modelId" class="tts-field tts-field-col">
              <div class="tts-voice-row">
                <span class="tts-lbl">音色</span>
                <span v-if="voicesFetching" class="tts-voice-loading">加载中…</span>
              </div>
              <!-- Dropdown from API (shown when voices are available) -->
              <div v-if="fetchedVoices.length" class="tts-voice-select-wrap">
                <select
                  class="tts-select"
                  :value="customVoice ? '__custom__' : (ttsSettings.voice || fetchedVoices[0]?.id)"
                  @change="onSelectVoice"
                >
                  <option v-for="v in fetchedVoices" :key="v.id" :value="v.id">
                    {{ v.name }}{{ v.description ? ` — ${v.description}` : '' }}{{ v.language ? ` (${v.language})` : '' }}
                  </option>
                  <option value="__custom__">自定义…</option>
                </select>
                <button
                  v-if="fetchedVoices.find(v => v.id === (customVoice ? '' : (ttsSettings.voice || fetchedVoices[0]?.id)))?.sample"
                  class="voice-sample-btn"
                  :class="{ playing: playingVoiceId === (customVoice ? '' : (ttsSettings.voice || fetchedVoices[0]?.id)) }"
                  :title="playingVoiceId === (customVoice ? '' : (ttsSettings.voice || fetchedVoices[0]?.id)) ? '停止' : '试听'"
                  @click.stop="playSample(fetchedVoices.find(v => v.id === (customVoice ? '' : (ttsSettings.voice || fetchedVoices[0]?.id)))!)"
                >
                  <Square v-if="playingVoiceId === (customVoice ? '' : (ttsSettings.voice || fetchedVoices[0]?.id))" :size="10" />
                  <Play v-else :size="10" />
                </button>
              </div>
              <!-- Custom input — always shown when no voices, or when user chose 自定义 -->
              <input
                v-if="!fetchedVoices.length || customVoice"
                class="tts-input"
                :value="ttsSettings.voice"
                placeholder="输入音色名称，如 Ryan"
                @input="store.updateTtsSettings({ voice: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="tts-field tts-field-col">
              <span class="tts-lbl">语速 {{ ttsSettings.speed.toFixed(2) }}x</span>
              <input type="range" class="tts-slider" min="0.25" max="4" step="0.05"
                :value="ttsSettings.speed"
                @input="store.updateTtsSettings({ speed: parseFloat(($event.target as HTMLInputElement).value) })" />
            </div>
          </template>
        </div>

        <!-- ── Audiobook generation section ── -->
        <div class="ab-section">
          <button class="ab-header" @click="showAudiobook = !showAudiobook">
            <Headphones :size="12" class="ab-hdr-icon" />
            <span class="ab-hdr-label">有声书生成</span>
            <span v-if="audiobookEntries.length" class="ab-count">{{ audiobookEntries.length }}</span>
            <ChevronDown :size="13" class="tts-chevron" :class="{ open: showAudiobook }" />
          </button>

          <div v-if="showAudiobook" class="ab-body">
            <!-- Generate button for current book (if open and no job yet) -->
            <div
              v-if="store.activeBookId && !currentBookHasJob && ttsSettings.providerId && ttsSettings.modelId"
              class="ab-generate-row"
            >
              <div class="ab-gen-info">
                <span class="ab-gen-title">{{ store.activeBook?.title }}</span>
                <span class="ab-gen-hint">将整本书预先生成音频，支持断点续传</span>
              </div>
              <button class="ab-gen-btn" @click="ttsGen.startGeneration(store.activeBookId!)">
                <Play :size="11" />生成有声书
              </button>
            </div>

            <!-- No configured TTS and no book open -->
            <div
              v-else-if="!store.activeBookId && audiobookEntries.length === 0"
              class="ab-empty"
            >
              打开书籍后，点击此处预先生成整本有声书
            </div>

            <!-- TTS not configured -->
            <div
              v-else-if="store.activeBookId && !ttsSettings.providerId"
              class="ab-empty"
            >
              请先在上方配置朗读的 Provider 和模型
            </div>

            <!-- Job list -->
            <div
              v-for="entry in audiobookEntries"
              :key="entry.bookId"
              class="ab-job-card"
              :class="`ab-status-${entry.job.status}`"
            >
              <div class="ab-job-top">
                <div class="ab-job-cover">
                  <img v-if="entry.book?.cover" :src="entry.book.cover" alt="" />
                  <BookOpen v-else :size="12" class="ab-cover-fallback" />
                </div>
                <div class="ab-job-info">
                  <span class="ab-job-title">{{ entry.book?.title }}</span>
                  <span class="ab-job-sub">
                    <span
                      class="ab-status-dot"
                      :class="{
                        'dot-running':  entry.job.phase !== 'idle' && entry.job.status === 'running',
                        'dot-paused':   entry.job.status === 'paused',
                        'dot-complete': entry.job.status === 'complete',
                        'dot-error':    entry.job.status === 'error',
                      }"
                    />
                    {{ jobPhaseLabel(entry) }}
                    <template v-if="entry.job.totalChunks > 0">
                      · {{ entry.job.doneChunks }}/{{ entry.job.totalChunks }} 段
                    </template>
                  </span>
                </div>
                <div class="ab-job-actions">
                  <!-- Running → pause -->
                  <button
                    v-if="ttsGen.isRunning(entry.bookId)"
                    class="ab-action-btn"
                    title="暂停"
                    @click="ttsGen.pauseGeneration(entry.bookId)"
                  >
                    <Pause :size="11" />
                  </button>
                  <!-- Paused/error → resume -->
                  <button
                    v-else-if="entry.job.status === 'paused' || entry.job.status === 'error'"
                    class="ab-action-btn ab-action-resume"
                    title="继续生成"
                    @click="ttsGen.startGeneration(entry.bookId)"
                  >
                    <Play :size="11" />
                  </button>
                  <!-- Complete → restart + rescan -->
                  <button
                    v-else-if="entry.job.status === 'complete'"
                    class="ab-action-btn ab-action-resume"
                    title="重新生成"
                    @click="ttsGen.startGeneration(entry.bookId)"
                  >
                    <Play :size="11" />
                  </button>
                  <button
                    v-if="entry.job.status === 'complete'"
                    class="ab-action-btn"
                    title="重新扫描进度"
                    @click="ttsGen.rescanProgress(entry.bookId)"
                  >
                    <RefreshCw :size="11" />
                  </button>
                  <!-- Error icon -->
                  <AlertCircle
                    v-if="entry.job.status === 'error'"
                    :size="12"
                    class="ab-error-icon"
                    :title="entry.job.errorMsg"
                  />
                  <!-- Clear audiobook -->
                  <template v-if="clearConfirmBookId === entry.bookId">
                    <button
                      class="ab-action-btn ab-action-clear-confirm"
                      title="确认清除"
                      @click="doClearAudiobook(entry.bookId)"
                    >
                      <VolumeX :size="11" />
                    </button>
                    <button
                      class="ab-action-btn"
                      title="取消"
                      @click="clearConfirmBookId = null"
                    >
                      <X :size="11" />
                    </button>
                  </template>
                  <button
                    v-else
                    class="ab-action-btn ab-action-clear"
                    title="清除有声书"
                    @click="clearConfirmBookId = entry.bookId"
                  >
                    <Trash2 :size="11" />
                  </button>
                </div>
              </div>

              <!-- Progress bar -->
              <div class="ab-progress-track" :class="{ 'ab-progress-animate': ttsGen.isRunning(entry.bookId) }">
                <div
                  class="ab-progress-fill"
                  :class="{ 'fill-complete': entry.job.status === 'complete' }"
                  :style="{ width: `${jobPct(entry)}%` }"
                />
              </div>
              <div class="ab-progress-labels">
                <span class="ab-pct">{{ jobPct(entry) }}%</span>
                <span v-if="entry.job.totalChapters > 0" class="ab-chapters">
                  第 {{ entry.job.currentChapter + 1 }}/{{ entry.job.totalChapters }} 章
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ebook-sidebar {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: rgba(235, 235, 235, 0.85);
  backdrop-filter: blur(40px) saturate(1.8);
  -webkit-backdrop-filter: blur(40px) saturate(1.8);
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(0,0,0,0.10), 0 0 0 0.5px rgba(255,255,255,0.6) inset;
  padding-bottom: 12px;
  overflow-y: auto;
}
.ebook-sidebar::-webkit-scrollbar { width: 4px; }
.ebook-sidebar::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 2px; }

/* Reading theme variants — sidebar card stays gray frosted glass; only text colors adapt */
.sidebar-theme-dark {
  background: rgba(44, 44, 46, 0.92);
  color: #e5e5ea;
}
.sidebar-theme-dark .search-input { background: rgba(255,255,255,0.08); color: #e5e5ea; }
.sidebar-theme-dark .search-input::placeholder { color: rgba(229,229,234,0.35); }
.sidebar-theme-dark .section-label { color: rgba(229,229,234,0.45); }
.sidebar-theme-dark .filter-item { color: #e5e5ea; }
.sidebar-theme-dark .filter-item:hover { background: rgba(255,255,255,0.07); }
.sidebar-theme-dark .filter-item.active { background: rgba(109,155,239,0.14); }
.sidebar-theme-dark .filter-item.active .fi-icon { color: #6d9bef; }
.sidebar-theme-dark .filter-item.active .fi-label { color: #6d9bef; }
.sidebar-theme-dark .fi-count { color: rgba(229,229,234,0.38); }
.sidebar-theme-dark .mini-book-item { color: #e5e5ea; }
.sidebar-theme-dark .mini-book-item:hover { background: rgba(255,255,255,0.06); }
.sidebar-theme-dark .mini-book-item.is-active { background: rgba(109,155,239,0.14); }
.sidebar-theme-dark .mb-title { color: #e5e5ea; }
.sidebar-theme-dark .mb-author { color: rgba(229,229,234,0.55); }
.sidebar-theme-dark .mb-cover { background: #3a3a3c; }

/* Search */
.search-wrap {
  position: relative;
  margin: 10px 10px 4px;
  flex-shrink: 0;
}
.search-icon {
  position: absolute;
  left: 9px;
  top: 50%;
  transform: translateY(-50%);
  color: #8e8e93;
  pointer-events: none;
}
.search-input {
  width: 100%;
  padding: 7px 10px 7px 28px;
  border-radius: 10px;
  border: none;
  background: rgba(0,0,0,0.06);
  font-size: 13px;
  color: #1c1c1e;
  outline: none;
  box-sizing: border-box;
  transition: background 0.12s;
}
.search-input:focus { background: rgba(0,0,0,0.09); }
.search-input::placeholder { color: #aeaeb2; }

/* Section labels */
.section-label {
  font-size: 11px;
  font-weight: 700;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 12px 14px 4px;
  flex-shrink: 0;
}
.section-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 8px;
}
.add-col-btn {
  width: 22px; height: 22px;
  border: none; background: transparent; border-radius: 5px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: #8e8e93;
  transition: background 0.10s, color 0.10s;
}
.add-col-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }

/* Filter items */
.filter-list { padding: 0 6px 4px; flex-shrink: 0; }
.filter-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 13px;
  color: #3c3c43;
  cursor: pointer;
  text-align: left;
  transition: background 0.10s;
}
.filter-item:hover { background: rgba(0,0,0,0.05); }
.filter-item.active { background: rgba(34,63,121,0.10); }
.fi-icon { color: #8e8e93; flex-shrink: 0; }
.filter-item.active .fi-icon { color: #223F79; }
.fi-label { flex: 1; }
.filter-item.active .fi-label { color: #223F79; font-weight: 500; }
.fi-count { font-size: 12px; color: #aeaeb2; }
.del-col-btn {
  width: 20px; height: 20px; border: none; background: transparent; border-radius: 4px;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  color: #aeaeb2; opacity: 0; transition: opacity 0.10s;
}
.filter-item:hover .del-col-btn { opacity: 1; }
.del-col-btn:hover { background: rgba(255,59,48,0.10); color: #ff3b30; }

/* New collection input */
.new-col-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
}
.new-col-input {
  flex: 1;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid rgba(34,63,121,0.3);
  background: white;
  font-size: 13px;
  outline: none;
}
.icon-btn {
  width: 26px; height: 26px; border: none; background: transparent; border-radius: 6px;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  color: #8e8e93; transition: background 0.10s;
}
.icon-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }

/* Mini book list */
.mini-book-list { flex: 1; overflow-y: auto; }
.mini-book-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  border-radius: 8px;
  margin: 1px 6px;
  transition: background 0.10s;
}
.mini-book-item:hover { background: rgba(0,0,0,0.05); }
.mini-book-item.is-active { background: rgba(34,63,121,0.10); }
.mb-cover {
  width: 28px; height: 40px; border-radius: 3px; overflow: hidden;
  background: #e5e5ea; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.mb-cover-img { width: 100%; height: 100%; object-fit: cover; }
.mb-cover-icon { color: #aeaeb2; }
.mb-info { flex: 1; min-width: 0; }
.mb-title { font-size: 13px; margin: 0; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #1c1c1e; }
.mb-author { font-size: 11px; margin: 2px 0 0; color: #8e8e93; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mb-pct { font-size: 11px; color: #223F79; font-weight: 600; flex-shrink: 0; }

/* ── TTS settings ───────────────────────────────────────────────────────────── */
.tts-section {
  flex-shrink: 0;
  border-top: 1px solid rgba(0,0,0,0.07);
  margin-top: auto;
}
.sidebar-theme-dark .tts-section { border-top-color: rgba(255,255,255,0.08); }

.tts-header {
  width: 100%; display: flex; align-items: center; gap: 6px;
  padding: 9px 14px 9px 10px; border: none; background: transparent;
  cursor: pointer; color: inherit; text-align: left;
}
.tts-hdr-icon { opacity: 0.45; flex-shrink: 0; }
.tts-hdr-label { flex: 1; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.45; }
.tts-chevron { opacity: 0.35; flex-shrink: 0; transition: transform 0.15s; }
.tts-chevron.open { transform: rotate(180deg); }

.tts-body { padding: 0 10px 12px; display: flex; flex-direction: column; gap: 12px; }

.tts-subsection { display: flex; flex-direction: column; gap: 8px; }
.tts-subheader {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
.tts-subicon { opacity: 0.4; }
.tts-sublabel { font-size: 11px; font-weight: 600; opacity: 0.55; }

.tts-row { display: flex; align-items: center; justify-content: space-between; }
.tts-field { display: flex; align-items: center; gap: 6px; }
.tts-field-col { flex-direction: column; align-items: stretch; gap: 5px; }

.tts-lbl { font-size: 11px; color: #8e8e93; white-space: nowrap; flex-shrink: 0; min-width: 52px; }

.tts-input {
  flex: 1; min-width: 0; padding: 5px 8px; border-radius: 7px; font-size: 12px;
  border: 1px solid rgba(0,0,0,0.12); background: rgba(0,0,0,0.04); color: inherit; outline: none;
}
.tts-input:focus { border-color: #223F79; background: white; }
.sidebar-theme-dark .tts-input { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.12); }
.sidebar-theme-dark .tts-input:focus { background: rgba(255,255,255,0.12); border-color: #6d9bef; }

.tts-select {
  flex: 1; min-width: 0; padding: 5px 8px; border-radius: 7px; font-size: 12px;
  border: 1px solid rgba(0,0,0,0.12); background: rgba(0,0,0,0.04); color: inherit; outline: none; cursor: pointer;
}
.tts-select:focus { border-color: #223F79; background: white; }
.tts-select:disabled { opacity: 0.4; cursor: not-allowed; }
.sidebar-theme-dark .tts-select { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.12); }
.sidebar-theme-dark .tts-select:focus { background: rgba(255,255,255,0.12); border-color: #6d9bef; }

.tts-voice-row { display: flex; align-items: center; justify-content: space-between; }
.tts-voice-loading { font-size: 10px; color: #aeaeb2; }

.tts-voice-select-wrap { display: flex; align-items: center; gap: 6px; }
.voice-sample-btn {
  width: 24px; height: 24px; border: none; border-radius: 6px;
  background: rgba(0,0,0,0.06); color: #3c3c43; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: background 0.10s, color 0.10s;
}
.voice-sample-btn:hover { background: rgba(0,0,0,0.12); color: #223F79; }
.voice-sample-btn.playing { background: #223F79; color: white; }
.sidebar-theme-dark .voice-sample-btn { background: rgba(255,255,255,0.08); color: #e5e5ea; }
.sidebar-theme-dark .voice-sample-btn:hover { background: rgba(255,255,255,0.14); color: #6d9bef; }
.sidebar-theme-dark .voice-sample-btn.playing { background: #6d9bef; color: #1c1c1e; }

.tts-slider { width: 100%; accent-color: #223F79; cursor: pointer; }


/* Toggle */
.tts-toggle { position: relative; width: 36px; height: 20px; cursor: pointer; flex-shrink: 0; }
.tts-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.tts-knob {
  position: absolute; inset: 0; background: #d1d1d6; border-radius: 10px; transition: background 0.2s;
}
.tts-knob::after {
  content: ''; position: absolute; width: 14px; height: 14px; background: white;
  border-radius: 50%; top: 3px; left: 3px; transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.tts-toggle input:checked + .tts-knob { background: #34c759; }
.tts-toggle input:checked + .tts-knob::after { transform: translateX(16px); }

/* ── Audiobook generation section ─────────────────────────────────────────── */
.ab-section {
  border-top: 1px solid rgba(0,0,0,0.07);
}
.sidebar-theme-dark .ab-section { border-top-color: rgba(255,255,255,0.08); }

.ab-header {
  width: 100%; display: flex; align-items: center; gap: 6px;
  padding: 9px 14px 9px 10px; border: none; background: transparent;
  cursor: pointer; color: inherit; text-align: left;
}
.ab-hdr-icon { opacity: 0.45; flex-shrink: 0; }
.ab-hdr-label { flex: 1; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.45; }
.ab-count {
  font-size: 10px; font-weight: 700;
  background: rgba(34,63,121,0.12); color: #223F79;
  padding: 1px 6px; border-radius: 8px;
}
.sidebar-theme-dark .ab-count { background: rgba(109,155,239,0.18); color: #6d9bef; }

.ab-body { padding: 0 10px 12px; display: flex; flex-direction: column; gap: 8px; }

.ab-empty {
  font-size: 11px; color: #aeaeb2; text-align: center;
  padding: 10px 4px; line-height: 1.5;
}

/* Generate button row (current book, no job yet) */
.ab-generate-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  background: rgba(34,63,121,0.05);
  border: 1px solid rgba(34,63,121,0.12);
  border-radius: 10px;
}
.ab-gen-info { flex: 1; min-width: 0; }
.ab-gen-title {
  font-size: 12px; font-weight: 600; color: #1c1c1e;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;
}
.sidebar-theme-dark .ab-gen-title { color: #e5e5ea; }
.ab-gen-hint { font-size: 10px; color: #8e8e93; display: block; margin-top: 1px; }
.ab-gen-btn {
  flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 10px;
  background: #223F79; color: white;
  border: none; border-radius: 7px; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: opacity 0.12s; white-space: nowrap;
}
.ab-gen-btn:hover { opacity: 0.85; }

/* Job card */
.ab-job-card {
  background: white;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px;
  padding: 8px 10px 7px;
  display: flex; flex-direction: column; gap: 5px;
}
.sidebar-theme-dark .ab-job-card {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.10);
}
.ab-status-complete { border-color: rgba(52,199,89,0.25); }
.ab-status-error    { border-color: rgba(255,59,48,0.25); }

.ab-job-top { display: flex; align-items: center; gap: 7px; }

.ab-job-cover {
  width: 26px; height: 36px; border-radius: 3px; flex-shrink: 0;
  background: #e5e5ea; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.ab-job-cover img { width: 100%; height: 100%; object-fit: cover; }
.ab-cover-fallback { color: #aeaeb2; }
.sidebar-theme-dark .ab-job-cover { background: #3a3a3c; }

.ab-job-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ab-job-title {
  font-size: 12px; font-weight: 600; color: #1c1c1e;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sidebar-theme-dark .ab-job-title { color: #e5e5ea; }
.ab-job-sub {
  font-size: 10px; color: #8e8e93;
  display: flex; align-items: center; gap: 4px;
}

/* Status dot */
.ab-status-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block;
}
.dot-running  { background: #ff9500; animation: ab-pulse 1.2s ease-in-out infinite; }
.dot-paused   { background: #aeaeb2; }
.dot-complete { background: #34c759; }
.dot-error    { background: #ff3b30; }
@keyframes ab-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
}

/* Action buttons */
.ab-job-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.ab-action-btn {
  width: 24px; height: 24px; border: none; border-radius: 6px;
  background: rgba(0,0,0,0.06); color: #3c3c43;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.10s;
}
.ab-action-btn:hover { background: rgba(34,63,121,0.12); color: #223F79; }
.ab-action-resume { background: rgba(34,63,121,0.10); color: #223F79; }
.ab-action-resume:hover { background: rgba(34,63,121,0.18); }
.ab-action-clear { color: #8e8e93; }
.ab-action-clear:hover { background: rgba(255,59,48,0.08); color: #ff3b30; }
.ab-action-clear-confirm { background: rgba(255,59,48,0.10); color: #ff3b30; }
.ab-action-clear-confirm:hover { background: rgba(255,59,48,0.18); }
.ab-error-icon { color: #ff3b30; flex-shrink: 0; }
.sidebar-theme-dark .ab-action-btn { background: rgba(255,255,255,0.10); color: #e5e5ea; }

/* Progress bar */
.ab-progress-track {
  height: 5px; background: rgba(0,0,0,0.07); border-radius: 3px; overflow: hidden;
}
.sidebar-theme-dark .ab-progress-track { background: rgba(255,255,255,0.10); }
.ab-progress-fill {
  height: 100%; background: #223F79; border-radius: 3px;
  transition: width 0.4s ease;
}
.fill-complete { background: #34c759; }
.ab-progress-animate .ab-progress-fill {
  background: linear-gradient(90deg, #223F79 0%, #4a7fd4 50%, #223F79 100%);
  background-size: 200% 100%;
  animation: ab-shimmer 1.8s linear infinite;
}
@keyframes ab-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.ab-progress-labels {
  display: flex; align-items: center; justify-content: space-between;
}
.ab-pct { font-size: 10px; font-weight: 700; color: #223F79; }
.ab-chapters { font-size: 10px; color: #aeaeb2; }
.sidebar-theme-dark .ab-pct { color: #6d9bef; }
</style>
