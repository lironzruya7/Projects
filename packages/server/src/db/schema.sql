-- Finance Aggregator — SQLite schema
-- All amounts are stored SIGNED: negative = outflow (expense/debit),
-- positive = inflow (income/credit). Magnitudes are compared for dedup.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Every imported source (a file upload, or an email scan run).
CREATE TABLE IF NOT EXISTS import_batches (
  id            TEXT PRIMARY KEY,
  source_type   TEXT NOT NULL,            -- 'email' | 'bank' | 'card'
  source_provider TEXT,                   -- 'yahav' | 'isracard' | 'cal' | 'gmail' | ...
  filename      TEXT,
  signature     TEXT,                     -- header fingerprint for files
  row_count     INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    TEXT NOT NULL
);

-- The raw normalized rows. One per source row / email / attachment.
-- The de-duplicated ledger = rows where merged_into IS NULL.
CREATE TABLE IF NOT EXISTS transactions (
  id                TEXT PRIMARY KEY,
  date              TEXT NOT NULL,        -- ISO yyyy-mm-dd (value/charge date)
  posted_at         TEXT,                 -- optional full datetime
  amount            REAL NOT NULL,        -- signed; negative = outflow
  currency          TEXT NOT NULL,
  merchant_raw      TEXT NOT NULL DEFAULT '',
  merchant_normalized TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  category          TEXT,                 -- resolved category (nullable = uncategorized)
  category_source   TEXT NOT NULL DEFAULT 'none', -- 'rule' | 'manual' | 'llm' | 'none'
  source_type       TEXT NOT NULL,        -- 'email' | 'bank' | 'card'
  source_provider   TEXT,
  source_ref        TEXT,                 -- email id / attachment name / "file.csv#row"
  external_id       TEXT,                 -- invoice / order number
  import_batch      TEXT REFERENCES import_batches(id) ON DELETE CASCADE,
  raw_amount        TEXT,                 -- original amount string, for provenance
  raw_json          TEXT,                 -- original row / extracted fields (JSON)
  merged_into       TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_txn_merged ON transactions(merged_into);
CREATE INDEX IF NOT EXISTS idx_txn_merchant ON transactions(merchant_normalized);
CREATE INDEX IF NOT EXISTS idx_txn_batch ON transactions(import_batch);

-- Remembered column mappings, keyed by header signature.
CREATE TABLE IF NOT EXISTS column_mappings (
  signature       TEXT PRIMARY KEY,
  provider        TEXT,
  source_type     TEXT,                   -- 'bank' | 'card'
  mapping_json    TEXT NOT NULL,          -- { date, amount, debit, credit, description, merchant, currency, type }
  date_format     TEXT,                   -- 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'auto' ...
  amount_mode     TEXT,                   -- 'signed' | 'debit_credit' | 'magnitude_type' | 'flip_sign'
  header_row      INTEGER NOT NULL DEFAULT 0,
  label           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  name          TEXT PRIMARY KEY,
  display_order INTEGER NOT NULL DEFAULT 100,
  color         TEXT,
  is_builtin    INTEGER NOT NULL DEFAULT 0
);

-- merchant_normalized -> category rules. Evaluated by priority (desc), then specificity.
CREATE TABLE IF NOT EXISTS category_rules (
  id          TEXT PRIMARY KEY,
  pattern     TEXT NOT NULL,
  match_type  TEXT NOT NULL DEFAULT 'contains', -- 'exact' | 'contains' | 'regex'
  category    TEXT NOT NULL REFERENCES categories(name) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT 'user',      -- 'user' | 'llm' | 'seed'
  priority    INTEGER NOT NULL DEFAULT 100,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rules_pattern ON category_rules(pattern);

-- Suspected true double-charges (same merchant billed twice). NOT merged.
CREATE TABLE IF NOT EXISTS double_charge_alerts (
  id          TEXT PRIMARY KEY,
  txn_a       TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  txn_b       TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  amount      REAL NOT NULL,
  merchant    TEXT NOT NULL,
  date_a      TEXT NOT NULL,
  date_b      TEXT NOT NULL,
  similarity  REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',      -- 'open' | 'confirmed' | 'dismissed'
  created_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_pair ON double_charge_alerts(txn_a, txn_b);

-- Key/value settings (JSON values).
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- OAuth / IMAP tokens, optionally encrypted at rest.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  provider   TEXT PRIMARY KEY,            -- 'gmail'
  token_json TEXT NOT NULL,
  encrypted  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
