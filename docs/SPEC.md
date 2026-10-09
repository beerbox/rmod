# rmod: requirements specification

Status: draft v1 · Owner: Radek · Platform: macOS (Apple Silicon MacBook) · Host: Claude Code CLI (terminal) and the Desktop app's Code tab

Every test name starts with the requirement ID it proves (for example `FR-1.2 …`).

## 1. Goal

While working in Claude Code, the user can see at a glance whether their local model servers (Ollama, LM Studio) are up, which local models are available or loaded, and how much this session uses local models: number of requests, speed and errors.

## 2. Terms

- **Backend**: one local model server, either `ollama` or `lmstudio`.
- **Listening**: an HTTP probe to the backend's loopback URL got any HTTP response within the timeout. A 2xx response means *up*. A 401 or 403 means *up, auth required*. Any other status means *up, degraded*.
- **Local request**: a request this Claude Code session sends to a local backend (see FR-4.1 for what counts).
- **Session**: the current Claude Code session. `/clear` starts a new count.

## 3. Functional requirements

### FR-1 Ollama detection
- **FR-1.1** Probe `GET {ollamaUrl}/api/version` every `pollIntervalSec` (default 5 s, minimum 2 s). `ollamaUrl` defaults to empty, which means "not configured": then use `OLLAMA_HOST` if it is set and resolves to a loopback address, else `http://127.0.0.1:11434`. (A non-empty manifest default can't be told apart from a user value, because `options` arrive with defaults filled in.) Empty or whitespace-only is unset, never invalid, so it logs nothing.
- **FR-1.2** Connection refused, a network error or no response within `probeTimeoutMs` (default 1500 ms) means **not listening**.
- **FR-1.3** On success, record the version string (validated, at most 32 characters) and the probe round-trip time.
- **FR-1.4** Ollama monitoring can be disabled in config (`enableOllama`). A disabled backend is shown as "off" and is never probed.

### FR-2 LM Studio detection
- **FR-2.1** Probe `GET {lmstudioUrl}/api/v1/models` every `pollIntervalSec`. The default `lmstudioUrl` is `http://127.0.0.1:1234`.
- **FR-2.2** If the native endpoint returns 404 (older LM Studio), fall back to `GET {lmstudioUrl}/v1/models` (OpenAI-compatible), and remember which endpoint worked for the rest of the session.
- **FR-2.3** A 401 or 403 means *up, auth required*. If the user configured the sensitive `lmstudioApiToken`, send it as `Authorization: Bearer …`, and only to `lmstudioUrl`.
- **FR-2.4** The not-listening and disabled rules are the same as FR-1.2 and FR-1.4 (`enableLmStudio`).

### FR-3 Visual status (green ✓ / red ✗)
- **FR-3.1** A band above the prompt shows one segment per enabled backend: `✓ Ollama` in green when up, `✗ Ollama` in red when not listening, `⚠ LM Studio` in yellow when auth is required or the server is degraded, `… Ollama` dimmed before the first probe completes, and `– Ollama off` dimmed when disabled. Meaning never depends on colour alone.
- **FR-3.2** The band also shows the compact session summary from FR-4 (for example `local reqs 12 · avg 2.3s`) and the model counts from FR-5 (for example `3 models, 1 loaded`).
- **FR-3.3** The band updates within one poll interval of a state change, with no user action.
- **FR-3.4** When a backend changes between listening and not listening, the mod shows one toast per transition (for example `Ollama stopped listening`). "Stopped listening" needs **two probes in a row** that found it down, so one slow answer (a timeout while a model loads) toasts nothing. "Listening again" follows only a backend the person knows is down. There's no toast on the first probe, and none while the backend's state stays the same. The band itself still changes at once (FR-3.3).
- **FR-3.5** The `/rmod` command opens a pane with the full detail (FR-4.4, FR-5.3). It works while Claude is busy (`immediate`).
- **FR-3.6** The band can be hidden or shown with a button in the pane, and the choice persists across sessions (`$.store`). The `showBand` config sets the initial default.
- **FR-3.7** Surfaces: the band and pane draw in `terminal` and `desktop`. Where nothing is drawn (VS Code panel, `claude -p`), `/rmod-status` returns the same information as plain text.
- **FR-3.8** The band fits in `bodyColumns`. Below 60 columns it collapses to icons and numbers only (`✓O ✗L · 12 req`).

### FR-4 Live local-request counter
- **FR-4.1 What counts as a local request**:
  - (a) **Model requests**: each `turn.step` (main thread and subagents) when Claude Code's model endpoint is a local backend. That's the case when `ANTHROPIC_BASE_URL` has a loopback host whose port matches an enabled backend URL. When there's no base URL, or it's loopback on a port that is no backend's (a local proxy), the request's model name decides: it must match a model in exactly one enabled backend's inventory (FR-5), and for Ollama `name` and `name:latest` are the same. A remote base URL, or one on a disabled backend's port, counts nothing.
  - (b) **Tool requests**: each `tool.call` that targets a local backend: Bash commands that *run* `ollama run` or `lms chat`, or send a network client (curl, wget, http, nc, or inline python/node code) to a backend's loopback host:port, including inside `bash -c` and behind `VAR=` prefixes or wrappers like `time` or `timeout`. A command that only mentions one in quotes, a comment or a heredoc doesn't count, nor does one run over `ssh`; WebFetch to a backend URL; and MCP tools whose name matches the configurable `localMcpToolPattern` (a JavaScript RegExp source with no slashes or flags, matched against the tool name only; default: the server name, between `mcp__` and the next `__`, contains `ollama` or `lmstudio`/`lm-studio`/`lm_studio` in any of the usual capitalisations, and may hold single underscores, so `mcp__ollama_local__x` and plugin servers match too. The backend is the one the server name mentions, else the only enabled backend; with neither, the call isn't counted).
  - (c) rmod's own health probes **never** count. They use `$.http.fetch`, which raises no `tool.call`.
  - Ties: if both backends use the same port, it counts as Ollama, and config warns. A command reaching both counts for the first one in it. A model id in both inventories counts for neither. The `Monitor` tool and background (`run_in_background`) Bash aren't counted, because their latency isn't a request's.
- **FR-4.2** For each backend, and in total, track: total requests, in-flight count, succeeded, failed (error, aborted or a tool error), latency (last, average, p50, p95 over a ring buffer of the last 200), and for model requests: time to first token (TTFT, the first streamed chunk), output tokens, and output tokens per second where `usage` is present. Model and tool requests are counted separately and also as one combined total. Speed figures (latency, TTFT, tok/s) come from **successful** requests only, so a fast-failing backend never looks quick. Failures count in *failed* and in "last request N s ago". Latency and TTFT figures cover the last 200 successful requests. tok/s covers the session: output tokens over generation time (from the first token, or from the start when the first token came too late to measure).
- **FR-4.3** Counters update live: the in-flight count shows while a request runs, and the totals update within 1 s of completion.
- **FR-4.4** The pane shows a per-backend table with these columns: requests (model/tool), in flight, ok/failed, avg, p50, p95, last, avg TTFT and tok/s, plus "last request N s ago".
- **FR-4.5** Counters live in `$.state`, so they survive a mod hot reload and reset on `/clear`, `/resume` and `/branch` (a new session). `/rmod-reset` resets them on demand.
- **FR-4.6** Only metadata is recorded: never prompt text, output text, command text, URLs with query strings, or file contents.

### FR-5 Available local models
- **FR-5.1** While a backend is up, refresh its inventory every `modelsRefreshSec` (default 30 s), immediately after it changes to up, and on demand from the pane's **Refresh** button or `/rmod-refresh`. The command answers at once and the refresh runs from a timer, so its probes never count against the command hook's time budget.
  - Ollama: `GET /api/tags` (available) and `GET /api/ps` (loaded in memory, with `size_vram` and `expires_at`).
  - LM Studio: `models[]` from `/api/v1/models`, which is the health probe's own response, so it costs no extra request and refreshes every poll (written only when it changes). A model is loaded when `loaded_instances` isn't empty. Include `type` (llm or embedding), `params_string` and `quantization.name`. With the `/v1/models` fallback, show IDs only and report "loaded" as unknown.
- **FR-5.2** The band shows counts per backend: `N models, M loaded`.
- **FR-5.3** The pane lists the models per backend, with loaded ones first, a `●` (loaded) or `○` (available) marker, the name truncated to fit, and the size, parameters and quantization where known. It caps the list at 200 per backend with `+N more`. Models used in this session are marked with their request count.
- **FR-5.4** A model inventory that fails to parse shows `⚠ unreadable response` for that backend and doesn't crash or clear the other backend. For Ollama, `/rmod-status` shows `⚠ model list: unreadable response`, the band marks the count with `⚠`, and the last good list is kept. For LM Studio the list *is* the probe response, so an unreadable one shows as `⚠ degraded (unreadable response)`. The band shows a model count only while the backend is up.

### FR-6 Commands and configuration
- **FR-6.1** Commands: `/rmod` (pane), `/rmod-status` (text summary), `/rmod-refresh` and `/rmod-reset`.
- **FR-6.2** `userConfig` in `plugin.json`: `enableOllama` (bool, default true), `ollamaUrl` (string, default empty, see FR-1.1), `enableLmStudio` (bool, default true), `lmstudioUrl` (string, default `http://127.0.0.1:1234`), `lmstudioApiToken` (string, **sensitive**, optional, no default; empty means unset), `pollIntervalSec` (number, 2–300, default 5), `probeTimeoutMs` (number, 200–10000, default 1500), `modelsRefreshSec` (number, 10–3600, default 30), `showBand` (bool, default true), and `localMcpToolPattern` (string).
- **FR-6.3** Claude Code's loader checks each option's type and the manifest's `min`/`max` before rmod runs. A wrong type or out-of-range number refuses the module load with the loader's own message, so rmod can't fall back for those. For everything the manifest can't check, an invalid value falls back to that field's default and shows one `$.ui.log` line naming the field and the rule, never the rejected value. This covers a non-loopback URL, a bad, oversized or backtracking-prone regex (nested quantifiers, backreferences), a non-loopback `OLLAMA_HOST`, and an unusable token. The rest of the mod keeps working. A token is never sent when `lmstudioUrl` was rejected.

## 4. Non-functional requirements

- **NFR-1 Security**: only loopback HTTP, the `$`-call allowlist, metadata only, the token in the Keychain via `sensitive`, and no secrets in the repo (docs/SECURITY.md).
- **NFR-2 Fail-open**: no failure in rmod can block, alter or delay a tool call, prompt or model request by more than 5 ms of bookkeeping.
- **NFR-3 Performance**: render hooks do no I/O. At most 2 + 2 health requests per poll interval (per backend: the probe, plus at most one LM Studio fallback or token retry). The Ollama inventory adds `/api/tags` + `/api/ps` once per `modelsRefreshSec` (and when it comes up, or on `/rmod-refresh`). LM Studio's inventory is the probe's own response. No overlapping requests per backend (skip a tick if the previous probe is still pending), and memory bounded (ring buffers of 200, model lists of 200).
- **NFR-4 Compatibility**: Claude Code ≥ the version recorded in docs/REFERENCES.md (mods need ≥ 2.1.287), with Ollama and LM Studio versions as recorded at release. Tested on `terminal` and `desktop` surfaces.
- **NFR-5 Accessibility**: status uses glyph + word + colour, and works with `NO_COLOR` or dim themes.
- **NFR-6 Testability**: every FR and NFR ID is covered by an automated test or an explicit manual check (docs/TESTING.md §6).

## 5. Out of scope (v1)

Remote or LAN model servers, controlling servers (start, stop, load or pull models), other backends (llama.cpp server, vLLM, LocalAI; designed so they're easy to add later), counting other mods' `$.http.fetch` calls, and cross-session history graphs.
