import { ref } from 'vue';
import { appLocalDataDir } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { settings } from './toolsSettings';

export interface TableGeneratorRecord {
  id: string;
  timestamp: string;
  tableData: string[][];
  colAligns: Array<'l' | 'c' | 'r'>;
  hasHeader: boolean;
  latexStyle: 'basic' | 'booktabs';
}

interface HistoryFile {
  version: 1;
  records: TableGeneratorRecord[];
}

const HISTORY_FILENAME = 'table_generator_history.json';
const LS_FALLBACK_KEY = 'table-generator-history';

let resolvedDataDir: string | null = null;

async function getHistoryFilePath(): Promise<string> {
  if (!resolvedDataDir) {
    resolvedDataDir = await appLocalDataDir();
  }
  return resolvedDataDir.replace(/[/\\]$/, '') + '/' + HISTORY_FILENAME;
}

export const historyRecords = ref<TableGeneratorRecord[]>([]);
let loaded = false;

export async function loadHistory(): Promise<void> {
  if (loaded) return;
  loaded = true;

  try {
    const filePath = await getHistoryFilePath();
    if (await exists(filePath)) {
      const content = await readTextFile(filePath);
      const data: HistoryFile = JSON.parse(content);
      historyRecords.value = Array.isArray(data.records) ? data.records : [];
    }
  } catch {
    try {
      const saved = localStorage.getItem(LS_FALLBACK_KEY);
      if (saved) {
        historyRecords.value = JSON.parse(saved);
      }
    } catch {
      historyRecords.value = [];
    }
  }
}

async function persistHistory(): Promise<void> {
  const payload: HistoryFile = { version: 1, records: historyRecords.value };
  const json = JSON.stringify(payload, null, 2);

  try {
    const filePath = await getHistoryFilePath();
    const dir = resolvedDataDir!.replace(/[/\\]$/, '');
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true });
    }
    await writeTextFile(filePath, json);
  } catch {
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(historyRecords.value));
  }
}

export async function persistHistoryToDisk(records: any[]): Promise<void> {
  historyRecords.value = records;
  await persistHistory();
}

export async function addHistoryRecord(
  record: Omit<TableGeneratorRecord, 'id' | 'timestamp'>
): Promise<void> {
  const newRecord: TableGeneratorRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date().toISOString(),
    ...record,
  };

  historyRecords.value.unshift(newRecord);

  const max = settings.historyMaxRecords ?? 100;
  if (historyRecords.value.length > max) {
    historyRecords.value = historyRecords.value.slice(0, max);
  }

  await persistHistory();
}

export async function deleteHistoryRecord(id: string): Promise<void> {
  historyRecords.value = historyRecords.value.filter((r) => r.id !== id);
  await persistHistory();
}

export async function clearHistory(): Promise<void> {
  historyRecords.value = [];
  await persistHistory();
}

export const pendingRestore = ref<Omit<TableGeneratorRecord, 'id' | 'timestamp'> | null>(null);
