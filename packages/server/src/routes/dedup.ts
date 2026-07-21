import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  countExactDuplicates,
  listAlerts,
  mergeExactDuplicates,
  mergeManual,
  resolveAlert,
  runDedup,
  unmerge,
  unmergeAll,
} from '../dedup/engine.js';
import { applySettlementCategory, buildReconciliation } from '../reconcile/reconcile.js';

export async function dedupRoutes(app: FastifyInstance): Promise<void> {
  // Run detection across the whole ledger.
  app.post('/api/dedup/run', async () => {
    const result = runDedup();
    return result;
  });

  // Credit-card reconciliation: match each bank settlement line to the itemized
  // card charges that sum to it (and ensure settlement lines are tagged Transfers).
  app.get('/api/reconcile', async () => {
    applySettlementCategory();
    return buildReconciliation();
  });

  // Rebuild from scratch: clear merges (keeps resolved alerts) then re-run.
  app.post('/api/dedup/rebuild', async () => {
    unmergeAll();
    const result = runDedup();
    return result;
  });

  app.get('/api/dedup/alerts', async (req) => {
    const q = z.object({ status: z.string().optional() }).parse(req.query);
    return { alerts: listAlerts(q.status), exactCount: countExactDuplicates() };
  });

  // One-click merge of every exact (100%) duplicate alert.
  app.post('/api/dedup/merge-exact', async () => {
    return mergeExactDuplicates();
  });

  app.post('/api/dedup/alerts/:id/resolve', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ status: z.enum(['confirmed', 'dismissed']) }).parse(req.body);
    resolveAlert(id, body.status);
    return { ok: true };
  });

  app.post('/api/dedup/merge', async (req) => {
    const body = z.object({ ids: z.array(z.string()).min(2) }).parse(req.body);
    const primary = mergeManual(body.ids);
    return { ok: Boolean(primary), primary };
  });

  app.post('/api/dedup/unmerge', async (req) => {
    const body = z.object({ id: z.string() }).parse(req.body);
    unmerge(body.id);
    return { ok: true };
  });
}
