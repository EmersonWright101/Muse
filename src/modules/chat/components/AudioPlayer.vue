<script setup lang="ts">
import { ref, computed } from 'vue'
import { Play, Pause, Download } from 'lucide-vue-next'

const props = defineProps<{ src: string }>()

const audioRef = ref<HTMLAudioElement | null>(null)
const playing  = ref(false)
const current  = ref(0)
const duration = ref(0)
const hasError = ref(false)

const progress = computed(() =>
  duration.value > 0 ? (current.value / duration.value) * 100 : 0
)

function toggle() {
  const a = audioRef.value
  if (!a) return
  if (a.paused) { a.play(); playing.value = true }
  else          { a.pause(); playing.value = false }
}

function seek(e: MouseEvent) {
  const a = audioRef.value
  if (!a || !a.duration) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration
}

function onTime()  { const a = audioRef.value; if (a) { current.value = a.currentTime; duration.value = a.duration || 0 } }
function onMeta()  { duration.value = audioRef.value?.duration || 0 }
function onEnded() { playing.value = false; current.value = 0 }

function fmt(s: number): string {
  if (!isFinite(s) || isNaN(s)) return '0:00'
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

async function downloadAudio() {
  const src = props.src
  if (!src) return
  let bytes: Uint8Array
  if (src.startsWith('data:')) {
    const b64 = src.split(',')[1]
    const bin = atob(b64)
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  } else {
    const buf = await fetch(src).then(r => r.arrayBuffer())
    bytes = new Uint8Array(buf)
  }
  try {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const savePath = await save({
      defaultPath: 'muse-audio.mp3',
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg'] }],
    })
    if (!savePath) return
    await writeFile(savePath, bytes)
    showToast('已保存')
  } catch {
    const a = document.createElement('a')
    a.href = src.startsWith('data:') ? src : URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer]))
    a.download = 'muse-audio.mp3'
    a.click()
    showToast('已保存到下载文件夹')
  }
}

function showToast(msg: string) {
  // Simple toast via a temporary element
  const el = document.createElement('div')
  el.textContent = msg
  el.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:6px 14px;border-radius:8px;font-size:12px;z-index:9999;pointer-events:none;transition:opacity 0.3s;'
  document.body.appendChild(el)
  setTimeout(() => { el.style.opacity = '0' }, 2000)
  setTimeout(() => { el.remove() }, 2300)
}
</script>

<template>
  <div class="chat-audio-player" :class="{ error: hasError }">
    <audio
      ref="audioRef"
      :src="src"
      preload="metadata"
      @timeupdate="onTime"
      @loadedmetadata="onMeta"
      @ended="onEnded"
      @error="hasError = true"
    />
    <template v-if="!hasError">
      <button class="audio-btn" @click="toggle">
        <Pause v-if="playing" :size="12" />
        <Play  v-else         :size="12" />
      </button>
      <div class="audio-track" @click="seek">
        <div class="audio-fill" :style="{ width: progress + '%' }" />
      </div>
      <span class="audio-time">{{ fmt(current) }} / {{ fmt(duration) }}</span>
      <button
        class="audio-download-btn"
        title="下载音频"
        @click.stop="downloadAudio"
      >
        <Download :size="12" />
      </button>
    </template>
    <template v-else>
      <button class="audio-btn error-btn" disabled>
        <Play :size="12" />
      </button>
      <span class="audio-time">加载失败</span>
    </template>
  </div>
</template>

<style scoped>
.chat-audio-player {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px 5px 6px;
  background: var(--bg-secondary, rgba(0,0,0,0.05));
  border-radius: 20px;
  max-width: 320px;
  width: 100%;
}
.audio-btn {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--accent-color, #007aff);
  color: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity 0.15s;
}
.audio-btn:hover     { opacity: 0.82; }
.audio-btn.error-btn { background: #aaa; cursor: default; }
.audio-track {
  flex: 1;
  height: 3px;
  background: var(--border-color, rgba(0,0,0,0.15));
  border-radius: 2px;
  cursor: pointer;
  position: relative;
  min-width: 40px;
}
.audio-fill {
  height: 100%;
  background: var(--accent-color, #007aff);
  border-radius: 2px;
  transition: width 0.1s linear;
}
.audio-time {
  font-size: 11px;
  color: var(--text-secondary, #888);
  white-space: nowrap;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.audio-download-btn {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary, #888);
  border: 1px solid rgba(0,0,0,0.12);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s;
  padding: 0;
}
.audio-download-btn:hover {
  background: rgba(0,0,0,0.06);
  color: #223F79;
  border-color: rgba(34,63,121,0.25);
}
</style>
