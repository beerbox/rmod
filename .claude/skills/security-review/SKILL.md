---
name: security-review
description: Security review of rmod's current diff or whole codebase against docs/SECURITY.md (loopback-only networking, metadata-only collection, $-call allowlist, secret hygiene, resource bounds, fail-open observers). Use before a release, after touching networking, config or state code, or when the user asks for a security check.
context: fork
agent: mod-reviewer
argument-hint: "[diff|all]"
---

Review scope: $ARGUMENTS. With `diff` or no argument, review `git diff HEAD` plus untracked files. With `all`, review everything in `hooks/`, `types/`, `tests/fixtures/`, `.claude-plugin/plugin.json`, `.gitignore`, `.githooks/` and `.claude/settings.json`.

Work through `docs/SECURITY.md` §8 (the release checklist) item by item. Also:

1. Run `claude plugin validate .` and compare the `calls:` and `env reads:` lines with the allowlist in `docs/SECURITY.md` §4.
2. Trace every `$.http.fetch` call back to `hooks/lib/url-guard.ts`. Check that no code path can fetch a non-loopback URL, including config values such as `localhost.evil.com`, `127.0.0.1.nip.io`, `http://127.0.0.1@evil.com`, userinfo, IPv4-mapped IPv6 and decimal or octal IP forms.
3. Check that no hook can deny, alter or delay a tool call, prompt or model request when rmod's own code throws.
4. Check that nothing persists or displays prompt or response text, Bash commands or file contents.
5. Check that the LM Studio token is only ever sent to the configured loopback LM Studio URL, never logged, and declared `sensitive: true`.
6. Check `tests/fixtures/` for anything secret-like or personal.
7. Check that the bounds in `docs/SECURITY.md` §5 hold.

Report the findings as a table with these columns: severity (High/Medium/Low) | file:line | issue | fix. End with a verdict: `SHIP` or `DO NOT SHIP`.
