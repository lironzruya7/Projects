# Upgrade ideas & roadmap

Synthesized from a 5-agent web research sweep (2026-07-23) across open-source finance apps,
the Israeli banking/scraping ecosystem, categorization/enrichment, receipt/document AI, and
forecasting/UX. **Research only — nothing was cloned.** Any dependency below is pulled ONLY
after owner approval + a safety/license review (per the operating brief).

Legend — Impact H/M/L · Effort S/M/L · **reuse** = permissively-licensed lib we could vendor ·
**idea** = build our own · ⚠️ = license/privacy caveat · 🚀 = bold/novel bet.

---

## Tier 1 — Quick wins (days each; no new services, no license/privacy issues)

1. **Learn-from-correction rules.** When the owner recategorizes a transaction, auto-persist a
   high-priority `merchant → category` rule so the same merchant is never fixed twice. We already
   cache LLM results as rules; extend to manual fixes + show "N rows will be recategorized."
   · H · S · idea · _Actual Budget / Copilot pattern._
2. **Rule precedence + `stop_processing` + decision provenance.** Ordered rules (exact > contains
   > regex > MCC > embedding > LLM) with a `category_source` + `confidence` stored on each txn, and
   a **"needs review" queue** below a confidence threshold. Makes categorization explainable.
   · H · S · idea · _Firefly III / Plaid confidence._
3. **"Safe-to-Spend today" tile + daily-allowance ring.** One number from data we already have:
   `(projected income − savings target − remaining known bills − spent so far) ÷ days left`.
   Turns the dashboard from "what happened" to "what can I spend now." · H · S · idea.
4. **Subscription price-hike + free-trial-expiry alerts.** Extend the existing recurring detector:
   compare each new instance to the trailing median → flag "Netflix ₪45→₪55 (+22%)"; detect
   trial→first-real-charge and count down. · H · S–M · idea.
5. **Scraper diagnostics: `storeFailureScreenShotPath` + verbose logging.** Dump a screenshot on
   scrape failure to finally diagnose the Isracard 403 / Cal reCAPTCHA. · H · S · **reuse** (option
   already in israeli-bank-scrapers, MIT).
6. **Scheduled auto-sync** (pm2/cron) with per-provider last-success tracking, instead of manual
   runs. · H · S · idea (moneyman is MIT reference).
7. **OCR accuracy quick wins (Hebrew).** Swap to `tessdata_best` Hebrew LSTM model, set `--psm`
   per receipt, add a user-words list of Israeli merchants; add a `sharp` preprocessing pass
   (grayscale → Otsu binarize → deskew → upscale). Recovers most Hebrew OCR loss. · H · S ·
   **reuse** (Tesseract Apache-2.0, sharp Apache-2.0).
8. **MCC → category seed map.** When card data carries a Merchant Category Code, map it
   deterministically to our category (instant, offline, high-confidence). · M · S · **reuse**
   (public MCC datasets — verify each file's terms).
9. **Bill-shock / cashflow-cliff calendar.** Month grid of known upcoming outflows (rent, card
   settlements, recurring) vs projected salary date → highlight the tight days. · M–H · S · idea.

## Tier 2 — Medium bets (a week or two each)

10. **Interactive OTP/2FA for scraping** via `otpCodeRetriever` callback + a persisted long-term
    token (`otpLongTermToken`), with the code prompt delivered over the tailnet UI or Telegram.
    Unblocks reliable/unattended sync. · H · M · **reuse** (israeli-bank-scrapers MIT; moneyman's
    Telegram-OTP pattern). ⚠️ never persist SMS codes, only the long-term token.
11. **Proactive push via ntfy or Telegram.** Weekly spending recap + real-time anomaly/large-charge
    alerts, so insights reach you without opening the app. · H · S–M · **reuse** (ntfy Apache-2.0 /
    Apprise BSD-2). ⚠️ keep inside the tailnet; no amounts to a third-party cloud.
11.5 **`futureMonthsToScrape` + `combineInstallments`** to pull scheduled installment charges into
    the forecast. · M · S · **reuse** (scraper options, MIT).
12. **Monte Carlo cashflow forecast with P10/P50/P90 confidence bands** 🚀. Replace the single
    "ends like the 3-mo average" estimate: split fixed/recurring (known) vs discretionary (sample
    from historical daily spend), run ~5k sims → fan chart + "12% chance you end the month
    negative." Runs <100ms in Node, no dependency. · H · M · idea (⚠️ if using a Holt-Winters port,
    pick an MIT one, avoid the GPL-3.0 v1.0.2).
13. **Local embedding categorization + dedup** (RTL-robust). Embed normalized merchants with a
    local multilingual MiniLM (ONNX), KNN in **sqlite-vec** inside our own SQLite: (a) categorize
    by nearest already-labeled merchant before any LLM; (b) add cosine similarity as an extra
    dedup signal so the same merchant in Hebrew (bank) / English (card) / legal-name (receipt)
    merges. · H · M · **reuse** (sqlite-vec Apache/MIT, `@huggingface/transformers` Apache,
    paraphrase-multilingual-MiniLM Apache). Fully offline.
