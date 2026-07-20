import { getSetting } from '../db/db.js';
import { allPrimary } from '../repo/transactions.js';
import { listAlerts } from '../dedup/engine.js';
import type { SourceType, Transaction } from '../models/types.js';

const MS_DAY = 86_400_000;

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}
function isExpense(t: Transaction): boolean {
  return t.amount < 0 && t.category !== 'Transfers';
}
function isIncome(t: Transaction): boolean {
  return t.amount > 0 && t.category !== 'Transfers';
}
function mag(t: Transaction): number {
  return Math.abs(t.amount);
}

export interface DashboardFilter {
  category?: string;
  sourceType?: SourceType;
  month?: string; // YYYY-MM; overrides the auto reference month
  currency?: string; // restrict monetary aggregates to one currency
}

function applyFilter(txns: Transaction[], f: DashboardFilter): Transaction[] {
  return txns.filter((t) => {
    if (f.category && t.category !== f.category) return false;
    if (f.sourceType && t.sourceType !== f.sourceType) return false;
    return true;
  });
}

/** Current month is derived from the newest transaction in the ledger. */
function referenceMonth(txns: Transaction[]): string {
  let max = '';
  for (const t of txns) if (t.date > max) max = t.date;
  return max ? monthKey(max) : new Date().toISOString().slice(0, 7);
}

function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export interface DashboardSummary {
  currency: string;
  referenceMonth: string;
  totals: {
    thisMonth: number;
    lastMonth: number;
    threeMonthAvg: number;
    momChangePct: number | null;
  };
  categoryBreakdown: Array<{ category: string; amount: number; count: number }>;
  spendOverTime: Array<{ month: string; expense: number; income: number }>;
  topMerchants: Array<{ merchant: string; amount: number; count: number }>;
  cashFlow: Array<{ month: string; income: number; expense: number; net: number }>;
  byAccount: Array<{ provider: string | null; sourceType: string; amount: number; count: number }>;
  byCurrency: Array<{ currency: string; expense: number; income: number; count: number }>;
  activeCurrency: string;
  counts: { ledger: number; alerts: number };
  range: { min: string; max: string }; // earliest / latest month with data
}

/** Earliest and latest month present in the ledger (for the month picker). */
function monthRange(txns: Transaction[], fallback: string): { min: string; max: string } {
  let min = '';
  let max = '';
  for (const t of txns) {
    const m = monthKey(t.date);
    if (!min || m < min) min = m;
    if (!max || m > max) max = m;
  }
  return { min: min || fallback, max: max || fallback };
}

