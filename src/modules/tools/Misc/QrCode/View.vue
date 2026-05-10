<template>
  <div class="h-full flex flex-col overflow-hidden">

    <!-- ── Header bar: tab switcher + history ── -->
    <div class="flex items-center justify-between px-6 pt-4 pb-3 border-b border-slate-100 flex-shrink-0">
      <div class="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          @click="activeTab = tab.key"
          class="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all"
          :class="activeTab === tab.key
            ? 'bg-white text-slate-800 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'"
        >
          <component :is="tab.icon" class="w-4 h-4" />
          {{ tab.label }}
        </button>
      </div>
      <button
        @click="$router.push('/tools/misc/qrcode/history')"
        class="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-transparent hover:border-indigo-100 rounded-md transition-all"
      >
        <History class="w-3.5 h-3.5" />
        {{ t('qr.history.btn') }}
      </button>
    </div>

    <!-- ══════════════ GENERATE TAB ══════════════ -->
    <template v-if="activeTab === 'generate'">

      <!-- Content input (full width) -->
      <div class="px-6 py-3 border-b border-slate-100 flex-shrink-0">
        <textarea
          v-model="qrContent"
          :placeholder="t('qr.content_placeholder')"
          rows="4"
          class="w-full resize-y min-h-[56px] max-h-[200px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
        />
      </div>

      <!-- Config (flex-1, scrollable) + Preview (fixed right) -->
      <div class="flex-1 flex min-h-0 overflow-hidden">

        <!-- ── Config panel ── -->
        <div class="flex-1 overflow-y-auto p-5 space-y-3">

          <!-- Quick style presets -->
          <div class="bg-white border border-slate-200 rounded-xl p-3.5">
            <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2.5">{{ t('qr.presets') }}</p>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="preset in presets"
                :key="preset.key"
                @click="applyPreset(preset.key)"
                class="flex flex-col items-center gap-1.5 py-2.5 rounded-lg border text-[11px] font-medium transition-all"
                :class="activePreset === preset.key
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'"
              >
                <span class="text-lg leading-none">{{ preset.icon }}</span>
                {{ preset.label }}
              </button>
            </div>
          </div>

          <!-- Error Correction + QR Version (2-col) -->
          <div class="grid grid-cols-2 gap-3">
            <div class="bg-white border border-slate-200 rounded-xl p-3.5">
              <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{{ t('qr.error_correction') }}</p>
              <div class="flex gap-1">
                <button
                  v-for="lvl in (['L','M','Q','H'] as const)"
                  :key="lvl"
                  @click="errorCorrection = lvl; activePreset = null"
                  class="flex-1 py-1.5 text-xs font-bold rounded-md border transition-all"
                  :class="errorCorrection === lvl
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'"
                >{{ lvl }}</button>
              </div>
              <p class="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{{ ecLevelDesc }}</p>
            </div>
            <div class="bg-white border border-slate-200 rounded-xl p-3.5">
              <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{{ t('qr.version') }}</p>
              <div class="flex items-center gap-2">
                <select
                  v-model.number="qrVersion"
                  class="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 h-8 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                >
                  <option :value="0">{{ t('qr.version_auto') }}</option>
                  <option v-for="v in 10" :key="v" :value="v">V{{ v }}</option>
                </select>
                <span v-if="qrVersion > 0" class="text-[11px] font-mono text-slate-400 whitespace-nowrap">{{ qrVersion * 4 + 17 }}×{{ qrVersion * 4 + 17 }}</span>
              </div>
              <p class="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{{ t('qr.version_hint') }}</p>
            </div>
          </div>

          <!-- Dot Style + Corner Style (2-col) -->
          <div class="grid grid-cols-2 gap-3">
            <div class="bg-white border border-slate-200 rounded-xl p-3.5">
              <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{{ t('qr.dot_style') }}</p>
              <div class="grid grid-cols-3 gap-1.5">
                <button
                  v-for="style in dotStyles"
                  :key="style.value"
                  @click="dotStyle = style.value; activePreset = null"
                  class="flex flex-col items-center gap-1 py-2 px-1 rounded-lg border text-[11px] font-medium transition-all"
                  :class="dotStyle === style.value
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'"
                >
                  <span class="text-base leading-none">{{ style.icon }}</span>
                  {{ style.label }}
                </button>
              </div>
            </div>
            <div class="bg-white border border-slate-200 rounded-xl p-3.5">
              <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{{ t('qr.corner_style') }}</p>
              <div class="grid grid-cols-3 gap-1.5">
                <button
                  v-for="style in cornerStyles"
                  :key="style.value"
                  @click="cornerSquareStyle = style.value; activePreset = null"
                  class="flex flex-col items-center gap-1 py-2 px-1 rounded-lg border text-[11px] font-medium transition-all"
                  :class="cornerSquareStyle === style.value
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'"
                >
                  <span class="text-base leading-none">{{ style.icon }}</span>
                  {{ style.label }}
                </button>
              </div>
            </div>
          </div>

          <!-- Colors + Logo (2-col) -->
          <div class="grid grid-cols-2 gap-3">
            <div class="bg-white border border-slate-200 rounded-xl p-3.5">
              <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{{ t('qr.colors') }}</p>
              <div class="flex flex-col gap-2.5">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-slate-600 font-medium">{{ t('qr.fg_color') }}</span>
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-mono text-slate-400">{{ fgColor.toUpperCase() }}</span>
                    <label class="w-7 h-7 rounded-md border-2 border-slate-200 overflow-hidden cursor-pointer shadow-sm">
                      <input type="color" v-model="fgColor" class="w-10 h-10 -translate-x-1 -translate-y-1 cursor-pointer" />
                    </label>
                  </div>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-xs text-slate-600 font-medium">{{ t('qr.bg_color') }}</span>
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-mono text-slate-400">{{ bgColor.toUpperCase() }}</span>
                    <label class="w-7 h-7 rounded-md border-2 border-slate-200 overflow-hidden cursor-pointer shadow-sm">
                      <input type="color" v-model="bgColor" class="w-10 h-10 -translate-x-1 -translate-y-1 cursor-pointer" />
                    </label>
                  </div>
                </div>
              </div>
            </div>
            <div class="bg-white border border-slate-200 rounded-xl p-3.5">
              <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{{ t('qr.logo') }}</p>
              <div class="flex flex-col gap-2.5">
                <div class="flex items-center gap-2 flex-wrap">
                  <button
                    @click="triggerLogoInput"
                    class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 transition-colors"
                  >
                    <ImageIcon class="w-3.5 h-3.5" />
                    {{ logoFile ? t('qr.logo_change') : t('qr.logo_upload') }}
                  </button>
                  <button
                    v-if="logoFile"
                    @click="clearLogo"
                    class="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                  >
                    <X class="w-3 h-3" />
                    {{ t('qr.logo_remove') }}
                  </button>
                  <input ref="logoInput" type="file" accept="image/*" class="hidden" @change="handleLogoSelect" />
                </div>
                <div v-if="logoPreviewUrl" class="flex items-center gap-2">
                  <img :src="logoPreviewUrl" class="w-8 h-8 rounded-md border border-slate-200 object-contain bg-slate-50 flex-shrink-0" />
                  <span class="text-[11px] text-slate-400 truncate">{{ logoFile?.name }}</span>
                </div>
                <div v-if="logoFile" class="space-y-1.5">
                  <div class="flex flex-col gap-0.5">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] text-slate-500">{{ t('qr.logo_size') }}</span>
                      <span class="text-[11px] font-mono text-slate-400">{{ logoSize }}%</span>
                    </div>
                    <input type="range" v-model.number="logoSize" min="10" max="40" step="1"
                      class="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-indigo-600 bg-slate-200" />
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] text-slate-500">{{ t('qr.logo_margin') }}</span>
                      <span class="text-[11px] font-mono text-slate-400">{{ logoMargin }}px</span>
                    </div>
                    <input type="range" v-model.number="logoMargin" min="0" max="20" step="1"
                      class="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-indigo-600 bg-slate-200" />
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- ── Preview panel (fixed width) ── -->
        <div class="w-[240px] flex-shrink-0 border-l border-slate-100 flex flex-col p-4 gap-3">
          <span class="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
            <QrCodeIcon class="w-3.5 h-3.5" />
            {{ t('qr.preview') }}
          </span>

          <!-- QR preview box -->
          <div ref="previewBox" class="w-full aspect-square rounded-xl border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
            <div v-if="!qrContent.trim()" class="text-center px-4">
              <QrCodeIcon class="w-10 h-10 mx-auto mb-2 text-slate-200" />
              <p class="text-xs text-slate-300 select-none leading-relaxed">{{ t('qr.preview_empty') }}</p>
            </div>
            <div ref="qrContainer" class="qr-container" />
          </div>

          <!-- Export size + Download -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-xs text-slate-500 font-medium">{{ t('qr.export_size') }}</span>
              <select v-model.number="exportScale" class="text-xs bg-white border border-slate-200 rounded-md pl-2 pr-6 h-7 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer">
                <option :value="1">1× (300px)</option>
                <option :value="2">2× (600px)</option>
                <option :value="3">3× (900px)</option>
                <option :value="4">4× (1200px)</option>
              </select>
            </div>
            <button
              @click="downloadQr"
              :disabled="!qrContent.trim() || saveStatus !== 'idle'"
              class="flex items-center gap-1.5 px-4 py-2 text-xs font-bold border rounded-lg transition-all shadow-sm justify-center w-full"
              :class="{
                'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100': saveStatus === 'idle' && qrContent.trim(),
                'text-white bg-green-600 border-green-600': saveStatus === 'success',
                'text-white bg-red-600 border-red-600': saveStatus === 'error',
                'opacity-40 cursor-not-allowed border-slate-200 text-slate-400 bg-white': !qrContent.trim()
              }"
            >
              <template v-if="saveStatus === 'idle'"><Download class="w-3.5 h-3.5" /> {{ t('common.download') }}</template>
              <template v-else-if="saveStatus === 'success'"><Check class="w-3.5 h-3.5" /> {{ t('common.saved') }}</template>
              <template v-else><XIcon class="w-3.5 h-3.5" /> {{ t('common.failed') }}</template>
            </button>
          </div>
        </div>

      </div>
    </template>

    <!-- ══════════════ DECODE TAB ══════════════ -->
    <template v-if="activeTab === 'decode'">
      <div class="flex-1 flex flex-col gap-4 p-6 min-h-0">

        <div v-if="decodeError" class="p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100 flex items-center gap-2">
          <span>⚠️</span> {{ decodeError }}
        </div>

        <p class="text-slate-500 text-sm">
          <i18n-t keypath="qr.decode_hint" tag="span">
            <template #binding>
              <span class="font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">Ctrl + V</span>
            </template>
          </i18n-t>
        </p>

        <div class="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 min-h-0">

          <!-- Image upload area -->
          <div class="flex flex-col h-full">
            <div class="flex items-center justify-between mb-2 h-8">
              <span class="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <ImageIcon class="w-4 h-4" /> {{ t('qr.scan_image') }}
              </span>
              <button
                v-if="decodeImageUrl"
                @click="clearDecode"
                class="flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors shadow-sm"
              >
                <Trash2 class="w-3.5 h-3.5" /> {{ t('common.clear') }}
              </button>
            </div>
            <div
              class="relative flex-1 rounded-xl border-2 transition-all overflow-hidden flex items-center justify-center bg-slate-50 group"
              :class="decodeImageUrl ? 'border-slate-200' : 'border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer'"
              @click="!decodeImageUrl ? triggerDecodeInput() : null"
              @dragover.prevent="isDecodeDragging = true"
              @dragleave.prevent="isDecodeDragging = false"
              @drop.prevent="handleDecodeDrop"
            >
              <input ref="decodeFileInput" type="file" accept="image/*" class="hidden" @change="handleDecodeFileSelect" />
              <img v-if="decodeImageUrl" :src="decodeImageUrl" class="max-w-full max-h-full object-contain p-2" />
              <div v-else class="text-center p-6 pointer-events-none">
                <div class="w-14 h-14 bg-white rounded-full shadow-sm mx-auto mb-3 flex items-center justify-center">
                  <ScanLine class="w-7 h-7 text-indigo-500" />
                </div>
                <p class="text-sm text-slate-500 font-medium">{{ t('qr.decode_upload_prompt') }}</p>
              </div>
              <div v-if="isDecodeDragging" class="absolute inset-0 bg-indigo-500/10 border-2 border-indigo-500 rounded-xl z-20 flex items-center justify-center backdrop-blur-sm">
                <span class="text-indigo-600 font-bold">{{ t('image.drop_to_upload') }}</span>
              </div>
            </div>
          </div>

          <!-- Decoded result -->
          <div class="flex flex-col h-full">
            <div class="flex items-center justify-between mb-2 h-8">
              <span class="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <FileText class="w-4 h-4" /> {{ t('qr.decode_result') }}
              </span>
              <button
                v-if="decodedText"
                @click="copyDecoded"
                class="flex items-center gap-1.5 px-3 py-1 text-xs font-bold border rounded-md transition-all shadow-sm min-w-[70px] justify-center"
                :class="{
                  'text-indigo-700 bg-indigo-50 border-indigo-200 hover:bg-indigo-100': copyStatus === 'idle',
                  'text-white bg-green-600 border-green-600': copyStatus === 'success',
                }"
              >
                <template v-if="copyStatus === 'idle'"><Copy class="w-3.5 h-3.5" /> {{ t('common.copy') }}</template>
                <template v-else><Check class="w-3.5 h-3.5" /> {{ t('common.copied') }}</template>
              </button>
            </div>
            <div class="relative flex-1 rounded-xl border border-slate-200 bg-white flex items-start p-4 overflow-auto">
              <div v-if="isDecoding" class="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                <Loader2 class="w-6 h-6 animate-spin text-indigo-600" />
              </div>
              <div v-if="decodedText" class="w-full">
                <div v-if="isUrl(decodedText)" class="mb-3 flex items-center gap-2 p-2 bg-indigo-50 rounded-lg border border-indigo-100">
                  <Link2 class="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />
                  <span class="text-xs text-indigo-600 font-medium truncate">{{ t('qr.detected_url') }}</span>
                </div>
                <p class="text-sm text-slate-700 break-all font-mono leading-relaxed">{{ decodedText }}</p>
              </div>
              <div v-else-if="!isDecoding && !decodeImageUrl" class="text-slate-300 text-sm select-none w-full text-center pt-8">
                <ScanLine class="w-8 h-8 mx-auto mb-2 opacity-40" />
                {{ t('common.no_content') }}
              </div>
              <div v-else-if="!isDecoding && decodeImageUrl && !decodedText && !decodeError" class="text-slate-400 text-sm select-none w-full text-center pt-8">
                {{ t('qr.no_qr_found') }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import QRCodeStyling from 'qr-code-styling';
import jsQR from 'jsqr';
import {
  QrCode as QrCodeIcon, Image as ImageIcon, ScanLine, FileText,
  Download, History, Trash2, Copy, Check, X, Loader2, Link2
} from 'lucide-vue-next';
const XIcon = X;
import { addHistoryRecord, loadHistory } from '../../stores/qrCode';

const { t } = useI18n();

// ── Tabs ──────────────────────────────────────────────────────────────────────
const tabs = computed(() => [
  { key: 'generate' as const, label: t('qr.tab_generate'), icon: QrCodeIcon },
  { key: 'decode' as const, label: t('qr.tab_decode'), icon: ScanLine },
]);
const activeTab = ref<'generate' | 'decode'>('generate');

// ── Generate state ─────────────────────────────────────────────────────────────
const qrContent = ref('https://');
const errorCorrection = ref<'L' | 'M' | 'Q' | 'H'>('M');
const qrVersion = ref<number>(0); // 0 = auto
const dotStyle = ref('rounded');
const cornerSquareStyle = ref('extra-rounded');
const fgColor = ref('#000000');
const bgColor = ref('#ffffff');
const logoFile = ref<File | null>(null);
const logoPreviewUrl = ref<string | null>(null);
const logoDataUrl = ref<string | null>(null);
const logoSize = ref(30);
const logoMargin = ref(5);
const exportScale = ref(1);
const saveStatus = ref<'idle' | 'success' | 'error'>('idle');
const activePreset = ref<string | null>(null);

// ── Presets ────────────────────────────────────────────────────────────────────
const presets = computed(() => [
  { key: 'classic',  icon: '▪', label: t('qr.preset_classic') },
  { key: 'soft',     icon: '▣', label: t('qr.preset_soft') },
  { key: 'artistic', icon: '⬤', label: t('qr.preset_artistic') },
]);

function applyPreset(key: string) {
  if (key === 'classic') {
    dotStyle.value = 'square';
    cornerSquareStyle.value = 'square';
    errorCorrection.value = 'M';
  } else if (key === 'soft') {
    dotStyle.value = 'rounded';
    cornerSquareStyle.value = 'extra-rounded';
    errorCorrection.value = 'M';
  } else if (key === 'artistic') {
    dotStyle.value = 'dots';
    cornerSquareStyle.value = 'dot';
    errorCorrection.value = 'H';
  }
  activePreset.value = key;
}

// ── QR instance ────────────────────────────────────────────────────────────────
const qrContainer = ref<HTMLDivElement | null>(null);
const previewBox = ref<HTMLDivElement | null>(null);
const previewSize = ref(200);
let previewObserver: ResizeObserver | null = null;
const logoInput = ref<HTMLInputElement | null>(null);
let qrInstance: QRCodeStyling | null = null;

const ecLevelDesc = computed(() => {
  const descs: Record<string, string> = {
    L: t('qr.ec_l'), M: t('qr.ec_m'), Q: t('qr.ec_q'), H: t('qr.ec_h'),
  };
  return descs[errorCorrection.value];
});

const dotStyles = computed(() => [
  { value: 'square',         icon: '▪', label: t('qr.dot_square') },
  { value: 'dots',           icon: '●', label: t('qr.dot_dots') },
  { value: 'rounded',        icon: '▣', label: t('qr.dot_rounded') },
  { value: 'classy',         icon: '◈', label: t('qr.dot_classy') },
  { value: 'classy-rounded', icon: '◉', label: t('qr.dot_classy_rounded') },
  { value: 'extra-rounded',  icon: '⬬', label: t('qr.dot_extra_rounded') },
]);

const cornerStyles = computed(() => [
  { value: 'square',        icon: '▪', label: t('qr.corner_square') },
  { value: 'extra-rounded', icon: '⬤', label: t('qr.corner_rounded') },
  { value: 'dot',           icon: '●', label: t('qr.corner_dot') },
]);

function buildQrOptions(size = previewSize.value) {
  return {
    width: size,
    height: size,
    type: 'canvas' as const,
    data: qrContent.value.trim() || ' ',
    margin: Math.round(size * 0.04),
    qrOptions: {
      typeNumber: qrVersion.value as any,
      mode: 'Byte' as const,
      errorCorrectionLevel: errorCorrection.value,
    },
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: logoSize.value / 100,
      margin: logoMargin.value,
      crossOrigin: 'anonymous' as const,
    },
    dotsOptions: {
      color: fgColor.value,
      type: dotStyle.value as any,
    },
    backgroundOptions: {
      color: bgColor.value,
    },
    cornersSquareOptions: {
      color: fgColor.value,
      type: cornerSquareStyle.value as any,
    },
    cornersDotOptions: {
      color: fgColor.value,
      type: 'dot' as const,
    },
    image: logoDataUrl.value ?? undefined,
  };
}

