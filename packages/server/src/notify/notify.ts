import { getSetting } from '../db/db.js';
import { buildForecast, buildUpcoming, detectAnomalies, detectRecurring } from '../insights/insights.js';

const CUR_SYMBOL: Record<string, string> = { ILS: '₪', USD: '$', EUR: '€', GBP: '£' };
function formatMoney(amount: number, currency: string): string {
  const sym = CUR_SYMBOL[currency] ?? currency + ' ';
  return `${amount < 0 ? '-' : ''}${sym}${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Outbound push notifications. NO third-party npm dependency — a plain HTTPS POST
 * to a channel the owner configures. Off by default. Privacy: the recommended
 * channel is a **self-hosted ntfy on the tailnet**; ntfy.sh (public) and Telegram
 * are cloud services, so sending financial data there is an explicit owner
 * opt-in. `includeAmounts=false` keeps messages to counts/labels only.
 */
export interface NotifyConfig {
  enabled: boolean;
  channel: 'ntfy' | 'telegram' | 'webhook';
  url: string; // ntfy topic URL (e.g. https://ntfy.my-tailnet/finance) or generic webhook URL
  telegramBotToken: string;
  telegramChatId: string;
  includeAmounts: boolean;
}

const DEFAULT: NotifyConfig = {
  enabled: false,
  channel: 'ntfy',
  url: '',
  telegramBotToken: '',
  telegramChatId: '',
  includeAmounts: true,
};

export function getNotifyConfig(): NotifyConfig {
  return { ...DEFAULT, ...getSetting<Partial<NotifyConfig>>('notify', {}) };
}

export interface SendResult {
  ok: boolean;
  status?: number;
  detail?: string;
}

/** Send one notification through the configured channel. No-op if disabled. */
export async function sendNotification(title: string, message: string, priority = 3): Promise<SendResult> {
  const cfg = getNotifyConfig();
  if (!cfg.enabled) return { ok: false, detail: 'notifications disabled' };
  return sendVia(cfg, title, message, priority);
}

/** Send a one-off test message with an explicit config (used by the settings UI). */
export async function sendTest(cfg: NotifyConfig): Promise<SendResult> {
  return sendVia(cfg, 'Finance test', 'If you can read this, notifications are wired up. ✅', 3);
}

async function sendVia(cfg: NotifyConfig, title: string, message: string, priority: number): Promise<SendResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    if (cfg.channel === 'ntfy') {
      if (!cfg.url) return { ok: false, detail: 'ntfy URL not set' };
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { Title: encodeHeader(title), Priority: String(priority) },
        body: message,
        signal: ctrl.signal,
      });
      return { ok: res.ok, status: res.status, detail: res.ok ? undefined : await safeText(res) };
    }
    if (cfg.channel === 'telegram') {
      if (!cfg.telegramBotToken || !cfg.telegramChatId) return { ok: false, detail: 'telegram token/chat not set' };
      const res = await fetch(`https://api.telegram.org/bot${cfg.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.telegramChatId, text: `*${title}*\n${message}`, parse_mode: 'Markdown' }),
        signal: ctrl.signal,
      });
      return { ok: res.ok, status: res.status, detail: res.ok ? undefined : await safeText(res) };
    }
    // generic webhook
    if (!cfg.url) return { ok: false, detail: 'webhook URL not set' };
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, message }),
      signal: ctrl.signal,
    });
    return { ok: res.ok, status: res.status, detail: res.ok ? undefined : await safeText(res) };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

// ntfy sends the Title as an HTTP header — strip anything that can't live there.
function encodeHeader(s: string): string {
  return s.replace(/[\r\n]/g, ' ').replace(/[^\x20-\x7e]/g, '').slice(0, 120) || 'Finance';
}
async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Compose a concise spending digest. Summary-level by design; amounts are omitted
 * when `includeAmounts` is false so a cloud channel never carries figures.
 */
export function composeDigest(): { title: string; message: string } {
  const base = getSetting<string>('currency', 'ILS');
  const cfg = getNotifyConfig();
  const money = (n: number): string => (cfg.includeAmounts ? formatMoney(n, base) : '••');
  const f = buildForecast(base);
  const anomalies = detectAnomalies();
  const upcoming = buildUpcoming(14);
  const hikes = detectRecurring().filter((r) => r.priceChangePct != null && r.priceChangePct > 0);

  const lines: string[] = [];
  lines.push(`Spent so far this month: ${money(f.monthToDate.spend)}`);
  lines.push(`Safe to spend/day: ${money(f.safeToSpendPerDay)} (${f.daysLeftInMonth} days left)`);
  if (f.projectedEndBalance != null) lines.push(`Projected end-of-month balance: ${money(f.projectedEndBalance)}`);
  if (upcoming.items.length) lines.push(`Bills due in 14 days: ${upcoming.items.length} (${money(upcoming.total)})`);
  if (hikes.length) lines.push(`⚠️ ${hikes.length} subscription price increase(s): ${hikes.map((h) => h.merchant).slice(0, 3).join(', ')}`);
  if (anomalies.length) lines.push(`🔎 ${anomalies.length} anomaly flag(s) to review`);

  return { title: '💰 Weekly finance digest', message: lines.join('\n') };
}
