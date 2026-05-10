export type ConversionFormat = 'latex' | 'markdown' | 'plaintext';

export function convert(
  input: string,
  from: ConversionFormat,
  to: ConversionFormat,
): string {
  if (!input.trim()) return '';
  if (from === to) return input;
  if (from === 'latex'     && to === 'plaintext')  return latexToPlainText(input);
  if (from === 'latex'     && to === 'markdown')   return latexToMarkdown(input);
  if (from === 'markdown'  && to === 'latex')      return markdownToLatex(input);
  if (from === 'markdown'  && to === 'plaintext')  return markdownToPlainText(input);
  if (from === 'plaintext' && to === 'latex')      return plainTextToLatex(input);
  if (from === 'plaintext' && to === 'markdown')   return input;
  return input;
}

// ─────────────────────── LaTeX → Plain Text ──────────────────────────────────

function latexToPlainText(src: string): string {
  let s = src;

  // Remove LaTeX line comments
  s = s.replace(/%[^\n]*/g, '');

  // Escaped special chars → actual chars
  s = s.replace(/\\%/g, '%');
  s = s.replace(/\\&/g, '&');
  s = s.replace(/\\_/g, '_');
  s = s.replace(/\\\$/g, '$');
  s = s.replace(/\\#/g, '#');
  s = s.replace(/\\{/g, '{');
  s = s.replace(/\\}/g, '}');
  s = s.replace(/\\textbackslash\{?\}?/g, '\\');

  // Typography
  s = s.replace(/---/g, '\u2014');
  s = s.replace(/--/g,  '\u2013');
  s = s.replace(/``/g,  '\u201C');
  s = s.replace(/''/g,  '\u201D');

  // Non-breaking space → regular space; double-backslash → newline
  s = s.replace(/~/g, ' ');
  s = s.replace(/\\\\/g, '\n');

  // Common text symbols
  s = s.replace(/\\ldots\b/g, '...');
  s = s.replace(/\\cdots\b/g, '...');
  s = s.replace(/\\dots\b/g,  '...');

  // Strip math delimiters, keep content
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => m.trim());
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => m.trim());
  s = s.replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, (_, m) => m.trim());
  s = s.replace(/\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g, (_, m) => m.trim());
  s = s.replace(/\$([^$\n]+)\$/g, (_, m) => m.trim());
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => m.trim());

  // Commands whose argument should be discarded entirely
  const STRIP_CMD = [
    'cite', 'citet', 'citep', 'citealt', 'citealp', 'citeauthor', 'citeyear',
    'label', 'ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref',
    'vspace', 'hspace', 'vskip', 'hskip',
    'includegraphics',
    'bibliographystyle', 'bibliography',
    'usepackage', 'documentclass', 'RequirePackage',
    'newcommand', 'renewcommand', 'providecommand', 'DeclareMathOperator',
    'setcounter', 'setlength', 'addtolength',
    'color', 'textcolor', 'colorbox',
    'hypersetup', 'href', 'url',
  ];
  for (const cmd of STRIP_CMD) {
    const escaped = cmd.replace(/\*/g, '\\*');
    s = s.replace(new RegExp(`\\\\${escaped}\\s*(\\[[^\\]]*\\])?\\s*\\{[^{}]*\\}`, 'g'), '');
  }

  // Commands whose argument text should be kept
  const KEEP_CMD = [
    'textbf', 'textit', 'textsl', 'textsc', 'textrm', 'texttt', 'textsf',
    'emph', 'underline', 'uline', 'mbox', 'hbox',
    'text', 'mathrm', 'mathbf', 'mathit', 'mathbb', 'mathcal', 'mathsf', 'mathtt',
    'operatorname',
    'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph',
    'title', 'author', 'date',
    'footnote', 'caption',
  ];
  for (const cmd of KEEP_CMD) {
    s = s.replace(new RegExp(`\\\\${cmd}\\s*\\{([^{}]*)\\}`, 'g'), '$1');
  }

  // Remove environment delimiters
  s = s.replace(/\\begin\{[^}]*\}/g, '');
  s = s.replace(/\\end\{[^}]*\}/g, '');
  s = s.replace(/\\item\b\s*/g, '');

  // Remove remaining LaTeX commands
  s = s.replace(/\\[a-zA-Z@]+\*?\s*(\[[^\]]*\])?\s*(\{[^{}]*\})?/g, '');

  // Remove leftover braces
  s = s.replace(/[{}]/g, '');

  // Normalize whitespace
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  // Single newlines within a paragraph → space (LaTeX source style)
  s = s.replace(/(?<!\n)\n(?!\n)/g, ' ');
  s = s.split('\n').map(l => l.trim()).join('\n');
  return s.trim();
}