function initQr() {
  if (!qrContainer.value) return;
  qrContainer.value.innerHTML = '';
  qrInstance = new QRCodeStyling(buildQrOptions());
  qrInstance.append(qrContainer.value);
}

function updateQr() {
  if (!qrInstance || !qrContent.value.trim()) {
    if (qrContainer.value) qrContainer.value.innerHTML = '';
    qrInstance = null;
    return;
  }
  qrInstance.update(buildQrOptions());
}

let updateTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleUpdate() {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    if (qrContent.value.trim() && !qrInstance) initQr();
    else updateQr();
    updateTimer = null;
  }, 250);
}

watch([qrContent, errorCorrection, qrVersion, dotStyle, cornerSquareStyle, fgColor, bgColor, logoDataUrl, logoSize, logoMargin], scheduleUpdate);

const triggerLogoInput = () => {
  if (logoInput.value) logoInput.value.value = '';
  logoInput.value?.click();
};

function handleLogoSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  loadLogoFile(file);
}

function loadLogoFile(file: File) {
  if (logoPreviewUrl.value) URL.revokeObjectURL(logoPreviewUrl.value);
  logoFile.value = file;
  logoPreviewUrl.value = URL.createObjectURL(file);
  const reader = new FileReader();
  reader.onload = (ev) => { logoDataUrl.value = ev.target?.result as string; };
  reader.readAsDataURL(file);
}

