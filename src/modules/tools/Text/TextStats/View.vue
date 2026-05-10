<template>
  <div class="w-full max-w-5xl mx-auto space-y-8 pb-10 p-8">

    <!-- Input -->
    <div class="space-y-3">
      <div class="flex items-center justify-between ml-1">
        <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {{ t('stats.source') }}
        </label>
        <div class="flex items-center gap-3">
          <button
            @click="router.push('/tools/text/stats/history')"
            class="text-xs text-slate-400 hover:text-emerald-600 transition-colors px-2 py-1 rounded-md hover:bg-emerald-50 flex items-center gap-1"
          >
            <History class="w-3.5 h-3.5" />
            <span>{{ t('stats.history.btn') }}</span>
          </button>
          <span v-if="text" class="text-xs text-slate-400 tabular-nums">
            {{ stats!.charCount.toLocaleString() }} {{ t('stats.chars_unit') }}
          </span>
          <button
            v-if="text"
            @click="text = ''"
            class="text-xs text-slate-400 hover:text-red-500 transition-colors px-2 py-1 rounded-md hover:bg-red-50 flex items-center gap-1"
          >
            <XCircle class="w-3.5 h-3.5" />
            <span>{{ t('common.clear') }}</span>
          </button>
        </div>
      </div>
      <textarea
        v-model="text"
        class="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 min-h-[160px] text-slate-700 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none shadow-sm"
        :placeholder="t('stats.input_prompt')"
      ></textarea>
    </div>

    <!-- Empty state -->
    <div v-if="!text" class="flex flex-col items-center justify-center py-16 text-slate-300 select-none">
      <BarChart2 class="w-12 h-12 mb-3 opacity-40" />
      <p class="text-sm">{{ t('stats.no_content') }}</p>
    </div>

    <template v-if="text && stats">

      <!-- Section 1: Overview -->
      <section>
        <div class="flex items-center gap-2 mb-4">
          <div class="w-1 h-5 bg-blue-400 rounded-full"></div>
          <h2 class="text-lg font-bold text-slate-800">{{ t('stats.overview') }}</h2>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div class="text-2xl font-bold text-slate-800 tabular-nums">{{ stats.charCount.toLocaleString() }}</div>
            <div class="text-xs text-slate-400 mt-1 flex items-center gap-1.5"><Hash class="w-3 h-3 shrink-0" />{{ t('stats.chars_total') }}</div>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div class="text-2xl font-bold text-slate-800 tabular-nums">{{ stats.charNoSpaces.toLocaleString() }}</div>
            <div class="text-xs text-slate-400 mt-1 flex items-center gap-1.5"><AlignLeft class="w-3 h-3 shrink-0" />{{ t('stats.chars_no_spaces') }}</div>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div class="text-2xl font-bold text-indigo-600 tabular-nums">{{ stats.wordCount.toLocaleString() }}</div>
            <div class="text-xs text-slate-400 mt-1 flex items-center gap-1.5"><Type class="w-3 h-3 shrink-0" />{{ t('stats.words') }}</div>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div class="text-2xl font-bold text-amber-500">{{ stats.readingTimeStr }}</div>
            <div class="text-xs text-slate-400 mt-1 flex items-center gap-1.5"><Clock class="w-3 h-3 shrink-0" />{{ t('stats.reading_time') }}</div>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div class="text-2xl font-bold text-emerald-600 tabular-nums">{{ stats.sentences }}</div>
            <div class="text-xs text-slate-400 mt-1 flex items-center gap-1.5"><MessageSquare class="w-3 h-3 shrink-0" />{{ t('stats.sentences') }}</div>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div class="text-2xl font-bold text-emerald-600 tabular-nums">{{ stats.paragraphs }}</div>
            <div class="text-xs text-slate-400 mt-1 flex items-center gap-1.5"><AlignJustify class="w-3 h-3 shrink-0" />{{ t('stats.paragraphs') }}</div>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div class="text-2xl font-bold text-slate-800 tabular-nums">{{ stats.lines }}</div>
            <div class="text-xs text-slate-400 mt-1 flex items-center gap-1.5"><List class="w-3 h-3 shrink-0" />{{ t('stats.lines') }}</div>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div class="text-2xl font-bold tabular-nums" :class="stats.chineseChars > 0 ? 'text-rose-500' : 'text-slate-500'">
              {{ stats.chineseChars > 0 ? stats.chineseChars.toLocaleString() : stats.punctuation }}
            </div>
            <div class="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
              <Globe class="w-3 h-3 shrink-0" v-if="stats.chineseChars > 0" />
              <Minus class="w-3 h-3 shrink-0" v-else />
              {{ stats.chineseChars > 0 ? t('stats.chinese_chars') : t('stats.punctuation') }}
            </div>
          </div>
        </div>
      </section>

      <!-- Section 2: Text Analysis -->
      <section>
        <div class="flex items-center gap-2 mb-4">
          <div class="w-1 h-5 bg-emerald-400 rounded-full"></div>
          <h2 class="text-lg font-bold text-slate-800">{{ t('stats.text_analysis') }}</h2>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div class="text-2xl font-bold text-violet-600 tabular-nums">{{ stats.uniqueWords.toLocaleString() }}</div>
            <div class="text-xs text-slate-400 mt-1 flex items-center gap-1.5"><Tag class="w-3 h-3 shrink-0" />{{ t('stats.unique_words') }}</div>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div class="text-2xl font-bold text-violet-600 tabular-nums">{{ stats.avgWordLen }}</div>
            <div class="text-xs text-slate-400 mt-1 flex items-center gap-1.5"><Ruler class="w-3 h-3 shrink-0" />{{ t('stats.avg_word_len') }}</div>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div class="text-2xl font-bold text-violet-600 tabular-nums">{{ stats.avgSentLen }}</div>
            <div class="text-xs text-slate-400 mt-1 flex items-center gap-1.5"><TrendingUp class="w-3 h-3 shrink-0" />{{ t('stats.avg_sent_len') }}</div>
          </div>
          <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div class="text-2xl font-bold text-slate-600 tabular-nums">{{ stats.digits }}</div>
            <div class="text-xs text-slate-400 mt-1 flex items-center gap-1.5"><Hash class="w-3 h-3 shrink-0" />{{ t('stats.digits') }}</div>
          </div>
        </div>

        <!-- Longest word -->
        <div v-if="stats.longestWord" class="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
          <span class="text-xs text-slate-500 font-medium">{{ t('stats.longest_word') }}</span>
          <span class="font-mono text-slate-700 font-semibold text-sm">
            {{ stats.longestWord }}
            <span class="text-slate-400 font-normal text-xs ml-1">({{ stats.longestWord.length }} chars)</span>
          </span>
        </div>

        <!-- Lexical density -->
        <div class="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
          <span class="text-xs text-slate-500 font-medium">{{ t('stats.lexical_density') }}</span>
          <div class="flex items-center gap-3">
            <div class="w-32 h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                class="h-full bg-violet-400 rounded-full transition-all duration-500"
                :style="{ width: `${Math.min(stats.lexicalDensity, 100)}%` }"
              ></div>
            </div>
            <span class="text-sm font-semibold text-slate-700 tabular-nums w-12 text-right">{{ stats.lexicalDensity }}%</span>
          </div>
        </div>
      </section>

      <!-- Section 3: Word Frequency -->
      <section v-if="stats.topWords.length > 0">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <div class="w-1 h-5 bg-violet-400 rounded-full"></div>
            <h2 class="text-lg font-bold text-slate-800">{{ t('stats.top_words_label') }}</h2>
          </div>
          <button
            @click="copyStats"
            class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-all duration-200 active:scale-95 border border-transparent"
            :class="copied ? 'text-green-600 bg-green-50 border-green-100' : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50/80 hover:border-blue-100'"
          >
            <component :is="copied ? Check : Clipboard" class="w-3.5 h-3.5" />
            <span>{{ copied ? t('common.copied') : t('stats.copy_stats') }}</span>
          </button>
        </div>
        <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2.5">
          <div v-for="([word, count], i) in stats.topWords" :key="word" class="flex items-center gap-3">
            <span class="text-xs text-slate-300 w-5 text-right font-mono tabular-nums">{{ i + 1 }}</span>
            <span class="text-sm font-medium text-slate-700 w-32 truncate">{{ word }}</span>
            <div class="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                class="h-full bg-violet-400 rounded-full transition-all duration-700"
                :style="{ width: `${(count / stats.topWords[0][1]) * 100}%` }"
              ></div>
            </div>
            <span class="text-xs text-slate-500 w-8 text-right tabular-nums">{{ count }}</span>
          </div>
        </div>
      </section>

    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import {
  XCircle, BarChart2, Hash, AlignLeft, Type, Clock,
  MessageSquare, AlignJustify, List, Globe, Minus,
  Tag, Ruler, TrendingUp, Clipboard, Check, History
} from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { addHistoryRecord, loadHistory } from '../../stores/textStats';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const text = ref('');
const copied = ref(false);

