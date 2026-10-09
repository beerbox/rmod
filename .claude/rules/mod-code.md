---
paths:
  - "hooks/**"
  - "types/**"
  - ".claude-plugin/plugin.json"
---

# Rules for mod source (hooks/, types/, manifest)

## Before you write a single line

1. Open `.claude-plugin/types/claude-code/index.d.ts` and grep the exact event or method you are about to use. Read its doc comment and example. If the file is missing, the mod hasn't been loaded yet. Ask the user to run `claude --plugin-dir /path/to/rmod` once in a second terminal, or use the build's copy that the `plugin-authoring` skill names.
2. If the API looks different from what docs/ARCHITECTURE.md assumes, the types win. Update ARCHITECTURE.md in the same change.

## Shape of the hooks module

```ts
import type { Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { BackendStatus } from '../types'

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => { /* register commands, start timers */ return next(e) })
  // ...
}
```

- One `register` export. One `session.start` hook with no matcher.
- Observers: `const r = await next(e); try { record(...) } catch {} ; return r`. Never return anything other than what `next` gave you. Never call `next` twice.
- Streaming `turn.step` hook: `async function* ($, e, next) { ... const r = yield* next(e); ...; return r }`. Measure time to the first chunk with `for await` only if you re-yield every chunk unchanged. Prefer `yield*` unless you need the first-chunk time.
- Commands: `$.command.register({ name, description, immediate: true })` in `session.start`, answered by `on('command.run', { command: 'rmod' }, ...)`, which returns `{ text }`. `immediate: true` lets `/rmod` open the pane while Claude is working.
- Timers: `$.clock.every(ms, fn)` from `session.start`. Keep the handle and `cancel()` it before starting another, because a reload re-runs `session.start`.
- Network: `$.http.fetch(url, init)` only. It has no built-in timeout, so race it against `$.clock.sleep(timeoutMs)` and treat a rejection as "down". Every URL goes through `hooks/lib/url-guard.ts` first (loopback only).
- Env: `$.env.get('ANTHROPIC_BASE_URL')` with a string literal name, because validate lists env reads.

## Rendering

- `const { Box, Text, Button } = $.ui.resolve(e)` inside the hook. Don't use element globals.
- Status glyphs: `✓` with `color="success"` means listening, `✗` with `color="error"` means not listening, `…` dimmed means not checked yet, and `⚠` with `color="warning"` means listening but auth required or the response was malformed. Use these theme keys (`ThemeKey` in the types), not raw colour names, so the band follows the person's theme. Always pair a glyph with a text label, so meaning never depends on colour alone (accessibility, and terminals without colour).
- Size the tree to `e.props.bodyColumns` for `Pane` and `AbovePrompt`. Truncate long model names with `wrap="truncate-end"`.
- Give every `Button` a stable `key`. Tests press by key.
- Render hooks only read: `read($, atom)`. They never write `$.state` or call `$.http.fetch`.
- `AbovePrompt`: return `next(e)` when the user hid the band or `e.props.hasSurvey` is true (check the current props in the types).

## State contract

Every `$.state` key is declared in `types/index.d.ts` under `interface PluginState { rmod: { ... } }`. Write `atom({ plugin: 'rmod', key: '...' } as const, initial)` with literal strings. Keep arrays bounded: latency samples are capped at 200 and the model list at 200 entries per backend.

## Forbidden in hooks code

`$.process.*`, `$.fs.write*`, `$.model.*`, `$.prompt.submit`, `$.session.send`, `$.agent.*`, `$.tool.register`, `on('tool.check', ...)`, `on('session.append', ...)`, `on('prompt.submit', ...)`, any `{ deny }` result, `eval`/`Function`, dynamic `import()`, non-loopback URLs, and logging of `e.command`, `e.text`, `e.prompt` or tool output.
