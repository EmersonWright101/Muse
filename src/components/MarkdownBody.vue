<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { marked, type Tokens } from 'marked'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import java from 'highlight.js/lib/languages/java'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'
import csharp from 'highlight.js/lib/languages/csharp'
import bash from 'highlight.js/lib/languages/bash'
import shell from 'highlight.js/lib/languages/shell'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import markdown from 'highlight.js/lib/languages/markdown'
import yaml from 'highlight.js/lib/languages/yaml'
import plaintext from 'highlight.js/lib/languages/plaintext'
import kotlin from 'highlight.js/lib/languages/kotlin'
import swift from 'highlight.js/lib/languages/swift'
import ruby from 'highlight.js/lib/languages/ruby'
import php from 'highlight.js/lib/languages/php'
import r from 'highlight.js/lib/languages/r'
import DOMPurify from 'dompurify'
import katex from 'katex'
import MermaidBlock from '../modules/chat/components/MermaidBlock.vue'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Register languages, guarding against re-registration on module reload
function reg(name: string, lang: Parameters<typeof hljs.registerLanguage>[1]) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, lang)
}
reg('javascript', javascript); reg('js', javascript)
reg('typescript', typescript); reg('ts', typescript)
reg('python', python);         reg('py', python)
reg('java', java);             reg('go', go);    reg('rust', rust)
reg('cpp', cpp);               reg('c++', cpp);  reg('c', c)
reg('csharp', csharp);         reg('cs', csharp)
reg('bash', bash);             reg('sh', bash);  reg('shell', shell)
reg('json', json);             reg('xml', xml);  reg('html', xml)
reg('css', css);               reg('sql', sql)
reg('markdown', markdown);     reg('md', markdown)
reg('yaml', yaml);             reg('yml', yaml)
reg('plaintext', plaintext)
reg('kotlin', kotlin);         reg('swift', swift)
reg('ruby', ruby);             reg('rb', ruby)
reg('php', php);               reg('r', r)

const props = defineProps<{ content: string; streaming?: boolean }>()

// ─── Renderer ─────────────────────────────────────────────────────────────────

const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const renderer = new marked.Renderer()

renderer.code = ({ text, lang }: Tokens.Code) => {
  if (lang === 'svg') {
    const clean = DOMPurify.sanitize(text, { USE_PROFILES: { svg: true, svgFilters: true } })
    const hl = hljs.highlight(text, { language: 'xml' }).value
    return `<div class="code-block svg-code-block"><div class="code-header"><span class="code-lang">svg</span><button class="svg-toggle-btn" onclick="(function(b){var p=b.closest('.svg-code-block'),pre=p.querySelector('.svg-source-pre');var hidden=pre.style.display==='none';pre.style.display=hidden?'block':'none';b.textContent=hidden?'隐藏代码':'查看代码'})(this)">查看代码</button><button class="copy-btn" onclick="this.closest('.code-block').querySelector('code').dispatchEvent(new CustomEvent('copy-code',{bubbles:true}));this.textContent='已复制';setTimeout(()=>this.textContent='复制',2000)">复制</button></div><div class="svg-preview-area">${clean}</div><pre class="svg-source-pre" style="display:none"><code class="hljs xml">${hl}</code></pre></div>`
  }
  const validLang = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
  const hl = hljs.highlight(text, { language: validLang }).value
  return `<div class="code-block"><div class="code-header"><span class="code-lang">${validLang}</span><button class="copy-btn" onclick="this.closest('.code-block').querySelector('code').dispatchEvent(new CustomEvent('copy-code',{bubbles:true}));this.textContent='已复制';setTimeout(()=>this.textContent='复制',2000)">复制</button></div><pre><code class="hljs ${validLang}">${hl}</code></pre></div>`
}

renderer.codespan = ({ text }: Tokens.Codespan) => `<code class="inline-code">${text}</code>`

renderer.image = ({ href, text }: Tokens.Image) =>
  `<span class="markdown-img-wrap"><img src="${esc(href)}" alt="${esc(text)}" class="markdown-img" /><button class="markdown-copy-btn" data-action="copy-image" data-src="${esc(href)}" title="复制图片">${COPY_SVG}</button></span>`

renderer.link = ({ href, title, text }: Tokens.Link) => {
  const t = title ? ` title="${esc(title)}"` : ''
  return `<a data-action="open-url" data-href="${esc(href)}"${t} class="markdown-link">${text}</a>`
}

