# Live state — Finance Webapp

> Printed at the top of every session by the SessionStart hook. **Read first.** Update this
> at each stop-point and append to the history log at the bottom. Keep it short.

_Last updated: 2026-07-23_

## Repo structure (IMPORTANT)
- `lironzruya7/Projects` is a **multi-project monorepo: one project per branch**, never merged
  to `main` (each branch has its own root, so merging would collide). This finance app lives on
  branch `claude/new-session-1bceap`. Other branches are other owners' projects — do NOT touch.
  **Do NOT merge this branch to `main`.** CLAUDE.md/STATE.md/the SessionStart hook load from the
  checked-out branch, so no merge is needed. The VPS `/root/finance` must stay on this branch.

## Deployed / current
- **Branch:** `claude/new-session-1bceap` (this is home — not merged to main) · **HEAD:** `f8bc036`
- **Prod:** Hostinger VPS `/root/finance`, pm2 app `finance`, served on `127.0.0.1:4000`,
  reached over the tailnet via `tailscale serve` at `https://srv1814608.tail7d0828.ts.net`.
- **OS `finance_report` integration is LIVE** — reads `GET /api/export.json` (Bearer
  `FINANCE_READ_TOKEN`) over the tailnet.

## Data model (as the OS consumes it)
- Transaction-based income/expense: bank (Yahav), ~4 credit cards (Isracard/Cal/Diners), PayPal,
  email invoices, direct sync. `positions` / `budgets` / `debts` are empty.
- `net_worth`, account balances and `history` are **cumulative-cashflow derivations**, flagged
  in `meta.notes` + `meta.derived` — NOT real bank balances.
- Export shape (keep stable): `meta, net_worth, accounts, transactions, positions, recurring,
  budgets, debts, history`.

## Open items (owner decisions / follow-ups)
- **✅ Public exposure RESOLVED (2026-07-23).** Was reachable on the Hostinger public IP
  (`187.124.10.239:4000`). All 5 steps done + verified: firewall (4000 only on `tailscale0`,
  public denied) → `tailscale serve` → deploy (binds `127.0.0.1`) → **`FINANCE_READ_TOKEN`
  rotated** (+ OS `finance_report` config updated) → verified public IP dead (phone on cellular)
  and `https://srv1814608.tail7d0828.ts.net` works. Access is now **`tailscale serve` only**.
- **Data verification (pending — do live, don't trust the build):** confirm `/api/export.json`
  returns rows + `meta.notes`; delete emails + re-scan (fixed extractor); import the PayPal CSV;
  re-tag the ₪75,000 Yahav loan `Transfers` → `Loan In`.
- ~~Merge to default branch~~ — **do NOT** (branch-per-project repo; see Repo structure above).
  The branch IS home; nothing to merge.
- **xlsx fix source.** Using `@e965/xlsx@0.20.3` (npm-native patched SheetJS) instead of the
  official CDN 0.20.x (CDN is policy-blocked in the dev env; npm-native is deploy-reliable).
  Owner may prefer the official CDN tarball — swap is one line if so.
- **Owner to re-tag** the ₪75,000 Yahav loan from `Transfers` → `Loan In` (and any repayments →
  `Loan Repayment`) so totals reflect it as a flagged loan.

## Rollback
- Any change: `git revert <sha>` on the branch, then redeploy. Latest security commit `f8bc036`
  (HOST default + export notes) reverts cleanly; HOST alone is one `.env` line (`HOST=0.0.0.0`).
- Data lives in `./data/finance.sqlite` on the VPS — back up that file = back up everything.

## Verify after a deploy
```bash
cd /root/finance && git pull && npm install && npm run build && pm2 restart finance --update-env
# export still authorized + carries the derived-data flags:
curl -s -H "Authorization: Bearer $FINANCE_READ_TOKEN" \
  https://srv1814608.tail7d0828.ts.net/api/export.json | head -c 400
```

## Roadmap execution (from docs/IDEAS.md)
- ✅ Batch 1: Safe-to-Spend + subscription price-hike/trial alerts.
- ✅ Batch 2: curated Israeli merchant seed rules (out-of-the-box categorization).
- ✅ Batch 3: Monte Carlo forecast bands, upcoming-bills cashflow calendar, category budgets.
  (Savings goals deferred — small follow-up.)
- ✅ Batch 3 also shipped savings goals (target + deadline; progress from net cashflow since
  goal start; ETA + on-track). Goals card on Insights; /api/goals CRUD; cleared on wipe.
- ▶ Batch 4: ✅ Push notifications + ✅ real-time large-charge alerts (fire-and-forget from
  import/scan/scrape, watermark so each charge alerts once, no backfill; threshold in Settings).
  All NO-dep. ⏸ Remaining items need owner approval + the safety review
  (docs/BATCH4-DEPENDENCIES.md) before pulling any dep: sqlite-vec embeddings, sharp/OCR,
  Ollama/vision-LLM, NL "ask your money".

## History (append newest first)
- **2026-07-23** — Roadmap batches 1–2 shipped: Safe-to-Spend, subscription price-hike/trial
  alerts, curated Israeli merchant seed rules. Added docs/IDEAS.md (5-agent research roadmap).
- **2026-07-23** — 🔒 Closed a public-internet exposure of the finance app (Hostinger public
  IP, port 4000 open). Firewalled to tailscale0, `tailscale serve`, redeployed on `127.0.0.1`,
  rotated the read token. Verified closed externally (phone on cellular) + tailnet access works.
- **2026-07-23** — Installed the operating brief (Option B): `CLAUDE.md` = stable brief +
  technical guide, this `STATE.md` = live state, SessionStart hook prints it + installs deps.
- **2026-07-23** — Security hardening per brief: HOST default → `127.0.0.1`; added
  `meta.notes`/`meta.derived` to the export. Confirmed email attachments never hit the Excel
  parser. (`f8bc036`)
- **2026-07-23** — Docs: added `CLAUDE.md`, `docs/MEMORY.md`; refreshed `README`. (`e7a59cc`)
- **2026-07-22/23** — Features shipped: PayPal import + cross-source reconcile, By-category
  collapsible ledger, Loan In/Repayment categories, balance & month-end forecast, light/dark
  theme + tile prominence, `@e965/xlsx` CVE fix + parse caps.
