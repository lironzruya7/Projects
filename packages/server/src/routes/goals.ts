import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addGoal, deleteGoal, listGoalsWithProgress } from '../repo/goals.js';

export async function goalsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/goals', async () => ({ goals: listGoalsWithProgress() }));

  app.post('/api/goals', async (req) => {
    const body = z
      .object({
        name: z.string().min(1),
        targetAmount: z.number().positive(),
        currency: z.string().optional(),
        targetDate: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
      })
      .parse(req.body);
    const goal = addGoal(body);
    return { goal, goals: listGoalsWithProgress() };
  });

  app.delete('/api/goals/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteGoal(id);
    return { ok: true, goals: listGoalsWithProgress() };
  });
}
