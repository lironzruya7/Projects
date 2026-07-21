import { buildDashboard } from './insights.js';
import { buildRecommendations } from './recommend.js';
import { detectRecurring } from './insights.js';
import { queryLedger } from '../repo/transactions.js';
import type { LedgerEntry } from '../models/types.js';

function monthsInRange(min: string, max: string): string[] {
  const out: string[] = [];
  let cur = min;
  for (let i = 0; i < 240 && cur <= max; i++) {
    out.push(cur);
    const [y, m] = cur.split('-').map(Number) as [number, number];
    cur = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  }
  return out.reverse(); // newest first
}

export interface MonthReport {
  month: string;
  income: { total: number; salary: number; other: number };
  spend: number;
  net: number;
  categories: Array<{ category: string; amount: number; count: number }>;
  topMerchants: Array<{ merchant: string; amount: number; count: number }>;
  byAccount: Array<{ provider: string | null; accountLabel: string | null; sourceType: string; amount: number }>;
  transactions: LedgerEntry[];
}

export interface FullReport {
  currency: string;
  generatedFor: string; // ISO date passed in
  range: { min: string; max: string };
  months: MonthReport[];
  recurring: ReturnType<typeof detectRecurring>;
  recommendations: ReturnType<typeof buildRecommendations>;
}

/** Assemble the whole financial picture, organized by month (newest first). */
export function buildReport(generatedFor: string): FullReport {
  const overall = buildDashboard({});
  const months = monthsInRange(overall.range.min, overall.range.max);

  const monthReports: MonthReport[] = months.map((m) => {
    const d = buildDashboard({ month: m });
    const transactions = queryLedger({ from: `${m}-01`, to: `${m}-31` }).sort((a, b) => a.date.localeCompare(b.date));
    return {
      month: m,
      income: d.income,
      spend: d.totals.thisMonth,
      net: d.income.total - d.totals.thisMonth,
      categories: d.categoryBreakdown,
      topMerchants: d.topMerchants,
      byAccount: d.byAccount.map((a) => ({ provider: a.provider, accountLabel: a.accountLabel, sourceType: a.sourceType, amount: a.amount })),
      transactions,
    };
  });

  return {
    currency: overall.currency,
    generatedFor,
    range: overall.range,
    months: monthReports,
    recurring: detectRecurring().filter((r) => r.currency === overall.currency),
    recommendations: buildRecommendations(),
  };
}

// ---------- formatting ----------

function sym(currency: string): string {
  return currency === 'ILS' ? '₪' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency + ' ';
}
function money(n: number, currency: string): string {
  return `${sym(currency)}${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function monthName(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[m - 1]} ${y}`;
}
function acctLabel(a: { provider: string | null; accountLabel: string | null; sourceType: string }): string {
  const base = a.provider ?? a.sourceType;
  return a.accountLabel ? `${base} ••${a.accountLabel}` : base;
}

// ---------- JSON (structured, for an AI agent) ----------

const round2 = (n: number): number => Math.round(n * 100) / 100;

function compactTxn(t: LedgerEntry): Record<string, unknown> {
  return {
    date: t.date,
    merchant: t.merchantRaw,
    amount: round2(t.amount),
    currency: t.currency,
    direction: t.amount < 0 ? 'out' : 'in',
    category: t.category ?? null,
    sourceType: t.sourceType,
    provider: t.sourceProvider ?? null,
    card: t.accountLabel ?? null,
    mergedFrom: t.sourceCount > 1 ? t.sourceTypes : undefined,
  };
}

