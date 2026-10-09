# rmod: local LLM monitor for Claude Code

A Claude Code **mod** that shows, right above your prompt:

- whether **Ollama** and **LM Studio** are listening on this Mac (green ✓ / red ✗)
- which **local models** are available, and which are loaded
- a **live counter** of the requests this session sends to local models, with avg, p95, time to first token and tokens per second

> Status: in development. See [docs/PLAN.md](docs/PLAN.md).

## Requirements

- macOS (Apple Silicon MacBook)
- Claude Code **v2.1.287 or later** (`claude --version`; update with `claude update`)
- Optional: [Ollama](https://ollama.com) and/or [LM Studio](https://lmstudio.ai) with its local server started
- For development: Node.js (TypeScript type-check only) and `brew install gitleaks`

## Develop

```bash
cd rmod
git init && git config core.hooksPath .githooks   # secret scanning before every commit
claude                                            # dev session; CLAUDE.md + skills load automatically
```

In a **second terminal**, run the mod with hot reload:

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

## Use (once built)

| Command | What it does |
|---|---|
| `/rmod` | open the detail pane (status, stats, models) |
| `/rmod-status` | plain-text summary (works in `claude -p` and VS Code) |
| `/rmod-refresh` | re-probe the servers and reload model lists now |
| `/rmod-reset` | reset this session's counters |

Settings (`/plugin` → rmod → configure): server URLs (loopback only), enable or disable each backend, poll interval, probe timeout, model refresh interval, band visibility, and an optional LM Studio API token (stored in the macOS Keychain).

## Privacy and trust

rmod only talks to `127.0.0.1`, `::1` and `localhost`, has no telemetry, and records **metadata only** (counts, timings, model names), never your prompts, outputs or commands. Like every mod it runs with your permissions inside Claude Code, so check what it does with `claude plugin validate .`. See [docs/SECURITY.md](docs/SECURITY.md).

## Docs

[Spec](docs/SPEC.md) · [Architecture](docs/ARCHITECTURE.md) · [Plan](docs/PLAN.md) · [Testing](docs/TESTING.md) · [Security](docs/SECURITY.md) · [Server APIs](docs/LOCAL_SERVERS.md) · [References](docs/REFERENCES.md)
