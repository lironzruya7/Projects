import { getDb, getSetting } from '../db/db.js';
import { ParsedTransaction } from '../models/types.js';
import { extractPdfText } from '../parsers/pdf.js';
import { ocrImage, ocrPdf } from '../parsers/ocr.js';
import { extractReceipt } from '../parsers/receipt.js';
import { createBatch, setBatchRowCount } from '../repo/batches.js';
import { insertParsed } from '../repo/transactions.js';
import { gmailProvider } from './gmail.js';
import { outlookProvider } from './outlook.js';
import { imapProvider } from './imap.js';
import { buildQuery, type EmailMessage, type EmailProvider, type EmailProviderName } from './types.js';

const ALL_PROVIDERS: EmailProvider[] = [gmailProvider, outlookProvider, imapProvider];

export function getProvider(name?: EmailProviderName): EmailProvider {
  if (name === 'imap') return imapProvider;
  if (name === 'gmail') return gmailProvider;
  if (name === 'outlook') return outlookProvider;
  // Default preference: first configured provider.
  return ALL_PROVIDERS.find((p) => p.isConfigured()) ?? gmailProvider;
}

/** Providers that are both configured and connected (usable for a scan). */
export async function connectedProviders(): Promise<EmailProvider[]> {
  const out: EmailProvider[] = [];
  for (const p of ALL_PROVIDERS) {
    if (p.isConfigured() && (await p.isConnected())) out.push(p);
  }
  return out;
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
    // Scanned PDF with no text layer -> render pages to images and OCR them.
    const ocred = await ocrPdf(data);
    return ocred.trim().length > 0 ? ocred : t;
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
  error?: string;
}

/** Run an email scan: search, parse, and insert new transactions (idempotent by source_ref). */
export async function runScan(opts?: { providerName?: EmailProviderName; maxResults?: number }): Promise<ScanResult> {
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

export interface EmailTestResult {
  provider: string;
  query: string;
  found: number;
  samples: Array<{
    from: string;
    subject: string;
    date: string;
    attachments: number;
    extractedAmount: number | null;
    currency: string | null;
  }>;
}

/**
 * Dry-run a provider: search and preview the first few matching emails WITHOUT
 * importing anything. Lets the user confirm the connection + search settings and
 * see whether an amount is being extracted. Only the body is parsed here (no
 * attachment OCR) to keep the test fast.
 */
export async function testConnection(opts?: {
  providerName?: EmailProviderName;
  maxResults?: number;
}): Promise<EmailTestResult> {
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
  const maxResults = opts?.maxResults ?? 5;
  const messages = await provider.search(query, maxResults);

  const samples = messages.slice(0, 5).map((msg) => {
    const r = extractReceipt(`${msg.subject}\n${msg.bodyText}`, {
      merchant: msg.fromName || msg.from,
      date: msg.date,
    });
    return {
      from: msg.fromName || msg.from,
      subject: msg.subject,
      date: msg.date,
      attachments: msg.attachments.length,
      extractedAmount: r.amount && r.amount > 0 ? r.amount : null,
      currency: r.amount && r.amount > 0 ? r.currency : null,
    };
  });

  return { provider: provider.name, query, found: messages.length, samples };
}

export interface MultiScanResult {
  results: ScanResult[];
  messagesScanned: number;
  transactionsCreated: number;
  skippedExisting: number;
}

/**
 * Scan every connected provider (Gmail + Outlook + IMAP) and aggregate. Used when
 * the caller doesn't pick a specific provider. Skips providers that error so one
 * broken account doesn't sink the others.
 */
export async function scanAll(opts?: { maxResults?: number }): Promise<MultiScanResult> {
  const providers = await connectedProviders();
  if (providers.length === 0) throw new Error('No email account is connected. Connect Gmail or Outlook first.');
  const results: ScanResult[] = [];
  for (const p of providers) {
    try {
      results.push(await runScan({ providerName: p.name, maxResults: opts?.maxResults }));
    } catch (err) {
      results.push({
        provider: p.name,
        query: '(failed)',
        messagesScanned: 0,
        transactionsCreated: 0,
        skippedExisting: 0,
        error: (err as Error).message,
      } as ScanResult);
    }
  }
  return {
    results,
    messagesScanned: results.reduce((s, r) => s + r.messagesScanned, 0),
    transactionsCreated: results.reduce((s, r) => s + r.transactionsCreated, 0),
    skippedExisting: results.reduce((s, r) => s + r.skippedExisting, 0),
  };
}
