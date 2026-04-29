import { writeImage } from '@tauri-apps/plugin-clipboard-manager'
import { Image as TauriImage } from '@tauri-apps/api/image'

/**
 * Write a PNG Blob to the system clipboard using Tauri's clipboard-manager.
 */
export async function copyPngBlobToClipboard(pngBlob: Blob): Promise<void> {
  const bytes = new Uint8Array(await pngBlob.arrayBuffer())
  const img = await TauriImage.fromBytes(bytes)
  await writeImage(img)
}
