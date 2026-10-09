# rmod: architecture

> API names here were checked against Claude Code **2.1.295** types and the live docs on 2026-10-09. The generated `.claude-plugin/types/claude-code/index.d.ts` of the installed build always wins. Run `/docs-check` when in doubt.

## 1. Files

```
.claude-plugin/plugin.json   name "rmod", version, description, author, "types": "./types/index.d.ts", userConfig (FR-6.2)
hooks/hooks.json             { "description": "rmod hooks module", "modules": ["./register.tsx"] }
hooks/register.tsx           wires events → lib → state; registers commands; starts timers
hooks/lib/config.ts          parse + validate options (ranges, loopback, regex) → Config  [pure]
hooks/lib/url-guard.ts       isLoopbackUrl(), buildUrl(base, path)                        [pure]
hooks/lib/probe.ts           ollamaProbe / lmstudioProbe(outcome) → ProbeResult (+ next step: fallback, retryWithToken), applyProbe [pure; the fetch and timeout race are in register.tsx]
hooks/lib/status-text.ts     statusText(...) → /rmod-status text, glyph + word per state [pure]
hooks/lib/models.ts          parseJson, clean* clamps, finalize (dedupe, loaded first, cap 200) [pure]
hooks/lib/parse-ollama.ts    parseVersion / parseTags / parsePs / mergeOllama(tagsBody, psBody) [pure]
hooks/lib/parse-lmstudio.ts  parseV1Models / parseOpenAiModels                           [pure]
hooks/lib/shell.ts           simpleCommands / programOf / inlineScript: quote-aware Bash reader [pure]
hooks/lib/attribution.ts     targetsOf(cfg), classifyToolCall(tool, e, targets, re), backendForModelStep(baseUrl, model, targets, inv) [pure]
hooks/lib/inventory.ts       ollamaInventory(tags, ps), applyInventory, inventoryDue, sameInventory [pure]
hooks/lib/model-list.ts      modelRows(models, truncated, requestsFor) → ●/○/◌ rows + `+N more`, formatBytes [pure]
hooks/lib/stats.ts           ring buffer, avg/p50/p95, tok/s; immutable updates          [pure]
hooks/lib/band.ts            bandLine(input, bodyColumns) → segments (full, trimmed, compact <60) [pure]
hooks/lib/transitions.ts     transitionToast(name, memory, health) → { memory, toast? }: two-probe confirmation [pure]
hooks/ui/band.tsx            bandTree({ Box, Text }, segments): theme-key colours (success/error/warning) [pure given data + elements]
hooks/ui/pane.tsx            Pane tree: status, stats table, model lists, buttons
types/index.d.ts             PluginState contract (§3)
tests/                       unit/*.test.ts (lib), kit/*.test.ts (hooks, UI), fixtures/*.json
```

**Rule:** `hooks/lib/*` never touches `$`. That makes it unit-testable, and static analysis doesn't allow `$` to be passed to imported functions anyway. `register.tsx` makes every `$` call itself, written in full (`$.http.fetch(...)`), and hands the results to pure functions.

## 2. API surface used (allowlist mirror, see SECURITY.md §4)

| Kind | Name | Why |
|---|---|---|
| event | `session.start` (single, no matcher) | register commands, read config/env, start poll timers, load `showBand` from store |
| event | ~~`classic.SessionStart` `{ source: ['clear','resume','fork'] }`~~ | validate (2.1.295) reports it as a gating hook, so it's not used. The poll tick re-seeds after a `$.state` reset instead (see §4) |
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
                      latMs: number[]; ttftMs: number[]; outTokens: number; rateTokens: number; genMs: number; lastAt?: number;
                      byModel: Record<string, number>; byModelOther: number }