14. **Merchant normalization hardening.** Strip org suffixes (incl. `בע"מ`), drop processor
    prefixes ("PAYPAL *", gateways), and **Hebrew prefix segmentation** (ה/ב/ל/מ/ו/ש/כ) so "בסופר"
    ≡ "סופר". Multiplies the hit-rate of rules, embeddings AND dedup at once — do before #13. · H ·
    M · idea + optional deps (cleanco MIT / hand-rolled; ⚠️ avoid HebMorph AGPL).
15. **Envelope / zero-based budgeting + savings goals (piggy banks).** A real budget layer with
    monthly rollover (carry negatives forward honestly) + goals with target date/ETA; feeds the
    forecast. · H · L / M · idea (Actual Budget is MIT reference; ⚠️ Firefly III is AGPL — ideas
    only).
16. **`invoice2data`-style templates for recurring Israeli vendors** (electric/water/municipality,
    cards, cellular, PayPal, ISP) → deterministic near-100% extraction on your highest-volume
    senders; OCR/VLM handles the long tail. · M · M · **reuse/port** (invoice2data MIT).
17. **Receipt → transaction score-matching.** Match a parsed receipt to an existing ledger row
    (amount + date + merchant similarity) and attach it via `runDedup()` instead of creating a
    duplicate — raises effective accuracy even with imperfect fields. · M · S · idea (Firefly IMAP
    receipt tools pattern).
18. **OCRmyPDF pre-pass** for scanned PDFs (deskew/clean + add a text layer) → unify scanned and
    native PDFs on the existing `pdf-parse` path. · M · S · **reuse** (MPL-2.0, external CLI).

## Tier 3 — Bold / novel bets (uniquely ours) 🚀

19. **Natural-language "ask your money"** 🚀. "כמה הוצאתי על אוכל בחוץ ברבעון האחרון?" → LLM
    generates SQL against a **read-only** SQLite view (allow-listed tables, statement timeout),
    executed locally, returns numbers + a chart. Modern UX using infra we already have. · H · M ·
    idea. ⚠️ local model preferred; if cloud, send only normalized merchant names.
20. **Local vision-LLM receipt extraction** 🚀 (Qwen2.5-VL 7B or MiniCPM-V 2.6 via Ollama). Feed
    the receipt image straight to a local VLM → strict JSON (merchant/date/total/VAT/line items),
    validated through Zod. Biggest single accuracy leap for messy Hebrew receipts; keep regex as
    the fast path. · H · M–L · **reuse** (Ollama MIT, Qwen2.5-VL Apache). Offline-only. ⚠️ sends raw
    pixels to a model — permissible ONLY because it's fully local; gate behind an env flag,
    document the no-egress guarantee, never wire to a cloud VLM.
21. **Local LLM (Ollama) replaces the cloud LLM entirely** 🚀. Move optional categorization to a
    local Phi-3/Qwen2.5-3B as the last-resort fallback → removes the one remaining data-egress path
    (even normalized merchant names stay on-box). · M · L · **reuse** (Ollama MIT). ⚠️ needs RAM on
    the VPS alongside Chromium/Xvfb — do last, gated on headroom. Strictly better privacy.
22. **Agentic "Financial Concierge"** 🚀 (only we can build this). We already export JSON to a
    separate AI assistant — close the loop: let it *act on* insights, not just answer. Reads the
    anomaly/price-hike flags → drafts a "cancel this / negotiate that" checklist; proactively
    answers "am I on track this month?" every Monday. Extends the `/api/export.json` contract
    additively with an insights/alerts block. · M · M–L · idea.

## Also considered — deliberately parked
- **Open banking / PSD2 (Israel)** — sanctioned API path exists since 2022 but requires licensed
  TPP status per bank; not attainable for a single-user app. Track, don't build.
- **Storing real balances / credit limits** — israeli-bank-scrapers doesn't reliably expose them;
  keep balances as flagged cumulative-cashflow derivations for now.
- **PaddleOCR** — no Hebrew / no RTL correction; wrong tool. **Surya OCR** — Hebrew-strong but
  GPL-3.0 code + non-commercial weights (restrictive) — avoid vendoring.

---

## Reusable libraries — safety & license

**Safe to vendor (permissive):** israeli-bank-scrapers (MIT) · sqlite-vec (Apache/MIT) ·
@huggingface/transformers.js (Apache) · paraphrase-multilingual-MiniLM (Apache) · ntfy (Apache) ·
Apprise (BSD-2) · cal-heatmap (MIT) · invoice2data (MIT) · Ollama (MIT) · Qwen2.5-VL (Apache) ·
sharp (Apache) · Donut (MIT) · Tesseract/tessdata_best (Apache) · public MCC datasets (verify file).

**Inspiration only — do NOT copy code (AGPL/GPL):** Firefly III, Maybe, Ghostfolio, Paisa, Wallos,
GnuCash, Beancount, HebMorph, Surya (GPL + NC weights).

**Privacy no-go per brief (cloud, idea/schema only):** Ntropy, Plaid Enrich, Teller, Google Vision,
any hosted VLM/LLM. Borrow their output *schema* (canonical merchant, logo, MCC, confidence,
recurrence) — populate it locally.

---

## Recommended first batch (highest impact-to-effort, zero new infra)
#1 correction-learning rules · #2 rule precedence + confidence + review queue · #3 Safe-to-Spend ·
#4 subscription price-hike/trial alerts · #5 scraper failure screenshots · #7 OCR Hebrew quick
wins. All are idea/permissive, fully local, and build on what we already have.
