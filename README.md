# Finance Aggregator

A **local-first** personal finance app that pulls spending data from three sources —
**email receipts/invoices** (incl. attachments), **bank exports**, and **credit-card
exports** — merges them into one clean transaction ledger, auto-categorizes everything,
collapses duplicate charges that appear across files, and shows a dashboard with insights.

Everything runs on your machine. Data lives in a local SQLite file. The only outbound
calls are to Gmail (read-only, if you connect it) and — only if you explicitly enable it —
the Anthropic API for categorizing unknown merchant names.

Tuned out of the box for **Bank Yahav (בנק יהב)**, **Isracard (ישראכרט)**, and
**Cal / Visa Cal (כאל)** exports, with full Hebrew / RTL handling.

---

## Quick start

```bash
# 1. Install (Node 20+)
npm install

# 2. (optional) configure Gmail / Anthropic / encryption
cp .env.example .env      # then edit — everything is optional

# 3. Run backend + frontend together
npm run dev
```

- Frontend: <http://localhost:5173>
- Backend API: <http://localhost:4000>

The database file is created automatically at `./data/finance.sqlite` on first run.

You can use the whole app — import, dedup, categorize, dashboard — **without any `.env`
at all**. The `.env` is only needed to unlock Gmail scanning and LLM categorization.

---

## How to use it

1. **Import** → upload a bank or card CSV/XLSX. Columns are auto-detected; adjust the
   mapping if needed and click *Import*. The mapping is remembered per file format, so the
   next export of the same shape imports in one click.
2. **Transactions** → the de-duplicated ledger. Click any category to change it (optionally
   creating a rule for that merchant). Rows marked `×N` were merged from several sources —
   expand to see (and un-merge) each one.
3. **Duplicates** → confirm or dismiss suspected *true* double charges (same merchant billed
   twice from the same source). Cross-file duplicates are merged automatically.
4. **Categories** → manage categories and the `merchant → category` rule table.
5. **Insights** → recurring/subscription detection (with next date + monthly/annual cost)
   and anomaly flags (spikes, brand-new merchants, possible double charges).
6. **Settings** → connect Gmail, tune duplicate matching, toggle AI categorization, export
   your data (JSON/CSV), or wipe everything.

---

## Project layout

```
packages/
  server/   Fastify + better-sqlite3 API (TypeScript, ESM)
    src/
      db/          SQLite schema + connection + settings
      models/      Zod schemas (the validation boundary)
      parsers/     encoding, amount, date, CSV/XLSX, PDF, OCR, receipt, templates
      normalize/   merchant normalization + fuzzy token-set matching
      categorize/  rule engine + optional LLM
      dedup/       cross-file merge + double-charge alerts
      insights/    dashboard, recurring, anomalies
      email/       Gmail API + IMAP fallback + scan pipeline
      repo/        DB access layer
      routes/      HTTP endpoints
  web/      React + Vite + Tailwind + Recharts UI
```

---

## Environment variables

All optional. See `.env.example` for the annotated template.

| Variable | Purpose |
| --- | --- |
| `DATABASE_PATH` | SQLite file location (default `./data/finance.sqlite`) |
| `PORT` | Backend port (default `4000`); the frontend proxies `/api` to it |
| `DEFAULT_CURRENCY` | Default ledger currency (default `ILS`) |
| `TOKEN_ENCRYPTION_KEY` | If set, OAuth tokens are AES-256-GCM encrypted at rest |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | Gmail OAuth client (read-only scope) |
| `GMAIL_REDIRECT_URI` | OAuth redirect (default `http://localhost:4000/api/email/gmail/callback`) |
| `IMAP_HOST` / `IMAP_PORT` / `IMAP_USER` / `IMAP_PASSWORD` | IMAP fallback instead of Gmail API |
| `ANTHROPIC_API_KEY` | Enables optional LLM categorization |
| `ANTHROPIC_MODEL` | Model id (default `claude-haiku-4-5-20251001`) |

---

## Google OAuth setup (Gmail scanning)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) → create/select a
   project.
2. **APIs & Services → Library** → enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen** → choose *External*, add your own Google
   account under **Test users** (keeps it in testing mode — no verification needed for
   personal use).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI:
     `http://localhost:4000/api/email/gmail/callback`
