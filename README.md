# rmod: local LLM monitor for Claude Code

A Claude Code **mod** that shows, right above your prompt:

- whether **Ollama** and **LM Studio** are listening on this Mac (green ✓ / red ✗)
- which **local models** are available, and which are loaded
- a **live counter** of the requests this session sends to local models, with avg, p95, time to first token and tokens per second

It looks like this above the prompt (green, red and yellow follow your theme; every state also has a word):

```
✓ Ollama 0.40.2 · 3 models (1 loaded)   ✗ LM Studio   │ local reqs 12 (⟳1) · avg 2.3s · p95 5.1s · 41 tok/s
```

Below 60 columns it collapses to `✓O ✗L · 12 req · 2.3s`.

> Status: feature-complete for v0.1 (milestones M0–M7). See [docs/PLAN.md](docs/PLAN.md).

## Requirements

- macOS (Apple Silicon MacBook)
- Claude Code **v2.1.287 or later** (`claude --version`; update with `claude update`)
- Optional: [Ollama](https://ollama.com) and/or [LM Studio](https://lmstudio.ai) with its local server started
- For development: Node.js (TypeScript type-check only) and `brew install gitleaks`

## Develop

```bash
git clone <repo-url> rmod && cd rmod
git config core.hooksPath .githooks   # secret scanning before every commit
npm ci --ignore-scripts               # dev-only: pinned TypeScript for the type-check
claude                                # dev session; CLAUDE.md + skills load automatically
```

In a **second terminal**, run the mod with hot reload (from outside the repo, with the clone's path):

```bash
claude --plugin-dir /path/to/rmod --debug
```

Useful slash commands in the dev session:

| Command | What it does |
|---|---|
| `/docs-check` | refresh against the latest Claude Code, mods, Ollama and LM Studio docs |
| `/implement-milestone [id]` | build the next PLAN item test-first |
| `/verify` | validate, type-check, run tests, scan for secrets, check the call allowlist |
| `/probe-local-servers` | inspect the real local servers and capture sanitized fixtures |
| `/security-review [diff\|all]` | independent security review |
| `/release [patch\|minor\|major]` | cut a release (you trigger it, never Claude) |

## Install

**Terminal, for one session** (also how you try a change):

```bash
claude --plugin-dir /path/to/rmod
```

**Every session, including the Desktop app's Code tab:** add the folder to `env` in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/rmod" } }
```

A marketplace install line is added at release (`.claude-plugin/marketplace.json`).

## Use

| Command | What it does |
|---|---|
| `/rmod` | opens the pane: status, request stats and model lists per backend. Keys: `r` Refresh, `z` Reset, `h` Hide/Show band, Esc closes. In `claude -p` it prints the text below instead |
| `/rmod-status` | the same information as plain text (works in `claude -p` and VS Code) |
| `/rmod-refresh` | re-reads the model lists now (it answers at once; run `/rmod-status` a moment later) |
| `/rmod-reset` | resets this session's counters (requests still running are kept) |

What counts as a **local request**:
- **Model requests:** steps whose `ANTHROPIC_BASE_URL` is a local backend's port, or whose model id is in exactly one backend's model list.
- **Tool calls:** Bash commands that *run* `ollama run` / `lms chat` or point a client (`curl`, `wget`, `nc`, inline python/node) at a backend port; WebFetch to a backend URL; and MCP tools whose server name contains "ollama" or "lm studio".

A command that only *mentions* one in quotes, a comment or a heredoc doesn't count, and rmod's own health checks never count.

Settings (`/plugin` → rmod → configure, or `/config`): server URLs (loopback only), enable or disable each backend, poll interval (2–300 s), probe timeout (200–10000 ms), model refresh interval, the band's default visibility, the MCP server names that count as local (literal words, default `ollama,lmstudio,lm-studio,lm_studio`; narrow it if, say, an `ollama-docs` server isn't local), and an optional LM Studio API token (stored in the macOS Keychain). A bad URL or name list falls back to the default with one log line. An out-of-range number is refused by Claude Code itself when it loads the mod.

## Privacy and trust

- **Loopback only.** rmod sends HTTP only to `127.0.0.1`, `::1` or `localhost` on the configured ports. Any other host in the config is rejected. There's no telemetry.
- **Metadata only.** It keeps counts, timings, model names and status codes. It never stores, logs or shows your prompts, model output, Bash commands, URLs or file contents.
- **Observer, never a gate.** rmod's `tool.call` and `turn.step` hooks pass every result through unchanged. `claude plugin validate .` lists the `tool.call` hook as `gating hook without .catch: tool.call`, because any hook there *could* refuse a call. rmod's never does, and if it ever failed, Claude Code would skip it and run the call.
- **The token** is sent only as `Authorization` to your LM Studio URL, and only after LM Studio has asked for it with a 401/403. It's never logged or shown.
- **One limit you should know.** Claude Code's `$.http.fetch` follows HTTP redirects and offers no way to turn that off. A program listening on Ollama's or LM Studio's port could redirect rmod's health check elsewhere, even to the internet. That request carries no token and no data of yours. The token is dropped on any cross-origin redirect.
- **Like every mod, it runs with your permissions inside Claude Code.** See what it hooks and calls with `claude plugin validate .`. Full model: [docs/SECURITY.md](docs/SECURITY.md).

Operational advice:
- Ollama listens on `127.0.0.1` by default. `OLLAMA_HOST=0.0.0.0` exposes it to your network, and rmod notes that in `/rmod-status`.
- LM Studio's "Serve on Local Network" toggle does the same. Keep it off unless you need it, and turn on its API token if you do.
- Install mods only from sources you trust, and keep Claude Code up to date (`claude update`).

## Troubleshooting

- **A backend shows `✗ not listening (no answer in time)` although it's running again.** A request to it never finished, and Claude Code can't cancel one. rmod keeps one request open per backend at most, so it waits. Run `/reload-plugins`, or restart the session.
- **`/rmod-status` shows `⚠ model list: unreadable response`.** The server answered with something rmod couldn't read. The last good list is kept, and `/rmod-refresh` tries again.

## Tested with

Claude Code 2.1.296, Ollama 0.40.2 (live), LM Studio (response shapes from its docs; live check pending), macOS on Apple Silicon. Final versions are recorded in CHANGELOG.md at each release.

## License

[MIT](LICENSE) © 2026 Radoslaw Szpila

## Docs

[Spec](docs/SPEC.md) · [Architecture](docs/ARCHITECTURE.md) · [Plan](docs/PLAN.md) · [Testing](docs/TESTING.md) · [Security](docs/SECURITY.md) · [Server APIs](docs/LOCAL_SERVERS.md) · [References](docs/REFERENCES.md)
