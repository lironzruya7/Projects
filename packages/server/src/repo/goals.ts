import { randomUUID } from 'node:crypto';
import { getDb, getSetting, nowIso } from '../db/db.js';
import { allPrimary } from './transactions.js';

export interface Goal {
  id: string;
  name: string;
  target_amount: number;
  currency: string;
  target_date: string | null;
  note: string | null;
  created_at: string;
}

export interface GoalWithProgress extends Goal {
  saved: number; // net cashflow (income − spend) since created_at, in base currency
  pct: number; // saved / target, 0..100
  monthlyRate: number; // avg monthly net over recent months
  etaMonths: number | null; // months to reach target at current rate (null if rate ≤ 0 or done)
  onTrack: boolean | null; // vs target_date (null if no deadline)
}

const MS_DAY = 86_400_000;

export function listGoals(): Goal[] {
  return getDb().prepare(`SELECT * FROM goals ORDER BY created_at`).all() as Goal[];
}

export function addGoal(input: {
  name: string;
  targetAmount: number;
  currency?: string;
  targetDate?: string | null;
  note?: string | null;
}): Goal {
  const goal: Goal = {
    id: randomUUID(),
    name: input.name.trim(),
    target_amount: input.targetAmount,
    currency: input.currency ?? getSetting<string>('currency', 'ILS'),
    target_date: input.targetDate?.trim() || null,
    note: input.note?.trim() || null,
    created_at: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO goals (id, name, target_amount, currency, target_date, note, created_at)
       VALUES (@id, @name, @target_amount, @currency, @target_date, @note, @created_at)`,
    )
    .run(goal);
  return goal;
}

export function deleteGoal(id: string): void {
  getDb().prepare(`DELETE FROM goals WHERE id = ?`).run(id);
}

/** Net cashflow (income − spend, transfers excluded) in `currency` between two ISO dates. */
function netBetween(fromIso: string, toIso: string, currency: string): number {
  let net = 0;
  for (const t of allPrimary()) {
    if (t.currency !== currency) continue;
    if (t.category === 'Transfers') continue;
    if (t.sourceType === 'card' && t.amount > 0) continue; // card refund, not income
    const d = t.date;
    if (d >= fromIso && d <= toIso) net += t.amount;
  }
  return Math.round(net * 100) / 100;
}

export function listGoalsWithProgress(): GoalWithProgress[] {
  const today = new Date().toISOString().slice(0, 10);
  return listGoals().map((g) => {
    const since = g.created_at.slice(0, 10);
    const saved = Math.max(0, netBetween(since, today, g.currency));
    const pct = g.target_amount > 0 ? Math.min(100, Math.round((saved / g.target_amount) * 100)) : 0;
    // Savings rate: net since goal start, prorated to a month.
    const days = Math.max(1, (Date.parse(today) - Date.parse(since)) / MS_DAY);
    const monthlyRate = Math.round((saved / days) * 30.44 * 100) / 100;
    const remaining = Math.max(0, g.target_amount - saved);
    const etaMonths = remaining <= 0 ? 0 : monthlyRate > 0 ? Math.ceil(remaining / monthlyRate) : null;
    let onTrack: boolean | null = null;
    if (g.target_date) {
      const monthsLeft = (Date.parse(g.target_date) - Date.parse(today)) / (MS_DAY * 30.44);
      onTrack = etaMonths != null && etaMonths <= Math.max(0, monthsLeft);
    }
    return { ...g, saved, pct, monthlyRate, etaMonths, onTrack };
  });
}
