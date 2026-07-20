const SYMBOLS: Record<string, string> = { ILS: '₪', USD: '$', EUR: '€', GBP: '£' };

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? code + ' ';
}

export function formatMoney(amount: number, currency = 'ILS', opts?: { sign?: boolean }): string {
  const sym = currencySymbol(currency);
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = opts?.sign ? (amount < 0 ? '-' : amount > 0 ? '+' : '') : amount < 0 ? '-' : '';
  return `${sign}${sym}${formatted}`;
}

export function formatMonth(ym: string): string {
  const [y, m] = ym.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export function formatDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** True if the string contains Hebrew (or other RTL) characters. */
export function hasHebrew(s: string): boolean {
  return /[֐-׿]/.test(s);
}
