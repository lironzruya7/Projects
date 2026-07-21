import { getDb, getSetting } from '../db/db.js';
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

// Names on incoming salary transfers (e.g. "רותם", "לירון"). Editable via the
// `salary.payers` setting; these are the defaults.
const DEFAULT_SALARY_PAYERS = ['רותם', 'לירון'];

function salaryPayers(): string[] {
  const s = getSetting<{ payers?: string[] }>('salary', {});
  const list = s.payers && s.payers.length ? s.payers : DEFAULT_SALARY_PAYERS;
  return list.map((x) => x.trim()).filter(Boolean);
}

/** A positive bank credit that is a salary — by the word "משכורת"/salary or a known payer. */
export function isSalary(t: Transaction): boolean {
  if (t.sourceType !== 'bank' || t.amount <= 0) return false;
  const hay = `${t.merchantRaw} ${t.description} ${t.merchantNormalized}`;
  if (/משכורת|משכרת|\bsalary\b|\bpayroll\b/i.test(hay)) return true;
  return salaryPayers().some((p) => p && hay.includes(p));
}

/**
 * Tag incoming salaries with the `Salary` category (kept separate from other
 * income). Never overrides a manual choice. Idempotent.
 */
export function applySalaryCategory(): number {
  const db = getDb();
  const credits = allPrimary().filter((t) => t.sourceType === 'bank' && t.amount > 0);
  const upd = db.prepare(
    `UPDATE transactions SET category = 'Salary', category_source = 'rule'
     WHERE id = ? AND category_source != 'manual' AND (category IS NULL OR category = 'Income' OR category != 'Salary')`,
  );
  let changed = 0;
  const tx = db.transaction(() => {
    for (const t of credits) if (isSalary(t)) changed += upd.run(t.id).changes;
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

/** Card family a provider belongs to, as the bank groups them. */
function cardFamily(provider: string | null | undefined): 'isracard' | 'cal' {
  const p = (provider ?? '').toLowerCase();
  if (p.includes('isracard')) return 'isracard';
  // Cal issues Visa Cal + Diners; the bank lumps these under "כרטיסי אשראי".
  return 'cal';
}

interface CardStatement {
  batchId: string;
  provider: string | null;
  accountLabel: string | null;
  total: number;
  count: number;
  minDate: string;
  maxDate: string;
}

/**
 * Each imported card FILE is one billing statement with a known total (its
 * "עסקאות לחיוב" header equals the sum of its rows). Summing per import batch
 * gives us statement totals to match against the bank's settlement lines —
 * robust to installments and multi-card aggregation, which per-charge windowing
 * can't handle.
 */
function cardStatements(): CardStatement[] {
  const rows = getDb()
    .prepare(
      `SELECT import_batch AS batchId, source_provider AS provider, account_label AS accountLabel,
              SUM(ABS(amount)) AS total, COUNT(*) AS count, MIN(date) AS minDate, MAX(date) AS maxDate
       FROM transactions
       WHERE source_type = 'card' AND amount < 0 AND import_batch IS NOT NULL
       GROUP BY import_batch`,
    )
    .all() as CardStatement[];
  return rows.filter((r) => r.total > 0);
}

/** Charges of one batch, for the expandable detail. */
function batchItems(batchId: string): ReconItem[] {
  const rows = getDb()
    .prepare(
      `SELECT id, date, amount, merchant_raw AS m1, merchant_normalized AS m2, description AS m3
       FROM transactions WHERE import_batch = ? AND source_type = 'card' AND amount < 0
       ORDER BY date ASC`,
    )
    .all(batchId) as Array<{ id: string; date: string; amount: number; m1: string; m2: string; m3: string }>;
  return rows.map((r) => ({ id: r.id, date: r.date, amount: r.amount, merchant: r.m1 || r.m2 || r.m3 }));
}

/** Smallest subsets (size ≤3) of statements whose totals sum within tolerance of target. */
function findSubset(
  cands: CardStatement[],
  target: number,
  tol: number,
): { picks: CardStatement[]; sum: number; diff: number } | null {
  let best: { picks: CardStatement[]; sum: number; diff: number } | null = null;
  const consider = (picks: CardStatement[]): void => {
    const sum = picks.reduce((a, s) => a + s.total, 0);
    const diff = Math.abs(target - sum);
    if (diff <= tol && (!best || diff < best.diff || (diff === best.diff && picks.length < best.picks.length))) {
      best = { picks, sum, diff };
    }
  };
  for (let i = 0; i < cands.length; i++) {
    consider([cands[i]!]);
    for (let j = i + 1; j < cands.length; j++) {
      consider([cands[i]!, cands[j]!]);
      for (let k = j + 1; k < cands.length; k++) consider([cands[i]!, cands[j]!, cands[k]!]);
    }
  }
  return best;
}

/**
 * Match each bank credit-card settlement line to the card statement(s) (imported
 * files) whose totals sum to it. Statements are consumed once so each bank line
 * maps to a distinct set of files. Bank lines are matched largest-first (a big
 * aggregate is more constraining), preferring the same card family and nearby
 * billing dates.
 */
export function buildReconciliation(opts?: { tolPct?: number; tolMinor?: number; maxLagDays?: number }): ReconReport {
  const tolPct = opts?.tolPct ?? 1; // fees / rounding slack
  const tolMinor = opts?.tolMinor ?? 20; // ₪ absolute slack
  const maxLagDays = opts?.maxLagDays ?? 55; // purchase→billing lag

  const primaries = allPrimary();
  const settlements = primaries
    .filter((t) => classifySettlement(t).isSettlement)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)); // largest first

  const statements = cardStatements();
  const consumed = new Set<string>();
  const tolFor = (target: number): number => Math.max((target * tolPct) / 100, tolMinor / 100);

  const matches: ReconMatch[] = [];
  for (const s of settlements) {
    const target = Math.abs(s.amount);
    const guess = classifySettlement(s).provider;
    const wantFamily = guess ? cardFamily(guess) : null;

    // Candidate statements: unconsumed, right family (if we can tell), billed
    // plausibly before the settlement date.
    const candidates = statements.filter((st) => {
      if (consumed.has(st.batchId)) return false;
      if (wantFamily && cardFamily(st.provider) !== wantFamily) return false;
      const lag = daysBetween(st.maxDate, s.date);
      return st.minDate <= s.date && lag <= maxLagDays;
    });

    let hit = findSubset(candidates, target, tolFor(target));
    // Fall back to ignoring the date constraint (some banks post late) before giving up.
    if (!hit) {
      const relaxed = statements.filter((st) => !consumed.has(st.batchId) && (!wantFamily || cardFamily(st.provider) === wantFamily));
      hit = findSubset(relaxed, target, tolFor(target));
    }

    const settlement = { id: s.id, date: s.date, amount: s.amount, provider: guess, merchant: s.merchantRaw || s.description };
    if (hit) {
      for (const st of hit.picks) consumed.add(st.batchId);
      const items = hit.picks.flatMap((st) => batchItems(st.batchId)).sort((a, b) => a.date.localeCompare(b.date));
      const labels = hit.picks.map((p) => p.accountLabel).filter(Boolean);
      matches.push({
        settlement,
        matched: {
          provider: hit.picks[0]!.provider,
          accountLabel: labels.length ? labels.join(', ') : null,
          itemCount: items.length,
          sum: hit.sum,
          diff: hit.diff,
          status: hit.diff < 1 ? 'exact' : 'close',
          items,
        },
        status: 'matched',
      });
    } else {
      matches.push({ settlement, matched: null, status: 'unmatched' });
    }
  }

  const unassignedStatements = statements.filter((st) => !consumed.has(st.batchId));
  const matchedCardTotal = matches.reduce((acc, m) => acc + (m.matched?.sum ?? 0), 0);

  return {
    matches: matches.sort((a, b) => b.settlement.date.localeCompare(a.settlement.date)),
    settlementCount: settlements.length,
    matchedCount: matches.filter((m) => m.status === 'matched').length,
    settlementTotal: settlements.reduce((acc, s) => acc + Math.abs(s.amount), 0),
    matchedCardTotal,
    unassignedCardTotal: unassignedStatements.reduce((acc, st) => acc + st.total, 0),
    unassignedCardCount: unassignedStatements.reduce((acc, st) => acc + st.count, 0),
  };
}
