import katex from 'katex'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 预处理纯文本 LaTeX 命令（如 \textit、\textbf）为占位符 */
function preprocessTextCommands(text: string): string {
  return text
    .replace(/\\textit\{([^}]*)\}/g, '__IT__S__$1__IT__E__')
    .replace(/\\textbf\{([^}]*)\}/g, '__BF__S__$1__BF__E__')
    .replace(/\\emph\{([^}]*)\}/g, '__EM__S__$1__EM__E__')
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\mathrm\{([^}]*)\}/g, '$1')
}

/** 将占位符还原为 HTML 标签 */
function restoreTextCommands(html: string): string {
  return html
    .replace(/__IT__S__/g, '<em>')
    .replace(/__IT__E__/g, '</em>')
    .replace(/__BF__S__/g, '<strong>')
    .replace(/__BF__E__/g, '</strong>')
    .replace(/__EM__S__/g, '<em>')
    .replace(/__EM__E__/g, '</em>')
}

type MathPart = { type: 'text' | 'inline' | 'display'; content: string }

/** 将文本按 LaTeX math 分割为片段 */
function splitMathParts(text: string): MathPart[] {
  const parts: MathPart[] = []
  // 匹配 $$...$$ 或 $...$
  const regex = /(\$\$[\s\S]+?\$\$|(?<!\$)\$(?!\$)[^$\n]+?\$(?!\$))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }
    const raw = match[0]
    if (raw.startsWith('$$')) {
      parts.push({ type: 'display', content: raw.slice(2, -2).trim() })
    } else {
      parts.push({ type: 'inline', content: raw.slice(1, -1).trim() })
    }
    lastIndex = match.index + raw.length
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) })
  }
  if (parts.length === 0) parts.push({ type: 'text', content: text })
  return parts
}

/** 将纯文本中的 LaTeX 渲染为 HTML */
export function renderLatexInText(text: string): string {
  text = preprocessTextCommands(text)
  const parts = splitMathParts(text)

  return parts
    .map((p) => {
      if (p.type === 'text') {
        return restoreTextCommands(escapeHtml(p.content))
      }
      try {
        return katex.renderToString(p.content, {
          displayMode: p.type === 'display',
          throwOnError: false,
          strict: false,
        })
      } catch {
        return escapeHtml(p.type === 'display' ? `$$${p.content}$$` : `$${p.content}$`)
      }
    })
    .join('')
}

/** 移除 LaTeX，返回干净纯文本 */
export function stripLatex(text: string): string {
  return (
    text
      // display math
      .replace(/\$\$[\s\S]*?\$\$/g, ' ')
      // inline math（要求内部至少含一个字母或反斜杠，避免误删美元金额）
      .replace(/(?<!\$)\$(?!\$)[^$\n]*?[a-zA-Z\\][^$\n]*?\$(?!\$)/g, ' ')
      // 文本命令
      .replace(/\\textit\{([^}]*)\}/g, '$1')
      .replace(/\\textbf\{([^}]*)\}/g, '$1')
      .replace(/\\emph\{([^}]*)\}/g, '$1')
      .replace(/\\text\{([^}]*)\}/g, '$1')
      .replace(/\\mathrm\{([^}]*)\}/g, '$1')
      // fallback: 其他 \command{...}
      .replace(/\\[a-zA-Z]+\*?\{([^}]*)\}/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * 在 Markdown 中支持 LaTeX。
 * 需要在调用前自行 import 'katex/dist/katex.min.css'
 */
export function renderMarkdownWithLatex(
  content: string,
  marked: { parse: (text: string) => string | Promise<string> },
  DOMPurify: { sanitize: (html: string, opts?: Record<string, unknown>) => string },
): string {
  // 1. 保护代码块
  const codeBlocks: string[] = []
  content = content.replace(/```[\s\S]*?```/g, (match) => {
    const idx = codeBlocks.length
    codeBlocks.push(match)
    return `<!--CODE_BLOCK_${idx}-->`
  })

  // 2. 保护行内代码
  const inlineCodes: string[] = []
  content = content.replace(/`[^`]+`/g, (match) => {
    const idx = inlineCodes.length
    inlineCodes.push(match)
    return `<!--INLINE_CODE_${idx}-->`
  })

  // 3. 保护 display math
  const displayMaths: string[] = []
  content = content.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    const idx = displayMaths.length
    displayMaths.push(tex.trim())
    return `<!--DISPLAY_MATH_${idx}-->`
  })

  // 4. 保护 inline math
  const inlineMaths: string[] = []
  content = content.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_, tex) => {
    const idx = inlineMaths.length
    inlineMaths.push(tex.trim())
    return `<!--INLINE_MATH_${idx}-->`
  })

  // 5. 解析 markdown
  let html = marked.parse(content) as string

  // 6. 还原 math
  html = html.replace(/<!--DISPLAY_MATH_(\d+)-->/g, (_, idx) => {
    try {
      return katex.renderToString(displayMaths[+idx], {
        displayMode: true,
        throwOnError: false,
        strict: false,
      })
    } catch {
      return escapeHtml(`$$${displayMaths[+idx]}$$`)
    }
  })
  html = html.replace(/<!--INLINE_MATH_(\d+)-->/g, (_, idx) => {
    try {
      return katex.renderToString(inlineMaths[+idx], {
        displayMode: false,
        throwOnError: false,
        strict: false,
      })
    } catch {
      return escapeHtml(`$${inlineMaths[+idx]}$`)
    }
  })

  // 7. 还原代码
  html = html.replace(/<!--CODE_BLOCK_(\d+)-->/g, (_, idx) => codeBlocks[+idx])
  html = html.replace(/<!--INLINE_CODE_(\d+)-->/g, (_, idx) => inlineCodes[+idx])

  return DOMPurify.sanitize(html, { ADD_ATTR: ['onclick', 'data-href', 'title'] })
}
