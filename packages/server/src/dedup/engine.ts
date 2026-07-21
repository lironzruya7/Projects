import { randomUUID } from 'node:crypto';
import { getDb, getSetting, nowIso } from '../db/db.js';
import { amountsMatch } from '../parsers/amount.js';
import { daysBetween } from '../parsers/date.js';
import { tokenSetRatio } from '../normalize/merchant.js';
import type { DedupSettings, Transaction } from '../models/types.js';
import { allPrimary, getTransaction } from '../repo/transactions.js';
import { applySettlementCategory } from '../reconcile/reconcile.js';

const DEFAULT_DEDUP: DedupSettings = {
  amountTolerancePct: 0.5,
  amountToleranceMinor: 1,
  dateWindowDays: 3,
  merchantThreshold: 0.85,
};

function settings(): DedupSettings {
  return { ...DEFAULT_DEDUP, ...getSetting('dedup', DEFAULT_DEDUP) };
}

interface Candidate {
  a: Transaction;
  b: Transaction;
  similarity: number;
  sameSource: boolean;
}

/** Two transactions come from the "same source" (=> double charge, not a dup). */
function isSameSource(a: Transaction, b: Transaction): boolean {
  if (a.importBatch && b.importBatch) return a.importBatch === b.importBatch;
  // No batch info: same provider + same source type counts as same source.
  return a.sourceType === b.sourceType && a.sourceProvider === b.sourceProvider;
}

/** Find all matching candidate pairs among the current primary transactions. */
function findCandidates(txns: Transaction[], cfg: DedupSettings): Candidate[] {
  // Block by rounded magnitude to keep comparisons local.
  const buckets = new Map<number, Transaction[]>();
  for (const t of txns) {
    const key = Math.round(Math.abs(t.amount));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(t);
  }

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const t of txns) {
    const key = Math.round(Math.abs(t.amount));
    for (const dk of [key - 1, key, key + 1]) {
      const group = buckets.get(dk);
      if (!group) continue;
      for (const other of group) {
        if (other.id === t.id) continue;
        const pairKey = [t.id, other.id].sort().join('|');
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        // Only compare same-sign transactions (both expenses or both income).
        if (Math.sign(t.amount) !== Math.sign(other.amount)) continue;
        if (!amountsMatch(t.amount, other.amount, {
          tolerancePct: cfg.amountTolerancePct,
          toleranceMinor: cfg.amountToleranceMinor,
        }))
          continue;

        const sim = tokenSetRatio(t.merchantNormalized, other.merchantNormalized);
        const days = daysBetween(t.date, other.date);

        // Strong signal: same transaction/invoice number + matching amount. The
        // billing date can differ from the purchase date, so allow a wider window
        // and don't require the merchant strings to match.
        const sameRef = sameExternalId(t.externalId, other.externalId);
        const strong = sameRef && days <= Math.max(cfg.dateWindowDays, 14);

        // Normal signal: amount + date window + fuzzy merchant.
        const normal = days <= cfg.dateWindowDays && sim >= cfg.merchantThreshold;

        if (!strong && !normal) continue;

        candidates.push({
          a: t,
          b: other,
          similarity: sameRef ? Math.max(sim, 0.99) : sim,
          sameSource: isSameSource(t, other),
        });
      }
    }
  }
  return candidates;
}

/** Two invoice/transaction numbers refer to the same charge (digits compared). */
function sameExternalId(a: string | null, b: string | null): boolean {
  const na = (a ?? '').replace(/\D/g, '');
  const nb = (b ?? '').replace(/\D/g, '');
  return na.length >= 4 && na === nb;
}

/** Priority for choosing the primary of a merge group. Lower = preferred. */
function primaryRank(t: Transaction): number {
  const order: Record<string, number> = { bank: 0, card: 1, email: 2, receipt: 3 };
  return order[t.sourceType] ?? 4;
}

export interface DedupResult {
  merges: number;      // groups merged
  mergedRows: number;  // rows absorbed
  alerts: number;      // new double-charge alerts
}