/** The whole report as one organized JSON object, ideal for an AI agent to parse. */
export function renderReportJson(r: FullReport): Record<string, unknown> {
  const c = r.currency;
  const totalIncome = r.months.reduce((s, m) => s + m.income.total, 0);
  const totalSpend = r.months.reduce((s, m) => s + m.spend, 0);
  const allTransactions = r.months.flatMap((m) => m.transactions).map(compactTxn);

  return {
    meta: {
      schema: 'finance-report/1',
      generatedAt: r.generatedFor,
      currency: c,
      period: r.range,
      monthsCovered: r.months.length,
      notes:
        'Amounts are signed (negative = spend, positive = income). Salary paid at a month boundary is counted in the nearest month. Bank credit-card settlement lines are categorized Transfers and excluded from income/spend to avoid double-counting the itemized card charges.',
    },
    overview: {
      totalIncome: round2(totalIncome),
      totalSpend: round2(totalSpend),
      net: round2(totalIncome - totalSpend),
      avgMonthlySpend: round2(r.recommendations.totalMonthlySpend),
      recurringMonthly: round2(r.recommendations.recurringMonthly),
      recurringAnnual: round2(r.recommendations.recurringAnnual),
      potentialMonthlySavings: round2(r.recommendations.potentialMonthlySavings),
    },
    recommendations: r.recommendations.recommendations.map((rec) => ({
      kind: rec.kind,
      title: rec.title,
      detail: rec.detail,
      monthlySaving: round2(rec.monthlySaving),
    })),
    serviceGroups: r.recommendations.serviceGroups.map((g) => ({
      type: g.label,
      monthlyCost: round2(g.monthlyCost),
      overlapping: g.overlapping,
      consolidatable: g.saveable,
      merchants: g.merchants.map((m) => ({ merchant: m.merchant, monthlyCost: round2(m.monthlyCost), charges: m.count })),
    })),
    recurringSubscriptions: r.recurring.map((s) => ({
      merchant: s.merchant,
      monthlyCost: round2(s.monthlyCost),
      annualCost: round2(s.annualCost),
      everyDays: s.intervalDays,
      category: s.category ?? null,
      lastCharge: s.lastDate,
      nextExpected: s.nextExpected,
    })),
    months: r.months.map((m) => ({
      month: m.month,
      income: { total: round2(m.income.total), salary: round2(m.income.salary), other: round2(m.income.other) },
      spend: round2(m.spend),
      net: round2(m.net),
      byCategory: m.categories.map((x) => ({ category: x.category, amount: round2(x.amount), count: x.count })),
      byAccount: m.byAccount.map((a) => ({ account: acctLabel(a), amount: round2(a.amount) })),
      topMerchants: m.topMerchants.map((x) => ({ merchant: x.merchant, amount: round2(x.amount), count: x.count })),
      transactions: m.transactions.map(compactTxn),
    })),
    allTransactions,
  };
}

// ---------- Markdown (best for feeding to another AI) ----------