function clearLogo() {
  if (logoPreviewUrl.value) URL.revokeObjectURL(logoPreviewUrl.value);
  logoFile.value = null;
  logoPreviewUrl.value = null;
  logoDataUrl.value = null;
}

async function downloadQr() {
  if (!qrContent.value.trim()) return;
  try {
    const size = 300 * exportScale.value;
    const tempQr = new QRCodeStyling(buildQrOptions(size));
    const blob = await tempQr.getRawData('png') as Blob | null;
    if (!blob) throw new Error('No blob returned');

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qrcode-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);

    saveStatus.value = 'success';
    setTimeout(() => { saveStatus.value = 'idle'; }, 2000);

    ;(async () => {
      try {
        const previewBlob = await new QRCodeStyling(buildQrOptions(300)).getRawData('png') as Blob | null;
        if (previewBlob) {
          const data = new Uint8Array(await (previewBlob as Blob).arrayBuffer());
          await addHistoryRecord({
            type: 'generate',
            content: qrContent.value.trim(),
            dotStyle: dotStyle.value,
            cornerSquareStyle: cornerSquareStyle.value,
            fgColor: fgColor.value,
            bgColor: bgColor.value,
            hasLogo: !!logoFile.value,
          }, data);
        }
      } catch (e) {
        console.error('qrcode: failed to save history', e);
      }
    })();
  } catch (e) {
    console.error('qrcode: download failed', e);
    saveStatus.value = 'error';
    setTimeout(() => { saveStatus.value = 'idle'; }, 3000);
  }
}

