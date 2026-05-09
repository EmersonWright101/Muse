<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  ChevronLeft, List, Minus, Plus, Volume2, VolumeX,
  Pause, Play, Square, BookMarked, Moon, Sun, Settings2,
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { Book } from '../../../stores/ebook'
import type { ReaderSettings } from '../../../stores/ebook'
import type { TtsState } from '../composables/useReaderTTS'
import copilotIcon from '../../../assets/icons/copilot.svg'

const props = defineProps<{
  book: Book
  percentage: number
  settings: ReaderSettings
  ttsState: TtsState
  tocOpen: boolean
  annotationsOpen: boolean
  copilotOpen: boolean
}>()

const emit = defineEmits<{
  close: []
  'toggle-toc': []
  'toggle-annotations': []
  'toggle-copilot': []
  'settings-change': [patch: Partial<ReaderSettings>]
  'tts-play': []
  'tts-pause': []
  'tts-stop': []
}>()

const { t } = useI18n()

const showFontPanel = ref(false)

const FONTS = [
  { id: 'serif',  label: '衬线' },
  { id: 'sans',   label: '无衬线' },
  { id: 'system', label: '系统' },
]

const THEMES = [
  { id: 'light', icon: Sun,  label: '白天' },
  { id: 'sepia', icon: null, label: '米白' },
  { id: 'dark',  icon: Moon, label: '夜间' },
]

function setFontSize(delta: number) {
  const next = Math.min(32, Math.max(12, props.settings.fontSize + delta))
  emit('settings-change', { fontSize: next })
}

const ttsIcon = computed(() => {
  if (props.ttsState.active && !props.ttsState.paused) return Pause
  if (props.ttsState.active && props.ttsState.paused)  return Play
  return Volume2
})

function onTtsClick() {
  if (!props.ttsState.active) emit('tts-play')
  else if (props.ttsState.paused) emit('tts-pause')
  else emit('tts-pause')
}
</script>

<template>
  <div class="reader-toolbar">
    <!-- Left: back + toc + title -->
    <div class="toolbar-left">
      <button class="toolbar-btn" :title="t('ebook.reader.back')" @click="emit('close')">
        <ChevronLeft :size="20" />
      </button>
      <button
        class="toolbar-btn"
        :class="{ active: tocOpen }"
        :title="t('ebook.reader.toc')"
        @click="emit('toggle-toc')"
      >
        <List :size="18" />
      </button>
      <div class="book-title-wrap">
        <span class="book-title">{{ book.title }}</span>
        <span v-if="percentage > 0" class="progress-pct">{{ percentage }}%</span>
      </div>
    </div>

    <!-- Right: font, theme, annotations, TTS, copilot -->
    <div class="toolbar-right">
      <!-- Font size -->
      <div class="font-size-ctrl">
        <button class="toolbar-btn small" @click="setFontSize(-1)">
          <Minus :size="14" />
        </button>
        <span class="font-size-val">{{ settings.fontSize }}</span>
        <button class="toolbar-btn small" @click="setFontSize(1)">
          <Plus :size="14" />
        </button>
      </div>

      <!-- Font & theme panel toggle -->
      <div class="font-panel-wrap">
        <button
          class="toolbar-btn"
          :class="{ active: showFontPanel }"
          :title="t('ebook.reader.fontSettings')"
          @click="showFontPanel = !showFontPanel"
        >
          <Settings2 :size="18" />
        </button>

        <!-- Font panel -->
        <div v-if="showFontPanel" class="font-panel">
          <!-- Font family -->
          <div class="panel-section-label">{{ t('ebook.reader.fontFamily') }}</div>
          <div class="font-btns">
            <button
              v-for="f in FONTS"
              :key="f.id"
              class="font-btn"
              :class="{ active: settings.fontFamily === f.id }"
              @click="emit('settings-change', { fontFamily: f.id })"
            >{{ f.label }}</button>
          </div>

          <!-- Theme -->
          <div class="panel-section-label">{{ t('ebook.reader.theme') }}</div>
          <div class="theme-btns">
            <button
              v-for="th in THEMES"
              :key="th.id"
              class="theme-btn"
              :class="[`theme-${th.id}`, { active: settings.theme === th.id }]"
              @click="emit('settings-change', { theme: th.id as ReaderSettings['theme'] })"
            >{{ th.label }}</button>
          </div>

          <!-- Line height -->
          <div class="panel-section-label">{{ t('ebook.reader.lineHeight') }}</div>
          <div class="slider-row">
            <input
              type="range" min="1.2" max="2.5" step="0.1"
              :value="settings.lineHeight"
              class="slider"
              @input="emit('settings-change', { lineHeight: parseFloat(($event.target as HTMLInputElement).value) })"
            />
            <span class="slider-val">{{ settings.lineHeight.toFixed(1) }}</span>
          </div>

          <!-- Scroll mode -->
          <div class="toggle-row">
            <span>{{ t('ebook.reader.scrollMode') }}</span>
            <button
              class="toggle-btn"
              :class="{ on: settings.scrollMode }"
              @click="emit('settings-change', { scrollMode: !settings.scrollMode })"
            >
              <span class="toggle-thumb" />
            </button>
          </div>
        </div>
      </div>

      <!-- Annotations -->
      <button
        class="toolbar-btn"
        :class="{ active: annotationsOpen }"
        :title="t('ebook.reader.annotations')"
        @click="emit('toggle-annotations')"
      >
        <BookMarked :size="18" />
      </button>

      <!-- TTS -->
      <div class="tts-ctrl">
        <button
          class="toolbar-btn"
          :class="{ active: ttsState.active }"
          :title="t('ebook.reader.tts')"
          @click="onTtsClick"
        >
          <component :is="ttsState.active && ttsState.loading ? VolumeX : ttsIcon" :size="18" />
        </button>
        <button
          v-if="ttsState.active"
          class="toolbar-btn small"
          @click="emit('tts-stop')"
        >
          <Square :size="13" />
        </button>
      </div>

      <!-- Copilot -->
      <button
        class="toolbar-btn copilot-btn"
        :class="{ active: copilotOpen }"
        :title="t('ebook.reader.copilot')"
        @click="emit('toggle-copilot')"
      >
        <img :src="copilotIcon" class="copilot-icon" alt="Copilot" />
      </button>
    </div>
  </div>

  <!-- Close font panel overlay -->
  <Teleport to="body">
    <div v-if="showFontPanel" class="overlay-dismiss" @click="showFontPanel = false" />
  </Teleport>
