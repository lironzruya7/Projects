import { getDb, getSetting } from '../db/db.js';
import { ParsedTransaction } from '../models/types.js';
import { extractPdfText } from '../parsers/pdf.js';
import { ocrImage } from '../parsers/ocr.js';
import { extractReceipt } from '../parsers/receipt.js';
import { createBatch, setBatchRowCount } from '../repo/batches.js';
import { insertParsed } from '../repo/transactions.js';
import { gmailProvider } from './gmail.js';
import { imapProvider } from './imap.js';
import { buildQuery, type EmailMessage, type EmailProvider } from './types.js';

export function getProvider(name?: 'gmail' | 'imap'): EmailProvider {
  if (name === 'imap') return imapProvider;
  if (name === 'gmail') return gmailProvider;
  // Prefer Gmail if configured, else IMAP.
  return gmailProvider.isConfigured() ? gmailProvider : imapProvider;
}

interface EmailSettings {
  keywords: string[];
  senderDomains: string[];
  maxResults: number;
  lookbackDays: number;
}

function domainOf(email: string): string {
  const at = email.indexOf('@');
  return at >= 0 ? email.slice(at + 1) : email;
}

const IMAGE_MIME = /image\/(png|jpe?g|gif|webp|bmp|tiff)/i;

async function textFromAttachment(mime: string, filename: string, data: Buffer): Promise<string> {
  const lower = filename.toLowerCase();
  if (mime.includes('pdf') || lower.endsWith('.pdf')) {
    const t = await extractPdfText(data);
    if (t.trim().length > 20) return t;
    // Scanned PDF with no text layer -> OCR is not applied to PDFs here; return what we have.
    return t;
  }
  if (IMAGE_MIME.test(mime) || /\.(png|jpe?g|gif|webp|bmp|tiff)$/i.test(lower)) {
    return ocrImage(data);
  }
  return '';
}

/** Convert one email (+ attachments) into candidate transactions. */
async function messageToTransactions(msg: EmailMessage, provider: string): Promise<ParsedTransaction[]> {
  const out: ParsedTransaction[] = [];
  const hint = { merchant: msg.fromName || domainOf(msg.from), date: msg.date };

  // Body-derived receipt.
  const body = extractReceipt(`${msg.subject}\n${msg.bodyText}`, hint);
  if (body.amount && body.amount > 0) {
    out.push(
      ParsedTransaction.parse({
        date: body.date ?? msg.date,
        amount: -Math.abs(body.amount),
        currency: body.currency,
        merchantRaw: body.merchant ?? hint.merchant ?? msg.subject,
        description: msg.subject,
        sourceType: 'email',
        sourceProvider: provider,
        sourceRef: `${provider}:${msg.id}`,
        externalId: body.invoiceNumber ?? null,
        rawAmount: String(body.amount),
        raw: { from: msg.from, subject: msg.subject, lineItems: body.lineItems },
      }),
    );
  }

  // Attachment-derived receipts.
  for (const att of msg.attachments) {
    const text = await textFromAttachment(att.mimeType, att.filename, att.data);
    if (!text.trim()) continue;
    const r = extractReceipt(text, hint);
    if (r.amount && r.amount > 0) {
      out.push(
        ParsedTransaction.parse({
          date: r.date ?? msg.date,
          amount: -Math.abs(r.amount),
          currency: r.currency,
          merchantRaw: r.merchant ?? hint.merchant ?? att.filename,
          description: `${msg.subject} — ${att.filename}`,
          sourceType: 'email',
          sourceProvider: provider,
          sourceRef: `${provider}:${msg.id}:${att.filename}`,
          externalId: r.invoiceNumber ?? null,
          rawAmount: String(r.amount),
          raw: { attachment: att.filename, from: msg.from, lineItems: r.lineItems },
        }),
      );
    }
  }

  return out;
}

export interface ScanResult {
  provider: string;
  query: string;
  messagesScanned: number;
  transactionsCreated: number;
  skippedExisting: number;
}

/** Run an email scan: search, parse, and insert new transactions (idempotent by source_ref). */
export async function runScan(opts?: { providerName?: 'gmail' | 'imap'; maxResults?: number }): Promise<ScanResult> {
  const settings = getSetting<EmailSettings>('email', {
    keywords: ['invoice', 'receipt', 'order', 'payment', 'חשבונית', 'קבלה', 'תשלום', 'הזמנה'],
    senderDomains: [],
    maxResults: 50,
    lookbackDays: 90,
  });
  const provider = getProvider(opts?.providerName);
  if (!provider.isConfigured()) throw new Error(`Email provider "${provider.name}" is not configured`);
  if (!(await provider.isConnected())) throw new Error(`Email provider "${provider.name}" is not connected`);

  const query = buildQuery({
    keywords: settings.keywords,
    senderDomains: settings.senderDomains,
    lookbackDays: settings.lookbackDays,
  });
  const maxResults = opts?.maxResults ?? settings.maxResults;
  const messages = await provider.search(query, maxResults);

  const db = getDb();
  const existsRef = db.prepare(`SELECT 1 FROM transactions WHERE source_ref = ?`);
  const batchId = createBatch({
    sourceType: 'email',
    sourceProvider: provider.name,
    filename: null,
    note: `Email scan: ${query}`,
  });

  const toInsert: ParsedTransaction[] = [];
  let skipped = 0;
  for (const msg of messages) {
    const candidates = await messageToTransactions(msg, provider.name);
    for (const c of candidates) {
      if (c.sourceRef && existsRef.get(c.sourceRef)) {
        skipped++;
        continue;
      }
      toInsert.push(c);
    }
  }

  const ids = insertParsed(toInsert, batchId);
  setBatchRowCount(batchId, ids.length);

  return {
    provider: provider.name,
    query,
    messagesScanned: messages.length,
    transactionsCreated: ids.length,
    skippedExisting: skipped,
  };
}
