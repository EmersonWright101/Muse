<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import {
  ChevronLeft, ChevronRight, List, Minus, Plus,
  Settings2, Moon, Sun, BookMarked, X, Volume2,
  Pause, Play, Square, Pencil, Trash2, Check,
  Copy, Underline, ChevronDown,
} from 'lucide-vue-next'
import { useEbookStore, type Book, type BookAnnotation, type TtsPlaybackPos } from '../../../stores/ebook'
import { useEpubReader, type TocItem } from '../composables/useEpubReader'
import { useReaderTTS } from '../composables/useReaderTTS'
import { useEbookTtsGenerator } from '../composables/useEbookTtsGenerator'
import ReaderCopilot from './ReaderCopilot.vue'
import copilotIcon from '../../../assets/icons/copilot.svg'

const props = defineProps<{ book: Book }>()
const emit  = defineEmits<{ close: [] }>()

const store = useEbookStore()

// ─── EPUB reader ──────────────────────────────────────────────────────────────

const containerEl = ref<HTMLElement>()
const reader  = useEpubReader(containerEl)
const tts     = useReaderTTS()
const ttsGen  = useEbookTtsGenerator()

const hasPreGeneratedAudio = ref(false)
// Whether there's a saved playback position for this book
const hasSavedTtsPos = computed(() => !!store.getTtsPlaybackPos(props.book.id))
// Show the play-mode picker popup
const showTtsModePicker = ref(false)
// Flag: spine change was caused by TTS auto-advance, not user action
let _ttsAutoAdvancing = false
// URLs in the current chapter that haven't been played yet (for cleanup on early stop)
let _remainingChapterUrls: string[] = []

watch(reader.currentSpineIdx, async (idx, prevIdx) => {
  if (idx < 0) { hasPreGeneratedAudio.value = false; return }
  const url = await ttsGen.getChunkUrl(props.book.id, idx, 0)
  hasPreGeneratedAudio.value = url !== null
  if (url) URL.revokeObjectURL(url)

  // If the user manually turns the page while TTS is running, switch to the new chapter.
  // Guard against our own auto-advance (which sets _ttsAutoAdvancing before calling reader.next).
  if (isAutoTtsReading.value && !_ttsAutoAdvancing && prevIdx !== undefined && idx !== prevIdx) {
    _remainingChapterUrls.forEach(u => URL.revokeObjectURL(u))
    _remainingChapterUrls = []
    tts.stop()
    clearTtsHighlight()
    setTimeout(() => { if (isAutoTtsReading.value) speakCurrentChapter() }, 400)
  }
}, { immediate: true })

const settings   = computed(() => store.settings)
const activeTheme = ref(store.settings.theme)
const themeClass = computed(() => `theme-${activeTheme.value}`)

watch(() => store.settings.theme, (theme) => {
  activeTheme.value = theme
})

// ─── UI state ─────────────────────────────────────────────────────────────────

const showToc         = ref(false)
const showAnnotations = ref(false)
const showCopilot     = ref(false)
const collapsedChapters = ref<Set<string>>(new Set())
const showFontPanel   = ref(false)
const selectedTextForCopilot = ref('')
const noteModalAnn    = ref<BookAnnotation | null>(null)
const noteText        = ref('')
const noteColor       = ref('yellow')
const pageTurnClass   = ref('')
let pageTurnTimer: number | null = null
let lastWheelAt = 0

function onWheel(e: WheelEvent) {
  if (settings.value.scrollMode) return
  const now = Date.now()
  if (now - lastWheelAt < 500) return
  lastWheelAt = now
  e.preventDefault()
  if (e.deltaY > 0) reader.next()
  else if (e.deltaY < 0) reader.prev()
}

// ─── Load book ────────────────────────────────────────────────────────────────

const bookBuffer = ref<ArrayBuffer | null>(null)

async function reloadBook() {
  if (!bookBuffer.value) return
  const saved = store.getProgress(props.book.id)
  await reader.loadBook(bookBuffer.value, settings.value)
  await reader.display(saved?.cfi)
  reader.restoreAnnotations(store.getAnnotations(props.book.id))
}

onMounted(async () => {
  if (!props.book) return
  const arrayBuffer = await store.readBookFile(props.book)
  if (!arrayBuffer) { reader.error.value = '无法读取书籍文件'; return }
  bookBuffer.value = arrayBuffer
  await nextTick()
  await reloadBook()
})

// Re-render when spread (single↔double page) changes
watch(
  () => settings.value.spread,
  () => { if (reader.isReady.value) reloadBook() },
)

// Left-click on a highlight → open note editor directly
watch(reader.clickedAnnotationCfi, (cfi) => {
  if (!cfi) return
  reader.clickedAnnotationCfi.value = null
  const ann = store.getAnnotations(props.book.id).find(a => a.cfi === cfi)
  if (ann) openNoteModal(ann)
})

watch(showCopilot, async () => {
  await nextTick()
  reader.resize()
  if (showCopilot.value) {
    reader.extractCurrentChapterText().catch(() => {})
    reader.extractCurrentPageText().catch(() => {})
  }
})

watch(() => reader.pageTurn.value.id, () => {
  const direction = reader.pageTurn.value.direction
  pageTurnClass.value = direction === 'prev'
    ? 'turn-prev'
    : direction === 'jump'
      ? 'turn-jump'
      : 'turn-next'
  if (pageTurnTimer != null) window.clearTimeout(pageTurnTimer)
  pageTurnTimer = window.setTimeout(() => {
    pageTurnClass.value = ''
    pageTurnTimer = null
  }, 360)
})

onUnmounted(() => {
  if (pageTurnTimer != null) window.clearTimeout(pageTurnTimer)
  store.commitSession()
  stopTts()
})

// ─── Save progress on location change ─────────────────────────────────────────

watch(reader.currentCfi, (cfi) => {
  if (!cfi) return
  store.saveProgress(props.book.id, cfi, reader.currentHref.value, reader.percentage.value)
})

// ─── Reapply theme when settings change ───────────────────────────────────────

watch(settings, (s) => { reader.updateSettings(s) }, { deep: true })

// ─── Highlight helpers ────────────────────────────────────────────────────────

