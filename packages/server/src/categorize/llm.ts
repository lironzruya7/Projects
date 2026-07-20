import { anthropicConfigured, config } from '../config.js';
import { getDb, getSetting } from '../db/db.js';
import { upsertMerchantRule } from './rules.js';

const VALID_CATEGORIES = () =>
  (getDb().prepare(`SELECT name FROM categories ORDER BY display_order`).all() as Array<{ name: string }>).map(
    (r) => r.name,
  );

export function llmEnabled(): boolean {
  const s = getSetting<{ enabled: boolean }>('llm', { enabled: false });
  return Boolean(s.enabled) && anthropicConfigured();
}

/**
 * Classify a batch of normalized merchant names into categories via the
 * Anthropic API. ONLY merchant names are sent — never amounts or statements.
 * Each result is cached as an exact-match rule so a merchant is asked once.
 */
export async function classifyMerchants(merchants: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const clean = [...new Set(merchants.map((m) => m.trim()).filter(Boolean))];
  if (clean.length === 0) return out;
  if (!llmEnabled()) throw new Error('LLM categorization is disabled or ANTHROPIC_API_KEY is missing');

  const categories = VALID_CATEGORIES();
  const system =
    `You are a strict transaction categorizer for a personal finance app. ` +
    `Given merchant names (Hebrew or English), assign each to EXACTLY ONE of these categories: ` +
    `${categories.join(', ')}. Respond ONLY with a JSON object mapping each input merchant ` +
    `string to a category string. No prose.`;
  const user = `Merchants:\n${clean.map((m) => `- ${m}`).join('\n')}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (data.content ?? []).map((c) => c.text ?? '').join('');
  const parsed = extractJson(text);

  const valid = new Set(categories);
  for (const [merchant, category] of Object.entries(parsed)) {
    if (typeof category !== 'string') continue;
    const cat = valid.has(category) ? category : 'Other';
    out[merchant] = cat;
    upsertMerchantRule(merchant, cat, 'llm');
  }
  return out;
}

function extractJson(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return {};
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
}
