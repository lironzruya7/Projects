import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env regardless of where the process is started from.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
for (const candidate of [resolve(repoRoot, '.env'), resolve(process.cwd(), '.env')]) {
  if (existsSync(candidate)) {
    loadEnv({ path: candidate });
    break;
  }
}

function envStr(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

export const config = {
  repoRoot,
  port: Number(envStr('PORT', '4000')),
  // Bind address. Default 127.0.0.1 (safe: only local + `tailscale serve`).
  // Set HOST=0.0.0.0 to listen on all interfaces (then firewall the port yourself).
  host: envStr('HOST', '127.0.0.1'),
  // Serve the built frontend from the backend (single origin) when its dist exists.
  // Forced on when NODE_ENV=production.
  production: envStr('NODE_ENV') === 'production',
  webDist: resolve(repoRoot, 'packages/web/dist'),
  databasePath: resolve(repoRoot, envStr('DATABASE_PATH', './data/finance.sqlite')),
  defaultCurrency: envStr('DEFAULT_CURRENCY', 'ILS'),
  tokenEncryptionKey: envStr('TOKEN_ENCRYPTION_KEY'),
  gmail: {
    clientId: envStr('GMAIL_CLIENT_ID'),
    clientSecret: envStr('GMAIL_CLIENT_SECRET'),
    redirectUri: envStr('GMAIL_REDIRECT_URI', 'http://localhost:4000/api/email/gmail/callback'),
  },
  imap: {
    host: envStr('IMAP_HOST'),
    port: Number(envStr('IMAP_PORT', '993')),
    user: envStr('IMAP_USER'),
    password: envStr('IMAP_PASSWORD'),
  },
  anthropic: {
    apiKey: envStr('ANTHROPIC_API_KEY'),
    model: envStr('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001'),
  },
} as const;

export function gmailConfigured(): boolean {
  return Boolean(config.gmail.clientId && config.gmail.clientSecret);
}

export function anthropicConfigured(): boolean {
  return Boolean(config.anthropic.apiKey);
}

export function imapConfigured(): boolean {
  return Boolean(config.imap.host && config.imap.user && config.imap.password);
}