const HIGHLIGHT_COLORS = [
  { id: 'yellow', css: 'rgba(255,214,0,0.45)'  },
  { id: 'green',  css: 'rgba(52,199,89,0.4)'   },
  { id: 'blue',   css: 'rgba(0,122,255,0.35)'  },
  { id: 'pink',   css: 'rgba(255,45,85,0.35)'  },
  { id: 'orange', css: 'rgba(255,149,0,0.42)'  },
  { id: 'purple', css: 'rgba(175,82,222,0.35)' },
]

function applyHighlight(color: string) {
  const sel = reader.selection.value
  if (!sel) return
  store.addAnnotation({
    bookId: props.book.id, cfi: sel.cfiRange, text: sel.text,
    type: 'highlight', color, note: '', chapterTitle: currentChapterTitle.value,
  })
  reader.addHighlight(sel.cfiRange, color)
  reader.selection.value = null
}

function applyUnderline(color = 'blue') {
  const sel = reader.selection.value
  if (!sel) return
  store.addAnnotation({
    bookId: props.book.id, cfi: sel.cfiRange, text: sel.text,
    type: 'underline', color, note: '', chapterTitle: currentChapterTitle.value,
  })
  reader.addUnderline(sel.cfiRange, color)
  reader.selection.value = null
}

function openNoteModal(ann?: BookAnnotation) {
  if (ann) {
    noteModalAnn.value = ann
    noteText.value = ann.note
    noteColor.value = ann.color || 'yellow'
  } else {
    const sel = reader.selection.value
    if (!sel) return
    const newAnn = store.addAnnotation({
      bookId: props.book.id, cfi: sel.cfiRange, text: sel.text,
      type: 'note', color: noteColor.value, note: '', chapterTitle: currentChapterTitle.value,
    })
    reader.addHighlight(sel.cfiRange, noteColor.value)
    reader.selection.value = null
    noteModalAnn.value = newAnn
    noteText.value = ''
  }
}

function saveNote() {
  if (!noteModalAnn.value) return
  if (noteModalAnn.value.color !== noteColor.value) {
    reader.removeHighlight(noteModalAnn.value.cfi)
    if (noteModalAnn.value.type === 'underline') reader.addUnderline(noteModalAnn.value.cfi, noteColor.value)
    else reader.addHighlight(noteModalAnn.value.cfi, noteColor.value)
  }
  store.updateAnnotation(noteModalAnn.value.id, { note: noteText.value, color: noteColor.value })
  noteModalAnn.value = null
}

async function copySelection() {
  const text = reader.selection.value?.text
  if (!text) return
  await navigator.clipboard?.writeText(text).catch(() => {})
  reader.selection.value = null
}

function deleteAnnotation(ann: BookAnnotation) {
  reader.removeHighlight(ann.cfi)
  store.removeAnnotation(ann.id)
}

function jumpToAnnotation(ann: BookAnnotation) {
  reader.jumpTo(ann.cfi)
  showAnnotations.value = false
}

const bookAnnotations = computed(() => store.getAnnotations(props.book.id))

const annotationsByChapter = computed(() => {
  const groups: Record<string, BookAnnotation[]> = {}
  for (const ann of bookAnnotations.value) {
    const key = ann.chapterTitle || '未分类'
    if (!groups[key]) groups[key] = []
    groups[key].push(ann)
  }
  return groups
})

const currentChapterTitle = computed(() => {
  const href = reader.currentHref.value
  if (!href) return ''
  function find(items: TocItem[]): string {
    for (const item of items) {
      if (href.includes(item.href) || item.href.includes(href.split('#')[0])) return item.label
      const f = item.subitems ? find(item.subitems) : ''
      if (f) return f
    }
    return ''
  }
  return find(reader.toc.value)
})

// ─── TTS reading with auto page-turn, highlight & progress tracking ───────────

const ttsHighlightId = ref<string | null>(null)
const isAutoTtsReading = ref(false)

function clearTtsHighlight() {
  if (ttsHighlightId.value) {
    reader.removeTextHighlight(ttsHighlightId.value)
    ttsHighlightId.value = null
  }
}

/**
 * Start reading the current chapter from the given chunk index.
 * Records playback position on each chunk so the user can resume later.
 */
async function speakCurrentChapter(startChunkIdx = 0) {
  const spineIdx = reader.currentSpineIdx.value
  const href     = reader.currentHref.value
  if (spineIdx < 0) {
    tts.state.value.error = '未找到已生成的有声书音频，请先在书架中完成有声书生成'
    return
  }
  const urls  = await ttsGen.getChapterAudioUrls(props.book.id, spineIdx)
  const texts = await ttsGen.getChapterChunkTexts(props.book.id, spineIdx)
  if (urls.length === 0) {
    tts.state.value.error = '未找到已生成的有声书音频，请先在书架中完成有声书生成'
    return
  }
  // Revoke any chunks we're skipping
  for (let i = 0; i < startChunkIdx && i < urls.length; i++) URL.revokeObjectURL(urls[i])
  const playUrls  = startChunkIdx > 0 ? urls.slice(startChunkIdx)  : urls
  const playTexts = startChunkIdx > 0 ? texts.slice(startChunkIdx) : texts

  isAutoTtsReading.value = true
  await tts.speakFromUrls(playUrls, {
    onChunkStart: async (i) => {
      _remainingChapterUrls = playUrls.slice(i + 1)
      clearTtsHighlight()
      if (playTexts[i]) ttsHighlightId.value = await reader.highlightTextSegment(playTexts[i])
      store.setTtsPlaybackPos(props.book.id, { spineIdx, chunkIdx: i + startChunkIdx, href })
    },
    onChunkEnd: () => clearTtsHighlight(),
    onFinished: () => {
      _remainingChapterUrls = []
      clearTtsHighlight()
      onTtsChapterFinished()
    },
  })
}

