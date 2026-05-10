import { ref } from 'vue';
import { appLocalDataDir } from '@tauri-apps/api/path';
import {
  readTextFile,
  writeTextFile,
  writeFile,
  readFile,
  mkdir,
  exists,
  remove,
} from '@tauri-apps/plugin-fs';
import { settings } from './toolsSettings';

export interface QrCodeRecord {
  id: string;
  timestamp: string;
  type: 'generate' | 'decode';
  /** Path relative to historyDir, e.g. "images/{id}.png" */
  imagePath: string;
  // Generate-specific
  content?: string;
  dotStyle?: string;
  cornerSquareStyle?: string;
  fgColor?: string;
  bgColor?: string;
  hasLogo?: boolean;
  // Decode-specific
  decodedText?: string;
  originalName?: string;
}

interface HistoryFile {
  version: 1;
  records: QrCodeRecord[];
}

let resolvedDataDir: string | null = null;

async function getBaseDir(): Promise<string> {
  if (!resolvedDataDir) resolvedDataDir = await appLocalDataDir();
  return resolvedDataDir.replace(/[/\\]$/, '');
}

export async function getHistoryDir(): Promise<string> {
  return (await getBaseDir()) + '/qrcode_history';
}

async function getIndexPath(): Promise<string> {
  return (await getHistoryDir()) + '/index.json';
}

async function ensureDirs(): Promise<void> {
  const base = await getHistoryDir();
  for (const sub of ['', '/images']) {
    const dir = base + sub;
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  }
}

export const historyRecords = ref<QrCodeRecord[]>([]);
export const pendingRestore = ref<QrCodeRecord | null>(null);
let loaded = false;

export async function loadHistory(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const indexPath = await getIndexPath();
    if (await exists(indexPath)) {
      const content = await readTextFile(indexPath);
      const data: HistoryFile = JSON.parse(content);
      historyRecords.value = Array.isArray(data.records) ? data.records : [];
    }
  } catch {
    historyRecords.value = [];
  }
}

async function persistIndex(): Promise<void> {
  try {
    await ensureDirs();
    const payload: HistoryFile = { version: 1, records: historyRecords.value };
    await writeTextFile(await getIndexPath(), JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('qrcode: failed to persist index', e);
  }
}

async function deleteImageFiles(records: QrCodeRecord[]): Promise<void> {
  const base = await getHistoryDir();
  for (const r of records) {
    try { await remove(`${base}/${r.imagePath}`); } catch {}
  }
}

export async function addHistoryRecord(
  meta: Omit<QrCodeRecord, 'id' | 'timestamp' | 'imagePath'>,
  imageData: Uint8Array,
): Promise<void> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  try {
    await ensureDirs();
    const base = await getHistoryDir();
    await writeFile(`${base}/images/${id}.png`, imageData);
  } catch (e) {
    console.error('qrcode: failed to write image file', e);
    return;
  }

  const newRecord: QrCodeRecord = {
    id,
    timestamp: new Date().toISOString(),
    ...meta,
    imagePath: `images/${id}.png`,
  };

  historyRecords.value.unshift(newRecord);

  const max = settings.historyMaxRecords ?? 100;
  if (historyRecords.value.length > max) {
    const overflow = historyRecords.value.slice(max);
    historyRecords.value = historyRecords.value.slice(0, max);
    deleteImageFiles(overflow);
  }

  await persistIndex();
}

export async function deleteHistoryRecord(id: string): Promise<void> {
  const record = historyRecords.value.find((r) => r.id === id);
  historyRecords.value = historyRecords.value.filter((r) => r.id !== id);
  if (record) await deleteImageFiles([record]);
  await persistIndex();
}

export async function clearHistory(): Promise<void> {
  const toDelete = [...historyRecords.value];
  historyRecords.value = [];
  await persistIndex();
  await deleteImageFiles(toDelete);
}

export async function readImageAsObjectUrl(relativePath: string): Promise<string | null> {
  try {
    const base = await getHistoryDir();
    const data = await readFile(`${base}/${relativePath}`);
    const blob = new Blob([data], { type: 'image/png' });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
