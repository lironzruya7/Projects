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
  // Bind address. Defaults to 127.0.0.1 (local-only) — the safe default for
  // financial PII: `tailscale serve` proxies the tailnet to 127.0.0.1, so the app
  // is fully reachable over the tailnet without ever listening on a public
  // interface. Only /api/export.json is token-protected; the rest of the API is
  // NOT, so do not bind 0.0.0.0 unless you also firewall the port to your tailnet
  // (e.g. `ufw allow in on tailscale0 to any port 4000`). Reach the app by IP
  // (not `tailscale serve`)? Then set HOST=0.0.0.0 AND add that firewall rule.
  host: envStr('HOST', '127.0.0.1'),
  // Bearer token for the read-only external export at GET /api/export.json.
  // When empty, that endpoint returns 401 for everyone.
  readToken: envStr('FINANCE_READ_TOKEN'),
  // Serve the built frontend from the backend (single origin) when its dist exists.
  // Forced on when NODE_ENV=production.
  production: envStr('NODE_ENV') === 'production',
  webDist: resolve(repoRoot, 'packages/web/dist'),
  databasePath: resolve(repoRoot, envStr('DATABASE_PATH', './data/finance.sqlite')),
  // Manually-attached receipts are stored here (next to the DB file).
  attachmentsDir: resolve(dirname(resolve(repoRoot, envStr('DATABASE_PATH', './data/finance.sqlite'))), 'attachments'),
  defaultCurrency: envStr('DEFAULT_CURRENCY', 'ILS'),
  tokenEncryptionKey: envStr('TOKEN_ENCRYPTION_KEY'),
  // Optional local directory of tesseract *.traineddata files. When set, OCR
  // runs fully offline (no CDN download). Leave empty to fetch on first use.
  tessdataPath: envStr('TESSDATA_PATH'),
  // Optional Chromium path for the bank/card scraper. Leave empty to use the
  // browser puppeteer installs automatically.
  puppeteerExecutablePath: envStr('PUPPETEER_EXECUTABLE_PATH'),
  // Scraper navigation timeout (ms) and an optional proxy for the scraper's
  // browser (e.g. an Israeli proxy when the VPS IP is geo-blocked).
  scrapeTimeoutMs: Number(envStr('SCRAPE_TIMEOUT_MS', '120000')),
  scrapeProxy: envStr('SCRAPE_PROXY'),
  // Run the scraper's browser in headful mode (needs a display, e.g. xvfb) to
  // dodge headless bot-detection. Failure screenshots are written here.
  scrapeShowBrowser: envStr('SCRAPE_SHOW_BROWSER') === 'true',
  scrapeDebugDir: resolve(dirname(resolve(repoRoot, envStr('DATABASE_PATH', './data/finance.sqlite'))), 'scrape-debug'),
  gmail: {
    clientId: envStr('GMAIL_CLIENT_ID'),
    clientSecret: envStr('GMAIL_CLIENT_SECRET'),
    redirectUri: envStr('GMAIL_REDIRECT_URI', 'http://localhost:4000/api/email/gmail/callback'),
  },
  outlook: {
    clientId: envStr('OUTLOOK_CLIENT_ID'),
    clientSecret: envStr('OUTLOOK_CLIENT_SECRET'),
    redirectUri: envStr('OUTLOOK_REDIRECT_URI', 'http://localhost:4000/api/email/outlook/callback'),
    // 'common' = work + personal accounts, 'consumers' = personal only, or a tenant id.
    tenant: envStr('OUTLOOK_TENANT', 'common'),
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

export function outlookConfigured(): boolean {
  return Boolean(config.outlook.clientId && config.outlook.clientSecret);
}

export function anthropicConfigured(): boolean {
  return Boolean(config.anthropic.apiKey);
}

export function imapConfigured(): boolean {
  return Boolean(config.imap.host && config.imap.user && config.imap.password);
}
