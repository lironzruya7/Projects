import { parse as parseCsv } from 'csv-parse/sync';
// @e965/xlsx is the npm-published, patched build of SheetJS (0.20.x); the plain
// `xlsx` package on npm is frozen at 0.18.5 and carries prototype-pollution +
// ReDoS advisories with no npm fix. Same API, so this is a drop-in.
import * as XLSX from '@e965/xlsx';
import { decodeBuffer, stripDirectionalMarks } from './encoding.js';

export interface Grid {
  rows: string[][]; // every cell as a trimmed string
  format: 'csv' | 'xlsx';
  encoding?: string;
  sheetName?: string;
}

// Defensive bounds for spreadsheet parsing (defence-in-depth against a crafted
// file causing excessive CPU/memory). Real bank/card/PayPal exports are well
// under these — a few hundred KB and a few thousand rows.
const MAX_TABULAR_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_SHEET_ROWS = 200_000;

/** Read a CSV or XLSX buffer into a rectangular grid of string cells. */
export function readGrid(buf: Buffer, filename: string): Grid {
  if (buf.length > MAX_TABULAR_BYTES) {
    throw new Error(`File too large to parse (${Math.round(buf.length / 1024 / 1024)} MB, max 25 MB).`);
  }
  const lower = filename.toLowerCase();
  const isExcel = lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm');
  if (isExcel || looksLikeExcel(buf)) return readXlsx(buf);
  return readCsvBuffer(buf);
}

function looksLikeExcel(buf: Buffer): boolean {
  // XLSX = zip (PK\x03\x04); legacy XLS = OLE (D0 CF 11 E0)
  return (
    (buf[0] === 0x50 && buf[1] === 0x4b) ||
    (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0)
  );
}

function readXlsx(buf: Buffer): Grid {
  // sheetRows bounds how many rows are materialised, capping work on a file that
  // claims to have millions of rows.
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: true, sheetRows: MAX_SHEET_ROWS });
  const sheetName = wb.SheetNames[0]!;
  const ws = wb.Sheets[sheetName]!;
  const arr = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' });
  const rows = arr.map((r) => r.map((c) => cell(c)));
  return { rows, format: 'xlsx', sheetName };
}

function readCsvBuffer(buf: Buffer): Grid {
  const { text, encoding } = decodeBuffer(buf);
  const delimiter = detectDelimiter(text);
  const records = parseCsv(text, {
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    bom: true,
    trim: false,
  }) as string[][];
  const rows = records.map((r) => r.map((c) => cell(c)));
  return { rows, format: 'csv', encoding };
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n');
  const counts: Record<string, number> = {
    ',': (sample.match(/,/g) ?? []).length,
    ';': (sample.match(/;/g) ?? []).length,
    '\t': (sample.match(/\t/g) ?? []).length,
    '|': (sample.match(/\|/g) ?? []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0];
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  return stripDirectionalMarks(String(v)).trim();
}
