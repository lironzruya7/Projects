import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  addCategory,
  deleteCategory,
  listCategories,
  renameCategory,
  setCategoryColor,
} from '../repo/categories.js';
import {
  addRule,
  deleteRule,
  loadRules,
} from '../categorize/rules.js';
import { recategorizeAll } from '../repo/transactions.js';

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/categories', async () => ({ categories: listCategories() }));

  app.post('/api/categories', async (req) => {
    const body = z.object({ name: z.string().min(1), color: z.string().optional() }).parse(req.body);
    addCategory(body.name, body.color);
    return { ok: true };
  });

  app.patch('/api/categories/:name', async (req) => {
    const { name } = req.params as { name: string };
    const body = z.object({ newName: z.string().optional(), color: z.string().optional() }).parse(req.body);
    if (body.newName && body.newName !== name) renameCategory(name, body.newName);
    if (body.color) setCategoryColor(body.newName ?? name, body.color);
    return { ok: true };
  });

  app.delete('/api/categories/:name', async (req) => {
    const { name } = req.params as { name: string };
    deleteCategory(name);
    return { ok: true };
  });

  // --- Rules ---
  app.get('/api/rules', async () => ({ rules: loadRules() }));

  app.post('/api/rules', async (req) => {
    const body = z
      .object({
        pattern: z.string().min(1),
        category: z.string().min(1),
        matchType: z.enum(['exact', 'contains', 'regex']).optional(),
        priority: z.number().optional(),
      })
      .parse(req.body);
    const rule = addRule({ ...body, source: 'user' });
    const changed = recategorizeAll();
    return { rule, recategorized: changed };
  });

  app.delete('/api/rules/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteRule(id);
    const changed = recategorizeAll();
    return { ok: true, recategorized: changed };
  });

  app.post('/api/rules/recategorize', async () => {
    const changed = recategorizeAll();
    return { recategorized: changed };
  });
}
