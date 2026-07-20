import { stripDirectionalMarks } from '../parsers/encoding.js';

// POS / export junk tokens (HE + EN) to strip from merchant names.
const JUNK_PATTERNS: RegExp[] = [
  /\bPOS\b/gi,
  /\bVISA\b/gi,
  /\bMASTERCARD\b/gi,
  /\bMASTER\b/gi,
  /\bTLV\b/gi,
  /\bIL\b/gi,
  /\bISR\b/gi,
  /\bBIT\b/gi,
  /\bPAYBOX\b/gi,
  /\bתשלום\b/g,
  /\bעסקה\b/g,
  /\bחיוב\b/g,
  /\bכרטיס\b/g,
  /\bסניף\b/g, // "branch"
  /\bבע"?מ\b/g, // Ltd.
  /\bבעמ\b/g,
];

// City / branch suffixes commonly appended to Israeli merchant strings.
const CITY_SUFFIXES = [
  'תל אביב', 'תל-אביב', 'ירושלים', 'חיפה', 'באר שבע', 'ראשון לציון', 'פתח תקווה',
  'נתניה', 'הרצליה', 'רמת גן', 'רעננה', 'אשדוד', 'אשקלון', 'כפר סבא', 'חולון',
  'בת ים', 'מודיעין', 'רחובות', 'בני ברק', 'גבעתיים', 'קרית', 'עפולה',
];

/**
 * Normalize a raw merchant string into a canonical form for grouping & matching.
 * Strips store numbers, branch/city suffixes, POS junk, punctuation and casing.
 */
export function normalizeMerchant(raw: string): string {
  if (!raw) return '';
  let s = stripDirectionalMarks(raw);
  s = s.replace(/[֑-ׇ]/g, ''); // Hebrew niqqud
  s = s.toLowerCase();

  // Remove trailing/embedded store & reference numbers (>=3 digits, or #123).
  s = s.replace(/#\s*\d+/g, ' ');
  s = s.replace(/\b\d{3,}\b/g, ' ');
  // Remove "frl"/"sniff" style branch codes like "- 0421"
  s = s.replace(/\bfrl\b/gi, ' ');

  for (const p of JUNK_PATTERNS) s = s.replace(p, ' ');

  for (const city of CITY_SUFFIXES) {
    s = s.split(city).join(' ');
  }

  // Collapse punctuation to spaces, keep Hebrew + latin + digits.
  s = s.replace(/[^0-9a-z֐-׿ ]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Tokenize a normalized string into a de-duplicated set of tokens. */
export function tokenSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter((t) => t.length > 0));
}

/**
 * Token-set ratio similarity in [0,1]. Compares the sorted intersection against
 * each side's full token set, taking the max — robust to word order and to one
 * string carrying extra branch/POS words the other lacks.
 */
export function tokenSetRatio(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 || B.size === 0) return a === b ? 1 : 0;

  const inter = [...A].filter((t) => B.has(t));
  const interStr = inter.slice().sort().join(' ');
  const aOnly = [...A].sort().join(' ');
  const bOnly = [...B].sort().join(' ');

  const s1 = ratio(interStr, combine(interStr, diff(A, B)));
  const s2 = ratio(interStr, combine(interStr, diff(B, A)));
  const s3 = ratio(aOnly, bOnly);
  return Math.max(s1, s2, s3);
}

function diff(a: Set<string>, b: Set<string>): string {
  return [...a].filter((t) => !b.has(t)).sort().join(' ');
}
function combine(inter: string, rest: string): string {
  return (inter + ' ' + rest).trim();
}

/** Normalized Levenshtein-based ratio in [0,1] (as used by fuzzywuzzy). */
function ratio(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}
