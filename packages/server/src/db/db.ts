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
  _db = db;
  seed(db);
  return db;
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
    ['Housing', 50],
    ['Shopping', 60],
    ['Health', 70],
    ['Entertainment', 80],
    ['Subscriptions', 90],
    ['Travel', 100],
    ['Fees', 110],
    ['Income', 120],
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
      maxResults: 50,
      lookbackDays: 90,
    },
    anomaly: { newMerchantWindowDays: 60, spikeMultiplier: 2.5 },
  };
  const getSetting = db.prepare(`SELECT value FROM settings WHERE key = ?`);
  const putSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  const seedSettings = db.transaction(() => {
    for (const [key, val] of Object.entries(defaults)) {
      if (!getSetting.get(key)) putSetting.run(key, JSON.stringify(val));
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
