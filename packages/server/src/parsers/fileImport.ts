import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { ParsedTransaction, type AmountMode, type ColumnMapping, type MappingConfig } from '../models/types.js';
import { parseAmount } from './amount.js';
import { detectDateFormat, parseDate, type DateFormat } from './date.js';
import { suggestMapping, type MappingSuggestion } from './templates.js';
import { readGrid, type Grid } from './tabular.js';

const KEYWORD_HINTS = [
  'תאריך', 'סכום', 'חובה', 'זכות', 'בית עסק', 'העסק', 'תיאור', 'מטבע', 'יתרה',
  'date', 'amount', 'debit', 'credit', 'description', 'merchant', 'balance',
];

/** Find the header row: the row (within the first 15) with the most keyword hits. */
export function detectHeaderRow(grid: Grid): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(grid.rows.length, 15);
  for (let i = 0; i < limit; i++) {
    const row = grid.rows[i] ?? [];
    const joined = row.join(' ').toLowerCase();
    let score = 0;
    for (const kw of KEYWORD_HINTS) if (joined.includes(kw)) score++;
    // Prefer rows with several non-empty text cells.
    const nonEmpty = row.filter((c) => c.trim() !== '').length;
    score += Math.min(nonEmpty, 6) * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Stable signature for a header row, so mappings can be remembered per format. */
export function fingerprint(header: string[]): string {
  const norm = header
    .map((h) => h.toLowerCase().replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim())
    .filter((h) => h !== '')
    .join('|');
  return createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

export interface ImportPreview {
  signature: string;
  headerRow: number;
  header: string[];
  sampleRows: string[][];
  totalRows: number;
  suggestion: MappingSuggestion;
  detectedDateFormat: DateFormat;
  format: 'csv' | 'xlsx';
  encoding?: string;
}

/** Build a preview for the column-mapping UI. */
export function buildPreview(buf: Buffer, filename: string): ImportPreview {
  const grid = readGrid(buf, filename);
  const headerRow = detectHeaderRow(grid);
  const header = (grid.rows[headerRow] ?? []).map((h) => h.trim());
  const dataRows = grid.rows.slice(headerRow + 1).filter((r) => r.some((c) => c.trim() !== ''));
  const suggestion = suggestMapping(header);

  // Detect date format from the suggested date column, if any.
  let detectedDateFormat: DateFormat = 'DD/MM/YYYY';
  if (suggestion.mapping.date) {
    const idx = header.indexOf(suggestion.mapping.date);
    if (idx >= 0) {
      const samples = dataRows.slice(0, 40).map((r) => r[idx]);
      detectedDateFormat = detectDateFormat(samples);
    }
  }

  return {
    signature: fingerprint(header),
    headerRow,
    header,
    sampleRows: dataRows.slice(0, 8),
    totalRows: dataRows.length,
    suggestion,
    detectedDateFormat,
    format: grid.format,
    encoding: grid.encoding,
  };
}

export interface ApplyResult {
  parsed: ParsedTransaction[];
  skipped: Array<{ rowIndex: number; reason: string; row: string[] }>;
}

/**
 * Apply a mapping to a file buffer, producing Zod-validated ParsedTransactions.
 * Rows that fail validation are collected in `skipped` (fail loudly, don't drop
 * silently) rather than throwing the whole import away.
 */
export function applyMapping(
  buf: Buffer,
  filename: string,
  cfg: Pick<MappingConfig, 'mapping' | 'amountMode' | 'dateFormat' | 'headerRow' | 'provider' | 'sourceType'>,
): ApplyResult {
  const grid = readGrid(buf, filename);
  const headerRow = cfg.headerRow ?? detectHeaderRow(grid);
  const header = (grid.rows[headerRow] ?? []).map((h) => h.trim());
  const colIndex = (name: string | null | undefined): number =>
    name ? header.indexOf(name) : -1;

  const idx = {
    date: colIndex(cfg.mapping.date),
    amount: colIndex(cfg.mapping.amount),
    debit: colIndex(cfg.mapping.debit),
    credit: colIndex(cfg.mapping.credit),
    merchant: colIndex(cfg.mapping.merchant),
    description: colIndex(cfg.mapping.description),
    currency: colIndex(cfg.mapping.currency),
    type: colIndex(cfg.mapping.type),
    reference: colIndex(cfg.mapping.reference),
  };

  const dateFmt: DateFormat = (cfg.dateFormat as DateFormat) || 'auto';
  const parsed: ParsedTransaction[] = [];
  const skipped: ApplyResult['skipped'] = [];

  const dataRows = grid.rows.slice(headerRow + 1);
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]!;
    if (row.every((c) => c.trim() === '')) continue;

    const dateRaw = idx.date >= 0 ? row[idx.date] : undefined;
    const isoDate = parseDate(dateRaw, dateFmt);
    const amount = computeAmount(row, idx, cfg.amountMode);

    // Trailing summary rows / totals: no valid date usually means not a txn row.
    if (!isoDate) {
      if (amount !== null) skipped.push({ rowIndex: i, reason: 'unparseable date', row });
      continue;
    }
    if (amount === null) {
      skipped.push({ rowIndex: i, reason: 'unparseable amount', row });
      continue;
    }

    const merchantRaw =
      (idx.merchant >= 0 ? row[idx.merchant] : '') ||
      (idx.description >= 0 ? row[idx.description] : '') ||
      '';
    const description =
      (idx.description >= 0 ? row[idx.description] : '') ||
      (idx.merchant >= 0 ? row[idx.merchant] : '') ||
      '';
    const currency = (idx.currency >= 0 ? normalizeCurrency(row[idx.currency]) : '') || config.defaultCurrency;

    const externalId = idx.reference >= 0 ? (row[idx.reference] ?? '').trim() || null : null;
    const candidate = {
      date: isoDate,
      amount,
      currency,
      merchantRaw: merchantRaw.trim(),
      description: description.trim(),
      sourceType: cfg.sourceType,
      sourceProvider: cfg.provider ?? null,
      externalId,
      sourceRef: `${filename}#${headerRow + 1 + i + 1}`,
      rawAmount: idx.amount >= 0 ? row[idx.amount] : idx.debit >= 0 || idx.credit >= 0 ? `${row[idx.debit] ?? ''}/${row[idx.credit] ?? ''}` : String(amount),
      raw: Object.fromEntries(header.map((h, hi) => [h || `col${hi}`, row[hi] ?? ''])),
    };

    const result = ParsedTransaction.safeParse(candidate);
    if (result.success) parsed.push(result.data);
    else skipped.push({ rowIndex: i, reason: zodMessage(result.error), row });
  }

  return { parsed, skipped };
}

