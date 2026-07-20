import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { gmailConfigured, imapConfigured, outlookConfigured } from '../config.js';
import { getSetting, setSetting } from '../db/db.js';
import { exchangeCode, fetchAttachment as gmailFetchAttachment, getAuthUrl, gmailProvider } from '../email/gmail.js';
import * as outlook from '../email/outlook.js';
import { deleteToken, hasToken } from '../email/tokenStore.js';
import { runScan, scanAll, testConnection } from '../email/scan.js';
import { getTransaction } from '../repo/transactions.js';

export async function emailRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/email/status', async () => ({
    gmail: { configured: gmailConfigured(), connected: hasToken('gmail') },
    outlook: { configured: outlookConfigured(), connected: hasToken('outlook') },
    imap: { configured: imapConfigured() },
    settings: getSetting('email', {}),
  }));

  app.get('/api/email/settings', async () => getSetting('email', {}));

  app.put('/api/email/settings', async (req) => {
    const body = z
      .object({
        keywords: z.array(z.string()).optional(),
        senderDomains: z.array(z.string()).optional(),
        maxResults: z.number().int().min(1).max(500).optional(),
        lookbackDays: z.number().int().min(1).max(3650).optional(),
      })
      .parse(req.body);
    const current = getSetting<Record<string, unknown>>('email', {});
    const next = { ...current, ...body };
    setSetting('email', next);
    return next;
  });

  // OAuth start: returns the Google consent URL.
  app.get('/api/email/gmail/auth-url', async (_req, reply) => {
    if (!gmailConfigured()) return reply.code(400).send({ error: 'Gmail is not configured (set GMAIL_CLIENT_ID/SECRET)' });
    return { url: getAuthUrl() };
  });

  // OAuth callback: Google redirects here with ?code=...
  app.get('/api/email/gmail/callback', async (req, reply) => {
    const q = z.object({ code: z.string().optional(), error: z.string().optional() }).parse(req.query);
    if (q.error) return reply.type('text/html').send(callbackPage(`Authorization failed: ${q.error}`));
    if (!q.code) return reply.type('text/html').send(callbackPage('Missing authorization code.'));
    try {
      await exchangeCode(q.code);
      return reply.type('text/html').send(callbackPage('Gmail connected! You can close this tab and return to the app.'));
    } catch (err) {
      return reply.type('text/html').send(callbackPage(`Token exchange failed: ${(err as Error).message}`));
    }
  });

  app.post('/api/email/gmail/disconnect', async () => {
    deleteToken('gmail');
    return { ok: true };
  });

  app.get('/api/email/gmail/connected', async () => ({ connected: await gmailProvider.isConnected() }));

  // --- Outlook / Microsoft (Microsoft Graph, read-only Mail.Read) ---
  app.get('/api/email/outlook/auth-url', async (_req, reply) => {
    if (!outlookConfigured())
      return reply.code(400).send({ error: 'Outlook is not configured (set OUTLOOK_CLIENT_ID/SECRET)' });
    return { url: outlook.getAuthUrl() };
  });

  app.get('/api/email/outlook/callback', async (req, reply) => {
    const q = z.object({ code: z.string().optional(), error: z.string().optional(), error_description: z.string().optional() }).parse(req.query);
    if (q.error) return reply.type('text/html').send(callbackPage(`Authorization failed: ${q.error_description ?? q.error}`));
    if (!q.code) return reply.type('text/html').send(callbackPage('Missing authorization code.'));
    try {
      await outlook.exchangeCode(q.code);
      return reply.type('text/html').send(callbackPage('Outlook connected! You can close this tab and return to the app.'));
    } catch (err) {
      return reply.type('text/html').send(callbackPage(`Token exchange failed: ${(err as Error).message}`));
    }
  });

  app.post('/api/email/outlook/disconnect', async () => {
    deleteToken('outlook');
    return { ok: true };
  });

  // Serve an email PDF/image attachment on demand — fetched live from Gmail/
  // Outlook via the stored source ref (provider:messageId:filename). Nothing is
  // stored on disk; the file streams through the app (private, behind Tailscale).
  app.get('/api/attachments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tx = getTransaction(id);
    if (!tx || !tx.sourceRef) return reply.code(404).send({ error: 'Not found' });
    const parts = tx.sourceRef.split(':');
    if (parts.length < 3) return reply.code(404).send({ error: 'This transaction has no attachment' });
    const provider = parts[0];
    const messageId = parts[1]!;
    const filename = parts.slice(2).join(':');
    try {
      let att: { data: Buffer; mimeType: string } | null = null;
      if (provider === 'gmail') att = await gmailFetchAttachment(messageId, filename);
      else if (provider === 'outlook') att = await outlook.fetchAttachment(messageId, filename);
      else return reply.code(400).send({ error: `On-demand attachments are not supported for "${provider}"` });
      if (!att) return reply.code(404).send({ error: 'Attachment not found (the email may have been deleted or moved)' });
      reply.header('content-type', att.mimeType || 'application/octet-stream');
      reply.header('content-disposition', `inline; filename="${encodeURIComponent(filename)}"`);
      return reply.send(att.data);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Dry-run: preview matching emails without importing anything.
  app.post('/api/email/test', async (req, reply) => {
    const body = z
      .object({ provider: z.enum(['gmail', 'outlook', 'imap']).optional(), maxResults: z.number().int().min(1).max(10).optional() })
      .parse(req.body ?? {});
    try {
      return await testConnection({ providerName: body.provider, maxResults: body.maxResults });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Run a scan. With no `provider`, scans every connected account and aggregates.
  app.post('/api/email/scan', async (req, reply) => {
    const body = z
      .object({ provider: z.enum(['gmail', 'outlook', 'imap']).optional(), maxResults: z.number().int().optional() })
      .parse(req.body ?? {});
    try {
      const { runDedup } = await import('../dedup/engine.js');
      if (body.provider) {
        const result = await runScan({ providerName: body.provider, maxResults: body.maxResults });
        const dedup = runDedup();
        return { ...result, dedup };
      }
      const multi = await scanAll({ maxResults: body.maxResults });
      const dedup = runDedup();
      return { ...multi, dedup };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}

function callbackPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Email OAuth</title>
  <style>body{font-family:system-ui;padding:3rem;text-align:center;background:#0f172a;color:#e2e8f0}
  .card{max-width:420px;margin:0 auto;background:#1e293b;padding:2rem;border-radius:12px}</style></head>
  <body><div class="card"><h2>Finance Aggregator</h2><p>${message}</p></div></body></html>`;
}
