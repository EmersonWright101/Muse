/**
 * Wraps epub.js to provide reactive EPUB rendering within a container element.
 * Handles font/theme/size changes, text selection, annotations, and navigation.
 */

import { ref, watch, onUnmounted, type Ref } from 'vue'
import type { ReaderSettings, BookAnnotation } from '../../../stores/ebook'
// @ts-ignore – epubjs ships its own typedefs but they can be incomplete
import ePub from 'epubjs'

export interface TocItem {
  label: string
  href: string
  subitems?: TocItem[]
}

export interface EpubMeta {
  title: string
  author: string
  language: string
  publisher: string
  description: string
  cover: string | null       // base64 data URL
}

export interface SelectionState {
  cfiRange: string
  text: string
  rect: { top: number; left: number; width: number }
}

const THEME_STYLES = {
  light: { body: { color: '#1c1c1e', background: '#ffffff' } },
  sepia: { body: { color: '#3b2e1a', background: '#f4ecd8' } },
  dark:  { body: { color: '#e5e5ea', background: '#1c1c1e' } },
}

const FONT_FAMILIES: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif:  'Georgia, "Times New Roman", serif',
  sans:   '"Helvetica Neue", Arial, sans-serif',
  mono:   '"SF Mono", "Menlo", monospace',
}

