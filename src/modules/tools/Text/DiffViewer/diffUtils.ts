export type DiffType = 'equal' | 'insert' | 'delete';

export interface DiffLine {
  type: DiffType;
  value: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface SplitRow {
  type: 'equal' | 'modified' | 'delete' | 'insert';
  oldValue?: string;
  newValue?: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

function lcsMatrix(a: string[], b: string[]): number[][] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

export function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText ? newText.split('\n') : [];

  const dp = lcsMatrix(oldLines, newLines);
  const raw: { type: DiffType; value: string }[] = [];
  let i = oldLines.length, j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      raw.unshift({ type: 'equal', value: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.unshift({ type: 'insert', value: newLines[j - 1] });
      j--;
    } else {
      raw.unshift({ type: 'delete', value: oldLines[i - 1] });
      i--;
    }
  }

  let oldNum = 1, newNum = 1;
  return raw.map(line => {
    const dl: DiffLine = { ...line };
    if (line.type === 'equal')       { dl.oldLineNum = oldNum++; dl.newLineNum = newNum++; }
    else if (line.type === 'delete') { dl.oldLineNum = oldNum++; }
    else                             { dl.newLineNum = newNum++; }
    return dl;
  });
}

export function toSplitRows(diff: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < diff.length) {
    const line = diff[i];
    if (line.type === 'equal') {
      rows.push({ type: 'equal', oldValue: line.value, newValue: line.value, oldLineNum: line.oldLineNum, newLineNum: line.newLineNum });
      i++;
    } else if (line.type === 'delete' && i + 1 < diff.length && diff[i + 1].type === 'insert') {
      rows.push({ type: 'modified', oldValue: line.value, newValue: diff[i + 1].value, oldLineNum: line.oldLineNum, newLineNum: diff[i + 1].newLineNum });
      i += 2;
    } else if (line.type === 'delete') {
      rows.push({ type: 'delete', oldValue: line.value, oldLineNum: line.oldLineNum });
      i++;
    } else {
      rows.push({ type: 'insert', newValue: line.value, newLineNum: line.newLineNum });
      i++;
    }
  }
  return rows;
}

export function getDiffStats(diff: DiffLine[]): DiffStats {
  return {
    added:     diff.filter(l => l.type === 'insert').length,
    removed:   diff.filter(l => l.type === 'delete').length,
    unchanged: diff.filter(l => l.type === 'equal').length,
  };
}

export function diffToText(diff: DiffLine[]): string {
  return diff
    .filter(l => l.type !== 'equal')
    .map(l => (l.type === 'insert' ? '+ ' : '- ') + l.value)
    .join('\n');
}
