# rmod: implementation plan

Work top to bottom with `/implement-milestone <id>`. Tick each box when it passes `/verify` and review. Each milestone ends with a working, tested mod.

## M0 Repo bootstrap (user + Claude)
- [x] M0.1 `git init`, then `git config core.hooksPath .githooks`, `brew install gitleaks`, and check that `.githooks/pre-commit` runs (stage a fake `AKIA…` string in a scratch file and expect the commit to be blocked).
- [x] M0.2 Run `claude --version` (≥ 2.1.287 required), then `/docs-check` to fill in `docs/REFERENCES.md`.
- [ ] M0.3 Run `/probe-local-servers` with both servers running, and again with each stopped. Save sanitized fixtures to `tests/fixtures/`. *(Ollama done 2026-10-09; LM Studio wasn't running, so its fixtures come from the live docs. Re-probe pending.)*
- [x] M0.4 Dev tooling: `package.json` (private, no runtime deps) with an exact-pinned latest stable `typescript` devDependency, `npm install --ignore-scripts`, and a committed `package-lock.json`. Add the `tsconfig.json` per the types header if Claude Code hasn't generated one.

## M1 Skeleton mod
- [x] M1.1 `.claude-plugin/plugin.json` (with `userConfig` per FR-6.2 and `"types"`), `hooks/hooks.json`, a `hooks/register.tsx` that registers `/rmod-status` returning "rmod loaded", and `types/index.d.ts` with the full contract.
- [x] M1.2 Load it in a second terminal: `cd ~ && claude --plugin-dir <repo path> --debug` (currently `/path/to/rmod`). Confirm that `/plugin` shows `1 mod active · rmod` and that `.claude-plugin/types/` was generated. Then `npx tsc -p .`.
- [x] M1.3 First kit test: `FR-6.1 /rmod-status answers`. `claude plugin validate .` passes, and `calls:` is within the allowlist.

## M2 Pure core (unit tests only)
- [x] M2.1 `url-guard.ts` plus exhaustive tests, including the bypass cases in SECURITY.md §3 (FR-6.3, NFR-1).
- [x] M2.2 `config.ts` (also the FR-6.2 tests deferred from M1.1: defaults, overrides via `test(name, { options })`, sensitive token kept out of `Config` and every output): defaults, ranges, `OLLAMA_HOST` handling and regex validation (FR-1.1, FR-6.2, FR-6.3).
- [x] M2.3 `parse-ollama.ts` and `parse-lmstudio.ts` against fixtures, malformed input and oversize lists (FR-5.1, FR-5.4).
- [x] M2.4 `stats.ts`: ring buffer, avg/p50/p95, tok/s, `byModel` cap (FR-4.2, NFR-3).
- [ ] M2.5 `attribution.ts` (also: widen the `localMcpToolPattern` default. MCP server names can contain `_`, e.g. `mcp__claude_ai_Claude_Docs__…`, so `[^_]*__` misses `mcp__ollama_local__x`. Update the manifest, config.ts and SPEC FR-4.1b together. Known limit: LM Studio requests may name a model by its `loaded_instances[].id` rather than `key`, so check what `usage.model` reports before relying on name matching for LM Studio): base URL and model-name matching, and the tool-call classifier with positive and negative cases (FR-4.1).

## M3 Server detection (FR-1, FR-2)
- [ ] M3.1 Poll loop in `session.start` with timer cancel-on-reload, no overlapping probes, and the timeout race.
- [ ] M3.2 Ollama probe, then state. LM Studio probe with the 404 fallback and 401 → auth. Token header only to `lmstudioUrl`.
- [ ] M3.3 Kit tests with a mock clock and `http.fetch` stubs: up, refused, timeout, 401, 500, malformed, disabled, flapping.

## M4 Visual status band (FR-3)
- [ ] M4.1 `AbovePrompt` band with ✓/✗/⚠/…/– plus words and colours, and a compact mode under 60 columns.
- [ ] M4.2 One toast per transition, and none on the first probe.
- [ ] M4.3 `/rmod-status` text fallback. Mount tests on `terminal` and `desktop`.
- [ ] M4.4 Manual check in a real terminal and in the Desktop app (TESTING.md §5).

## M5 Available models (FR-5)
- [ ] M5.1 Inventory refresh (on up, on interval, and on demand) for Ollama `/api/tags` + `/api/ps` and LM Studio `/api/v1/models`.
- [ ] M5.2 Band counts and pane model lists (loaded first, capped, `+N more`).

## M6 Live request counter (FR-4)
- [ ] M6.1 `turn.step` instrumentation (count, in-flight, latency, TTFT, tokens), with attribution. Time TTFT to the first `text`/`thinking`/`tool` chunk, not an engine or envelope chunk (check the `TurnStepChunk` kinds in the types), and read `outTokens` from `TurnUsage` (check the field name). Wrap every stats update in try/catch (NFR-2).
- [ ] M6.2 `tool.call` instrumentation for Bash, WebFetch and MCP patterns. Never record the command text.
- [ ] M6.3 Pane stats table and band summary. `/rmod-reset`. State survives hot reload and resets on `/clear`.
- [ ] M6.4 Manual end-to-end: run Claude Code against Ollama via `ANTHROPIC_BASE_URL=http://127.0.0.1:11434` (TESTING.md §5) and against LM Studio, and check that the counts match the number of requests.

## M7 Pane polish and preferences (FR-3.5, FR-3.6)
- [ ] M7.1 `/rmod` pane with Refresh, Reset and Hide/Show band buttons with hotkeys, plus `$.store` persistence and re-seeding on `classic.SessionStart`.
- [ ] M7.2 Narrow-terminal and long-name layout tests.

## M8 Hardening and release
- [ ] M8.1 `qa-tester`: traceability is 100% (automated or manual) for every FR and NFR ID.
- [ ] M8.2 `/security-review all` returns SHIP.
- [ ] M8.3 README usage and screenshots, CHANGELOG, then `/release minor` to v0.1.0 or later. Optionally add a marketplace.json for sharing.
