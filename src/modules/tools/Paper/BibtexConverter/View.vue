<template>
  <div class="w-full max-w-6xl mx-auto space-y-8 pb-10 p-8">

    <!-- BibTeX Input -->
    <div class="space-y-3">
      <div class="flex items-center justify-between ml-1">
        <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {{ t('bibtex.input_label') }}
        </label>
        <div class="flex items-center gap-1">
          <button
            v-if="inputText"
            @click="inputText = ''"
            class="text-xs text-slate-400 hover:text-red-500 transition-colors px-2 py-1 rounded-md hover:bg-red-50 flex items-center gap-1"
          >
            <XCircle class="w-3.5 h-3.5" />
            <span>{{ t('common.clear') }}</span>
          </button>
          <button
            @click="router.push('/tools/paper/bibtex/history')"
            class="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
          >
            <History class="w-3.5 h-3.5" />
            {{ t('bibtex.history.btn') }}
          </button>
        </div>
      </div>

      <div class="relative">
        <textarea
          v-model="inputText"
          spellcheck="false"
          class="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 min-h-[420px] text-slate-700 text-sm font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-y shadow-sm"
          :placeholder="t('bibtex.input_prompt')"
        ></textarea>

        <!-- Entry count badge -->
        <Transition name="fade">
          <span
            v-if="entryCount > 0"
            class="absolute bottom-3 right-3 text-[11px] font-medium text-blue-500 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full select-none"
          >
            {{ t('bibtex.entries_found', { count: entryCount }) }}
          </span>
        </Transition>
      </div>
    </div>

    <!-- Format selector (sliding tab) -->
    <div>
      <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1 mb-3">
        {{ t('bibtex.format_label') }}
      </p>
      <div class="relative bg-slate-100/80 p-1 rounded-lg inline-flex shadow-inner border border-slate-200/50 backdrop-blur-sm">
        <div
          class="absolute top-1 bottom-1 bg-white rounded-md shadow-sm ring-1 ring-black/5 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]"
          :style="gliderStyle"
        ></div>

        <button
          v-for="(fmt, index) in formats"
          :key="fmt.value"
          :ref="(el) => { if (el) buttonRefs[index] = el as HTMLButtonElement }"
          @click="switchFormat(fmt.value)"
          class="relative z-10 px-5 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 whitespace-nowrap"
          :class="currentFormat === fmt.value ? 'text-slate-800' : 'text-slate-500 hover:text-slate-600'"
        >
          {{ fmt.label }}
        </button>
      </div>
    </div>

    <!-- Output -->
    <div class="space-y-3">
      <div class="flex items-center justify-between ml-1 h-8">
        <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {{ t('bibtex.output_label') }}
        </label>

        <Transition name="fade">
          <button
            v-if="resultText"
            @click="copyToClipboard"
            class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-all duration-200 active:scale-95 border border-transparent"
            :class="copied ? 'text-green-600 bg-green-50 border-green-100' : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50/80 hover:border-blue-100'"
          >
            <component :is="copied ? Check : Clipboard" class="w-3.5 h-3.5 transition-transform" :class="{ 'scale-110': copied }" />
            <span>{{ copied ? t('common.copied') : t('bibtex.copy_result') }}</span>
          </button>
        </Transition>
      </div>

      <div class="w-full bg-white border border-slate-200 rounded-xl p-4 min-h-[120px] shadow-sm">
        <Transition name="slide-fade" mode="out-in">
          <div
            v-if="resultText"
            :key="resultText + currentFormat"
            class="space-y-4"
          >
            <p
              v-for="(line, i) in resultLines"
              :key="i"
              class="text-slate-800 text-sm leading-relaxed select-text whitespace-pre-wrap"
              v-html="line"
            ></p>
          </div>
          <div v-else-if="inputText && entryCount === 0" class="flex items-center gap-2 text-amber-500 text-sm">
            <AlertCircle class="w-4 h-4 shrink-0" />
            <span>{{ t('bibtex.no_entries') }}</span>
          </div>
          <span v-else class="text-slate-300 italic text-sm select-none">{{ t('common.waiting_input') }}...</span>
        </Transition>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { Clipboard, Check, XCircle, AlertCircle, History } from 'lucide-vue-next';
import { formatBibtex, parseBibtex, type CitationFormat } from './bibtexConverter';
import { addHistoryRecord, loadHistory, pendingRestore } from '../../stores/bibtexConverter';

const { t } = useI18n();
const router = useRouter();

const inputText = ref('');
const currentFormat = ref<CitationFormat>('ieee');
const copied = ref(false);

const buttonRefs = ref<HTMLButtonElement[]>([]);
const gliderStyle = ref({ width: '0px', transform: 'translateX(0px)', opacity: '0' });

const formats = computed(() => [
  { label: t('bibtex.formats.ieee'),   value: 'ieee'   as CitationFormat },
  { label: t('bibtex.formats.apa'),    value: 'apa'    as CitationFormat },
  { label: t('bibtex.formats.gb7714'), value: 'gb7714' as CitationFormat },
]);

const entryCount = computed(() => parseBibtex(inputText.value).length);

const resultText = computed(() =>
  inputText.value.trim() ? formatBibtex(inputText.value, currentFormat.value) : ''
);

const resultLines = computed(() => resultText.value.split('\n\n').filter(Boolean));

// Sliding glider
const updateGlider = () => {
  const index = formats.value.findIndex(f => f.value === currentFormat.value);
  if (index < 0 || !buttonRefs.value[index]) return;
  const btn = buttonRefs.value[index];
  gliderStyle.value = {
    width: `${btn.offsetWidth}px`,
    transform: `translateX(${btn.offsetLeft}px)`,
    opacity: '1',
  };
};

const switchFormat = (fmt: CitationFormat) => {
  currentFormat.value = fmt;
  updateGlider();
};

onMounted(() => {
  setTimeout(() => nextTick(updateGlider), 100);
  window.addEventListener('resize', updateGlider);
  loadHistory();
  if (pendingRestore.value) {
    const record = pendingRestore.value;
    pendingRestore.value = null;
    inputText.value = record.inputText;
    currentFormat.value = record.format;
    nextTick(updateGlider);
  }
});

onUnmounted(() => {
  window.removeEventListener('resize', updateGlider);
});

const copyToClipboard = () => {
  if (!resultText.value || copied.value) return;
  const plainText = resultText.value.replace(/<[^>]+>/g, '');
  navigator.clipboard.writeText(plainText);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
  addHistoryRecord({
    inputText: inputText.value,
    outputText: resultText.value,
    format: currentFormat.value,
  });
};
</script>

<style scoped>
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s cubic-bezier(0.25, 1, 0.5, 1);
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(5px);
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
