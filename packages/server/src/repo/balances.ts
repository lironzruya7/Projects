import { getSetting, setSetting } from '../db/db.js';

/** A bank-reported account balance captured during a direct sync (scrape). */
export interface BankBalance {
  provider: string;
  label: string;
  accountNumber: string | null;
  balance: number;
  currency: string;
  asOf: string; // ISO timestamp of the sync that reported it
}

const KEY = 'bankBalances';

export function getBankBalances(): BankBalance[] {
  return getSetting<BankBalance[]>(KEY, []);
}

/**
 * Replace the stored balances for one provider (a fresh sync supersedes the old
 * snapshot for that bank) while keeping every other provider's balances intact.
 */
export function saveBankBalances(provider: string, balances: BankBalance[]): void {
  const others = getBankBalances().filter((b) => b.provider !== provider);
  setSetting(KEY, [...others, ...balances]);
}
