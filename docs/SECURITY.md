# rmod: security model and checklist

A mod is **not sandboxed**. It runs inside Claude Code with the user's permissions: files, processes, network, env vars, and every prompt and tool call. rmod therefore holds itself to least privilege, and the checks below are enforced by `/verify` and `/security-review`.

Current Anthropic guidance on mods and plugin trust: `https://code.claude.com/docs/en/plugins/mods/overview.md` (section "Decide whether to trust a mod"), `https://code.claude.com/docs/en/plugins/security.md`, and `https://code.claude.com/docs/en/security.md`. Re-read them during `/docs-check`.

## 1. Assets

1. The user's prompts, model output, commands and files, which flow past rmod's hooks.
2. The optional LM Studio API token.
3. The integrity of the Claude Code session (tool calls, permissions, responsiveness).
4. The developer's machine and secrets while developing (`.env`, SSH and cloud keys).

## 2. Threats and controls

| Threat | Control |
|---|---|
| rmod exfiltrates data or becomes an SSRF pivot | Loopback-only URL guard on every fetch. The host must be exactly `127.0.0.1`, `::1` or `localhost`, the scheme `http:` or `https:`, with no userinfo. The port comes from config. Nothing else is ever fetched. No telemetry. |
| rmod leaks prompt or command content | Hooks read only what classification needs and keep **no** text. State holds counts, timings, model ids and statuses. `$.ui.log` and toasts never include user content. |
| Token leakage | `lmstudioApiToken` is `userConfig` with `"sensitive": true`, so it's stored in the macOS Keychain, not in settings.json. It's sent only as `Authorization` to the validated `lmstudioUrl`, and never logged, stored in `$.state`/`$.store`, or shown. |
| A bug in rmod blocks or alters the user's work | Observers always pass `next`'s result through unchanged. Bookkeeping is wrapped in `try/catch`. rmod never returns `{ deny }`, never hooks `tool.check`, never rewrites events, and has no gating hooks. |
| Resource exhaustion | Poll interval ≥ 2 s, probe timeout ≤ 10 s, no overlapping probes, bounded arrays, render hooks with no I/O. |
| Malicious or garbage responses from a local server (any local process can bind the port) | Strict JSON shape validation, clamped lengths (names ≤ 200 chars, versions ≤ 32), numbers range-checked, text drawn as plain `Text` (never `Markdown` or links built from server data). |
| Supply chain | Zero runtime dependencies (the mod imports only `'claude-code'`). Dev tooling is pinned exactly, with a committed lockfile, `npm ci --ignore-scripts`, and `npm audit` before release. |
| Secrets committed by the developer | `.gitignore` secret patterns, the gitleaks pre-commit hook (`.githooks/pre-commit`), Claude Code `deny` rules on secret paths, and `/verify` secret scan. |
| Claude (the dev agent) runs something destructive | `.claude/settings.json` deny and ask rules (force-push, `--no-verify`, `sudo`, `rm -rf`, `curl | sh`, `security`, `printenv`). Edits to security files require approval. |

## 3. URL guard spec (`hooks/lib/url-guard.ts`)

Accept only when every check passes: `new URL(raw)` parses, the protocol is `http:` or `https:`, `username` and `password` are empty, the hostname is in the set {`127.0.0.1`, `localhost`, `[::1]`/`::1`}, and the port is empty or an integer 1–65535. Strip any path, query or hash from base URLs, and build endpoint URLs only from constant path strings.

These must be rejected (tests in M2.1): `http://127.0.0.1@evil.com`, `http://evil.com#@127.0.0.1`, `http://localhost.evil.com`, `http://127.0.0.1.nip.io`, `http://2130706433`, `http://0x7f.0.0.1`, `http://0177.0.0.1`, `http://[::ffff:7f00:1]`, `http://0.0.0.0`, `http://192.168.1.10`, `file:///etc/passwd`, `javascript:…`, and an empty string. `OLLAMA_HOST` values (`0.0.0.0:11434` or a bare `host:port`) are normalised, then guarded. `0.0.0.0` maps to `127.0.0.1` for probing, and the pane notes that Ollama is exposed on all interfaces.

## 4. `$` call allowlist (compare with the output of `claude plugin validate .`)

Allowed calls: `$.http.fetch`, `$.clock.now`, `$.clock.every`, `$.clock.after`, `$.clock.sleep`, `$.env.get`, `$.command.register`, `$.ui.open`, `$.ui.close`, `$.ui.resolve`, `$.ui.toast`, `$.ui.status`, `$.ui.log`, `$.ui.invalidate`, `$.store.get`, `$.store.set`, `$.state.get`, `$.state.set` (via `read`/`update`), `$.plugin.name`.

Allowed env reads: `ANTHROPIC_BASE_URL`, `OLLAMA_HOST`. No env writes are allowed.

Allowed hooked events: `session.start`, `classic.SessionStart`, `turn.step`, `tool.call`, `command.run`, `ui.render`.

Anything else needs a written justification in this file, approved by the user, before it's used.

## 5. Bounds

| Item | Limit |
|---|---|
| poll interval | 2–300 s (default 5) |
| probe timeout | 200–10000 ms (default 1500) |
| model refresh | 10–3600 s (default 30) |
| latency and TTFT samples per backend | 200 |
| models kept per backend | 200 (+N more counter) |
| `byModel` keys | 50 |
| string clamp | model id 200, version 32, error text 120 (rmod's own words, never server text) |

## 6. Operational advice for the user (shown in the README)

- Ollama listens on `127.0.0.1` by default. Setting `OLLAMA_HOST=0.0.0.0` exposes it to your network. LM Studio has a "Serve on Local Network" toggle, so keep it off unless you need it, and turn on its API token if you do.
- Install mods only from sources you trust. Run `claude plugin validate <dir>` to see a mod's hooks and calls before installing it.
- Keep Claude Code up to date (`claude update`). Mods need v2.1.287 or later.
- Optionally turn on Claude Code's sandbox for Bash (`/sandbox`). Note that it doesn't contain mods.

## 7. Development hygiene

- Run `git config core.hooksPath .githooks` once after cloning. The hook runs `gitleaks git --pre-commit --redact --staged --verbose`, and blocks `.env*`, keys and `settings.local.json`.
- Never commit `.claude/settings.local.json` or `CLAUDE.local.md`, debug logs or transcripts (`*.jsonl`).
- If a secret is ever committed: rotate it first, then purge the history (`git filter-repo`). Deleting it in a new commit isn't enough.

## 8. Release checklist

- [ ] `claude plugin validate .` passes, and calls, env and events ⊆ the §4 allowlist, with no gating hooks.
- [ ] The URL guard tests in §3 all pass, and fetch-recording tests show only loopback URLs.
- [ ] Grep proves no `e.command`, `e.text`, prompt or result text is stored, logged or displayed.
- [ ] The token is `sensitive`, is only in the Authorization header to `lmstudioUrl`, and never appears in fixtures.
- [ ] Every observer passes results through unchanged, and fault-injection tests (S19) pass.
- [ ] The §5 bounds are enforced and tested.
- [ ] gitleaks reports no leaks for the full history (`gitleaks git --redact .`).
- [ ] `npm audit` is clean (dev tooling), the lockfile is committed, and there are no runtime deps.
- [ ] README states the tested versions and the trust and privacy statement.
