// The stats queue under pressure (NFR-2, FR-4.3), and a fetch that throws outright (NFR-3).
import { expect, mock, test } from 'claude-code/testing'

import { boot, ollama, START } from './boot'

test('NFR-2 FR-4.3 with every state write hanging, 150 local tool calls still return at once and unchanged', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  mock.env(on, {})
  on('store.get', () => ({ value: undefined }))
  on('http.fetch', () => ({ deny: 'ECONNREFUSED' }))
  // A host whose state never settles: every write waits forever.
  on('state.set', async () => {
    await clock.sleep(1e9)
    return { value: { isSet: true as const, version: 1 } }
  })
  const answer = { result: 'ok' }
  on('tool.call', () => answer)
  await $.session.start(START)
  for (let i = 0; i < 150; i += 1) {
    expect(await $.tool.call({ tool: 'Bash', command: 'curl -s localhost:11434/api/tags' })).toEqual(answer)
  }
  // Past the cap, begins (and their ends) are dropped rather than queued without limit.
  await clock.advance(10_000)
})

test('NFR-3 a fetch that throws outright counts as not listening, and probing goes on', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  mock.env(on, {})
  on('store.get', () => ({ value: undefined }))
  let calls = 0
  on('http.fetch', () => {
    calls += 1
    throw new Error('host refused synchronously')
  })
  await $.session.start(START)
  await clock.settle()
  const first = calls
  await clock.advance(5000)
  expect(calls).toBeGreaterThan(first)
  expect(await ollama($)).toMatch(/^Ollama: ✗ not listening/)
})
