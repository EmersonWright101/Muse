<template>
  <div class="w-full max-w-5xl mx-auto space-y-6 pb-10 p-8">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <button
          @click="router.push('/tools/misc/qrcode')"
          class="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft class="w-4 h-4" />
        </button>
        <div>
          <h2 class="text-base font-semibold text-slate-800">{{ t('qr.history.title') }}</h2>
          <p class="text-xs text-slate-400 mt-0.5">{{ t('qr.history.subtitle', { count: historyRecords.length }) }}</p>
        </div>
      </div>

      <button
        v-if="historyRecords.length > 0"
        @click="confirmClear"
        class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all"
      >
        <Trash2 class="w-3.5 h-3.5" />
        {{ t('qr.history.clear_all') }}
      </button>
    </div>

    <!-- Confirm clear -->
    <Transition name="fade">
      <div
        v-if="showConfirmClear"
        class="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between"
      >
        <span class="text-sm text-red-700">{{ t('qr.history.confirm_clear') }}</span>
        <div class="flex gap-2">
          <button
            @click="showConfirmClear = false"
            class="text-xs px-3 py-1 rounded-md text-slate-600 hover:bg-white transition-colors border border-slate-200"
          >{{ t('qr.history.cancel') }}</button>
          <button
            @click="handleClearAll"
            class="text-xs px-3 py-1 rounded-md text-white bg-red-500 hover:bg-red-600 transition-colors"
          >{{ t('qr.history.confirm') }}</button>
        </div>
      </div>
    </Transition>

    <!-- Empty state -->
    <div v-if="historyRecords.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <div class="p-4 bg-slate-100 rounded-full mb-4">
        <Clock class="w-8 h-8 text-slate-300" />
      </div>
      <p class="text-sm font-medium text-slate-500">{{ t('qr.history.empty_title') }}</p>
      <p class="text-xs text-slate-400 mt-1">{{ t('qr.history.empty_desc') }}</p>
    </div>

    <!-- Grouped list -->
    <div v-else class="space-y-5">
      <div v-for="group in groupedRecords" :key="group.dateKey">
        <div class="flex items-center gap-3 mb-2">
          <span class="text-xs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">{{ group.dateLabel }}</span>
          <div class="flex-1 h-px bg-slate-100"></div>
          <span class="text-xs text-slate-300">{{ group.records.length }}</span>
        </div>

        <TransitionGroup name="list" tag="div" class="space-y-3">
          <div
            v-for="record in group.records"
            :key="record.id"
            class="group bg-white border border-slate-200 rounded-xl p-4 transition-all duration-200 hover:border-indigo-200 hover:shadow-sm"
          >
            <div class="flex items-start gap-4">

              <!-- QR Thumbnail -->
              <div class="flex-shrink-0">
                <div class="w-20 h-20 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center">
                  <img
                    :src="getAssetUrl(record.imagePath)"
                    class="w-full h-full object-contain p-1"
                    @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
                  />
                </div>
              </div>

              <!-- Metadata -->
              <div class="flex-1 min-w-0 space-y-2 pt-1">
                <!-- Type badge -->
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border"
                    :class="record.type === 'generate'
                      ? 'bg-indigo-50 text-indigo-600 border-indigo-100'
                      : 'bg-emerald-50 text-emerald-600 border-emerald-100'"
                  >
                    <component :is="record.type === 'generate' ? QrCodeIconComp : ScanLineComp" class="w-3 h-3" />
                    {{ record.type === 'generate' ? t('qr.tab_generate') : t('qr.tab_decode') }}
                  </span>

                  <!-- Dot style for generate records -->
                  <span v-if="record.type === 'generate' && record.dotStyle" class="text-[11px] text-slate-400 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-md font-medium">
                    {{ record.dotStyle }}
                  </span>

                  <!-- Color swatches for generate records -->
                  <div v-if="record.type === 'generate'" class="flex items-center gap-1">
                    <div
                      class="w-4 h-4 rounded border border-slate-200 shadow-sm"
                      :style="{ backgroundColor: record.fgColor ?? '#000' }"
                    />
                    <div
                      class="w-4 h-4 rounded border border-slate-200 shadow-sm"
                      :style="{ backgroundColor: record.bgColor ?? '#fff' }"
                    />
                    <span v-if="record.hasLogo" class="text-[11px] text-slate-400 ml-1">+ logo</span>
                  </div>

                  <!-- Original filename for decode records -->
                  <span v-if="record.type === 'decode' && record.originalName" class="text-[11px] text-slate-400 font-mono truncate max-w-[160px]">
                    {{ record.originalName }}
                  </span>
                </div>

                <!-- Content / decoded text -->
                <p class="text-sm text-slate-700 font-mono break-all line-clamp-2 leading-relaxed">
                  {{ record.type === 'generate' ? record.content : record.decodedText }}
                </p>
              </div>

              <!-- Time + actions -->
              <div class="flex-shrink-0 flex flex-col items-end gap-2 pt-1">
                <span class="text-[11px] text-slate-400 whitespace-nowrap tabular-nums">{{ formatTime(record.timestamp) }}</span>
                <div class="flex items-center gap-1.5">
                  <!-- Download for generated QR codes -->
                  <button
                    v-if="record.type === 'generate'"
                    @click="handleReDownload(record)"
                    :disabled="downloadingId === record.id"
                    class="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border transition-all"
                    :class="downloadingId === record.id
                      ? 'text-slate-400 border-slate-200 cursor-wait'
                      : 'text-indigo-600 border-indigo-200 hover:bg-indigo-50'"
                  >
                    <Download class="w-3.5 h-3.5" />
                    {{ t('qr.history.download') }}
                  </button>
                  <!-- Copy for decoded text -->
                  <button
                    v-if="record.type === 'decode' && record.decodedText"
                    @click="copyText(record.decodedText!)"
                    class="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border text-emerald-600 border-emerald-200 hover:bg-emerald-50 transition-all"
                  >
                    <Copy class="w-3.5 h-3.5" />
                    {{ t('common.copy') }}
                  </button>
                  <!-- Delete -->
                  <button
                    @click="handleDelete(record.id)"
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
import {
  ArrowLeft, Trash2, Clock, X, Download, Copy,
  QrCode as QrCodeIconComp, ScanLine as ScanLineComp,
} from 'lucide-vue-next';
import {
  historyRecords,
  loadHistory,
  deleteHistoryRecord,
  clearHistory,
  getHistoryDir,
  readImageAsObjectUrl,
  type QrCodeRecord,
} from '../../stores/qrCode';

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

