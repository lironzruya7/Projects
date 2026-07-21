import { getMapping } from '../repo/mappings.js';
import { applyMapping, buildPreview } from './fileImport.js';
import { parsePdfStatement } from './pdfStatement.js';
import type { ParsedTransaction } from '../models/types.js';

export interface AutoParseResult {
  parsed: ParsedTransaction[];
  skipped: number;
  provider: string | null;
  format: 'pdf' | 'csv' | 'xlsx';
  needsManual: boolean;
  detail?: string;
}

function isPdf(buf: Buffer, filename: string): boolean {
  if (filename.toLowerCase().endsWith('.pdf')) return true;
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
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
): Promise<AutoParseResult> {
  if (isPdf(buf, filename)) {
    const r = await parsePdfStatement(buf, filename, { sourceType });
    return {
      parsed: r.parsed,
      skipped: r.skipped,
      provider: null,
      format: 'pdf',
      needsManual: r.parsed.length === 0,
      detail: r.parsed.length === 0 ? `No transaction rows found in ${r.lines} lines` : undefined,
    };
  }

  const preview = buildPreview(buf, filename);
  const remembered = getMapping(preview.signature);
  const provider = remembered?.provider ?? preview.suggestion.provider;

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
    parsed: result.parsed,
    skipped: result.skipped.length,
    provider: provider ?? null,
    format: preview.format,
    needsManual: result.parsed.length === 0,
    detail: result.parsed.length === 0 ? 'Could not auto-detect columns — use single-file import to map them' : undefined,
  };
}
