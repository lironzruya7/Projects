import { getDb, nowIso } from '../db/db.js';
import { decryptSecret, encryptSecret } from '../util/crypto.js';

interface TokenRow {
  provider: string;
  token_json: string;
  encrypted: number;
  created_at: string;
  updated_at: string;
}

export function saveToken(provider: string, token: unknown): void {
  const { value, encrypted } = encryptSecret(JSON.stringify(token));
  getDb()
    .prepare(
      `INSERT INTO oauth_tokens (provider, token_json, encrypted, created_at, updated_at)
       VALUES (@provider, @token_json, @encrypted, @now, @now)
       ON CONFLICT(provider) DO UPDATE SET token_json = @token_json, encrypted = @encrypted, updated_at = @now`,
    )
    .run({ provider, token_json: value, encrypted: encrypted ? 1 : 0, now: nowIso() });
}

export function loadToken<T = unknown>(provider: string): T | null {
  const row = getDb().prepare(`SELECT * FROM oauth_tokens WHERE provider = ?`).get(provider) as
    | TokenRow
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(decryptSecret(row.token_json, row.encrypted === 1)) as T;
  } catch {
    return null;
  }
}

export function deleteToken(provider: string): void {
  getDb().prepare(`DELETE FROM oauth_tokens WHERE provider = ?`).run(provider);
}

export function hasToken(provider: string): boolean {
  return Boolean(getDb().prepare(`SELECT 1 FROM oauth_tokens WHERE provider = ?`).get(provider));
}
