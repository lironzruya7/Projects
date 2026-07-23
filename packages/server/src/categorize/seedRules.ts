import { getDb, nowIso } from '../db/db.js';
import { randomUUID } from 'node:crypto';

/**
 * Curated starter rules for common Israeli (and global) merchants, so the ledger
 * is usefully categorized out of the box instead of a wall of "Uncategorized".
 *
 * All seeded at a LOW priority (below user rules at 100/200), so any manual
 * correction or user rule always wins. Rules are matched most-specific-first
 * (longer pattern first), so e.g. "סופר פארם" (Health) beats "סופר" (Groceries).
 * Patterns are matched (case-insensitively) as substrings of the normalized
 * merchant name; include both Hebrew and Latin spellings a merchant may appear as.
 */
const SEED_PRIORITY = 50;

type Seed = [pattern: string, category: string];

export const SEED_RULES: Seed[] = [
  // Groceries
  ['רמי לוי', 'Groceries'], ['שופרסל', 'Groceries'], ['ויקטורי', 'Groceries'],
  ['יינות ביתן', 'Groceries'], ['טיב טעם', 'Groceries'], ['אושר עד', 'Groceries'],
  ['יוחננוף', 'Groceries'], ['חצי חינם', 'Groceries'], ['זול ובגדול', 'Groceries'],
  ['מחסני מזון', 'Groceries'], ['am:pm', 'Groceries'], ['ampm', 'Groceries'],
  ['shufersal', 'Groceries'], ['tiv taam', 'Groceries'], ['carrefour', 'Groceries'],
  ['קרפור', 'Groceries'], ['סופרמרקט', 'Groceries'], ['מעדניה', 'Groceries'],
  // Dining
  ['wolt', 'Dining'], ['וולט', 'Dining'], ['10bis', 'Dining'], ['תן ביס', 'Dining'],
  ['cibus', 'Dining'], ['סיבוס', 'Dining'], ['מקדונלד', 'Dining'], ['mcdonald', 'Dining'],
  ['בורגר', 'Dining'], ['burger', 'Dining'], ['kfc', 'Dining'], ['דומינו', 'Dining'],
  ['pizza', 'Dining'], ['פיצה', 'Dining'], ['ארומה', 'Dining'], ['aroma', 'Dining'],
  ['cofix', 'Dining'], ['קופיקס', 'Dining'], ['גולדה', 'Dining'], ['רולדין', 'Dining'],
  ['לנדוור', 'Dining'], ['landwer', 'Dining'], ['מסעדה', 'Dining'], ['restaurant', 'Dining'],
  // Transport
  ['פז', 'Transport'], ['סונול', 'Transport'], ['sonol', 'Transport'], ['דור אלון', 'Transport'],
  ['פנגו', 'Transport'], ['pango', 'Transport'], ['סלופארק', 'Transport'], ['cellopark', 'Transport'],
  ['רב קו', 'Transport'], ['רב-קו', 'Transport'], ['רכבת ישראל', 'Transport'], ['אגד', 'Transport'],
  ['egged', 'Transport'], ['gett', 'Transport'], ['uber', 'Transport'], ['אובר', 'Transport'],
  ['yango', 'Transport'], ['יאנגו', 'Transport'], ['חניון', 'Transport'], ['כביש 6', 'Transport'],
  ['דלק חברת', 'Transport'], ['delek', 'Transport'],
  // Utilities / telecom
  ['חברת חשמל', 'Utilities'], ['בזק', 'Utilities'], ['bezeq', 'Utilities'], ['סלקום', 'Utilities'],
  ['cellcom', 'Utilities'], ['פרטנר', 'Utilities'], ['partner', 'Utilities'], ['הוט', 'Utilities'],
  ['פלאפון', 'Utilities'], ['pelephone', 'Utilities'], ['גולן טלקום', 'Utilities'], ['golan', 'Utilities'],
  ['we4g', 'Utilities'], ['רמי לוי תקשורת', 'Utilities'], ['hot mobile', 'Utilities'], ['019', 'Utilities'],
  ['yes ', 'Utilities'], ['מקורות', 'Utilities'],
  // Cost of Living (mandatory)
  ['ארנונה', 'Cost of Living'], ['עיריית', 'Cost of Living'], ['עירית', 'Cost of Living'],
  // Housing
  ['ועד בית', 'Housing'], ['שכר דירה', 'Housing'], ['ביטוח דירה', 'Housing'],
  // Health
  ['סופר פארם', 'Health'], ['super-pharm', 'Health'], ['superpharm', 'Health'], ['ניו פארם', 'Health'],
  ['new pharm', 'Health'], ['מכבי', 'Health'], ['maccabi', 'Health'], ['כללית', 'Health'],
  ['clalit', 'Health'], ['מאוחדת', 'Health'], ['קופת חולים', 'Health'], ['בית מרקחת', 'Health'],
  ['pharmacy', 'Health'], ['מרפאת', 'Health'], ['אופטיק', 'Health'],
  // Shopping
  ['איקאה', 'Shopping'], ['ikea', 'Shopping'], ['zara', 'Shopping'], ['castro', 'Shopping'],
  ['קסטרו', 'Shopping'], ['terminal x', 'Shopping'], ['terminalx', 'Shopping'], ['aliexpress', 'Shopping'],
  ['עלי אקספרס', 'Shopping'], ['amazon', 'Shopping'], ['אמזון', 'Shopping'], ['ebay', 'Shopping'],
  ['ksp', 'Shopping'], ['קספ', 'Shopping'], ['מחסני חשמל', 'Shopping'], ['shein', 'Shopping'],
  ['שיין', 'Shopping'], ['רנואר', 'Shopping'], ['h&m', 'Shopping'], ['mango', 'Shopping'],
  ['גולף', 'Shopping'], ['fox home', 'Shopping'],
  // Subscriptions (streaming / software / AI)
  ['netflix', 'Subscriptions'], ['נטפליקס', 'Subscriptions'], ['spotify', 'Subscriptions'],
  ['youtube', 'Subscriptions'], ['disney', 'Subscriptions'], ['apple.com', 'Subscriptions'],
  ['apple services', 'Subscriptions'], ['itunes', 'Subscriptions'], ['icloud', 'Subscriptions'],
  ['google storage', 'Subscriptions'], ['chatgpt', 'Subscriptions'], ['openai', 'Subscriptions'],
  ['anthropic', 'Subscriptions'], ['claude', 'Subscriptions'], ['midjourney', 'Subscriptions'],
  ['microsoft', 'Subscriptions'], ['office 365', 'Subscriptions'], ['hbo', 'Subscriptions'],
  ['audible', 'Subscriptions'], ['patreon', 'Subscriptions'], ['github', 'Subscriptions'],
  ['notion', 'Subscriptions'], ['canva', 'Subscriptions'], ['adobe', 'Subscriptions'],
  ['dropbox', 'Subscriptions'], ['tradingview', 'Subscriptions'], ['roblox', 'Subscriptions'],
  ['tryhackme', 'Subscriptions'],
  // Entertainment
  ['yes planet', 'Entertainment'], ['סינמה סיטי', 'Entertainment'], ['cinema', 'Entertainment'],
  ['רב חן', 'Entertainment'], ['גלובוס', 'Entertainment'], ['הבימה', 'Entertainment'],
  ['לונה פארק', 'Entertainment'], ['steam', 'Entertainment'],
  // Travel
  ['booking.com', 'Travel'], ['booking', 'Travel'], ['airbnb', 'Travel'], ['אל על', 'Travel'],
  ['el al', 'Travel'], ['ryanair', 'Travel'], ['wizz', 'Travel'], ['ארקיע', 'Travel'],
  ['ישראייר', 'Travel'], ['expedia', 'Travel'], ['מלון', 'Travel'], ['hotel', 'Travel'],
];

/**
 * Insert any missing seed rules (idempotent). Returns how many were newly added,
 * so the caller can decide whether to re-apply rules to existing transactions.
 */
export function seedCategoryRules(): number {
  const db = getDb();
  const exists = db.prepare(
    `SELECT 1 FROM category_rules WHERE pattern = ? AND match_type = 'contains' AND source = 'seed'`,
  );
  const insert = db.prepare(
    `INSERT INTO category_rules (id, pattern, match_type, category, source, priority, created_at)
     VALUES (@id, @pattern, 'contains', @category, 'seed', @priority, @created_at)`,
  );
  let added = 0;
  const now = nowIso();
  const tx = db.transaction(() => {
    for (const [pattern, category] of SEED_RULES) {
      if (exists.get(pattern)) continue;
      insert.run({ id: randomUUID(), pattern, category, priority: SEED_PRIORITY, created_at: now });
      added++;
    }
  });
  tx();
  return added;
}
