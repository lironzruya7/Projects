import { getDb } from '../db/db.js';
import { allPrimary } from '../repo/transactions.js';
import { daysBetween } from '../parsers/date.js';
import type { Transaction } from '../models/types.js';

/**
 * Credit-card settlement reconciliation.
 *
 * A bank statement shows an *aggregate* credit-card charge (e.g. Yahav's
 * "כרטיסי אשראי לי  −₪6,083.83") that equals the SUM of the itemized purchases
 * on that card for the billing cycle. When both the bank line and the card
 * export are imported, the money is counted twice.
 *
 * The correct model: paying your card from the bank is a TRANSFER between your
 * own accounts, not new spending — the spending already happened on the card.
 * So we tag those bank lines as `Transfers` (excluded from expense totals), and
 * offer a reconciliation report that matches each settlement to its card items.
 */

interface SettlementPattern {
  re: RegExp;
  provider: string | null; // best-guess card provider, null = generic aggregate
}

// Only applied to BANK debit lines, so provider-ish words here are safe.
const SETTLEMENT_PATTERNS: SettlementPattern[] = [
  { re: /ישראכרט|isracard/i, provider: 'isracard' },
  { re: /ויזה\s*כ.?אל|\bכ.?אל\b|visa\s*cal|\bcal\b/i, provider: 'cal' },
  { re: /לאומי\s*קארד|מקס\s*איט|\bמקס\b|max\s*it|\bmax\b/i, provider: 'max' },
  { re: /אמריקן|אמריקאן|amex|american\s*express|דיינרס|diners/i, provider: 'amex' },
  // Generic aggregate line (provider unknown) — matched last.
  { re: /כרטיס.{0,3}\s*אשראי|כרטיסי\s*אשראי|credit\s*card/i, provider: null },
];

export interface SettlementClass {
  isSettlement: boolean;
  provider: string | null;
}

/** Classify a bank debit line as a credit-card settlement (and guess the card). */
export function classifySettlement(t: Transaction): SettlementClass {
  if (t.sourceType !== 'bank' || t.amount >= 0) return { isSettlement: false, provider: null };
  const hay = `${t.merchantRaw} ${t.description} ${t.merchantNormalized}`;
  for (const p of SETTLEMENT_PATTERNS) {
    if (p.re.test(hay)) return { isSettlement: true, provider: p.provider };
  }
  return { isSettlement: false, provider: null };
}

/**
 * Tag detected bank credit-card settlement lines as `Transfers` so they are
 * excluded from expense totals (prevents double-counting against the itemized
 * card charges). Never overrides a user's manual categorization. Idempotent.
 * Returns the number of rows updated.
 */
export function applySettlementCategory(): number {
  const db = getDb();
  const bankDebits = allPrimary().filter((t) => t.sourceType === 'bank' && t.amount < 0);
  const upd = db.prepare(
    `UPDATE transactions SET category = 'Transfers', category_source = 'rule'
     WHERE id = ? AND category_source != 'manual' AND (category IS NULL OR category != 'Transfers')`,
  );
  let changed = 0;
  const tx = db.transaction(() => {
    for (const t of bankDebits) {
      if (classifySettlement(t).isSettlement) changed += upd.run(t.id).changes;
    }
  });
  tx();
  return changed;
}

export interface ReconItem {
  id: string;
  date: string;
  amount: number;
  merchant: string;
}
export interface ReconMatch {
  settlement: { id: string; date: string; amount: number; provider: string | null; merchant: string };
  matched: {
    provider: string | null;
    accountLabel: string | null;
    itemCount: number;
    sum: number;
    diff: number;
    status: 'exact' | 'close';
    items: ReconItem[];
  } | null;
  status: 'matched' | 'unmatched';
}
export interface ReconReport {
  matches: ReconMatch[];
  settlementCount: number;
  matchedCount: number;
  settlementTotal: number; // sum of |settlement amounts|
  matchedCardTotal: number; // sum of card items tied to a settlement
  unassignedCardTotal: number; // card charges not tied to any settlement
  unassignedCardCount: number;
}