export function renderReportMarkdown(r: FullReport): string {
  const c = r.currency;
  const L: string[] = [];
  L.push(`# Personal Finance Report`);
  L.push('');
  L.push(`- Generated: ${r.generatedFor}`);
  L.push(`- Base currency: ${c}`);
  L.push(`- Period: ${r.range.min} → ${r.range.max}`);
  L.push('');
  L.push(`> All amounts are in ${c} unless a row states otherwise. Expenses are positive magnitudes here for readability. Salary paid at a month boundary is counted in the nearest month. Credit-card "settlement" bank lines are excluded (they are transfers, not new spend) to avoid double-counting the itemized card charges.`);
  L.push('');

  // Overview
  const totalIncome = r.months.reduce((s, m) => s + m.income.total, 0);
  const totalSpend = r.months.reduce((s, m) => s + m.spend, 0);
  L.push(`## Overview`);
  L.push('');
  L.push(`| Metric | Value |`);
  L.push(`| --- | --- |`);
  L.push(`| Months covered | ${r.months.length} |`);
  L.push(`| Total income | ${money(totalIncome, c)} |`);
  L.push(`| Total spend | ${money(totalSpend, c)} |`);
  L.push(`| Net | ${money(totalIncome - totalSpend, c)} |`);
  L.push(`| Avg spend / month | ${money(r.recommendations.totalMonthlySpend, c)} |`);
  L.push(`| Recurring subscriptions / month | ${money(r.recommendations.recurringMonthly, c)} |`);
  L.push(`| Est. possible savings / month | ${money(r.recommendations.potentialMonthlySavings, c)} |`);
  L.push('');

  // Recommendations
  if (r.recommendations.recommendations.length) {
    L.push(`## Recommendations`);
    L.push('');
    for (const rec of r.recommendations.recommendations) {
      const save = rec.monthlySaving > 0 ? ` _(save ~${money(rec.monthlySaving, c)}/mo)_` : '';
      L.push(`- **${rec.title}**${save} — ${rec.detail}`);
    }
    L.push('');
  }

  // Overlapping services
  const overlap = r.recommendations.serviceGroups.filter((g) => g.overlapping);
  if (overlap.length) {
    L.push(`## Services by type (possible overlap)`);
    L.push('');
    for (const g of overlap) {
      L.push(`- **${g.label}** — ${money(g.monthlyCost, c)}/mo across ${g.merchants.length}: ${g.merchants.map((m) => `${m.merchant} (${money(m.monthlyCost, c)}/mo)`).join(', ')}${g.saveable ? '' : ' _(distinct necessities, not overlap)_'}`);
    }
    L.push('');
  }

  // Recurring
  if (r.recurring.length) {
    L.push(`## Recurring subscriptions`);
    L.push('');
    L.push(`| Merchant | ${sym(c)}/mo | ${sym(c)}/yr | every | category |`);
    L.push(`| --- | ---: | ---: | --- | --- |`);
    for (const s of r.recurring) L.push(`| ${s.merchant} | ${money(s.monthlyCost, c)} | ${money(s.annualCost, c)} | ${s.intervalDays}d | ${s.category ?? '-'} |`);
    L.push('');
  }

  // Per month
  L.push(`## Monthly breakdown`);
  L.push('');
  for (const m of r.months) {
    if (m.transactions.length === 0 && m.spend === 0 && m.income.total === 0) continue;
    L.push(`### ${monthName(m.month)}`);
    L.push('');
    L.push(`- Income: ${money(m.income.total, c)} (salary ${money(m.income.salary, c)}, other ${money(m.income.other, c)})`);
    L.push(`- Spend: ${money(m.spend, c)}`);
    L.push(`- Net: ${money(m.net, c)}`);
    L.push('');
    if (m.categories.length) {
      L.push(`**By category**`);
      L.push('');
      L.push(`| Category | ${sym(c)} | # |`);
      L.push(`| --- | ---: | ---: |`);
      for (const cat of m.categories) L.push(`| ${cat.category} | ${money(cat.amount, c)} | ${cat.count} |`);
      L.push('');
    }
    if (m.byAccount.length) {
      L.push(`**By account/card:** ${m.byAccount.map((a) => `${acctLabel(a)} ${money(a.amount, c)}`).join(' · ')}`);
      L.push('');
    }
    if (m.transactions.length) {
      L.push(`**Transactions (${m.transactions.length})**`);
      L.push('');
      L.push(`| Date | Merchant | Amount | Category | Source |`);
      L.push(`| --- | --- | ---: | --- | --- |`);
      for (const t of m.transactions) {
        const src = acctLabel({ provider: t.sourceProvider, accountLabel: t.accountLabel, sourceType: t.sourceType });
        const amt = `${t.amount < 0 ? '-' : '+'}${money(Math.abs(t.amount), t.currency)}`;
        L.push(`| ${t.date} | ${t.merchantRaw.replace(/\|/g, '/')} | ${amt} | ${t.category ?? '-'} | ${src} |`);
      }
      L.push('');
    }
  }

  return L.join('\n');
}

// ---------- HTML (for a tidy PDF) ----------

