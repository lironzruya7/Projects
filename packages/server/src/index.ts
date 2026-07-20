import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
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

async function main(): Promise<void> {
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

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    app.log.error(err);
    const status = err.statusCode ?? 500;
    reply.code(status >= 400 && status < 600 ? status : 500).send({
      error: err.message ?? 'Internal error',
    });
  });

  try {
    await app.listen({ port: config.port, host: '127.0.0.1' });
    app.log.info(`Finance Aggregator API on http://127.0.0.1:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
