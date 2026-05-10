export type CitationFormat = 'ieee' | 'apa' | 'gb7714';

export interface BibtexEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

interface Author {
  first: string;
  last: string;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

export function parseBibtex(input: string): BibtexEntry[] {
  const entries: BibtexEntry[] = [];
  const text = input.trim();
  let i = 0;

  while (i < text.length) {
    const atIdx = text.indexOf('@', i);
    if (atIdx === -1) break;

    let j = atIdx + 1;
    while (j < text.length && /\w/.test(text[j])) j++;
    const type = text.slice(atIdx + 1, j).toLowerCase();

    while (j < text.length && /\s/.test(text[j])) j++;
    if (j >= text.length || text[j] !== '{') { i = j + 1; continue; }

    // Find the matching closing brace
    let depth = 0;
    let k = j;
    while (k < text.length) {
      if (text[k] === '{') depth++;
      else if (text[k] === '}') {
        depth--;
        if (depth === 0) { k++; break; }
      }
      k++;
    }

    const entryBody = text.slice(j + 1, k - 1);
    const commaIdx = entryBody.indexOf(',');
    const key = commaIdx !== -1 ? entryBody.slice(0, commaIdx).trim() : entryBody.trim();
    const fieldsStr = commaIdx !== -1 ? entryBody.slice(commaIdx + 1) : '';

    entries.push({ type, key, fields: parseFields(fieldsStr) });
    i = k;
  }

  return entries;
}

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;

  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    if (i >= body.length) break;
    if (!/\w/.test(body[i])) { i++; continue; }

    const nameStart = i;
    while (i < body.length && /\w/.test(body[i])) i++;
    const name = body.slice(nameStart, i).toLowerCase();

    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length || body[i] !== '=') continue;
    i++;
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;

    let value = '';
    if (body[i] === '{') {
      let depth = 0;
      const start = i;
      while (i < body.length) {
        if (body[i] === '{') depth++;
        else if (body[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
      }
      value = body.slice(start + 1, i - 1);
    } else if (body[i] === '"') {
      i++;
      const start = i;
      while (i < body.length && body[i] !== '"') i++;
      value = body.slice(start, i);
      if (i < body.length) i++;
    } else {
      const start = i;
      while (i < body.length && body[i] !== ',' && body[i] !== '\n') i++;
      value = body.slice(start, i).trim();
    }

    fields[name] = cleanLatex(value.trim());
  }

  return fields;
}

