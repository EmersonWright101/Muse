<template>
  <div class="w-full max-w-6xl mx-auto space-y-6 pb-10 p-8">

    <!-- Input panels -->
    <div class="grid grid-cols-2 gap-4">
      <div class="space-y-2">
        <div class="flex items-center justify-between h-5">
          <label class="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            {{ t('diff.original') }}
          </label>
          <span v-if="oldText" class="text-xs text-slate-400">{{ oldLineCount }} {{ t('diff.lines') }}</span>
        </div>
        <textarea
          ref="oldTextareaRef"
          v-model="oldText"
          :placeholder="t('diff.original_placeholder')"
          class="w-full h-44 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono text-slate-700 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          spellcheck="false"
        />
      </div>
      <div class="space-y-2">
        <div class="flex items-center justify-between h-5">
          <label class="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            {{ t('diff.modified') }}
          </label>
          <div class="flex items-center gap-3">
            <button
              @click="router.push('/tools/text/diff/history')"
              class="text-xs text-slate-400 hover:text-sky-600 transition-colors px-2 py-1 rounded-md hover:bg-sky-50 flex items-center gap-1"
            >
              <History class="w-3.5 h-3.5" />
              <span>{{ t('diff.history.btn') }}</span>
            </button>
            <span v-if="newText" class="text-xs text-slate-400">{{ newLineCount }} {{ t('diff.lines') }}</span>
          </div>
        </div>
        <textarea
          ref="newTextareaRef"
          v-model="newText"
          :placeholder="t('diff.modified_placeholder')"
          class="w-full h-44 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono text-slate-700 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          spellcheck="false"
        />
      </div>
    </div>

    <!-- Result area -->
    <div v-if="hasInput" class="space-y-4">

      <!-- Stats + controls bar -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div class="flex items-center gap-4 text-sm">
          <span v-if="stats.added" class="flex items-center gap-1 text-green-600 font-semibold">
            <Plus class="w-3.5 h-3.5" />{{ stats.added }} {{ t('diff.added') }}
          </span>
          <span v-if="stats.removed" class="flex items-center gap-1 text-red-500 font-semibold">
            <Minus class="w-3.5 h-3.5" />{{ stats.removed }} {{ t('diff.removed') }}
          </span>
          <span class="text-slate-400">{{ stats.unchanged }} {{ t('diff.unchanged') }}</span>
          <span v-if="!stats.added && !stats.removed" class="flex items-center gap-1.5 text-slate-500">
            <CheckCircle class="w-4 h-4 text-green-500" />
            {{ t('diff.no_changes') }}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <!-- Copy diff button -->
          <button
            v-if="stats.added || stats.removed"
            @click="copyDiff"
            class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-all duration-200 active:scale-95"
            :class="copied
              ? 'text-green-600 bg-green-50 border-green-100'
              : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50/80 hover:border-blue-100 border-transparent'"
          >
            <component :is="copied ? Check : Clipboard" class="w-3.5 h-3.5" />
            {{ copied ? t('common.copied') : t('diff.copy_diff') }}
          </button>

          <!-- Clear button -->
          <button
            @click="clearAll"
            class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border border-transparent text-slate-500 hover:text-red-600 hover:bg-red-50/80 hover:border-red-100 transition-all duration-200 active:scale-95"
          >
            <X class="w-3.5 h-3.5" />
            {{ t('common.clear') }}
          </button>

          <!-- View mode toggle -->
          <div
            v-if="stats.added || stats.removed"
            class="relative bg-slate-100/80 p-0.5 rounded-lg inline-flex shadow-inner border border-slate-200/50"
          >
            <div
              class="absolute top-0.5 bottom-0.5 bg-white rounded-md shadow-sm ring-1 ring-black/5 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]"
              :style="gliderStyle"
            />
            <button
              v-for="(mode, idx) in viewModes"
              :key="mode.value"
              :ref="(el) => { if (el) modeRefs[idx] = el as HTMLButtonElement }"
              @click="switchView(mode.value)"
              class="relative z-10 px-3 py-1 rounded-md text-xs font-medium transition-colors duration-200 whitespace-nowrap"
              :class="viewMode === mode.value ? 'text-slate-800' : 'text-slate-500 hover:text-slate-600'"
            >
              {{ mode.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Diff output -->
      <div v-if="stats.added || stats.removed" class="border border-slate-200 rounded-xl overflow-hidden shadow-sm">

        <!-- Column headers -->
        <div
          class="flex text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-200 bg-slate-50"
          :class="viewMode === 'split' ? 'divide-x divide-slate-200' : ''"
        >
          <template v-if="viewMode === 'unified'">
            <div class="w-12 shrink-0 py-2 text-center border-r border-slate-200">{{ t('diff.col_old') }}</div>
            <div class="w-12 shrink-0 py-2 text-center border-r border-slate-200">{{ t('diff.col_new') }}</div>
            <div class="flex-1 py-2 pl-8">{{ t('diff.col_content') }}</div>
          </template>
          <template v-else>
            <div class="flex-1 py-2 pl-16">{{ t('diff.original') }}</div>
            <div class="flex-1 py-2 pl-16">{{ t('diff.modified') }}</div>
          </template>
        </div>

        <!-- Scrollable diff body -->
        <div class="max-h-[560px] overflow-y-auto overflow-x-auto">

          <!-- Unified view -->
          <div v-if="viewMode === 'unified'">
            <div
              v-for="(line, idx) in diffLines"
              :key="idx"
              class="flex items-stretch text-sm font-mono leading-6 min-w-0"
              :class="{
                'bg-green-50 hover:bg-green-100/40': line.type === 'insert',
                'bg-red-50 hover:bg-red-100/40': line.type === 'delete',
                'hover:bg-slate-50': line.type === 'equal',
              }"
            >
              <!-- Old line num -->
              <div
                class="w-12 shrink-0 text-right pr-2 py-0.5 text-xs select-none border-r"
                :class="{
                  'text-red-400 bg-red-100/40 border-red-200/60': line.type === 'delete',
                  'text-green-400 bg-green-100/40 border-green-200/60': line.type === 'insert',
                  'text-slate-300 bg-slate-50/80 border-slate-100': line.type === 'equal',
                }"
              >{{ line.oldLineNum ?? '' }}</div>
              <!-- New line num -->
              <div
                class="w-12 shrink-0 text-right pr-2 py-0.5 text-xs select-none border-r"
                :class="{
                  'text-red-400 bg-red-100/40 border-red-200/60': line.type === 'delete',
                  'text-green-400 bg-green-100/40 border-green-200/60': line.type === 'insert',
                  'text-slate-300 bg-slate-50/80 border-slate-100': line.type === 'equal',
                }"
              >{{ line.newLineNum ?? '' }}</div>
              <!-- Indicator -->
              <div
                class="w-7 shrink-0 text-center py-0.5 select-none font-bold text-base"
                :class="{
                  'text-red-400': line.type === 'delete',
                  'text-green-500': line.type === 'insert',
                  'text-transparent': line.type === 'equal',
                }"
              >{{ line.type === 'delete' ? '−' : line.type === 'insert' ? '+' : '·' }}</div>
              <!-- Content -->
              <div
                class="flex-1 py-0.5 pl-1 pr-4 whitespace-pre"
                :class="{
                  'text-red-700': line.type === 'delete',
                  'text-green-700': line.type === 'insert',
                  'text-slate-600': line.type === 'equal',
                }"
              >{{ line.value || '\u00A0' }}</div>
            </div>
          </div>

          <!-- Split view -->
          <div v-else class="grid grid-cols-2 divide-x divide-slate-200">
            <!-- Left column (old) -->
            <div class="min-w-0 overflow-x-auto">
              <div
                v-for="(row, idx) in splitRows"
                :key="'l' + idx"
                class="flex items-stretch text-sm font-mono leading-6"
                :class="{
                  'bg-red-50 hover:bg-red-100/40': row.type === 'delete' || row.type === 'modified',
                  'bg-slate-50/40': row.type === 'insert',
                  'hover:bg-slate-50': row.type === 'equal',
                }"
              >
                <div
                  class="w-12 shrink-0 text-right pr-2 py-0.5 text-xs select-none border-r"
                  :class="{
                    'text-red-400 bg-red-100/40 border-red-200/60': row.type === 'delete' || row.type === 'modified',
                    'text-slate-300 bg-slate-50 border-slate-100': row.type === 'equal',
                    'bg-slate-50 border-slate-100': row.type === 'insert',
                  }"
                >{{ row.oldLineNum ?? '' }}</div>
                <div
                  class="w-6 shrink-0 text-center py-0.5 select-none font-bold"
                  :class="row.type === 'delete' || row.type === 'modified' ? 'text-red-400' : 'text-transparent'"
                >{{ (row.type === 'delete' || row.type === 'modified') ? '−' : '·' }}</div>
                <div
                  class="flex-1 py-0.5 pl-1 pr-3 whitespace-pre"
                  :class="{
                    'text-red-700': row.type === 'delete' || row.type === 'modified',
                    'text-slate-600': row.type === 'equal',
                    'text-slate-300 italic': row.type === 'insert',
                  }"
                >{{ row.type !== 'insert' ? (row.oldValue || '\u00A0') : '\u00A0' }}</div>
              </div>
            </div>
            <!-- Right column (new) -->
            <div class="min-w-0 overflow-x-auto">
              <div
                v-for="(row, idx) in splitRows"
                :key="'r' + idx"
                class="flex items-stretch text-sm font-mono leading-6"
                :class="{
                  'bg-green-50 hover:bg-green-100/40': row.type === 'insert' || row.type === 'modified',
                  'bg-slate-50/40': row.type === 'delete',
                  'hover:bg-slate-50': row.type === 'equal',
                }"
              >
                <div
                  class="w-12 shrink-0 text-right pr-2 py-0.5 text-xs select-none border-r"
                  :class="{
                    'text-green-400 bg-green-100/40 border-green-200/60': row.type === 'insert' || row.type === 'modified',
                    'text-slate-300 bg-slate-50 border-slate-100': row.type === 'equal',
                    'bg-slate-50 border-slate-100': row.type === 'delete',
                  }"
                >{{ row.newLineNum ?? '' }}</div>
                <div
                  class="w-6 shrink-0 text-center py-0.5 select-none font-bold"
                  :class="row.type === 'insert' || row.type === 'modified' ? 'text-green-500' : 'text-transparent'"
                >{{ (row.type === 'insert' || row.type === 'modified') ? '+' : '·' }}</div>
                <div
                  class="flex-1 py-0.5 pl-1 pr-3 whitespace-pre"
                  :class="{
                    'text-green-700': row.type === 'insert' || row.type === 'modified',
                    'text-slate-600': row.type === 'equal',
                    'text-slate-300 italic': row.type === 'delete',
                  }"
                >{{ row.type !== 'delete' ? (row.newValue || '\u00A0') : '\u00A0' }}</div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>

    <!-- Empty prompt -->
    <div v-else class="w-full bg-slate-50 border border-slate-200 rounded-xl p-10 flex items-center justify-center">
      <span class="text-slate-300 italic text-sm select-none">{{ t('diff.empty_prompt') }}</span>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { Plus, Minus, X, Check, Clipboard, CheckCircle, History } from 'lucide-vue-next';
