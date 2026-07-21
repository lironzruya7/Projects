import { randomUUID } from 'node:crypto';
import { getDb, nowIso } from '../db/db.js';

export interface ImportBatch {
  id: string;
  source_type: string;
  source_provider: string | null;
  account_label: string | null;
  file_hash: string | null;
  period: string | null;
  filename: string | null;
  signature: string | null;
  row_count: number;
  note: string | null;
  created_at: string;
}

export function createBatch(input: {
  sourceType: string;
  sourceProvider?: string | null;
  accountLabel?: string | null;
  fileHash?: string | null;
  period?: string | null;
  filename?: string | null;
  signature?: string | null;
  note?: string | null;
}): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO import_batches (id, source_type, source_provider, account_label, file_hash, period, filename, signature, row_count, note, created_at)
       VALUES (@id, @source_type, @source_provider, @account_label, @file_hash, @period, @filename, @signature, 0, @note, @created_at)`,
    )
    .run({
      id,
      source_type: input.sourceType,
      source_provider: input.sourceProvider ?? null,
      account_label: input.accountLabel ?? null,
      file_hash: input.fileHash ?? null,
      period: input.period ?? null,
      filename: input.filename ?? null,
      signature: input.signature ?? null,
      note: input.note ?? null,
      created_at: nowIso(),
    });
  return id;
}

/** Find an existing batch with the same file content (duplicate upload). */
export function findBatchByHash(fileHash: string): ImportBatch | undefined {
  return getDb().prepare(`SELECT * FROM import_batches WHERE file_hash = ?`).get(fileHash) as ImportBatch | undefined;
}

/** Set a card batch's billing/spending month (YYYY-MM) and cascade to nothing else. */
export function setBatchPeriod(id: string, period: string | null): void {
  const p = period && /^\d{4}-\d{2}$/.test(period.trim()) ? period.trim() : null;
  getDb().prepare(`UPDATE import_batches SET period = ? WHERE id = ?`).run(p, id);
}

export interface DuplicateBatch {
  id: string;
  filename: string | null;
  provider: string | null;
  accountLabel: string | null;
  period: string | null;
  rowCount: number;
  total: number;
  createdAt: string;
}

/**
 * Groups of card import-batches that look like the same statement imported more
 * than once: identical file (same sha256), OR same card + month + row count +
 * total. Each group is newest-first; keep the first, the rest are the extras.
 */
export function findDuplicateBatchGroups(): DuplicateBatch[][] {
  const rows = getDb()
    .prepare(
      `SELECT b.id, b.filename, b.source_provider AS provider, b.account_label AS accountLabel,
              b.period, b.row_count AS rowCount, b.file_hash AS fileHash, b.created_at AS createdAt,
              COALESCE(SUM(ABS(t.amount)), 0) AS total
       FROM import_batches b
       LEFT JOIN transactions t ON t.import_batch = b.id
       WHERE b.source_type = 'card'
       GROUP BY b.id`,
    )
    .all() as Array<DuplicateBatch & { fileHash: string | null }>;

  const groups = new Map<string, DuplicateBatch[]>();
  for (const r of rows) {
    // Same exact file, or same card+month+shape.
    const key = r.fileHash
      ? `hash:${r.fileHash}`
      : `shape:${r.provider ?? ''}|${r.accountLabel ?? ''}|${r.period ?? ''}|${r.rowCount}|${Math.round(r.total)}`;
    if (!groups.has(key)) groups.set(key, []);
    const { fileHash: _omit, ...rest } = r;
    groups.get(key)!.push(rest);
  }

  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => g.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

export function setBatchRowCount(id: string, count: number): void {
  getDb().prepare(`UPDATE import_batches SET row_count = ? WHERE id = ?`).run(count, id);
}

/** Change a batch's card type and cascade it to all its transactions. Returns rows updated. */
export function setBatchProvider(id: string, provider: string | null): number {
  const db = getDb();
  const p = provider && provider.trim() ? provider.trim().toLowerCase() : null;
  const tx = db.transaction(() => {
    db.prepare(`UPDATE import_batches SET source_provider = ? WHERE id = ?`).run(p, id);
    return db.prepare(`UPDATE transactions SET source_provider = ? WHERE import_batch = ?`).run(p, id).changes;
  });
  return tx();
}

export function listBatches(): ImportBatch[] {
  return getDb().prepare(`SELECT * FROM import_batches ORDER BY created_at DESC`).all() as ImportBatch[];
}

export function deleteBatch(id: string): void {
  // Cascade deletes its transactions (FK ON DELETE CASCADE).
  getDb().prepare(`DELETE FROM import_batches WHERE id = ?`).run(id);
}

/** Delete every batch of a given source type ('email' | 'bank' | 'card'). Returns count. */
export function deleteBatchesBySource(sourceType: string): number {
  const info = getDb().prepare(`DELETE FROM import_batches WHERE source_type = ?`).run(sourceType);
  return info.changes;
}
