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

| ID | Automated test(s) | Manual step | Status |
|---|---|---|---|
| FR-1.1 | | 3 | todo |
| … one row per ID in SPEC.md … | | | |
