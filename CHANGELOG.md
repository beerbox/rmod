# Changelog

All notable changes to rmod are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Project guidance: CLAUDE.md, path-scoped rules, development skills (`/docs-check`, `/verify`, `/implement-milestone`, `/probe-local-servers`, `/security-review`, `/release`), `mod-reviewer` and `qa-tester` subagents, the spec, architecture, plan, testing, security and reference docs, the secret-scanning pre-commit hook, and `.gitignore`.
- Dev tooling: `package.json` with TypeScript 7.0.2 pinned exactly (dev-only, no runtime deps), committed lockfile, and `tsconfig.json` per the 2.1.295 types header.
- Sanitized test fixtures for Ollama 0.40.2 (`/api/version`, `/api/tags`, `/api/ps`) and LM Studio (`/api/v1/models`, `/v1/models`, shapes from the live docs).
- Skeleton mod: manifest with the full `userConfig` (FR-6.2), the `$.state` contract in `types/index.d.ts`, and a hooks module that registers `/rmod-status` (FR-6.1).
- Loopback-only URL guard (`hooks/lib/url-guard.ts`, NFR-1): exact-spelling host check that resists numeric, encoded, IDNA and userinfo bypasses, canonical bases, constant endpoint paths, and `OLLAMA_HOST` normalisation with Ollama's default ports.
- Config parsing (`hooks/lib/config.ts`, FR-1.1, FR-6.2, FR-6.3): validated options with per-field fallback and one log line each, `OLLAMA_HOST` support, a ReDoS guard on the MCP pattern, and the LM Studio token kept apart from config (printable ASCII only, withheld when `lmstudioUrl` is rejected). `/rmod-status` shows the resolved URLs.
- Response parsers (`hooks/lib/models.ts`, `parse-ollama.ts`, `parse-lmstudio.ts`, FR-1.3, FR-5.1, FR-5.4). They validate untrusted JSON, strip unsafe Unicode, clamp, dedupe and cap at 200 with a `+N more` count. Loaded models come first, with VRAM and expiry for Ollama. Cloud models are skipped. Fixture text is generated for tests (`npm run fixtures`).
- Request statistics (`hooks/lib/stats.ts`, FR-4.2, FR-4.3, FR-4.6). Immutable counters and 200-sample latency and TTFT buffers give avg, p50, p95 and last. tok/s is measured over generation time and can't be inflated by one-chunk replies. Speed figures use successful requests only. Per-model counts are capped at 50 plus an overflow count. `asStats` repairs stale state after a hot reload.
- Request attribution (`hooks/lib/attribution.ts`, `shell.ts`, FR-4.1). A quote-aware Bash reader counts commands that *run* `ollama run` / `lms chat` or send a network client to a backend port, not ones that only mention them. WebFetch is matched by port, MCP tools by server name, and model steps by base URL, then by model id. The default `localMcpToolPattern` now allows underscores, plugin prefixes and any letter case. A shared port is warned about. A manifest/config parity check is in `/verify`.
- Server detection (M3, FR-1, FR-2, FR-3.3). Both backends are probed at start and then every `pollIntervalSec`. Each probe is raced against `probeTimeoutMs`, and a backend still being probed is skipped. A second `session.start` replaces the poll timer rather than adding one. LM Studio falls back from a native 404 to `/v1/models` and remembers the endpoint. 401/403 means auth required, and the token is sent only to `lmstudioUrl`, only after that URL asked for it. `/rmod-status` reports each backend's state as glyph + word.
- Security: `$.http.fetch` follows redirects and drops `Authorization` across origins (probed on 2.1.295; see SECURITY.md §3 for the remaining risk).
- Status band above the prompt (M4, FR-3.1–3.4, FR-3.7, FR-3.8). It shows glyph + word + theme colour per backend, model counts and a session summary when known. It drops detail to fit `bodyColumns` and collapses to icons below 60 columns. It yields to surveys and to `showBand` off. One toast per change between listening and not listening, confirmed over two probes so a single slow answer toasts nothing, and none on the first probe. A disabled backend shows off at once, even right after `/clear`. `/rmod-status` gives the same information as text.

### Fixed
- Docs and dev instructions point to the actual repo path (`/path/to/rmod`).
