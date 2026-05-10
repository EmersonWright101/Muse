import { ref } from 'vue';
import { appLocalDataDir } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { settings } from './toolsSettings';

export interface BibtexHistoryRecord {
  id: string;
  timestamp: string;
  inputText: string;
  outputText: string;
  format: 'ieee' | 'apa' | 'gb7714';
}

interface HistoryFile {
  version: 1;
  records: BibtexHistoryRecord[];
}

const HISTORY_FILENAME = 'bibtex_converter_history.json';

let resolvedDataDir: string | null = null;

async function getHistoryFilePath(): Promise<string> {
  if (!resolvedDataDir) resolvedDataDir = await appLocalDataDir();
  return resolvedDataDir.replace(/[/\\]$/, '') + '/' + HISTORY_FILENAME;
}

export const historyRecords = ref<BibtexHistoryRecord[]>([]);
export const pendingRestore = ref<BibtexHistoryRecord | null>(null);
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
    historyRecords.value = [];
  }
}

async function persistHistory(): Promise<void> {
  try {
    const filePath = await getHistoryFilePath();
    const dir = resolvedDataDir!.replace(/[/\\]$/, '');
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    const payload: HistoryFile = { version: 1, records: historyRecords.value };
    await writeTextFile(filePath, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('bibtex: failed to persist history', e);
  }
}

export async function persistHistoryToDisk(records: any[]): Promise<void> {
  historyRecords.value = records;
  await persistHistory();
}

export async function addHistoryRecord(
  record: Omit<BibtexHistoryRecord, 'id' | 'timestamp'>,
): Promise<void> {
  const newRecord: BibtexHistoryRecord = {
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