declare module 'claude-code' {
  interface PluginState {
    rmod: { ollama: BackendStatus; lmstudio: BackendStatus; statsOllama: Stats; statsLmstudio: Stats; bandHidden: boolean;
            lmstudioEndpoint: 'native' | 'openai' | null }   // FR-2.2, survives hot reload
  }
}
```
Arrays are `readonly` in the real contract. Keys stay flat and literal so `claude plugin validate` can check them. Arrays are capped at 200 (`latMs`, `ttftMs`, `models`), and `byModel` keeps at most 50 keys (requests for further models add to `byModelOther`).

## 4. Flows

**Poll loop** (`session.start`): cancel any old timer, then `$.clock.every(pollMs, tick)`, with the first tick from `$.clock.after(0)`. Each tick re-asserts `off` for disabled backends, because `/clear` resets `$.state` without a `session.start`. A status with no `checkedAt` means fresh state, so the LM Studio token gate resets. For each enabled backend, `tick` skips if a probe is still pending, or if an earlier fetch is still open: `$.http.fetch` can't be cancelled, so a hung server holds one request at most. Otherwise it then races `$.http.fetch(url)` against `$.clock.sleep(timeoutMs)`. It classifies the result (FR-1/FR-2), `update`s the backend's status atom, and on a health change between up and down calls `$.ui.toast` (never on the first probe). It refreshes models when the backend has just come up or `modelsRefreshSec` has elapsed. Writing state redraws readers automatically. No `invalidate` is needed for state-backed values.

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

**Stats writes** go through `ctx.statsQueue`, a promise chain no request hook awaits. The hooks only *start* `$.clock.now()` reads; the queued write awaits them. Each write races a 2 s timer, at most 100 are pending, and `session.start` clears any in-flight count a lost request left behind. `begin` and `end` land in order without delaying the request (NFR-2). The model-name inventories used for attribution are cached in `ctx` when written, so a model step reads no state.

**Tool requests** (`tool.call`, no matcher; validate lists it as the one accepted gating hook, see SECURITY.md §4): `classifyToolCall(e)` returns `BackendId | null` from `e.tool` and its arguments, using regexes over host:port and CLI verbs. It never stores the command. If not local, `return next(e)`. If local, run begin, then `const r = await next(e)`, then end (ok = `!r.deny && !r.isError`), then `return r`.

**Attribution of model requests**: (1) parse `ANTHROPIC_BASE_URL` once at start. If its host is loopback and the port equals a backend's port, every step is that backend's. (2) Else, when there's no base URL or it's loopback on a port that is no backend's, if `e.model` matches an inventory model id of exactly one enabled backend (Ollama: `name` = `name:latest`), attribute it there. (3) Else it isn't local. The backend is chosen before the step runs. `usage.model` only feeds `byModel`. The base URL is read in `session.start` (load and reload).

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
- Static analysis (checked on 2.1.295) allows `$` only in functions declared at the top of the file that uses it, and allows `read`/`update` only on atoms *defined in that same file*. So every atom and every `$`-using function lives in `register.tsx`, and module state is passed as a `ctx` object. Render helpers in `hooks/ui/` get plain data, not atoms.
- Static analysis forbids passing `$` to imported functions. Pure libs receive data, and `register.tsx` does the I/O. Small top-level helpers *in the same file* may take `$`, which validate reports as `(via fn)`.
- Use `127.0.0.1` as the default, not `localhost`. On macOS `localhost` can resolve to `::1`, while Ollama binds IPv4 by default.
- The hook budget is about 10 s. Time inside `$` calls doesn't count, **except `$.clock.sleep`**, whose wait is the hook's own time (types, `clock.sleep`). So a hook must never await a probe, because each probe races a timeout sleep. Probes run only from timers (`$.clock.every` / `after`). Render hooks must only `read`.
- Org policy can refuse `$.http.fetch` to some hosts (web-fetch policy). Show `⚠ blocked by policy` when the rejection says so.
- The loader validates `userConfig` types and `min`/`max` before `register` runs, and refuses the load on a mismatch (probed with the 2.1.295 kit). `config.ts` still re-checks them as defence in depth.
- Hot reload re-runs `session.start`. Store the timer handle in a module variable and cancel it first. State in `$.state` survives the reload.

## 7. Open questions (resolve with /docs-check before the milestone that needs them)

1. The exact `AbovePrompt` props (`hasSurvey`, `bodyColumns`) and whether `ui.render` matchers accept `requestId` for `Pane`.
2. Whether `TurnStepResult.usage.model` reports the local model name for Ollama and LM Studio Anthropic-compatible endpoints.
3. ~~Whether `$.http.fetch` rejects or returns a status on ECONNREFUSED~~: it **rejects**, with a message holding `ECONNREFUSED` and the URL (probed 2026-10-09).
4. Whether `$.env.get` sees `env` from settings files (Claude Code applies them to the process env, so expect yes).
5. ~~Redirects~~: followed, `Authorization` dropped across origins (SECURITY.md §3, settled 2026-10-09).
