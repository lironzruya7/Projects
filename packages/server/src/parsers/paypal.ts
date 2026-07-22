import type { ParsedTransaction } from '../models/types.js';
import { parseAmount } from './amount.js';
import { parseDate } from './date.js';
import { readGrid } from './tabular.js';

/**
 * PayPal "Activity" CSV/XLSX exports need special handling: a single purchase is
 * spread across several rows that net to zero if imported naively —
 *   1. the payment to the merchant       (negative "ברוטו", carries the name)
 *   2. a credit-card funding deposit      ("הפקדה כללית בכרטיס אשראי", positive ILS)
 *   3. for a foreign purchase, two        ("המרת מטבע כללית") currency-conversion
 *      rows that cancel out.
 * The money that actually leaves the wallet is the ILS credit-card funding
 * amount (row 2) — that is also the figure that shows up on the Isracard/Cal
 * statement as a "PAYPAL" charge, so pegging to it lets the ledger cross-check
 * PayPal ⇄ card ⇄ email by date + amount. We therefore emit ONE outflow per
 * completed purchase: the ILS funding amount, with the merchant/date joined from
 * the payment row it funds.
 */

// Column header names (Hebrew export first, English fallback second).
const COLS = {
  date: ['תאריך', 'date'],
  time: ['שעה', 'time'],
  name: ['שם', 'name'],
  type: ['סוג', 'type'],
  status: ['מצב', 'status'],
  currency: ['מטבע', 'currency'],
  gross: ['ברוטו', 'gross'],
  net: ['נטו', 'net'],
  txnId: ['מזהה עסקה', 'transaction id'],
  // The parent/source transaction this row settles (deposit -> payment).
  refTxnId: ['מזהה סימוכין מס', 'מזהה סימוכין', 'reference txn id', 'reference id'],
  itemTitle: ['כותרת פריט', 'item title'],
  balance: ['השפעה ביתרה', 'balance impact'],
} as const;

// Row "type" (סוג) values that are plumbing, not a merchant purchase.
const TYPE_DEPOSIT = ['הפקדה כללית בכרטיס אשראי', 'general credit card deposit', 'credit card deposit'];
const TYPE_CONVERSION = ['המרת מטבע כללית', 'general currency conversion'];
// Balance-impact (השפעה ביתרה) values.
const BAL_DEBIT = ['חיוב', 'debit'];
const STATUS_DONE = ['הושלם', 'completed'];

function norm(s: string): string {
  return (s ?? '').toLowerCase().replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim();
}

function includesAny(value: string, options: readonly string[]): boolean {
  const v = norm(value);
  return options.some((o) => v.includes(norm(o)));
}

/** True if this header row looks like a PayPal activity export. */
export function isPaypalHeader(header: string[]): boolean {
  const h = header.map(norm);
  const has = (opts: readonly string[]): boolean => opts.some((o) => h.some((c) => c === norm(o)));
  // gross + net + a transaction id is the distinctive PayPal signature.
  return has(COLS.gross) && has(COLS.net) && has(COLS.txnId);
}

interface ColIndex {
  [k: string]: number;
}

function indexColumns(header: string[]): ColIndex {
  const h = header.map(norm);
  const idx: ColIndex = {};
  for (const [key, names] of Object.entries(COLS)) {
    let found = -1;
    for (const name of names) {
      const at = h.indexOf(norm(name));
      if (at >= 0) { found = at; break; }
    }
    idx[key] = found;
  }
  return idx;
}

interface Row {
  date: string;
  name: string;
  type: string;
  status: string;
  currency: string;
  gross: number | null;
  txnId: string;
  refTxnId: string;
  itemTitle: string;
  balance: string;
}

function cellAt(cells: string[], i: number): string {
  return i >= 0 && i < cells.length ? (cells[i] ?? '') : '';
}

export interface PaypalParseResult {
  parsed: ParsedTransaction[];
  skipped: number;
}

