<template>
  <div class="w-full max-w-6xl mx-auto space-y-6 pb-10 p-8">

    <!-- Controls Bar -->
    <div class="flex items-center gap-3 flex-wrap">

      <!-- Row Counter -->
      <div class="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
        <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{{ t('table_gen.rows') }}</span>
        <button
          @click="removeRow"
          :disabled="rowCount <= MIN_ROWS"
          class="w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold leading-none"
        >−</button>
        <span class="text-sm font-mono font-semibold text-slate-700 w-5 text-center">{{ rowCount }}</span>
        <button
          @click="addRow"
          :disabled="rowCount >= MAX_ROWS"
          class="w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-blue-500 hover:bg-blue-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold leading-none"
        >+</button>
      </div>

      <!-- Col Counter -->
      <div class="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
        <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{{ t('table_gen.cols') }}</span>
        <button
          @click="removeCol"
          :disabled="colCount <= MIN_COLS"
          class="w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold leading-none"
        >−</button>
        <span class="text-sm font-mono font-semibold text-slate-700 w-5 text-center">{{ colCount }}</span>
        <button
          @click="addCol"
          :disabled="colCount >= MAX_COLS"
          class="w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-blue-500 hover:bg-blue-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold leading-none"
        >+</button>
      </div>

      <!-- Header Toggle -->
      <label class="flex items-center gap-2 cursor-pointer bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 select-none">
        <input type="checkbox" v-model="hasHeader" class="w-3.5 h-3.5 rounded accent-blue-500" />
        <span class="text-xs font-semibold text-slate-600">{{ t('table_gen.header_row') }}</span>
      </label>

      <!-- LaTeX Style Selector -->
      <div class="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-lg p-1">
        <button
          v-for="style in latexStyles"
          :key="style.value"
          @click="latexStyle = style.value"
          class="px-3 py-0.5 rounded text-xs font-semibold transition-all duration-200"
          :class="latexStyle === style.value
            ? 'bg-white text-slate-800 shadow-sm border border-slate-200/80'
            : 'text-slate-400 hover:text-slate-600'"
        >{{ style.label }}</button>
      </div>

      <!-- History -->
      <button
        @click="router.push('/tools/latex/table/history')"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 border border-transparent hover:border-emerald-100 transition-all duration-200"
      >
        <History class="w-3.5 h-3.5" />
        {{ t('table_gen.history.btn') }}
      </button>

      <!-- Clear -->
      <button
        @click="clearAll"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all duration-200"
      >
        <XCircle class="w-3.5 h-3.5" />
        {{ t('common.clear') }}
      </button>
    </div>

    <!-- Editable Grid -->
    <div class="space-y-2">
      <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">
        {{ t('table_gen.table_data') }}
      </label>

      <div class="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
        <table class="border-collapse w-full min-w-max">
          <!-- Alignment Controls Row -->
          <thead>
            <tr class="bg-slate-50/80 border-b border-slate-200">
              <td
                v-for="(_, ci) in colCount"
                :key="ci"
                class="px-2 py-1.5 border-r border-slate-200 last:border-r-0"
                style="min-width: 120px;"
              >
                <div class="flex items-center justify-center gap-0.5">
                  <button
                    v-for="a in alignOptions"
                    :key="a.value"
                    @click="setAlign(ci, a.value)"
                    class="w-6 h-6 flex items-center justify-center rounded text-xs font-bold transition-all duration-150"
                    :class="colAligns[ci] === a.value
                      ? 'bg-blue-500 text-white shadow-sm'
                      : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50'"
                    :title="a.label"
                  >{{ a.text }}</button>
                </div>
              </td>
            </tr>
          </thead>

          <!-- Data Rows -->
          <tbody>
            <tr
              v-for="(row, ri) in tableData"
              :key="ri"
              :class="ri === 0 && hasHeader ? 'bg-blue-50/30' : 'bg-white'"
              class="group"
            >
              <td
                v-for="(_, ci) in row.length"
                :key="ci"
                class="border-b border-r border-slate-100 last:border-r-0 p-0"
                :class="ri === 0 && hasHeader ? 'border-b-slate-200' : ''"
              >
                <input
                  :value="tableData[ri][ci]"
                  @input="tableData[ri][ci] = ($event.target as HTMLInputElement).value"
                  class="w-full px-3 py-2 text-sm bg-transparent placeholder:text-slate-300 focus:outline-none focus:bg-blue-50/40 transition-colors font-mono"
                  :class="ri === 0 && hasHeader ? 'font-semibold text-slate-800' : 'text-slate-700'"
                  :placeholder="ri === 0 && hasHeader ? `Col ${ci + 1}` : ''"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Output: LaTeX and Markdown -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">

      <!-- LaTeX Output -->
      <div class="space-y-2">
        <div class="flex items-center justify-between ml-1 h-8">
          <div class="flex items-center gap-2">
            <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {{ t('table_gen.latex_output') }}
            </label>
            <span
              v-if="latexStyle === 'booktabs'"
              class="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 font-mono"
            >requires booktabs</span>
          </div>
          <button
            @click="copyLatex"
            class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-all duration-200 active:scale-95 border border-transparent"
            :class="copiedLatex ? 'text-green-600 bg-green-50 border-green-100' : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50/80 hover:border-blue-100'"
          >
            <component :is="copiedLatex ? Check : Clipboard" class="w-3.5 h-3.5" />
            <span>{{ copiedLatex ? t('common.copied') : t('common.copy') }}</span>
          </button>
        </div>
        <pre class="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs font-mono text-slate-700 overflow-x-auto whitespace-pre min-h-[180px] leading-relaxed select-all">{{ latexCode }}</pre>
      </div>

      <!-- Markdown Output -->
      <div class="space-y-2">
        <div class="flex items-center justify-between ml-1 h-8">
          <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
            {{ t('table_gen.markdown_output') }}
          </label>
          <button
            @click="copyMarkdown"
            class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-all duration-200 active:scale-95 border border-transparent"
            :class="copiedMarkdown ? 'text-green-600 bg-green-50 border-green-100' : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50/80 hover:border-blue-100'"
          >
            <component :is="copiedMarkdown ? Check : Clipboard" class="w-3.5 h-3.5" />
            <span>{{ copiedMarkdown ? t('common.copied') : t('common.copy') }}</span>
          </button>
        </div>
        <pre class="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs font-mono text-slate-700 overflow-x-auto whitespace-pre min-h-[180px] leading-relaxed select-all">{{ markdownCode }}</pre>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Clipboard, Check, XCircle, History } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import {
  addHistoryRecord,
  loadHistory,
  pendingRestore,
} from '../../stores/tableGenerator';

