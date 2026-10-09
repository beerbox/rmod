---
paths:
  - "tests/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
---

# Rules for tests

The full strategy and scenario matrix are in `docs/TESTING.md`. Before writing kit tests, fetch the current page `https://code.claude.com/docs/en/plugins/mods/test.md`, because the kit's API changes between releases.

- Run with `claude plugin test` from the repo root. It runs with no session, network or sign-in, and exits 1 on any failure.
- Files end in `.test.ts`, import from `'claude-code/testing'` (`test`, `expect`, `mock`, `describe`, `tier`), and hold at least one `test()`.
- **Register every stub with `on(...)` before the first call on the test's `$`.** Otherwise the kit throws.
- `session.start` doesn't run by itself. Raise it with `$.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })` after stubbing `session.start`, `command.register` and the timer calls the hook makes.
- Stubs for mods API calls return `{ value }` (or `{ deny: 'reason' }` to make the call reject). Stubs for events return the event's own result (`{ result }` for `tool.call`, `{ cwd }` for `session.start`).
- **Fake servers**: stub `http.fetch` and branch on `e.url`, using the fixture text from `tests/fixtures/index.ts`. The kit imports only code files, so that file is generated from the `*.json` fixtures with `npm run fixtures`. Never edit it by hand, and run the generator after changing any fixture. Simulate "connection refused" with `{ deny: 'ECONNREFUSED' }`. Simulate a hang with a stub that awaits `clock.sleep(...)` on a `mock.clock`.
- **Time**: always use `mock.clock(on)` and drive it with `advance`, `set` and `settle`. Never use real sleeps.
- **Env**: `mock.env(on, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:11434' })`.
- **turn.step stubs are async generators**. Read the returned stream to its end.
- **UI**: `$.ui.mount({ plugin: 'rmod', surface, component, requestId, viewport, props })` in a loop over `['terminal', 'desktop'] as const`. Find elements by `key` or by `{ type: 'Text', text: /regex/ }`. A hook that returns `next(e)` needs a `ui.render` stub.
- Name every test after the SPEC requirement it proves, for example `test('FR-1.2 ollama shows red ✗ when connection is refused', ...)`.
- The kit's `$` has **no `state` noun**, so a test can't `read()` rmod's atoms. Observe state the way a user would: through `/rmod-status` text (`$.command.run`) or `$.ui.mount` drawings.
- Unit-test pure functions in `hooks/lib/` directly by importing them. That's faster and more precise than going through the kit.
- **Fixtures must be sanitized.** Use real response shapes captured by `/probe-local-servers` with no tokens, usernames, hostnames or personal paths. Raw captures go to `tests/fixtures/raw/`, which is gitignored.
- Don't weaken an assertion to make a test pass. If behaviour changed on purpose, update SPEC.md first.
