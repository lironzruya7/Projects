# cyber_exec playbook — for the OS session (how to drive /api/exec)

Relay this to the Claude OS session. The VPS exposes the capabilities below;
nothing on the VPS needs changing — the OS agent just needs to invoke them
correctly. The `/api/exec` contract is unchanged in shape; `raw` and `image` are
additive optional fields, so old requests still work (backward compatible).

## Request schema
```json
{
  "command": "<bash -lc ... in /work>",
  "network": "none" | "egress",     // default "none" = NO network at all
  "timeout": <int seconds>,          // per-image default/cap (base 60/600, heavy 300/1800)
  "files":  [{ "name": "<basename>", "b64": "<base64>" }],
  "raw":    false,                   // true+egress → adds ONLY NET_RAW (SYN scans)
  "image":  "base" | "heavy"         // default "base"; "heavy" = Ghidra/Volatility3
}
→ { ok, exit_code, stdout, stderr, timed_out, duration_s }
```

## Decision matrix
| Task | network | image | raw |
|------|---------|-------|-----|
| Static analysis / detonation of a sample (no net) | `none` | base (heavy for RE/mem) | — |
| Web/app scan, port scan, DNS, HTTP fetch of an **authorized** target | `egress` | base | — |
| SYN / stealth / UDP scan (`nmap -sS`, `masscan`) | `egress` | base | **true** |
| Reverse engineering a binary (Ghidra) | `none` | **heavy** | — |
| Memory-dump forensics (Volatility3) | `none` | **heavy** | — |

Default to `network:"none"`. Only use `egress` for an authorized target that is
**inside the OS-side scope** (the scope-guard extracts the target from the
command and blocks out-of-scope BEFORE it leaves the OS — keep doing that).

## Offensive tool recipes (base image)
- **nuclei — MUST run offline-safe.** Templates are baked at `/opt/nuclei-templates`
  (`$NUCLEI_TEMPLATES`). Always pass the path + disable the update check, else it
  tries to phone home:
  `nuclei -u https://<target> -t $NUCLEI_TEMPLATES -disable-update-check -severity critical,high -tags cve,exposure -rate-limit 50 -silent`
  (filter by `-severity`/`-tags` — running all ~13k templates against one host is slow.)
- **ffuf**: `ffuf -w <wordlist> -u https://<target>/FUZZ -mc 200,301,302 -rate 50`
- **feroxbuster**: `feroxbuster -u https://<target> -w <wordlist> --rate-limit 50`
- **whatweb**: `whatweb --color=never https://<target>`
- **sqlmap**: `sqlmap -u '<url>' --batch --level 2 --risk 1` (authorized only)
- **hydra**: `hydra -L users -P pass <target> <service>` (authorized only)
- **nmap SYN**: `network:"egress"`, `raw:true`, `nmap -sS -Pn -F <target>`
- Wordlists: use ones present in the Kali image (e.g. under `/usr/share/wordlists`,
  `/usr/share/seclists` if installed) or send your own via `files[]`.

## Heavy image recipes (`image:"heavy"`, network `none`)
- **Ghidra decompile** (send the binary via `files[]`):
  `analyzeHeadless /work proj -import /work/<bin> -postScript <yourscript>.py -deleteProject`
  (a decompile-to-C example is `scripts/ghidra/DecompileFirst.py`).
- **Volatility3**: `vol -f /work/<dump> <plugin>` (e.g. `linux.pslist.PsList`).
  NOTE: Linux dumps need a matching **ISF symbol table** available offline —
  vol3 can't fetch it under `network:"none"`. This symbol-seed is an open item;
  coordinate before relying on live Linux memory forensics.

## Egress / VPN (attribution)
- When VPN egress is enabled on the box, **authorized scans exit from the iVPN
  IP**, not the VPS's real IP (OPSEC). The scan still only reaches the public
  internet — tailnet/LAN/metadata are firewalled off regardless.
- A VPN is **not** authorization. Only scan targets the OS scope-guard approved.

