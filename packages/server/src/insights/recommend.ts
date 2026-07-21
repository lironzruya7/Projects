import { allPrimary } from '../repo/transactions.js';
import { detectRecurring, type RecurringItem } from './insights.js';
import type { Transaction } from '../models/types.js';

const MS_DAY = 86_400_000;
const monthKey = (iso: string): string => iso.slice(0, 7);
const mag = (t: Transaction): number => Math.abs(t.amount);

/**
 * Service "type" buckets. If several DIFFERENT merchants fall in the same bucket
 * (e.g. OpenAI + Anthropic + Manus = 3 AI tools), that's overlapping spend the
 * user may want to consolidate.
 */
const SERVICE_GROUPS: Array<{ key: string; label: string; re: RegExp }> = [
  { key: 'ai', label: 'AI tools', re: /openai|chatgpt|anthropic|claude|manus|midjourney|perplexity|copilot|gemini|cursor|replit|huggingface|elevenlabs|invideo|runway|capcut|synthesia|character\.?ai/i },
  { key: 'telecom', label: 'Phone & mobile', re: /cellcom|סלקום|partner|פרטנר|pelephone|פלאפון|hot\s*mobile|הוט\s*מובייל|golan|גולן|019|rami\s*levy|רמי\s*לוי\s*תקשורת|we4g|012\s*mobile|טלקום/i },
  { key: 'streaming', label: 'Streaming & media', re: /netflix|נטפליקס|spotify|ספוטיפיי|youtube\s*premium|disney|hbo|apple\s*music|apple\.com\/bill|itunes|prime\s*video|paramount|סלקום\s*tv|yes|סטינג|audible/i },
  { key: 'cloud', label: 'Cloud & hosting', re: /\baws\b|amazon\s*web|google\s*cloud|\bgcp\b|azure|digitalocean|hetzner|hostinger|vercel|netlify|cloudflare|tailscale|linode|render\.com/i },
  { key: 'software', label: 'Software & productivity', re: /notion|obsidian|figma|adobe|microsoft\s*365|office\s*365|dropbox|1password|lastpass|slack|zoom|grammarly|canva|jetbrains|github|gitlab/i },
  { key: 'gaming', label: 'Gaming', re: /roblox|steam|playstation|\bpsn\b|xbox|nintendo|epic\s*games|riot/i },
  { key: 'food', label: 'Food delivery', re: /wolt|וולט|10bis|תן\s*ביס|cibus|סיבוס|mishloha|משלוחה/i },
  { key: 'insurance', label: 'Insurance', re: /ביטוח|insurance|מגדל|הראל|כלל\s*ביטוח|מנורה|הפניקס|איילון|שלמה\s*ביטוח/i },
  { key: 'gym', label: 'Gym & fitness', re: /holmes\s*place|הולמס|גולד\s*ג\S*ם|gold'?s\s*gym|icon|אנרג\S*ם|קאנטרי|fitness|כושר/i },
];

function classify(merchant: string): { key: string; label: string } | null {
  for (const g of SERVICE_GROUPS) if (g.re.test(merchant)) return { key: g.key, label: g.label };
  return null;
}

export interface ServiceGroup {
  key: string;
  label: string;
  monthlyCost: number;
  merchants: Array<{ merchant: string; monthlyCost: number; total: number; count: number }>;
  overlapping: boolean;
}

export interface Recommendation {
  kind: 'overlap' | 'top-category' | 'recurring' | 'rare' | 'spike-fee';
  title: string;
  detail: string;
  monthlySaving: number; // 0 if not a direct saving
}

export interface RecommendationReport {
  currency: string;
  monthsAnalyzed: number;
  totalMonthlySpend: number;
  topCategories: Array<{ category: string; monthlyAvg: number; pct: number; count: number }>;
  recurring: RecurringItem[];
  recurringMonthly: number;
  recurringAnnual: number;
  serviceGroups: ServiceGroup[];
  recommendations: Recommendation[];
  potentialMonthlySavings: number;
}

export function buildRecommendations(): RecommendationReport {
  const expenses = allPrimary().filter((t) => t.amount < 0 && t.category !== 'Transfers');
  const currency = mostCommonCurrency(expenses);
  const scoped = expenses.filter((t) => t.currency === currency);

  // Months covered by the data (at least 1).
  const dates = scoped.map((t) => t.date).sort();
  const monthsAnalyzed = dates.length
    ? Math.max(1, Math.round((Date.parse(dates[dates.length - 1]!) - Date.parse(dates[0]!)) / MS_DAY / 30.44) + 1)
    : 1;
  const perMonth = (total: number): number => total / monthsAnalyzed;

  const totalSpend = scoped.reduce((s, t) => s + mag(t), 0);
  const totalMonthlySpend = perMonth(totalSpend);

  // Where the money goes: top categories (monthly average).
  const catMap = new Map<string, { amount: number; count: number }>();
  for (const t of scoped) {
    const k = t.category ?? 'Uncategorized';
    const e = catMap.get(k) ?? { amount: 0, count: 0 };
    e.amount += mag(t);
    e.count++;
    catMap.set(k, e);
  }
  const topCategories = [...catMap.entries()]
    .map(([category, v]) => ({ category, monthlyAvg: perMonth(v.amount), pct: totalSpend ? (v.amount / totalSpend) * 100 : 0, count: v.count }))
    .sort((a, b) => b.monthlyAvg - a.monthlyAvg);

  // Recurring subscriptions.
  const recurring = detectRecurring().filter((r) => r.currency === currency);
  const recurringMonthly = recurring.reduce((s, r) => s + r.monthlyCost, 0);

  // Service-type buckets (from all merchants, monthly-normalized).
  const merchMap = new Map<string, { total: number; count: number }>();
  for (const t of scoped) {
    const m = t.merchantNormalized || t.merchantRaw;
    if (!m) continue;
    const e = merchMap.get(m) ?? { total: 0, count: 0 };
    e.total += mag(t);
    e.count++;
    merchMap.set(m, e);
  }
  const groupMap = new Map<string, ServiceGroup>();
  for (const [merchant, v] of merchMap) {
    const g = classify(merchant);
    if (!g) continue;
    const sg = groupMap.get(g.key) ?? { key: g.key, label: g.label, monthlyCost: 0, merchants: [], overlapping: false };
    sg.merchants.push({ merchant, monthlyCost: perMonth(v.total), total: v.total, count: v.count });
    sg.monthlyCost += perMonth(v.total);
    groupMap.set(g.key, sg);
  }
  const serviceGroups = [...groupMap.values()]
    .map((sg) => {
      sg.merchants.sort((a, b) => b.monthlyCost - a.monthlyCost);
      sg.overlapping = sg.merchants.length >= 2;
      return sg;
    })
    .sort((a, b) => b.monthlyCost - a.monthlyCost);

  // Recommendations.
  const recs: Recommendation[] = [];

  // 1) Overlapping services of the same type — drop all but the biggest.
  for (const sg of serviceGroups.filter((s) => s.overlapping)) {
    const keep = sg.merchants[0]!.monthlyCost;
    const saving = sg.monthlyCost - keep;
    recs.push({
      kind: 'overlap',
      title: `${sg.merchants.length} overlapping ${sg.label}`,
      detail: `${sg.merchants.map((m) => shortMerchant(m.merchant)).join(', ')} — together ${money(sg.monthlyCost, currency)}/mo. Keeping just the one you use most could save about ${money(saving, currency)}/mo.`,
      monthlySaving: saving,
    });
  }

  // 2) Biggest fixed monthly cost.
  if (recurring.length) {
    const top = recurring.slice(0, 3);
    recs.push({
      kind: 'recurring',
      title: `Fixed subscriptions cost ${money(recurringMonthly, currency)}/mo`,
      detail: `That's ${money(recurringMonthly * 12, currency)}/yr. Biggest: ${top.map((r) => `${shortMerchant(r.merchant)} (${money(r.monthlyCost, currency)}/mo)`).join(', ')}.`,
      monthlySaving: 0,
    });
  }

  // 3) Rarely-worth-it: recurring charges not seen recently (possibly forgotten).
  const newest = dates.length ? dates[dates.length - 1]! : '';
  for (const r of recurring) {
    const daysSince = newest ? (Date.parse(newest) - Date.parse(r.lastDate)) / MS_DAY : 0;
    if (daysSince > r.intervalDays * 2.5 && daysSince > 45) {
      recs.push({
        kind: 'rare',
        title: `${shortMerchant(r.merchant)} may be a forgotten subscription`,
        detail: `Last charge ${r.lastDate} (${Math.round(daysSince)} days ago) but it billed every ~${r.intervalDays} days. If unused, cancelling saves ${money(r.monthlyCost, currency)}/mo.`,
        monthlySaving: r.monthlyCost,
      });
    }
  }

  // 4) Spend concentration.
  if (topCategories.length && topCategories[0]!.pct >= 25 && topCategories[0]!.category !== 'Uncategorized') {
    const c = topCategories[0]!;
    recs.push({
      kind: 'top-category',
      title: `${c.category} is ${c.pct.toFixed(0)}% of your spending`,
      detail: `About ${money(c.monthlyAvg, currency)}/mo goes to ${c.category}. It's your biggest bucket — the easiest place to trim.`,
      monthlySaving: 0,
    });
  }

  recs.sort((a, b) => b.monthlySaving - a.monthlySaving);
  const potentialMonthlySavings = recs.reduce((s, r) => s + r.monthlySaving, 0);

  return {
    currency,
    monthsAnalyzed,
    totalMonthlySpend,
    topCategories: topCategories.slice(0, 8),
    recurring,
    recurringMonthly,
    recurringAnnual: recurringMonthly * 12,
    serviceGroups,
    recommendations: recs,
    potentialMonthlySavings,
  };
}

function mostCommonCurrency(txns: Transaction[]): string {
  const c = new Map<string, number>();
  for (const t of txns) c.set(t.currency, (c.get(t.currency) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'ILS';
}

function shortMerchant(m: string): string {
  return m.length > 24 ? m.slice(0, 24) + '…' : m;
}

function money(n: number, currency: string): string {
  const sym = currency === 'ILS' ? '₪' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '';
  return `${sym}${Math.round(n).toLocaleString('en-US')}`;
}
