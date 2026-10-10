// S19: rmod's own calls fail while a request is in progress; the request must not notice (NFR-2).
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
const OLLAMA = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:11434' }

/**
 * Everything session.start needs, with every $.clock call refused: no timer, no time, no sleep.
 * The servers are refused too, so nothing but the request under test happens.
 */
const brokenClock = (on: On) => {
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('env.get', ($, e) => ({ value: e.name === 'ANTHROPIC_BASE_URL' ? OLLAMA.ANTHROPIC_BASE_URL : undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('http.fetch', () => ({ deny: 'ECONNREFUSED' }))
  on('clock.now', () => ({ deny: 'clock refused by test' }))
  on('clock.sleep', () => ({ deny: 'clock refused by test' }))
  on('clock.every', () => ({ deny: 'clock refused by test' }))
  on('clock.after', () => ({ deny: 'clock refused by test' }))
}

test('NFR-2 S19 with every clock call refused, a local tool call still returns its result unchanged', async ($, on) => {
  brokenClock(on)
  const answer = { result: 'tags', text: 'tags' }
  on('tool.call', () => answer)
  expect(await $.session.start(START)).toEqual({ cwd: '/work' })
  const r = await $.tool.call({ tool: 'Bash', command: 'curl -s localhost:11434/api/tags' })
  expect(r).toEqual(answer)
})

test('NFR-2 S19 with every clock call refused, a local model step streams and returns unchanged', async ($, on) => {
  brokenClock(on)
  const result = { turnId: 't', index: 0, answer: 'hi', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  on('turn.step', async function* () {
    yield { kind: 'text' as const, index: 0, text: 'hi' }
    return result
  })
  await $.session.start(START)
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'gemma4:12b-mlx', messageCount: 1 })
  const chunks: unknown[] = []
  let r = await stream.next()
  while (r.done !== true) {
    chunks.push(r.value)
    r = await stream.next()
  }
  expect(chunks).toEqual([{ kind: 'text', index: 0, text: 'hi' }])
  expect(r.value).toEqual(result)
})

test('NFR-2 S19 with every clock call refused, /rmod-status and the band still answer', async ($, on) => {
  brokenClock(on)
  await $.session.start(START)
  expect((await $.command.run({ command: 'rmod-status', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })).text).toMatch(
    /^rmod\nOllama: /,
  )
  const ui = await $.ui.mount({
    plugin: 'rmod',
    surface: 'terminal',
    component: 'AbovePrompt',
    viewport: { columns: 125, rows: 40 },
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 5 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /Ollama/ })).toBeDefined()
})
