import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ColumnMapping, AmountMode } from '../models/types.js';
import { applyMapping, buildPreview, fingerprint } from '../parsers/fileImport.js';
import { autoParseFile } from '../parsers/autoImport.js';
import { readGrid } from '../parsers/tabular.js';
import { getMapping, listMappings, saveMapping } from '../repo/mappings.js';
import { createHash } from 'node:crypto';
import { createBatch, deleteBatch, deleteBatchesBySource, findBatchByHash, findDuplicateBatchGroups, listBatches, setBatchAccountLabel, setBatchPeriod, setBatchProvider, setBatchRowCount } from '../repo/batches.js';
import { insertParsed } from '../repo/transactions.js';
import { runDedup } from '../dedup/engine.js';
import { getUpload, putUpload } from '../util/uploadCache.js';
import { notifyNewLargeCharges } from '../notify/notify.js';

const CommitBody = z.object({
  uploadId: z.string(),
  mapping: ColumnMapping,
  amountMode: AmountMode,
  dateFormat: z.string().nullable().optional(),
  headerRow: z.number().int().min(0).default(0),
  provider: z.string().nullable().optional(),
  sourceType: z.enum(['bank', 'card']),
  saveMapping: z.boolean().default(true),
  label: z.string().nullable().optional(),
  signature: z.string().optional(),
});