function cleanLatex(text: string): string {
  let result = text;
  // Strip nested braces repeatedly
  let prev = '';
  while (prev !== result) {
    prev = result;
    result = result.replace(/\{([^{}]*)\}/g, '$1');
  }
  return result
    .replace(/\\[a-zA-Z]+\s*/g, '')
    .replace(/--+/g, '–')
    .replace(/``|''/g, '"')
    .replace(/`|'/g, "'")
    .trim();
}

// ─── Author helpers ───────────────────────────────────────────────────────────

function parseAuthors(authorStr: string): Author[] {
  return authorStr.split(/\s+and\s+/i).map(part => {
    part = part.trim();
    const commaIdx = part.indexOf(',');
    if (commaIdx !== -1) {
      return { last: part.slice(0, commaIdx).trim(), first: part.slice(commaIdx + 1).trim() };
    }
    const words = part.split(/\s+/);
    if (words.length === 1) return { last: words[0], first: '' };
    return { last: words[words.length - 1], first: words.slice(0, -1).join(' ') };
  });
}

function getInitials(firstName: string): string {
  return firstName.split(/[\s-]+/).filter(Boolean).map(n => n[0].toUpperCase() + '.').join(' ');
}

// IEEE: "F. Last" — max 6 authors then et al.
function formatAuthorsIEEE(authorStr: string): string {
  if (!authorStr) return '';
  const authors = parseAuthors(authorStr);
  const fmt = authors.map(a => a.first ? `${getInitials(a.first)} ${a.last}` : a.last);
  if (fmt.length > 6) return fmt.slice(0, 6).join(', ') + ', et al.';
  return fmt.join(', ');
}

// APA: "Last, F., & Last, F." — max 7 authors, 6 + last with ...
function formatAuthorsAPA(authorStr: string): string {
  if (!authorStr) return '';
  const authors = parseAuthors(authorStr);
  const fmt = authors.map(a => a.first ? `${a.last}, ${getInitials(a.first)}` : a.last);
  if (fmt.length === 1) return fmt[0];
  if (fmt.length > 7) return fmt.slice(0, 6).join(', ') + ', ... ' + fmt[fmt.length - 1];
  return fmt.slice(0, -1).join(', ') + ', & ' + fmt[fmt.length - 1];
}

// GB/T 7714: "Last F" (no period after initial) — max 3 authors then 等
function formatAuthorsGB(authorStr: string): string {
  if (!authorStr) return '';
  const authors = parseAuthors(authorStr);
  const fmt = authors.map(a => {
    if (!a.first) return a.last;
    const initials = a.first.split(/[\s-]+/).filter(Boolean).map(n => n[0].toUpperCase()).join('');
    return `${a.last} ${initials}`;
  });
  if (fmt.length > 3) return fmt.slice(0, 3).join(', ') + ', 等';
  return fmt.join(', ');
}

// ─── Entry type label (GB/T 7714) ────────────────────────────────────────────

function gbTypeLabel(type: string): string {
  const map: Record<string, string> = {
    article: 'J',
    book: 'M',
    inproceedings: 'C',
    conference: 'C',
    incollection: 'M',
    techreport: 'R',
    phdthesis: 'D',
    mastersthesis: 'D',
    misc: 'EB',
    online: 'EB',
  };
  return map[type] ?? 'Z';
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatIEEE(entry: BibtexEntry, index: number): string {
  const f = entry.fields;
  const authors = formatAuthorsIEEE(f.author || '');
  const year = f.year || '';
  const title = f.title ? `"${f.title}"` : '';

  const prefix = `[${index}]`;

  switch (entry.type) {
    case 'article': {
      const parts: string[] = [];
      if (authors) parts.push(authors);
      if (title) parts.push(title);
      if (f.journal) parts.push(`<em>${f.journal}</em>`);
      const meta: string[] = [];
      if (f.volume) meta.push(`vol. ${f.volume}`);
      if (f.number) meta.push(`no. ${f.number}`);
      if (f.pages) meta.push(`pp. ${f.pages}`);
      if (year) meta.push(year);
      if (meta.length) parts.push(meta.join(', '));
      return `${prefix} ${parts.join(', ')}.`;
    }
    case 'inproceedings':
    case 'conference': {
      const parts: string[] = [];
      if (authors) parts.push(authors);
      if (title) parts.push(title);
      const venue = f.booktitle ? `in Proc. <em>${f.booktitle}</em>` : 'in Proc.';
      const loc: string[] = [venue];
      if (f.address) loc.push(f.address);
      parts.push(loc.join(', '));
      if (year) parts.push(year);
      if (f.pages) parts.push(`pp. ${f.pages}`);
      return `${prefix} ${parts.join(', ')}.`;
    }
    case 'book': {
      const parts: string[] = [];
      if (authors) parts.push(authors);
      if (f.title) parts.push(f.title);
      if (f.edition) parts.push(`${f.edition} ed.`);
      const pub: string[] = [];
      if (f.address) pub.push(f.address);
      if (f.publisher) pub.push(f.publisher);
      if (pub.length) parts.push(pub.join(': '));
      if (year) parts.push(year);
      return `${prefix} ${parts.join(', ')}.`;
    }
    default: {
      const parts: string[] = [];
      if (authors) parts.push(authors);
      if (title) parts.push(title);
      if (f.howpublished) parts.push(f.howpublished);
      if (f.url) parts.push(`[Online]. Available: ${f.url}`);
      if (year) parts.push(year);
      return `${prefix} ${parts.join(', ')}.`;
    }
  }
}

function formatAPA(entry: BibtexEntry): string {
  const f = entry.fields;
  const authors = formatAuthorsAPA(f.author || '');
  const year = f.year ? `(${f.year})` : '(n.d.)';

  switch (entry.type) {
    case 'article': {
      let ref = `${authors} ${year}. ${f.title || ''}.`;
      if (f.journal) {
        ref += ` <em>${f.journal}</em>`;
        if (f.volume) ref += `, <em>${f.volume}</em>`;
        if (f.number) ref += `(${f.number})`;
        if (f.pages) ref += `, ${f.pages}`;
        ref += '.';
      }
      if (f.doi) ref += ` https://doi.org/${f.doi}`;
      return ref;
    }
    case 'inproceedings':
    case 'conference': {
      let ref = `${authors} ${year}. ${f.title || ''}.`;
      if (f.booktitle) {
        ref += ` In ${f.editors ? f.editors + ' (Ed.),' : ''} <em>${f.booktitle}</em>`;
        if (f.pages) ref += ` (pp. ${f.pages})`;
        ref += '.';
      }
      if (f.publisher) ref += ` ${f.publisher}.`;
      return ref;
    }
    case 'book': {
      let ref = `${authors} ${year}. <em>${f.title || ''}</em>`;
      if (f.edition) ref += ` (${f.edition} ed.)`;
      ref += '.';
      if (f.publisher) ref += ` ${f.publisher}.`;
      return ref;
    }
    default: {
      let ref = `${authors} ${year}. ${f.title || ''}.`;
      if (f.url) ref += ` Retrieved from ${f.url}`;
      return ref;
    }
  }
}

