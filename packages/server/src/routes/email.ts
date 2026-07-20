import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { gmailConfigured, imapConfigured } from '../config.js';
import { getSetting, setSetting } from '../db/db.js';
import { exchangeCode, getAuthUrl, gmailProvider } from '../email/gmail.js';
import { deleteToken, hasToken } from '../email/tokenStore.js';
import { runScan } from '../email/scan.js';

export async function emailRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/email/status', async () => ({
    gmail: { configured: gmailConfigured(), connected: hasToken('gmail') },
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

  // Run a scan.
  app.post('/api/email/scan', async (req, reply) => {
    const body = z
      .object({ provider: z.enum(['gmail', 'imap']).optional(), maxResults: z.number().int().optional() })
      .parse(req.body ?? {});
    try {
      const result = await runScan({ providerName: body.provider, maxResults: body.maxResults });
      const { runDedup } = await import('../dedup/engine.js');
      const dedup = runDedup();
      return { ...result, dedup };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}

function callbackPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Gmail OAuth</title>
  <style>body{font-family:system-ui;padding:3rem;text-align:center;background:#0f172a;color:#e2e8f0}
  .card{max-width:420px;margin:0 auto;background:#1e293b;padding:2rem;border-radius:12px}</style></head>
  <body><div class="card"><h2>Finance Aggregator</h2><p>${message}</p></div></body></html>`;
}