function computeAmount(
  row: string[],
  idx: { amount: number; debit: number; credit: number; type: number },
  mode: AmountMode,
): number | null {
  switch (mode) {
    case 'debit_credit': {
      const debit = idx.debit >= 0 ? parseAmount(row[idx.debit]) : null;
      const credit = idx.credit >= 0 ? parseAmount(row[idx.credit]) : null;
      if (debit === null && credit === null) return null;
      const out = Math.abs(debit ?? 0);
      const inc = Math.abs(credit ?? 0);
      if (out === 0 && inc === 0) return null;
      return inc - out; // credit positive (inflow), debit negative (outflow)
    }
    case 'magnitude_type': {
      const mag = idx.amount >= 0 ? parseAmount(row[idx.amount]) : null;
      if (mag === null) return null;
      const t = (idx.type >= 0 ? row[idx.type] ?? '' : '').toLowerCase();
      const isCredit = /(זכות|credit|refund|זיכוי)/.test(t);
      return isCredit ? Math.abs(mag) : -Math.abs(mag);
    }
    case 'flip_sign': {
      const a = idx.amount >= 0 ? parseAmount(row[idx.amount]) : null;
      return a === null ? null : -a;
    }
    case 'signed':
    default: {
      return idx.amount >= 0 ? parseAmount(row[idx.amount]) : null;
    }
  }
}

function normalizeCurrency(s: string | undefined): string {
  if (!s) return '';
  const t = s.trim();
  if (/₪|ils|nis|ש"?ח|שקל/i.test(t)) return 'ILS';
  if (/\$|usd|דולר/i.test(t)) return 'USD';
  if (/€|eur|אירו|יורו/i.test(t)) return 'EUR';
  if (/£|gbp/i.test(t)) return 'GBP';
  return t.toUpperCase().slice(0, 3);
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}
