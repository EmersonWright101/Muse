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

export interface RemoveBgRecord {
  id: string;
  timestamp: string;
  originalName: string;
  /** Relative to historyDir, e.g. "originals/abc123.jpg" */
  originalPath: string;
  /** Relative to historyDir, e.g. "processed/abc123.png" */
  processedPath: string;
  model: 'medium' | 'small';
  exportScale: number;
  processingTime: string | null;
}

interface HistoryFile {
  version: 1;
  records: RemoveBgRecord[];
}

let resolvedDataDir: string | null = null;

async function getBaseDir(): Promise<string> {
  if (!resolvedDataDir) resolvedDataDir = await appLocalDataDir();
  return resolvedDataDir.replace(/[/\\]$/, '');
}

/** Absolute path to the history directory — exposed so History.vue can build asset:// URLs */
export async function getHistoryDir(): Promise<string> {
  return (await getBaseDir()) + '/removebg_history';
}

async function getIndexPath(): Promise<string> {
  return (await getHistoryDir()) + '/index.json';
}

async function ensureDirs(): Promise<void> {
  const base = await getHistoryDir();
  for (const sub of ['', '/originals', '/processed']) {
    const dir = base + sub;
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  }
}

export const historyRecords = ref<RemoveBgRecord[]>([]);
export const pendingRestore = ref<RemoveBgRecord | null>(null);
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
    console.error('removebg: failed to persist index', e);
  }
}

async function deleteImageFiles(records: RemoveBgRecord[]): Promise<void> {
  const base = await getHistoryDir();
  for (const r of records) {
    try { await remove(`${base}/${r.originalPath}`); } catch {}
    try { await remove(`${base}/${r.processedPath}`); } catch {}
  }
}

/**
 * Save both images to disk and add a record to the index.
 * originalData  — raw bytes of the original uploaded image
 * processedData — raw bytes of the full-size processed PNG from the worker
 */
export async function addHistoryRecord(
  meta: Omit<RemoveBgRecord, 'id' | 'timestamp' | 'originalPath' | 'processedPath'>,
  originalData: Uint8Array,
  processedData: Uint8Array,
): Promise<void> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const ext = (meta.originalName.split('.').pop() ?? 'png').toLowerCase();

  try {
    await ensureDirs();
    const base = await getHistoryDir();
    await writeFile(`${base}/originals/${id}.${ext}`, originalData);
    await writeFile(`${base}/processed/${id}.png`, processedData);
  } catch (e) {
    console.error('removebg: failed to write image files', e);
    return; // don't add a broken index entry
  }

  const newRecord: RemoveBgRecord = {
    id,
    timestamp: new Date().toISOString(),
    ...meta,
    originalPath: `originals/${id}.${ext}`,
    processedPath: `processed/${id}.png`,
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

/**
 * Read a history image file from disk and return a temporary object URL
 * for use in <a download> or <img>. Caller must revokeObjectURL when done.
 * Returns null if the file is missing (not yet synced from another device).
 */
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

/**
 * Read a history image file from disk as raw bytes.
 * Returns null if the file is missing.
 * Used by the sync engine to upload images to remote storage.
 */
export async function readImageBytes(relativePath: string): Promise<Uint8Array | null> {
  try {
    const base = await getHistoryDir();
    return await readFile(`${base}/${relativePath}`);
  } catch {
    return null;
  }
}

/**
 * Write raw image bytes to a history image path.
 * Creates subdirectories as needed.
 * Used by the sync engine to save downloaded images locally.
 */
export async function writeImageBytes(relativePath: string, data: Uint8Array): Promise<void> {
  await ensureDirs();
  const base = await getHistoryDir();
  await writeFile(`${base}/${relativePath}`, data);
}

/**
 * Persist a set of records to disk without modifying the reactive ref.
 * Called by the sync engine after a union merge so that sync-triggered
 * writes don't race with the reactive state update.
 */
export async function persistHistoryToDisk(records: RemoveBgRecord[]): Promise<void> {
  try {
    await ensureDirs();
    const payload: HistoryFile = { version: 1, records };
    await writeTextFile(await getIndexPath(), JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('removebg: failed to persist history to disk', e);
  }
}

/**
 * Read a history original image and return it as a File object,
 * suitable for restoring into the main RemoveBg view.
 * Returns null if the file is missing.
 */
export async function readOriginalAsFile(record: RemoveBgRecord): Promise<File | null> {
  try {
    const base = await getHistoryDir();
    const data = await readFile(`${base}/${record.originalPath}`);
    const ext = record.originalPath.split('.').pop() ?? 'png';
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
    return new File([data], record.originalName, { type: mime });
  } catch {
    return null;
  }
}
