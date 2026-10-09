# rmod: architecture

> API names here were checked against Claude Code **2.1.295** types and the live docs on 2026-10-09. The generated `.claude-plugin/types/claude-code/index.d.ts` of the installed build always wins. Run `/docs-check` when in doubt.

## 1. Files

```
.claude-plugin/plugin.json   name "rmod", version, description, author, "types": "./types/index.d.ts", userConfig (FR-6.2)
hooks/hooks.json             { "description": "rmod hooks module", "modules": ["./register.tsx"] }
hooks/register.tsx           wires events → lib → state; registers commands; starts timers
hooks/lib/config.ts          parse + validate options (ranges, loopback, regex) → Config  [pure]
hooks/lib/url-guard.ts       isLoopbackUrl(), buildUrl(base, path)                        [pure]
hooks/lib/probe.ts           classifyProbe(outcome) → Health/ProbeResult (status, error, timeout) [pure; the fetch itself is in register.tsx]
hooks/lib/models.ts          parseJson, clean* clamps, finalize (dedupe, loaded first, cap 200) [pure]
hooks/lib/parse-ollama.ts    parseVersion / parseTags / parsePs / mergeOllama(tagsBody, psBody) [pure]
hooks/lib/parse-lmstudio.ts  parseV1Models / parseOpenAiModels                           [pure]
hooks/lib/attribution.ts     classifyToolCall(e, cfg), backendForModelStep(baseUrl, model, inventories) [pure]
hooks/lib/stats.ts           ring buffer, avg/p50/p95, tok/s; immutable updates          [pure]
hooks/ui/band.tsx            AbovePrompt tree (full + compact)                            [pure given data + elements]
hooks/ui/pane.tsx            Pane tree: status, stats table, model lists, buttons
types/index.d.ts             PluginState contract (§3)
tests/                       unit/*.test.ts (lib), kit/*.test.ts (hooks, UI), fixtures/*.json
```

**Rule:** `hooks/lib/*` never touches `$`. That makes it unit-testable, and static analysis doesn't allow `$` to be passed to imported functions anyway. `register.tsx` makes every `$` call itself, written in full (`$.http.fetch(...)`), and hands the results to pure functions.

## 2. API surface used (allowlist mirror, see SECURITY.md §4)

| Kind | Name | Why |
|---|---|---|
| event | `session.start` (single, no matcher) | register commands, read config/env, start poll timers, load `showBand` from store |
| event | `classic.SessionStart` `{ source: ['clear','resume','fork'] }` | re-seed band preference after `$.state` reset |
| event | `turn.step` (async generator) | count/time model requests; TTFT; usage → tok/s |
| event | `tool.call` | count/time tool requests that target local backends |
| event | `command.run` `{ command: [...] }` | `/rmod`, `/rmod-status`, `/rmod-refresh`, `/rmod-reset` |
| event | `ui.render` `{ component: 'AbovePrompt' }` / `{ component: 'Pane', requestId: 'rmod' }` | draw |
| method | `$.http.fetch` | loopback probes only |
| method | `$.clock.now/every/after/sleep` | timing, polling, probe timeout race |
| method | `$.env.get('ANTHROPIC_BASE_URL')`, `$.env.get('OLLAMA_HOST')` | attribution & default URL |
| method | `$.command.register` | commands (`immediate: true`) |
| method | `$.ui.open/close/resolve/toast/status/log/invalidate` | UI |
| method | `$.store.get/set` | persist `bandHidden` only |
| method | `$.state.*` via `atom/read/update` | session state |

## 3. State contract (`types/index.d.ts`, sketch)

```ts
export type BackendId = 'ollama' | 'lmstudio'
export type Health = 'unknown' | 'up' | 'auth' | 'degraded' | 'down' | 'off'
export type ProbeError = 'refused' | 'timeout' | 'policy' | 'http' | 'parse' | 'config'   // rmod's words only, never server text
export type ModelInfo = { id: string; loaded: boolean | null; sizeBytes?: number; params?: string; quant?: string; kind?: 'llm' | 'embedding'; vramBytes?: number; expiresAt?: number }
export type BackendStatus = { health: Health; version?: string; probeMs?: number; checkedAt?: number; error?: ProbeError;
                              models: ModelInfo[]; modelsTruncated: number; modelsAt?: number; modelsError?: ProbeError }
export type Stats = { total: number; model: number; tool: number; inFlight: number; ok: number; failed: number;
                      latMs: number[]; ttftMs: number[]; outTokens: number; genMs: number; lastAt?: number; byModel: Record<string, number> }
declare module 'claude-code' {
  interface PluginState {
    rmod: { ollama: BackendStatus; lmstudio: BackendStatus; statsOllama: Stats; statsLmstudio: Stats; bandHidden: boolean;
            lmstudioEndpoint: 'native' | 'openai' | null }   // FR-2.2, survives hot reload
  }
}
```
Arrays are `readonly` in the real contract. Keys stay flat and literal so `claude plugin validate` can check them. Arrays are capped at 200 (`latMs`, `ttftMs`, `models`), and `byModel` keeps at most 50 keys.

