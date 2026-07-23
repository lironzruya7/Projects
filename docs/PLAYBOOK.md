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
