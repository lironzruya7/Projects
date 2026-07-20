import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { anthropicConfigured } from '../config.js';
import { getSetting, setSetting } from '../db/db.js';
import { classifyMerchants, llmEnabled } from '../categorize/llm.js';
import { recategorizeAll, uncategorizedMerchants } from '../repo/transactions.js';

export async function llmRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/llm/status', async () => ({
    configured: anthropicConfigured(),
    enabled: getSetting<{ enabled: boolean }>('llm', { enabled: false }).enabled,
    note: 'When enabled, only normalized merchant names are sent to the Anthropic API — never amounts or statements.',
  }));

  app.put('/api/llm/settings', async (req) => {
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    setSetting('llm', { enabled: body.enabled });
    return { enabled: body.enabled };
  });

  // Classify all currently-uncategorized merchants via the LLM, caching each as a rule.
  app.post('/api/llm/categorize', async (req, reply) => {
    if (!llmEnabled()) {
      return reply.code(400).send({ error: 'LLM categorization is disabled or ANTHROPIC_API_KEY is missing' });
    }
    const merchants = uncategorizedMerchants();
    if (merchants.length === 0) return { classified: {}, count: 0, recategorized: 0 };
    try {
      // Batch to keep prompts small.
      const classified: Record<string, string> = {};
      for (let i = 0; i < merchants.length; i += 40) {
        const batch = merchants.slice(i, i + 40);
        Object.assign(classified, await classifyMerchants(batch));
      }
      const recategorized = recategorizeAll();
      return { classified, count: Object.keys(classified).length, recategorized };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}
