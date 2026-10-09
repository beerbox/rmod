import { expect, test } from 'claude-code/testing'

import { boot, lmstudio, ollama, START } from './boot'
import { typed } from './helpers'

const band = {
  plugin: 'rmod',
  component: 'AbovePrompt',
  viewport: { columns: 165, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

const paths = (fetched: readonly { url: string }[], port: string) =>
  fetched.filter(f => f.url.includes(`:${port}/`)).map(f => f.url.replace(/^http:\/\/127\.0\.0\.1:\d+/, ''))

test('FR-5.1 FR-5.2 once Ollama is up its inventory is read from /api/tags and /api/ps', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  expect(paths(servers.fetched, '11434')).toEqual(['/api/version', '/api/tags', '/api/ps'])
  expect(await ollama($)).toMatch(/^Ollama: ✓ up · v0\.40\.2 · \d+ ms · 3 models \(1 loaded\) · /)
})

test('FR-5.1 LM Studio models come from the probe itself, with no extra request', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'down', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  expect(paths(servers.fetched, '1234')).toEqual(['/api/v1/models'])
  expect(await lmstudio($)).toMatch(/· 4 models \(1 loaded\) · /)
})

test('FR-5.1 the OpenAI-compatible fallback lists ids with loaded unknown', async ($, on) => {
  const { clock } = boot(on, { ollama: 'down', lmstudio: 'native404' })
  await $.session.start(START)
  await clock.settle()
  expect(await lmstudio($)).toMatch(/· 3 models · /)
  expect(await lmstudio($)).not.toContain('loaded')
})

test('NFR-3 FR-5.1 the Ollama inventory is refreshed every modelsRefreshSec, not every poll', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'down' })
  const tags = () => paths(servers.fetched, '11434').filter(p => p === '/api/tags').length
  await $.session.start(START)
  await clock.settle()
  await clock.advance(29_999)
  expect(tags()).toBe(1)
  expect(paths(servers.fetched, '11434').filter(p => p === '/api/version').length).toBe(6)
  await clock.advance(5_001)
  expect(tags()).toBe(2)
})

test('FR-5.1 a backend that comes back up has its inventory read at once', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'down' })
  const tags = () => paths(servers.fetched, '11434').filter(p => p === '/api/tags').length
  await $.session.start(START)
  await clock.settle()
  servers.ollama = 'down'
  await clock.advance(5000)
  servers.ollama = 'up'
  await clock.advance(5000)
  expect(tags()).toBe(2)
})

test('FR-5.1 FR-6.1 /rmod-refresh answers at once and refreshes the inventories from a timer', async ($, on) => {
  const { clock, servers, registered } = boot(on, { ollama: 'up', lmstudio: 'up' })
  const tags = () => paths(servers.fetched, '11434').filter(p => p === '/api/tags').length
  await $.session.start(START)
  await clock.settle()
  expect(registered).toContain('rmod-refresh')
  const before = tags()
  const answer = await $.command.run(typed('rmod-refresh'))
  expect(answer.text).toMatch(/^rmod: refreshing the model lists now/)
  // The hook itself fetched nothing: its probes would spend the hook's time budget.
  expect(tags()).toBe(before)
  await clock.settle()
  expect(tags()).toBe(before + 1)
})

test('FR-5.1 /rmod-refresh while a check is running says so and fetches nothing extra', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'hang', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  const answer = await $.command.run(typed('rmod-refresh'))
  expect(answer.text).toMatch(/a check is already running/)
  await clock.settle()
  expect(servers.maxOpen.ollama).toBe(1)
})

test('FR-5.1 /rmod-refresh with Ollama disabled never reaches it', { options: { enableOllama: false } }, async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  await $.command.run(typed('rmod-refresh'))
  await clock.settle()
  expect(paths(servers.fetched, '11434')).toEqual([])
})

test('FR-5.4 an unreadable Ollama inventory says so and leaves LM Studio untouched', async ($, on) => {
  const { clock } = boot(on, { ollama: 'tagsGarbage', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  expect(await ollama($)).toMatch(/^Ollama: ✓ up .*⚠ model list: unreadable response/)
  expect(await lmstudio($)).toMatch(/· 4 models \(1 loaded\) · /)
})

test('FR-5.4 a later unreadable list keeps the last good one', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  servers.ollama = 'tagsGarbage'
  await clock.advance(30_000)
  const line = await ollama($)
  expect(line).toContain('3 models (1 loaded)')
  expect(line).toContain('⚠ model list: unreadable response')
})

test('FR-5.2 the band shows each backend\'s model counts', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band, surface })
    expect(await ui.find({ type: 'Text', text: '✓ Ollama 0.40.2 · 3 models (1 loaded)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✓ LM Studio · 4 models (1 loaded)' })).toBeDefined()
    await ui.unmount()
  }
})

test('FR-5.2 a backend that is down shows no stale model count', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  servers.ollama = 'down'
  await clock.advance(5000)
  expect(await ollama($)).not.toContain('models')
})

test('FR-5.4 FR-5.2 the band marks a count from an unreadable refresh with ⚠', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  servers.ollama = 'tagsGarbage'
  await clock.advance(30_000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band, surface })
    expect(await ui.find({ type: 'Text', text: '✓ Ollama 0.40.2 · 3 models (1 loaded) ⚠' })).toBeDefined()
    await ui.unmount()
  }
})

test('FR-5.2 under auth the band shows no possibly stale count', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'down', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  servers.lmstudio = '401'
  await clock.advance(5000)
  const ui = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '⚠ LM Studio auth' })).toBeDefined()
})

test('FR-5.1 a failed /api/ps leaves loaded unknown: the count shows no loaded figure', async ($, on) => {
  const { clock } = boot(on, { ollama: 'ps500', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  const line = await ollama($)
  expect(line).toContain('· 3 models ·')
  expect(line).not.toContain('loaded')
})

test('FR-5.1 empty inventories read as zero models on both backends', async ($, on) => {
  const { clock } = boot(on, { ollama: 'empty', lmstudio: 'empty' })
  await $.session.start(START)
  await clock.settle()
  expect(await ollama($)).toContain('0 models (0 loaded)')
  expect(await lmstudio($)).toContain('0 models (0 loaded)')
})

test('NFR-3 an unreadable /api/tags skips /api/ps', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'tagsGarbage', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  expect(paths(servers.fetched, '11434')).toEqual(['/api/version', '/api/tags'])
})
