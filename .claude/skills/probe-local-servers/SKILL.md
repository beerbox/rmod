---
name: probe-local-servers
description: Probe the real Ollama (127.0.0.1:11434) and LM Studio (127.0.0.1:1234) servers on this Mac to confirm they listen, see the actual response shapes, and capture sanitized JSON fixtures for tests. Use when writing parsers or fixtures, debugging "server shows ✗ but is running", or after a server upgrade.
allowed-tools: Bash(curl -sS --max-time 3 http://127.0.0.1:11434/*) Bash(curl -sS --max-time 3 http://127.0.0.1:1234/*) Bash(lsof -nP -iTCP:11434 -sTCP:LISTEN) Bash(lsof -nP -iTCP:1234 -sTCP:LISTEN) Read Write
---

# Probe local model servers

Loopback only. Read-only GET requests only. Never pull, load, unload, delete or chat with a model from this skill.

## 1. Who is listening

Run `lsof -nP -iTCP:11434 -sTCP:LISTEN` and `lsof -nP -iTCP:1234 -sTCP:LISTEN`. Note the process name and whether it's bound to `127.0.0.1`, `*` (all interfaces) or `[::1]`. If a server listens on `*`, warn the user that it's reachable from their network (see docs/SECURITY.md §6).

## 2. Ollama (default `http://127.0.0.1:11434`; `OLLAMA_HOST` may change it)

```
curl -sS --max-time 3 http://127.0.0.1:11434/api/version
curl -sS --max-time 3 http://127.0.0.1:11434/api/tags
curl -sS --max-time 3 http://127.0.0.1:11434/api/ps
```

## 3. LM Studio (default `http://127.0.0.1:1234`; the server must be started in the app's Developer tab or with `lms server start`)

```
curl -sS --max-time 3 http://127.0.0.1:1234/api/v1/models
curl -sS --max-time 3 http://127.0.0.1:1234/v1/models
```

A `401` means the server has API-token auth turned on. Don't ask for the token and don't send one. Record "auth required", which the mod shows as `⚠`.

## 4. Compare with what the mod expects

Compare the field names against `docs/LOCAL_SERVERS.md` and the parsers in `hooks/lib/`. Report any field that's missing, renamed or differently typed, and update `docs/LOCAL_SERVERS.md` plus the Drift log in `docs/REFERENCES.md`.

## 5. Capture fixtures (only if asked or if tests need them)

- Write raw responses to `tests/fixtures/raw/` (gitignored) first.
- Create a sanitized copy in `tests/fixtures/<server>-<endpoint>[-<variant>].json`. Keep the structure and field names. Replace digests with `sha256:0000…`, replace any personal paths, user names or hostnames with neutral values, and cap the list at three or four models. Make sure at least one fixture covers a loaded model and one covers an empty list.
- Fixtures must contain no tokens or credentials of any kind.

## 6. Report

Give a small table with these columns: server | listening (✓/✗) | bind address | version | models available | models loaded | notes.