/**
 * Run duplicate detection over all primary transactions.
 *  - cross-file matches  => merge into one ledger entry (reversible)
 *  - same-source matches => raise a "possible double charge" alert
 */
export function runDedup(): DedupResult {
  const db = getDb();
  const cfg = settings();
  const txns = allPrimary();
  const byId = new Map(txns.map((t) => [t.id, t]));
  const candidates = findCandidates(txns, cfg);

  // Union-find over cross-file (mergeable) candidates.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (x: string, y: string) => {
    parent.set(find(x), find(y));
  };
  for (const t of txns) parent.set(t.id, t.id);

  const alertPairs: Candidate[] = [];
  for (const c of candidates) {
    if (c.sameSource) alertPairs.push(c);
    else union(c.a.id, c.b.id);
  }

  // Build groups from union-find.
  const groups = new Map<string, string[]>();
  for (const t of txns) {
    const root = find(t.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(t.id);
  }

  let merges = 0;
  let mergedRows = 0;
  const setMerged = db.prepare(`UPDATE transactions SET merged_into = ? WHERE id = ?`);
  const clearMerged = db.prepare(`UPDATE transactions SET merged_into = NULL WHERE id = ?`);

  const applyMerges = db.transaction(() => {
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      const members = ids.map((id) => byId.get(id)!).filter(Boolean);
      members.sort((a, b) => primaryRank(a) - primaryRank(b) || a.createdAt.localeCompare(b.createdAt));
      const primary = members[0]!;
      clearMerged.run(primary.id);
      for (const m of members.slice(1)) setMerged.run(primary.id, m.id);
      merges++;
      mergedRows += members.length - 1;
    }
  });
  applyMerges();

  // Raise double-charge alerts (skip pairs already resolved/dismissed).
  let alerts = 0;
  const insertAlert = db.prepare(
    `INSERT OR IGNORE INTO double_charge_alerts
       (id, txn_a, txn_b, amount, merchant, date_a, date_b, similarity, status, created_at)
     VALUES (@id, @txn_a, @txn_b, @amount, @merchant, @date_a, @date_b, @similarity, 'open', @created_at)`,
  );
  const existsAlert = db.prepare(
    `SELECT id FROM double_charge_alerts WHERE (txn_a = @a AND txn_b = @b) OR (txn_a = @b AND txn_b = @a)`,
  );
  const insertAlerts = db.transaction(() => {
    for (const c of alertPairs) {
      const [a, b] = [c.a.id, c.b.id].sort();
      if (existsAlert.get({ a, b })) continue;
      insertAlert.run({
        id: randomUUID(),
        txn_a: a,
        txn_b: b,
        amount: Math.abs(c.a.amount),
        merchant: c.a.merchantNormalized || c.a.merchantRaw,
        date_a: c.a.date,
        date_b: c.b.date,
        similarity: c.similarity,
        created_at: nowIso(),
      });
      alerts++;
    }
  });
  insertAlerts();

  // Tag bank credit-card settlement lines as Transfers so the aggregate bank
  // charge isn't double-counted against the itemized card purchases.
  applySettlementCategory();

  return { merges, mergedRows, alerts };
}

/** Clear all merges (make every row a primary again). */
export function unmergeAll(): void {
  getDb().prepare(`UPDATE transactions SET merged_into = NULL`).run();
}

/** Manually unmerge a single absorbed row back into its own ledger entry. */
export function unmerge(transactionId: string): void {
  getDb().prepare(`UPDATE transactions SET merged_into = NULL WHERE id = ?`).run(transactionId);
}

