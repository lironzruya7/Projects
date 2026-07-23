import { getSetting } from '../db/db.js';
import { allPrimary } from '../repo/transactions.js';
import { detectRecurring } from './insights.js';
import type { Transaction } from '../models/types.js';

/**
 * Stable, analysis-friendly JSON for an external AI agent (GET /api/export.json).
 * FORMATTING CONTRACT: every monetary value is a JSON number (never a string with
 * a symbol or separators), every date is ISO 8601, and every amount carries an
 * explicit currency. Category names come straight from the ledger (consistent).
 *
 * This app aggregates transactions, not balance-sheet snapshots, so account
 * balances and net-worth are DERIVED as running sums of imported flows (no
 * opening balances / FX). positions/budgets/debts are empty unless present.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;
const monthKey = (iso: string): string => iso.slice(0, 7);

const PROVIDER_NAMES: Record<string, string> = {
  yahav: 'Bank Yahav',
  isracard: 'Isracard',
  cal: 'Cal',
  diners: 'Diners',
  max: 'Max',
  amex: 'American Express',
  gmail: 'Gmail',
  outlook: 'Outlook',
  imap: 'Email',
  photo: 'Receipt',
};

type AccountType = 'checking' | 'savings' | 'investment' | 'credit' | 'loan' | 'other';

function accountId(t: Pick<Transaction, 'sourceType' | 'sourceProvider' | 'accountLabel'>): string {
  const parts = [t.sourceType, t.sourceProvider ?? 'unknown'];
  if (t.accountLabel) parts.push(t.accountLabel);
  return parts.join(':');
}
function accountType(sourceType: string): AccountType {
  if (sourceType === 'bank') return 'checking';
  if (sourceType === 'card') return 'credit';
  return 'other';
}
function accountName(t: Pick<Transaction, 'sourceType' | 'sourceProvider' | 'accountLabel'>): string {
  const base = t.sourceProvider ? PROVIDER_NAMES[t.sourceProvider.toLowerCase()] ?? t.sourceProvider : t.sourceType;
  return t.accountLabel ? `${base} ••${t.accountLabel}` : base;
}
function txnType(t: Transaction): 'income' | 'expense' | 'transfer' {
  if (t.category === 'Transfers') return 'transfer';
  return t.amount >= 0 ? 'income' : 'expense';
}
function cadence(days: number): string {
  if (days <= 9) return 'weekly';
  if (days <= 16) return 'biweekly';
  if (days <= 45) return 'monthly';
  if (days <= 100) return 'quarterly';
  return 'yearly';
}
function dominant<T>(counts: Map<T, number>): T | undefined {
  let best: T | undefined;
  let n = -1;
  for (const [k, v] of counts) if (v > n) { n = v; best = k; }
  return best;
}

export function buildAgentExport(asOf: string): Record<string, unknown> {
  const txns = allPrimary();
  const baseCurrency = String(getSetting('currency', 'ILS'));

  // --- Accounts (derived from transaction sources) ---
  interface AcctAgg {
    id: string;
    name: string;
    type: AccountType;
    currencyCounts: Map<string, number>;
    balanceByCurrency: Map<string, number>;
  }
  const accts = new Map<string, AcctAgg>();
  for (const t of txns) {
    const id = accountId(t);
    let a = accts.get(id);
    if (!a) {
      a = { id, name: accountName(t), type: accountType(t.sourceType), currencyCounts: new Map(), balanceByCurrency: new Map() };
      accts.set(id, a);
    }
    a.currencyCounts.set(t.currency, (a.currencyCounts.get(t.currency) ?? 0) + 1);
    a.balanceByCurrency.set(t.currency, (a.balanceByCurrency.get(t.currency) ?? 0) + t.amount);
  }
  const accounts = [...accts.values()]
    .map((a) => {
      const currency = dominant(a.currencyCounts) ?? baseCurrency;
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        balance: round2(a.balanceByCurrency.get(currency) ?? 0),
        currency,
      };
    })
    .sort((x, y) => x.id.localeCompare(y.id));

  // --- Net worth + monthly history (base currency only; running sums of flows) ---
  const baseTxns = txns.filter((t) => t.currency === baseCurrency);
  const months = [...new Set(baseTxns.map((t) => monthKey(t.date)))].sort();
  const history = months.map((m) => {
    const bal = new Map<string, number>();
    for (const t of baseTxns) {
      if (monthKey(t.date) <= m) bal.set(accountId(t), (bal.get(accountId(t)) ?? 0) + t.amount);
    }
    let assets = 0;
    let liabilities = 0;
    for (const v of bal.values()) {
      if (v >= 0) assets += v;
      else liabilities += -v;
    }
    return { month: m, net_worth: round2(assets - liabilities), assets: round2(assets), liabilities: round2(liabilities) };
  });
  const last = history[history.length - 1];
  const net_worth = {
    total_assets: last?.assets ?? 0,
    total_liabilities: last?.liabilities ?? 0,
    net_worth: last?.net_worth ?? 0,
  };

  // --- Transactions ---
  const transactions = txns
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({
      date: t.date,
      amount: round2(t.amount),
      currency: t.currency,
      category: t.category ?? 'Uncategorized',
      description: t.merchantRaw || t.description || '',
      account_id: accountId(t),
      type: txnType(t),
    }));

  // --- Recurring ---
  const recurring = detectRecurring().map((r) => ({
    description: r.merchant,
    amount: round2(r.avgAmount),
    currency: r.currency,
    cadence: cadence(r.intervalDays),
  }));

  return {
    meta: {
      as_of: asOf,
      base_currency: baseCurrency,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, currency: a.currency })),
      // Contract flag for the consuming assistant: this app is transaction-based.
      // Balances/net-worth/history are DERIVED, not real bank data — never present
      // them as an actual account balance.
      notes:
        'Transaction-based data (income/expense flows). net_worth, account balances and ' +
        'history are DERIVED as cumulative sums of imported flows in base_currency — they are ' +
        'NOT real bank balances or market positions and have no opening balance or FX. ' +
        'positions, budgets and debts are empty unless explicitly populated. Amounts are summed ' +
        'only within their own currency.',
      derived: {
        net_worth: 'cumulative_cashflow',
        balances: 'cumulative_cashflow',
        history: 'cumulative_cashflow',
      },
    },
    net_worth,
    accounts,
    transactions,
    positions: [] as unknown[],
    recurring,
    budgets: [] as unknown[],
    debts: [] as unknown[],
    history,
  };
}
