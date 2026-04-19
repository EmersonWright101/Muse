/**
 * PDF utilities — text extraction via pdfjs-dist (runs entirely in-browser, no server needed).
 *
 * Extracted text is used as fallback for providers that don't natively support PDF
 * (OpenAI-compatible / OpenRouter).  Anthropic and Google receive the raw base64 PDF.
 */

import * as pdfjsLib from 'pdfjs-dist'

// Point pdfjs at the bundled worker via Vite's static-asset URL resolution
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

export interface PdfMeta {
  base64:        string
  extractedText: string
  pageCount:     number
}

/** Read a File as base64 string (without the data-URL prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = (e) => {
      const dataUrl = e.target?.result as string
      resolve(dataUrl.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Extract plain text from a PDF file.  Returns page-by-page text joined by newlines. */
export async function extractPdfText(base64: string): Promise<{ text: string; pageCount: number }> {
  const binary = atob(base64)
  const bytes  = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  const pdf   = await pdfjsLib.getDocument({ data: bytes }).promise
  const pages: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i)
    const content = await page.getTextContent()
    const text    = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) pages.push(`[第 ${i} 页]\n${text}`)
  }

  return { text: pages.join('\n\n'), pageCount: pdf.numPages }
}

/** Process a PDF File into a PdfMeta object ready to be stored in AttachmentMeta. */
export async function processPdfFile(file: File): Promise<PdfMeta> {
  const base64 = await fileToBase64(file)
  const { text, pageCount } = await extractPdfText(base64)
  return { base64, extractedText: text, pageCount }
}