// ─────────────────────── LaTeX → Markdown ────────────────────────────────────

function latexToMarkdown(src: string): string {
  let s = src;

  // Remove comments
  s = s.replace(/%[^\n]*/g, '');

  // Escaped special chars
  s = s.replace(/\\%/g, '%');
  s = s.replace(/\\&/g, '&');
  s = s.replace(/\\_/g, '\\_');
  s = s.replace(/\\\$/g, '\\$');
  s = s.replace(/\\#/g, '#');
  s = s.replace(/\\{/g, '{');
  s = s.replace(/\\}/g, '}');

  // Typography
  s = s.replace(/---/g, '\u2014');
  s = s.replace(/--/g,  '\u2013');
  s = s.replace(/``/g,  '"');
  s = s.replace(/''/g,  '"');
  s = s.replace(/~/g, ' ');
  s = s.replace(/\\\\/g, '\n');

  // Common symbols
  s = s.replace(/\\ldots\b/g, '...');
  s = s.replace(/\\cdots\b/g, '...');
  s = s.replace(/\\dots\b/g,  '...');

  // Display math → $$ blocks
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => `\n\n$$\n${m.trim()}\n$$\n\n`);
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => `\n\n$$\n${m.trim()}\n$$\n\n`);
  s = s.replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, (_, m) => `\n\n$$\n${m.trim()}\n$$\n\n`);
  s = s.replace(/\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g, (_, m) => `\n\n$$\n${m.trim()}\n$$\n\n`);
  // Inline math: \( ... \) → $ ... $
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');

  // Text formatting
  s = s.replace(/\\textbf\{([^{}]*)\}/g, '**$1**');
  s = s.replace(/\\textit\{([^{}]*)\}/g, '*$1*');
  s = s.replace(/\\emph\{([^{}]*)\}/g, '*$1*');
  s = s.replace(/\\texttt\{([^{}]*)\}/g, '`$1`');
  s = s.replace(/\\textsc\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\underline\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\textrm\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\textsf\{([^{}]*)\}/g, '$1');

  // Sections
  s = s.replace(/\\chapter\{([^{}]*)\}/g, '# $1');
  s = s.replace(/\\section\{([^{}]*)\}/g, '## $1');
  s = s.replace(/\\subsection\{([^{}]*)\}/g, '### $1');
  s = s.replace(/\\subsubsection\{([^{}]*)\}/g, '#### $1');
  s = s.replace(/\\paragraph\{([^{}]*)\}/g, '**$1**\n');

  // Lists
  s = s.replace(/\\begin\{itemize\}/g, '');
  s = s.replace(/\\end\{itemize\}/g, '');
  s = s.replace(/\\begin\{enumerate\}/g, '');
  s = s.replace(/\\end\{enumerate\}/g, '');
  s = s.replace(/\\item\s*/g, '- ');

  // Links
  s = s.replace(/\\href\{([^{}]*)\}\{([^{}]*)\}/g, '[$2]($1)');
  s = s.replace(/\\url\{([^{}]*)\}/g, '<$1>');

  // Footnotes
  s = s.replace(/\\footnote\{([^{}]*)\}/g, ' (note: $1)');

  // Citations → [key]
  s = s.replace(/\\cite[a-z]*\{([^{}]*)\}/g, '[$1]');

  // Remove other environments
  s = s.replace(/\\begin\{[^}]*\}/g, '');
  s = s.replace(/\\end\{[^}]*\}/g, '');

  // Keep content of remaining text-like commands
  const KEEP = ['text', 'mathrm', 'mathbf', 'mathit', 'mbox', 'hbox'];
  for (const cmd of KEEP) {
    s = s.replace(new RegExp(`\\\\${cmd}\\{([^{}]*)\\}`, 'g'), '$1');
  }

  // Remove remaining commands
  s = s.replace(/\\[a-zA-Z@]+\*?\s*/g, '');

  // Remove remaining braces
  s = s.replace(/[{}]/g, '');

  // Normalize whitespace
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.split('\n').map(l => l.trim()).join('\n');
  return s.trim();
}

// ─────────────────────── Markdown → Plain Text ───────────────────────────────

