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
> that download, OCR is skipped gracefully and everything else still works.

---

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

- All data stays in a local SQLite file — **no cloud sync**.
- OAuth tokens are stored locally, encrypted at rest when `TOKEN_ENCRYPTION_KEY` is set.
- Outbound calls are limited to Gmail (read-only) and, if enabled, the Anthropic API —
  both explicit and disableable.
- **Settings → Export** (JSON/CSV) and **Wipe all data** are always available.

Parsed records are validated with Zod at the boundary; malformed rows are surfaced as
*skipped with a reason* rather than silently dropped.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start backend + frontend together |
| `npm run build` | Type-check + build both packages |
| `npm run typecheck` | Type-check both packages |
| `npm test` | Run server unit tests |

---

## Tech

Full-stack TypeScript (strict). Backend: Node + Fastify + better-sqlite3 + Zod. Parsing:
`pdf-parse`, `tesseract.js`, `csv-parse`, `xlsx`, `chardet` + `iconv-lite`. Email: Gmail API
(`googleapis`) with an `imapflow` + `mailparser` fallback. Frontend: React + Vite + Tailwind
+ Recharts.