</template>

<style scoped>
.reader-toolbar {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid rgba(0,0,0,0.08);
  background: inherit;
  flex-shrink: 0;
  gap: 8px;
  user-select: none;
}

.toolbar-left, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.book-title-wrap {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-left: 4px;
}
.book-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.progress-pct {
  font-size: 12px;
  color: #8e8e93;
}

.toolbar-btn {
  width: 34px;
  height: 34px;
  border: none;
  background: transparent;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8e8e93;
  cursor: pointer;
  transition: background 0.10s, color 0.10s;
  flex-shrink: 0;
}
.toolbar-btn.small { width: 26px; height: 26px; }
.toolbar-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }
.toolbar-btn.active { background: rgba(34,63,121,0.10); color: #223F79; }

.font-size-ctrl {
  display: flex;
  align-items: center;
  gap: 2px;
  border: 1px solid rgba(0,0,0,0.10);
  border-radius: 8px;
  padding: 2px 4px;
}
.font-size-val {
  font-size: 13px;
  color: #3c3c43;
  width: 24px;
  text-align: center;
}

/* Font panel */
.font-panel-wrap { position: relative; }
.font-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 60;
  background: rgba(252,252,252,0.97);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(0,0,0,0.10);
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.12);
  padding: 14px;
  width: 220px;
}
.panel-section-label {
  font-size: 11px;
  font-weight: 600;
  color: #8e8e93;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
  margin-top: 10px;
}
.panel-section-label:first-child { margin-top: 0; }

.font-btns, .theme-btns {
  display: flex;
  gap: 6px;
}
.font-btn, .theme-btn {
  flex: 1;
  padding: 6px 4px;
  border-radius: 7px;
  border: 1px solid rgba(0,0,0,0.10);
  background: transparent;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.10s;
  color: #3c3c43;
}
.font-btn.active, .theme-btn.active {
  background: #223F79;
  color: white;
  border-color: #223F79;
}

.theme-light { background: #ffffff; color: #1c1c1e; }
.theme-sepia { background: #f4ecd8; color: #3b2e1a; }
.theme-dark  { background: #1c1c1e; color: #e5e5ea; }
.theme-btn.active { border-color: #223F79; outline: 2px solid rgba(34,63,121,0.4); }

.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.slider {
  flex: 1;
  -webkit-appearance: none;
  height: 4px;
  border-radius: 2px;
  background: rgba(0,0,0,0.15);
  cursor: pointer;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #223F79;
  cursor: pointer;
}
.slider-val {
  font-size: 12px;
  color: #3c3c43;
  width: 28px;
  text-align: right;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: #3c3c43;
}
.toggle-btn {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  border: none;
  background: rgba(0,0,0,0.15);
  cursor: pointer;
  transition: background 0.2s;
}
.toggle-btn.on { background: #223F79; }
.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.toggle-btn.on .toggle-thumb { transform: translateX(16px); }

.tts-ctrl {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* Copilot */
.copilot-btn { padding: 0; }
.copilot-icon {
  width: 20px;
  height: 20px;
  opacity: 0.55;
  transition: opacity 0.12s;
}
.copilot-btn:hover .copilot-icon { opacity: 0.8; }
.copilot-btn.active .copilot-icon { opacity: 1; filter: none; }

.overlay-dismiss {
  position: fixed;
  inset: 0;
  z-index: 59;
}
</style>
