// Edge cases from the M8.1 traceability pass: flapping servers, hot reload, /clear defaults,
// both servers down, and inventories over the 200-model cap.

import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { boot, lmstudio, ollama, session, START } from './boot'
import { typed } from './helpers'
import { OLLAMA_PS_EMPTY, OLLAMA_VERSION } from '../fixtures'

const SURFACES = ['terminal', 'desktop'] as const

const pane = {
  plugin: 'rmod',
  component: 'Pane',
  requestId: 'rmod',
  viewport: { columns: 104, rows: 40 },
  props: { title: 'rmod', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const band = {
  plugin: 'rmod',
  component: 'AbovePrompt',
  viewport: { columns: 125, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

test('FR-3.4 a server flapping up, down, up toasts exactly once per transition', async ($, on) => {
  const { clock, servers, toasts } = boot(on, { ollama: 'up', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  await clock.advance(10_000)
  expect(toasts).toEqual([])
  servers.ollama = 'down'
  await clock.advance(5000)
  await clock.advance(5000)
  await clock.advance(5000)
  expect(toasts).toEqual(['✗ Ollama stopped listening'])
  servers.ollama = 'up'
  await clock.advance(5000)
  await clock.advance(5000)
  await clock.advance(5000)
  expect(toasts).toEqual(['✗ Ollama stopped listening', '✓ Ollama is listening again'])
})

test('FR-1.2 FR-3.4 both servers down from the start: both not listening, no toast on the first probe', async ($, on) => {
  const { clock, toasts } = boot(on, { ollama: 'down', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  await clock.advance(15_000)
  expect(await ollama($)).toMatch(/^Ollama: ✗ not listening/)
  expect(await lmstudio($)).toMatch(/^LM Studio: ✗ not listening/)
  expect(toasts).toEqual([])
})

test('FR-4.5 a hot reload (session.start again) keeps the counters and keeps counting', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' })
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(START)
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'ollama run llama3.2:3b' })
  await clock.settle()
  const before = await session($)
  expect(before).toMatch(/^Session: 1 local requests \(0 model, 1 tool\)/)
  await $.session.start(START)
  await clock.settle()
  await clock.advance(5000)
  expect(await session($)).toBe(before)
  await $.tool.call({ tool: 'Bash', command: 'ollama run llama3.2:3b' })
  await clock.settle()
  expect(await session($)).toMatch(/^Session: 2 local requests \(0 model, 2 tool\)/)
})

test('FR-4.5 after /clear the counters start from zero', async ($, on) => {
  // The kit starts each test with $.state at its defaults, which is how /clear leaves it.
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' })
  on('classic.SessionStart', () => ({}))
  await $.classic.SessionStart({ source: 'clear' })
  await clock.settle()
  expect(await session($)).toBe('')
})

/** An Ollama with `n` models in /api/tags, none loaded. Built in the test: no fixture holds 250 models. */
const bigOllama = (on: On, n: number) => {
  const tags = JSON.stringify({
    models: Array.from({ length: n }, (_, i) => {
      const name = `bulk-${String(i).padStart(3, '0')}:1b`
      return { name, model: name, size: 1_000_000_000, details: { parameter_size: '1B', quantization_level: 'Q4_0' } }
    }),
  })
  const reply = (status: number, text: string) => ({ value: { status, ok: status >= 200 && status < 300, headers: {}, text } })
  const fetched: string[] = []
  on('http.fetch', ($, e) => {
    fetched.push(e.url)
    if (!e.url.startsWith('http://127.0.0.1:11434/')) return { deny: `$.http.fetch(${e.url}) failed: ECONNREFUSED` }
    if (e.url.endsWith('/api/tags')) return reply(200, tags)
    if (e.url.endsWith('/api/ps')) return reply(200, OLLAMA_PS_EMPTY)
    return reply(200, OLLAMA_VERSION)
  })
  return fetched
}

test('FR-5.3 NFR-3 more than 200 models: the pane lists 200 and +N more, the band counts all', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  mock.env(on, {})
  bigOllama(on, 250)
  await $.session.start(START)
  await clock.settle()
  expect(await ollama($)).toMatch(/250 models/)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane, surface })
    expect(await ui.find({ type: 'Text', text: 'bulk-000:1b' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'bulk-199:1b' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'bulk-200:1b' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '+50 more' })).toBeDefined()
    await ui.unmount()
    const b = await $.ui.mount({ ...band, surface })
    expect(await b.find({ type: 'Text', text: /250 models/ })).toBeDefined()
    await b.unmount()
  }
})

test('FR-5.4 FR-1.3 a 500 on LM Studio is degraded and leaves Ollama up with its models', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: '500' })
  await $.session.start(START)
  await clock.settle()
  expect(await lmstudio($)).toMatch(/^LM Studio: ⚠/)
  expect(await ollama($)).toMatch(/^Ollama: ✓ up.*3 models/)
  expect((await $.command.run(typed('rmod-status'))).text ?? '').not.toMatch(/Internal Server Error/)
})
