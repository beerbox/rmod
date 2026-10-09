# rmod: test strategy

Goal: rmod is **fully tested**. Every requirement ID in `docs/SPEC.md` is proved by an automated test, or, only where a human eye is needed, by a scripted manual check (§5). The traceability table (§6) is the evidence.

Always check the test kit's current API at `https://code.claude.com/docs/en/plugins/mods/test.md` and in the `declare module 'claude-code/testing'` section of the generated types before writing tests.

## 1. Layers

| Layer | What | How | Where |
|---|---|---|---|
| L1 Unit | pure logic in `hooks/lib/` (URL guard, config, parsers, stats, attribution) | `test`/`expect` from `claude-code/testing`, importing the lib directly | `tests/unit/*.test.ts` |
| L2 Hook | events through the real module: probes, timers, counting, commands | the kit's `$` raises events, `on(...)` stubs the engine, `mock.clock`, `mock.env`, `http.fetch` stubs | `tests/kit/*.test.ts` |
| L3 UI | band and pane trees on `terminal` and `desktop`, presses, layout widths | `$.ui.mount` in a loop over surfaces, `find`/`press` by key | `tests/kit/ui-*.test.ts` |
| L4 Static | manifest, hooks, calls, env reads, state contract, types | `claude plugin validate .` + allowlist check, `npx tsc -p .` | `/verify` |
| L5 Manual E2E | real servers, real Claude Code, real terminal and Desktop app on the Mac | §5 checklist | release |

Run everything with `/verify`. `claude plugin test` exits 1 on any failure, so it's CI-ready.

## 2. Fakes

