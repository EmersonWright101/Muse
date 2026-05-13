import { apiGet, apiPut, apiPostForm, apiGetBinary } from './api'
import { recordSyncTimestamp } from '../utils/syncTimestamp'
import { settings } from '../modules/tools/stores/toolsSettings'

const TOOL_NAMES = [
  'bibtex',
  'diff',
  'latex2png',
  'latexconv',
  'tablegen',
  'textconv',
  'textstats',
  'removebg',
  'qrcode',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

interface HistoryPayload {
  records: any[]
  updated_at: string
}

export async function fetchToolHistory(toolName: ToolName): Promise<HistoryPayload | null> {
  return apiGet<HistoryPayload>(`/api/tools/history/${toolName}`)
}

export async function pushToolHistory(toolName: ToolName, records: any[]): Promise<void> {
  await apiPut(`/api/tools/history/${toolName}`, { records })
}

/**
 * Union-merge local and remote records by ID, sort by timestamp DESC,
 * trim to historyMaxRecords, and push the merged set back.
 */
export async function syncToolHistory(
  toolName: ToolName,
  localRecords: any[],
): Promise<any[]> {
  const remote = await fetchToolHistory(toolName)

  if (!remote || !remote.records || remote.records.length === 0) {
    if (localRecords.length > 0) {
      await pushToolHistory(toolName, localRecords)
    }
    return localRecords
  }

  const remoteRecords = remote.records
  const localIdSet = new Set(localRecords.map((r) => r.id))
  const remoteIdSet = new Set(remoteRecords.map((r) => r.id))

  const newFromRemote = remoteRecords.filter((r) => !localIdSet.has(r.id))
  const newFromLocal = localRecords.filter((r) => !remoteIdSet.has(r.id))

  const merged = [...localRecords, ...newFromRemote]
    .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
    .slice(0, settings.historyMaxRecords)

  if (newFromLocal.length > 0 || newFromRemote.length > 0 || merged.length < localRecords.length) {
    await pushToolHistory(toolName, merged)
  }

  return merged
}

// ── Asset sync (RemoveBg images) ────────────────────────────────────────────

export async function fetchToolAsset(
  toolName: string,
  recordId: string,
  assetPath: string,
): Promise<Uint8Array | null> {
  return apiGetBinary(`/api/tools/assets/${toolName}/${recordId}/${assetPath}`)
}

export async function uploadToolAsset(
  toolName: string,
  recordId: string,
  assetPath: string,
  data: Uint8Array,
): Promise<string | null> {
  const form = new FormData()
  form.append('tool_name', toolName)
  form.append('record_id', recordId)
  form.append('asset_path', assetPath)
  form.append('file', new Blob([data]))
  const resp = await apiPostForm<{ id: string }>(`/api/tools/assets`, form)
  return resp?.id ?? null
}

// ── Lazy store accessors (avoid circular init) ──────────────────────────────

async function getToolStore(name: ToolName) {
  switch (name) {
    case 'bibtex':
      return import('../modules/tools/stores/bibtexConverter')
    case 'diff':
      return import('../modules/tools/stores/diffViewer')
    case 'latex2png':
      return import('../modules/tools/stores/latex2png')
    case 'latexconv':
      return import('../modules/tools/stores/latexConverter')
    case 'tablegen':
      return import('../modules/tools/stores/tableGenerator')
    case 'textconv':
      return import('../modules/tools/stores/textConverter')
    case 'textstats':
      return import('../modules/tools/stores/textStats')
    case 'removebg':
      return import('../modules/tools/stores/removeBg')
    case 'qrcode':
      return import('../modules/tools/stores/qrCode')
  }
}

/** Load and sync all tool histories. Called from syncManager2. */
export async function syncAllToolHistories(): Promise<void> {
  const results = await Promise.allSettled(
    TOOL_NAMES.map(async (name) => {
      const mod = await getToolStore(name)
      if (!mod || !mod.historyRecords) return
      const local = mod.historyRecords.value as any[]
      const merged = await syncToolHistory(name, local)
      if (merged !== local && mod.historyRecords) {
        mod.historyRecords.value = merged
        const m = mod as any
        if (m.persistHistoryToDisk) {
          await m.persistHistoryToDisk(merged)
        }
      }
    })
  )

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      console.error(`[Sync] Failed to sync tool history for ${TOOL_NAMES[i]}:`, (results[i] as PromiseRejectedResult).reason)
    }
  }
  recordSyncTimestamp('tools', new Date().toISOString())
}

/** Push all local tool histories to server (first-time migration). */
export async function pushAllToolHistories(): Promise<void> {
  for (const name of TOOL_NAMES) {
    const mod = await getToolStore(name)
    if (!mod || !mod.historyRecords) continue
    const local = mod.historyRecords.value as any[]
    if (local.length > 0) {
      await pushToolHistory(name, local)
    }
  }
}
