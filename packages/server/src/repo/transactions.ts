import { randomUUID } from 'node:crypto';
import { getDb, nowIso } from '../db/db.js';
import { categorizeByRules, loadRules } from '../categorize/rules.js';
import { normalizeMerchant } from '../normalize/merchant.js';
import type { LedgerEntry, ParsedTransaction, SourceType, Transaction } from '../models/types.js';

interface TxnRow {
  id: string;
  date: string;
  posted_at: string | null;
  amount: number;
  currency: string;
  merchant_raw: string;
  merchant_normalized: string;
  description: string;
  category: string | null;
  category_source: string;
  source_type: string;
  source_provider: string | null;
  account_label: string | null;
  source_ref: string | null;
  external_id: string | null;
  import_batch: string | null;
  raw_amount: string | null;
  merged_into: string | null;
  created_at: string;
}

function rowToTransaction(r: TxnRow): Transaction {
  return {
    id: r.id,
    date: r.date,
    postedAt: r.posted_at,
    amount: r.amount,
    currency: r.currency,
    merchantRaw: r.merchant_raw,
    merchantNormalized: r.merchant_normalized,
    description: r.description,
    category: r.category,
    categorySource: (r.category_source as Transaction['categorySource']) ?? 'none',
    sourceType: r.source_type as SourceType,
    sourceProvider: r.source_provider,
    accountLabel: r.account_label,
    sourceRef: r.source_ref,
    externalId: r.external_id,
    importBatch: r.import_batch,
    rawAmount: r.raw_amount,
    mergedInto: r.merged_into,
    createdAt: r.created_at,
  };
}

/**
 * Insert a batch of parsed transactions. Applies merchant normalization and
 * rule-based categorization at insert time. Returns the created transaction ids.
 */
export function insertParsed(parsed: ParsedTransaction[], importBatch: string): string[] {
  const db = getDb();
  const rules = loadRules();
  const stmt = db.prepare(
    `INSERT INTO transactions
      (id, date, posted_at, amount, currency, merchant_raw, merchant_normalized,
       description, category, category_source, source_type, source_provider, account_label,
       source_ref, external_id, import_batch, raw_amount, merged_into, created_at)
     VALUES
      (@id, @date, @posted_at, @amount, @currency, @merchant_raw, @merchant_normalized,
       @description, @category, @category_source, @source_type, @source_provider, @account_label,
       @source_ref, @external_id, @import_batch, @raw_amount, NULL, @created_at)`,
  );
  const ids: string[] = [];
  const insertMany = db.transaction((items: ParsedTransaction[]) => {
    for (const p of items) {
      const id = randomUUID();
      const normalized = normalizeMerchant(p.merchantRaw || p.description || '');
      const cat = categorizeByRules(normalized, rules);
      stmt.run({
        id,
        date: p.date,
        posted_at: p.postedAt ?? null,
        amount: p.amount,
        currency: p.currency,
        merchant_raw: p.merchantRaw ?? '',
        merchant_normalized: normalized,
        description: p.description ?? '',
        category: cat,
        category_source: cat ? 'rule' : 'none',
        source_type: p.sourceType,
        source_provider: p.sourceProvider ?? null,
        account_label: p.accountLabel ?? null,
        source_ref: p.sourceRef ?? null,
        external_id: p.externalId ?? null,
        import_batch: importBatch,
        raw_amount: p.rawAmount ?? null,
        created_at: nowIso(),
      });
      ids.push(id);
    }
  });
  insertMany(parsed);
  return ids;
}

export interface LedgerQuery {
  from?: string;
  to?: string;
  category?: string;
  sourceType?: SourceType;
  provider?: string;
  currency?: string;
  merchant?: string;
  search?: string;
  uncategorizedOnly?: boolean;
  includeIncome?: boolean;
  limit?: number;
  offset?: number;
}