## 4. Flows

**Poll loop** (`session.start`): cancel any old timer, then `$.clock.every(pollMs, tick)`. For each enabled backend, `tick` skips if a probe is still pending, then races `$.http.fetch(url)` against `$.clock.sleep(timeoutMs)`. It classifies the result (FR-1/FR-2), `update`s the backend's status atom, and on a health change between up and down calls `$.ui.toast` (never on the first probe). It refreshes models when the backend has just come up or `modelsRefreshSec` has elapsed. Writing state redraws readers automatically. No `invalidate` is needed for state-backed values.

**Model requests** (`turn.step`):
```ts
on('turn.step', async function* ($, e, next) {
  const b = backendFor(...)                 // from cached base URL + inventories; null → just `return yield* next(e)`
  const t0 = await $.clock.now(); let ttft: number | undefined
  await update($, statsAtom(b), s => begin(s))          // inFlight++
  let r
  try {
    const stream = next(e)
    for await (const chunk of stream) { if (ttft === undefined) ttft = (await $.clock.now()) - t0; yield chunk }
    r = await stream.result
  } finally { /* end(s, ok?, latency, ttft, r?.usage) inside try/catch, never throw */ }
  return r
})
```
Verify the `HookStream` `.result` and generator semantics against the types before you implement this. If re-yielding is fragile, use `const r = yield* next(e)` and drop TTFT. FR-4.2 then marks TTFT as "n/a".

**Tool requests** (`tool.call`, no matcher): `classifyToolCall(e)` returns `BackendId | null` from `e.tool` and its arguments, using regexes over host:port and CLI verbs. It never stores the command. If not local, `return next(e)`. If local, run begin, then `const r = await next(e)`, then end (ok = `!r.deny && !r.isError`), then `return r`.

**Attribution of model requests**: (1) parse `ANTHROPIC_BASE_URL` once at start. If its host is loopback and the port equals a backend's port, every step is that backend's. (2) Else, if `e.model` (or `result.usage.model`) exactly matches an inventory model id of one backend, attribute it there. (3) Else it isn't local. The cached base URL refreshes on `classic.SessionStart`.

## 5. UI

Band (full width ≥ 60 cols):
```
✓ Ollama 0.12 · 3 models (1 loaded)   ✗ LM Studio   │ local reqs 12 (⟳1) · avg 2.3s · p95 5.1s · 41 tok/s   [rmod]
```
Compact (< 60 cols): `✓O ✗L · 12 req · 2.3s`

Pane `/rmod` (focus, closeOnEscape): header row of buttons `[r Refresh] [z Reset] [h Hide band]`. Then a section for each backend: the status line (glyph, word, version, probe ms, checked N s ago), a stats table, and the model list (`●` loaded first, then `○`), with the session's request count per model.

Colours: green means up, red means down, yellow means auth/degraded, dim means unknown/off. Every glyph is paired with a word.

## 6. Known constraints and decisions

- `HttpResponse.text` arrives fully buffered by the host, with no size cap in the types. `parseJson` refuses bodies over 4 MB, which bounds the parse work but not the transfer.
- `$.http.fetch` has **no timeout option**, so `Promise.race` it with `$.clock.sleep(timeoutMs)`. A late reply is ignored.
- Static analysis forbids passing `$` to imported functions. Pure libs receive data, and `register.tsx` does the I/O. Small top-level helpers *in the same file* may take `$`, which validate reports as `(via fn)`.
- Use `127.0.0.1` as the default, not `localhost`. On macOS `localhost` can resolve to `::1`, while Ollama binds IPv4 by default.
- The hook budget is about 10 s, and time inside `$` calls doesn't count. Render hooks must only `read`.
- Org policy can refuse `$.http.fetch` to some hosts (web-fetch policy). Show `⚠ blocked by policy` when the rejection says so.
- The loader validates `userConfig` types and `min`/`max` before `register` runs, and refuses the load on a mismatch (probed with the 2.1.295 kit). `config.ts` still re-checks them as defence in depth.
- Hot reload re-runs `session.start`. Store the timer handle in a module variable and cancel it first. State in `$.state` survives the reload.

## 7. Open questions (resolve with /docs-check before the milestone that needs them)

1. The exact `AbovePrompt` props (`hasSurvey`, `bodyColumns`) and whether `ui.render` matchers accept `requestId` for `Pane`.
2. Whether `TurnStepResult.usage.model` reports the local model name for Ollama and LM Studio Anthropic-compatible endpoints.
3. Whether `$.http.fetch` rejects or returns a status on ECONNREFUSED (the design handles both).
4. Whether `$.env.get` sees `env` from settings files (Claude Code applies them to the process env, so expect yes).
5. Whether `$.http.fetch` follows redirects, and whether it keeps `Authorization` across hosts. This gates M3.2 (SECURITY.md §3, Redirects).
