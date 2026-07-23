import { getSetting } from '../db/db.js';
import { allPrimary } from '../repo/transactions.js';
import { listAlerts } from '../dedup/engine.js';
import { getBankBalances } from '../repo/balances.js';
import type { SourceType, Transaction } from '../models/types.js';

const MS_DAY = 86_400_000;

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Accounting month for a transaction. Salaries are paid on the 1st but can slip
 * a day or two around holidays/weekends — a salary in the last two days of a
 * month (e.g. 30/06) belongs to the next month (01/07). Everything else uses its
 * own calendar month.
 */
function effectiveMonth(t: Transaction): string {
  if (t.category === 'Salary' && t.amount > 0) {
    const d = new Date(t.date + 'T00:00:00Z');
    if (!Number.isNaN(d.getTime())) {
      const day = d.getUTCDate();
      const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      if (day >= daysInMonth - 1) return addMonths(monthKey(t.date), 1);
    }
  }
  return monthKey(t.date);
}
function isExpense(t: Transaction): boolean {
  return t.amount < 0 && t.category !== 'Transfers';
}
function isIncome(t: Transaction): boolean {
  // A positive card amount is a refund/credit, not income — don't count it.
  // Real income comes in via the bank (salary, deposits). Transfers are excluded.
  return t.amount > 0 && t.category !== 'Transfers' && t.sourceType !== 'card';
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
  income: { total: number; salary: number; other: number };
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
  byAccount: Array<{ provider: string | null; accountLabel: string | null; sourceType: string; amount: number; count: number }>;
  byCurrency: Array<{ currency: string; expense: number; income: number; count: number }>;
  activeCurrency: string;
  counts: { ledger: number; alerts: number };
  range: { min: string; max: string }; // earliest / latest month with data
  forecast: Forecast;
}

export interface Forecast {
  currency: string;
  month: string; // current calendar month (YYYY-MM)
  hasBalance: boolean;
  currentBalance: number | null; // latest bank-reported balance (sum), null if never synced
  asOf: string | null; // when that balance was captured
  monthToDate: { spend: number; income: number };
  typical: { spend: number; income: number }; // 3-month average (full months)
  expectedRemaining: { spend: number; income: number };
  projectedNet: number; // projected income − spend for the whole month
  projectedEndBalance: number | null; // current balance + projected remaining net
  daysLeftInMonth: number;
  remainingBills: number; // known recurring charges still due before month-end
  safeToSpendTotal: number; // discretionary money left for the rest of the month
  safeToSpendPerDay: number; // that, divided across the remaining days
  // Monte Carlo band on month-end NET (income − spend), from the spread of recent
  // monthly spend. null if there isn't enough history to model the variance.
  simulation: { p10: number; p50: number; p90: number; probNegativePct: number } | null;
}