## Response handling (match the VPS discipline)
- **`exit_code:0` ≠ success.** Read `stdout` and look for the expected marker; a
  missing marker or empty output means it failed (a tool may abort with exit 0).
- Check `timed_out` — if true, the container was SIGKILLed at the timeout; raise
  the `timeout` (within the image cap) or narrow the command.
- stdout/stderr are capped at ~1 MB each; page/narrow if you need more.
- `429` = throttled (rate/concurrency) → back off and retry after `retry_after`.

## Do NOT
- Do not disable the scope-guard, approval, or authorization-first because the
  VPS "can" reach a target. The VPS trusts the token; the OS is the gate.
- Do not assume network in `none` mode — it has none (not even DNS).

---

## Appendix — ready-to-copy payloads

Replace `<TARGET>` with a scope-approved target and send as the JSON body of
`POST /api/exec` with header `Authorization: Bearer <token>`. Curl wrapper:

```bash
curl -s -X POST "$BASE/api/exec" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d @payload.json | jq .
```

**Web fingerprint + nuclei (authorized, offline templates):**
```json
{ "network":"egress", "timeout":300, "command":"whatweb --color=never https://<TARGET>; echo '--- nuclei ---'; nuclei -u https://<TARGET> -t $NUCLEI_TEMPLATES -disable-update-check -severity critical,high -tags cve,exposure -rate-limit 50 -silent" }
```

**Content/dir discovery (ffuf):**
```json
{ "network":"egress", "timeout":300, "command":"ffuf -w /usr/share/wordlists/dirb/common.txt -u https://<TARGET>/FUZZ -mc 200,301,302,401,403 -rate 50 -s" }
```

**Port + service scan (TCP connect, no raw):**
```json
{ "network":"egress", "timeout":300, "command":"nmap -sV -Pn -T4 --top-ports 1000 <TARGET>" }
```

**SYN / stealth scan (needs raw):**
```json
{ "network":"egress", "raw":true, "timeout":300, "command":"nmap -sS -Pn -T4 -F <TARGET>" }
```

**TLS posture:**
```json
{ "network":"egress", "timeout":300, "command":"testssl.sh --color 0 --fast https://<TARGET>" }
```

**Static malware triage — no network (send the sample in `files`):**
```json
{ "network":"none", "timeout":120, "files":[{"name":"sample.bin","b64":"<BASE64>"}], "command":"file sample.bin; sha256sum sample.bin; echo '--- strings ---'; strings -n 8 sample.bin | head -50; echo '--- yara ---'; yara /path/to/rules.yar sample.bin || true; echo '--- binwalk ---'; binwalk sample.bin" }
```

**PDF / Office document analysis — no network:**
```json
{ "network":"none", "timeout":120, "files":[{"name":"doc.pdf","b64":"<BASE64>"}], "command":"pdfid doc.pdf; echo '---'; pdf-parser --stats doc.pdf 2>/dev/null | head -40" }
```
```json
{ "network":"none", "timeout":120, "files":[{"name":"doc.docm","b64":"<BASE64>"}], "command":"olevba doc.docm" }
```

**Reverse engineering — Ghidra decompile (heavy, no network):**
```json
{ "image":"heavy", "network":"none", "timeout":900, "files":[{"name":"target.bin","b64":"<BASE64>"},{"name":"DecompileFirst.py","b64":"<BASE64 of scripts/ghidra/DecompileFirst.py>"}], "command":"analyzeHeadless /work proj -import /work/target.bin -scriptPath /work -postScript DecompileFirst.py -deleteProject 2>&1 | grep -A2000 'PSEUDO-C' | head -80" }
```

**Memory forensics — Volatility3 (heavy, no network; needs matching ISF offline):**
```json
{ "image":"heavy", "network":"none", "timeout":900, "files":[{"name":"mem.dump","b64":"<BASE64>"}], "command":"vol -f /work/mem.dump linux.pslist.PsList 2>&1 | head -60" }
```

All above: read `stdout` for the expected markers (not just `exit_code`), and if
`timed_out` is true, narrow the command or raise `timeout` within the image cap.
