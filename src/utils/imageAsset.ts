import { convertFileSrc } from '@tauri-apps/api/core'
import { ref } from 'vue'
import { travelNotesDir } from './path'

export const imageBaseDir = ref('')

export async function initImageAssetBase() {
  if (imageBaseDir.value) return
  imageBaseDir.value = await travelNotesDir()
}

export function resolveImageUrl(src: string): string {
  if (!src) return src
  if (src.startsWith('http')) return src
  const baseDir = imageBaseDir.value
  if (baseDir) {
    if (src.startsWith('/')) {
      return convertFileSrc(encodeURI(src))
    }
    return convertFileSrc(encodeURI(`${baseDir}/${src}`))
  }
  return src
}
