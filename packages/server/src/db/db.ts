import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(resolve(here, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate(db);
  _db = db;
  seed(db);
  return db;
}

/**
 * Additive migrations for existing databases. `CREATE TABLE IF NOT EXISTS` never
 * adds new columns to a table that already exists, so add them here idempotently.
 */
function migrate(db: Database.Database): void {
  const addColumn = (table: string, column: string, type: string): void => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  };
  addColumn('transactions', 'account_label', 'TEXT');
  addColumn('import_batches', 'account_label', 'TEXT');
  addColumn('import_batches', 'file_hash', 'TEXT'); // sha256 of the uploaded file, for duplicate-upload detection
  addColumn('import_batches', 'period', 'TEXT'); // YYYY-MM billing/spending month for card files
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Seed built-in categories, default rules, and default settings (idempotent). */
function seed(db: Database.Database): void {
  const builtinCategories: Array<[string, number]> = [
    ['Groceries', 10],
    ['Dining', 20],
    ['Transport', 30],
    ['Utilities', 40],
    ['Cost of Living', 45],
    ['Housing', 50],
    ['Shopping', 60],
    ['Health', 70],
    ['Entertainment', 80],
    ['Subscriptions', 90],
    ['Travel', 100],
    ['Fees', 110],
    ['Salary', 115],
    ['Income', 120],
    // Loans are real cash movements the user wants reflected in the totals (unlike
    // Transfers, which are internal and excluded): a Loan In counts as income, a
    // Loan Repayment counts as spend — but both are tagged "loan" in the UI.
    ['Loan In', 122],
    ['Loan Repayment', 124],
    ['Transfers', 130],
    ['Other', 140],
  ];
  const insertCat = db.prepare(
    `INSERT OR IGNORE INTO categories (name, display_order, is_builtin) VALUES (?, ?, 1)`,
  );
  const seedCats = db.transaction(() => {
    for (const [name, order] of builtinCategories) insertCat.run(name, order);
  });
  seedCats();

  // Default settings
  const defaults: Record<string, unknown> = {
    currency: config.defaultCurrency,
    dedup: { amountTolerancePct: 0.5, amountToleranceMinor: 1, dateWindowDays: 3, merchantThreshold: 0.85 },
    llm: { enabled: false },
    email: {
      keywords: ['invoice', 'receipt', 'order', 'payment', 'חשבונית', 'קבלה', 'תשלום', 'הזמנה'],
      senderDomains: [],
      maxResults: 200,
      lookbackDays: 90,
    },
    anomaly: { newMerchantWindowDays: 60, spikeMultiplier: 2.5 },
    notify: { enabled: false, channel: 'ntfy', url: '', telegramBotToken: '', telegramChatId: '', includeAmounts: true, largeChargeThreshold: 1000 },
  };
  const getSettingStmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
  const putSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  const updateSetting = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  const seedSettings = db.transaction(() => {
    for (const [key, val] of Object.entries(defaults)) {
      if (!getSettingStmt.get(key)) putSetting.run(key, JSON.stringify(val));
    }
    // One-time: raise the legacy email scan cap 50 -> 200 so 90-day scans aren't
    // truncated to the newest 50 emails. Guarded so it runs only once.
    if (!getSettingStmt.get('migr_email_max200')) {
      const row = getSettingStmt.get('email') as { value: string } | undefined;
      if (row) {
        try {
          const email = JSON.parse(row.value) as { maxResults?: number };
          if (email.maxResults === 50) updateSetting.run('email', JSON.stringify({ ...email, maxResults: 200 }));
        } catch {
          /* ignore malformed */
        }
      }
      putSetting.run('migr_email_max200', JSON.stringify(true));
    }
  });
  seedSettings();
}

export function getSetting<T = unknown>(key: string, fallback: T): T {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, JSON.stringify(value));
}