/** Parse a PayPal activity export buffer into one clean ILS outflow per purchase. */
export function parsePaypalFile(buf: Buffer, filename: string): PaypalParseResult {
  const grid = readGrid(buf, filename);
  const headerRow = grid.rows.findIndex((r) => isPaypalHeader(r));
  if (headerRow < 0) return { parsed: [], skipped: 0 };
  const idx = indexColumns(grid.rows[headerRow]!);

  const rows: Row[] = [];
  for (let i = headerRow + 1; i < grid.rows.length; i++) {
    const c = grid.rows[i]!;
    if (c.every((x) => (x ?? '').trim() === '')) continue;
    rows.push({
      date: cellAt(c, idx.date!),
      name: cellAt(c, idx.name!),
      type: cellAt(c, idx.type!),
      status: cellAt(c, idx.status!),
      currency: cellAt(c, idx.currency!).toUpperCase() || 'ILS',
      gross: parseAmount(cellAt(c, idx.gross!)),
      txnId: cellAt(c, idx.txnId!),
      refTxnId: cellAt(c, idx.refTxnId!),
      itemTitle: cellAt(c, idx.itemTitle!),
      balance: cellAt(c, idx.balance!),
    });
  }

  // Map each transaction id to its row so a deposit can look up the payment it funds.
  const byTxn = new Map<string, Row>();
  for (const r of rows) if (r.txnId) byTxn.set(r.txnId, r);

  const parsed: ParsedTransaction[] = [];
  let skipped = 0;
  // Track which payment rows a completed deposit already accounts for, so we
  // don't also import the payment itself (that would double-count the purchase).
  const covered = new Set<string>();

  // Pass 1: every completed credit-card funding deposit = one real card charge.
  for (const r of rows) {
    if (!includesAny(r.type, TYPE_DEPOSIT)) continue;
    if (!includesAny(r.status, STATUS_DONE)) { skipped++; continue; }
    const fund = r.gross === null ? null : Math.abs(r.gross);
    if (!fund || fund < 0.005) { skipped++; continue; }
    const payment = r.refTxnId ? byTxn.get(r.refTxnId) : undefined;
    if (payment?.txnId) covered.add(payment.txnId);
    const date = parseDate(payment?.date || r.date, 'DD/MM/YYYY');
    if (!date) { skipped++; continue; }
    const merchant = (payment?.name || r.itemTitle || 'PayPal').trim();
    const origNote =
      payment && payment.currency && payment.currency !== 'ILS' && payment.gross !== null
        ? `${payment.currency} ${Math.abs(payment.gross).toFixed(2)}`
        : '';
    const desc = [payment?.itemTitle || r.itemTitle, origNote].filter(Boolean).join(' · ');
    parsed.push({
      date,
      amount: -fund, // outflow: the card was charged this many ILS
      currency: 'ILS',
      merchantRaw: merchant,
      description: desc || merchant,
      sourceType: 'bank',
      sourceProvider: 'paypal',
      externalId: payment?.txnId || r.refTxnId || r.txnId || null,
      sourceRef: r.txnId || null,
      rawAmount: r.gross === null ? null : String(r.gross),
    });
  }

  // Pass 2: payments funded from the PayPal balance (no card deposit) — a debit
  // to a merchant that no completed deposit covered. Import at its own amount.
  for (const r of rows) {
    if (includesAny(r.type, TYPE_DEPOSIT) || includesAny(r.type, TYPE_CONVERSION)) continue;
    if (!includesAny(r.balance, BAL_DEBIT)) continue; // skip memos/holds (תזכיר) and credits
    if (!includesAny(r.status, STATUS_DONE)) continue;
    if (r.gross === null || r.gross >= 0) continue; // a payment is a negative gross
    if (r.txnId && covered.has(r.txnId)) continue; // already imported via its deposit
    const date = parseDate(r.date, 'DD/MM/YYYY');
    if (!date) { skipped++; continue; }
    const merchant = (r.name || r.itemTitle || 'PayPal').trim();
    parsed.push({
      date,
      amount: -Math.abs(r.gross),
      currency: r.currency || 'ILS',
      merchantRaw: merchant,
      description: r.itemTitle || merchant,
      sourceType: 'bank',
      sourceProvider: 'paypal',
      externalId: r.txnId || null,
      sourceRef: r.txnId || null,
      rawAmount: String(r.gross),
    });
  }

  return { parsed, skipped };
}
