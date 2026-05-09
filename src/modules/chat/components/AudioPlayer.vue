<script setup lang="ts">
import { ref, computed } from 'vue'
import { Play, Pause } from 'lucide-vue-next'

defineProps<{ src: string }>()

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
</style>
