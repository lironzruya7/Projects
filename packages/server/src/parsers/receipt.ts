import { config } from '../config.js';
import { parseAmount } from './amount.js';
import { parseDate } from './date.js';
import { stripDirectionalMarks } from './encoding.js';

export interface ExtractedReceipt {
  merchant: string | null;
  date: string | null;
  amount: number | null; // magnitude of total
  currency: string;
  invoiceNumber: string | null;
  lineItems: string[];
}

const TOTAL_KEYWORDS = [
  'סה"כ לתשלום', 'סהכ לתשלום', 'סכום לתשלום', 'לתשלום', 'סה"כ', 'סהכ', 'סך הכל', 'total due',
  'grand total', 'amount due', 'total', 'balance due',
];
const INVOICE_KEYWORDS = ['חשבונית מס', 'חשבונית', 'קבלה', 'מספר הזמנה', 'הזמנה', 'invoice', 'order', 'receipt', 'ref'];

/**
 * Best-effort extraction of receipt fields from free text (email body, or text
 * pulled from a PDF/OCR attachment). `hint` supplies a merchant guess from the
 * email sender name/subject.
 */
export function extractReceipt(rawText: string, hint?: { merchant?: string; date?: string }): ExtractedReceipt {
  const text = stripDirectionalMarks(rawText);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');

  const currency = detectCurrency(text);
  const amount = extractTotal(text, lines);
  const date = extractDate(text) ?? hint?.date ?? null;
  const invoiceNumber = extractInvoice(lines);
  const merchant = hint?.merchant ?? guessMerchant(lines);
  const lineItems = extractLineItems(lines);

  return { merchant, date, amount, currency, invoiceNumber, lineItems };
}

function detectCurrency(text: string): string {
  if (/₪|ש"?ח|שקל|\bILS\b|\bNIS\b/i.test(text)) return 'ILS';
  if (/\$|\bUSD\b|דולר/i.test(text)) return 'USD';
  if (/€|\bEUR\b|אירו|יורו/i.test(text)) return 'EUR';
  if (/£|\bGBP\b/i.test(text)) return 'GBP';
  return config.defaultCurrency;
}

// Personal receipts are essentially never below ₪0.5 or above ₪500k. Anything
// outside this range is a reference/order/phone number, not a price.
const MIN_AMOUNT = 0.5;
const MAX_AMOUNT = 500_000;

// Currency markers used to "anchor" a number as real money.
const CURRENCY_TOKEN = '₪|ש"?ח|שקל|\\bILS\\b|\\bNIS\\b|\\$|\\bUSD\\b|€|\\bEUR\\b|£|\\bGBP\\b';

/** A numeric token that both parses and falls in the plausible money range. */
function plausibleAmount(raw: string): number | null {
  const n = parseAmount(raw);
  if (n === null) return null;
  const abs = Math.abs(n);
  if (abs < MIN_AMOUNT || abs > MAX_AMOUNT) return null;
  return abs;
}

/** True if the token is written like money: has exactly two decimal places. */
function looksLikeMoney(raw: string): boolean {
  return /(?:^|[^\d])\d{1,3}(?:[.,]\d{3})*[.,]\d{2}(?!\d)/.test(raw) || /\d[.,]\d{2}(?!\d)/.test(raw);
}

/**
 * Extract the total. Two reliable signals only — no "largest number anywhere"
 * fallback (that grabbed invoice/reference numbers like 12641091 and produced
 * absurd totals):
 *   1. A number directly adjacent to a currency symbol (₪ 152.90 / 152.90 ₪).
 *   2. A properly-formatted (two-decimal) number on a "total / לתשלום" line.
 * Everything is bounded to a sane money range. If neither signal fires we return
 * null so the caller skips the row rather than inventing an amount.
 */
function extractTotal(text: string, lines: string[]): number | null {
  // 1. Currency-anchored amounts.
  const anchored: number[] = [];
  const re = new RegExp(`(?:${CURRENCY_TOKEN})\\s*(-?[\\d.,]+)|(-?[\\d.,]+)\\s*(?:${CURRENCY_TOKEN})`, 'gi');
  for (const m of text.matchAll(re)) {
    const numStr = m[1] ?? m[2];
    const v = numStr ? plausibleAmount(numStr) : null;
    if (v !== null) anchored.push(v);
  }

  // 2. Two-decimal amounts on total-keyword lines.
  const keyworded: number[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!TOTAL_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))) continue;
    for (const tok of line.match(/-?\d[\d.,]*/g) ?? []) {
      if (!looksLikeMoney(tok)) continue;
      const v = plausibleAmount(tok);
      if (v !== null) keyworded.push(v);
    }
  }

  // Prefer amounts that are BOTH on a total line and near a currency symbol;
  // otherwise the keyworded ones; otherwise any currency-anchored amount.
  const both = keyworded.filter((k) => anchored.includes(k));
  const pool = both.length ? both : keyworded.length ? keyworded : anchored;
  if (pool.length === 0) return null;
  return Math.max(...pool);
}

function extractDate(text: string): string | null {
  const m = text.match(/\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b/);
  if (m) return parseDate(m[1]);
  return null;
}

function extractInvoice(lines: string[]): string | null {
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (INVOICE_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))) {
      const m = line.match(/([A-Za-z]*\d[\d-]{2,})/);
      if (m) return m[1]!;
    }
  }
  return null;
}

function guessMerchant(lines: string[]): string | null {
  // Heuristic: first line that looks like a name (has letters, not a URL/number).
  for (const line of lines.slice(0, 6)) {
    if (/^https?:/i.test(line)) continue;
    if (/^[\d\s.,-]+$/.test(line)) continue;
    if (line.length >= 2 && line.length <= 60) return line;
  }
  return lines[0] ?? null;
}

function extractLineItems(lines: string[]): string[] {
  // Lines that contain both descriptive text and a trailing amount.
  const items: string[] = [];
  for (const line of lines) {
    if (TOTAL_KEYWORDS.some((k) => line.toLowerCase().includes(k.toLowerCase()))) continue;
    if (/[A-Za-z֐-׿].*\d[\d.,]*\s*$/.test(line) && line.length <= 80) {
      items.push(line);
    }
  }
  return items.slice(0, 30);
}