const { t } = useI18n();
const router = useRouter();

onMounted(async () => {
  await loadHistory();
  if (pendingRestore.value) {
    const r = pendingRestore.value;
    tableData.value = r.tableData;
    colAligns.value = r.colAligns;
    hasHeader.value = r.hasHeader;
    latexStyle.value = r.latexStyle;
    pendingRestore.value = null;
  }
});

const MIN_ROWS = 1;
const MAX_ROWS = 20;
const MIN_COLS = 1;
const MAX_COLS = 10;
const INIT_ROWS = 3;
const INIT_COLS = 3;

const hasHeader = ref(true);
const latexStyle = ref<'basic' | 'booktabs'>('booktabs');

const latexStyles = [
  { value: 'basic' as const, label: 'Basic' },
  { value: 'booktabs' as const, label: 'Booktabs' },
];

const alignOptions = [
  { value: 'l' as const, text: 'L', label: 'Left' },
  { value: 'c' as const, text: 'C', label: 'Center' },
  { value: 'r' as const, text: 'R', label: 'Right' },
];

const colAligns = ref<Array<'l' | 'c' | 'r'>>(
  Array.from({ length: INIT_COLS }, () => 'l')
);

const tableData = ref<string[][]>(
  Array.from({ length: INIT_ROWS }, () =>
    Array.from({ length: INIT_COLS }, () => '')
  )
);

const rowCount = computed(() => tableData.value.length);
const colCount = computed(() => tableData.value[0]?.length ?? 0);

function setAlign(ci: number, val: 'l' | 'c' | 'r') {
  const aligns = [...colAligns.value];
  aligns[ci] = val;
  colAligns.value = aligns;
}

function addRow() {
  if (rowCount.value >= MAX_ROWS) return;
  tableData.value = [
    ...tableData.value,
    Array.from({ length: colCount.value }, () => ''),
  ];
}

function removeRow() {
  if (rowCount.value <= MIN_ROWS) return;
  tableData.value = tableData.value.slice(0, -1);
}

function addCol() {
  if (colCount.value >= MAX_COLS) return;
  colAligns.value = [...colAligns.value, 'l'];
  tableData.value = tableData.value.map(row => [...row, '']);
}

