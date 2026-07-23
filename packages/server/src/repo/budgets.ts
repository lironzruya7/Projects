import { getDb, nowIso } from '../db/db.js';

export interface Budget {
  category: string;
  monthly_limit: number;
  currency: string;
  updated_at: string;
}

export function listBudgets(): Budget[] {
  return getDb().prepare(`SELECT * FROM budgets ORDER BY category`).all() as Budget[];
}

/** Set (or clear, when limit <= 0) a category's monthly budget. */
export function setBudget(category: string, monthlyLimit: number, currency = 'ILS'): void {
  const db = getDb();
  if (!Number.isFinite(monthlyLimit) || monthlyLimit <= 0) {
    db.prepare(`DELETE FROM budgets WHERE category = ?`).run(category);
    return;
  }
  db.prepare(
    `INSERT INTO budgets (category, monthly_limit, currency, updated_at)
     VALUES (@category, @limit, @currency, @updated_at)
     ON CONFLICT(category) DO UPDATE SET monthly_limit = excluded.monthly_limit,
       currency = excluded.currency, updated_at = excluded.updated_at`,
  ).run({ category, limit: monthlyLimit, currency, updated_at: nowIso() });
}

export function deleteBudget(category: string): void {
  getDb().prepare(`DELETE FROM budgets WHERE category = ?`).run(category);
}
