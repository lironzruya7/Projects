import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createScraper } from 'israeli-bank-scrapers';
import { config } from '../config.js';
import { ParsedTransaction } from '../models/types.js';
import { getDb } from '../db/db.js';
import { createBatch, deleteBatch, setBatchRowCount } from '../repo/batches.js';
import { insertParsed } from '../repo/transactions.js';
import { runDedup } from '../dedup/engine.js';
import { loadToken, saveToken, deleteToken, hasToken } from '../email/tokenStore.js';
import { getProviderSpec, type ScrapeProvider } from './providers.js';
import { saveBankBalances, type BankBalance } from '../repo/balances.js';

const CRED_PREFIX = 'scrape:';

export function saveCredentials(providerKey: string, credentials: Record<string, string>): void {
  saveToken(CRED_PREFIX + providerKey, credentials);
}
export function deleteCredentials(providerKey: string): void {
  deleteToken(CRED_PREFIX + providerKey);
}
export function hasCredentials(providerKey: string): boolean {
  return hasToken(CRED_PREFIX + providerKey);
}
function loadCredentials(providerKey: string): Record<string, string> | null {
  return loadToken<Record<string, string>>(CRED_PREFIX + providerKey);
}

export interface ScrapeResult {
  provider: string;
  accountsScanned: number;
  transactionsCreated: number;
  skippedExisting: number;
  fromDate: string;
}

function monthsAgo(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(1);
  return d;
}

/**
 * Log into a bank/card provider with the stored credentials and pull its
 * transactions directly (via israeli-bank-scrapers, a headless browser). Maps
 * results into the ledger, idempotent by the transaction identifier, then runs
 * duplicate detection so scraped charges merge with email/receipt/CSV copies.
 */
export async function runScrape(providerKey: string, opts?: { months?: number }): Promise<ScrapeResult> {
  const spec = getProviderSpec(providerKey);
  if (!spec) throw new Error(`Unknown provider "${providerKey}"`);
  const credentials = loadCredentials(providerKey);
  if (!credentials) throw new Error(`No saved credentials for ${spec.label}. Add them in Settings first.`);

  const startDate = monthsAgo(opts?.months ?? 3);
  const proxyArgs = config.scrapeProxy ? [`--proxy-server=${config.scrapeProxy}`] : [];
  mkdirSync(config.scrapeDebugDir, { recursive: true });
  const scraper = createScraper({
    companyId: spec.companyId as never,
    startDate,
    combineInstallments: false,
    showBrowser: config.scrapeShowBrowser,
    timeout: config.scrapeTimeoutMs,
    defaultTimeout: config.scrapeTimeoutMs,
    // On failure, save a screenshot so we can see what page the browser was on.
    storeFailureScreenShotPath: join(config.scrapeDebugDir, `${spec.key}.png`),
    ...(config.puppeteerExecutablePath ? { executablePath: config.puppeteerExecutablePath } : {}),
    args: [...proxyArgs, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  } as never);

  const result = await scraper.scrape(credentials as never);
  if (!result.success) {
    const detail = (result as { errorType?: string; errorMessage?: string });
    throw new Error(`${spec.label} scrape failed: ${detail.errorType ?? ''} ${detail.errorMessage ?? ''}`.trim());
  }

  return persistScrape(spec, result.accounts ?? [], startDate);
}

function persistScrape(spec: ScrapeProvider, accounts: RawAccount[], startDate: Date): ScrapeResult {
  const db = getDb();
  const existsRef = db.prepare(`SELECT 1 FROM transactions WHERE source_ref = ?`);
  const batchId = createBatch({
    sourceType: spec.sourceType,
    sourceProvider: spec.key,
    filename: null,
    note: `Direct sync: ${spec.label}`,
  });

  const toInsert: ParsedTransaction[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const account of accounts) {
    for (const t of account.txns ?? []) {
      if (t.status && t.status !== 'completed') continue; // skip pending
      const id = t.identifier != null ? String(t.identifier) : `${t.date}|${t.chargedAmount}|${t.description}`;
      const sourceRef = `scrape:${spec.key}:${account.accountNumber ?? '0'}:${id}`;
      if (existsRef.get(sourceRef) || seen.has(sourceRef)) {
        skipped++;
        continue;
      }
      seen.add(sourceRef);

      const amount = Number(t.chargedAmount);
      if (!Number.isFinite(amount) || amount === 0) continue;
      const currency = normalizeCur(t.chargedCurrency || t.originalCurrency);

      const parsed = ParsedTransaction.safeParse({
        date: String(t.date).slice(0, 10),
        amount,
        currency,
        merchantRaw: t.description ?? '',
        description: t.memo || t.description || '',
        sourceType: spec.sourceType,
        sourceProvider: spec.key,
        sourceRef,
        externalId: t.identifier != null ? String(t.identifier) : null,
        rawAmount: String(t.originalAmount ?? t.chargedAmount),
        raw: { originalAmount: t.originalAmount, originalCurrency: t.originalCurrency, account: account.accountNumber },
      });
      if (parsed.success) toInsert.push(parsed.data);
    }
  }

  const ids = insertParsed(toInsert, batchId);
  if (ids.length === 0) deleteBatch(batchId);
  else setBatchRowCount(batchId, ids.length);

  // Capture the bank-reported balance (available on bank accounts, e.g. Yahav)
  // so the dashboard can show the current balance + a month-end forecast.
  if (spec.sourceType === 'bank') {
    const asOf = new Date().toISOString();
    const balances: BankBalance[] = accounts
      .filter((a) => typeof a.balance === 'number' && Number.isFinite(a.balance))
      .map((a) => ({
        provider: spec.key,
        label: spec.label,
        accountNumber: a.accountNumber ?? null,
        balance: Number(a.balance),
        currency: 'ILS',
        asOf,
      }));
    if (balances.length > 0) saveBankBalances(spec.key, balances);
  }

  runDedup();

  return {
    provider: spec.key,
    accountsScanned: accounts.length,
    transactionsCreated: ids.length,
    skippedExisting: skipped,
    fromDate: startDate.toISOString().slice(0, 10),
  };
}

function normalizeCur(c: string | undefined): string {
  if (!c) return 'ILS';
  const t = c.trim().toUpperCase();
  if (t === 'NIS' || t === '₪' || t === 'ILS' || t === 'שח') return 'ILS';
  return t.slice(0, 3) || 'ILS';
}

interface RawTxn {
  identifier?: string | number;
  date: string;
  chargedAmount: number;
  chargedCurrency?: string;
  originalAmount?: number;
  originalCurrency?: string;
  description?: string;
  memo?: string;
  status?: string;
}
interface RawAccount {
  accountNumber?: string;
  balance?: number;
  txns?: RawTxn[];
}
