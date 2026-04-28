import Tesseract from 'tesseract.js'

let _scheduler: Tesseract.Scheduler | null = null
let _schedulerReady: Promise<void> | null = null

async function getScheduler(): Promise<Tesseract.Scheduler> {
  if (_scheduler) return _scheduler

  if (!_schedulerReady) {
    _schedulerReady = (async () => {
      const scheduler = Tesseract.createScheduler()
      const worker = await Tesseract.createWorker(['chi_sim', 'eng'], 1, {
        // Suppress verbose logger output
        logger: () => {},
      })
      scheduler.addWorker(worker)
      _scheduler = scheduler
    })()
  }

  await _schedulerReady
  return _scheduler!
}

/**
 * OCR a base64-encoded image. Returns extracted text, or empty string on failure.
 * The worker is lazily initialized and reused across calls.
 */
export async function ocrImage(base64Data: string, mimeType: string): Promise<string> {
  try {
    const scheduler = await getScheduler()
    const dataUrl = `data:${mimeType};base64,${base64Data}`
    const result = await scheduler.addJob('recognize', dataUrl)
    return result.data.text.trim()
  } catch {
    return ''
  }
}
