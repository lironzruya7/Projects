// Friendly name + color for the account/card a transaction came from.

const LABELS: Record<string, string> = {
  yahav: 'Yahav',
  isracard: 'Isracard',
  cal: 'Cal',
  diners: 'Diners',
  max: 'Max',
  amex: 'Amex',
  paypal: 'PayPal',
  gmail: 'Gmail',
  outlook: 'Outlook',
  imap: 'Email',
  photo: 'Receipt',
};

const COLORS: Record<string, string> = {
  yahav: '#38bdf8',
  isracard: '#c084fc',
  cal: '#f472b6',
  diners: '#2dd4bf',
  max: '#f59e0b',
  amex: '#22d3ee',
  paypal: '#0070ba',
  gmail: '#fb7185',
  outlook: '#60a5fa',
  imap: '#fbbf24',
  photo: '#4ade80',
};

/** Card types the user can pick per file (auto-detection can't tell Diners from Cal). */
export const CARD_PROVIDERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Auto-detect' },
  { value: 'isracard', label: 'Isracard' },
  { value: 'cal', label: 'Cal / Visa Cal' },
  { value: 'diners', label: 'Diners' },
  { value: 'max', label: 'Max' },
  { value: 'amex', label: 'American Express' },
];

const SOURCE_LABEL: Record<string, string> = { bank: 'Bank', card: 'Card', email: 'Email', receipt: 'Receipt' };
const SOURCE_COLOR: Record<string, string> = { bank: '#38bdf8', card: '#c084fc', email: '#fbbf24', receipt: '#4ade80' };

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const FALLBACK = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#f59e0b'];

/**
 * Human label for an account, e.g. "Isracard" or "Isracard ••1234" when a
 * card tag distinguishes two cards of the same provider.
 */
export function accountLabel(
  provider: string | null | undefined,
  sourceType: string,
  cardLabel?: string | null,
): string {
  const base = provider ? LABELS[provider.toLowerCase()] ?? provider : SOURCE_LABEL[sourceType] ?? sourceType;
  const tag = (cardLabel ?? '').trim();
  if (!tag) return base;
  // If the tag is a bare 4-digit last-4, mask it; otherwise show the nickname as-is.
  return /^\d{4}$/.test(tag) ? `${base} ••${tag}` : `${base} · ${tag}`;
}

/** Stable color for an account. Two cards of the same provider get distinct colors. */
export function accountColor(
  provider: string | null | undefined,
  sourceType: string,
  cardLabel?: string | null,
): string {
  const tag = (cardLabel ?? '').trim();
  if (provider) {
    const key = provider.toLowerCase();
    // With a card tag, derive a distinct stable color so two cards don't collide.
    if (tag) return FALLBACK[hash(key + '|' + tag) % FALLBACK.length]!;
    return COLORS[key] ?? FALLBACK[hash(key) % FALLBACK.length]!;
  }
  return SOURCE_COLOR[sourceType] ?? '#94a3b8';
}
