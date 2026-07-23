import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SCRAPE_PROVIDERS, getProviderSpec } from '../scrape/providers.js';
import { deleteCredentials, hasCredentials, runScrape, saveCredentials } from '../scrape/scraper.js';
import { config } from '../config.js';

export async function scrapeRoutes(app: FastifyInstance): Promise<void> {
  // List supported providers, their credential fields, and whether creds are saved.
  app.get('/api/scrape/providers', async () => ({
    encryptedAtRest: Boolean(config.tokenEncryptionKey),
    providers: SCRAPE_PROVIDERS.map((p) => ({
      key: p.key,
      label: p.label,
      sourceType: p.sourceType,
      fields: p.fields,
      connected: hasCredentials(p.key),
    })),
  }));

  // Save credentials for a provider (stored encrypted at rest when a key is set).
  app.post('/api/scrape/credentials', async (req, reply) => {
    const body = z
      .object({ provider: z.string(), credentials: z.record(z.string()) })
      .parse(req.body);
    const spec = getProviderSpec(body.provider);
    if (!spec) return reply.code(400).send({ error: 'Unknown provider' });
    const missing = spec.fields.filter((f) => !body.credentials[f.key]?.trim()).map((f) => f.label);
    if (missing.length) return reply.code(400).send({ error: `Missing: ${missing.join(', ')}` });
    saveCredentials(body.provider, body.credentials);
    return { ok: true };
  });

  app.delete('/api/scrape/credentials/:provider', async (req) => {
    const { provider } = req.params as { provider: string };
    deleteCredentials(provider);
    return { ok: true };
  });

  // Run a direct sync for one provider.
  app.post('/api/scrape/run', async (req, reply) => {
    const body = z.object({ provider: z.string(), months: z.number().int().min(1).max(24).optional() }).parse(req.body);
    try {
      const result = await runScrape(body.provider, { months: body.months });
      const { notifyNewLargeCharges } = await import('../notify/notify.js');
      void notifyNewLargeCharges().catch(() => {});
      return result;
    } catch (err) {
      // Point the client at the failure screenshot so we can see what happened.
      return reply.code(400).send({ error: (err as Error).message, debugShot: `/api/scrape/debug/${body.provider}` });
    }
  });

  // Serve the last failure screenshot for a provider (debug).
  app.get('/api/scrape/debug/:provider', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (!getProviderSpec(provider)) return reply.code(404).send({ error: 'Unknown provider' });
    try {
      const buf = readFileSync(join(config.scrapeDebugDir, `${provider}.png`));
      reply.header('content-type', 'image/png');
      return reply.send(buf);
    } catch {
      return reply.code(404).send({ error: 'No debug screenshot yet' });
    }
  });
}