function removeCol() {
  if (colCount.value <= MIN_COLS) return;
  colAligns.value = colAligns.value.slice(0, -1);
  tableData.value = tableData.value.map(row => row.slice(0, -1));
}

function clearAll() {
  tableData.value = Array.from({ length: INIT_ROWS }, () =>
    Array.from({ length: INIT_COLS }, () => '')
  );
  colAligns.value = Array.from({ length: INIT_COLS }, () => 'l');
  hasHeader.value = true;
  latexStyle.value = 'booktabs';
}

// Escape special LaTeX characters (single-pass via regex)
function escapeLatex(s: string): string {
  return s.replace(/[\\&%$#_^~{}]/g, (ch) => {
    const map: Record<string, string> = {
      '\\': '\\textbackslash{}',
      '&': '\\&',
      '%': '\\%',
      '$': '\\$',
      '#': '\\#',
      '_': '\\_',
      '^': '\\^{}',
      '~': '\\~{}',
      '{': '\\{',
      '}': '\\}',
    };
    return map[ch] ?? ch;
  });
}

const latexCode = computed(() => {
  const data = tableData.value;
  if (!data.length || !colCount.value) return '';

  const aligns = colAligns.value.slice(0, colCount.value);
  const formatRow = (row: string[]) =>
    '    ' + row.map(c => escapeLatex(c)).join(' & ') + ' \\\\';

  const lines: string[] = [];

  if (latexStyle.value === 'booktabs') {
    const spec = aligns.join('');
    lines.push('\\begin{table}[h]');
    lines.push('    \\centering');
    lines.push(`    \\begin{tabular}{${spec}}`);
    lines.push('    \\toprule');
    data.forEach((row, ri) => {
      lines.push(formatRow(row));
      if (ri === 0 && hasHeader.value) lines.push('    \\midrule');
    });
    lines.push('    \\bottomrule');
    lines.push('    \\end{tabular}');
    lines.push('    \\caption{Caption}');
    lines.push('    \\label{tab:label}');
    lines.push('\\end{table}');
  } else {
    const spec = '|' + aligns.join('|') + '|';
    lines.push('\\begin{table}[h]');
    lines.push('    \\centering');
    lines.push(`    \\begin{tabular}{${spec}}`);
    lines.push('    \\hline');
    data.forEach((row, ri) => {
      lines.push(formatRow(row));
      if (ri === 0 && hasHeader.value) {
        lines.push('    \\hline');
      }
      lines.push('    \\hline');
    });
    lines.push('    \\end{tabular}');
    lines.push('    \\caption{Caption}');
    lines.push('    \\label{tab:label}');
    lines.push('\\end{table}');
  }

  return lines.join('\n');
});

const markdownCode = computed(() => {
  const data = tableData.value;
  if (!data.length || !colCount.value) return '';

  const aligns = colAligns.value.slice(0, colCount.value);
  const lines: string[] = [];

  // Header row
  const headerCells = hasHeader.value
    ? data[0].map((c, i) => c || `Col ${i + 1}`)
    : Array.from({ length: colCount.value }, (_, i) => `Col ${i + 1}`);
  lines.push('| ' + headerCells.join(' | ') + ' |');

  // Separator row
  const sep = aligns.map(a => {
    if (a === 'l') return ':---';
    if (a === 'c') return ':---:';
    return '---:';
  });
  lines.push('| ' + sep.join(' | ') + ' |');

  // Data rows
  const dataRows = hasHeader.value ? data.slice(1) : data;
  dataRows.forEach(row => {
    lines.push('| ' + row.map(c => c || ' ').join(' | ') + ' |');
  });

  return lines.join('\n');
});

const copiedLatex = ref(false);
const copiedMarkdown = ref(false);

function currentSnapshot() {
  return {
    tableData: tableData.value.map(row => [...row]),
    colAligns: [...colAligns.value],
    hasHeader: hasHeader.value,
    latexStyle: latexStyle.value,
  };
}

async function copyLatex() {
  if (copiedLatex.value) return;
  await navigator.clipboard.writeText(latexCode.value);
  copiedLatex.value = true;
  setTimeout(() => (copiedLatex.value = false), 2000);
  await addHistoryRecord(currentSnapshot());
}

async function copyMarkdown() {
  if (copiedMarkdown.value) return;
  await navigator.clipboard.writeText(markdownCode.value);
  copiedMarkdown.value = true;
  setTimeout(() => (copiedMarkdown.value = false), 2000);
  await addHistoryRecord(currentSnapshot());
}
</script>
