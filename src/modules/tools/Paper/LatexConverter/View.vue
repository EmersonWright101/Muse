<template>
  <div class="w-full max-w-7xl mx-auto pb-10 p-8">

    <!-- Two-panel layout -->
    <div class="grid grid-cols-[1fr_48px_1fr] gap-2 items-start">

      <!-- ── Left: Input panel ── -->
      <div class="space-y-3">
        <!-- Format selector + history button -->
        <div class="flex flex-wrap items-center justify-between gap-y-1.5">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider shrink-0">
              {{ t('format_converter.from_label') }}
            </span>
            <div class="flex gap-1">
              <button
                v-for="fmt in formats"
                :key="fmt.value"
                @click="fromFormat = fmt.value"
                class="px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 whitespace-nowrap"
                :class="fromFormat === fmt.value
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
              >
                {{ fmt.label }}
              </button>
            </div>
          </div>
          <button
            @click="router.push('/tools/paper/format-converter/history')"
            class="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all shrink-0 whitespace-nowrap"
          >
            <History class="w-3.5 h-3.5" />
            {{ t('format_converter.history.btn') }}
          </button>
        </div>

        <!-- Input textarea -->
        <div class="relative">
          <textarea
            v-model="inputText"
            spellcheck="false"
            class="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 h-[480px] text-slate-700 text-sm font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none shadow-sm"
            :placeholder="t('format_converter.input_placeholder')"
          ></textarea>
          <span
            v-if="inputText"
            class="absolute bottom-3 right-3 text-[11px] text-slate-300 select-none tabular-nums"
          >
            {{ inputText.length }}
          </span>
        </div>

        <!-- Clear button -->
        <div class="flex justify-end h-7">
          <Transition name="fade">
            <button
              v-if="inputText"
              @click="inputText = ''"
              class="text-xs text-slate-400 hover:text-red-500 transition-colors px-2 py-1 rounded-md hover:bg-red-50 flex items-center gap-1"
            >
              <XCircle class="w-3.5 h-3.5" />
              {{ t('common.clear') }}
            </button>
          </Transition>
        </div>
      </div>

      <!-- ── Center: Swap button ── -->
      <div class="flex items-start justify-center pt-8">
        <button
          @click="swapFormats"
          class="p-2.5 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-300 hover:shadow-md transition-all active:scale-95"
          :title="t('format_converter.swap')"
        >
          <ArrowLeftRight class="w-4 h-4" />
        </button>
      </div>

      <!-- ── Right: Output panel ── -->
      <div class="space-y-3">
        <!-- Format selector + copy button -->
        <div class="flex flex-wrap items-center justify-between gap-y-1.5">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider shrink-0">
              {{ t('format_converter.to_label') }}
            </span>
            <div class="flex gap-1">
              <button
                v-for="fmt in formats"
                :key="fmt.value"
                @click="toFormat = fmt.value"
                class="px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 whitespace-nowrap"
                :class="toFormat === fmt.value
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
              >
                {{ fmt.label }}
              </button>
            </div>
          </div>

          <Transition name="fade">
            <button
              v-if="outputText"
              @click="copyOutput"
              class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-all duration-200 active:scale-95 border border-transparent shrink-0"
              :class="copied
                ? 'text-green-600 bg-green-50 border-green-100'
                : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50/80 hover:border-blue-100'"
            >
              <component :is="copied ? Check : Clipboard" class="w-3.5 h-3.5" />
              {{ copied ? t('common.copied') : t('format_converter.copy_result') }}
            </button>
          </Transition>
        </div>

        <!-- Output area -->
        <div class="w-full bg-white border border-slate-200 rounded-xl p-4 h-[480px] shadow-sm overflow-auto">
          <Transition name="slide-fade" mode="out-in">
            <pre
              v-if="outputText"
              :key="cacheKey"
              class="text-slate-800 text-sm font-mono leading-relaxed select-text whitespace-pre-wrap break-words m-0"
            >{{ outputText }}</pre>
            <span v-else class="text-slate-300 italic text-sm select-none">
              {{ t('common.waiting_input') }}...
            </span>
          </Transition>
        </div>

        <!-- Char count -->
        <div class="flex justify-end h-7">
          <span
            v-if="outputText"
            class="text-[11px] text-slate-300 select-none tabular-nums self-center"
          >
            {{ outputText.length }}
          </span>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { History, XCircle, Clipboard, Check, ArrowLeftRight } from 'lucide-vue-next';
import { convert, type ConversionFormat } from './converter';
import { addHistoryRecord, loadHistory, pendingRestore } from '../../stores/latexConverter';

const { t } = useI18n();
const router = useRouter();

const inputText  = ref('');
const fromFormat = ref<ConversionFormat>('latex');
const toFormat   = ref<ConversionFormat>('plaintext');
const copied     = ref(false);

const formats = computed(() => [
  { label: 'LaTeX',     value: 'latex'     as ConversionFormat },
  { label: 'Markdown',  value: 'markdown'  as ConversionFormat },
  { label: t('format_converter.format_plaintext'), value: 'plaintext' as ConversionFormat },
]);

const outputText = computed(() =>
  convert(inputText.value, fromFormat.value, toFormat.value)
);

// Key used to re-trigger slide-fade when output changes
const cacheKey = computed(() => `${fromFormat.value}-${toFormat.value}-${outputText.value.slice(0, 40)}`);

function swapFormats() {
  const prevFrom   = fromFormat.value;
  const prevTo     = toFormat.value;
  const prevOutput = outputText.value;
  fromFormat.value = prevTo;
  toFormat.value   = prevFrom;
  if (prevOutput) inputText.value = prevOutput;
}

async function copyOutput() {
  if (!outputText.value || copied.value) return;
  await navigator.clipboard.writeText(outputText.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
  addHistoryRecord({
    fromFormat: fromFormat.value,
    toFormat:   toFormat.value,
    inputText:  inputText.value,
    outputText: outputText.value,
  });
}

onMounted(() => {
  loadHistory();
  if (pendingRestore.value) {
    const r = pendingRestore.value;
    pendingRestore.value = null;
    inputText.value  = r.inputText;
    fromFormat.value = r.fromFormat;
    toFormat.value   = r.toFormat;
  }
});
</script>

<style scoped>
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.15s cubic-bezier(0.25, 1, 0.5, 1);
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(4px);
  opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
