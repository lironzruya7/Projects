import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { config } from '../config.js';
import { getDb, nowIso } from '../db/db.js';

export interface Attachment {
  id: string;
  transaction_id: string | null;
  filename: string;
  mime_type: string;
  size: number;
  path: string;
  created_at: string;
}

const SAFE_EXT = /^\.[a-z0-9]{1,5}$/i;

/** Save a receipt file to disk and record it against a transaction. */
export function saveAttachment(input: {
  transactionId: string;
  filename: string;
  mimeType: string;
  data: Buffer;
}): Attachment {
  mkdirSync(config.attachmentsDir, { recursive: true });
  const id = randomUUID();
  const ext = SAFE_EXT.test(extname(input.filename)) ? extname(input.filename).toLowerCase() : guessExt(input.mimeType);
  const path = join(config.attachmentsDir, `${id}${ext}`);
  writeFileSync(path, input.data);

  const row: Attachment = {
    id,
    transaction_id: input.transactionId,
    filename: input.filename || `receipt${ext}`,
    mime_type: input.mimeType || 'application/octet-stream',
    size: input.data.length,
    path,
    created_at: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO attachments (id, transaction_id, filename, mime_type, size, path, created_at)
       VALUES (@id, @transaction_id, @filename, @mime_type, @size, @path, @created_at)`,
    )
    .run(row);
  return row;
}

function guessExt(mime: string): string {
  if (/jpe?g/i.test(mime)) return '.jpg';
  if (/png/i.test(mime)) return '.png';
  if (/heic/i.test(mime)) return '.heic';
  if (/webp/i.test(mime)) return '.webp';
  if (/pdf/i.test(mime)) return '.pdf';
  return '.bin';
}

export function listAttachments(transactionId: string): Attachment[] {
  return getDb()
    .prepare(`SELECT * FROM attachments WHERE transaction_id = ? ORDER BY created_at DESC`)
    .all(transactionId) as Attachment[];
}

export function getAttachment(id: string): Attachment | null {
  return (getDb().prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as Attachment | undefined) ?? null;
}

export function deleteAttachment(id: string): void {
  const att = getAttachment(id);
  if (!att) return;
  try {
    rmSync(att.path, { force: true });
  } catch {
    /* file may already be gone */
  }
  getDb().prepare(`DELETE FROM attachments WHERE id = ?`).run(id);
}

/** Delete all attachment files + rows (used by wipe). */
export function wipeAttachments(): void {
  try {
    rmSync(config.attachmentsDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  getDb().prepare(`DELETE FROM attachments`).run();
}
