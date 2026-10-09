---
name: verify
description: Run rmod's full quality gate (claude plugin validate with the $-call allowlist, TypeScript type-check, claude plugin test, gitleaks secret scan, and a forbidden-pattern grep) and report pass or fail. Use after any change to hooks/, types/, tests/ or the manifest, and always before a commit.
allowed-tools: Bash(claude plugin validate *) Bash(claude plugin test) Bash(claude plugin test *) Bash(npx tsc *) Bash(gitleaks git *) Bash(gitleaks dir *) Bash(git status *) Bash(git diff *) Read Grep Glob
---

# Verify: the definition-of-done gate

Run each step, keep going after a failure so the report is complete, then summarise.

1. **Static analysis**: `claude plugin validate .`
   - It must end with `✔ Validation passed`.
   - Read the `hooks:` line and check that every event is expected (see "API surface used" in `docs/ARCHITECTURE.md`).
   - Read every `calls:` line. Each `$.…` call must be in the **allowlist** in `docs/SECURITY.md` §4. Any other call fails the gate, even if validation passed.
   - Read the `env reads:` line. Only names on the allowlist (`ANTHROPIC_BASE_URL`, `OLLAMA_HOST`) are acceptable. There must be no `env writes:`.
   - A `gating hook` line is a failure: rmod must never gate. The single exception is the line `gating hook without .catch: tool.call`, which SECURITY.md §4 accepts for the observer that counts tool requests. It must appear verbatim, exactly once, with no matcher, and `grep -c "on('tool.call'" hooks/register.tsx` must be exactly 1. A `tool.call` hook *with* `.catch`, a matcher, a second `tool.call` hook, or a gating line for any other event fails.
2. **Types**: `npx tsc -p .`. It needs `.claude-plugin/types/` to exist (the mod must have loaded once with `--plugin-dir`). If they're missing, report "types not generated" and continue.
3. **Tests**: first `npm run -s fixtures:check` (the generated `tests/fixtures/index.ts` must match the `*.json` fixtures) and `npm run -s check:manifest` (the `plugin.json` defaults must match `config.ts`), then `claude plugin test`. Every test must pass. Report the counts. List any SPEC requirement ID from `docs/SPEC.md` with no test whose name contains it.
4. **Secrets**:
   - `gitleaks git --redact --staged --verbose` (staged changes), and `gitleaks dir --redact .` when the repo isn't initialised.
   - If gitleaks isn't installed, say so and tell the user to run `brew install gitleaks`, then use Grep as a fallback for `(?i)(api[_-]?key|secret|token|passw(or)?d)\s*[:=]\s*['"][^'"]{8,}` and `-----BEGIN [A-Z ]*PRIVATE KEY-----` across tracked files.
   - `git status --porcelain` must show no `.env*`, `*.pem`, `*.key` or `.claude/settings.local.json` files staged.
5. **Forbidden patterns**: Grep `hooks/` for `\$\.process\.|\$\.fs\.write|\$\.model\.|\$\.prompt\.submit|\$\.session\.send|tool\.check|import\(|eval\(|new Function|https?://(?!127\.0\.0\.1|localhost|\[::1\])` and for logging of `e.command`, `e.text` or `e.prompt`. Also grep `hooks/` for a returned refusal, `\{\s*deny\s*:` or `\bdeny:\s*['"`]`. Reading a result's `deny` field (`o['deny']`) is fine; producing one is not. Any hit fails the gate.

## Report format

```
verify: PASS|FAIL
validate  ✓/✗  <one line>
calls     ✓/✗  <non-allowlisted calls, if any>
tsc       ✓/✗/skipped
tests     ✓/✗  <passed>/<total>; untested SPEC IDs: …
secrets   ✓/✗
patterns  ✓/✗
```

On FAIL, propose the smallest fix for each item. Don't commit anything.