// ── Decode state ───────────────────────────────────────────────────────────────
const decodeFileInput = ref<HTMLInputElement | null>(null);
const decodeImageUrl = ref<string | null>(null);
const decodeFile = ref<File | null>(null);
const decodedText = ref<string | null>(null);
const decodeError = ref<string | null>(null);
const isDecoding = ref(false);
const isDecodeDragging = ref(false);
const copyStatus = ref<'idle' | 'success'>('idle');

const isUrl = (s: string) => {
  try { new URL(s); return true; } catch { return false; }
};

function triggerDecodeInput() {
  if (decodeFileInput.value) decodeFileInput.value.value = '';
  decodeFileInput.value?.click();
}
function handleDecodeFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) handleDecodeFile(file);
}
function handleDecodeDrop(e: DragEvent) {
  isDecodeDragging.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) handleDecodeFile(file);
}
function clearDecode() {
  if (decodeImageUrl.value) URL.revokeObjectURL(decodeImageUrl.value);
  decodeImageUrl.value = null;
  decodeFile.value = null;
  decodedText.value = null;
  decodeError.value = null;
}

async function handleDecodeFile(file: File) {
  if (!file.type.startsWith('image/')) {
    decodeError.value = t('image.errors.upload_image');
    return;
  }
  if (decodeImageUrl.value) URL.revokeObjectURL(decodeImageUrl.value);
  decodeFile.value = file;
  decodeImageUrl.value = URL.createObjectURL(file);
  decodedText.value = null;
  decodeError.value = null;
  await decodeQr(file);
}

