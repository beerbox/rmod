import { expect, test } from 'claude-code/testing'

import { boot, ollama, START } from './boot'

const SURFACES = ['terminal', 'desktop'] as const
const band = (bodyColumns: number, hasSurvey = false) =>
  ({
    plugin: 'rmod',
    component: 'AbovePrompt',
    viewport: { columns: bodyColumns + 5, rows: 40 },
    props: { hasSurvey, isWorking: false, maxRows: 6, bodyColumns, scroll: { offset: 0, bodyRows: 5 }, view: {} },
  }) as const

/** What the engine would draw at the site when rmod passes. */
const engineDraws = () => ({ type: 'Text' as const, props: {}, children: ['drawn by Claude Code'] })

test('FR-3.1 FR-3.7 NFR-5 the band shows each backend with glyph, word and colour on terminal and desktop', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...band(120), surface })
    const up = await ui.find({ type: 'Text', text: /^✓ Ollama 0\.40\.2$/ })
    const down = await ui.find({ type: 'Text', text: /^✗ LM Studio$/ })
    expect(up?.props).toMatchObject({ color: 'success' })
    expect(down?.props).toMatchObject({ color: 'error' })
    await ui.unmount()
  }
})

test('FR-3.1 before the first probe completes the band shows dimmed checking glyphs', async ($, on) => {
  boot(on, { ollama: 'hang', lmstudio: 'hang' })
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...band(120), surface })
    expect((await ui.find({ type: 'Text', text: /^… Ollama$/ }))?.props).toMatchObject({ dimColor: true })
    await ui.unmount()
  }
})

test('FR-3.1 auth, degraded, down and off each draw their glyph, word and colour on both surfaces', async ($, on) => {
  const { clock } = boot(on, { ollama: '500', lmstudio: '401' })
  await $.session.start(START)
  await clock.settle()
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...band(120), surface })
    expect((await ui.find({ type: 'Text', text: /^⚠ Ollama degraded$/ }))?.props).toMatchObject({ color: 'warning' })
    expect((await ui.find({ type: 'Text', text: /^⚠ LM Studio auth$/ }))?.props).toMatchObject({ color: 'warning' })
    await ui.unmount()
  }
})

test('FR-3.1 both down draws two red crosses on both surfaces', async ($, on) => {
  const { clock } = boot(on, { ollama: 'down', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...band(120), surface })
    expect((await ui.find({ type: 'Text', text: /^✗ Ollama$/ }))?.props).toMatchObject({ color: 'error' })
    expect((await ui.find({ type: 'Text', text: /^✗ LM Studio$/ }))?.props).toMatchObject({ color: 'error' })
    await ui.unmount()
  }
})

test('FR-1.4 a disabled backend draws off at once, even on fresh state with no session.start (after /clear)', { options: { enableOllama: false } }, async ($, on) => {
  boot(on, { ollama: 'up', lmstudio: 'up' })
  const ui = await $.ui.mount({ ...band(120), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^– Ollama off$/ }))?.props).toMatchObject({ dimColor: true })
  expect(await ollama($)).toBe('Ollama: – off')
})

test('FR-3.1 with both backends off and nothing counted the band leaves the row to the engine', { options: { enableOllama: false, enableLmStudio: false } }, async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'up' })
  on('ui.render', engineDraws)
  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount({ ...band(120), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
})

test('NFR-3 drawing the band never fetches', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  const before = servers.fetched.length
  for (const surface of SURFACES) {
    for (const columns of [120, 70, 50]) {
      const ui = await $.ui.mount({ ...band(columns), surface })
      await ui.unmount()
    }
  }
  expect(servers.fetched.length).toBe(before)
})

test('FR-3.8 at exactly 60 columns the full form shows; at 59 the compact one', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  const wide = await $.ui.mount({ ...band(60), surface: 'terminal' })
  expect(await wide.find({ type: 'Text', text: /^✓ Ollama/ })).toBeDefined()
  await wide.unmount()
  const narrow = await $.ui.mount({ ...band(59), surface: 'terminal' })
  expect(await narrow.find({ type: 'Text', text: '✓O' })).toBeDefined()
})

test('FR-3.3 the band follows a server stopping within one poll interval, with no user action', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount({ ...band(120), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^✓ Ollama/ })).toBeDefined()
  servers.ollama = 'down'
  await clock.advance(5000)
  expect(await ui.find({ type: 'Text', text: /^✗ Ollama$/ })).toBeDefined()
})

test('FR-3.8 under 60 columns the band collapses to icons', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...band(50), surface })
    expect(await ui.find({ type: 'Text', text: '✓O' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✗L' })).toBeDefined()
    await ui.unmount()
  }
})

test('FR-3.1 the band yields to a survey', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'up' })
  on('ui.render', engineDraws)
  await $.session.start(START)
  await clock.settle()
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...band(120, true), surface })
    expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Ollama/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('FR-3.6 showBand off draws no band', { options: { showBand: false } }, async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'up' })
  on('ui.render', engineDraws)
  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount({ ...band(120), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Ollama/ })).toBeUndefined()
})

test('FR-3.4 one toast per transition, none on the first probe or while the state stays', async ($, on) => {
  const { clock, servers, toasts } = boot(on, { ollama: 'down', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  await clock.advance(5000)
  expect(toasts).toEqual([])
  servers.ollama = 'up'
  await clock.advance(5000)
  await clock.advance(5000)
  servers.ollama = 'down'
  servers.lmstudio = 'down'
  await clock.advance(5000)
  await clock.advance(5000)
  expect(toasts).toEqual(['✓ Ollama is listening again', '✗ Ollama stopped listening', '✗ LM Studio stopped listening'])
})

test('FR-3.4 one slow answer toasts nothing: down must hold for two probes', async ($, on) => {
  const { clock, servers, toasts } = boot(on, { ollama: 'up', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  servers.ollama = 'hang'
  await clock.advance(5000)
  servers.ollama = 'up'
  await clock.advance(60_000)
  expect(toasts).toEqual([])
})

test('FR-3.4 a repeated session.start keeps what was announced: no extra toasts', async ($, on) => {
  const { clock, servers, toasts } = boot(on, { ollama: 'up', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  await $.session.start(START)
  await clock.settle()
  servers.ollama = 'down'
  await clock.advance(10_000)
  expect(toasts).toEqual(['✗ Ollama stopped listening'])
})
