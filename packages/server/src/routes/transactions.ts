import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getLedgerEntry, queryLedger, setCategory } from '../repo/transactions.js';
import { normalizeMerchant } from '../normalize/merchant.js';
import { upsertMerchantRule } from '../categorize/rules.js';
import { getTransaction } from '../repo/transactions.js';

const LedgerQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  category: z.string().optional(),
  sourceType: z.enum(['email', 'bank', 'card']).optional(),
  provider: z.string().optional(),
  merchant: z.string().optional(),
  search: z.string().optional(),
  uncategorizedOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
});

const RecategorizeBody = z.object({
  category: z.string().nullable(),
  applyToMerchant: z.boolean().default(false),
});

export async function transactionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/transactions', async (req) => {
    const q = LedgerQuery.parse(req.query);
    const entries = queryLedger(q);
    return { transactions: entries, count: entries.length };
  });

  app.get('/api/transactions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const entry = getLedgerEntry(id);
    if (!entry) return reply.code(404).send({ error: 'Not found' });
    return entry;
  });

  // Manually recategorize a ledger entry. Optionally create a merchant rule so
  // the choice sticks for all past/future transactions of that merchant.
  app.post('/api/transactions/:id/category', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = RecategorizeBody.parse(req.body);
    const tx = getTransaction(id);
    if (!tx) return reply.code(404).send({ error: 'Not found' });

    setCategory(id, body.category, 'manual');

    let rule = null;
    if (body.applyToMerchant && body.category) {
      const merchant = tx.merchantNormalized || normalizeMerchant(tx.merchantRaw);
      rule = upsertMerchantRule(merchant, body.category, 'user');
    }
    return { ok: true, rule };
  });
}
