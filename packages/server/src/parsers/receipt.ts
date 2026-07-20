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
  const amount = extractTotal(lines);
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

function extractTotal(lines: string[]): number | null {
  const candidates: number[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (TOTAL_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))) {
      const nums = extractNumbers(line);
      for (const n of nums) candidates.push(n);
    }
  }
  if (candidates.length > 0) return Math.max(...candidates);

  // Fallback: the largest money-looking number anywhere.
  const all: number[] = [];
  for (const line of lines) all.push(...extractNumbers(line));
  return all.length ? Math.max(...all) : null;
}

function extractNumbers(line: string): number[] {
  const matches = line.match(/-?[\d.,]+/g) ?? [];
  const out: number[] = [];
  for (const m of matches) {
    if (!/\d/.test(m)) continue;
    const n = parseAmount(m);
    if (n !== null && Math.abs(n) >= 1) out.push(Math.abs(n));
  }
  return out;
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