5. Copy the **Client ID** and **Client secret** into `.env`
   (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`), then restart `npm run dev`.
6. In the app: **Settings → Connect Gmail**, approve the read-only consent, then
   **Scan email now**.

The requested scope is `gmail.readonly` — the app can read messages/attachments but never
modify or send anything.

**IMAP alternative:** instead of the Gmail API, set `IMAP_HOST/PORT/USER/PASSWORD` (use an
app password). The scanner uses the same interface and pipeline.

## Microsoft / Outlook setup (Outlook.com & Microsoft 365)

Uses the Microsoft Graph API with a read-only `Mail.Read` scope. You can connect a Gmail
**and** an Outlook account at the same time — a scan can run both and merge the results.

1. Go to the [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** →
   **App registrations** → **New registration**.
2. Name it anything. Under **Supported account types**, choose
   *Accounts in any organizational directory and personal Microsoft accounts* (this maps to
   `OUTLOOK_TENANT=common`; pick *Personal Microsoft accounts only* → `consumers` if you only
   use outlook.com/hotmail).
3. **Redirect URI** → platform **Web** →
   `http://localhost:4000/api/email/outlook/callback`
   (on a VPS, use your `https://<vps>.<tailnet>.ts.net/api/email/outlook/callback`).
4. **Certificates & secrets → New client secret** → copy the secret **value**.
5. **API permissions → Add a permission → Microsoft Graph → Delegated →** `Mail.Read`
   (and `offline_access`, usually added automatically).
6. Put the **Application (client) ID** and the secret into `.env`
   (`OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, and `OUTLOOK_TENANT` if not `common`),
   restart, then **Settings → Outlook → Connect**.

The scope is `Mail.Read` (read-only) + `offline_access` (so the app can refresh its token).

### What the email scanner does

- Searches your inbox with configurable HE + EN keywords
  (`invoice, receipt, order, payment, חשבונית, קבלה, תשלום, הזמנה`) plus any sender domains
  you add (**Settings → Email scanning**).
- Parses the email body **and** downloads + parses attachments: text PDFs via `pdf-parse`,
  scanned images via `tesseract.js` OCR (Hebrew + English).
- Extracts merchant, date, total, currency, line items, and invoice/order number, and
  stores the source reference (`gmail:<id>` / attachment name) so every transaction is
  traceable back to its origin.
- Re-scans are idempotent — an email already imported is skipped.

> OCR language data (`tesseract.js`) downloads on first use. If your environment blocks
> that download, OCR is skipped gracefully and everything else still works. To run OCR
> **fully offline**, download `eng.traineddata` + `heb.traineddata` from
> [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) into a folder and set
> `TESSDATA_PATH` to it.
>
> **Scan a receipt:** the Import page has a "📷 Scan a receipt" button — photograph a paper
> receipt (camera on mobile) or pick a PDF. It's OCR'd, added to the ledger automatically,
> and de-duplicated against the matching card/email charge on its own.
>
> **Scanned PDFs:** a PDF with no text layer (a scanned image) is OCR'd by rendering its
> pages to images first, which needs **poppler-utils** on the machine:
> `sudo apt-get install poppler-utils` (provides `pdftoppm`). Optional — if it's missing,
> scanned PDFs are skipped with a log line and text PDFs / images still work.

---

## Direct bank / card connection (optional)

Pull transactions **straight from Bank Yahav / Isracard / Cal** — no CSV export — via
[`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers), which logs in
with your credentials using a headless browser, locally. Scraped charges carry the
transaction number, so they auto-merge with the email/receipt copies.

1. **Set `TOKEN_ENCRYPTION_KEY`** in `.env` so your bank credentials are encrypted at rest.
2. The scraper needs a Chromium. `npm install` downloads one automatically; on a small VPS
   you may prefer a system one: `sudo apt-get install -y chromium-browser` then set
   `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`. On a fresh server you may also need
   Chromium's shared libraries: `sudo apt-get install -y libnss3 libatk-bridge2.0-0 libgbm1 libasound2 libgtk-3-0`.
3. In the app: **Settings → Direct connection** → **Connect** a provider → enter credentials
   (Isracard: ID + last-6 card digits + password; Cal: username + password; Yahav: username +
   national ID + password) → **Save** → **Sync now**.

> Credentials never leave your machine. Some providers occasionally require a one-time code
> (OTP/2FA); if a sync reports that, tell me and I'll add the interactive step. This uses the
> banks' sites the way you would — it isn't an official API.

## Duplicate handling (the core logic)

Two **distinct** cases, never conflated:

- **(a) Cross-file duplicate** — the *same real purchase* seen in multiple files (e.g. the
  credit-card export, the bank export, and an email invoice). These are **merged into one
  ledger entry** that keeps the list of all its sources. Shown once; every total and count
  uses the de-duplicated set. Reversible from the Transactions page.
- **(b) Suspected true double charge** — the *merchant billed you twice* (two separate
  events from the same source). These are **never merged**; they surface as a
  *possible double charge* alert you can confirm or dismiss.

**Candidate matching** (all configurable in Settings):

- Amount equal within ±0.5% or ±1 minor unit (rounding tolerance).
- Date within ±3 days.
- Merchant fuzzy similarity ≥ 0.85 (token-set ratio).

**Decision:** candidates from *different source files/types* → case (a) merge; candidates
from the *same source* → case (b) alert.

---

## Categorization

1. **Rule engine first:** a user-editable `merchant_normalized → category` table
   (exact / contains / regex). Recategorizing a transaction can create a sticky rule for
   that merchant.
2. **Optional LLM:** for still-unknown merchants you can enable Anthropic categorization
   (**Settings → AI categorization**). Each result is cached as a new rule, so a merchant is
   only ever asked once. **Only normalized merchant names are sent — never amounts or
   statements.** Off by default; rules-only until you turn it on.

Categories: Groceries, Dining, Transport, Utilities, Housing, Shopping, Health,
Entertainment, Subscriptions, Travel, Fees, Income, Transfers, Other — add/rename your own.

---

## How to add a new bank / card format

Most formats work automatically via the mapping UI. To add first-class auto-detection:

1. Open `packages/server/src/parsers/templates.ts`.
2. Add an entry to `PROVIDER_TEMPLATES`:
   ```ts
   {
     key: 'mybank',
     label: 'My Bank (שם הבנק)',
     sourceType: 'bank',                 // or 'card'
     fingerprint: ['תאריך', 'סכום חיוב'], // header cells that identify this format
     amountMode: 'debit_credit',         // see below
   }
   ```
3. If the file uses header words the generic dictionary doesn't know, add them to the
   relevant list in `KEYWORDS` (same file).

**Amount modes:**

| mode | meaning |
| --- | --- |
| `debit_credit` | separate debit + credit columns (banks) |
| `signed` | one signed amount column (− = expense) |
| `flip_sign` | one positive-magnitude amount where a charge = expense (cards) |
| `magnitude_type` | amount column + a type column that decides the sign |

Israeli quirks handled automatically: Hebrew (Windows-1255) encoding, `₪` symbols,
thousands separators (`1,234.56` and `1.234,56`), parenthesis/trailing-minus negatives,
RTL directional marks, DD/MM/YYYY dates, and trailing summary rows.

---

## Data & privacy

- All data stays in a local SQLite file — **no cloud sync**. Manually-attached
  receipt photos/PDFs are stored on disk next to it under `data/attachments/`
  (tiny — receipts are ~20–150 KB each).
- OAuth tokens are stored locally, encrypted at rest when `TOKEN_ENCRYPTION_KEY` is set.
- Outbound calls are limited to Gmail (read-only) and, if enabled, the Anthropic API —
  both explicit and disableable.
- **Settings → Export** (JSON/CSV) and **Wipe all data** are always available.

Parsed records are validated with Zod at the boundary; malformed rows are surfaced as
*skipped with a reason* rather than silently dropped.

---

## Deploy on a VPS (Hostinger) + access over Tailscale

This works well as a private, single-user app on a VPS reached only from your own
devices over [Tailscale](https://tailscale.com). In production the backend serves the
built frontend from **one port**, so there's a single thing to expose.

> ⚠️ The app has **no login**. Do **not** expose it to the public internet. Keep it on
> `127.0.0.1` and reach it through Tailscale (below). That's what makes phone + PC access
> safe.

### 1. One-time server setup

```bash
# On the Hostinger VPS (Ubuntu). Install Node 20+ and git.
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential

git clone <your repo>  finance && cd finance
cp .env.example .env            # edit if you want Gmail / AI / encryption
npm install
npm run build
```

### 2. Run it (kept alive with pm2)

```bash
sudo npm i -g pm2
pm2 start "npm run start" --name finance      # binds 127.0.0.1:4000 by default
pm2 save && pm2 startup                        # restart on reboot
```

`npm run start` sets `NODE_ENV=production` and serves both UI and API on `PORT` (4000).
The SQLite file lives at `./data/finance.sqlite` on the VPS — back that file up and you've
backed up everything.

### 3. Expose privately with Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# Serve the local app on your tailnet over HTTPS (nothing is public):
sudo tailscale serve --bg 4000
```

Now open `https://<your-vps-name>.<your-tailnet>.ts.net` from your **phone or PC** (both
signed into the same Tailscale account). Uploading a bank/card export from the phone works
through the normal file picker. `tailscale serve` gives you HTTPS automatically and never
exposes the port to the internet.

> Prefer not to use `tailscale serve`? Set `HOST=0.0.0.0` in `.env`, then firewall the port
> so only the Tailscale interface can reach it:
> `sudo ufw allow in on tailscale0 to any port 4000 && sudo ufw enable`.
> Access it at `http://<vps-tailscale-ip>:4000`.

### 4. Gmail OAuth on the VPS

If you use email scanning, the redirect URI must match the URL you actually open. Set in
`.env`:

```
GMAIL_REDIRECT_URI=https://<your-vps-name>.<your-tailnet>.ts.net/api/email/gmail/callback
```

and add that exact URI under **Authorized redirect URIs** in the Google Cloud console.
Also set `TOKEN_ENCRYPTION_KEY` so the stored OAuth token is encrypted at rest on the VPS.

### Updating later

```bash
git pull && npm install && npm run build && pm2 restart finance
```

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start backend + frontend together (Vite + API, hot reload) |
| `npm run build` | Type-check + build both packages for production |
| `npm run start` | Production: serve UI + API on one port (`NODE_ENV=production`) |
| `npm run typecheck` | Type-check both packages |
| `npm test` | Run server unit tests |

---

## Tech

Full-stack TypeScript (strict). Backend: Node + Fastify + better-sqlite3 + Zod. Parsing:
`pdf-parse`, `tesseract.js`, `csv-parse`, `xlsx`, `chardet` + `iconv-lite`. Email: Gmail API
(`googleapis`) with an `imapflow` + `mailparser` fallback. Frontend: React + Vite + Tailwind
+ Recharts.