import { computeDiff, toSplitRows, getDiffStats, diffToText } from './diffUtils';
import { addHistoryRecord, loadHistory, pendingRestore } from '../../stores/diffViewer';

const { t } = useI18n();
const router = useRouter();

const oldText = ref('');
const newText = ref('');
const copied  = ref(false);
const viewMode = ref<'unified' | 'split'>('unified');

const oldTextareaRef = ref<HTMLTextAreaElement | null>(null);
const newTextareaRef = ref<HTMLTextAreaElement | null>(null);

const oldLineCount = computed(() => oldText.value ? oldText.value.split('\n').length : 0);
const newLineCount = computed(() => newText.value ? newText.value.split('\n').length : 0);
const hasInput     = computed(() => oldText.value.trim() !== '' || newText.value.trim() !== '');

const diffLines = computed(() => {
  if (!hasInput.value) return [];
  return computeDiff(oldText.value, newText.value);
});

const splitRows = computed(() => toSplitRows(diffLines.value));
const stats     = computed(() => getDiffStats(diffLines.value));

// ─── View mode sliding tab ────────────────────────────────────────────────────

const modeRefs   = ref<HTMLButtonElement[]>([]);
const gliderStyle = ref({ width: '0px', transform: 'translateX(0px)', opacity: '0' });

