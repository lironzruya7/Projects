# Batch 4 — external dependencies for security review

Sources that would be introduced by the "Batch 4" upgrades to the finance webapp. **Nothing
is installed yet** — this list is for a safety/license review. Versions are the current npm
versions as of 2026-07-23; pin the exact version that is reviewed. The real supply-chain
surface is marked: **native binaries** (compiled at install), **self-hosted binaries** (run as
their own process), and **model/data downloads** (the only network egress — they fetch public
assets and upload nothing private).

---

## 1. Push notifications (weekly digest + real-time alerts)

No npm dependency — the app sends a plain HTTPS POST. The only thing to review is the
self-hosted notifier (if used):

| Source | URL | License | Type |
|---|---|---|---|
| ntfy (self-hosted server) | https://github.com/binwiederhier/ntfy | Apache-2.0 | Go binary (self-host) |
| ntfy docs | https://docs.ntfy.sh/ | — | — |
| (alt) Telegram Bot API | https://core.telegram.org/bots/api | — | HTTP only, nothing to vet |

---

## 2. Local embeddings — categorization + dedup (fully offline)

Install: `npm i sqlite-vec@0.1.9 @huggingface/transformers@4.2.0`

| Package | Version | URL | License | Native binary |
|---|---|---|---|---|
| sqlite-vec | 0.1.9 | https://github.com/asg017/sqlite-vec · https://www.npmjs.com/package/sqlite-vec | MIT OR Apache-2.0 | YES (compiled SQLite extension) |
| @huggingface/transformers | 4.2.0 | https://github.com/huggingface/transformers.js · https://www.npmjs.com/package/@huggingface/transformers | Apache-2.0 | via onnxruntime |
| onnxruntime-node (transitive) | 1.27.0 | https://github.com/microsoft/onnxruntime · https://www.npmjs.com/package/onnxruntime-node | MIT (Microsoft) | YES |

Model (downloaded once from HuggingFace CDN at first run):

| Model | URL | License | Notes |
|---|---|---|---|
| paraphrase-multilingual-MiniLM-L12-v2 (ONNX) | https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2 | Apache-2.0 | ~120 MB; multilingual incl. Hebrew; downloads a public model, uploads nothing |
| (original weights) | https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 | Apache-2.0 | reference |

---

## 3. Hebrew OCR accuracy upgrade

Install: `npm i sharp@0.35.3`

| Source | Version | URL | License | Type |
|---|---|---|---|---|
| sharp | 0.35.3 | https://github.com/lovell/sharp · https://www.npmjs.com/package/sharp | Apache-2.0 | native (libvips) |
| tessdata_best (heb.traineddata) | — | https://github.com/tesseract-ocr/tessdata_best | Apache-2.0 | OCR model data file |
| (optional) OCRmyPDF | — | https://github.com/ocrmypdf/OCRmyPDF | MPL-2.0 | external Python CLI |

---

## 4. "Ask your money" / local vision-LLM

Install (client only; server is separate): `npm i ollama@0.6.3`

| Source | Version | URL | License | Type |
|---|---|---|---|---|
| ollama (npm client) | 0.6.3 | https://github.com/ollama/ollama-js · https://www.npmjs.com/package/ollama | MIT | HTTP client |
| Ollama (server/runtime) | — | https://github.com/ollama/ollama | MIT | Go binary (self-host) |

Models (pulled via Ollama):

| Model | URL | License | Notes |
|---|---|---|---|
| Qwen2.5-VL (vision) | https://ollama.com/library/qwen2.5vl · https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct | Apache-2.0 | recommended |
| Phi-3 (text) | https://ollama.com/library/phi3 | MIT (Microsoft) | — |
| Qwen2.5 (text) | https://ollama.com/library/qwen2.5 | Apache-2.0 | — |
| MiniCPM-V (vision) | https://huggingface.co/openbmb/MiniCPM-V-2_6 | ⚠️ model-specific license | verify commercial terms before use; Qwen2.5-VL is the permissive fallback |

---

## What to focus the review on

1. **Native binaries** — `sqlite-vec`, `onnxruntime-node`, `sharp`. Compiled code installed at
   npm install (postinstall). Confirm they come from the official publisher, pin the version,
   and rely on the lockfile integrity hash.
2. **Self-hosted binaries** — ntfy, Ollama. Run as their own processes on the VPS; review
   separately from the Node app.
3. **Model / data downloads** — MiniLM (HuggingFace), Ollama models, tessdata_best. The only
   network egress. They fetch public assets and upload nothing private — worth confirming
   explicitly against the confidentiality brief.
4. **Licenses** — everything above is MIT / Apache-2.0 / MPL-2.0 (permissive) EXCEPT
   **MiniCPM-V** (model-specific license). If the reviewer rejects it, use Qwen2.5-VL instead.

_None of these is required for the app to run; each is per-feature and opt-in._
