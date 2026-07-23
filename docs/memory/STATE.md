# Live state — Finance Webapp

> Printed at the top of every session by the SessionStart hook. **Read first.** Update this
> at each stop-point and append to the history log at the bottom. Keep it short.

_Last updated: 2026-07-23_

## Deployed / current
- **Branch:** `claude/new-session-1bceap` · **HEAD:** `f8bc036`
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
- **✅ Public exposure CLOSED (2026-07-23).** Was reachable on the Hostinger public IP
  (`187.124.10.239:4000`). Owner ran: firewall (allow 4000 only on `tailscale0`, deny public) +
  `tailscale serve` + deploy (now binds `127.0.0.1`). Verified from a phone on cellular (off the
  tailnet): public `IP:4000` no longer loads. Access is now **`tailscale serve` only**.
  - **CONFIRM STILL OPEN:** (a) `FINANCE_READ_TOKEN` **rotated**? It was reachable while the port
    was public — treat as leaked; rotate on the box + update the OS `finance_report` config.
    (b) tailnet access to `https://srv1814608.tail7d0828.ts.net` confirmed working.
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

## History (append newest first)
- **2026-07-23** — Installed the operating brief (Option B): `CLAUDE.md` = stable brief +
  technical guide, this `STATE.md` = live state, SessionStart hook prints it + installs deps.
- **2026-07-23** — Security hardening per brief: HOST default → `127.0.0.1`; added
  `meta.notes`/`meta.derived` to the export. Confirmed email attachments never hit the Excel
  parser. (`f8bc036`)
- **2026-07-23** — Docs: added `CLAUDE.md`, `docs/MEMORY.md`; refreshed `README`. (`e7a59cc`)
- **2026-07-22/23** — Features shipped: PayPal import + cross-source reconcile, By-category
  collapsible ledger, Loan In/Repayment categories, balance & month-end forecast, light/dark
  theme + tile prominence, `@e965/xlsx` CVE fix + parse caps.
