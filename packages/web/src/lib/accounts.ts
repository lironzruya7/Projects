// Friendly name + color for the account/card a transaction came from.

const LABELS: Record<string, string> = {
  yahav: 'Yahav',
  isracard: 'Isracard',
  cal: 'Cal',
  max: 'Max',
  amex: 'Amex',
  gmail: 'Gmail',
  outlook: 'Outlook',
  imap: 'Email',
  photo: 'Receipt',
};

const COLORS: Record<string, string> = {
  yahav: '#38bdf8',
  isracard: '#c084fc',
  cal: '#f472b6',
  max: '#f59e0b',
  amex: '#22d3ee',
  gmail: '#fb7185',
  outlook: '#60a5fa',
  imap: '#fbbf24',
  photo: '#4ade80',
};

const SOURCE_LABEL: Record<string, string> = { bank: 'Bank', card: 'Card', email: 'Email', receipt: 'Receipt' };
const SOURCE_COLOR: Record<string, string> = { bank: '#38bdf8', card: '#c084fc', email: '#fbbf24', receipt: '#4ade80' };

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const FALLBACK = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#f59e0b'];

/** Human label for an account, e.g. "Isracard" or (no provider) "Bank". */
export function accountLabel(provider: string | null | undefined, sourceType: string): string {
  if (provider) return LABELS[provider.toLowerCase()] ?? provider;
  return SOURCE_LABEL[sourceType] ?? sourceType;
}

/** Stable color for an account. */
export function accountColor(provider: string | null | undefined, sourceType: string): string {
  if (provider) {
    const key = provider.toLowerCase();
    return COLORS[key] ?? FALLBACK[hash(key) % FALLBACK.length]!;
  }
  return SOURCE_COLOR[sourceType] ?? '#94a3b8';
}
