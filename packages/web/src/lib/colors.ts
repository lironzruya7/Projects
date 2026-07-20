// One consistent color per category, used across the donut, legend chips, and
// the transaction list so a category always reads as the same color.
const CATEGORY_COLORS: Record<string, string> = {
  Groceries: '#34d399',
  Dining: '#fb7185',
  Transport: '#38bdf8',
  Utilities: '#a78bfa',
  Housing: '#f59e0b',
  Shopping: '#f472b6',
  Health: '#4ade80',
  Entertainment: '#c084fc',
  Subscriptions: '#22d3ee',
  Travel: '#fbbf24',
  Fees: '#fca5a5',
  Income: '#10b981',
  Transfers: '#94a3b8',
  Other: '#818cf8',
  Uncategorized: '#64748b',
};

const FALLBACK = [
  '#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb7185',
  '#22d3ee', '#c084fc', '#f59e0b', '#4ade80', '#818cf8', '#fca5a5',
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function categoryColor(name: string | null | undefined): string {
  const key = name ?? 'Uncategorized';
  return CATEGORY_COLORS[key] ?? FALLBACK[hash(key) % FALLBACK.length]!;
}

export const SOURCE_COLORS: Record<string, string> = {
  bank: '#38bdf8',
  card: '#c084fc',
  email: '#fbbf24',
};