/** Manually merge a set of rows into one primary (chosen by rank). */
export function mergeManual(ids: string[]): string | null {
  if (ids.length < 2) return null;
  const db = getDb();
  const rows = ids
    .map((id) => db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id))
    .filter(Boolean) as Array<{ id: string; source_type: string; created_at: string }>;
  if (rows.length < 2) return null;
  rows.sort((a, b) => {
    const order: Record<string, number> = { bank: 0, card: 1, email: 2, receipt: 3 };
    return (order[a.source_type] ?? 4) - (order[b.source_type] ?? 4) || a.created_at.localeCompare(b.created_at);
  });
  const primary = rows[0]!;
  const tx = db.transaction(() => {
    db.prepare(`UPDATE transactions SET merged_into = NULL WHERE id = ?`).run(primary.id);
    for (const r of rows.slice(1)) {
      db.prepare(`UPDATE transactions SET merged_into = ? WHERE id = ?`).run(primary.id, r.id);
    }
  });
  tx();
  return primary.id;
}

export interface AlertRow {
  id: string;
  txn_a: string;
  txn_b: string;
  amount: number;
  merchant: string;
  date_a: string;
  date_b: string;
  similarity: number;
  status: string;
  created_at: string;
}

export function listAlerts(status?: string): Array<AlertRow & { a: Transaction | null; b: Transaction | null }> {
  const db = getDb();
  const rows = (
    status
      ? db.prepare(`SELECT * FROM double_charge_alerts WHERE status = ? ORDER BY created_at DESC`).all(status)
      : db.prepare(`SELECT * FROM double_charge_alerts ORDER BY created_at DESC`).all()
  ) as AlertRow[];
  const getTx = db.prepare(`SELECT * FROM transactions WHERE id = ?`);
  return rows.map((r) => ({
    ...r,
    a: (getTx.get(r.txn_a) as any) ?? null,
    b: (getTx.get(r.txn_b) as any) ?? null,
  }));
}

export function resolveAlert(id: string, status: 'confirmed' | 'dismissed'): void {
  getDb().prepare(`UPDATE double_charge_alerts SET status = ? WHERE id = ?`).run(status, id);
}

/** A pair that is certainly the same transaction (not a genuine double charge). */
function isExactDuplicate(a: Transaction | null, b: Transaction | null, similarity: number): boolean {
  if (!a || !b || a.mergedInto || b.mergedInto) return false;
  const sameAmount = Math.abs(Math.abs(a.amount) - Math.abs(b.amount)) < 0.005 && a.currency === b.currency;
  if (!sameAmount) return false;
  const sameRef = sameExternalId(a.externalId, b.externalId);
  const sameDate = a.date === b.date;
  const sameMerchant = Boolean(a.merchantNormalized) && a.merchantNormalized === b.merchantNormalized;
  // Same invoice number is conclusive; otherwise require same day + same merchant
  // (or a ~perfect fuzzy score).
  return sameRef || (sameDate && (sameMerchant || similarity >= 0.985));
}

/** How many open alerts are exact (100%) duplicates — for the merge button label. */
export function countExactDuplicates(): number {
  return listAlerts('open').filter((al) => isExactDuplicate(getTransaction(al.txn_a), getTransaction(al.txn_b), al.similarity))
    .length;
}

/**
 * Merge every open alert that is an exact (100%) duplicate — same amount, same
 * currency, and same invoice number OR same day+merchant — into one ledger
 * entry, and resolve those alerts. Genuine double charges (different day, fuzzy
 * merchant) are left untouched. Grouped via union-find so triples collapse too.
 */
export function mergeExactDuplicates(): { merged: number; groups: number } {
  const open = listAlerts('open');
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (x: string, y: string): void => {
    if (!parent.has(x)) parent.set(x, x);
    if (!parent.has(y)) parent.set(y, y);
    parent.set(find(x), find(y));
  };

  const resolvedAlerts: string[] = [];
  for (const al of open) {
    if (isExactDuplicate(getTransaction(al.txn_a), getTransaction(al.txn_b), al.similarity)) {
      union(al.txn_a, al.txn_b);
      resolvedAlerts.push(al.id);
    }
  }

  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(id);
  }

  let merged = 0;
  let groupCount = 0;
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    if (mergeManual(ids)) {
      merged += ids.length - 1;
      groupCount++;
    }
  }
  for (const id of resolvedAlerts) resolveAlert(id, 'dismissed');
  return { merged, groups: groupCount };
}
