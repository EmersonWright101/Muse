<template>
  <div class="w-full max-w-6xl mx-auto space-y-6 pb-10 p-8">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <button
          @click="router.push('/tools/media/remove-bg')"
          class="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft class="w-4 h-4" />
        </button>
        <div>
          <h2 class="text-base font-semibold text-slate-800">{{ t('image.history.title') }}</h2>
          <p class="text-xs text-slate-400 mt-0.5">{{ t('image.history.subtitle', { count: historyRecords.length }) }}</p>
        </div>
      </div>

      <button
        v-if="historyRecords.length > 0"
        @click="confirmClear"
        class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all"
      >
        <Trash2 class="w-3.5 h-3.5" />
        {{ t('image.history.clear_all') }}
      </button>
    </div>

    <!-- Confirm clear -->
    <Transition name="fade">
      <div
        v-if="showConfirmClear"
        class="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between"
      >
        <span class="text-sm text-red-700">{{ t('image.history.confirm_clear') }}</span>
        <div class="flex gap-2">
          <button
            @click="showConfirmClear = false"
            class="text-xs px-3 py-1 rounded-md text-slate-600 hover:bg-white transition-colors border border-slate-200"
          >
            {{ t('image.history.cancel') }}
          </button>
          <button
            @click="handleClearAll"
            class="text-xs px-3 py-1 rounded-md text-white bg-red-500 hover:bg-red-600 transition-colors"
          >
            {{ t('image.history.confirm') }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- Empty state -->
    <div v-if="historyRecords.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <div class="p-4 bg-slate-100 rounded-full mb-4">
        <Clock class="w-8 h-8 text-slate-300" />
      </div>
      <p class="text-sm font-medium text-slate-500">{{ t('image.history.empty_title') }}</p>
      <p class="text-xs text-slate-400 mt-1">{{ t('image.history.empty_desc') }}</p>
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

        <!-- Records -->
        <TransitionGroup name="list" tag="div" class="space-y-3">
          <div
            v-for="record in group.records"
            :key="record.id"
            class="group bg-white border border-slate-200 rounded-xl p-4 transition-all duration-200 hover:border-indigo-200 hover:shadow-sm cursor-pointer"
            @click="handleRestore(record)"
          >
            <div class="flex items-start gap-4">

              <!-- Image pair -->
              <div class="flex items-center gap-2 flex-shrink-0">
                <!-- Original thumbnail -->
                <div class="flex flex-col items-center gap-1">
                  <span class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{{ t('image.history.original') }}</span>
                  <div class="w-24 h-20 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center">
                    <img
                      :src="getAssetUrl(record.originalPath)"
                      class="w-full h-full object-cover"
                      @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
                    />
                  </div>
                </div>

                <!-- Arrow -->
                <ArrowRight class="w-4 h-4 text-slate-300 flex-shrink-0 mt-5" />

                <!-- Processed thumbnail -->
                <div class="flex flex-col items-center gap-1">
                  <span class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{{ t('image.history.processed') }}</span>
                  <div class="w-24 h-20 rounded-lg border border-slate-200 overflow-hidden flex items-center justify-center bg-checkerboard">
                    <img
                      :src="getAssetUrl(record.processedPath)"
                      class="w-full h-full object-contain"
                      @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
                    />
                  </div>
                </div>
              </div>

              <!-- Metadata -->
              <div class="flex-1 min-w-0 space-y-2 pt-5">
                <p class="text-xs text-slate-600 truncate font-mono">{{ record.originalName }}</p>
                <div class="flex flex-wrap gap-1.5">
                  <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-600 border border-indigo-100">
                    {{ record.model === 'medium' ? t('image.high_precision') : t('image.fast_mode') }}
                  </span>
                  <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-50 text-slate-500 border border-slate-100">
                    {{ record.exportScale }}%
                  </span>
                  <span v-if="record.processingTime" class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-slate-50 text-slate-500 border border-slate-100">
                    {{ record.processingTime }}
                  </span>
                </div>
              </div>

              <!-- Time + actions -->
              <div class="flex-shrink-0 flex flex-col items-end gap-2 pt-5">
                <span class="text-[11px] text-slate-400 whitespace-nowrap tabular-nums">{{ formatTime(record.timestamp) }}</span>
                <div class="flex items-center gap-1.5">
                  <button
                    @click.stop="handleReDownload(record)"
                    :disabled="downloadingId === record.id"
                    class="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border transition-all"
                    :class="downloadingId === record.id
                      ? 'text-slate-400 border-slate-200 cursor-wait'
                      : 'text-indigo-600 border-indigo-200 hover:bg-indigo-50'"
                  >
                    <Download class="w-3.5 h-3.5" />
                    {{ t('image.history.re_download') }}
                  </button>
                  <button
                    @click.stop="handleDelete(record.id)"
                    class="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-300 hover:text-red-400 hover:bg-red-50 transition-all"
                  >
                    <X class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

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
import { convertFileSrc } from '@tauri-apps/api/core';
import { ArrowLeft, Trash2, Clock, X, Download, ArrowRight } from 'lucide-vue-next';
import {
  historyRecords,
  loadHistory,
  deleteHistoryRecord,
  clearHistory,
  getHistoryDir,
  readImageAsObjectUrl,
  pendingRestore,
  type RemoveBgRecord,
} from '../../stores/removeBg';

const { t, locale } = useI18n();
const router = useRouter();

const showConfirmClear = ref(false);
const downloadingId = ref<string | null>(null);
const historyDirCache = ref<string | null>(null);

onMounted(async () => {
  await loadHistory();
  historyDirCache.value = await getHistoryDir();
});

function getAssetUrl(relativePath: string): string {
  if (!historyDirCache.value) return '';
  return convertFileSrc(`${historyDirCache.value}/${relativePath}`);
}

function handleRestore(record: RemoveBgRecord) {
  pendingRestore.value = record;
  router.push('/tools/media/remove-bg');
}

async function handleReDownload(record: RemoveBgRecord) {
  if (downloadingId.value) return;
  downloadingId.value = record.id;
  try {
    const objectUrl = await readImageAsObjectUrl(record.processedPath);
    if (!objectUrl) {
      alert(t('image.history.file_missing'));
      return;
    }
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `removebg-${record.id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  } finally {
    downloadingId.value = null;
  }
}

// --- Date helpers ---

function toLocalDateKey(iso: string): string {
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
  if (dateKey === todayKey()) return t('image.history.date_today');
  if (dateKey === yesterdayKey()) return t('image.history.date_yesterday');

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
  records: RemoveBgRecord[];
}

const groupedRecords = computed<DateGroup[]>(() => {
  const map = new Map<string, RemoveBgRecord[]>();
  for (const r of historyRecords.value) {
    const key = toLocalDateKey(r.timestamp);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, recs]) => ({
      dateKey: key,
      dateLabel: dateLabel(key),
      records: recs,
    }));
});

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(locale.value === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
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
.bg-checkerboard {
  background-color: #ffffff;
  background-image:
    linear-gradient(45deg, #f1f5f9 25%, transparent 25%),
    linear-gradient(-45deg, #f1f5f9 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #f1f5f9 75%),
    linear-gradient(-45deg, transparent 75%, #f1f5f9 75%);
  background-size: 12px 12px;
  background-position: 0 0, 0 6px, 6px -6px, -6px 0px;
}

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