async function onTtsChapterFinished() {
  if (!isAutoTtsReading.value) return
  const currentIdx = reader.currentSpineIdx.value
  // Mark auto-advance so the spine watcher doesn't re-trigger a chapter switch
  _ttsAutoAdvancing = true
  await reader.next()
  _ttsAutoAdvancing = false
  if (reader.currentSpineIdx.value === currentIdx) {
    // End of book
    isAutoTtsReading.value = false
    return
  }
  await nextTick()
  setTimeout(() => { if (isAutoTtsReading.value) speakCurrentChapter() }, 400)
}

/** Explicit stop: cleans up URLs, clears state, stops audio. */
function stopTts() {
  _remainingChapterUrls.forEach(u => URL.revokeObjectURL(u))
  _remainingChapterUrls = []
  isAutoTtsReading.value = false
  clearTtsHighlight()
  tts.stop()
}

/** Called when the play button is clicked while TTS is not active. */
function onTtsPlayClick() {
  if (hasSavedTtsPos.value) {
    showTtsModePicker.value = true
  } else {
    speakCurrentChapter()
  }
}

/** Resume from the saved position (navigate to that chapter first if needed). */
async function resumeFromLastPosition() {
  showTtsModePicker.value = false
  const pos = store.getTtsPlaybackPos(props.book.id) as TtsPlaybackPos | null
  if (!pos) { speakCurrentChapter(); return }
  if (pos.spineIdx !== reader.currentSpineIdx.value) {
    await reader.jumpTo(pos.href)
    await nextTick()
    await new Promise<void>(r => setTimeout(r, 400))
  }
  speakCurrentChapter(pos.chunkIdx)
}

// Only clear highlights when TTS stops and we are NOT in the middle of an auto-advance.
// (During auto-advance, active briefly becomes false between chapters; we must not abort.)
watch(() => tts.state.value.active, (active) => {
  if (!active && !isAutoTtsReading.value) clearTtsHighlight()
})

// ─── Settings panel ───────────────────────────────────────────────────────────

const FONTS = [
  { id: 'serif',  label: '宋体' },
  { id: 'sans',   label: '黑体' },
  { id: 'system', label: '系统' },
]

function setTheme(theme: 'light' | 'sepia' | 'dark') {
  activeTheme.value = theme
  store.updateSettings({ theme })
}

const popWrapRef = ref<HTMLElement>()
const settingsPopStyle = computed(() => {
  if (!popWrapRef.value) return {}
  const rect = popWrapRef.value.getBoundingClientRect()
  return { position: 'fixed' as const, top: `${rect.bottom + 8}px`, right: `${window.innerWidth - rect.right}px`, zIndex: 400 }
})

const ttsPlayWrapRef = ref<HTMLElement>()
const ttsPickerStyle = computed(() => {
  if (!ttsPlayWrapRef.value) return {}
  const rect = ttsPlayWrapRef.value.getBoundingClientRect()
  return { position: 'fixed' as const, top: `${rect.bottom + 6}px`, right: `${window.innerWidth - rect.right}px`, zIndex: 500 }
})


// ─── TOC flat list ────────────────────────────────────────────────────────────

function flattenToc(items: TocItem[], depth = 0): Array<TocItem & { depth: number }> {
  const out: Array<TocItem & { depth: number }> = []
  for (const item of items) {
    out.push({ ...item, depth })
    if (item.subitems?.length) out.push(...flattenToc(item.subitems, depth + 1))
  }
  return out
}
const flatToc = computed(() => flattenToc(reader.toc.value))

// ─── Context menu annotation ──────────────────────────────────────────────────

const ctxMenuStyle = computed(() => {
  const cm = reader.contextMenu.value
  if (!cm) return {}
  return {
    top: `${Math.min(cm.y, window.innerHeight - 220)}px`,
    left: `${Math.min(cm.x, window.innerWidth - 200)}px`,
  }
})

const contextMenuAnn = computed(() => {
  const cfi = reader.contextMenu.value?.highlightCfi
  if (!cfi) return null
  return store.getAnnotations(props.book.id).find(a => a.cfi === cfi) ?? null
})

function onCtxHighlight(color: string) {
  if (reader.selection.value) {
    applyHighlight(color)
  } else if (contextMenuAnn.value) {
    store.updateAnnotation(contextMenuAnn.value.id, { color })
    reader.removeHighlight(contextMenuAnn.value.cfi)
    if (contextMenuAnn.value.type === 'underline') {
      reader.addUnderline(contextMenuAnn.value.cfi, color)
    } else {
      reader.addHighlight(contextMenuAnn.value.cfi, color)
    }
  }
  reader.hideContextMenu()
}

function onCtxUnderline() {
  if (reader.selection.value) applyUnderline()
  reader.hideContextMenu()
}

function onCtxNote() {
  if (contextMenuAnn.value) {
    openNoteModal(contextMenuAnn.value)
  } else if (reader.selection.value) {
    openNoteModal()
  }
  reader.hideContextMenu()
}

function onCtxCopy() {
  copySelection()
  reader.hideContextMenu()
}

function onCtxDelete() {
  if (contextMenuAnn.value) deleteAnnotation(contextMenuAnn.value)
  reader.hideContextMenu()
}
</script>

