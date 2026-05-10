<template>
  <div class="w-full max-w-6xl mx-auto space-y-6 pb-10 p-8">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <button
          @click="router.push('/tools/text/case-converter')"
          class="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft class="w-4 h-4" />
        </button>
        <div>
          <h2 class="text-base font-semibold text-slate-800">{{ t('text.history.title') }}</h2>
          <p class="text-xs text-slate-400 mt-0.5">{{ t('text.history.subtitle', { count: historyRecords.length }) }}</p>
        </div>
      </div>

      <button
        v-if="historyRecords.length > 0"
        @click="confirmClear"
        class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all"
      >
        <Trash2 class="w-3.5 h-3.5" />
        {{ t('text.history.clear_all') }}
      </button>
    </div>

    <!-- Confirm clear -->
    <Transition name="fade">
      <div
        v-if="showConfirmClear"
        class="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between"
      >
        <span class="text-sm text-red-700">{{ t('text.history.confirm_clear') }}</span>
        <div class="flex gap-2">
          <button
            @click="showConfirmClear = false"
            class="text-xs px-3 py-1 rounded-md text-slate-600 hover:bg-white transition-colors border border-slate-200"
          >
            {{ t('text.history.cancel') }}
          </button>
          <button
            @click="handleClearAll"
            class="text-xs px-3 py-1 rounded-md text-white bg-red-500 hover:bg-red-600 transition-colors"
          >
            {{ t('text.history.confirm') }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- Empty state -->
    <div v-if="historyRecords.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <div class="p-4 bg-slate-100 rounded-full mb-4">
        <Clock class="w-8 h-8 text-slate-300" />
      </div>
      <p class="text-sm font-medium text-slate-500">{{ t('text.history.empty_title') }}</p>
      <p class="text-xs text-slate-400 mt-1">{{ t('text.history.empty_desc') }}</p>
    </div>

    <!-- Grouped history list -->
    <div v-else class="space-y-5">
      <div v-for="group in groupedRecords" :key="group.dateKey">
        <!-- Date header -->
        <div class="flex items-center gap-3 mb-2">
          <span class="text-xs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
            {{ group.dateLabel }}
          </span>
          <div class="flex-1 h-px bg-slate-100"></div>
          <span class="text-xs text-slate-300">{{ group.records.length }}</span>
        </div>

        <!-- Records in this group -->
        <TransitionGroup name="list" tag="div" class="space-y-2">
          <div
            v-for="record in group.records"
            :key="record.id"
            @click="restoreRecord(record)"
            class="group bg-white border border-slate-200 rounded-xl px-4 py-3 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all duration-200 flex items-start gap-3"
          >
            <!-- Mode badge -->
            <div class="flex-shrink-0 mt-0.5">
              <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-100 whitespace-nowrap">
                {{ modeLabelMap[record.mode] ?? record.mode }}
              </span>
            </div>

            <!-- Content preview -->
            <div class="flex-1 min-w-0 space-y-1.5">
              <div class="flex items-baseline gap-2">
                <span class="text-[11px] font-medium text-slate-400 uppercase tracking-wide flex-shrink-0">{{ t('text.source') }}</span>
                <span class="text-sm text-slate-700 truncate">{{ record.inputText }}</span>
              </div>
              <div class="flex items-baseline gap-2">
                <span class="text-[11px] font-medium text-slate-400 uppercase tracking-wide flex-shrink-0">{{ t('text.result') }}</span>
                <span class="text-sm text-slate-500 truncate font-mono">{{ record.outputText }}</span>
              </div>
            </div>

            <!-- Time + delete -->
            <div class="flex-shrink-0 flex flex-col items-end gap-2">
              <span class="text-[11px] text-slate-400 whitespace-nowrap tabular-nums">{{ formatTime(record.timestamp) }}</span>
              <button
                @click.stop="handleDelete(record.id)"
                class="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-300 hover:text-red-400 hover:bg-red-50 transition-all"
              >
                <X class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </TransitionGroup>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowLeft, Trash2, Clock, X } from 'lucide-vue-next';
import {
  historyRecords,
  loadHistory,
  deleteHistoryRecord,
  clearHistory,
  type HistoryRecord,
} from '../../stores/textConverter';

const { t, locale } = useI18n();
const router = useRouter();

const showConfirmClear = ref(false);

onMounted(loadHistory);

const modeLabelMap = computed<Record<string, string>>(() => ({
  uppercase: t('text.modes.uppercase'),
  lowercase: t('text.modes.lowercase'),
  firstUpper: t('text.modes.titleCase'),
  firstLower: t('text.modes.uncapitalize'),
  Camel: t('text.modes.UpperCamelCase'),
  camel: t('text.modes.lowerCamelCase'),
  snake: t('text.modes.snake_case'),
}));

// --- Date helpers ---

function toLocalDateKey(iso: string): string {
  // Returns "YYYY-MM-DD" in local timezone
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayKey(): string {
  return toLocalDateKey(new Date().toISOString());
}

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toLocalDateKey(d.toISOString());
}

function dateLabel(dateKey: string): string {
  if (dateKey === todayKey()) return t('text.history.date_today');
  if (dateKey === yesterdayKey()) return t('text.history.date_yesterday');

  // Format as locale date: "4月5日" / "Apr 5"
  const [year, month, day] = dateKey.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const isCurrentYear = year === new Date().getFullYear();

  return d.toLocaleDateString(locale.value === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    ...(isCurrentYear ? {} : { year: 'numeric' }),
  });
}

// --- Grouping ---

interface DateGroup {
  dateKey: string;
  dateLabel: string;
  records: HistoryRecord[];
}

const groupedRecords = computed<DateGroup[]>(() => {
  const map = new Map<string, HistoryRecord[]>();

  for (const r of historyRecords.value) {
    const key = toLocalDateKey(r.timestamp);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }

  // Sort groups newest-first; records within a group are already newest-first
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, recs]) => ({
      dateKey: key,
      dateLabel: dateLabel(key),
      records: recs,
    }));
});

// Show HH:MM for each card (date context comes from the group header)
function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(locale.value === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function restoreRecord(record: HistoryRecord) {
  router.push({
    path: '/tools/text/case-converter',
    query: { input: record.inputText, mode: record.mode },
  });
}

function confirmClear() {
  showConfirmClear.value = true;
}

async function handleClearAll() {
  await clearHistory();
  showConfirmClear.value = false;
}

async function handleDelete(id: string) {
  await deleteHistoryRecord(id);
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.list-enter-active,
.list-leave-active {
  transition: all 0.25s ease;
}
.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.list-move {
  transition: transform 0.25s ease;
}
</style>