async function handleReDownload(record: QrCodeRecord) {
  if (downloadingId.value) return;
  downloadingId.value = record.id;
  try {
    const objectUrl = await readImageAsObjectUrl(record.imagePath);
    if (!objectUrl) { alert(t('qr.history.file_missing')); return; }
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `qrcode-${record.id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  } finally {
    downloadingId.value = null;
  }
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); } catch {}
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function toLocalDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayKey() { return toLocalDateKey(new Date().toISOString()); }
function yesterdayKey() { const d = new Date(); d.setDate(d.getDate() - 1); return toLocalDateKey(d.toISOString()); }

function dateLabel(dateKey: string): string {
  if (dateKey === todayKey()) return t('qr.history.date_today');
  if (dateKey === yesterdayKey()) return t('qr.history.date_yesterday');
  const [year, month, day] = dateKey.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString(locale.value === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short', day: 'numeric',
    ...(year === new Date().getFullYear() ? {} : { year: 'numeric' }),
  });
}

interface DateGroup { dateKey: string; dateLabel: string; records: QrCodeRecord[]; }

const groupedRecords = computed<DateGroup[]>(() => {
  const map = new Map<string, QrCodeRecord[]>();
  for (const r of historyRecords.value) {
    const key = toLocalDateKey(r.timestamp);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, recs]) => ({ dateKey: key, dateLabel: dateLabel(key), records: recs }));
});

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(locale.value === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function confirmClear() { showConfirmClear.value = true; }
async function handleClearAll() { await clearHistory(); showConfirmClear.value = false; }
async function handleDelete(id: string) { await deleteHistoryRecord(id); }
</script>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.list-enter-active, .list-leave-active { transition: all 0.25s ease; }
.list-enter-from, .list-leave-to { opacity: 0; transform: translateY(-6px); }
.list-move { transition: transform 0.25s ease; }
</style>
