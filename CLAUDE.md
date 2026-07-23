# CLAUDE.md — Finance Webapp operating brief

Stable operating brief for every session that owns this repo. **Live state (deployed
version, open items, rollback) is in [`docs/memory/STATE.md`](docs/memory/STATE.md)** — a
SessionStart hook prints it at the top of each session; read it first, and update it at each
stop-point. Deeper codebase map: [`docs/MEMORY.md`](docs/MEMORY.md).

> This app holds the owner's REAL, most-sensitive financial data. **Confidentiality is the
> top priority — non-negotiable.**

## Role & boundaries
- You own **ONLY** this finance webapp repo (the self-hosted cashflow tracker on
  `srv1814608`).
- You do **NOT** touch other repos — the **Claude OS** assistant (which reads your export),
  the **cyber** analysis VPS, and the **poker** repo are owned by other sessions. You receive
  **specs** relayed by the owner from the OS session, implement them here, and report back.
- When a spec would trade the owner's privacy for convenience, **push back to the owner**
  instead of implementing it.

## What this app is
A self-hosted personal **cashflow / income-expense tracker** (TypeScript monorepo). It
ingests the owner's financial data — bank exports, ~4 credit cards, PayPal, invoices that
arrive by email, and direct bank sync — merges it into one deduplicated, categorized ledger,
and serves a dashboard + insights + a month-end forecast. Default currency **ILS**, full
Hebrew/RTL. Bound to **127.0.0.1**, reachable ONLY over the tailnet via `tailscale serve`
HTTPS (`https://srv1814608.tail7d0828.ts.net`) — **never public.**

## The contract with the Claude OS assistant
Do not break this without agreeing via owner → OS.
- `GET /api/export.json` with a bearer token (`FINANCE_READ_TOKEN`) → the income/expense JSON
  the OS's `finance_report` tool reads. Route: `routes/agentExport.ts`; builder:
  `insights/agentExport.ts`.
- Data is **transaction-based** (no bank balances / positions). `net_worth`, account balances
  and `history` are **cumulative-cashflow derivations** — flagged in `meta.notes` +
  `meta.derived` so the assistant never presents them as a real bank balance.
- Keep the export **shape stable**: `meta, net_worth, accounts, transactions, positions,
  recurring, budgets, debts, history`. A breaking change silently breaks the assistant's
  finance answers. Adding fields is fine; renaming/removing is not.

## Security model (financial PII — top priority)
- **Never expose publicly.** Stay bound to `127.0.0.1` (the default); reach only over the
  tailnet via `tailscale serve`. No public port. Only set `HOST=0.0.0.0` **with** a tailnet
  firewall (`ufw allow in on tailscale0 to any port 4000`) — and only `/api/export.json` is
  token-guarded, the rest of the API is not.
- **The read token is the auth** — keep `FINANCE_READ_TOKEN` in `.env` on the box only, rotate
  on leak. No third-party logging/telemetry of transactions.
- **Untrusted import parsing is the real attack surface** — Excel/CSV imports and, especially,
  invoices arriving by email. Parse defensively: patched deps, size caps, shape validation,
  never execute anything on parse.
  - Status: Excel uses **`@e965/xlsx`** (patched SheetJS 0.20.x), NOT `xlsx@0.18.5`.
    `tabular.ts` caps size (25 MB) + rows (200k). **Email attachments never reach the Excel
    parser** — `email/scan.ts` → `parsers/receiptFile.ts` does PDF-text + OCR only.
- **Secrets only on the box** (`.env`) — never in chat, commits, or the repo. Bank creds +
  OAuth tokens are encrypted at rest when `TOKEN_ENCRYPTION_KEY` is set. Only normalized
  merchant names go to the optional LLM — never amounts or statements.

## How you work (discipline)
1. **Verify, don't assume** — test actual behaviour/data; a green build ≠ correct numbers.
2. **Smoke/test before "done"** — run it live; confirm the export still parses and the figures
   are right after a change.
3. **Secret hygiene** — never echo the token or full financial rows into chat or commits.
4. **Commit + push discipline** — clear messages, work on a branch.
5. **Plain-language reporting** — what changed, why, effect on the data/answers; concise.
6. **State discipline** — keep `docs/memory/STATE.md` current at each stop-point; append history.
7. **Defensive-first** for anything touching money or untrusted input — validate, cap, patch;
   when in doubt, fail safe.

---

# Technical guide

## Monorepo
npm workspaces, Node ≥20, TypeScript strict, ESM. `packages/server` (`@finance/server`:
Fastify v5 + better-sqlite3 + Zod) and `packages/web` (`@finance/web`: React + Vite + Tailwind
+ Recharts).

## Commands
```bash
npm run dev         # server (:4000) + web (:5173), hot reload
npm run build       # typecheck + build both packages
npm run typecheck   # both packages (this is the lint gate — no eslint)
npm test            # server unit tests (node --test)
```
Web-only typecheck: `npx tsc -p packages/web/tsconfig.json --noEmit`. Production
(`npm run start`) serves web + API on one port (4000). **Run `npm run typecheck` and
`npm run build` before committing** — a passing typecheck doesn't guarantee a passing Vite build.

## Architecture (data flow)
```
import/scrape/email → parsers → Zod (models/types.ts ParsedTransaction) → repo/transactions
   → runDedup() [dedup/engine.ts]: union-find cross-source merge; same-source → alerts;
     category detectors (settlement→Transfers, salary→Salary, living-cost→Cost of Living)
   → insights/reconcile read the deduped ledger for dashboard, forecast, reports, export
```
Zod is the boundary — malformed rows are "skipped with a reason", never dropped. A
`LedgerEntry` is a primary transaction plus its merged sources; totals use primaries only.

## Conventions & gotchas
- **DB migrations are additive** in `db/db.ts` `migrate()` (guarded `ALTER TABLE ADD COLUMN`);
  `schema.sql` won't add columns to an existing table. Built-in categories/settings re-seed on
  boot.
- **Transfers excluded from spend/income totals** everywhere (internal movement); a positive
  **card** amount is a refund, not income. **Loan In / Loan Repayment** DO count but are flagged.
- **Salary date snapping:** salary in the last ~2 days of a month counts to the next month.
- **PayPal exports** are multi-row per purchase — `parsers/paypal.ts` collapses each to one ILS
  outflow. Don't run PayPal through the generic mapper.
- **Web theming:** CSS variables in `index.css` mapped to Tailwind tokens (`bg-panel`, …);
  light default, dark via `data-theme` (`lib/theme.ts`). Money `.tnum`; expenses `.text-expense`
  (red `-`), income `.text-income` (green `+`). Never set inline `style={{ background }}` on a
  card — it overrides `bg-panel`; use `backgroundImage` for tints. Charts read theme colors via
  `useChartColors()` / `rgb(var(--…))`.
- **RTL** text inside the LTR shell: wrap in `<Bidi>` / `.rtl-aware`.

## Deploy (Hostinger VPS `/root/finance`, over Tailscale)
```bash
cd /root/finance && git pull && npm install && npm run build && pm2 restart finance --update-env
```
The direct-scraper needs a headless Chromium + persistent `Xvfb :99` (`DISPLAY=:99` in pm2 env).
Hard-refresh the browser after a UI change.
