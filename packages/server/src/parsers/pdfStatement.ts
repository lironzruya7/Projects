import { ParsedTransaction } from '../models/types.js';
import { parseAmount } from './amount.js';
import { parseDate } from './date.js';
import { stripDirectionalMarks } from './encoding.js';
import { extractPdfText } from './pdf.js';
import { ocrPdf } from './ocr.js';

export interface StatementParseResult {
  parsed: ParsedTransaction[];
  skipped: number;
  lines: number;
}

const MONEY = /-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2}/g;
const DATE = /\b(\d{1,2}[/.]\d{1,2}[/.]\d{2,4})\b/;
const NEGATIVE_HINT = /(זיכוי|החזר|refund|credit)/i;

/**
 * Best-effort extraction of transactions from a text-based PDF statement (card
 * or bank). Each line that has a date + a money-formatted amount becomes a
 * transaction. Heuristic — Israeli statement layouts vary — so the caller shows
 * a preview and the user can drop a batch that came out wrong.
 */
export async function parsePdfStatement(
  buf: Buffer,
  filename: string,
  opts: { sourceType: 'bank' | 'card'; provider?: string | null },
): Promise<StatementParseResult> {
  let text = await extractPdfText(buf);
  if (text.trim().length < 30) text = await ocrPdf(buf, 8); // scanned statement

  const rawLines = text.split(/\r?\n/).map((l) => stripDirectionalMarks(l).trim()).filter(Boolean);
  const parsed: ParsedTransaction[] = [];
  let skipped = 0;
  let idx = 0;

  for (const line of rawLines) {
    const dateM = line.match(DATE);
    if (!dateM) continue;
    const dateStr = dateM[1] ?? dateM[0];
    const iso = parseDate(dateStr);
    if (!iso) continue;

    const amounts = (line.match(MONEY) ?? []).map((m) => parseAmount(m)).filter((n): n is number => n !== null);
    const plausible = amounts.filter((n) => Math.abs(n) >= 0.5 && Math.abs(n) <= 500_000);
    if (plausible.length === 0) continue;

    // Israeli statements put the billed amount last; pick the last plausible one.
    const magnitude = Math.abs(plausible[plausible.length - 1]!);
    // Cards/bank spend is an outflow unless the line looks like a refund/credit.
    const amount = NEGATIVE_HINT.test(line) ? magnitude : -magnitude;

    let desc = line
      .replace(dateStr, ' ')
      .replace(MONEY, ' ')
      .replace(/₪|ש"?ח|ILS|NIS/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (desc.length < 2) desc = 'PDF statement row';

    idx++;
    const candidate = {
      date: iso,
      amount,
      currency: 'ILS',
      merchantRaw: desc,
      description: desc,
      sourceType: opts.sourceType,
      sourceProvider: opts.provider ?? null,
      sourceRef: `${filename}#${idx}:${iso}:${magnitude}`,
      rawAmount: String(magnitude),
      raw: { line },
    };
    const res = ParsedTransaction.safeParse(candidate);
    if (res.success) parsed.push(res.data);
    else skipped++;
  }

  return { parsed, skipped, lines: rawLines.length };
}