export function buildDashboard(filter: DashboardFilter = {}): DashboardSummary {
  const base = getSetting<string>('currency', 'ILS');
  // category/sourceType filtered, ALL currencies (needed for the currency center).
  const allRaw = applyFilter(allPrimary(), filter);
  // Reference month: explicit selection (if it looks valid) else the newest month.
  const ref = /^\d{4}-\d{2}$/.test(filter.month ?? '') ? filter.month! : referenceMonth(allRaw);
  const range = monthRange(allRaw, ref);

  // Currency center: totals per currency for the reference month (before we
  // narrow to one currency). Mixing currencies in a single sum is meaningless,
  // so every other figure below is scoped to a single `activeCurrency`.
  const curMap = new Map<string, { currency: string; expense: number; income: number; count: number }>();
  for (const t of allRaw.filter((t) => monthKey(t.date) === ref)) {
    const e = curMap.get(t.currency) ?? { currency: t.currency, expense: 0, income: 0, count: 0 };
    if (isExpense(t)) e.expense += mag(t);
    else if (isIncome(t)) e.income += mag(t);
    e.count++;
    curMap.set(t.currency, e);
  }
  const byCurrency = [...curMap.values()].sort((a, b) => b.expense - a.expense);
  // Active currency: explicit choice, else base if present, else the busiest one.
  const activeCurrency =
    filter.currency || (byCurrency.some((c) => c.currency === base) ? base : byCurrency[0]?.currency ?? base);

  const all = allRaw.filter((t) => t.currency === activeCurrency);
  const currency = activeCurrency;
  const lastM = addMonths(ref, -1);
  const threeAgo = addMonths(ref, -2);

  const expenses = all.filter(isExpense);

  const sumMonth = (ym: string) =>
    expenses.filter((t) => monthKey(t.date) === ym).reduce((s, t) => s + mag(t), 0);

  const thisMonth = sumMonth(ref);
  const lastMonth = sumMonth(lastM);
  const threeMonthAvg =
    [ref, lastM, threeAgo].reduce((s, m) => s + sumMonth(m), 0) / 3;
  const momChangePct = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : null;

  // Category breakdown for the reference month.
  const catMap = new Map<string, { amount: number; count: number }>();
  for (const t of expenses.filter((t) => monthKey(t.date) === ref)) {
    const key = t.category ?? 'Uncategorized';
    const e = catMap.get(key) ?? { amount: 0, count: 0 };
    e.amount += mag(t);
    e.count++;
    catMap.set(key, e);
  }
  const categoryBreakdown = [...catMap.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.amount - a.amount);

  // Spend / cash flow over the last 12 months.
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(addMonths(ref, -i));
  const spendOverTime = months.map((m) => ({
    month: m,
    expense: all.filter((t) => isExpense(t) && monthKey(t.date) === m).reduce((s, t) => s + mag(t), 0),
    income: all.filter((t) => isIncome(t) && monthKey(t.date) === m).reduce((s, t) => s + mag(t), 0),
  }));
  const cashFlow = spendOverTime.map((s) => ({
    month: s.month,
    income: s.income,
    expense: s.expense,
    net: s.income - s.expense,
  }));

  // Top merchants (reference month).
  const merchMap = new Map<string, { amount: number; count: number }>();
  for (const t of expenses.filter((t) => monthKey(t.date) === ref)) {
    const key = t.merchantNormalized || t.merchantRaw || '(unknown)';
    const e = merchMap.get(key) ?? { amount: 0, count: 0 };
    e.amount += mag(t);
    e.count++;
    merchMap.set(key, e);
  }
  const topMerchants = [...merchMap.entries()]
    .map(([merchant, v]) => ({ merchant, ...v }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // Spend by account/card for the reference month.
  const acctMap = new Map<string, { provider: string | null; sourceType: string; amount: number; count: number }>();
  for (const t of expenses.filter((t) => monthKey(t.date) === ref)) {
    const key = `${t.sourceProvider ?? ''}|${t.sourceType}`;
    const e = acctMap.get(key) ?? { provider: t.sourceProvider ?? null, sourceType: t.sourceType, amount: 0, count: 0 };
    e.amount += mag(t);
    e.count++;
    acctMap.set(key, e);
  }
  const byAccount = [...acctMap.values()].sort((a, b) => b.amount - a.amount);

  const openAlerts = listAlerts('open').length;

  return {
    currency,
    referenceMonth: ref,
    totals: { thisMonth, lastMonth, threeMonthAvg, momChangePct },
    categoryBreakdown,
    spendOverTime,
    topMerchants,
    cashFlow,
    byAccount,
    byCurrency,
    activeCurrency,
    counts: { ledger: all.length, alerts: openAlerts },
    range,
  };
}

export interface RecurringItem {
  merchant: string;
  category: string | null;
  avgAmount: number;
  currency: string;
  intervalDays: number;
  occurrences: number;
  lastDate: string;
  nextExpected: string;
  monthlyCost: number;
  annualCost: number;
}

/** Detect charges that repeat on a monthly-ish cadence with similar amounts. */
export function detectRecurring(): RecurringItem[] {
  const txns = allPrimary().filter((t) => t.amount < 0);
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of txns) {
    const key = t.merchantNormalized || t.merchantRaw;
    if (!key) continue;
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key)!.push(t);
  }

  const items: RecurringItem[] = [];
  for (const [merchant, list] of byMerchant) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const g = (Date.parse(sorted[i]!.date) - Date.parse(sorted[i - 1]!.date)) / MS_DAY;
      if (g > 0) gaps.push(g);
    }
    if (gaps.length === 0) continue;
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;

    // Monthly-ish (or weekly/quarterly) cadence with low variance.
    const regular = gaps.every((g) => Math.abs(g - avgGap) <= Math.max(7, avgGap * 0.35));
    const monthlyish = avgGap >= 20 && avgGap <= 100;
    if (!regular || !monthlyish) continue;

    const amounts = sorted.map(mag);
    const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const amountStable = amounts.every((a) => Math.abs(a - avgAmount) <= Math.max(2, avgAmount * 0.2));
    if (!amountStable) continue;

    const last = sorted[sorted.length - 1]!;
    const nextMs = Date.parse(last.date) + avgGap * MS_DAY;
    const monthlyCost = avgAmount * (30.44 / avgGap);
    items.push({
      merchant,
      category: last.category,
      avgAmount,
      currency: last.currency,
      intervalDays: Math.round(avgGap),
      occurrences: sorted.length,
      lastDate: last.date,
      nextExpected: new Date(nextMs).toISOString().slice(0, 10),
      monthlyCost,
      annualCost: monthlyCost * 12,
    });
  }
  return items.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

