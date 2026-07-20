import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { deleteAttachment, getAttachment, listAttachments, saveAttachment } from '../repo/attachments.js';
import { getTransaction } from '../repo/transactions.js';

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  // Upload a receipt photo/PDF for a transaction (multipart).
  app.post('/api/transactions/:id/attachments', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getTransaction(id)) return reply.code(404).send({ error: 'Transaction not found' });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file uploaded' });
    const data = await file.toBuffer();
    if (data.length === 0) return reply.code(400).send({ error: 'Empty file' });
    const att = saveAttachment({
      transactionId: id,
      filename: file.filename,
      mimeType: file.mimetype,
      data,
    });
    return { id: att.id, filename: att.filename, mimeType: att.mime_type, size: att.size };
  });

  // List a transaction's manual receipts (metadata only).
  app.get('/api/transactions/:id/attachments', async (req) => {
    const { id } = req.params as { id: string };
    const rows = listAttachments(id).map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mime_type,
      size: a.size,
      createdAt: a.created_at,
    }));
    return { attachments: rows };
  });

  // Stream a stored receipt file (inline, so images/PDFs open in the browser).
  app.get('/api/attachments/file/:attId', async (req, reply) => {
    const { attId } = req.params as { attId: string };
    const att = getAttachment(attId);
    if (!att) return reply.code(404).send({ error: 'Not found' });
    try {
      const buf = readFileSync(att.path);
      reply.header('content-type', att.mime_type || 'application/octet-stream');
      reply.header('content-disposition', `inline; filename="${encodeURIComponent(att.filename)}"`);
      return reply.send(buf);
    } catch {
      return reply.code(410).send({ error: 'File is no longer available' });
    }
  });

  app.delete('/api/attachments/:attId', async (req) => {
    const { attId } = req.params as { attId: string };
    deleteAttachment(attId);
    return { ok: true };
  });
}