function formatGB7714(entry: BibtexEntry): string {
  const f = entry.fields;
  const authors = formatAuthorsGB(f.author || '');
  const year = f.year || '';
  const label = gbTypeLabel(entry.type);

  switch (entry.type) {
    case 'article': {
      let ref = authors ? `${authors}. ` : '';
      ref += f.title ? `${f.title}[${label}]. ` : '';
      if (f.journal) {
        ref += f.journal;
        if (year) ref += `, ${year}`;
        if (f.volume) ref += `, ${f.volume}`;
        if (f.number) ref += `(${f.number})`;
        if (f.pages) ref += `: ${f.pages}`;
      }
      ref += '.';
      return ref;
    }
    case 'inproceedings':
    case 'conference': {
      let ref = authors ? `${authors}. ` : '';
      ref += f.title ? `${f.title}[${label}]` : '';
      if (f.booktitle) ref += `//${f.booktitle}`;
      ref += '.';
      const pub: string[] = [];
      if (f.address) pub.push(f.address);
      if (f.publisher) pub.push(f.publisher);
      if (pub.length) ref += ` ${pub.join(': ')},`;
      if (year) ref += ` ${year}`;
      if (f.pages) ref += `: ${f.pages}`;
      ref += '.';
      return ref;
    }
    case 'book': {
      let ref = authors ? `${authors}. ` : '';
      ref += f.title ? `${f.title}[${label}]. ` : '';
      if (f.edition) ref += `${f.edition}版. `;
      const pub: string[] = [];
      if (f.address) pub.push(f.address);
      if (f.publisher) pub.push(f.publisher);
      if (pub.length) ref += `${pub.join(': ')}, `;
      if (year) ref += `${year}.`;
      return ref;
    }
    default: {
      let ref = authors ? `${authors}. ` : '';
      ref += f.title ? `${f.title}[${label}/OL]. ` : '';
      if (f.url) ref += f.url;
      if (year) ref += `, ${year}`;
      ref += '.';
      return ref;
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function formatBibtex(input: string, format: CitationFormat): string {
  const entries = parseBibtex(input);
  if (entries.length === 0) return '';

  return entries.map((entry, idx) => {
    switch (format) {
      case 'ieee':   return formatIEEE(entry, idx + 1);
      case 'apa':    return formatAPA(entry);
      case 'gb7714': return formatGB7714(entry);
    }
  }).join('\n\n');
}