async function decodeQr(file: File) {
  isDecoding.value = true;
  decodeError.value = null;
  try {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.src = objUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image load failed'));
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context failed');
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(objUrl);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });

    if (code) {
      decodedText.value = code.data;
      ;(async () => {
        try {
          const imgData = new Uint8Array(await file.arrayBuffer());
          await addHistoryRecord({ type: 'decode', decodedText: code.data, originalName: file.name }, imgData);
        } catch (e) {
          console.error('qrcode: failed to save decode history', e);
        }
      })();
    } else {
      decodedText.value = null;
    }
  } catch (e: any) {
    decodeError.value = t('qr.decode_error') + ': ' + (e?.message ?? '');
  } finally {
    isDecoding.value = false;
  }
}

async function copyDecoded() {
  if (!decodedText.value) return;
  try {
    await navigator.clipboard.writeText(decodedText.value);
    copyStatus.value = 'success';
    setTimeout(() => { copyStatus.value = 'idle'; }, 2000);
  } catch {}
}

// ── Clipboard paste ────────────────────────────────────────────────────────────
const handlePaste = (e: ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) { if (activeTab.value === 'decode') handleDecodeFile(file); break; }
    }
  }
};

onMounted(async () => {
  window.addEventListener('paste', handlePaste);
  await loadHistory();
  await nextTick();
  if (previewBox.value) {
    previewObserver = new ResizeObserver(entries => {
      const size = Math.floor(entries[0]?.contentRect.width ?? 200);
      if (size > 50 && size !== previewSize.value) {
        previewSize.value = size;
        if (qrContent.value.trim()) {
          if (qrContainer.value) qrContainer.value.innerHTML = '';
          qrInstance = null;
          initQr();
        }
      }
    });
    previewObserver.observe(previewBox.value);
  }
  if (qrContent.value.trim()) initQr();
});

onUnmounted(() => {
  window.removeEventListener('paste', handlePaste);
  previewObserver?.disconnect();
  if (logoPreviewUrl.value) URL.revokeObjectURL(logoPreviewUrl.value);
  if (decodeImageUrl.value) URL.revokeObjectURL(decodeImageUrl.value);
  if (updateTimer) clearTimeout(updateTimer);
});

watch(activeTab, async (tab) => {
  if (tab === 'generate') {
    await nextTick();
    if (qrContent.value.trim()) initQr();
  }
});
</script>

<style scoped>
.qr-container :deep(canvas) {
  border-radius: 8px;
}
</style>
