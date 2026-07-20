import { stripDirectionalMarks } from './encoding.js';

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'auto';

/**
 * Parse a date cell into ISO yyyy-mm-dd. Handles DD/MM/YYYY, DD.MM.YYYY,
 * DD-MM-YYYY, ISO, 2-digit years, and Excel serial date numbers.
 */
export function parseDate(input: string | number | null | undefined, fmt: DateFormat = 'auto'): string | null {
  if (input === null || input === undefined) return null;

  // Excel serial number (days since 1899-12-30).
  if (typeof input === 'number' || /^\d{5}(\.\d+)?$/.test(String(input).trim())) {
    const serial = Number(input);
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
      const ms = Math.round((serial - 25569) * 86400 * 1000);
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }

  const s = stripDirectionalMarks(String(input)).trim();
  if (s === '') return null;

  // ISO already
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(m[1]!, m[2]!, m[3]!);

  // D/M/Y style with separators / . -
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    const year = normalizeYear(m[3]!);
    if (fmt === 'MM/DD/YYYY') return iso(String(year), String(a), String(b));
    if (fmt === 'DD/MM/YYYY') return iso(String(year), String(b), String(a));
    // auto: prefer DD/MM (Israeli default) unless impossible.
    if (a > 12 && b <= 12) return iso(String(year), String(b), String(a)); // clearly DD/MM
    if (b > 12 && a <= 12) return iso(String(year), String(a), String(b)); // clearly MM/DD
    return iso(String(year), String(b), String(a)); // ambiguous -> DD/MM
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function normalizeYear(y: string): number {
  const n = Number(y);
  if (y.length <= 2) return n < 70 ? 2000 + n : 1900 + n;
  return n;
}

function iso(y: string, mo: string, d: string): string | null {
  const Y = Number(y);
  const M = Number(mo);
  const D = Number(d);
  if (M < 1 || M > 12 || D < 1 || D > 31) return null;
  return `${String(Y).padStart(4, '0')}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
}

/**
 * Detect the most likely date format from a sample of cells. Returns 'DD/MM/YYYY'
 * unless the samples prove MM/DD ordering (a value with first field > 12 while
 * second <= 12 across the majority).
 */
export function detectDateFormat(samples: Array<string | number | null | undefined>): DateFormat {
  let ddmm = 0;
  let mmdd = 0;
  let iso = 0;
  for (const raw of samples) {
    if (raw === null || raw === undefined) continue;
    const s = stripDirectionalMarks(String(raw)).trim();
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s)) {
      iso++;
      continue;
    }
    const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) ddmm++;
    else if (b > 12 && a <= 12) mmdd++;
  }
  if (iso > ddmm && iso > mmdd) return 'YYYY-MM-DD';
  if (mmdd > ddmm) return 'MM/DD/YYYY';
  return 'DD/MM/YYYY';
}

/** Absolute difference in days between two ISO dates. */
export function daysBetween(a: string, b: string): number {
  const da = Date.parse(a + 'T00:00:00Z');
  const db = Date.parse(b + 'T00:00:00Z');
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity;
  return Math.abs(da - db) / 86_400_000;
}
