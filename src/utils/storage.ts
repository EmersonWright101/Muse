/**
 * File-based storage for chat conversations.
 *
 * Layout under {appLocalDataDir}/muse/:
 *   conversations/index.json   — array of ConversationMeta (lightweight list)
 *   conversations/{id}.json    — full conversation with messages
 *   attachments/{convId}/{file} — image/file attachments
 */

import {
  readTextFile,
  writeTextFile,
  exists,
  mkdir,
  remove,
  rename,
} from '@tauri-apps/plugin-fs';
import { resolveDataRoot, conversationsDir } from './path';

export interface AttachmentMeta {
  id:       string;
  name:     string;
  mimeType: string;
  /** base64-encoded data for images/PDFs sent to API */
  data?:    string;
  /** local path for non-inline files */
  path?:    string;
  size?:    number;
  /** pre-extracted plain text for PDF (used by non-native providers) */
  extractedText?: string;
  /** number of pages for PDF */
  pageCount?: number;
}

export interface MessageUsage {
  inputTokens?:     number;
  outputTokens?:    number;
  reasoningTokens?: number;
  durationMs?:      number;
  costUsd?:         number;
  tokensPerSecond?: number;  // generation speed reported by provider (Ollama eval_count / eval_duration)
}

export interface MessageVariant {
  id:           string;
  content:      string;
  model:        string;
  providerId:   string;
  usage?:       MessageUsage;
  reasoning?:   string;
  error?:       boolean;
  mediaOutputs?: Array<{ mimeType: string; data?: string; url?: string }>;
  feedback?:    'positive' | 'negative' | null;
}

export interface ChatMessage {
  id:          string;
  role:        'user' | 'assistant' | 'system';
  content:     string;
  attachments?: AttachmentMeta[];
  timestamp:   string;
  model?:      string;
  providerId?: string;
  error?:        boolean;
  usage?:        MessageUsage;
  reasoning?:    string;
  mediaOutputs?: Array<{ mimeType: string; data?: string; url?: string }>;
  variants?:        MessageVariant[];
  activeVariantIdx?: number;  // 0 = original, 1+ = variants[activeVariantIdx-1]
  feedback?:    'positive' | 'negative' | null;
}

export interface Assistant {
  id:                 string;
  name:               string;
  systemPrompt:       string;
  color:              string;
  defaultProviderId?: string;
  defaultModelId?:    string;
  createdAt:          string;
  updatedAt:          string;
}

export interface Conversation {
  id:                  string;
  title:               string;
  createdAt:           string;
  updatedAt:           string;
  providerId:          string;
  model:               string;
  messages:            ChatMessage[];
  pinned?:             boolean;
  assistantId?:        string;
  contextCutoffMsgId?: string;
  titleGenerated?:     boolean;
}

export interface ConversationMeta {
  id:          string;
  title:       string;
  createdAt:   string;
  updatedAt:   string;
  preview:     string;
  model:       string;
  providerId:  string;
  pinned?:     boolean;
  assistantId?: string;
}

// ─── Paths ───────────────────────────────────────────────────────────────────

async function convDir(): Promise<string> {
  return conversationsDir();
}

async function ensureDirs(): Promise<void> {
  const d = await convDir();
  if (!(await exists(d))) await mkdir(d, { recursive: true });
}

// ─── Mutex ───────────────────────────────────────────────────────────────────
// Serializes concurrent read-modify-write operations on shared JSON files.

class AsyncMutex {
  private _queue: Promise<void> = Promise.resolve()
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this._queue.then(fn)
    this._queue = result.then(() => {}, () => {})
    return result
  }
}

const indexMutex      = new AsyncMutex()
const assistantsMutex = new AsyncMutex()

// ─── Index ───────────────────────────────────────────────────────────────────

async function readIndex(): Promise<ConversationMeta[]> {
  try {
    const path = `${await convDir()}/index.json`;
    if (!(await exists(path))) return [];
    const raw = await readTextFile(path);
    return JSON.parse(raw) as ConversationMeta[];
  } catch {
    return [];
  }
}