// Small deterministic PRNG so the band is stable within a month (no jitter on
// refresh) yet varies month to month.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFromMonth(ym: string): number {
  let h = 2166136261;
  for (let i = 0; i < ym.length; i++) h = Math.imul(h ^ ym.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** One standard-normal sample (Box–Muller) from a [0,1) rng. */
function gaussian(rng: () => number, mean: number, sd: number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Current bank balance + a month-end forecast. The forecast assumes the current
 * month plays out like a typical (3-month-average) month: expected remaining
 * spend/income is what's left of a typical month after month-to-date activity.
 * Recomputed on every dashboard load, so it tracks each new transaction.
 */
export function buildForecast(base: string): Forecast {
  const month = new Date().toISOString().slice(0, 7);
  const txns = allPrimary().filter((t) => t.currency === base);

  const spendIn = (ym: string): number =>
    txns.filter((t) => isExpense(t) && monthKey(t.date) === ym).reduce((s, t) => s + mag(t), 0);
  const incomeIn = (ym: string): number =>
    txns.filter((t) => isIncome(t) && effectiveMonth(t) === ym).reduce((s, t) => s + mag(t), 0);

  const mtdSpend = spendIn(month);
  const mtdIncome = incomeIn(month);

  // Typical = average of the three full months before the current one.
  const prev = [addMonths(month, -1), addMonths(month, -2), addMonths(month, -3)];
  const typicalSpend = prev.reduce((s, m) => s + spendIn(m), 0) / prev.length;
  const typicalIncome = prev.reduce((s, m) => s + incomeIn(m), 0) / prev.length;

  const restSpend = Math.max(0, typicalSpend - mtdSpend);
  const restIncome = Math.max(0, typicalIncome - mtdIncome);
  const projectedNet = mtdIncome + restIncome - (mtdSpend + restSpend);

  const balances = getBankBalances().filter((b) => b.currency === base);
  const hasBalance = balances.length > 0;
  const currentBalance = hasBalance ? balances.reduce((s, b) => s + b.balance, 0) : null;
  const asOf = hasBalance ? balances.map((b) => b.asOf).sort().at(-1) ?? null : null;
  const projectedEndBalance = currentBalance != null ? currentBalance + restIncome - restSpend : null;

  // Safe-to-Spend: of the income we still expect this month, how much is left for
  // discretionary spend after what's already been spent and the known bills still
  // due — spread across the days remaining. One number that answers "can I spend?".
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeftInMonth = Math.max(1, daysInMonth - now.getDate() + 1);
  const todayIso = now.toISOString().slice(0, 10);
  const monthEndIso = `${month}-${String(daysInMonth).padStart(2, '0')}`;
  const remainingBills = detectRecurring()
    .filter((r) => r.currency === base && r.nextExpected >= todayIso && r.nextExpected <= monthEndIso)
    .reduce((s, r) => s + r.currentAmount, 0);
  const expectedMonthIncome = mtdIncome + restIncome;
  const safeToSpendTotal = expectedMonthIncome - mtdSpend - remainingBills;
  const safeToSpendPerDay = Math.max(0, safeToSpendTotal) / daysLeftInMonth;

  // Monte Carlo band: model this month's total spend as a draw from the spread of
  // recent full months (can't be less than what's already spent), hold expected
  // income fixed, and read off the P10/P50/P90 of month-end net + the chance it's
  // negative. Gives a risk range instead of a single point estimate.
  let simulation: Forecast['simulation'] = null;
  const hist: number[] = [];
  for (let i = 1; i <= 6; i++) {
    const s = spendIn(addMonths(month, -i));
    if (s > 0) hist.push(s);
  }
  if (hist.length >= 2) {
    const mu = hist.reduce((s, x) => s + x, 0) / hist.length;
    const variance = hist.reduce((s, x) => s + (x - mu) ** 2, 0) / hist.length;
    const sd = Math.max(Math.sqrt(variance), mu * 0.08); // variance floor so it isn't degenerate
    const rng = mulberry32(seedFromMonth(month));
    const N = 3000;
    const nets: number[] = [];
    for (let i = 0; i < N; i++) {
      const total = Math.max(mtdSpend, gaussian(rng, mu, sd)); // full-month spend ≥ already spent
      nets.push(expectedMonthIncome - total);
    }
    nets.sort((a, b) => a - b);
    const q = (p: number): number => nets[Math.min(N - 1, Math.floor(p * N))]!;
    const probNeg = nets.filter((n) => n < 0).length / N;
    simulation = {
      p10: round2(q(0.1)),
      p50: round2(q(0.5)),
      p90: round2(q(0.9)),
      probNegativePct: Math.round(probNeg * 100),
    };
  }

  return {
    currency: base,
    month,
    hasBalance,
    currentBalance: currentBalance != null ? round2(currentBalance) : null,
    asOf,
    monthToDate: { spend: round2(mtdSpend), income: round2(mtdIncome) },
    typical: { spend: round2(typicalSpend), income: round2(typicalIncome) },
    expectedRemaining: { spend: round2(restSpend), income: round2(restIncome) },
    projectedNet: round2(projectedNet),
    projectedEndBalance: projectedEndBalance != null ? round2(projectedEndBalance) : null,
    daysLeftInMonth,
    remainingBills: round2(remainingBills),
    safeToSpendTotal: round2(safeToSpendTotal),
    safeToSpendPerDay: round2(safeToSpendPerDay),
    simulation,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
    // Income uses the accounting month so a boundary salary lands in the right month.
    income: all.filter((t) => isIncome(t) && effectiveMonth(t) === m).reduce((s, t) => s + mag(t), 0),
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
  const acctMap = new Map<string, { provider: string | null; accountLabel: string | null; sourceType: string; amount: number; count: number }>();
  for (const t of expenses.filter((t) => monthKey(t.date) === ref)) {
    const key = `${t.sourceProvider ?? ''}|${t.accountLabel ?? ''}|${t.sourceType}`;
    const e = acctMap.get(key) ?? { provider: t.sourceProvider ?? null, accountLabel: t.accountLabel ?? null, sourceType: t.sourceType, amount: 0, count: 0 };
    e.amount += mag(t);
    e.count++;
    acctMap.set(key, e);
  }
  const byAccount = [...acctMap.values()].sort((a, b) => b.amount - a.amount);

  // Income split for the reference month: salary vs everything else.
  const refIncome = all.filter((t) => isIncome(t) && effectiveMonth(t) === ref);
  const incomeTotal = refIncome.reduce((s, t) => s + mag(t), 0);
  const salary = refIncome.filter((t) => t.category === 'Salary').reduce((s, t) => s + mag(t), 0);
  const income = { total: incomeTotal, salary, other: incomeTotal - salary };

  const openAlerts = listAlerts('open').length;

  return {
    currency,
    referenceMonth: ref,
    totals: { thisMonth, lastMonth, threeMonthAvg, momChangePct },
    income,
    categoryBreakdown,
    spendOverTime,
    topMerchants,
    cashFlow,
    byAccount,
    byCurrency,
    activeCurrency,
    counts: { ledger: all.length, alerts: openAlerts },
    range,
    forecast: buildForecast(base),
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
  currentAmount: number; // the most recent charge (what you'll pay next)
  priceChangePct: number | null; // latest vs the prior stable price; null if no meaningful change
  isNew: boolean; // first charge landed within ~45 days — possibly a converted free trial
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
    // Require the HISTORICAL amounts (all but the latest) to be stable so this is
    // a genuine fixed subscription — but ALLOW the most recent charge to deviate,
    // so a price hike is caught instead of disqualifying the whole subscription.
    const prior = amounts.slice(0, -1);
    const priorAvg = prior.reduce((s, a) => s + a, 0) / prior.length;
    const priorStable = prior.every((a) => Math.abs(a - priorAvg) <= Math.max(2, priorAvg * 0.2));
    if (!priorStable) continue;

    const last = sorted[sorted.length - 1]!;
    const currentAmount = mag(last);
    // Price change of the latest charge vs the prior stable price.
    const rawPct = priorAvg > 0 ? ((currentAmount - priorAvg) / priorAvg) * 100 : 0;
    const priceChangePct =
      Math.abs(currentAmount - priorAvg) >= 2 && Math.abs(rawPct) >= 10 ? Math.round(rawPct) : null;
    // First charge within ~45 days => possibly a just-converted free trial.
    const firstAgeDays = (Date.now() - Date.parse(sorted[0]!.date)) / MS_DAY;
    const isNew = firstAgeDays <= 45;

    const nextMs = Date.parse(last.date) + avgGap * MS_DAY;
    const monthlyCost = currentAmount * (30.44 / avgGap); // forward-looking: use the current price
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
      currentAmount,
      priceChangePct,
      isNew,
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
