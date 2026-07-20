import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { config } from './config.js';
import { getDb } from './db/db.js';
import { importRoutes } from './routes/import.js';
import { transactionRoutes } from './routes/transactions.js';
import { categoryRoutes } from './routes/categories.js';
import { dedupRoutes } from './routes/dedup.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { emailRoutes } from './routes/email.js';
import { llmRoutes } from './routes/llm.js';
import { settingsRoutes } from './routes/settings.js';
import { attachmentRoutes } from './routes/attachments.js';
import { scrapeRoutes } from './routes/scrape.js';

async function main(): Promise<void> {
  // Safety net: some libraries (tesseract.js OCR) can throw asynchronously from
  // a worker in a way per-call try/catch can't catch. For a local single-user
  // app, log and keep serving rather than letting one bad receipt crash it.
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err instanceof Error ? err.message : err);
  });
  process.on('unhandledRejection', (err) => {
    console.error('[unhandledRejection]', err instanceof Error ? err.message : err);
  });

  // Initialize DB (creates file + schema + seed) before serving.
  getDb();

  const app = Fastify({ logger: { level: 'info', transport: undefined } });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  app.get('/api/health', async () => ({ ok: true, currency: config.defaultCurrency }));

  await app.register(importRoutes);
  await app.register(transactionRoutes);
  await app.register(categoryRoutes);
  await app.register(dedupRoutes);
  await app.register(dashboardRoutes);
  await app.register(emailRoutes);
  await app.register(llmRoutes);
  await app.register(settingsRoutes);
  await app.register(attachmentRoutes);
  await app.register(scrapeRoutes);

  // Production: serve the built frontend from this same origin, so there is a
  // single port to expose (e.g. over Tailscale). Falls back to index.html for
  // client-side routes (SPA). In dev, Vite serves the frontend instead.
  const hasBuiltFrontend = existsSync(join(config.webDist, 'index.html'));
  if (config.production || hasBuiltFrontend) {
    if (!hasBuiltFrontend) {
      app.log.warn(`NODE_ENV=production but no built frontend at ${config.webDist}. Run "npm run build" first.`);
    } else {
      await app.register(fastifyStatic, { root: config.webDist, prefix: '/' });
      app.setNotFoundHandler((req, reply) => {
        // Unknown API routes -> 404 JSON; everything else -> SPA index.
        if (req.url.startsWith('/api/')) {
          reply.code(404).send({ error: 'Not found' });
          return;
        }
        reply.sendFile('index.html');
      });
      app.log.info(`Serving frontend from ${config.webDist}`);
    }
  }

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    app.log.error(err);
    const status = err.statusCode ?? 500;
    reply.code(status >= 400 && status < 600 ? status : 500).send({
      error: err.message ?? 'Internal error',
    });
  });

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`Finance Aggregator on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