<template>
  <div class="book-reader" :class="themeClass" @mousedown="reader.hideContextMenu()">
    <!-- ─── Toolbar ─────────────────────────────────────────────────────────── -->
    <div class="reader-toolbar">
      <div class="toolbar-left">
        <button class="tbtn" @click="emit('close')">
          <ChevronLeft :size="20" />
        </button>
        <button class="tbtn" :class="{ active: showToc }"
          @click="showToc = !showToc; showAnnotations = false; showCopilot = false">
          <List :size="18" />
        </button>
        <div class="title-area">
          <span class="reader-title">{{ book.title }}</span>
          <span v-if="currentChapterTitle" class="reader-chapter">· {{ currentChapterTitle }}</span>
        </div>
      </div>

      <div class="toolbar-right">
        <div class="fs-ctrl">
          <button class="tbtn sm" @click="store.updateSettings({ fontSize: Math.max(12, settings.fontSize - 1) })">
            <Minus :size="13" />
          </button>
          <span class="fs-val">{{ settings.fontSize }}</span>
          <button class="tbtn sm" @click="store.updateSettings({ fontSize: Math.min(32, settings.fontSize + 1) })">
            <Plus :size="13" />
          </button>
        </div>

        <div class="pop-wrap" ref="popWrapRef">
          <button class="tbtn" :class="{ active: showFontPanel }"
            @click="showFontPanel = !showFontPanel; showAnnotations = false; showToc = false; showCopilot = false">
            <Settings2 :size="18" />
          </button>
        </div>

        <button class="tbtn" :class="{ active: showAnnotations }"
          @click="showAnnotations = !showAnnotations; showToc = false; showCopilot = false; showFontPanel = false">
          <BookMarked :size="18" />
        </button>

        <div class="tts-group">
          <!-- Play/Pause button -->
          <div class="tts-play-wrap" ref="ttsPlayWrapRef">
            <button
              class="tbtn"
              :class="{ active: tts.state.value.active }"
              :disabled="!tts.state.value.active && !hasPreGeneratedAudio"
              :title="!tts.state.value.active && !hasPreGeneratedAudio ? '请先完成有声书生成再朗读' : undefined"
              @click="tts.state.value.active ? (tts.state.value.paused ? tts.resume() : tts.pause()) : onTtsPlayClick()"
            >
              <Pause   v-if="tts.state.value.active && !tts.state.value.paused" :size="18" />
              <Play    v-else-if="tts.state.value.active && tts.state.value.paused" :size="18" />
              <Volume2 v-else :size="18" />
            </button>
          </div>
          <!-- Stop button -->
          <button v-if="tts.state.value.active" class="tbtn sm" @click="stopTts()">
            <Square :size="13" />
          </button>
        </div>

        <button class="tbtn copilot-tbtn" :class="{ active: showCopilot }"
          @click="selectedTextForCopilot = ''; showCopilot = !showCopilot; showAnnotations = false; showToc = false; showFontPanel = false">
          <img :src="copilotIcon" class="copilot-ic" />
        </button>
      </div>
    </div>

    <!-- ─── Body ───────────────────────────────────────────────────────────── -->
    <div class="reader-body">

      <!-- TOC (left) -->
      <Transition name="slide-left">
        <div v-if="showToc" class="side-panel toc-panel">
          <div class="panel-head">
            目录
            <button class="icon-x" @click="showToc = false"><X :size="15" /></button>
          </div>
          <div class="panel-scroll">
            <div
              v-for="item in flatToc" :key="item.href + item.label"
              class="toc-item"
              :class="{ sub: item.depth > 0, active: reader.currentHref.value.includes(item.href) }"
              :style="{ paddingLeft: `${14 + item.depth * 14}px` }"
              @click="reader.jumpTo(item.href); showToc = false"
            >{{ item.label }}</div>
          </div>
        </div>
      </Transition>

      <!-- EPUB content -->
      <div class="epub-wrap" :class="pageTurnClass" @wheel="onWheel">
        <div v-if="reader.isLoading.value" class="center-msg">
          <div class="spinner" />加载中…
        </div>
        <div v-else-if="reader.error.value" class="center-msg err">{{ reader.error.value }}</div>

        <div ref="containerEl" class="epub-container" :class="{ 'is-scroll': settings.scrollMode }" />

        <template v-if="reader.isReady.value && !settings.scrollMode">
          <!-- Transparent hit zones in the parent window — reliably intercept
               clicks before the iframe can, so no need to rely on epubjs event forwarding -->
          <div class="page-zone page-prev">
            <button class="page-turn-btn" title="上一页" @click="reader.prev()">
              <ChevronLeft :size="28" class="pz-arrow" />
            </button>
          </div>
          <div class="page-zone page-next">
            <button class="page-turn-btn" title="下一页" @click="reader.next()">
              <ChevronRight :size="28" class="pz-arrow" />
            </button>
          </div>
        </template>

        <div class="prog-bar">
          <div class="prog-fill" :style="{ width: `${reader.percentage.value}%` }" />
        </div>
      </div>

      <!-- Annotations (right) -->
      <Transition name="slide-right">
        <div v-if="showAnnotations" class="side-panel">
          <div class="panel-head">
            批注 <span class="panel-count">({{ bookAnnotations.length }})</span>
            <button class="icon-x" @click="showAnnotations = false"><X :size="15" /></button>
          </div>
          <div class="panel-scroll">
            <div v-if="!bookAnnotations.length" class="panel-empty">还没有批注</div>
            <template v-else>
              <div v-for="(anns, chapter) in annotationsByChapter" :key="chapter" class="ann-chapter-group">
                <div class="ann-chapter-title" @click="collapsedChapters.has(chapter) ? collapsedChapters.delete(chapter) : collapsedChapters.add(chapter)">
                  <ChevronDown :size="12" class="chapter-chevron" :class="{ collapsed: collapsedChapters.has(chapter) }" />
                  <span>{{ chapter }}</span>
                  <span class="chapter-count">({{ anns.length }})</span>
                </div>
                <div v-show="!collapsedChapters.has(chapter)" class="ann-chapter-items">
                  <div v-for="ann in anns" :key="ann.id" class="ann-item"
                    @click="jumpToAnnotation(ann)">
                    <div class="ann-bar" :data-color="ann.color" />
                    <div class="ann-body">
                      <p class="ann-text">{{ ann.text }}</p>
                      <p v-if="ann.note" class="ann-note">{{ ann.note }}</p>
                      <div class="ann-foot">
                        <span class="ann-ch">
                          <span class="ann-kind">{{ ann.type === 'note' ? '笔记' : ann.type === 'underline' ? '下划线' : '划线' }}</span>
                        </span>
                        <div class="ann-acts">
                          <button class="a-btn" @click.stop="openNoteModal(ann)"><Pencil :size="11" /></button>
                          <button class="a-btn red" @click.stop="deleteAnnotation(ann)"><Trash2 :size="11" /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </Transition>

      <!-- Copilot (right) -->
      <Transition name="slide-right">
        <ReaderCopilot
          v-if="showCopilot"
          :book="book"
          :chapter-text="reader.currentChapterText.value"
          :page-text="reader.currentPageText.value"
          :chapter-title="currentChapterTitle"
          :selected-text="selectedTextForCopilot"
          @close="showCopilot = false"
        />
      </Transition>
    </div>

    <!-- ─── Context menu (right-click inside iframe) ─────────────────────── -->
    <Teleport to="body">
      <div
        v-if="reader.contextMenu.value?.visible"
        class="ctx-menu"
        :style="ctxMenuStyle"
        @mousedown.stop
      >
        <div class="ctx-colors">
          <button
            v-for="c in HIGHLIGHT_COLORS"
            :key="c.id"
            class="ctx-dot"
            :class="{ active: contextMenuAnn?.color === c.id || (!contextMenuAnn && noteColor === c.id) }"
            :style="{ background: c.css }"
            @click="onCtxHighlight(c.id)"
          />
        </div>
        <div class="ctx-divider" />
        <button class="ctx-item" @click="onCtxUnderline">
          <Underline :size="14" /> 下划线
        </button>
        <button class="ctx-item" @click="onCtxNote">
          <Pencil :size="14" /> {{ contextMenuAnn?.note ? '编辑笔记' : (contextMenuAnn ? '添加笔记' : '笔记') }}
        </button>
        <button class="ctx-item" @click="onCtxCopy">
          <Copy :size="14" /> 复制
        </button>
        <button v-if="contextMenuAnn" class="ctx-item ctx-danger" @click="onCtxDelete">
          <Trash2 :size="14" /> 删除高亮
        </button>
      </div>
    </Teleport>

    <!-- TTS error -->
    <Teleport to="body">
      <div v-if="tts.state.value.error" class="tts-err">
        {{ tts.state.value.error }}
        <button @click="tts.state.value.error = null"><X :size="13" /></button>
      </div>
    </Teleport>

    <!-- Note modal -->
    <Teleport to="body">
      <div v-if="noteModalAnn" class="note-mask" @click.self="noteModalAnn = null">
        <div class="note-box">
          <div class="nb-head">
            笔记
            <button class="icon-x" @click="noteModalAnn = null"><X :size="15" /></button>
          </div>
          <p class="nb-quote">{{ noteModalAnn.text }}</p>
          <div class="nb-color-row">
            <span>标记颜色</span>
            <button
              v-for="c in HIGHLIGHT_COLORS"
              :key="c.id"
              class="nb-color"
              :class="{ active: noteColor === c.id }"
              :style="{ background: c.css }"
              @click="noteColor = c.id"
            />
          </div>
          <textarea v-model="noteText" class="nb-ta" placeholder="写下你的想法…" rows="5" autofocus />
          <div class="nb-actions">
            <button class="nb-cancel" @click="noteModalAnn = null">取消</button>
            <button class="nb-save" @click="saveNote"><Check :size="14" /> 保存</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Settings panel — teleported to body to escape stacking-context issues -->
    <Teleport to="body">
      <div v-if="showFontPanel" class="settings-pop" :class="themeClass" :style="settingsPopStyle">
        <div class="pop-label">主题</div>
        <div class="theme-row">
          <button class="tp tp-light" :class="{ active: activeTheme === 'light' }" @click="setTheme('light')">
            <Sun :size="11" /> 白天
          </button>
          <button class="tp tp-sepia" :class="{ active: activeTheme === 'sepia' }" @click="setTheme('sepia')">
            纸张
          </button>
          <button class="tp tp-dark" :class="{ active: activeTheme === 'dark' }" @click="setTheme('dark')">
            <Moon :size="11" /> 夜间
          </button>
        </div>
        <div class="pop-label">字体</div>
        <div class="font-row">
          <button v-for="f in FONTS" :key="f.id" class="fp"
            :class="{ active: settings.fontFamily === f.id }"
            @click="store.updateSettings({ fontFamily: f.id })">
            {{ f.label }}
          </button>
        </div>
        <div class="pop-label">行距 {{ settings.lineHeight.toFixed(1) }}</div>
        <input type="range" min="1.2" max="2.5" step="0.1" class="pop-slider"
          :value="settings.lineHeight"
          @input="store.updateSettings({ lineHeight: parseFloat(($event.target as HTMLInputElement).value) })" />
        <div class="toggle-row">
          <span>双页显示</span>
          <button class="mtoggle" :class="{ on: settings.spread === 'always' }"
            @click="store.updateSettings({ spread: settings.spread === 'always' ? 'none' : 'always' })">
            <span class="mt-thumb" />
          </button>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showFontPanel" class="overlay-dismiss" @click="showFontPanel = false" />
    </Teleport>
    <Teleport to="body">
      <div
        v-if="showTtsModePicker"
        class="tts-mode-picker"
        :class="themeClass"
        :style="ttsPickerStyle"
      >
        <button class="tts-mode-item" @click="showTtsModePicker = false; speakCurrentChapter()">
          从当前页朗读
        </button>
        <button v-if="hasSavedTtsPos" class="tts-mode-item" @click="resumeFromLastPosition">
          从上次停止处继续
        </button>
      </div>
    </Teleport>
    <Teleport to="body">
      <div v-if="showTtsModePicker" class="overlay-dismiss" @click="showTtsModePicker = false" />
    </Teleport>

  </div>
