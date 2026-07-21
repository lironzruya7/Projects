import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb, getSetting, setSetting } from '../db/db.js';
import { queryLedger } from '../repo/transactions.js';
import { DedupSettings } from '../models/types.js';
import { buildReport, renderReportHtml, renderReportMarkdown } from '../insights/report.js';

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

  // Names on incoming salary transfers, so they get tagged as Income.
  app.put('/api/settings/salary', async (req) => {
    const body = z.object({ payers: z.array(z.string()) }).parse(req.body);
    const payers = body.payers.map((p) => p.trim()).filter(Boolean);
    setSetting('salary', { payers });
    const { applySalaryCategory } = await import('../reconcile/reconcile.js');
    const tagged = applySalaryCategory();
    return { payers, tagged };
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
  // Full month-by-month financial report (dashboard + income/expenses + recurring
  // + recommendations + transactions). Markdown is ideal to hand to another AI;
  // HTML and PDF are the tidy human/printable versions.
  app.get('/api/export/report.md', async (_req, reply) => {
    const report = buildReport(new Date().toISOString().slice(0, 10));
    reply.header('content-disposition', 'attachment; filename="finance-report.md"');
    reply.type('text/markdown; charset=utf-8');
    return renderReportMarkdown(report);
  });

  app.get('/api/export/report.html', async (_req, reply) => {
    const report = buildReport(new Date().toISOString().slice(0, 10));
    reply.type('text/html; charset=utf-8');
    return renderReportHtml(report);
  });

  app.get('/api/export/report.pdf', async (_req, reply) => {
    const report = buildReport(new Date().toISOString().slice(0, 10));
    const html = renderReportHtml(report);
    try {
      const { htmlToPdf } = await import('../insights/reportPdf.js');
      const pdf = await htmlToPdf(html);
      reply.header('content-disposition', `attachment; filename="finance-report-${report.range.min}_${report.range.max}.pdf"`);
      reply.type('application/pdf');
      return reply.send(pdf);
    } catch (err) {
      // Chromium unavailable — fall back to the HTML the browser can print to PDF.
      reply.code(503).type('application/json');
      return { error: `PDF rendering failed (${(err as Error).message}). Use the HTML/Markdown report instead.` };
    }
  });

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
    const { wipeAttachments } = await import('../repo/attachments.js');
    wipeAttachments();
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