const toItem = (t: Transaction): ReconItem => ({
  id: t.id,
  date: t.date,
  amount: t.amount,
  merchant: t.merchantRaw || t.merchantNormalized || t.description,
});

/**
 * Best-effort match of each bank settlement line to the set of card charges that
 * sum to it. Card billing lags the purchase date, so we sum a card group's
 * charges in a window ending on the settlement (billing) date and greedily
 * "consume" them so each charge is tied to at most one settlement.
 */
export function buildReconciliation(opts?: { windowDays?: number; tolPct?: number; tolMinor?: number }): ReconReport {
  const windowDays = opts?.windowDays ?? 45;
  const tolPct = opts?.tolPct ?? 1.5; // fees / rounding slack
  const tolMinor = opts?.tolMinor ?? 30; // ₪ absolute slack

  const primaries = allPrimary();
  const settlements = primaries
    .filter((t) => classifySettlement(t).isSettlement)
    .sort((a, b) => b.date.localeCompare(a.date)); // newest first

  // Card charges (outflows) grouped by provider+card, each consumable once.
  const cardCharges = primaries.filter((t) => t.sourceType === 'card' && t.amount < 0);
  const consumed = new Set<string>();

  const groupKey = (t: Transaction): string => `${t.sourceProvider ?? ''}|${t.accountLabel ?? ''}`;
  const groups = new Map<string, Transaction[]>();
  for (const c of cardCharges) {
    const k = groupKey(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }

  const withinTol = (target: number, sum: number): boolean => {
    const diff = Math.abs(target - sum);
    return diff <= Math.max((target * tolPct) / 100, tolMinor / 100);
  };

  const matches: ReconMatch[] = [];
  for (const s of settlements) {
    const target = Math.abs(s.amount);
    const guess = classifySettlement(s).provider;

    // Candidate groups: prefer the guessed provider, else consider all.
    const candidateKeys = [...groups.keys()].filter((k) => {
      if (!guess) return true;
      return k.startsWith(`${guess}|`);
    });

    let best: { key: string; items: Transaction[]; sum: number; diff: number } | null = null;
    for (const k of guess && candidateKeys.length ? candidateKeys : [...groups.keys()]) {
      const inWindow = groups
        .get(k)!
        .filter((c) => !consumed.has(c.id) && c.date <= s.date && daysBetween(c.date, s.date) <= windowDays);
      if (!inWindow.length) continue;
      const sum = inWindow.reduce((acc, c) => acc + Math.abs(c.amount), 0);
      const diff = Math.abs(target - sum);
      if (!best || diff < best.diff) best = { key: k, items: inWindow, sum, diff };
    }

    if (best && withinTol(target, best.sum)) {
      for (const c of best.items) consumed.add(c.id);
      const [provider, accountLabel] = best.key.split('|');
      matches.push({
        settlement: {
          id: s.id,
          date: s.date,
          amount: s.amount,
          provider: guess,
          merchant: s.merchantRaw || s.description,
        },
        matched: {
          provider: provider || null,
          accountLabel: accountLabel || null,
          itemCount: best.items.length,
          sum: best.sum,
          diff: best.diff,
          status: best.diff < 1 ? 'exact' : 'close',
          items: best.items.map(toItem).sort((a, b) => a.date.localeCompare(b.date)),
        },
        status: 'matched',
      });
    } else {
      matches.push({
        settlement: {
          id: s.id,
          date: s.date,
          amount: s.amount,
          provider: guess,
          merchant: s.merchantRaw || s.description,
        },
        matched: null,
        status: 'unmatched',
      });
    }
  }

  const unassigned = cardCharges.filter((c) => !consumed.has(c.id));
  const matchedCardTotal = matches.reduce((acc, m) => acc + (m.matched?.sum ?? 0), 0);

  return {
    matches,
    settlementCount: settlements.length,
    matchedCount: matches.filter((m) => m.status === 'matched').length,
    settlementTotal: settlements.reduce((acc, s) => acc + Math.abs(s.amount), 0),
    matchedCardTotal,
    unassignedCardTotal: unassigned.reduce((acc, c) => acc + Math.abs(c.amount), 0),
    unassignedCardCount: unassigned.length,
  };
}
