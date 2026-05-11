<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { Plus, BookOpen, Trash2, Clock, MoreVertical, VolumeX } from 'lucide-vue-next'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useEbookStore, type Book } from '../../../stores/ebook'
import { useI18n } from 'vue-i18n'

// @ts-ignore – epubjs ships its own typedefs
import ePub from 'epubjs'

const { t } = useI18n()
const store = useEbookStore()

const isImporting = ref(false)
const menuOpenId  = ref<string | null>(null)
const isDragOver  = ref(false)

// ─── Import ───────────────────────────────────────────────────────────────────

async function importBook() {
  isImporting.value = true
  try {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: 'EPUB', extensions: ['epub'] }],
    })
    if (!selected || typeof selected !== 'string') return
    await processFile(selected)
  } catch { /* ignore */ }
  finally { isImporting.value = false }
}

async function processFile(filePath: string) {
  // Read file to extract metadata via epubjs
  const { readFile } = await import('@tauri-apps/plugin-fs')
  const bytes = await readFile(filePath)
  const ab = bytes.buffer as ArrayBuffer

  const book = ePub(ab.slice(0))
  await book.ready

  const meta = book.packaging?.metadata ?? {}
  const coverUrl = await book.coverUrl().catch(() => null)
  let coverBase64: string | null = null
  if (coverUrl) {
    try {
      const resp = await fetch(coverUrl)
      const blob = await resp.blob()
      coverBase64 = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result as string)
        r.onerror = rej
        r.readAsDataURL(blob)
      })
    } catch { /* ignore */ }
  }
  book.destroy()

  const id = crypto.randomUUID()
  const ok = await store.importBookFile(filePath, id)
  if (!ok) return

  const fileSize = bytes.byteLength

  store.addBook({
    id,
    title:         meta.title       ?? filePath.split('/').pop()?.replace('.epub', '') ?? 'Untitled',
    author:        meta.creator     ?? '',
    cover:         coverBase64,
    filePath:      `${id}.epub`,
    fileSize,
    format:        'epub',
    language:      meta.language    ?? '',
    publisher:     meta.publisher   ?? '',
    description:   meta.description ?? '',
    readStatus:    null,
    collectionIds: [],
  })
}

// ─── Drag-and-drop (Tauri native) ────────────────────────────────────────────

let _unlistenDrag: (() => void) | null = null

onMounted(async () => {
  const unlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
    const { type } = event.payload
    if (type === 'over') {
      isDragOver.value = true
    } else if (type === 'drop') {
      isDragOver.value = false
      const paths = (event.payload as { paths?: string[] }).paths ?? []
      for (const p of paths) {
        if (p.toLowerCase().endsWith('.epub')) await processFile(p)
      }
    } else {
      isDragOver.value = false
    }
  })
  _unlistenDrag = unlisten
})