function renderMarkdown(md: string): string {
  try {
    // 1. Protect code blocks so their $ signs aren't treated as math
    const codeBlocks: string[] = []
    let protectedMd = md.replace(/```[\s\S]*?```/g, (match) => {
      const idx = codeBlocks.length
      codeBlocks.push(match)
      return `<!--CODE_BLOCK_${idx}-->`
    })

    // 2. Protect inline code
    const inlineCodes: string[] = []
    protectedMd = protectedMd.replace(/`[^`]+`/g, (match) => {
      const idx = inlineCodes.length
      inlineCodes.push(match)
      return `<!--INLINE_CODE_${idx}-->`
    })

    // 3. Protect display math
    const displayMaths: string[] = []
    protectedMd = protectedMd.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
      const idx = displayMaths.length
      displayMaths.push(tex.trim())
      return `<!--DISPLAY_MATH_${idx}-->`
    })

    // 4. Protect inline math (manual scan to avoid lookbehind for old WebKit)
    const inlineMaths: string[] = []
    let mi = 0
    while (mi < protectedMd.length) {
      const start = protectedMd.indexOf('$', mi)
      if (start === -1) break
      // Skip if part of a display-math placeholder or consecutive $$
      if (protectedMd[start + 1] === '$') { mi = start + 2; continue }
      const end = protectedMd.indexOf('$', start + 1)
      if (end === -1) break
      if (protectedMd[end + 1] === '$') { mi = end + 2; continue }
      const tex = protectedMd.slice(start + 1, end).trim()
      inlineMaths.push(tex)
      protectedMd = protectedMd.slice(0, start) + `<!--INLINE_MATH_${inlineMaths.length - 1}-->` + protectedMd.slice(end + 1)
      mi = start + `<!--INLINE_MATH_${inlineMaths.length - 1}-->`.length
    }

    // 5. Parse markdown
    let html = marked.parse(protectedMd, { renderer, breaks: true }) as string

    // 6. Restore display math with KaTeX
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

    // 7. Restore inline math with KaTeX
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

    // 8. Restore code blocks (re-parse so renderer.code runs)
    html = html.replace(/<!--CODE_BLOCK_(\d+)-->/g, (_, idx) => {
      return marked.parse(codeBlocks[+idx], { renderer, breaks: true }) as string
    })

    // 9. Restore inline code
    html = html.replace(/<!--INLINE_CODE_(\d+)-->/g, (_, idx) => {
      return renderer.codespan({ text: inlineCodes[+idx].slice(1, -1) } as Tokens.Codespan)
    })

    return DOMPurify.sanitize(html, { ADD_ATTR: ['onclick', 'data-action', 'data-src', 'data-href', 'title'] })
  } catch {
    return md
  }
}

// ─── Content segments (splits out mermaid blocks) ────────────────────────────

type Seg = { type: 'md'; html: string } | { type: 'mermaid'; src: string }

const contentSegments = computed<Seg[]>(() => {
  const raw = props.content
  if (!raw) return [{ type: 'md', html: '' }]
  const segs: Seg[] = []
  const re = /```mermaid[^\n]*\n([\s\S]*?)```/g
  let last = 0
  for (const m of raw.matchAll(re)) {
    if (m.index! > last) segs.push({ type: 'md', html: renderMarkdown(raw.slice(last, m.index!)) })
    segs.push({ type: 'mermaid', src: m[1].trim() })
    last = m.index! + m[0].length
  }
  if (last < raw.length) segs.push({ type: 'md', html: renderMarkdown(raw.slice(last)) })
  return segs.length ? segs : [{ type: 'md', html: renderMarkdown(raw) }]
})

// ─── Event handling ───────────────────────────────────────────────────────────

const bodyEl = ref<HTMLElement>()

function onBodyClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const btn = target.closest('[data-action]') as HTMLElement | null
  if (!btn) return
  if (btn.dataset.action === 'open-url' && btn.dataset.href) {
    import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(btn.dataset.href!)).catch(() => {})
  } else if (btn.dataset.action === 'copy-image' && btn.dataset.src) {
    copyImage(btn.dataset.src)
  }
}

async function copyImage(src: string) {
  try {
    const resp = await fetch(src)
    const blob = await resp.blob()
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
  } catch { /* ignore */ }
}

onMounted(() => {
  bodyEl.value?.addEventListener('copy-code', (e: Event) => {
    const code = (e.target as HTMLElement).textContent ?? ''
    navigator.clipboard.writeText(code).catch(() => {})
  })
})
</script>

<template>
  <div ref="bodyEl" class="markdown-body" @click="onBodyClick">
    <template v-for="(seg, i) in contentSegments" :key="i">
      <div v-if="seg.type === 'md'" v-html="seg.html" />
      <MermaidBlock v-else :src="seg.src" :streaming="streaming" />
    </template>
  </div>
</template>

<!-- Not scoped: styles apply to v-html injected content -->
<style>
.markdown-body { white-space: normal; }
.markdown-body p { margin: 0 0 10px; }
.markdown-body p:last-child { margin-bottom: 0; }
.markdown-body ul, .markdown-body ol { padding-left: 1.4em; margin: 6px 0; }
.markdown-body li { margin: 3px 0; }
.markdown-body li > p { margin: 0; }
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 { margin: 14px 0 6px; font-weight: 600; line-height: 1.3; }
.markdown-body h1 { font-size: 1.25em; }
.markdown-body h2 { font-size: 1.1em; }
.markdown-body h3 { font-size: 1em; }
.markdown-body blockquote { margin: 8px 0; padding: 6px 12px; border-left: 3px solid rgba(34,63,121,0.3); color: #6e6e73; font-style: italic; }
.markdown-body table { border-collapse: collapse; margin: 10px 0; font-size: 13px; }
.markdown-body th, .markdown-body td { border: 1px solid rgba(0,0,0,0.12); padding: 6px 10px; }
.markdown-body th { background: rgba(0,0,0,0.03); font-weight: 600; }
.markdown-body a, .markdown-body .markdown-link { color: #223F79; text-decoration: underline; cursor: pointer; }
.markdown-body hr { border: none; border-top: 1px solid rgba(0,0,0,0.10); margin: 12px 0; }
.markdown-body img { max-width: 100%; height: auto; border-radius: 12px; display: block; }

.markdown-img-wrap { position: relative; display: inline-block; vertical-align: bottom; width: min(480px, 100%); }
.markdown-img-wrap:hover .markdown-copy-btn { opacity: 1; }
.markdown-copy-btn {
  position: absolute; bottom: 8px; right: 8px; opacity: 0;
  width: 30px; height: 30px; border-radius: 8px; border: none;
  background: rgba(0,0,0,0.55); color: white; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: opacity 0.15s, background 0.12s;
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
}
.markdown-copy-btn:hover { background: rgba(0,0,0,0.75); }

.inline-code {
  background: rgba(0,0,0,0.06); border-radius: 4px;
  padding: 1px 5px; font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 0.88em; color: #c7254e;
}

.code-block { margin: 10px 0; border-radius: 10px; overflow: hidden; border: 1px solid rgba(0,0,0,0.10); background: #1e1e2e; }
.code-header { display: flex; align-items: center; justify-content: space-between; padding: 7px 12px; background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.06); }
.code-lang { font-size: 11px; color: rgba(255,255,255,0.5); font-family: 'SF Mono', 'Menlo', monospace; text-transform: lowercase; }
.copy-btn { font-size: 11px; color: rgba(255,255,255,0.4); background: none; border: none; cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: background 0.12s, color 0.12s; }
.copy-btn:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.8); }
.code-block pre { margin: 0; padding: 14px 16px; overflow-x: auto; font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace; font-size: 13px; line-height: 1.55; }
.code-block code { display: block; font-family: inherit; }

.svg-code-block { background: #fff; border-color: rgba(0,0,0,0.12); }
.svg-code-block .code-header { background: #f5f5f7; border-bottom-color: rgba(0,0,0,0.08); }
.svg-code-block .code-lang { color: #8e8e93; }
.svg-toggle-btn { font-size: 11px; color: #8e8e93; background: none; border: none; cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: background 0.12s, color 0.12s; margin-right: 6px; }
.svg-toggle-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }
.svg-code-block .copy-btn { color: #8e8e93; }
.svg-code-block .copy-btn:hover { background: rgba(0,0,0,0.06); color: #3c3c43; }
.svg-preview-area { display: flex; justify-content: center; align-items: center; padding: 16px; background: #fff; min-height: 60px; position: relative; }
.svg-preview-area svg { max-width: 100%; height: auto; max-height: 480px; }
.svg-source-pre { background: #1e1e2e; }

/* highlight.js — atom-one-dark */
.hljs { color: #abb2bf; background: transparent; }
.hljs-comment, .hljs-quote { color: #5c6370; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-subst { color: #c678dd; }
.hljs-number, .hljs-literal, .hljs-variable, .hljs-template-variable { color: #d19a66; }
.hljs-string, .hljs-doctag { color: #98c379; }
.hljs-title, .hljs-section, .hljs-selector-id { color: #61aeee; font-weight: bold; }
.hljs-type, .hljs-class .hljs-title { color: #e6c07b; }
.hljs-tag, .hljs-name, .hljs-attribute { color: #e06c75; }
.hljs-regexp, .hljs-link { color: #98c379; }
.hljs-symbol, .hljs-bullet { color: #61aeee; }
.hljs-built_in, .hljs-builtin-name { color: #e06c75; }
.hljs-meta { color: #999; font-weight: bold; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }
</style>
