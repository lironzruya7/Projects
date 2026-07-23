# Project memory — topical index

A by-topic map of the codebase so an agent can jump straight to the right file without
re-scanning. Each topic lists the authoritative files and the key facts/decisions. Update
the relevant topic when you change behaviour.

> Scope: local-first finance aggregator. Server = `@finance/server` (Fastify + SQLite + Zod),
> Web = `@finance/web` (React + Vite + Tailwind + Recharts). ILS default, Hebrew/RTL.

---

## 1. Build, run, deploy
- **Commands:** `packages.json` scripts — `dev`, `build`, `typecheck`, `test`, `start`.
- **Entry:** server `packages/server/src/index.ts` (registers routes, serves web in prod on
  port 4000); web `packages/web/src/main.tsx` → `App.tsx`.
- **Config:** `packages/server/src/config.ts` — reads env (`PORT`, `HOST` default `0.0.0.0`,
  `DATABASE_PATH`, `DEFAULT_CURRENCY`, `FINANCE_READ_TOKEN`, `TOKEN_ENCRYPTION_KEY`,
  scraper/puppeteer paths). Annotated template in `.env.example`.
- **Deploy:** VPS `/root/finance`; `git pull && npm install && npm run build && pm2 restart
  finance --update-env`. Scraper needs persistent `Xvfb :99` + `DISPLAY=:99`.

## 2. Database & migrations
- **Files:** `db/db.ts` (connection, `migrate()`, `seed()`, `getSetting`/`setSetting`),
  `db/schema.sql` (base tables; copied to `dist/` on build).
- **Rule:** schema.sql only creates missing tables; to add a column to an existing table use
  the guarded `addColumn()` in `migrate()`. Columns added this way: `transactions.account_label`,
  `import_batches.account_label|file_hash|period`.
- **Settings** live in a `settings` key/value table as JSON. Seeded defaults: currency, dedup,
  llm, email (`maxResults` 200, `lookbackDays` 90), anomaly, `salary.payers`, `bankBalances`.