export interface Anomaly {
  type: 'spike' | 'new_merchant' | 'double_charge';
  transactionId?: string;
  merchant: string;
  amount: number;
  date: string;
  detail: string;
  alertId?: string;
}

/** Flag unusual charges: spikes vs a merchant's norm, brand-new merchants, double charges. */
export function detectAnomalies(): Anomaly[] {
  const cfg = getSetting<{ newMerchantWindowDays: number; spikeMultiplier: number }>('anomaly', {
    newMerchantWindowDays: 60,
    spikeMultiplier: 2.5,
  });
  const txns = allPrimary().filter((t) => t.amount < 0);
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of txns) {
    const key = t.merchantNormalized || t.merchantRaw;
    if (!key) continue;
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key)!.push(t);
  }

  const anomalies: Anomaly[] = [];

  // Reference "now" = newest transaction date.
  let newest = 0;
  for (const t of txns) newest = Math.max(newest, Date.parse(t.date));

  for (const [merchant, list] of byMerchant) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const firstSeen = Date.parse(sorted[0]!.date);

    // Brand-new merchant (first seen within the window, relative to newest data).
    if (newest - firstSeen <= cfg.newMerchantWindowDays * MS_DAY && sorted.length <= 2) {
      const t = sorted[sorted.length - 1]!;
      anomalies.push({
        type: 'new_merchant',
        transactionId: t.id,
        merchant,
        amount: mag(t),
        date: t.date,
        detail: `First-time merchant`,
      });
    }

    // Spike vs the merchant's usual spend.
    if (sorted.length >= 4) {
      const amounts = sorted.map(mag);
      const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
      for (const t of sorted) {
        if (mean > 0 && mag(t) >= mean * cfg.spikeMultiplier && mag(t) - mean > 20) {
          anomalies.push({
            type: 'spike',
            transactionId: t.id,
            merchant,
            amount: mag(t),
            date: t.date,
            detail: `${(mag(t) / mean).toFixed(1)}× the usual (~${mean.toFixed(0)})`,
          });
        }
      }
    }
  }

  // Possible double charges from the dedup engine.
  for (const a of listAlerts('open')) {
    anomalies.push({
      type: 'double_charge',
      merchant: a.merchant,
      amount: a.amount,
      date: a.date_b,
      detail: `Possible double charge on ${a.date_a} & ${a.date_b}`,
      alertId: a.id,
    });
  }

  return anomalies.sort((a, b) => b.date.localeCompare(a.date));
}
