/**
 * RemoveBg model file sync.
 *
 * Keeps ONNX / WASM model weights in sync between local disk
 * ({dataRoot}/tools/remove_bg/) and the backend file store.
 *
 * Strategy:
 *   1. List local files + SHA-256 hashes
 *   2. List remote files + SHA-256 hashes
 *   3. Download remote files missing locally or with differing hash
 *   4. Upload local files missing remotely
 *   5. Identical hashes → skip (no transfer, dedup)
 */

import { readFile, writeFile, mkdir, exists, readDir, remove } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { toolsRemoveBgDir } from '../../../../utils/path'
import { apiGet, apiPostForm, isBackendConfigured, getServerApiKey, getBackendConfig } from '../../../../services/api'

export interface ModelFileInfo {
  name: string
  hash: string
  size: number
}

async function sha256(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function listLocalModels(dir: string): Promise<ModelFileInfo[]> {
  if (!(await exists(dir))) return []
  const entries = await readDir(dir)
  const files: ModelFileInfo[] = []
  for (const entry of entries) {
    if (!entry.isFile) continue
    const path = `${dir}/${entry.name}`
    const data = await readFile(path)
    files.push({
      name: entry.name,
      hash: await sha256(data),
      size: data.length,
    })
  }
  return files
}

async function fetchRemoteModels(): Promise<ModelFileInfo[]> {
  if (!isBackendConfigured()) return []
  const resp = await apiGet<{ files: ModelFileInfo[] }>('/api/tools/models/remove_bg')
  return resp?.files ?? []
}

async function downloadModel(filename: string, destPath: string): Promise<void> {
  const base = getBackendConfig()?.url ?? ''
  const resp = await tauriFetch(`${base}/api/tools/models/remove_bg/${encodeURIComponent(filename)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${getServerApiKey()}` },
  })
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)
  const data = new Uint8Array(await resp.arrayBuffer())
  await writeFile(destPath, data)
}

async function uploadModel(localPath: string, filename: string): Promise<void> {
  const data = await readFile(localPath)
  const form = new FormData()
  form.append('file', new Blob([data]))
  await apiPostForm(`/api/tools/models/remove_bg/${encodeURIComponent(filename)}`, form)
}

/**
 * Bidirectional sync of RemoveBg model files.
 * Runs best-effort; failures are logged but not thrown.
 */
export async function syncRemoveBgModels(): Promise<void> {
  if (!isBackendConfigured()) return
  const localDir = await toolsRemoveBgDir()
  await mkdir(localDir, { recursive: true })

  const [localFiles, remoteFiles] = await Promise.all([
    listLocalModels(localDir),
    fetchRemoteModels(),
  ])

  const localMap = new Map(localFiles.map((f) => [f.name, f]))
  const remoteMap = new Map(remoteFiles.map((f) => [f.name, f]))

  // Download missing / changed remote files
  for (const remote of remoteFiles) {
    const local = localMap.get(remote.name)
    if (local && local.hash === remote.hash) continue // identical → skip
    try {
      await downloadModel(remote.name, `${localDir}/${remote.name}`)
    } catch (e) {
      console.error(`[RemoveBgSync] failed to download ${remote.name}:`, e)
    }
  }

  // Upload local-only files
  for (const local of localFiles) {
    if (remoteMap.has(local.name)) continue
    try {
      await uploadModel(`${localDir}/${local.name}`, local.name)
    } catch (e) {
      console.error(`[RemoveBgSync] failed to upload ${local.name}:`, e)
    }
  }
}

/**
 * Check whether local RemoveBg models are present (resources.json exists).
 */
export async function hasLocalRemoveBgModels(): Promise<boolean> {
  const dir = await toolsRemoveBgDir()
  return exists(`${dir}/resources.json`)
}

/**
 * Delete a local model file (used when cleaning up old versions).
 */
export async function deleteLocalModel(filename: string): Promise<void> {
  const dir = await toolsRemoveBgDir()
  const path = `${dir}/${filename}`
  if (await exists(path)) {
    await remove(path)
  }
}