// Auto-save after 10s of inactivity
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedText = '';

watch(text, (val) => {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (!val.trim()) return;
  autoSaveTimer = setTimeout(() => {
    if (!stats.value || val === lastSavedText) return;
    const s = stats.value;
    addHistoryRecord({
      inputText: val,
      charCount: s.charCount,
      wordCount: s.wordCount,
      sentences: s.sentences,
      paragraphs: s.paragraphs,
      readingTimeStr: s.readingTimeStr,
    });
    lastSavedText = val;
  }, 10000);
});

onUnmounted(() => {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
});

onMounted(() => {
  loadHistory();
  if (route.query.input) {
    text.value = String(route.query.input);
    lastSavedText = text.value;
  }
});

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'is','are','was','were','be','been','have','has','had','do','does','did',
  'will','would','could','should','may','might','shall','can','this','that',
  'these','those','it','its','i','you','he','she','we','they','my','your',
  'his','her','our','their','not','no','from','as','if','then','than','so',
  'up','out','about','into','through','during','before','after','between',
  'each','other','such','when','which','who','what','how','all','both','few',
  'more','most','some','also','just','very','only','even','here','there',
  'than','too','very','s','t','can','will','just','don','should','now',
]);

const stats = computed(() => {
  const s = text.value;
  if (!s) return null;

  const charCount = s.length;
  const charNoSpaces = s.replace(/\s/g, '').length;
  const lines = s.split('\n').length;
  const paragraphs = Math.max(s.split(/\n\s*\n/).filter(p => p.trim()).length, 1);

  // CJK characters
  const chineseChars = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;

  // Latin words
  const latinWords = (s.match(/\b[a-zA-Z'-]+\b/g) || []).filter(w => w.replace(/^'-|'-$/g, '').length > 0);
  const wordCount = latinWords.length + chineseChars;

  // Sentences
  const sentences = Math.max(s.split(/[.!?。！？]+/).filter(p => p.trim()).length, 1);

  // Word frequency
  const wordFreq: Record<string, number> = {};
  latinWords.forEach(w => {
    const lower = w.toLowerCase().replace(/^'+|'+$/g, '');
    if (lower.length > 1) wordFreq[lower] = (wordFreq[lower] || 0) + 1;
  });
  const uniqueWords = Object.keys(wordFreq).length;

  const topWords = Object.entries(wordFreq)
    .filter(([w]) => !STOP_WORDS.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10) as [string, number][];

  const avgWordLen = latinWords.length > 0
    ? (latinWords.reduce((acc, w) => acc + w.length, 0) / latinWords.length).toFixed(1)
    : '0';
  const avgSentLen = (wordCount / sentences).toFixed(1);
  const longestWord = latinWords.reduce((a, b) => b.length > a.length ? b : a, '');

  // Lexical density = unique content words / total words
  const contentWords = Object.keys(wordFreq).filter(w => !STOP_WORDS.has(w)).length;
  const lexicalDensity = wordCount > 0 ? Math.round((contentWords / wordCount) * 100) : 0;

  // Reading time: 250 WPM for Latin, 300 CPM for Chinese
  const totalMin = latinWords.length / 250 + chineseChars / 300;
  const readingTimeStr = totalMin < 1 ? '< 1 min' : `~${Math.round(totalMin)} min`;

  const punctuation = (s.match(/[.,!?;:'"()\[\]{}\-—–…。，、！？；：""''（）【】]/g) || []).length;
  const digits = (s.match(/\d/g) || []).length;

  return {
    charCount, charNoSpaces, lines, paragraphs, sentences,
    chineseChars, wordCount, uniqueWords, avgWordLen, avgSentLen,
    longestWord, readingTimeStr, punctuation, digits, topWords, lexicalDensity,
  };
});

const copyStats = () => {
  if (!stats.value || copied.value) return;
  const s = stats.value;
  const lines = [
    `Characters: ${s.charCount}`,
    `Characters (no spaces): ${s.charNoSpaces}`,
    `Words: ${s.wordCount}`,
    s.chineseChars > 0 ? `CJK Characters: ${s.chineseChars}` : '',
    `Sentences: ${s.sentences}`,
    `Paragraphs: ${s.paragraphs}`,
    `Lines: ${s.lines}`,
    `Unique words: ${s.uniqueWords}`,
    `Avg word length: ${s.avgWordLen} chars`,
    `Avg sentence length: ${s.avgSentLen} words`,
    `Reading time: ${s.readingTimeStr}`,
    `Lexical density: ${s.lexicalDensity}%`,
  ].filter(Boolean).join('\n');
  navigator.clipboard.writeText(lines);
  copied.value = true;
  setTimeout(() => copied.value = false, 2000);
};
</script>