- **repo/** = DB access layer: `transactions.ts` (`allPrimary`, `insertParsed`,
  `getTransaction`), `batches.ts`, `categories.ts`, `mappings.ts`, `attachments.ts`,
  `balances.ts` (bank balances captured on scrape).

## 3. Models / validation boundary
- **File:** `models/types.ts` — Zod schemas. `ParsedTransaction` (parser output; `amount`
  signed, negative = outflow), `Transaction` (persisted), `LedgerEntry` (primary + merged
  sources), `ColumnMapping`, `AmountMode`, `DedupSettings`.

## 4. Parsing & import
- **Templates/mapping:** `parsers/templates.ts` — `KEYWORDS` (HE+EN column dictionaries),
  `PROVIDER_TEMPLATES` (fingerprints: paypal, yahav, cal, isracard), `suggestMapping()`.
  `findColumn` does exact-match pass then partial. AmountModes: `debit_credit`, `signed`,
  `flip_sign` (cards), `magnitude_type`.
- **Tabular read:** `parsers/tabular.ts` — CSV (`csv-parse`) + Excel (**`@e965/xlsx`**, the
  patched SheetJS; NOT `xlsx`). Size cap 25 MB, row cap 200k.
- **Auto import:** `parsers/autoImport.ts` — routes a file to PDF / PayPal / generic mapper;
  detects card last-4; honours a manual provider/label override.
- **PayPal:** `parsers/paypal.ts` — collapses multi-row activity export (payment + card
  deposit + FX conversion) into ONE ILS outflow per completed purchase, joined merchant/date,
  externalId = PayPal txn id. Imported as bank/signed, provider `paypal`.
- **PDF:** `parsers/pdf.ts` (text via `pdf-parse`), `parsers/pdfStatement.ts` (statement line
  parser), `parsers/ocr.ts` (`tesseract.js`, HE+EN; scanned PDFs need `poppler-utils`).
- **Receipts:** `parsers/receipt.ts` (extract merchant/date/total/currency/invoice from free
  text; currency-anchored, skips card-number-as-amount), `parsers/receiptFile.ts`
  (PDF text + image OCR — **the email-attachment path; never parses Excel**).
- **Encoding/amount/date:** `parsers/encoding.ts` (Windows-1255 via chardet+iconv, strip RTL
  marks), `parsers/amount.ts` (`parseAmount`, `amountsMatch`), `parsers/date.ts`
  (`parseDate`, DD/MM default, Excel serials, `daysBetween`).
- **Routes:** `routes/import.ts` — `/api/import/preview|commit|auto|batches|duplicates|clear`,
  per-batch `provider|period|label`. File-hash dedup guard; `dominantMonth()` period detection.

## 5. Dedup & double-charge alerts
- **File:** `dedup/engine.ts` — `runDedup()` union-find over candidate pairs. Match =
  amount within tolerance + (same externalId within 14d **or** date-window + fuzzy merchant).
  **PayPal cross-reference:** `isPaypalish()` pairs (paypal export ⇄ card "PAYPAL" line ⇄
  email receipt) merge on amount + date alone within ~7 days.
- Cross-source → merge (reversible). Same-source repeat → `double_charge_alerts` (confirm/
  dismiss/merge). Email/receipt same-source auto-merges (`isNotificationDuplicate`).
- Bulk merges: `mergeExactDuplicates`, `mergeSameMerchantAmount`, `mergeAlert`, `mergeManual`.
- **runDedup also runs the category detectors** (see topic 7).

## 6. Reconciliation (הצלבה)
- **File:** `reconcile/reconcile.ts` — matches aggregate bank credit-card settlement lines to
  the itemized card statement totals (subset-sum up to 3 batches, family + date window),
  tags settlements `Transfers`. `buildReconciliation()` returns matched + `missing[]` (month +
  card last-4 not yet imported). Route `GET /api/reconcile`; UI `components/ReconcileCard.tsx`.

## 7. Categorization
- **Rules:** `categorize/rules.ts` — `merchant_normalized → category` (exact/contains/regex),
  sticky rule created on manual recategorize. `normalize/merchant.ts` = normalization +
  `tokenSetRatio` fuzzy match.
- **LLM (optional):** `categorize/llm.ts` — Anthropic; only normalized merchant names sent;
  result cached as a rule. Off by default.
- **Detectors (run inside `runDedup`, in `reconcile.ts`):** `applySettlementCategory`
  (→Transfers), `applySalaryCategory` (→Salary + date snap to month 1st; payers רותם/לירון,
  editable via `salary.payers`), `applyLivingCostCategory` (ארנונה/מים/חשמל/משכנתא → Cost of
  Living). Never override a manual category.
- **Built-in categories** (`db.ts` seed): Groceries, Dining, Transport, Utilities, Cost of
  Living, Housing, Shopping, Health, Entertainment, Subscriptions, Travel, Fees, Salary,
  Income, **Loan In**, **Loan Repayment**, Transfers, Other.

## 8. Totals, insights, forecast
- **File:** `insights/insights.ts` — `buildDashboard()` (per-currency totals, category/
  merchant/account breakdowns, cash flow, income split). `isExpense` = `amount<0 &&
  category!='Transfers'`; `isIncome` = `amount>0 && !Transfers && sourceType!='card'`.
- **Forecast:** `buildForecast(base)` — current bank balance (from `repo/balances.ts`, captured
  on scrape) + projected end-of-month = balance + expected remaining income − spend, assuming
  the month ends like the 3-month average. Recomputed every dashboard load. Also on the client
  as `Forecast` type; UI card in `Dashboard.tsx`.
- **Recurring/anomalies:** `detectRecurring()`, `detectAnomalies()`. Recommendations:
  `insights/recommend.ts`. Reports: `insights/report.ts` (md/html/json), `reportPdf.ts`
  (puppeteer PDF). Agent export: `insights/agentExport.ts` + `routes/agentExport.ts`
  (`GET /api/export.json`, Bearer `FINANCE_READ_TOKEN`).

## 9. Email scanning
- **Files:** `email/scan.ts` (pipeline → `extractReceipt`), `email/gmail.ts` (Gmail API),
  `email/outlook.ts` (Graph `Mail.Read`, single-quoted KQL `$search`), `email/imap.ts`
  (imapflow+mailparser fallback), `email/tokenStore.ts` (encrypted at rest), `email/html.ts`.
- Keywords HE+EN; body + attachments (PDF text + image OCR). Idempotent by source ref
  (`gmail:<id>` / `outlook:<id>` / attachment name). Gmail + Outlook can both be connected.
- **Routes:** `routes/email.ts` — auth-url/callback/connected/disconnect/scan/test/settings.

## 10. Direct bank/card scraping
- **Files:** `scrape/scraper.ts` (`runScrape` via `israeli-bank-scrapers`, persists txns +
  captures `account.balance` → `repo/balances.ts`), `scrape/providers.ts` (yahav bank, cal
  card; Isracard omitted — 403s). Credentials encrypted (`scrape:` prefix in tokenStore).
- **Routes:** `routes/scrape.ts` — providers/credentials/run/debug. Needs Chromium + Xvfb.

## 11. Web UI & theming
- **Shell:** `App.tsx` (sidebar + mobile bottom-nav, page-entrance `.rise-in`, `ThemeToggle`).
- **Design system:** `components/ui.tsx` — `Card`, `StatCard` (tint overlay on solid panel +
  `--shadow-card`), `Badge`, `Button`, `Spinner`, `Skeleton`, `Modal`, `Bidi`.
- **Theme:** `lib/theme.ts` (light default, dark via `data-theme`, persisted); tokens in
  `index.css` (`--surface/panel/panel2/edge/ink/muted/brand/brand-ink`, `--income/expense/
  warning/info`, `--chart-axis/grid`, `--app-bg`, `--shadow-card`) mapped in
  `tailwind.config.js`. Utilities: `.tnum`, `.text-expense`, `.text-income`, `.skeleton`,
  focus-visible ring, reduced-motion block.
- **Money/colors:** `lib/format.ts` (`formatMoney`, currency symbols, month helpers),
  `lib/colors.ts` (category colors incl. Loan In/Repayment), `lib/accounts.ts` (account label
  + color, `CARD_PROVIDERS`, paypal).
- **Pages:** `Dashboard` (KPIs + forecast + donut + charts, theme-aware `useChartColors`),
  `Transactions` (filters, per-filter totals excl. transfers with loan notes, **By category /
  By date** collapsible grouping), `Import` (bank/card/PayPal quick modes + staging +
  duplicate scan + single-file mapper + reconcile), `Duplicates`, `Insights`, `Rules`,
  `Settings`. `components/TransactionTable.tsx` (ledger rows, merge expand, receipts),
  `components/Donut.tsx`.
- **API client:** `api/client.ts` — `req()` sets content-type only when a body exists (bodyless
  DELETE fix); all endpoint methods + response types.

## 12. Key decisions / bug history (don't re-introduce)
- Bodyless DELETE 400 → `req()` sets content-type only with a body.
- Receipt extractor once grabbed a funding card's last-4 as the amount → now skips
  card-context numbers, prefers 2-decimal money.
- Reconciliation moved from per-charge windowing to batch-total subset-sum (8/16 typical).
- Income inflated by card refunds/loans → excluded card positives; loans get their own
  categories that count but are flagged.
- Transfers double-counted in the ledger summary → excluded from spend/income/net.
- Light theme too bright / dark too dark → softened palette; stat tiles blended into the page
  because an inline `background` gradient overrode `bg-panel` → use `backgroundImage` overlay.
- `xlsx@0.18.5` high-severity advisories, no npm fix → swapped to `@e965/xlsx@0.20.3` + size/
  row caps. Email attachments never reach the Excel parser.