export async function importRoutes(app: FastifyInstance): Promise<void> {
  // Step 1: upload a file, get a preview + suggested mapping.
  app.post('/api/import/preview', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file uploaded' });
    const buffer = await file.toBuffer();
    const filename = file.filename;
    const preview = buildPreview(buffer, filename);
    const uploadId = putUpload(filename, buffer);
    const remembered = getMapping(preview.signature);
    return { uploadId, filename, preview, remembered };
  });

  // Step 2: commit with a chosen mapping.
  app.post('/api/import/commit', async (req, reply) => {
    const body = CommitBody.parse(req.body);
    const upload = getUpload(body.uploadId);
    if (!upload) return reply.code(410).send({ error: 'Upload expired; please re-upload the file' });

    const result = applyMapping(upload.buffer, upload.filename, {
      mapping: body.mapping,
      amountMode: body.amountMode,
      dateFormat: body.dateFormat ?? 'auto',
      headerRow: body.headerRow,
      provider: body.provider ?? null,
      sourceType: body.sourceType,
    });

    const batchId = createBatch({
      sourceType: body.sourceType,
      sourceProvider: body.provider ?? null,
      filename: upload.filename,
      signature: null,
      note: `Imported ${result.parsed.length} rows`,
    });
    const ids = insertParsed(result.parsed, batchId);
    setBatchRowCount(batchId, ids.length);

    if (body.saveMapping) {
      const grid = readGrid(upload.buffer, upload.filename);
      const header = (grid.rows[body.headerRow] ?? []).map((h) => h.trim());
      saveMapping({
        signature: body.signature ?? fingerprint(header),
        provider: body.provider ?? null,
        sourceType: body.sourceType,
        mapping: body.mapping,
        dateFormat: body.dateFormat ?? null,
        amountMode: body.amountMode,
        headerRow: body.headerRow,
        label: body.label ?? upload.filename,
      });
    }

    const dedup = runDedup();
    void notifyNewLargeCharges().catch(() => {});
    return {
      imported: ids.length,
      skipped: result.skipped,
      skippedCount: result.skipped.length,
      dedup,
      batchId,
    };
  });

  // Multi-file auto import: upload several card/bank statements at once
  // (CSV/XLSX/PDF). Each is parsed without a mapping step where possible.
  app.post('/api/import/auto', async (req) => {
    const sourceType = (req.query as { sourceType?: string }).sourceType === 'bank' ? 'bank' : 'card';
    const results: Array<Record<string, unknown>> = [];
    // Parts arrive in submit order. The client sends, per file, a `label` field
    // immediately before its `file`, so we carry the latest label onto the next
    // file (blank => the parser auto-detects a card last-4).
    let pendingLabel: string | null = null;
    let pendingProvider: string | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'label') pendingLabel = String(part.value ?? '').trim() || null;
        if (part.fieldname === 'provider') pendingProvider = String(part.value ?? '').trim() || null;
        continue;
      }
      const file = part;
      const buf = await file.toBuffer();
      const label = pendingLabel;
      const providerOverride = pendingProvider;
      pendingLabel = null;
      pendingProvider = null;
      try {
        // Duplicate-upload guard: the exact same file was already imported.
        const fileHash = createHash('sha256').update(buf).digest('hex');
        const existing = findBatchByHash(fileHash);
        if (existing) {
          results.push({
            filename: file.filename,
            duplicate: true,
            imported: 0,
            detail: `Already imported${existing.filename ? ` as "${existing.filename}"` : ''}${existing.period ? ` (${existing.period})` : ''} — skipped.`,
          });
          continue;
        }
        const r = await autoParseFile(buf, file.filename, sourceType, label, providerOverride);
        let imported = 0;
        let period: string | null = null;
        if (r.parsed.length > 0) {
          period = dominantMonth(r.parsed.map((p) => p.date));
          const batchId = createBatch({
            sourceType,
            sourceProvider: r.provider,
            accountLabel: r.accountLabel,
            fileHash,
            period,
            filename: file.filename,
            note: `Auto import (${r.format})`,
          });
          const ids = insertParsed(r.parsed, batchId);
          setBatchRowCount(batchId, ids.length);
          imported = ids.length;
        }
        results.push({
          filename: file.filename,
          format: r.format,
          provider: r.provider,
          accountLabel: r.accountLabel,
          period,
          imported,
          skipped: r.skipped,
          needsManual: r.needsManual,
          detail: r.detail ?? null,
        });
      } catch (err) {
        results.push({ filename: file.filename, error: (err as Error).message });
      }
    }
    const dedup = runDedup();
    void notifyNewLargeCharges().catch(() => {});
    return { results, dedup };
  });

  app.get('/api/import/batches', async () => ({ batches: listBatches() }));

  // Scan already-imported card files for duplicates (same file, or same card +
  // month + shape). Returns groups newest-first (keep the first, drop the rest).
  app.get('/api/import/duplicates', async () => ({ groups: findDuplicateBatchGroups() }));

  // Delete the redundant copies, keeping the oldest in each duplicate group.
  app.post('/api/import/duplicates/clean', async () => {
    const groups = findDuplicateBatchGroups();
    let deleted = 0;
    for (const g of groups) {
      // g is newest-first; keep the oldest (last), delete the rest.
      for (const b of g.slice(0, -1)) {
        deleteBatch(b.id);
        deleted++;
      }
    }
    const dedup = runDedup();
    return { ok: true, deleted, dedup };
  });

  // Relabel a batch's card type (e.g. a Diners card that imported as Cal).
  app.put('/api/import/batches/:id/provider', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ provider: z.string() }).parse(req.body);
    const updated = setBatchProvider(id, body.provider);
    return { ok: true, updated };
  });

  // Set which billing month a card file belongs to (YYYY-MM), when auto-detection got it wrong.
  app.put('/api/import/batches/:id/period', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ period: z.string() }).parse(req.body);
    setBatchPeriod(id, body.period);
    return { ok: true };
  });

  // Fix a card's last-4 tag (e.g. a mis-detected "235" -> "3235"), cascading to its rows.
  app.put('/api/import/batches/:id/label', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ label: z.string() }).parse(req.body);
    const updated = setBatchAccountLabel(id, body.label);
    return { ok: true, updated };
  });

  app.delete('/api/import/batches/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteBatch(id);
    const dedup = runDedup();
    return { ok: true, dedup };
  });

  // Bulk-clear all imports of one source type (e.g. every email scan).
  app.post('/api/import/clear', async (req) => {
    const body = z.object({ sourceType: z.enum(['email', 'bank', 'card']) }).parse(req.body);
    const deleted = deleteBatchesBySource(body.sourceType);
    const dedup = runDedup();
    return { ok: true, deleted, dedup };
  });

  app.get('/api/import/mappings', async () => ({ mappings: listMappings() }));
}

/** Most common YYYY-MM among a set of ISO dates (the file's dominant month). */
function dominantMonth(dates: string[]): string | null {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const m = (d ?? '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m)) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = -1;
  for (const [m, c] of counts) if (c > n) { n = c; best = m; }
  return best;
}