async function writeIndex(index: ConversationMeta[]): Promise<void> {
  await ensureDirs();
  const path = `${await convDir()}/index.json`;
  await atomicWriteTextFile(path, JSON.stringify(index, null, 2));
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function listConversations(): Promise<ConversationMeta[]> {
  const index = await readIndex();
  return index.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export async function loadConversation(id: string): Promise<Conversation | null> {
  try {
    const path = `${await convDir()}/${id}.json`;
    if (!(await exists(path))) return null;
    const raw = await readTextFile(path);
    return JSON.parse(raw) as Conversation;
  } catch {
    return null;
  }
}

async function atomicWriteTextFile(path: string, content: string): Promise<void> {
  const tmpPath = `${path}.tmp`;
  await writeTextFile(tmpPath, content);
  await rename(tmpPath, path);
}

export async function saveConversation(conv: Conversation): Promise<void> {
  await ensureDirs();
  const path = `${await convDir()}/${conv.id}.json`;
  await atomicWriteTextFile(path, JSON.stringify(conv, null, 2));
  localStorage.setItem('muse-ts-conversations', new Date().toISOString());

  await indexMutex.run(async () => {
    const index = await readIndex();
    const idx   = index.findIndex(m => m.id === conv.id);
    const lastMsg = conv.messages.filter(m => m.role !== 'system').at(-1);
    const meta: ConversationMeta = {
      id:          conv.id,
      title:       conv.title,
      createdAt:   conv.createdAt,
      updatedAt:   conv.updatedAt,
      preview:     lastMsg ? lastMsg.content.slice(0, 80).replace(/\n/g, ' ') : '',
      model:       conv.model,
      providerId:  conv.providerId,
      pinned:      conv.pinned,
      assistantId: conv.assistantId,
    };
    if (idx >= 0) index[idx] = meta;
    else index.unshift(meta);
    await writeIndex(index);
  });
}

const LS_DELETED_CONVERSATIONS_KEY = 'muse-deleted-conversations';

async function tombstonesPath(): Promise<string> {
  return `${await resolveDataRoot()}/tombstones.json`;
}

async function loadDiskTombstones(): Promise<Record<string, string>> {
  try {
    const path = await tombstonesPath();
    if (!(await exists(path))) return {};
    const raw = await readTextFile(path);
    return JSON.parse(raw) as Record<string, string>;
  } catch { return {} }
}

async function saveDiskTombstones(map: Record<string, string>): Promise<void> {
  try {
    await atomicWriteTextFile(await tombstonesPath(), JSON.stringify(map, null, 2));
  } catch { /* ignore */ }
}

export function getDeletedConversations(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_DELETED_CONVERSATIONS_KEY) ?? '{}') } catch { return {} }
}

export function applyRemoteDeletedConversations(remote: Record<string, string>) {
  const local = getDeletedConversations();
  let changed = false;
  for (const [id, ts] of Object.entries(remote)) {
    if (!local[id] || ts > local[id]) { local[id] = ts; changed = true; }
  }
  if (changed) {
    localStorage.setItem(LS_DELETED_CONVERSATIONS_KEY, JSON.stringify(local));
    saveDiskTombstones(local);
  }
}

export async function deleteConversation(id: string): Promise<void> {
  try {
    const path = `${await convDir()}/${id}.json`;
    if (await exists(path)) await remove(path);
  } catch { /* ignore */ }

  await indexMutex.run(async () => {
    const index = await readIndex();
    await writeIndex(index.filter(m => m.id !== id));
  });
  const map = getDeletedConversations();
  map[id] = new Date().toISOString();
  localStorage.setItem(LS_DELETED_CONVERSATIONS_KEY, JSON.stringify(map));
  saveDiskTombstones(map);
  localStorage.setItem('muse-ts-conversations', new Date().toISOString());
}

export async function deleteConversations(ids: string[]): Promise<void> {
  const set = new Set(ids);
  const now = new Date().toISOString();
  for (const id of set) {
    try {
      const path = `${await convDir()}/${id}.json`;
      if (await exists(path)) await remove(path);
    } catch { /* ignore */ }
  }
  await indexMutex.run(async () => {
    const index = await readIndex();
    await writeIndex(index.filter(m => !set.has(m.id)));
  });
  const map = getDeletedConversations();
  for (const id of set) map[id] = now;
  localStorage.setItem(LS_DELETED_CONVERSATIONS_KEY, JSON.stringify(map));
  saveDiskTombstones(map);
  localStorage.setItem('muse-ts-conversations', new Date().toISOString());
}

// ─── Assistants ──────────────────────────────────────────────────────────────

const LS_DELETED_ASSISTANTS_KEY = 'muse-deleted-assistants';

export function getDeletedAssistants(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_DELETED_ASSISTANTS_KEY) ?? '{}') } catch { return {} }
}

export function applyRemoteDeletedAssistants(remote: Record<string, string>) {
  const local = getDeletedAssistants();
  let changed = false;
  for (const [id, ts] of Object.entries(remote)) {
    if (!local[id] || ts > local[id]) { local[id] = ts; changed = true; }
  }
  if (changed) {
    localStorage.setItem(LS_DELETED_ASSISTANTS_KEY, JSON.stringify(local));
    saveDiskTombstones(local);
  }
}