function markdownToPlainText(src: string): string {
  let s = src;

  // Fenced code blocks (remove entirely)
  s = s.replace(/```[a-z]*\n[\s\S]*?```/g, '');

  // Display math (remove)
  s = s.replace(/\$\$[\s\S]*?\$\$/g, '');

  // Inline code → content
  s = s.replace(/`([^`]+)`/g, '$1');

  // Headers → plain text
  s = s.replace(/^#{1,6}\s+(.+)$/gm, '$1');

  // Bold + italic
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
  s = s.replace(/___(.+?)___/g, '$1');
  s = s.replace(/\*\*(.+?)\*\*/g, '$1');
  s = s.replace(/__(.+?)__/g, '$1');
  s = s.replace(/\*(.+?)\*/g, '$1');
  s = s.replace(/_(.+?)_/g, '$1');

  // Strikethrough
  s = s.replace(/~~(.+?)~~/g, '$1');

  // Images (keep alt text)
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // Links → text only
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Blockquotes
  s = s.replace(/^>\s?/gm, '');

  // Lists (remove bullets/numbers)
  s = s.replace(/^[ \t]*[-*+]\s+/gm, '');
  s = s.replace(/^[ \t]*\d+\.\s+/gm, '');

  // Horizontal rules
  s = s.replace(/^[-*_]{3,}$/gm, '');

  // Normalize
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.split('\n').map(l => l.trim()).join('\n');
  return s.trim();
}

// ─────────────────────── Markdown → LaTeX ────────────────────────────────────

function markdownToLatex(src: string): string {
  let s = src;

  // Display math $$ ... $$ → \[ ... \]
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => `\\[\n${m.trim()}\n\\]`);

  // Fenced code blocks → verbatim
  s = s.replace(/```[a-z]*\n([\s\S]*?)```/g, (_, m) => `\\begin{verbatim}\n${m}\\end{verbatim}`);

  // Headers
  s = s.replace(/^######\s+(.+)$/gm, '\\subparagraph{$1}');
  s = s.replace(/^#####\s+(.+)$/gm, '\\paragraph{$1}');
  s = s.replace(/^####\s+(.+)$/gm,  '\\subsubsection{$1}');
  s = s.replace(/^###\s+(.+)$/gm,   '\\subsection{$1}');
  s = s.replace(/^##\s+(.+)$/gm,    '\\section{$1}');
  s = s.replace(/^#\s+(.+)$/gm,     '\\chapter{$1}');

  // Bold + italic (order matters)
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '\\textbf{\\textit{$1}}');
  s = s.replace(/___(.+?)___/g, '\\textbf{\\textit{$1}}');
  s = s.replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}');
  s = s.replace(/__(.+?)__/g, '\\textbf{$1}');
  s = s.replace(/\*(.+?)\*/g, '\\textit{$1}');
  s = s.replace(/_(.+?)_/g, '\\textit{$1}');

  // Strikethrough
  s = s.replace(/~~(.+?)~~/g, '\\sout{$1}');

  // Inline code
  s = s.replace(/`([^`]+)`/g, '\\texttt{$1}');

  // Images
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
    '\\begin{figure}[h]\n\\centering\n\\includegraphics{$2}\n\\caption{$1}\n\\end{figure}');

  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '\\href{$2}{$1}');

  // Blockquotes
  s = s.replace(/^((?:>\s?.+\n?)+)/gm, (block) => {
    const content = block.replace(/^>\s?/gm, '').trim();
    return `\\begin{quote}\n${content}\n\\end{quote}`;
  });

  // Horizontal rules
  s = s.replace(/^[-*_]{3,}$/gm, '\\hrulefill');

  // Unordered lists
  s = s.replace(/((?:^[ \t]*[-*+]\s+.+\n?)+)/gm, (block) => {
    const items = block.replace(/^[ \t]*[-*+]\s+/gm, '\\item ').trimEnd();
    return `\\begin{itemize}\n${items}\n\\end{itemize}`;
  });

  // Ordered lists
  s = s.replace(/((?:^[ \t]*\d+\.\s+.+\n?)+)/gm, (block) => {
    const items = block.replace(/^[ \t]*\d+\.\s+/gm, '\\item ').trimEnd();
    return `\\begin{enumerate}\n${items}\n\\end{enumerate}`;
  });

  // Normalize
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// ─────────────────────── Plain Text → LaTeX ──────────────────────────────────

function plainTextToLatex(src: string): string {
  let s = src;

  // Escape LaTeX special characters (order matters: backslash first)
  s = s.replace(/\\/g, '\\textbackslash{}');
  s = s.replace(/&/g,  '\\&');
  s = s.replace(/%/g,  '\\%');
  s = s.replace(/\$/g, '\\$');
  s = s.replace(/#/g,  '\\#');
  s = s.replace(/_/g,  '\\_');
  s = s.replace(/\{/g, '\\{');
  s = s.replace(/\}/g, '\\}');
  s = s.replace(/~/g,  '\\textasciitilde{}');
  s = s.replace(/\^/g, '\\textasciicircum{}');

  // Normalize paragraph breaks
  s = s.replace(/\n\n+/g, '\n\n');
  return s.trim();
}