- **Servers**: one helper `fakeServers(on, { ollama: 'up'|'down'|'timeout'|'401'|'500'|'garbage', lmstudio: … , lmV1: true|false })` that registers an `http.fetch` stub. It branches on `e.url` and returns `{ value: { status, ok, headers, text } }` built from `tests/fixtures/index.ts` (generated from `tests/fixtures/*.json` by `npm run fixtures`), `{ deny: 'ECONNREFUSED' }` for down, and `await clock.sleep(…)` past the timeout for a hang. It records every URL fetched, so tests can assert "never fetched a non-loopback URL" and "never fetched while disabled".
- **Time**: `const clock = mock.clock(on, { now: 1_000_000 })`, then `await clock.advance(5000)` per poll.
- **Env**: `mock.env(on, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:11434' })` (or none).
- **Model requests**: a `turn.step` async-generator stub that yields 1–3 text chunks (optionally after `clock.sleep` for TTFT) and returns `{ turnId, index, answer, toolUses: [], stopReason: 'end_turn', usage: { input_tokens, output_tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model } }`. Variants: `usage: null`, `stopReason: null` (failed), and throwing mid-stream.
- **Tool calls**: a `tool.call` stub returning `{ result: 'ok' }`, `{ result, isError: true }` or `{ deny: '...' }`.
- **Store**: a Map-backed `store.get`/`store.set` stub (see the kit docs' drawing test).
- **Session start**: stub `session.start` → `{ cwd: '/work' }`, `command.register` → `{ value: undefined }` and `ui.toast`/`ui.log`/`ui.status` → `{ value: undefined }` (record the texts), then `await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })`.

## 3. Scenario matrix (minimum)

| # | Scenario | IDs |
|---|---|---|
| S1 | both up → band `✓ Ollama` green, `✓ LM Studio` green | FR-1.1, FR-2.1, FR-3.1 |
| S2 | Ollama refused, LM Studio up | FR-1.2, FR-3.1 |
| S3 | probe hangs past `probeTimeoutMs` → down. The next tick doesn't overlap. | FR-1.2, NFR-3 |
| S4 | LM Studio 401 → `⚠ auth required`. With a token → header sent only to lmstudioUrl. | FR-2.3, NFR-1 |
| S5 | LM Studio `/api/v1/models` 404 → `/v1/models` fallback remembered | FR-2.2 |
| S6 | disabled backend never fetched, shows `– off` | FR-1.4, FR-2.4 |
| S7 | flapping up→down→up → exactly 2 toasts. First probe → 0 toasts. | FR-3.4 |
| S8 | non-loopback / tricky URLs in config → rejected, default used, one log line, never fetched | FR-6.3, NFR-1 |
| S9 | models: loaded-first ordering, `+N more` over 200, empty list, malformed JSON → `⚠` without touching the other backend | FR-5.* |
| S10 | base URL = Ollama → each `turn.step` counted for Ollama, latency/TTFT/tok/s computed | FR-4.1a, FR-4.2 |
| S11 | base URL = Anthropic, model name in LM Studio inventory → attributed to LM Studio. Unknown model → not counted. | FR-4.1a |
| S12 | Bash `curl http://127.0.0.1:11434/api/chat …` and `ollama run llama3` → counted for Ollama. `curl https://example.com` and `echo 11434` → not counted. Command text never stored. | FR-4.1b, FR-4.6 |
| S13 | MCP tool `mcp__ollama__generate` counted. Custom pattern respected. | FR-4.1b |
| S14 | in-flight shows while a step streams (mock clock), clears after | FR-4.3 |
| S15 | failed and aborted steps and tool errors → `failed++` | FR-4.2 |
| S16 | rmod's own probes are never counted | FR-4.1c |
| S17 | hot reload (re-raise `session.start`) keeps `$.state` counters and doesn't start a second timer | FR-4.5, NFR-3 |
| S18 | `/clear` → counters at defaults, band preference and off states re-seeded by the next poll tick (no `classic.SessionStart` hook, which validate lists as gating). The kit can't reset `$.state` under a live module, so this is **manual** (§5 steps 10 and 13). The read-time on/off is kit-tested | FR-4.5, FR-3.6 |
| S19 | rmod throws internally (bad fixture or forced error) → the tool call and turn step results are passed through unchanged | NFR-2 |
| S20 | UI on terminal and desktop: band full (≥ 60 cols) and compact (< 60). Pane buttons Refresh, Reset and Hide work by key. Every status glyph has a word. | FR-3.*, NFR-5 |
| S21 | `/rmod-status` text equals the state (for `-p` and VS Code) | FR-3.7, FR-6.1 |
| S22 | ring buffers capped at 200, `byModel` capped at 50 | NFR-3 |

## 4. Rules

Name every test with the IDs it proves. Use no real network and no real sleeps. Assert on behaviour, not implementation. Keep each test independent (the kit reloads the module per test). Keep fixtures sanitized.

## 5. Manual acceptance on the MacBook (L5)

Record the versions: `claude --version`, `ollama --version`, LM Studio version, macOS version.

1. **Load**: in a second terminal, outside the repo, run `claude --plugin-dir /path/to/rmod --debug`. Check that `/plugin` lists `rmod` as active and that no dim error lines appear.
2. **Both down**: quit Ollama (menu bar → Quit) and stop the LM Studio server. Within 5 s the band shows red `✗ Ollama` and `✗ LM Studio`.
3. **Ollama up**: start the Ollama app. Within 5 s you see a green `✓ Ollama` and one toast. The model count matches `ollama list`, and the loaded count matches `ollama ps`.
4. **LM Studio up**: start the server (Developer tab, or `lms server start`). You see a green tick, and the model count matches `lms ls`, the loaded count `lms ps`.
5. **Auth**: turn on "Require API token" in LM Studio. You see a yellow `⚠ auth required`. Set `lmstudioApiToken` in `/plugin` config and confirm it shows green again. Turn the setting off afterwards.
6. **Counter via model endpoint**: in another terminal, run `ANTHROPIC_BASE_URL=http://127.0.0.1:11434 ANTHROPIC_AUTH_TOKEN=ollama claude --plugin-dir /path/to/rmod --model <local-model>` and send 3 prompts. The band count equals the number of model requests (compare with `--debug` or the turn count). avg, p95 and tok/s look plausible. Repeat with LM Studio (`http://127.0.0.1:1234`, following LM Studio's current Claude Code instructions).
7. **Counter via tools**: in a normal session, ask Claude to `curl` Ollama's `/api/generate` twice. The tool count goes up by 2.
8. **Pane**: `/rmod` opens the pane. Refresh, Reset and Hide band work. Esc closes it. Hiding the band persists after restarting Claude Code.
9. **Hot reload**: edit a label in `hooks/ui/band.tsx` and save. The band updates, and the counters are kept.
10. **/clear**: counters reset.
11. **Desktop app**: open the Code tab with the plugin installed or configured (`CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` `env`), then repeat steps 2, 3 and 8.
12. **Narrow terminal**: resize to 50 columns. The compact band still makes sense.
13. **/clear with one backend disabled**: turn off "Monitor Ollama" in `/config`, then run `/clear`. The band still shows a dimmed `– Ollama off` immediately, and `--debug` shows no request to `:11434`.
14. **No toast on a blip**: with Ollama up, run a large model load (or pause Ollama for about 2 s). The band may flick to `✗` for one poll, but there's no toast unless it stays down for two polls.
15. **Privacy**: run `grep -r` over `~/.claude/plugins/store/` for any prompt or command text. There should be none.

## 6. Traceability (maintained by `qa-tester`)

Every test name starts with the IDs it proves, so `claude plugin test | grep '<ID>'` lists the evidence. Paths are under `tests/`. Last full run: 243 pass, 0 fail (20 files), `npx tsc -p .` clean.

| ID | Automated test file(s) / test name prefix | Manual step (§5) | Status |
|---|---|---|---|
| FR-1.1 | `kit/detection` "FR-1.1 FR-2.1 FR-3.3 both servers are probed…"; `kit/config` "FR-1.1 OLLAMA_HOST is used…"; `unit/config` "FR-1.1 …" (OLLAMA_HOST, 0.0.0.0, precedence); `unit/url-guard` "FR-1.1 normalizeOllamaHost…" | 2, 3 | both |
| FR-1.2 | `kit/detection` "FR-1.2 a refused connection…", "FR-1.2 no answer within probeTimeoutMs…", "FR-1.2 a fetch refused by policy…"; `kit/edges` "FR-1.2 FR-3.4 both servers down from the start…"; `unit/probe` "FR-1.2 …" | 2 | both |
| FR-1.3 | `kit/detection` "FR-1.3 the probe round-trip time…", "FR-1.3 FR-5.4 a 500 is degraded…"; `kit/edges` "FR-5.4 FR-1.3 a 500 on LM Studio…"; `unit/probe` "FR-1.3 …"; `unit/parse-ollama` "FR-1.3 parseVersion…" | 3 | both |
| FR-1.4 | `kit/detection` "FR-1.4 FR-2.4 a disabled backend shows off and is never probed", "…with both disabled nothing is ever fetched"; `kit/band` "FR-1.4 a disabled backend draws off at once…" | 13 | both |
| FR-2.1 | `kit/detection` "FR-1.1 FR-2.1 FR-3.3 both servers are probed…"; `unit/probe` "FR-2.1 a 2xx native LM Studio probe is up" | 4 | both |
| FR-2.2 | `kit/detection` "FR-2.2 a native 404 falls back…", "FR-2.2 a native 404 whose fallback is refused…", "FR-2.2 a 404 on both endpoints…"; `kit/inventory` "FR-5.1 the OpenAI-compatible fallback…"; `unit/probe` "FR-2.2 …"; `unit/status-text` "FR-1.1 FR-2.2 …" | – | automated |
| FR-2.3 | `kit/detection` "FR-2.3 …" (7 tests: 401/403, token only to lmstudioUrl, never unasked, wrong token, re-ask after restart, older LM Studio); `unit/probe` "FR-2.3 …" | 5 | both |
| FR-2.4 | `kit/detection` "FR-1.2 FR-2.4 LM Studio not answering in time…", "FR-2.4 a disabled LM Studio shows off…", "FR-1.4 FR-2.4 …"; `unit/probe` "FR-1.2 LM Studio not listening is down" | 2 | both |
| FR-3.1 | `kit/band` "FR-3.1 …" (6 tests: glyph/word/colour on terminal+desktop, checking, auth/degraded/down/off, both down, both off, survey); `unit/band` "FR-3.1 …"; `unit/probe` "FR-3.1 the initial status is unknown…" | 2, 3, 4, 5, 11 | both |
| FR-3.2 | `kit/counter` "FR-3.2 FR-4.3 the band shows the session summary"; `kit/inventory` "FR-5.2 the band shows each backend's model counts"; `unit/band` "FR-3.2 FR-5.2 …" | 6 | both |
| FR-3.3 | `kit/band` "FR-3.3 the band follows a server stopping within one poll interval…"; `kit/detection` "FR-3.3 a server that starts and stops is followed…" | 2, 3 | both |
| FR-3.4 | `kit/band` "FR-3.4 one toast per transition…", "FR-3.4 one slow answer toasts nothing…", "FR-3.4 a repeated session.start keeps what was announced…"; `kit/edges` "FR-3.4 a server flapping up, down, up…", "FR-1.2 FR-3.4 both servers down from the start…"; `unit/band` "FR-3.4 …" | 3, 14 | both |
| FR-3.5 | `kit/pane` "FR-3.5 FR-6.1 /rmod is registered as immediate…", "FR-3.5 FR-4.4 FR-5.3 the pane shows each backend…", "FR-3.5 the buttons show their hotkeys…", FR-3.5 "checked N s ago" keeps ageing…; `unit/pane` "FR-3.5 FR-5.3 …" | 8 | both |
| FR-3.6 | `kit/pane` "FR-3.6 …" (4 tests: Hide/Show saves to `$.store`, hidden from an earlier session, showBand default vs saved choice, bad saved type); `kit/band` "FR-3.6 showBand off draws no band". Re-seed after `/clear` is manual (kit can't reset `$.state` under a live module) | 8, 10, 13 | both |
| FR-3.7 | `kit/pane` "FR-3.7 in claude -p (no surface)…", "FR-3.7 a surface that places no pane…"; `kit/band` "FR-3.1 FR-3.7 NFR-5 …" (terminal + desktop); `unit/status-text` "FR-3.7 …" | 11 | both |
| FR-3.8 | `kit/band` "FR-3.8 at exactly 60 columns…", "FR-3.8 under 60 columns…"; `unit/band` "FR-3.8 …" | 12 | both |
| FR-4.1 (a) | `kit/counter` "FR-4.1a …" (base URL, remote not counted, inventory id, LM Studio, subagent, `:latest`); `unit/attribution` "FR-4.1a …" | 6 | both |
| FR-4.1 (b) | `kit/counter` "FR-4.1b FR-4.2 a Bash curl to Ollama counts…", "FR-4.1b non-local tools and background Bash…", "FR-4.1 FR-4.2 NFR-2 a tool error counts as failed…"; `unit/attribution` "FR-4.1b …" (Bash, CLIs, WebFetch, MCP pattern, look-alikes); `unit/requests` "FR-4.1b …" | 7 | both |
| FR-4.1 (c) | `kit/counter` "FR-4.1c rmod's own probes are never counted" | – | automated |
| FR-4.2 | `kit/counter` "FR-4.1a FR-4.2 …" (latency, TTFT, tok/s), "FR-4.2 NFR-2 a step the caller stops reading…", "FR-4.2 a step without usage…", "FR-4.2 a step that resolves with no stop reason…"; `unit/stats` "FR-4.2 …"; `unit/requests` "FR-4.2 …". A model API error (throwing stream) can't be stubbed by the kit; the failed path is covered by interrupt / no stop reason / tool error | 6 | both |
| FR-4.3 | `kit/counter` "FR-4.3 a model step shows as in flight while it streams", "FR-3.2 FR-4.3 …"; `unit/stats` "FR-4.3 …"; `unit/requests` "FR-4.3 FR-4.5 …" | 6 | both |
| FR-4.4 | `kit/pane` "FR-3.5 FR-4.4 FR-5.3 the pane shows each backend, its stats…"; `unit/pane` "FR-4.4 the stats table…" | 8 | both |
| FR-4.5 | `kit/edges` "FR-4.5 a hot reload (session.start again) keeps the counters…", "FR-4.5 after /clear the counters start from zero"; `kit/counter` "FR-4.5 FR-6.1 /rmod-reset clears the counters…", "FR-4.5 /rmod-reset keeps a request that is still running"; `kit/pane` "FR-4.5 the Reset button clears the counters"; `unit/requests` "FR-4.3 FR-4.5 …". A real reset of live `$.state` on `/clear`, `/resume`, `/branch` is manual | 9, 10 | both |
| FR-4.6 | `kit/counter` "FR-4.6 nothing a request carried reaches what rmod shows…", "FR-4.1b FR-4.2 … the command text is never kept"; `unit/attribution` "FR-4.6 …"; `unit/stats` "FR-4.6 …" | 15 | both |
| FR-5.1 | `kit/inventory` "FR-5.1 …" (tags + ps, LM Studio from the probe, fallback ids, every modelsRefreshSec, on coming up, /rmod-refresh, disabled, empty, failed ps); `kit/pane` "FR-5.1 the Refresh button…"; `kit/detection` "FR-5.1 an LM Studio with no models is up"; `unit/inventory`, `unit/parse-ollama`, `unit/parse-lmstudio` "FR-5.1 …" | 3, 4 | both |
| FR-5.2 | `kit/inventory` "FR-5.2 …" (counts, down shows none, auth shows none, ⚠ on unreadable); `kit/edges` "FR-5.3 NFR-3 more than 200 models…" (band counts 250); `unit/band` "FR-3.2 FR-5.2 …" | 3, 4 | both |
| FR-5.3 | `kit/pane` "FR-3.5 FR-4.4 FR-5.3 …", "FR-5.3 a narrow pane truncates long model names…"; `kit/edges` "FR-5.3 NFR-3 more than 200 models: the pane lists 200 and +N more…" (terminal + desktop); `unit/inventory` "FR-5.3 …" (markers, order, request counts, +N more, sizes) | 8 | both |
| FR-5.4 | `kit/inventory` "FR-5.4 an unreadable Ollama inventory says so and leaves LM Studio untouched", "FR-5.4 a later unreadable list keeps the last good one", "FR-5.4 FR-5.2 …"; `kit/detection` "FR-1.3 FR-5.4 …"; `kit/edges` "FR-5.4 FR-1.3 a 500 on LM Studio…"; `unit/parse-*`, `unit/probe`, `unit/pane`, `unit/inventory` "FR-5.4 …" | – | automated |
| FR-6.1 | `kit/commands` "FR-6.1 /rmod-status answers"; `kit/pane` "FR-3.5 FR-6.1 /rmod …"; `kit/inventory` "FR-5.1 FR-6.1 /rmod-refresh…"; `kit/counter` "FR-4.5 FR-6.1 /rmod-reset…" | 8 | both |
| FR-6.2 | `kit/config` "FR-6.2 manifest defaults load with no log lines…"; `unit/config` "FR-6.2 …" | 5 | both |
| FR-6.3 | `kit/config` "FR-6.3 a non-loopback URL logs one line…", "FR-6.3 the loader refuses an out-of-range number…"; `kit/detection` "NFR-1 FR-6.3 a URL trick in config is rejected and never fetched"; `unit/config` "FR-6.3 …" (URLs, OLLAMA_HOST, bad/oversized regex); `unit/url-guard` "FR-6.3 …"; `unit/attribution` "FR-6.3 …" | – | automated |
| NFR-1 | `kit/detection` "NFR-1 rmod only ever fetches the loopback backend URLs", "NFR-1 FR-6.3 a URL trick…"; `kit/config` "NFR-1 the API token never reaches logs or command output"; `unit/url-guard`, `unit/config`, `unit/parse-ollama`, `unit/stats` "NFR-1 …"; static: `/verify` (validate `calls:` allowlist + gitleaks) | 15 | both |
| NFR-2 | `kit/counter` "NFR-2 the model stream and result pass through unchanged", "NFR-2 thinking, text and stop chunks pass through…", "FR-4.2 NFR-2 …", "FR-4.1 FR-4.2 NFR-2 …"; `kit/commands` "NFR-2 session.start still passes on when command registration fails"; `kit/config` "NFR-2 session.start passes on when $.env.get is denied"; `kit/detection` "NFR-2 a repeated session.start replaces the poll timer…"; `unit/config` "NFR-2 …" | – | automated |
| NFR-3 | `kit/detection` "NFR-3 a hung server holds one request at most…", "NFR-3 FR-2.3 an older LM Studio that needs auth gets at most two requests per tick"; `kit/band` / `kit/pane` "NFR-3 drawing … never fetches"; `kit/inventory` "NFR-3 …"; `kit/edges` "FR-5.3 NFR-3 more than 200 models…"; `unit/stats`, `unit/parse-ollama`, `unit/parse-lmstudio`, `unit/inventory` "NFR-3 …" (200-sample buffers, 50 byModel keys, 200-model cap, 4 MB body) | – | automated |
| NFR-4 | Static only: `claude --version` against the minimum in `docs/REFERENCES.md` (mods ≥ 2.1.287), `claude plugin validate .`, `npx tsc -p .` against the generated types; every UI kit test runs on `terminal` and `desktop` | 1 (record versions), 11 | manual |
| NFR-5 | `kit/band` "FR-3.1 FR-3.7 NFR-5 …", "FR-3.1 auth, degraded, down and off each draw their glyph, word and colour…"; `kit/pane` "FR-3.5 … markers have a legend (NFR-5)"; `unit/band`, `unit/status-text` "… NFR-5 …" (meaning never depends on colour). How it looks with `NO_COLOR` or a dim theme in a real terminal is a visual check | 11, 12 | both |
| NFR-6 | This table: every FR and NFR ID maps to an automated test or a §5 step, with no `todo` rows | – | automated |
