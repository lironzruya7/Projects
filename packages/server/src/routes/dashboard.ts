import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildDashboard, detectAnomalies, detectRecurring } from '../insights/insights.js';
import { distinctMerchants, listAccounts, listCurrencies } from '../repo/transactions.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dashboard', async (req) => {
    const q = z
      .object({
        category: z.string().optional(),
        sourceType: z.enum(['email', 'bank', 'card', 'receipt']).optional(),
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        currency: z.string().optional(),
      })
      .parse(req.query);
    return buildDashboard(q);
  });

  app.get('/api/insights/recurring', async () => ({ recurring: detectRecurring() }));

  app.get('/api/insights/anomalies', async () => ({ anomalies: detectAnomalies() }));

  app.get('/api/insights/merchants', async () => ({ merchants: distinctMerchants() }));

  app.get('/api/accounts', async () => ({ accounts: listAccounts() }));

  app.get('/api/currencies', async () => ({ currencies: listCurrencies() }));
}