const viewModes = computed(() => [
  { label: t('diff.unified'), value: 'unified' as const },
  { label: t('diff.split'),   value: 'split'   as const },
]);

const updateGlider = () => {
  const idx = viewModes.value.findIndex(m => m.value === viewMode.value);
  if (idx < 0 || !modeRefs.value[idx]) return;
  const btn = modeRefs.value[idx];
  gliderStyle.value = { width: `${btn.offsetWidth}px`, transform: `translateX(${btn.offsetLeft}px)`, opacity: '1' };
};

const switchView = (mode: 'unified' | 'split') => {
  viewMode.value = mode;
  updateGlider();
};

// ─── Sync textarea resize ─────────────────────────────────────────────────────

let isSyncing = false;
let oldObserver: ResizeObserver | null = null;
let newObserver: ResizeObserver | null = null;

// Auto-save after 10s of inactivity
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedKey = '';

watch([oldText, newText], ([oldVal, newVal]) => {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (!oldVal.trim() && !newVal.trim()) return;
  autoSaveTimer = setTimeout(() => {
    const s = stats.value;
    const key = `${oldVal}||${newVal}`;
    if (key === lastSavedKey) return;
    addHistoryRecord({
      oldText: oldVal,
      newText: newVal,
      added: s.added,
      removed: s.removed,
      unchanged: s.unchanged,
    });
    lastSavedKey = key;
  }, 10000);
});