async function assistantsPath(): Promise<string> {
  return `${await resolveDataRoot()}/assistants.json`;
}

export async function listAssistants(): Promise<Assistant[]> {
  try {
    const path = await assistantsPath();
    if (!(await exists(path))) return [];
    const raw = await readTextFile(path);
    return JSON.parse(raw) as Assistant[];
  } catch {
    return [];
  }
}

export async function saveAssistant(assistant: Assistant): Promise<void> {
  await ensureDirs();
  await assistantsMutex.run(async () => {
    const list = await listAssistants();
    const idx  = list.findIndex(a => a.id === assistant.id);
    if (idx >= 0) list[idx] = assistant;
    else list.push(assistant);
    await atomicWriteTextFile(await assistantsPath(), JSON.stringify(list, null, 2));
  });
  localStorage.setItem('muse-ts-assistants', new Date().toISOString());
}

export async function deleteAssistant(id: string): Promise<void> {
  await assistantsMutex.run(async () => {
    const list = await listAssistants();
    await atomicWriteTextFile(await assistantsPath(), JSON.stringify(list.filter(a => a.id !== id), null, 2));
  });
  const map = getDeletedAssistants();
  map[id] = new Date().toISOString();
  localStorage.setItem(LS_DELETED_ASSISTANTS_KEY, JSON.stringify(map));
  saveDiskTombstones(map);
  localStorage.setItem('muse-ts-assistants', new Date().toISOString());
}

/** Generate a UUID v4. */
export function newId(): string {
  return crypto.randomUUID();
}

/** Build a short preview text from the last user message. */
export function buildPreview(messages: ChatMessage[]): string {
  const last = messages.filter(m => m.role === 'user').at(-1);
  return last ? last.content.slice(0, 80).replace(/\n/g, ' ') : '';
}

// ─── Sync merge helpers ──────────────────────────────────────────────────────

export function mergeVariants(
  local?: MessageVariant[],
  remote?: MessageVariant[],
): MessageVariant[] | undefined {
  if (!local?.length && !remote?.length) return undefined
  if (!remote?.length) return local
  if (!local?.length) return remote
  const map = new Map<string, MessageVariant>()
  for (const v of local) map.set(v.id, v)
  for (const v of remote) { if (!map.has(v.id)) map.set(v.id, v) }
  return [...map.values()]
}

export function mergeMessages(local: ChatMessage[], remote: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>()
  for (const msg of local) map.set(msg.id, msg)
  for (const msg of remote) {
    const existing = map.get(msg.id)
    if (!existing) {
      map.set(msg.id, msg)
    } else {
      const base = msg.timestamp > existing.timestamp ? msg : existing
      const variants = mergeVariants(existing.variants, msg.variants)
      map.set(msg.id, variants ? { ...base, variants } : base)
    }
  }
  return [...map.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

export function mergeConversation(
  local: Conversation, remote: Conversation,
): { merged: Conversation; localChanged: boolean; remoteChanged: boolean } {
  const messages = mergeMessages(local.messages, remote.messages)
  const newerIsRemote = remote.updatedAt > local.updatedAt
  const base = newerIsRemote ? remote : local
  const merged: Conversation = { ...base, messages }

  const localChanged = messages.length !== local.messages.length
    || merged.updatedAt !== local.updatedAt
    || merged.title !== local.title
  const remoteChanged = messages.length !== remote.messages.length
    || merged.updatedAt !== remote.updatedAt
    || merged.title !== remote.title

  return { merged, localChanged, remoteChanged }
}

// ─── Tombstone recovery from disk ────────────────────────────────────────────
// If localStorage tombstones were lost (e.g. browser data cleared), restore
// them from the on-disk backup on module load.

;(async () => {
  try {
    const disk = await loadDiskTombstones()
    const conv = getDeletedConversations()
    const ast  = getDeletedAssistants()
    let changedConv = false
    let changedAst  = false
    for (const [id, ts] of Object.entries(disk)) {
      if (!conv[id] || ts > conv[id]) { conv[id] = ts; changedConv = true }
      if (!ast[id]  || ts > ast[id])  { ast[id]  = ts; changedAst  = true }
    }
    if (changedConv) localStorage.setItem(LS_DELETED_CONVERSATIONS_KEY, JSON.stringify(conv))
    if (changedAst)  localStorage.setItem(LS_DELETED_ASSISTANTS_KEY, JSON.stringify(ast))
  } catch { /* ignore */ }
})()
