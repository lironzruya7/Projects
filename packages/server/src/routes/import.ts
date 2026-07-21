import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ColumnMapping, AmountMode } from '../models/types.js';
import { applyMapping, buildPreview, fingerprint } from '../parsers/fileImport.js';
import { autoParseFile } from '../parsers/autoImport.js';
import { readGrid } from '../parsers/tabular.js';
import { getMapping, listMappings, saveMapping } from '../repo/mappings.js';
import { createBatch, deleteBatch, deleteBatchesBySource, listBatches, setBatchRowCount } from '../repo/batches.js';
import { insertParsed } from '../repo/transactions.js';
import { runDedup } from '../dedup/engine.js';
import { getUpload, putUpload } from '../util/uploadCache.js';

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
    for await (const part of req.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'label') pendingLabel = String(part.value ?? '').trim() || null;
        continue;
      }
      const file = part;
      const buf = await file.toBuffer();
      const label = pendingLabel;
      pendingLabel = null;
      try {
        const r = await autoParseFile(buf, file.filename, sourceType, label);
        let imported = 0;
        if (r.parsed.length > 0) {
          const batchId = createBatch({
            sourceType,
            sourceProvider: r.provider,
            accountLabel: r.accountLabel,
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
    return { results, dedup };
  });

  app.get('/api/import/batches', async () => ({ batches: listBatches() }));

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