/** Fetch primary (non-merged) transactions matching a filter. */
export function queryLedger(q: LedgerQuery): LedgerEntry[] {
  const db = getDb();
  const where: string[] = ['merged_into IS NULL'];
  const params: Record<string, unknown> = {};
  if (q.from) {
    where.push('date >= @from');
    params.from = q.from;
  }
  if (q.to) {
    where.push('date <= @to');
    params.to = q.to;
  }
  if (q.category) {
    if (q.category === 'Uncategorized') where.push('category IS NULL');
    else {
      where.push('category = @category');
      params.category = q.category;
    }
  }
  if (q.uncategorizedOnly) where.push('category IS NULL');
  if (q.sourceType) {
    where.push('source_type = @sourceType');
    params.sourceType = q.sourceType;
  }
  if (q.provider) {
    where.push('source_provider = @provider');
    params.provider = q.provider;
  }
  if (q.currency) {
    where.push('currency = @currency');
    params.currency = q.currency;
  }
  if (q.merchant) {
    where.push('merchant_normalized = @merchant');
    params.merchant = q.merchant;
  }
  if (q.search) {
    where.push('(merchant_raw LIKE @search OR merchant_normalized LIKE @search OR description LIKE @search)');
    params.search = `%${q.search}%`;
  }
  const limit = Math.min(q.limit ?? 500, 5000);
  const offset = q.offset ?? 0;
  const rows = db
    .prepare(
      `SELECT * FROM transactions WHERE ${where.join(' AND ')}
       ORDER BY date DESC, created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    )
    .all(params) as TxnRow[];

  return rows.map((r) => hydrate(r));
}

/** Attach merged sources to a primary row to form a LedgerEntry. */
function hydrate(primary: TxnRow): LedgerEntry {
  const db = getDb();
  const merged = db
    .prepare(`SELECT * FROM transactions WHERE merged_into = ?`)
    .all(primary.id) as TxnRow[];
  const primaryTx = rowToTransaction(primary);
  const sources = [primaryTx, ...merged.map(rowToTransaction)];
  const sourceTypes = [...new Set(sources.map((s) => s.sourceType))];
  return { ...primaryTx, sources, sourceCount: sources.length, sourceTypes };
}

export function getTransaction(id: string): Transaction | null {
  const r = getDb().prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as TxnRow | undefined;
  return r ? rowToTransaction(r) : null;
}

export function getLedgerEntry(id: string): LedgerEntry | null {
  const r = getDb().prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as TxnRow | undefined;
  return r ? hydrate(r) : null;
}

/** All primary transactions (unbounded) — used by dedup + insights engines. */
export function allPrimary(): Transaction[] {
  const rows = getDb()
    .prepare(`SELECT * FROM transactions WHERE merged_into IS NULL ORDER BY date ASC`)
    .all() as TxnRow[];
  return rows.map(rowToTransaction);
}

export function setCategory(id: string, category: string | null, source: 'manual' | 'rule' | 'llm'): void {
  getDb()
    .prepare(`UPDATE transactions SET category = ?, category_source = ? WHERE id = ?`)
    .run(category, category ? source : 'none', id);
}

/** Re-run rule categorization across rows that are uncategorized or rule-sourced. */
export function recategorizeAll(): number {
  const db = getDb();
  const rules = loadRules();
  const rows = db
    .prepare(`SELECT * FROM transactions WHERE category_source IN ('none','rule')`)
    .all() as TxnRow[];
  const update = db.prepare(`UPDATE transactions SET category = ?, category_source = ? WHERE id = ?`);
  let changed = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const cat = categorizeByRules(r.merchant_normalized, rules);
      const nextSource = cat ? 'rule' : 'none';
      if (cat !== r.category || nextSource !== r.category_source) {
        update.run(cat, nextSource, r.id);
        changed++;
      }
    }
  });
  tx();
  return changed;
}

export function distinctMerchants(): Array<{ merchant: string; count: number }> {
  const rows = getDb()
    .prepare(
      `SELECT merchant_normalized AS merchant, COUNT(*) AS count
       FROM transactions WHERE merged_into IS NULL AND merchant_normalized <> ''
       GROUP BY merchant_normalized ORDER BY count DESC`,
    )
    .all() as Array<{ merchant: string; count: number }>;
  return rows;
}

/** Distinct accounts (provider + source type) with transaction counts. */
export function listAccounts(): Array<{ provider: string | null; sourceType: string; count: number }> {
  return getDb()
    .prepare(
      `SELECT source_provider AS provider, source_type AS sourceType, COUNT(*) AS count
       FROM transactions WHERE merged_into IS NULL
       GROUP BY source_provider, source_type ORDER BY count DESC`,
    )
    .all() as Array<{ provider: string | null; sourceType: string; count: number }>;
}

/** Distinct currencies present in the ledger, with counts. */
export function listCurrencies(): Array<{ currency: string; count: number }> {
  return getDb()
    .prepare(
      `SELECT currency, COUNT(*) AS count FROM transactions WHERE merged_into IS NULL
       GROUP BY currency ORDER BY count DESC`,
    )
    .all() as Array<{ currency: string; count: number }>;
}

export function uncategorizedMerchants(): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT merchant_normalized AS m FROM transactions
       WHERE category IS NULL AND merchant_normalized <> ''`,
    )
    .all() as Array<{ m: string }>;
  return rows.map((r) => r.m);
}
