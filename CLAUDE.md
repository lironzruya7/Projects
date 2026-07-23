# CLAUDE.md

Guidance for AI agents working in this repo. Read this first; for a deeper topic-by-topic
map see [`docs/MEMORY.md`](docs/MEMORY.md). Keep both up to date when you change things.

## What this is

A **local-first personal finance aggregator**. It merges transactions from bank/card
exports (CSV/Excel/PDF), PayPal activity exports, direct bank scraping, and email
receipts into one deduplicated, categorized ledger with a dashboard, insights, and a
month-end forecast. Single-user, no login, runs on a VPS reached over Tailscale. Default
currency **ILS**, full **Hebrew/RTL**. Tuned for Bank Yahav, Isracard, Cal, Diners, PayPal.

## Monorepo layout

npm workspaces. Node ≥20, TypeScript strict, ESM everywhere.

- `packages/server` — `@finance/server`: Fastify v5 + better-sqlite3 + Zod.
- `packages/web` — `@finance/web`: React + Vite + Tailwind + Recharts.

## Commands

```bash
npm run dev         # server (:4000) + web (:5173) with hot reload
npm run build       # typecheck + build both packages (server dist + web dist)
npm run typecheck   # both packages
npm test            # server unit tests (node --test)
```

- Web-only typecheck (faster while iterating on UI):
  `npx tsc -p packages/web/tsconfig.json --noEmit`
- Production (`npm run start`) serves the built web **and** the API on one port (4000).
- **Always run `npm run typecheck` (and `npm run build`) before committing.** The web
  build is Vite; a passing typecheck does not guarantee a passing build.

## Architecture (data flow)

```
import/scrape/email → parsers → Zod (models/types.ts ParsedTransaction) → repo/transactions
      → runDedup() [dedup/engine.ts]:
           • union-find merge of cross-source duplicates
           • same-source repeats → double-charge alerts
           • category detectors: settlement→Transfers, salary→Salary, living-cost→Cost of Living
      → insights/reconcile read the deduped ledger for the dashboard, forecast, reports
```

- **Zod is the boundary.** Every parser returns `ParsedTransaction`; malformed rows are
  surfaced as "skipped with a reason", never silently dropped.
- **Ledger entry vs transaction:** a `LedgerEntry` is a primary transaction plus its merged
  sources. Totals use primaries only (`merged_into IS NULL`).

## Conventions & gotchas (learned the hard way)

- **DB migrations are additive** in `db/db.ts` `migrate()` (guarded `ALTER TABLE ADD
  COLUMN`). `schema.sql`'s `CREATE TABLE IF NOT EXISTS` will NOT add columns to an existing
  table — add them in `migrate()`. Built-in categories/settings are (re)seeded idempotently
  on every boot, so new built-in categories appear after a restart.
- **Transfers are excluded from spend/income totals** everywhere (internal money movement;
  avoids double-counting a bank settlement against the itemized card charges). A positive
  **card** amount is a refund, not income — also excluded. See `insights.ts` isExpense/isIncome.
- **Loan In / Loan Repayment** categories DO count in totals (unlike Transfers) but are
  flagged as loans in the UI.
- **Salary date snapping:** a salary in the last ~2 days of a month counts toward the next
  month (`reconcile.ts` / `effectiveMonth`).
- **PayPal exports** are multi-row per purchase (payment + card-funding + FX conversion that
  net to zero). `parsers/paypal.ts` collapses each purchase to ONE ILS outflow (the
  card-funding amount) so it reconciles with the card statement. Do NOT run PayPal through
  the generic column mapper.
- **Excel parsing uses `@e965/xlsx`** (npm-native patched SheetJS 0.20.x), NOT `xlsx@0.18.5`
  (frozen with prototype-pollution + ReDoS advisories, no npm fix). `tabular.ts` also caps
  file size (25 MB) and rows (200k). Email attachments never hit this parser (PDF/OCR only).
- **Web theming:** all surface/text colors are CSS variables in `index.css` mapped into
  Tailwind tokens (`bg-panel`, `text-ink`, …). Light is the default, dark via `data-theme`
  on `<html>` (`lib/theme.ts`). Money uses `.tnum` (tabular figures); expenses `.text-expense`
  (red, `-`), income `.text-income` (green, `+`).
  - **Do not set an inline `style={{ background: … }}` on a card** — it overrides the solid
    `bg-panel` fill and the card blends into the page. Use `backgroundImage` for tint overlays.
- **Chart colors must be theme-aware:** tooltips use `rgb(var(--…))` (resolve in the DOM);
  axis/grid strokes are read from CSS vars via `useChartColors()` in `Dashboard.tsx`.
- **RTL text** inside an LTR shell: wrap user strings in `<Bidi>` / `.rtl-aware`.

## Security

- The app has **no auth**. Never expose it to the public internet — Tailscale only.
- `GET /api/export.json` is the ONLY token-gated route (`FINANCE_READ_TOKEN`, constant-time
  compare, 401 on failure). `HOST` defaults to `127.0.0.1` (local-only, PII-safe); `tailscale
  serve` reaches it. Binding `HOST=0.0.0.0` exposes the rest of the API unauthenticated and
  must NOT be used without a tailnet firewall.
- Bank credentials + OAuth tokens are encrypted at rest when `TOKEN_ENCRYPTION_KEY` is set.
- Only normalized merchant names go to the optional LLM — never amounts or statements.

## Deploy (Hostinger VPS at `/root/finance`, reached over Tailscale)

```bash
cd /root/finance && git pull && npm install && npm run build && pm2 restart finance --update-env
```

The direct-scraper needs a headless Chromium with an X server: a persistent `Xvfb :99` and
`DISPLAY=:99` in pm2's env (`PUPPETEER_EXECUTABLE_PATH` points at the system Chromium). After
a UI change, hard-refresh the browser to pick up new CSS.

## Working style in this repo

- Develop on the designated feature branch; commit with clear messages and push.
- Verify UI changes visually when practical (build → serve `packages/web/dist` → screenshot
  with the preinstalled Chromium via Playwright at `/opt/pw-browsers/chromium`; a tiny mock
  server can stand in for the API — see the scratchpad pattern used in history).
- Don't commit screenshots or scratch files into the repo.
