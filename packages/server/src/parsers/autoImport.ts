import { getMapping } from '../repo/mappings.js';
import { applyMapping, buildPreview } from './fileImport.js';
import { parsePdfStatement } from './pdfStatement.js';
import { readGrid } from './tabular.js';
import { stripDirectionalMarks } from './encoding.js';
import { isPaypalHeader, parsePaypalFile } from './paypal.js';
import type { ParsedTransaction } from '../models/types.js';

export interface AutoParseResult {
  parsed: ParsedTransaction[];
  skipped: number;
  provider: string | null;
  accountLabel: string | null;
  format: 'pdf' | 'csv' | 'xlsx';
  needsManual: boolean;
  detail?: string;
}

function isPdf(buf: Buffer, filename: string): boolean {
  if (filename.toLowerCase().endsWith('.pdf')) return true;
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

/**
 * Best-effort extraction of a card's last-4 from statement text (metadata rows
 * that usually sit above the table). Anchored on a mask or the words
 * "כרטיס"/"card"/"מסתיים"/"אחרונות" so we don't grab a random 4-digit amount.
 */
export function extractCardLast4(text: string): string | null {
  const s = stripDirectionalMarks(text);
  const patterns = [
    /(?:\*{2,}|x{2,}|·{2,}|•{2,}|\.{3,}|\bxx)[\s-]*(\d{4})\b/i, // ****1234 / xxxx-1234
    /(\d{4})[\s-]*(?:\*{2,}|x{2,})/i, // 1234****
    /(?:כרטיס|card|מסתיים|אחרונות|ending)\D{0,25}?(\d{4})\b/i, // כרטיס ...1234
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1]!;
  }
  return null;
}

/** True if a CSV/XLSX buffer is a PayPal activity export (by its header row). */
function isPaypalTabular(buf: Buffer, filename: string): boolean {
  try {
    const grid = readGrid(buf, filename);
    return grid.rows.slice(0, 6).some((r) => isPaypalHeader(r));
  } catch {
    return false;
  }
}

/** Scan a tabular file's top rows (above the data) for a card last-4. */
function detectCardLabel(buf: Buffer, filename: string): string | null {
  try {
    if (isPdf(buf, filename)) return null;
    const grid = readGrid(buf, filename);
    const text = grid.rows.slice(0, 10).map((r) => r.join(' ')).join('\n');
    return extractCardLast4(text);
  } catch {
    return null;
  }
}

/**
 * Parse a single uploaded file without asking the user to map columns:
 *  - PDF  -> statement line parser
 *  - CSV/XLSX -> remembered mapping for this format, else auto-suggested mapping
 * The chosen import mode (card/bank) overrides the detected source type.
 */
export async function autoParseFile(
  buf: Buffer,
  filename: string,
  sourceType: 'bank' | 'card',
  accountLabel?: string | null,
  providerOverride?: string | null,
): Promise<AutoParseResult> {
  // Prefer the user-supplied label; otherwise try to detect a card last-4.
  const label = (accountLabel ?? '').trim() || detectCardLabel(buf, filename);
  const override = (providerOverride ?? '').trim().toLowerCase() || null;
  const stamp = (rows: ParsedTransaction[], provider: string | null): ParsedTransaction[] =>
    rows.map((p) => ({
      ...p,
      accountLabel: p.accountLabel ?? label,
      sourceProvider: provider ?? p.sourceProvider ?? null,
    }));

  if (isPdf(buf, filename)) {
    const r = await parsePdfStatement(buf, filename, { sourceType });
    const provider = override ?? null;
    return {
      parsed: stamp(r.parsed, provider),
      skipped: r.skipped,
      provider,
      accountLabel: label,
      format: 'pdf',
      needsManual: r.parsed.length === 0,
      detail: r.parsed.length === 0 ? `No transaction rows found in ${r.lines} lines` : undefined,
    };
  }

  // PayPal activity exports spread one purchase across several rows (payment +
  // card funding + currency conversion) that net to zero under the generic
  // column mapper. Detect and collapse them into one clean ILS outflow each.
  if (!isPdf(buf, filename) && isPaypalTabular(buf, filename)) {
    const r = parsePaypalFile(buf, filename);
    return {
      parsed: stamp(r.parsed, 'paypal'),
      skipped: r.skipped,
      provider: 'paypal',
      accountLabel: label,
      format: filename.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx',
      needsManual: r.parsed.length === 0,
      detail:
        r.parsed.length === 0
          ? 'No completed PayPal purchases found in this export'
          : `Collapsed PayPal activity into ${r.parsed.length} purchase${r.parsed.length === 1 ? '' : 's'}`,
    };
  }

  const preview = buildPreview(buf, filename);
  const remembered = getMapping(preview.signature);
  // A user-picked card type wins over auto-detected provider (handles cards we
  // don't fingerprint, e.g. Diners / Max / Amex).
  const provider = override ?? remembered?.provider ?? preview.suggestion.provider;

  let amountMode = remembered?.amountMode ?? preview.suggestion.amountMode;
  // In card mode, a single positive "amount / סכום חיוב" column means charges,
  // which are outflows — flip the sign so they don't land as income.
  if (!remembered && sourceType === 'card' && amountMode === 'signed') amountMode = 'flip_sign';

  const cfg = remembered
    ? {
        mapping: remembered.mapping,
        amountMode,
        dateFormat: remembered.dateFormat ?? preview.detectedDateFormat,
        headerRow: remembered.headerRow,
        provider,
        sourceType,
      }
    : {
        mapping: preview.suggestion.mapping,
        amountMode,
        dateFormat: preview.detectedDateFormat,
        headerRow: preview.headerRow,
        provider,
        sourceType,
      };

  const result = applyMapping(buf, filename, cfg);
  return {
    parsed: stamp(result.parsed, provider ?? null),
    skipped: result.skipped.length,
    provider: provider ?? null,
    accountLabel: label,
    format: preview.format,
    needsManual: result.parsed.length === 0,
    detail: result.parsed.length === 0 ? 'Could not auto-detect columns — use single-file import to map them' : undefined,
  };
}