export function renderReportHtml(r: FullReport): string {
  const c = r.currency;
  const esc = (s: string): string => s.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]!));
  const totalIncome = r.months.reduce((s, m) => s + m.income.total, 0);
  const totalSpend = r.months.reduce((s, m) => s + m.spend, 0);

  const rows = (arr: string[][]): string => arr.map((tr) => `<tr>${tr.map((td, i) => `<td class="${i === 0 ? '' : 'num'}" dir="auto">${td}</td>`).join('')}</tr>`).join('');

  const monthSections = r.months
    .filter((m) => m.transactions.length || m.spend || m.income.total)
    .map((m) => {
      const cats = m.categories.length
        ? `<h4>By category</h4><table><thead><tr><th>Category</th><th class="num">${sym(c)}</th><th class="num">#</th></tr></thead><tbody>${rows(m.categories.map((x) => [esc(x.category), money(x.amount, c), String(x.count)]))}</tbody></table>`
        : '';
      const txns = m.transactions.length
        ? `<h4>Transactions (${m.transactions.length})</h4><table><thead><tr><th>Date</th><th>Merchant</th><th class="num">Amount</th><th>Category</th><th>Source</th></tr></thead><tbody>${rows(
            m.transactions.map((t) => [
              t.date,
              esc(t.merchantRaw),
              `${t.amount < 0 ? '-' : '+'}${money(Math.abs(t.amount), t.currency)}`,
              esc(t.category ?? '-'),
              esc(acctLabel({ provider: t.sourceProvider, accountLabel: t.accountLabel, sourceType: t.sourceType })),
            ]),
          )}</tbody></table>`
        : '';
      return `<section class="month"><h3>${monthName(m.month)}</h3>
        <p class="kpis"><b>Income</b> ${money(m.income.total, c)} <span class="sub">(salary ${money(m.income.salary, c)}, other ${money(m.income.other, c)})</span> &nbsp;·&nbsp; <b>Spend</b> ${money(m.spend, c)} &nbsp;·&nbsp; <b>Net</b> <span class="${m.net >= 0 ? 'pos' : 'neg'}">${money(m.net, c)}</span></p>
        ${cats}${txns}</section>`;
    })
    .join('');

  const recs = r.recommendations.recommendations
    .map((rec) => `<li><b>${esc(rec.title)}</b>${rec.monthlySaving > 0 ? ` <span class="save">save ~${money(rec.monthlySaving, c)}/mo</span>` : ''}<br><span class="sub" dir="auto">${esc(rec.detail)}</span></li>`)
    .join('');

  const recurRows = r.recurring.map((s) => [esc(s.merchant), money(s.monthlyCost, c), money(s.annualCost, c), `${s.intervalDays}d`, esc(s.category ?? '-')]);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Financial Report ${r.range.min}–${r.range.max}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; margin: 24px; font-size: 12px; line-height: 1.45; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 22px 0 8px; border-bottom: 2px solid #333; padding-bottom: 3px; }
  h3 { font-size: 14px; margin: 16px 0 6px; color: #1e40af; }
  h4 { font-size: 12px; margin: 10px 0 4px; color: #444; }
  .muted { color: #666; }
  .sub { color: #666; font-size: 11px; }
  .pos { color: #047857; } .neg { color: #b91c1c; }
  .save { color: #047857; font-weight: 600; font-size: 11px; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0 10px; }
  th, td { border: 1px solid #ddd; padding: 3px 6px; text-align: start; vertical-align: top; }
  th { background: #f3f4f6; font-size: 11px; }
  td.num, th.num { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .kpis { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 8px; }
  ul { margin: 4px 0; padding-inline-start: 18px; }
  li { margin-bottom: 5px; }
  section.month { page-break-inside: avoid; }
  @media print { body { margin: 0; } h2 { page-break-after: avoid; } }
</style></head><body>
<h1>Personal Finance Report</h1>
<p class="muted">Generated ${r.generatedFor} · ${c} · ${r.range.min} → ${r.range.max} · ${r.months.length} months</p>
<p class="sub">Salary at a month boundary counts toward the nearest month. Credit-card settlement bank lines are excluded as transfers to avoid double-counting the itemized card charges.</p>

<h2>Overview</h2>
<table><tbody>
${rows([
  ['Total income', money(totalIncome, c)],
  ['Total spend', money(totalSpend, c)],
  ['Net', money(totalIncome - totalSpend, c)],
  ['Avg spend / month', money(r.recommendations.totalMonthlySpend, c)],
  ['Recurring subscriptions / month', money(r.recommendations.recurringMonthly, c)],
  ['Est. possible savings / month', money(r.recommendations.potentialMonthlySavings, c)],
])}
</tbody></table>

${recs ? `<h2>Recommendations</h2><ul>${recs}</ul>` : ''}
${recurRows.length ? `<h2>Recurring subscriptions</h2><table><thead><tr><th>Merchant</th><th class="num">${sym(c)}/mo</th><th class="num">${sym(c)}/yr</th><th>every</th><th>category</th></tr></thead><tbody>${rows(recurRows)}</tbody></table>` : ''}

<h2>Monthly breakdown</h2>
${monthSections}
</body></html>`;
}