export function useEpubReader(containerRef: Ref<HTMLElement | undefined>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bookRef = ref<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renditionRef = ref<any>(null)

  // Tracks current settings so the content hook can always inject fresh styles
  let _currentSettings: ReaderSettings | null = null

  const toc          = ref<TocItem[]>([])
  const isReady      = ref(false)
  const isLoading    = ref(false)
  const error        = ref<string | null>(null)
  const currentCfi   = ref<string>('')
  const currentHref  = ref<string>('')
  const percentage   = ref(0)
  const totalLocs    = ref(0)
  const selection    = ref<SelectionState | null>(null)
  const contextMenu  = ref<{
    visible: boolean
    x: number
    y: number
    highlightCfi?: string
  } | null>(null)
  const currentSpineIdx   = ref<number>(-1)
  const currentChapterText = ref<string>('')
  const currentPageText = ref<string>('')
  const pageTurn = ref<{ id: number; direction: 'next' | 'prev' | 'jump' }>({ id: 0, direction: 'next' })
  const clickedAnnotationCfi = ref<string | null>(null)
  let pendingPageDirection: 'next' | 'prev' | 'jump' | null = null
  let lastLocationIndex: number | null = null
  let resizeObserver: ResizeObserver | null = null
  let lastWheelAt = 0
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  let _justContextMenu = false

  // ─── Load & render ───────────────────────────────────────────────────────────

  async function loadBook(arrayBuffer: ArrayBuffer, settings: ReaderSettings): Promise<EpubMeta | null> {
    if (!containerRef.value) return null
    isLoading.value = true
    error.value = null

    // Destroy previous
    await destroyBook()

    try {
      const book = ePub(arrayBuffer.slice(0))
      bookRef.value = book

      await book.ready

      // Extract metadata
      const meta = book.packaging?.metadata ?? {}
      const coverUrl = await extractCoverBase64(book).catch(() => null)

      const epubMeta: EpubMeta = {
        title:       meta.title        ?? 'Unknown Title',
        author:      meta.creator      ?? 'Unknown Author',
        language:    meta.language     ?? '',
        publisher:   meta.publisher    ?? '',
        description: meta.description  ?? '',
        cover:       coverUrl,
      }

      // Build TOC
      const nav = await book.loaded.navigation
      toc.value = buildToc(nav?.toc ?? [])

      // Create rendition
      const rendition = book.renderTo(containerRef.value, {
        width:  '100%',
        height: '100%',
        spread: settings.scrollMode ? 'none' : (settings.spread ?? 'none'),
        flow:   settings.scrollMode ? 'scrolled-doc' : 'paginated',
        allowScriptedContent: true,
      })
      renditionRef.value = rendition
      observeContainer()

      // marks-pane SVG overlays live in the parent document, not the epub iframe.
      // Inject CSS here so .epub-hl <g> elements override the SVG container's pointer-events:none.
      if (!document.getElementById('muse-marks-pane-fix')) {
        const s = document.createElement('style')
        s.id = 'muse-marks-pane-fix'
        s.textContent = '.epub-hl, .epub-ul { pointer-events: all !important; cursor: pointer; } .epub-hl:hover, .epub-ul:hover { opacity: 0.75; }'
        document.head.appendChild(s)
      }

      // Inject font/size overrides into every iframe as it renders
      rendition.hooks.content.register((contents: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = contents as any
        const doc = c?.document
        if (!doc || !_currentSettings) return
        let el = doc.getElementById('muse-font-override') as HTMLStyleElement | null
        if (!el) {
          el = doc.createElement('style') as HTMLStyleElement
          el.id = 'muse-font-override'
          doc.head?.appendChild(el)
        }
        el.textContent = buildFontCss(_currentSettings)
        installSelectionFallback(c)

        // Wheel-to-turn: capture scroll inside the iframe to flip pages (paginated mode only)
        if (!doc.__museWheelInstalled) {
          doc.__museWheelInstalled = true
          doc.addEventListener('wheel', (e: WheelEvent) => {
            if (_currentSettings?.scrollMode) return
            e.preventDefault()
            const now = Date.now()
            if (now - lastWheelAt < 500) return
            lastWheelAt = now
            if (e.deltaY > 0) next()
            else if (e.deltaY < 0) prev()
          }, { passive: false })
        }
      })

      applyTheme(settings)

      // Generate locations for progress tracking
      book.locations.generate(1024).then((locs: string[]) => {
        totalLocs.value = locs.length
      }).catch(() => {})

      // Selection event
      rendition.on('selected', (cfiRange: string, contents: unknown) => {
        updateSelectionFromContents(contents, cfiRange)
      })

      // Click inside iframe: clear selection & hide context menu on plain clicks
      rendition.on('click', () => {
        window.setTimeout(() => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const contents: any[] = (renditionRef.value as any)?.getContents?.() ?? []
            const hasSelectedText = contents.some((content: any) =>
              !!content?.window?.getSelection?.()?.toString?.().trim(),
            )
            if (!hasSelectedText) selection.value = null
          } catch {
            selection.value = null
          }
        }, 60)
        if (!_justContextMenu) contextMenu.value = null
      })

      // Keyboard navigation (epubjs forwards iframe key events to the rendition)
      rendition.on('keyup', (e: KeyboardEvent) => {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') next()
        else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev()
      })

      // Location change → update progress
      rendition.on('relocated', (location: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loc = location as any
        currentCfi.value      = loc?.start?.cfi   ?? ''
        currentHref.value     = loc?.start?.href  ?? ''
        currentSpineIdx.value = loc?.start?.index ?? -1
        const locIndex = loc?.start?.location
        if (totalLocs.value > 0) {
          percentage.value = Math.round((locIndex ?? 0) / totalLocs.value * 100)
        } else if (loc?.start?.percentage != null) {
          percentage.value = Math.round(loc.start.percentage * 100)
        }
        const inferredDirection =
          pendingPageDirection ??
          (lastLocationIndex != null && typeof locIndex === 'number'
            ? locIndex >= lastLocationIndex ? 'next' : 'prev'
            : 'next')
        if (lastLocationIndex !== null || pendingPageDirection) {
          pageTurn.value = { id: pageTurn.value.id + 1, direction: inferredDirection }
        }
        if (typeof locIndex === 'number') lastLocationIndex = locIndex
        pendingPageDirection = null
        // Grab chapter text for copilot context
        extractCurrentChapterText().catch(() => {})
        extractCurrentPageText().catch(() => {})
      })

      isReady.value = true
      isLoading.value = false
      return epubMeta

    } catch (e) {
      error.value = String(e)
      isLoading.value = false
      isReady.value = false
      return null
    }
  }

  async function display(cfi?: string) {
    const r = renditionRef.value
    if (!r) return
    if (cfi && cfi.startsWith('epubcfi(')) {
      await r.display(cfi).catch(() => r.display())
    } else {
      await r.display()
    }
  }

  async function next() {
    pendingPageDirection = 'next'
    await renditionRef.value?.next?.()
    selection.value = null
  }

  async function prev() {
    pendingPageDirection = 'prev'
    await renditionRef.value?.prev?.()
    selection.value = null
  }

  async function jumpTo(href: string) {
    pendingPageDirection = 'jump'
    await renditionRef.value?.display?.(href)
    selection.value = null
  }

  // ─── Appearance ──────────────────────────────────────────────────────────────

  function buildFontCss(s: ReaderSettings): string {
    const ff  = FONT_FAMILIES[s.fontFamily] ?? FONT_FAMILIES.serif
    const col = THEME_STYLES[s.theme].body
    const fs  = s.fontSize

    // In paginated mode epubjs manages viewport/margins internally — don't add body padding
    // or max-width; those would break its page-size calculations.
    // In scroll mode we control the layout ourselves.
    const layoutCss = s.scrollMode
      ? `body {
  max-width:  720px !important;
  margin:     0 auto !important;
  padding:    24px 40px !important;
  box-sizing: border-box !important;
}`
      : `body { margin: 0 !important; padding: 0 !important; }`

    return `
html { background: ${col.background} !important; }
body { color: ${col.color} !important; background: ${col.background} !important; }
${layoutCss}
/* Font family on text elements — deliberately skip generic div/section
   so book-internal float/table layouts aren't disturbed */
p, li, td, th,
h1, h2, h3, h4, h5, h6,
span, a, em, strong, cite, blockquote, figcaption {
  font-family: ${ff} !important;
}
p, li, td, th {
  font-size:   ${fs}px         !important;
  line-height: ${s.lineHeight} !important;
}
h1 { font-size: ${Math.round(fs * 1.75)}px !important; }
h2 { font-size: ${Math.round(fs * 1.45)}px !important; }
h3 { font-size: ${Math.round(fs * 1.20)}px !important; }
h4, h5, h6 { font-size: ${Math.round(fs * 1.05)}px !important; }
img { max-width: 100% !important; height: auto !important; }
.muse-tts-chunk-highlight {
  background: rgba(0, 122, 255, 0.22) !important;
  border-radius: 2px;
  transition: background 0.15s;
}
`
  }

  function applyTheme(s: ReaderSettings) {
    _currentSettings = s
    const r = renditionRef.value
    if (!r) return

    const themeColors = THEME_STYLES[s.theme]

    // Register theme for colors and layout
    r.themes.register('muse', {
      body: {
        ...themeColors.body,
        'max-width':  '100%',
        'box-sizing': 'border-box',
      },
      p: { 'margin-bottom': '0.8em' },
    })
    r.themes.select('muse')

    // Immediately push font overrides into all currently rendered iframes
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents: any[] = r.getContents?.() ?? []
      for (const content of contents) {
        const doc = content?.document
        if (!doc) continue
        let el = doc.getElementById('muse-font-override') as HTMLStyleElement | null
        if (!el) {
          el = doc.createElement('style') as HTMLStyleElement
          el.id = 'muse-font-override'
          doc.head?.appendChild(el)
        }
        el.textContent = buildFontCss(s)
        // Also force color/background via inline style so EPUB CSS can't override
        const html = doc.documentElement
        const body = doc.body
        if (html) html.style.setProperty('background', themeColors.body.background, 'important')
        if (body) {
          body.style.setProperty('color', themeColors.body.color, 'important')
          body.style.setProperty('background', themeColors.body.background, 'important')
        }
      }
    } catch { /* ignore */ }
  }

  function updateSettings(s: ReaderSettings) {
    _currentSettings = s
    const r = renditionRef.value
    if (!r || !isReady.value) return

    const themeColors = THEME_STYLES[s.theme]
    const css = buildFontCss(s)

    // Directly update the style element in every currently-rendered iframe.
    // epub.js reuses existing views when re-displaying the same section, so the
    // content hook never re-fires — we must push CSS changes imperatively.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents: any[] = r.getContents?.() ?? []
      for (const content of contents) {
        const doc = content?.document
        if (!doc) continue
        let el = doc.getElementById('muse-font-override') as HTMLStyleElement | null
        if (!el) {
          el = doc.createElement('style') as HTMLStyleElement
          el.id = 'muse-font-override'
          doc.head?.appendChild(el)
        }
        el.textContent = css
        const html = doc.documentElement
        const body = doc.body
        if (html) html.style.setProperty('background', themeColors.body.background, 'important')
        if (body) {
          body.style.setProperty('color', themeColors.body.color, 'important')
          body.style.setProperty('background', themeColors.body.background, 'important')
        }
      }
    } catch { /* ignore */ }
  }

  function resize() {
    const r = renditionRef.value
    if (!r) return
    try {
      r.resize?.('100%', '100%')
      extractCurrentPageText().catch(() => {})
    } catch { /* ignore */ }
  }

  function observeContainer() {
    resizeObserver?.disconnect()
    const el = containerRef.value
    if (!el || typeof ResizeObserver === 'undefined') return
    resizeObserver = new ResizeObserver(() => {
      if (resizeTimer != null) clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => { resizeTimer = null; resize() }, 150)
    })
    resizeObserver.observe(el)
  }

  function installSelectionFallback(contents: any) {
    const doc = contents?.document as (Document & { __museSelectionFallback?: boolean }) | undefined
    if (!doc || doc.__museSelectionFallback) return
    doc.__museSelectionFallback = true

    const syncSelection = () => {
      // Delay matches epub.js internal selection debounce so the range is ready
      window.setTimeout(() => updateSelectionFromContents(contents), 250)
    }
    doc.addEventListener('mouseup', syncSelection)
    doc.addEventListener('touchend', syncSelection)
    doc.addEventListener('keyup', (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key.startsWith('Arrow')) syncSelection()
    })
    doc.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const win = doc.defaultView
      const sel = win?.getSelection?.()
      const hasSelection = sel && sel.toString().trim().length > 0 && sel.rangeCount > 0
      const target = e.target as HTMLElement
      const hlEl = target?.closest?.('.epub-hl, .epub-ul') as HTMLElement | null
      const highlightCfi = hlEl?.dataset?.epubcfi
      if (hasSelection) {
        updateSelectionFromContents(contents)
      } else {
        selection.value = null
      }
      _justContextMenu = true
      window.setTimeout(() => { _justContextMenu = false }, 120)
      // e.clientX/Y are in the iframe's coordinate space; add the iframe's
      // viewport offset so the menu appears at the correct main-window position.
      const frameRect = (win?.frameElement as HTMLElement | null)?.getBoundingClientRect?.()
      contextMenu.value = {
        visible: true,
        x: e.clientX + (frameRect?.left ?? 0),
        y: e.clientY + (frameRect?.top ?? 0),
        highlightCfi,
      }
    })

  }

  function updateSelectionFromContents(contents: unknown, providedCfiRange?: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = contents as any
    const win = c?.window ?? c?.document?.defaultView
    const sel = win?.getSelection?.()
    const text = sel?.toString?.() ?? ''
    if (!text.trim() || sel?.rangeCount === 0) return

    const range = sel.getRangeAt(0)
    const rect = range?.getBoundingClientRect?.()
    const containerRect = containerRef.value?.getBoundingClientRect()
    if (!rect || !containerRect) return

    let cfiRange = providedCfiRange
    if (!cfiRange) {
      try {
        cfiRange = c?.cfiFromRange?.(range)
          ?? c?.section?.cfiFromRange?.(range)
          ?? (c?.section?.cfiBase ? c?.epubcfi?.generateRangeComponent?.(range, c.section.cfiBase) : undefined)
      } catch { /* ignore */ }
    }
    if (!cfiRange) return

    const frameRect = c?.document?.defaultView?.frameElement?.getBoundingClientRect?.()
    const offsetTop = frameRect ? frameRect.top - containerRect.top : 0
    const offsetLeft = frameRect ? frameRect.left - containerRect.left : 0
    selection.value = {
      cfiRange,
      text: text.trim(),
      rect: {
        top:   offsetTop + rect.top + rect.height + 10,
        left:  Math.min(
          Math.max(offsetLeft + rect.left + rect.width / 2, 160),
          Math.max(containerRect.width - 160, 160),
        ),
        width: rect.width,
      },
    }
  }

  // ─── Annotations ─────────────────────────────────────────────────────────────

  const COLOR_MAP: Record<string, string> = {
    yellow: 'rgba(255, 214, 0, 0.4)',
    green:  'rgba(52, 199, 89, 0.35)',
    blue:   'rgba(0, 122, 255, 0.3)',
    pink:   'rgba(255, 45, 85, 0.3)',
    orange: 'rgba(255, 149, 0, 0.4)',
    purple: 'rgba(175, 82, 222, 0.35)',
  }

  function addHighlight(cfi: string, color: string) {
    const r = renditionRef.value
    if (!r) return
    r.annotations.add('highlight', cfi, {}, () => {
      clickedAnnotationCfi.value = cfi
    }, 'epub-hl', {
      fill: COLOR_MAP[color] ?? COLOR_MAP.yellow,
    })
  }

  function addUnderline(cfi: string, color: string) {
    const r = renditionRef.value
    if (!r) return
    r.annotations.add('underline', cfi, {}, () => {
      clickedAnnotationCfi.value = cfi
    }, 'epub-ul', {
      stroke: COLOR_MAP[color] ?? COLOR_MAP.yellow,
      'stroke-width': 2,
      'stroke-opacity': 0.95,
    })
  }

  function removeHighlight(cfi: string) {
    const r = renditionRef.value
    if (!r) return
    r.annotations.remove(cfi, 'highlight')
    r.annotations.remove(cfi, 'underline')
  }

  function restoreAnnotations(anns: BookAnnotation[]) {
    const r = renditionRef.value
    if (!r) return
    for (const a of anns) {
      if (a.type === 'underline') {
        addUnderline(a.cfi, a.color)
      } else if (a.type === 'highlight' || a.type === 'note') {
        addHighlight(a.cfi, a.color)
      }
    }
  }

  // ─── TTS text highlighting ───────────────────────────────────────────────────

  /** Highlight a text segment in the current rendered content. Returns an ID for removal.
   *  If the highlighted text is off the current page, navigates to it automatically. */
  async function highlightTextSegment(text: string): Promise<string | null> {
    const r = renditionRef.value
    if (!r) return null
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents: any[] = r.getContents?.() ?? []
      for (const c of contents) {
        const doc = c?.document as Document | undefined
        const win = doc?.defaultView as Window | undefined
        if (!doc?.body || !win) continue
        const normalized = text.replace(/\s+/g, ' ').trim()
        if (!normalized) continue
        win.getSelection()?.removeAllRanges()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const found = (win as any).find(normalized, false, false, false, false, false, false)
        if (!found) continue
        const sel = win.getSelection()
        if (!sel || sel.rangeCount === 0) continue
        const range = sel.getRangeAt(0)

        // Capture CFI before modifying DOM (some epubjs versions compute lazily)
        let cfi: string | null = null
        try {
          cfi = c?.cfiFromRange?.(range) ?? c?.section?.cfiFromRange?.(range) ?? null
        } catch { /* ignore */ }

        // Wrap the range in a highlight span
        const span = doc.createElement('span')
        span.className = 'muse-tts-chunk-highlight'
        const id = `tts-hl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        span.id = id
        try {
          range.surroundContents(span)
        } catch {
          const fragment = range.extractContents()
          span.appendChild(fragment)
          range.insertNode(span)
        }
        win.getSelection()?.removeAllRanges()

        // Navigate to make the highlighted text visible if it's off-screen.
        // In paginated mode: use CFI so epubjs switches to the correct page.
        // In scroll mode: scrollIntoView is enough.
        const spanEl = doc.getElementById(id)
        if (spanEl) {
          const rect = spanEl.getBoundingClientRect()
          const vw = win.innerWidth  || doc.documentElement.clientWidth
          const vh = win.innerHeight || doc.documentElement.clientHeight
          const isVisible =
            rect.width > 0 && rect.height > 0 &&
            rect.top < vh && rect.bottom > 0 &&
            rect.left < vw && rect.right > 0
          if (!isVisible) {
            if (cfi && !_currentSettings?.scrollMode) {
              try { await r.display(cfi) } catch { /* ignore */ }
            } else {
              spanEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          }
        }

        return id
      }
    } catch { /* ignore */ }
    return null
  }

  /** Remove a TTS highlight by its ID. */
  function removeTextHighlight(id: string | null) {
    if (!id) return
    const r = renditionRef.value
    if (!r) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents: any[] = r.getContents?.() ?? []
      for (const c of contents) {
        const doc = c?.document as Document | undefined
        if (!doc) continue
        const span = doc.getElementById(id)
        if (span && span.parentNode) {
          // Unwrap: move children to parent, remove span
          const parent = span.parentNode
          while (span.firstChild) {
            parent.insertBefore(span.firstChild, span)
          }
          parent.removeChild(span)
          // Normalize to merge adjacent text nodes
          parent.normalize()
        }
      }
    } catch { /* ignore */ }
  }

  // Re-apply annotations whenever a new section is rendered
  function hookAnnotations(anns: () => BookAnnotation[]) {
    const book = bookRef.value
    if (!book) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    book.rendition?.hooks?.content?.register?.((contents: any) => {
      const rendered = anns()
      for (const a of rendered) {
        if (a.type !== 'highlight') continue
        try {
          contents.addStylesheetRules({
            '.epub-hl': { 'mix-blend-mode': 'multiply' },
          })
        } catch { /* ignore */ }
        break
      }
    })
  }

  // ─── Chapter text extraction (for AI copilot) ────────────────────────────────

  async function extractCurrentChapterText(): Promise<string> {
    const r = renditionRef.value
    if (!r) return ''
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents: any[] = r.getContents?.() ?? []
      if (!contents.length) return ''
      const doc = contents[0]?.document
      const text = doc?.body?.innerText ?? doc?.body?.textContent ?? ''
      currentChapterText.value = text.slice(0, 8000)
      return currentChapterText.value
    } catch { return '' }
  }

  async function extractCurrentPageText(): Promise<string> {
    const r = renditionRef.value
    if (!r) return ''
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents: any[] = r.getContents?.() ?? []
      if (!contents.length) return ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = contents[0]?.document as Document | undefined
      if (!doc?.body) return ''
      const win = doc.defaultView
      const viewportW = win?.innerWidth ?? doc.documentElement.clientWidth
      const viewportH = win?.innerHeight ?? doc.documentElement.clientHeight
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
      const chunks: string[] = []
      const range = doc.createRange()
      let node = walker.nextNode()
      while (node && chunks.join('').length < 6000) {
        const text = node.textContent?.replace(/\s+/g, ' ').trim()
        if (text) {
          range.selectNodeContents(node)
          const rects = Array.from(range.getClientRects())
          const visible = rects.some(rect =>
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > 0 &&
            rect.left < viewportW &&
            rect.bottom > 0 &&
            rect.top < viewportH,
          )
          if (visible) chunks.push(text)
        }
        node = walker.nextNode()
      }
      range.detach()
      currentPageText.value = chunks.join('\n').slice(0, 6000)
      return currentPageText.value
    } catch {
      return ''
    }
  }

  // ─── Cover extraction ─────────────────────────────────────────────────────────

  async function extractCoverBase64(book: unknown): Promise<string | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = book as any
      const url: string | null = await b.coverUrl()
      if (!url) return null
      const resp = await fetch(url)
      const blob = await resp.blob()
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    } catch { return null }
  }

  // ─── TOC helpers ─────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildToc(items: any[]): TocItem[] {
    return items.map(item => ({
      label: item.label?.trim() ?? '',
      href:  item.href ?? '',
      subitems: item.subitems?.length ? buildToc(item.subitems) : undefined,
    }))
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  async function destroyBook() {
    const r = renditionRef.value
    const b = bookRef.value
    renditionRef.value = null
    bookRef.value = null
    isReady.value = false
    toc.value = []
    selection.value = null
    currentChapterText.value = ''
    currentPageText.value = ''
    resizeObserver?.disconnect()
    resizeObserver = null
    if (resizeTimer != null) { clearTimeout(resizeTimer); resizeTimer = null }
    try { r?.destroy?.() } catch { /* ignore */ }
    try { b?.destroy?.() } catch { /* ignore */ }
  }

  onUnmounted(() => { destroyBook() })

  // Re-apply theme when settings change externally
  watch(() => renditionRef.value, (r) => {
    if (r) hookAnnotations(() => [])
  })

  function hideContextMenu() {
    contextMenu.value = null
  }

  return {
    isReady, isLoading, error,
    toc, currentCfi, currentHref, currentSpineIdx, percentage, totalLocs,
    selection, contextMenu, clickedAnnotationCfi, currentChapterText, currentPageText, pageTurn,
    // Methods
    loadBook, display, next, prev, jumpTo,
    updateSettings, applyTheme, resize,
    addHighlight, addUnderline, removeHighlight, restoreAnnotations,
    highlightTextSegment, removeTextHighlight,
    extractCurrentChapterText, extractCurrentPageText,
    destroyBook, hideContextMenu,
  }
}
