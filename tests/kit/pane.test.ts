import { expect, test } from 'claude-code/testing'

import { boot, session, START } from './boot'
import { typed } from './helpers'

const SURFACES = ['terminal', 'desktop'] as const

const pane = (bodyColumns = 100) =>
  ({
    plugin: 'rmod',
    component: 'Pane',
    requestId: 'rmod',
    viewport: { columns: bodyColumns + 4, rows: 40 },
    props: { title: 'rmod', isFocused: true, bodyColumns, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  }) as const

const band = {
  plugin: 'rmod',
  component: 'AbovePrompt',
  viewport: { columns: 125, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

const engineDraws = () => ({ type: 'Text' as const, props: {}, children: ['drawn by Claude Code'] })

test('FR-3.5 FR-6.1 /rmod is registered as immediate and opens the rmod pane', async ($, on) => {
  const { clock, registered, opened } = boot(on, { ollama: 'up', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  expect(registered).toContain('rmod')
  await $.command.run(typed('rmod'))
  expect(opened).toEqual(['rmod'])
})

test('FR-3.7 in claude -p (no surface) /rmod answers with the status text, not a pane', async ($, on) => {
  const { clock, opened } = boot(on, { ollama: 'up', lmstudio: 'down' })
  await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
  await clock.settle()
  expect((await $.command.run(typed('rmod'))).text).toMatch(/^rmod\nOllama: ✓ up/)
  expect(opened).toEqual([])
})

test('FR-3.7 a surface that places no pane gets the status text too', async ($, on) => {
  const { clock, pane: p } = boot(on, { ollama: 'up', lmstudio: 'down' })
  p.placed = false
  await $.session.start(START)
  await clock.settle()
  expect((await $.command.run(typed('rmod'))).text).toMatch(/^rmod\nOllama: ✓ up/)
})

test('FR-3.5 FR-4.4 FR-5.3 the pane shows each backend, its stats and its models on both surfaces', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(), surface })
    for (const key of ['refresh', 'reset', 'band']) expect(await ui.find({ key })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^✓ up · v0\.40\.2 · \d+ ms · checked \d+ s ago$/ }))?.props).toMatchObject({ color: 'success' })
    expect(await ui.find({ type: 'Text', text: /^✗ not listening \(connection refused\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '  no local requests yet' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '● ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'llama3.2:3b' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '  2.0 GB · 3.2B · Q4_K_M · 3.2 GB VRAM' })).toBeDefined()
    await ui.unmount()
  }
})

test('FR-5.1 the Refresh button re-reads the model lists from a timer', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'down' })
  const tags = () => servers.fetched.filter(f => f.url.endsWith('/api/tags')).length
  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount({ ...pane(), surface: 'terminal' })
  const before = tags()
  await ui.press({ key: 'refresh' })
  await clock.settle()
  expect(tags()).toBe(before + 1)
})

test('FR-4.5 the Reset button clears the counters', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' })
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start(START)
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'ollama run x' })
  await clock.settle()
  expect(await session($)).not.toBe('')
  const ui = await $.ui.mount({ ...pane(), surface: 'terminal' })
  await ui.press({ key: 'reset' })
  await clock.settle()
  expect(await session($)).toBe('')
})

test('FR-3.6 Hide band hides it, saves the choice, and the button turns into Show band', async ($, on) => {
  const { clock, saved } = boot(on, { ollama: 'up', lmstudio: 'down' })
  on('ui.render', engineDraws)
  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount({ ...pane(), surface: 'terminal' })
  expect((await ui.find({ key: 'band' }))?.props).toMatchObject({ label: 'Hide band' })
  await ui.press({ key: 'band' })
  expect(saved.get('bandHidden')).toBe(true)
  expect((await ui.find({ key: 'band' }))?.props).toMatchObject({ label: 'Show band' })
  const hidden = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(await hidden.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  await hidden.unmount()
  await ui.press({ key: 'band' })
  expect(saved.get('bandHidden')).toBe(false)
  const shown = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(await shown.find({ type: 'Text', text: /^✓ Ollama/ })).toBeDefined()
})

test('FR-3.6 a band hidden in an earlier session stays hidden', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' }, {}, { bandHidden: true })
  on('ui.render', engineDraws)
  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount({ ...band, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
})

test('FR-3.6 showBand off is only the default: a saved choice to show wins', { options: { showBand: false } }, async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' }, {}, { bandHidden: false })
  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^✓ Ollama/ })).toBeDefined()
})

test('FR-3.6 a saved value of the wrong type is ignored and the config default applies', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' }, {}, { bandHidden: 'yes' })
  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^✓ Ollama/ })).toBeDefined()
})

test('FR-5.3 a narrow pane truncates long model names instead of wrapping them', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(30), surface })
    expect((await ui.find({ type: 'Text', text: 'nomic-embed-text:latest' }))?.props).toMatchObject({ wrap: 'truncate-end' })
    expect(await ui.find({ key: 'refresh' })).toBeDefined()
    await ui.unmount()
  }
})

test('NFR-3 drawing the pane never fetches', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  const before = servers.fetched.length
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(), surface })
    await ui.unmount()
  }
  expect(servers.fetched.length).toBe(before)
})

test('FR-3.5 the buttons show their hotkeys and the markers have a legend (NFR-5)', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount({ ...pane(), surface: 'terminal' })
  expect((await ui.find({ key: 'refresh' }))?.props).toMatchObject({ plain: true, hotkey: 'r' })
  expect((await ui.find({ key: 'reset' }))?.props).toMatchObject({ plain: true, hotkey: 'z' })
  expect((await ui.find({ key: 'band' }))?.props).toMatchObject({ plain: true, hotkey: 'h' })
  expect(await ui.find({ type: 'Text', text: /^● loaded · ○ available · ◌ unknown · ×N used$/ })).toBeDefined()
})

test('FR-3.5 "checked N s ago" keeps ageing while probes are skipped', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  servers.ollama = 'hang'
  const ui = await $.ui.mount({ ...pane(), surface: 'terminal' })
  // The hung fetch blocks every probe until it settles at 65 s: nothing writes state meanwhile.
  await clock.advance(30_000)
  expect(await ui.find({ type: 'Text', text: /checked 2\d s ago$/ })).toBeDefined()
})
