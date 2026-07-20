import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb, getSetting, setSetting } from '../db/db.js';
import { queryLedger } from '../repo/transactions.js';
import { DedupSettings } from '../models/types.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => ({
    currency: getSetting('currency', 'ILS'),
    dedup: getSetting('dedup', {}),
    anomaly: getSetting('anomaly', {}),
    llm: getSetting('llm', { enabled: false }),
  }));

  app.put('/api/settings/currency', async (req) => {
    const body = z.object({ currency: z.string().min(1) }).parse(req.body);
    setSetting('currency', body.currency);
    return { currency: body.currency };
  });

  app.put('/api/settings/dedup', async (req) => {
    const body = DedupSettings.partial().parse(req.body);
    const current = getSetting('dedup', {});
    const next = { ...(current as object), ...body };
    setSetting('dedup', next);
    return next;
  });

  app.put('/api/settings/anomaly', async (req) => {
    const body = z
      .object({ newMerchantWindowDays: z.number().optional(), spikeMultiplier: z.number().optional() })
      .parse(req.body);
    const current = getSetting('anomaly', {});
    const next = { ...(current as object), ...body };
    setSetting('anomaly', next);
    return next;
  });

  // --- Data export ---
  app.get('/api/export/json', async (_req, reply) => {
    const entries = queryLedger({ limit: 100000 });
    reply.header('content-disposition', 'attachment; filename="finance-export.json"');
    reply.type('application/json');
    return { exportedAt: new Date().toISOString(), count: entries.length, transactions: entries };
  });

  app.get('/api/export/csv', async (_req, reply) => {
    const entries = queryLedger({ limit: 100000 });
    const header = [
      'id', 'date', 'amount', 'currency', 'merchant_normalized', 'merchant_raw',
      'description', 'category', 'source_type', 'source_provider', 'source_count', 'sources',
    ];
    const rows = entries.map((e) =>
      [
        e.id,
        e.date,
        e.amount,
        e.currency,
        e.merchantNormalized,
        e.merchantRaw,
        e.description,
        e.category ?? '',
        e.sourceType,
        e.sourceProvider ?? '',
        e.sourceCount,
        e.sourceTypes.join('+'),
      ]
        .map(csvCell)
        .join(','),
    );
    reply.header('content-disposition', 'attachment; filename="finance-export.csv"');
    reply.type('text/csv; charset=utf-8');
    return '﻿' + [header.join(','), ...rows].join('\n');
  });

  // --- Wipe all data ---
  app.post('/api/wipe', async (req) => {
    const body = z.object({ confirm: z.literal('DELETE') }).parse(req.body);
    void body;
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM double_charge_alerts').run();
      db.prepare('DELETE FROM transactions').run();
      db.prepare('DELETE FROM import_batches').run();
      db.prepare('DELETE FROM column_mappings').run();
      db.prepare('DELETE FROM oauth_tokens').run();
      // Keep built-in categories; remove user rules + custom categories.
      db.prepare('DELETE FROM category_rules').run();
      db.prepare('DELETE FROM categories WHERE is_builtin = 0').run();
    });
    tx();
    return { ok: true };
  });
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