</template>

<style scoped>
.book-reader {
  display: flex; flex-direction: column;
  height: 100%; width: 100%; min-height: 0;
  transition: background 0.25s, color 0.25s;
}
.theme-light { background: #ffffff; color: #1c1c1e; }
.theme-sepia  { background: #f4ecd8; color: #3b2e1a; }
.theme-dark   { background: #1c1c1e; color: #e5e5ea; }

/* ─── Toolbar ─────────────────────────────────────────────────────────────── */
.reader-toolbar {
  height: 48px;
  position: relative;
  z-index: 250;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 10px; flex-shrink: 0; gap: 6px; user-select: none;
  border-bottom: 1px solid rgba(128,128,128,0.12);
  backdrop-filter: blur(20px);
}
.theme-light .reader-toolbar { background: rgba(255,255,255,0.9); }
.theme-sepia  .reader-toolbar { background: rgba(244,236,216,0.9); }
.theme-dark   .reader-toolbar { background: rgba(28,28,30,0.9); }

.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 3px; flex-shrink: 0; }
.title-area { display: flex; align-items: baseline; gap: 6px; margin-left: 4px; min-width: 0; }
.reader-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
.reader-chapter { font-size: 12px; opacity: 0.45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }

.tbtn {
  width: 34px; height: 34px; border: none; background: transparent;
  border-radius: 8px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0.6; transition: background 0.10s, opacity 0.10s;
  flex-shrink: 0; color: inherit; position: relative;
}
.tbtn.sm { width: 26px; height: 26px; }
.tbtn:hover { background: rgba(128,128,128,0.12); opacity: 0.9; }
.tbtn:disabled { opacity: 0.35; cursor: not-allowed; pointer-events: auto; }
.tbtn:disabled:hover { background: transparent; opacity: 0.35; }
.tbtn.active { background: rgba(34,63,121,0.12); opacity: 1; color: #223F79; }
.theme-dark .tbtn.active { color: #6d9bef; background: rgba(109,155,239,0.15); }

.fs-ctrl { display: flex; align-items: center; gap: 2px; border: 1px solid rgba(128,128,128,0.2); border-radius: 8px; padding: 2px 4px; }
.fs-val { font-size: 13px; width: 22px; text-align: center; opacity: 0.8; }

/* Settings popover — teleported to body, positioned via :style */
.pop-wrap { position: relative; }
.settings-pop {
  position: fixed;
  z-index: 400;
  width: 228px; border-radius: 14px; padding: 16px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.18);
}
.settings-pop.theme-light { background: rgba(255,255,255,0.97); backdrop-filter: blur(20px); border: 1px solid rgba(0,0,0,0.10); }
.settings-pop.theme-sepia { background: rgba(248,242,226,0.97); backdrop-filter: blur(20px); border: 1px solid rgba(0,0,0,0.08); }
.settings-pop.theme-dark  { background: rgba(44,44,46,0.97);    backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.10); }

.pop-label { font-size: 11px; font-weight: 600; opacity: 0.45; text-transform: uppercase; letter-spacing: 0.04em; margin: 10px 0 6px; }
.pop-label:first-child { margin-top: 0; }

.theme-row, .font-row { display: flex; gap: 6px; }
.tp, .fp {
  flex: 1; padding: 7px 4px; font-size: 12px; border-radius: 8px;
  border: 1px solid transparent; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 4px;
  transition: all 0.10s;
}
.tp-light { background: #ffffff; color: #1c1c1e; border-color: rgba(0,0,0,0.12); }
.tp-sepia { background: #f4ecd8; color: #3b2e1a; border-color: rgba(0,0,0,0.10); }
.tp-dark  { background: #1c1c1e; color: #e5e5ea; border-color: rgba(255,255,255,0.15); }
.tp.active, .fp.active { outline: 2px solid #223F79; outline-offset: 1px; }
.fp { border-color: rgba(128,128,128,0.2); }
.theme-light .fp { background: rgba(0,0,0,0.04); color: #3c3c43; }
.theme-sepia  .fp { background: rgba(0,0,0,0.05); color: #3b2e1a; }
.theme-dark   .fp { background: rgba(255,255,255,0.07); color: #e5e5ea; }
.fp.active { background: #223F79 !important; color: white; border-color: #223F79; outline: none; }

.pop-slider {
  width: 100%; -webkit-appearance: none; height: 4px; border-radius: 2px;
  background: rgba(128,128,128,0.25); cursor: pointer; margin-bottom: 10px;
}
.pop-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #223F79; cursor: pointer; }

.toggle-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; opacity: 0.85; }
.mtoggle {
  position: relative; width: 36px; height: 20px; border-radius: 10px;
  border: none; background: rgba(128,128,128,0.3); cursor: pointer;
  transition: background 0.2s; flex-shrink: 0;
}
.mtoggle.on { background: #223F79; }
.mt-thumb {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: white; transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.mtoggle.on .mt-thumb { transform: translateX(16px); }

.ann-badge {
  position: absolute; top: 4px; right: 4px;
  min-width: 14px; height: 14px; border-radius: 7px;
  background: #ff3b30; color: white;
  font-size: 9px; font-weight: 700; line-height: 14px;
  text-align: center; padding: 0 3px; pointer-events: none;
}

.tts-group { display: flex; align-items: center; gap: 2px; }

.tts-play-wrap { position: relative; }
.tts-mode-picker {
  min-width: 168px;
  background: rgba(255,255,255,0.97);
  backdrop-filter: blur(20px) saturate(1.4);
  border: 1px solid rgba(0,0,0,0.10);
  border-radius: 10px;
  padding: 4px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.14);
}
.tts-mode-picker.theme-dark {
  background: rgba(44,44,46,0.97);
  border-color: rgba(255,255,255,0.10);
}
.tts-mode-item {
  display: block; width: 100%; text-align: left;
  padding: 7px 10px; border: none; background: transparent;
  color: inherit; font-size: 13px; border-radius: 7px; cursor: pointer;
  transition: background 0.10s;
}
.tts-mode-item:hover { background: rgba(128,128,128,0.10); }

/* TTS settings popup */
.tts-pop { width: 262px; }
.tts-input {
  width: 100%; padding: 6px 8px; border-radius: 7px; font-size: 12px;
  border: 1px solid rgba(128,128,128,0.2); background: transparent; color: inherit;
  outline: none; box-sizing: border-box;
}
.tts-input:focus { border-color: #223F79; }
.theme-dark .tts-input { background: rgba(255,255,255,0.06); }
.tts-voice-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.tts-vc {
  padding: 3px 8px; border-radius: 5px; border: 1px solid rgba(128,128,128,0.22);
  background: transparent; font-size: 11px; color: inherit; cursor: pointer;
  transition: background 0.10s, border-color 0.10s;
}
.tts-vc:hover { background: rgba(128,128,128,0.10); }
.tts-vc.active { border-color: #223F79; background: rgba(34,63,121,0.10); color: #223F79; font-weight: 600; }
.theme-dark .tts-vc.active { border-color: #6d9bef; background: rgba(109,155,239,0.15); color: #6d9bef; }
.copilot-tbtn { padding: 0; }
.copilot-ic { width: 20px; height: 20px; opacity: 0.55; transition: opacity 0.12s; }
.tbtn.active .copilot-ic, .copilot-tbtn:hover .copilot-ic { opacity: 1; }

/* ─── Body ────────────────────────────────────────────────────────────────── */
.reader-body { flex: 1; display: flex; min-height: 0; position: relative; overflow: hidden; }

.epub-wrap { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
.epub-container { flex: 1; min-height: 0; overflow: hidden; }
.epub-container.is-scroll { overflow-y: auto; overflow-x: hidden; }
.epub-wrap.turn-next .epub-container { animation: pageTurnNext 0.34s cubic-bezier(0.22, 1, 0.36, 1); }
.epub-wrap.turn-prev .epub-container { animation: pageTurnPrev 0.34s cubic-bezier(0.22, 1, 0.36, 1); }
.epub-wrap.turn-jump .epub-container { animation: pageTurnJump 0.22s ease-out; }
@keyframes pageTurnNext {
  0%   { opacity: 0.15; transform: translateX(32px) scale(0.988); filter: blur(0.8px); }
  55%  { filter: blur(0); }
  100% { opacity: 1;    transform: translateX(0)   scale(1);      filter: blur(0); }
}
@keyframes pageTurnPrev {
  0%   { opacity: 0.15; transform: translateX(-32px) scale(0.988); filter: blur(0.8px); }
  55%  { filter: blur(0); }
  100% { opacity: 1;    transform: translateX(0)    scale(1);      filter: blur(0); }
}
@keyframes pageTurnJump {
  0%   { opacity: 0.3; transform: scale(0.989); filter: blur(0.5px); }
  100% { opacity: 1;   transform: scale(1);     filter: blur(0); }
}
/* Sweep-shadow overlay to simulate paper catching light during turn */
.epub-wrap::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  opacity: 0;
}
.epub-wrap.turn-next::before {
  background: linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.055) 45%, rgba(0,0,0,0) 100%);
  animation: pageSweepNext 0.34s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
.epub-wrap.turn-prev::before {
  background: linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.055) 55%, rgba(0,0,0,0) 100%);
  animation: pageSweepPrev 0.34s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
@keyframes pageSweepNext {
  0%   { opacity: 0; transform: translateX(-50%); }
  25%  { opacity: 1; }
  75%  { opacity: 0.6; }
  100% { opacity: 0; transform: translateX(50%); }
}
@keyframes pageSweepPrev {
  0%   { opacity: 0; transform: translateX(50%); }
  25%  { opacity: 1; }
  75%  { opacity: 0.6; }
  100% { opacity: 0; transform: translateX(-50%); }
}
@media (prefers-reduced-motion: reduce) {
  .epub-wrap.turn-next .epub-container,
  .epub-wrap.turn-prev .epub-container,
  .epub-wrap.turn-jump .epub-container { animation: none; }
  .epub-wrap.turn-next::before,
  .epub-wrap.turn-prev::before { animation: none; }
}

.center-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 14px; opacity: 0.5; z-index: 5; }
.center-msg.err { color: #ff3b30; opacity: 1; }
.spinner { width: 22px; height: 22px; border: 2px solid rgba(128,128,128,0.3); border-top-color: #223F79; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Page-turn hit zones — positioned in the parent window above the iframe */
.page-zone {
  position: absolute;
  top: 0; bottom: 0;
  width: 56px;
  z-index: 20;           /* above the iframe */
  pointer-events: none;
  display: flex;
  align-items: center;
}
.page-prev { left: 0;  justify-content: flex-start; padding-left: 8px; }
.page-next { right: 0; justify-content: flex-end;   padding-right: 8px; }
.page-turn-btn {
  width: 38px;
  height: 64px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.page-turn-btn:hover { background: rgba(128,128,128,0.10); }
.pz-arrow {
  opacity: 0.18;
  color: inherit;
  transition: opacity 0.15s;
  filter: drop-shadow(0 1px 3px rgba(0,0,0,0.18));
}
.page-turn-btn:hover .pz-arrow { opacity: 0.55; }

.prog-bar { height: 2px; background: rgba(128,128,128,0.15); flex-shrink: 0; }
.prog-fill { height: 100%; background: #223F79; transition: width 0.5s ease; }
.theme-dark .prog-fill { background: #6d9bef; }

/* ─── Side panels ─────────────────────────────────────────────────────────── */
.side-panel { width: 260px; flex-shrink: 0; display: flex; flex-direction: column; border-left: 1px solid rgba(128,128,128,0.12); height: 100%; }
.toc-panel { border-left: none; border-right: 1px solid rgba(128,128,128,0.12); order: -1; }
.theme-light .side-panel { background: #f9f9f9; }
.theme-sepia  .side-panel { background: #ede7d3; }
.theme-dark   .side-panel { background: #2c2c2e; }

.panel-head { height: 44px; padding: 0 14px; display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 600; border-bottom: 1px solid rgba(128,128,128,0.10); flex-shrink: 0; }
.panel-count { font-weight: 400; opacity: 0.5; margin-left: 4px; }
.icon-x { width: 26px; height: 26px; border: none; background: transparent; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0.5; color: inherit; transition: opacity 0.10s; }
.icon-x:hover { opacity: 1; background: rgba(128,128,128,0.12); }

.panel-scroll { flex: 1; overflow-y: auto; padding: 6px 0; }
.panel-scroll::-webkit-scrollbar { width: 4px; }
.panel-scroll::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 2px; }
.panel-empty { padding: 40px 16px; text-align: center; font-size: 13px; opacity: 0.38; }

.toc-item { padding: 8px 14px; font-size: 13px; cursor: pointer; opacity: 0.72; border-radius: 7px; margin: 1px 6px; transition: background 0.10s, opacity 0.10s; line-height: 1.4; }
.toc-item:hover { background: rgba(128,128,128,0.10); opacity: 1; }
.toc-item.active { opacity: 1; font-weight: 600; color: #223F79; }
.theme-dark .toc-item.active { color: #6d9bef; }
.toc-item.sub { font-size: 12px; }

.ann-chapter-group { border-bottom: 1px solid rgba(128,128,128,0.10); }
.ann-chapter-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 600; color: #8e8e93;
  padding: 8px 12px; background: rgba(0,0,0,0.02);
  cursor: pointer; user-select: none;
}
.ann-chapter-title:hover { background: rgba(0,0,0,0.04); }
.chapter-chevron { transition: transform 0.15s; opacity: 0.5; }
.chapter-chevron.collapsed { transform: rotate(-90deg); }
.chapter-count { font-weight: 400; opacity: 0.6; }
.ann-chapter-items { }
.ann-item { display: flex; gap: 0; padding: 8px 12px; cursor: pointer; transition: background 0.10s; border-bottom: 1px solid rgba(128,128,128,0.04); }
.ann-item:hover { background: rgba(128,128,128,0.07); }
.ann-bar { width: 3px; border-radius: 2px; flex-shrink: 0; margin-right: 10px; align-self: stretch; min-height: 20px; }
.ann-bar[data-color="yellow"] { background: #ffd600; }
.ann-bar[data-color="green"]  { background: #34c759; }
.ann-bar[data-color="blue"]   { background: #007aff; }
.ann-bar[data-color="pink"]   { background: #ff2d55; }
.ann-bar[data-color="orange"] { background: #ff9500; }
.ann-bar[data-color="purple"] { background: #af52de; }
.ann-body { flex: 1; min-width: 0; }
.ann-text { font-size: 13px; line-height: 1.5; margin: 0 0 4px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.ann-note { font-size: 12px; opacity: 0.55; margin: 0 0 5px; font-style: italic; }
.ann-foot { display: flex; align-items: center; justify-content: space-between; }
.ann-ch { font-size: 11px; opacity: 0.4; }
.ann-kind { font-weight: 700; margin-right: 5px; }
.ann-acts { display: flex; gap: 3px; opacity: 0; transition: opacity 0.12s; }
.ann-item:hover .ann-acts { opacity: 1; }
.a-btn { width: 22px; height: 22px; border: none; background: transparent; border-radius: 5px; display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0.6; color: inherit; transition: background 0.10s, opacity 0.10s; }
.a-btn:hover { background: rgba(128,128,128,0.15); opacity: 1; }
.a-btn.red:hover { background: rgba(255,59,48,0.12); color: #ff3b30; opacity: 1; }

/* ─── Context menu ────────────────────────────────────────────────────────── */
.ctx-menu {
  position: fixed; z-index: 700;
  display: flex; flex-direction: column;
  min-width: 196px;
  background: rgba(255,255,255,0.97);
  backdrop-filter: blur(20px) saturate(1.4);
  border: 1px solid rgba(0,0,0,0.10);
  border-radius: 12px; padding: 6px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.18);
  color: #1c1c1e;
}
.ctx-colors {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 6px 4px;
}
.ctx-dot {
  width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer; transition: transform 0.10s, border-color 0.10s;
  flex-shrink: 0;
}
.ctx-dot:hover { transform: scale(1.15); }
.ctx-dot.active { border-color: #223F79; }
.ctx-divider { height: 1px; background: rgba(0,0,0,0.08); margin: 3px 0; }
.ctx-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border: none; border-radius: 8px;
  background: transparent; color: #1c1c1e; font-size: 13px;
  cursor: pointer; transition: background 0.10s;
  text-align: left;
}
.ctx-item:hover { background: rgba(0,0,0,0.06); }
.ctx-item.ctx-danger { color: #ff3b30; }
.ctx-item.ctx-danger:hover { background: rgba(255,59,48,0.08); }

/* ─── TTS error toast ─────────────────────────────────────────────────────── */
.tts-err {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  z-index: 600; background: rgba(28,28,30,0.93); color: white;
  font-size: 13px; padding: 10px 16px; border-radius: 10px;
  display: flex; align-items: center; gap: 10px;
  backdrop-filter: blur(16px); box-shadow: 0 4px 20px rgba(0,0,0,0.25);
}
.tts-err button { background: transparent; border: none; cursor: pointer; color: white; opacity: 0.7; display: flex; }

/* ─── Note modal ──────────────────────────────────────────────────────────── */
.note-mask {
  position: fixed; inset: 0; z-index: 800;
  background: rgba(0,0,0,0.4); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.note-box {
  width: 400px; max-width: 90vw; background: white;
  border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  padding: 20px; display: flex; flex-direction: column; gap: 12px;
}
.nb-head { display: flex; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 600; color: #1c1c1e; }
.nb-quote { font-size: 13px; color: #8e8e93; margin: 0; padding: 10px 12px; background: #f2f2f7; border-radius: 8px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.nb-color-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #6e6e73; }
.nb-color { width: 22px; height: 22px; border-radius: 50%; border: 2px solid rgba(0,0,0,0.10); cursor: pointer; }
.nb-color.active { outline: 2px solid #223F79; outline-offset: 2px; }
.nb-ta { border: 1px solid rgba(0,0,0,0.12); border-radius: 10px; padding: 10px 12px; font-size: 14px; line-height: 1.6; resize: none; outline: none; font-family: inherit; color: #1c1c1e; transition: border-color 0.12s; }
.nb-ta:focus { border-color: rgba(34,63,121,0.4); }
.nb-actions { display: flex; justify-content: flex-end; gap: 8px; }
.nb-cancel, .nb-save { padding: 8px 18px; border-radius: 9px; border: none; font-size: 14px; font-weight: 500; cursor: pointer; transition: opacity 0.12s; }
.nb-cancel { background: rgba(0,0,0,0.06); color: #3c3c43; }
.nb-save { background: #223F79; color: white; display: flex; align-items: center; gap: 6px; }
.nb-save:hover { opacity: 0.88; }

/* ─── Transitions ─────────────────────────────────────────────────────────── */
.slide-left-enter-active, .slide-left-leave-active,
.slide-right-enter-active, .slide-right-leave-active { transition: all 0.22s ease; }
.slide-left-enter-from,  .slide-left-leave-to  { transform: translateX(-100%); opacity: 0; }
.slide-right-enter-from, .slide-right-leave-to { transform: translateX(100%);  opacity: 0; }

.overlay-dismiss { position: fixed; inset: 0; z-index: 100; }
</style>
