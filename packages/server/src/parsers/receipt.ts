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

// Text just before a number that marks it as a card/account number, not money
// (e.g. PayPal "שולם מהכרטיס המסתיים ב-3235"). Such numbers must never be a total.
const CARD_CONTEXT = /כרטיס|מסתיים|אשראי|חשבון|ויזה|ישראכרט|visa|master|amex|card|ending|acct|account|\*{2,}|x{3,}|•{2,}|·{2,}/i;

function isCardContext(text: string, matchIndex: number): boolean {
  return CARD_CONTEXT.test(text.slice(Math.max(0, matchIndex - 22), matchIndex));
}

/**
 * Extract the total. Reliable signals only — no "largest number anywhere":
 *   1. A number adjacent to a currency symbol (₪ 152.90 / 152.90 ₪).
 *   2. A two-decimal number on a "total / לתשלום" line.
 * Numbers in card/account context (e.g. a funding card's last-4) are excluded,
 * and properly-formatted money (two decimals) is preferred over bare integers so
 * a card number like 3235 can't win over a real ₪39.00. Bounded to a sane range.
 */
function extractTotal(text: string, lines: string[]): number | null {
  // 1. Currency-anchored amounts, split into money-formatted vs bare integers.
  const money: number[] = [];
  const bare: number[] = [];
  const re = new RegExp(`(?:${CURRENCY_TOKEN})\\s*(-?[\\d.,]+)|(-?[\\d.,]+)\\s*(?:${CURRENCY_TOKEN})`, 'gi');
  for (const m of text.matchAll(re)) {
    const numStr = m[1] ?? m[2];
    if (!numStr) continue;
    const v = plausibleAmount(numStr);
    if (v === null) continue;
    if (!looksLikeMoney(numStr) && isCardContext(text, m.index ?? 0)) continue; // skip card numbers
    (looksLikeMoney(numStr) ? money : bare).push(v);
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

  // Prefer: on a total line AND money-formatted → keyworded → money-formatted
  // anchored → bare integers (last resort).
  const both = keyworded.filter((k) => money.includes(k));
  const pool = both.length ? both : keyworded.length ? keyworded : money.length ? money : bare;
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
