import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { ref } from 'vue'
import { travelNotesDir } from './path'

export const imageBaseDir = ref('')

export async function initImageAssetBase() {
  if (imageBaseDir.value) return
  imageBaseDir.value = await travelNotesDir()
  // Register the directory in Tauri's asset protocol scope so convertFileSrc works,
  // especially when the user has configured a custom data path.
  try { await invoke('allow_asset_directory', { path: imageBaseDir.value }) } catch { /* ignore */ }
}

export function resolveImageUrl(src: string): string {
  if (!src) return src
  if (src.startsWith('http')) return src
  const baseDir = imageBaseDir.value
  if (baseDir) {
    // Pass the raw path to convertFileSrc — it handles URL-encoding internally.
    if (src.startsWith('/')) {
      return convertFileSrc(src)
    }
    return convertFileSrc(`${baseDir}/${src}`)
  }
  return src
}
