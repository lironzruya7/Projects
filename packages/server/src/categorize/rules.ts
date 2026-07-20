import { randomUUID } from 'node:crypto';
import { getDb, nowIso } from '../db/db.js';

export interface CategoryRule {
  id: string;
  pattern: string;
  match_type: 'exact' | 'contains' | 'regex';
  category: string;
  source: 'user' | 'llm' | 'seed';
  priority: number;
  created_at: string;
}

/** Load all rules ordered by priority desc, then by specificity (longer pattern first). */
export function loadRules(): CategoryRule[] {
  const rows = getDb()
    .prepare(`SELECT * FROM category_rules ORDER BY priority DESC, length(pattern) DESC`)
    .all() as CategoryRule[];
  return rows;
}

/**
 * Resolve a category for a normalized merchant using the rules table.
 * Returns null if nothing matches.
 */
export function categorizeByRules(
  merchantNormalized: string,
  rules: CategoryRule[] = loadRules(),
): string | null {
  const m = merchantNormalized.trim();
  if (!m) return null;
  for (const rule of rules) {
    if (matches(m, rule)) return rule.category;
  }
  return null;
}

function matches(merchant: string, rule: CategoryRule): boolean {
  const pattern = rule.pattern.toLowerCase().trim();
  if (!pattern) return false;
  switch (rule.match_type) {
    case 'exact':
      return merchant === pattern;
    case 'regex':
      try {
        return new RegExp(rule.pattern, 'i').test(merchant);
      } catch {
        return false;
      }
    case 'contains':
    default:
      return merchant.includes(pattern);
  }
}

export function addRule(input: {
  pattern: string;
  category: string;
  matchType?: 'exact' | 'contains' | 'regex';
  source?: 'user' | 'llm' | 'seed';
  priority?: number;
}): CategoryRule {
  const rule: CategoryRule = {
    id: randomUUID(),
    pattern: input.pattern.trim(),
    match_type: input.matchType ?? 'contains',
    category: input.category,
    source: input.source ?? 'user',
    priority: input.priority ?? (input.matchType === 'exact' ? 200 : 100),
    created_at: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO category_rules (id, pattern, match_type, category, source, priority, created_at)
       VALUES (@id, @pattern, @match_type, @category, @source, @priority, @created_at)`,
    )
    .run(rule);
  return rule;
}

export function deleteRule(id: string): void {
  getDb().prepare(`DELETE FROM category_rules WHERE id = ?`).run(id);
}

/**
 * Upsert an exact-match rule for a merchant (used when the user manually
 * recategorizes, or when the LLM classifies a merchant). One rule per merchant.
 */
export function upsertMerchantRule(
  merchantNormalized: string,
  category: string,
  source: 'user' | 'llm',
): CategoryRule | null {
  const m = merchantNormalized.trim();
  if (!m) return null;
  const db = getDb();
  const existing = db
    .prepare(`SELECT * FROM category_rules WHERE pattern = ? AND match_type = 'exact'`)
    .get(m) as CategoryRule | undefined;
  if (existing) {
    db.prepare(`UPDATE category_rules SET category = ?, source = ? WHERE id = ?`).run(
      category,
      source,
      existing.id,
    );
    return { ...existing, category, source };
  }
  return addRule({ pattern: m, category, matchType: 'exact', source, priority: 200 });
}
