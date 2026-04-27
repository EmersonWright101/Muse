/**
 * PDF utilities — text extraction via @libpdf/core.
 *
 * Extracted text is used as fallback for providers that don't natively support PDF
 * (OpenAI-compatible / custom). Anthropic, Google and OpenRouter receive the raw base64 PDF.
 */

import { PDF } from '@libpdf/core'

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

/** Extract plain text from a PDF file. Returns page-by-page text joined by newlines. */
export async function extractPdfText(base64: string): Promise<{ text: string; pageCount: number }> {
  const binary = atob(base64)
  const bytes  = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  const pdf = await PDF.load(bytes)
  const pageCount = pdf.getPageCount()

  const pages: string[] = []
  for (const page of pdf.getPages()) {
    const pageText = page.extractText()
    const text = pageText.text.replace(/\s+/g, ' ').trim()
    if (text) pages.push(text)
  }

  return { text: pages.join('\n\n'), pageCount }
}

/** Process a PDF File into a PdfMeta object ready to be stored in AttachmentMeta. */
export async function processPdfFile(file: File): Promise<PdfMeta> {
  const base64 = await fileToBase64(file)
  const { text, pageCount } = await extractPdfText(base64)
  return { base64, extractedText: text, pageCount }
}
