import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ColumnMapping, AmountMode } from '../models/types.js';
import { applyMapping, buildPreview, fingerprint } from '../parsers/fileImport.js';
import { readGrid } from '../parsers/tabular.js';
import { getMapping, listMappings, saveMapping } from '../repo/mappings.js';
import { createBatch, deleteBatch, listBatches, setBatchRowCount } from '../repo/batches.js';
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

  app.get('/api/import/batches', async () => ({ batches: listBatches() }));

  app.delete('/api/import/batches/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteBatch(id);
    const dedup = runDedup();
    return { ok: true, dedup };
  });

  app.get('/api/import/mappings', async () => ({ mappings: listMappings() }));
}
