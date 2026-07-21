import { randomUUID } from 'node:crypto';
import { getDb, nowIso } from '../db/db.js';

export interface ImportBatch {
  id: string;
  source_type: string;
  source_provider: string | null;
  account_label: string | null;
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
  filename?: string | null;
  signature?: string | null;
  note?: string | null;
}): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO import_batches (id, source_type, source_provider, account_label, filename, signature, row_count, note, created_at)
       VALUES (@id, @source_type, @source_provider, @account_label, @filename, @signature, 0, @note, @created_at)`,
    )
    .run({
      id,
      source_type: input.sourceType,
      source_provider: input.sourceProvider ?? null,
      account_label: input.accountLabel ?? null,
      filename: input.filename ?? null,
      signature: input.signature ?? null,
      note: input.note ?? null,
      created_at: nowIso(),
    });
  return id;
}

export function setBatchRowCount(id: string, count: number): void {
  getDb().prepare(`UPDATE import_batches SET row_count = ? WHERE id = ?`).run(count, id);
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
