import { stripDirectionalMarks } from './encoding.js';

/**
 * Parse a money string into a number. Handles:
 *  - currency symbols (₪, $, €, ILS/NIS/שח/ש"ח)
 *  - thousands separators ("1,234.56" and "1.234,56")
 *  - parentheses negatives "(123.45)"
 *  - unicode minus / trailing minus "123-"
 *  - RTL/directional marks
 * Returns the numeric magnitude with its sign, or null if not a number.
 */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;

  let s = stripDirectionalMarks(String(input)).trim();
  if (s === '') return null;

  let negative = false;
  // Parentheses => negative
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Normalise unicode minus and detect leading/trailing minus
  s = s.replace(/[−–—]/g, '-');
  if (/-\s*$/.test(s)) {
    negative = true;
    s = s.replace(/-\s*$/, '');
  }
  if (/^\s*-/.test(s)) {
    negative = true;
  }

  // Strip currency symbols/letters and spaces, keep digits, separators, sign.
  s = s.replace(/[^\d.,-]/g, '');
  s = s.replace(/(?!^)-/g, ''); // keep only a leading minus
  if (s === '' || s === '-') return null;

  s = normalizeSeparators(s);
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const val = Math.abs(n);
  return negative ? -val : val;
}

/** Decide whether ',' or '.' is the decimal separator and produce a JS-parseable string. */
function normalizeSeparators(s: string): string {
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // The rightmost separator is the decimal.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // European: 1.234,56
      return s.replace(/\./g, '').replace(',', '.');
    }
    // US: 1,234.56
    return s.replace(/,/g, '');
  }
  if (hasComma) {
    // Could be decimal (12,50) or thousands (1,234). If exactly 3 digits follow
    // the last comma and there is more than one group, treat as thousands.
    const parts = s.split(',');
    const last = parts[parts.length - 1] ?? '';
    if (parts.length > 2 || (last.length === 3 && parts[0] !== '')) {
      return s.replace(/,/g, '');
    }
    return s.replace(',', '.');
  }
  return s;
}

/** Two amounts equal within tolerance (percentage OR fixed minor-unit slack). */
export function amountsMatch(
  a: number,
  b: number,
  opts: { tolerancePct: number; toleranceMinor: number },
): boolean {
  const A = Math.abs(a);
  const B = Math.abs(b);
  const diff = Math.abs(A - B);
  const pctSlack = (Math.max(A, B) * opts.tolerancePct) / 100;
  const slack = Math.max(pctSlack, opts.toleranceMinor / 100);
  return diff <= slack + 1e-9;
}