onUnmounted(() => { _unlistenDrag?.() })

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatStorage(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function openBook(book: Book) {
  store.setActiveBook(book.id)
}

function closeMenu() { menuOpenId.value = null }

async function deleteBook(book: Book) {
  closeMenu()
  if (!confirm(`删除《${book.title}》？书源文件和所有笔记将一并删除。`)) return
  await store.removeBook(book.id)
}

const sortedBooks = computed(() =>
  [...store.books].sort((a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt))
)
</script>

<template>
  <div class="book-library" :class="{ 'drag-over': isDragOver }">
    <!-- Drag overlay -->
    <div v-if="isDragOver" class="drag-overlay">
      <BookOpen :size="44" class="drag-overlay-icon" />
      <p class="drag-overlay-text">松开导入 EPUB</p>
    </div>

    <!-- Header -->
    <div class="library-header">
      <div class="library-title-wrap">
        <h2 class="library-title">{{ t('ebook.library.title') }}</h2>
        <span v-if="store.books.length > 0" class="storage-badge">
          {{ store.books.length }} 本 · {{ formatStorage(store.books.reduce((s, b) => s + (b.fileSize || 0), 0)) }}
        </span>
      </div>
      <button class="add-btn" :disabled="isImporting" @click="importBook">
        <Plus :size="16" />
        <span>{{ t('ebook.library.addBook') }}</span>
      </button>
    </div>

    <!-- Empty state -->
    <div v-if="store.books.length === 0" class="empty-state">
      <BookOpen :size="48" class="empty-icon" />
      <p class="empty-title">{{ t('ebook.library.emptyTitle') }}</p>
      <p class="empty-desc">{{ t('ebook.library.emptyDesc') }}</p>
      <button class="add-btn-large" @click="importBook">
        <Plus :size="18" />
        {{ t('ebook.library.addBook') }}
      </button>
    </div>

    <!-- Book grid -->
    <div v-else class="book-grid">
      <div
        v-for="book in sortedBooks"
        :key="book.id"
        class="book-card"
        @click="openBook(book)"
      >
        <!-- Cover -->
        <div class="book-cover">
          <img v-if="book.cover" :src="book.cover" alt="" class="cover-img" />
          <div v-else class="cover-placeholder">
            <BookOpen :size="32" />
            <span class="placeholder-title">{{ book.title }}</span>
          </div>
          <!-- Progress bar -->
          <div v-if="book.totalProgress > 0" class="progress-bar">
            <div class="progress-fill" :style="{ width: `${book.totalProgress}%` }" />
          </div>
        </div>

        <!-- Info -->
        <div class="book-info">
          <p class="book-title" :title="book.title">{{ book.title }}</p>
          <p v-if="book.author" class="book-author">{{ book.author }}</p>
          <div class="book-meta">
            <span v-if="book.totalProgress > 0" class="meta-progress">{{ book.totalProgress }}%</span>
            <span v-if="book.lastReadAt" class="meta-date">
              <Clock :size="11" />
              {{ formatDate(book.lastReadAt) }}
            </span>
          </div>
        </div>

        <!-- Context menu button -->
        <button
          class="card-menu-btn"
          @click.stop="menuOpenId = menuOpenId === book.id ? null : book.id"
        >
          <MoreVertical :size="16" />
        </button>

        <!-- Dropdown -->
        <div v-if="menuOpenId === book.id" class="card-dropdown" @click.stop>
          <button
            v-if="store.ttsJobStates[book.id] && store.ttsJobStates[book.id].status !== 'idle'"
            class="dropdown-item"
            @click="store.clearAudiobook(book.id); closeMenu()"
          >
            <VolumeX :size="14" />
            清除有声书
          </button>
          <button class="dropdown-item danger" @click="deleteBook(book)">
            <Trash2 :size="14" />
            {{ t('ebook.library.delete') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Global menu close -->
    <Teleport to="body">
      <div v-if="menuOpenId" class="overlay-dismiss" @click="closeMenu" />
    </Teleport>
  </div>
</template>

<style scoped>
.book-library {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 28px 32px;
  overflow-y: auto;
}

.library-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  flex-shrink: 0;
}

.library-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}
.library-title {
  font-size: 20px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0;
}
.storage-badge {
  font-size: 11px;
  color: #8e8e93;
  background: rgba(0,0,0,0.05);
  padding: 2px 8px;
  border-radius: 10px;
}

.add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 8px;
  border: none;
  background: #223F79;
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.12s;
}
.add-btn:hover { opacity: 0.88; }
.add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Empty state */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px 0;
  border: 2px dashed rgba(0,0,0,0.12);
  border-radius: 16px;
  color: #8e8e93;
}
.empty-icon { opacity: 0.4; }
.empty-title { font-size: 16px; font-weight: 600; color: #3c3c43; margin: 0; }
.empty-desc  { font-size: 13px; margin: 0; text-align: center; max-width: 280px; }
.add-btn-large {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 10px 20px;
  border-radius: 10px;
  border: none;
  background: #223F79;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.12s;
}
.add-btn-large:hover { opacity: 0.88; }

/* Grid */
.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 20px;
}

.book-card {
  position: relative;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.08);
  overflow: visible;
  cursor: pointer;
  transition: transform 0.12s, box-shadow 0.12s;
}
.book-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 18px rgba(0,0,0,0.13);
}

.book-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 2/3;
  border-radius: 10px 10px 0 0;
  overflow: hidden;
  background: #f2f2f7;
}
.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #aeaeb2;
  padding: 12px;
  box-sizing: border-box;
}
.placeholder-title {
  font-size: 11px;
  text-align: center;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.progress-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(0,0,0,0.15);
}
.progress-fill {
  height: 100%;
  background: #223F79;
  transition: width 0.3s;
}

.book-info {
  padding: 10px 10px 12px;
}
.book-title {
  font-size: 13px;
  font-weight: 600;
  color: #1c1c1e;
  margin: 0 0 3px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.4;
}
.book-author {
  font-size: 11px;
  color: #8e8e93;
  margin: 0 0 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.book-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.meta-progress {
  font-size: 11px;
  color: #223F79;
  font-weight: 600;
}
.meta-date {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: #aeaeb2;
}

.card-menu-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(8px);
  color: #8e8e93;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.12s;
}
.book-card:hover .card-menu-btn { opacity: 1; }
.card-menu-btn:hover { background: white; color: #3c3c43; }

.card-dropdown {
  position: absolute;
  top: 34px;
  right: 6px;
  z-index: 50;
  background: rgba(252,252,252,0.97);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(0,0,0,0.10);
  border-radius: 9px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.12);
  padding: 4px;
  min-width: 110px;
}
.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.10s;
  color: #3c3c43;
  text-align: left;
}
.dropdown-item:hover { background: rgba(0,0,0,0.05); }
.dropdown-item.danger { color: #ff3b30; }
.dropdown-item.danger:hover { background: rgba(255,59,48,0.08); }

.overlay-dismiss {
  position: fixed;
  inset: 0;
  z-index: 49;
}

/* Drag-and-drop */
.book-library.drag-over {
  outline: 2px dashed #223F79;
  outline-offset: -4px;
}
.drag-overlay {
  position: absolute;
  inset: 0;
  z-index: 60;
  background: rgba(34, 63, 121, 0.07);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  pointer-events: none;
  border-radius: inherit;
}
.drag-overlay-icon { color: #223F79; opacity: 0.7; }
.drag-overlay-text {
  font-size: 15px;
  font-weight: 600;
  color: #223F79;
  margin: 0;
}
</style>