onMounted(() => {
  loadHistory();

  if (pendingRestore.value) {
    oldText.value = pendingRestore.value.oldText;
    newText.value = pendingRestore.value.newText;
    lastSavedKey = `${oldText.value}||${newText.value}`;
    pendingRestore.value = null;
  }

  setTimeout(() => nextTick(updateGlider), 100);

  oldObserver = new ResizeObserver(() => {
    if (isSyncing || !oldTextareaRef.value || !newTextareaRef.value) return;
    isSyncing = true;
    newTextareaRef.value.style.height = `${oldTextareaRef.value.offsetHeight}px`;
    requestAnimationFrame(() => { isSyncing = false; });
  });

  newObserver = new ResizeObserver(() => {
    if (isSyncing || !oldTextareaRef.value || !newTextareaRef.value) return;
    isSyncing = true;
    oldTextareaRef.value.style.height = `${newTextareaRef.value.offsetHeight}px`;
    requestAnimationFrame(() => { isSyncing = false; });
  });

  if (oldTextareaRef.value) oldObserver.observe(oldTextareaRef.value);
  if (newTextareaRef.value) newObserver.observe(newTextareaRef.value);
});

onUnmounted(() => {
  oldObserver?.disconnect();
  newObserver?.disconnect();
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
});

window.addEventListener('resize', updateGlider);

// ─── Actions ──────────────────────────────────────────────────────────────────

const clearAll = () => {
  oldText.value = '';
  newText.value = '';
};

const copyDiff = () => {
  if (copied.value) return;
  navigator.clipboard.writeText(diffToText(diffLines.value));
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
};
</script>
