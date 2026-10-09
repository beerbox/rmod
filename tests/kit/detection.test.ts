import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

import { typed } from './helpers'
import { fakeServers } from './servers'
import type { Mode } from './servers'

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
const TOKEN = 'fake-test-token-not-real-0000'

/** Stubs what session.start needs, the clock and the two servers, then starts the session. */
const boot = (on: On, servers: { ollama: Mode; lmstudio: Mode }) => {
  const clock: MockClock = mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', () => ({ value: undefined }))
  mock.env(on, {})
  return { clock, servers: fakeServers(on, clock, servers) }
}

/** What /rmod-status says about one backend: the kit has no state accessor, so tests read what a user would. */
const lineOf = async ($: Engine, name: 'Ollama' | 'LM Studio') =>
  ((await $.command.run(typed('rmod-status'))).text ?? '').split('\n').find(l => l.startsWith(`${name}:`)) ?? ''
const ollama = ($: Engine) => lineOf($, 'Ollama')
const lmstudio = ($: Engine) => lineOf($, 'LM Studio')

test('FR-1.1 FR-2.1 FR-3.3 both servers are probed at start and then every poll interval', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  expect(servers.fetched.map(f => f.url)).toEqual(['http://127.0.0.1:11434/api/version', 'http://127.0.0.1:1234/api/v1/models'])
  expect(await ollama($)).toMatch(/^Ollama: ✓ up · v0\.40\.2 · /)
  expect(await lmstudio($)).toMatch(/^LM Studio: ✓ up/)

  await clock.advance(4999)
  expect(servers.fetched.length).toBe(2)
  await clock.advance(1)
  expect(servers.fetched.length).toBe(4)
})

test('NFR-1 rmod only ever fetches the loopback backend URLs', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'up' })
  await $.session.start(START)
  await clock.advance(20_000)
  expect(servers.fetched.length).toBe(10)
  for (const f of servers.fetched) expect(f.url).toMatch(/^http:\/\/127\.0\.0\.1:(11434|1234)\//)
})

test('FR-1.2 a refused connection is not listening', async ($, on) => {
  const { clock } = boot(on, { ollama: 'down', lmstudio: 'down' })
  await $.session.start(START)
  await clock.settle()
  expect(await ollama($)).toMatch(/^Ollama: ✗ not listening \(connection refused\)/)
  expect(await lmstudio($)).toMatch(/^LM Studio: ✗ not listening \(connection refused\)/)
})

test('FR-1.2 no answer within probeTimeoutMs is not listening, and the late answer is ignored', async ($, on) => {
  const { clock } = boot(on, { ollama: 'hang', lmstudio: 'up' })
  await $.session.start(START)
  await clock.advance(1499)
  expect(await ollama($)).toMatch(/^Ollama: … checking/)
  await clock.advance(1)
  expect(await ollama($)).toMatch(/^Ollama: ✗ not listening \(no answer in time\)/)
  await clock.advance(60_000)
  expect(await ollama($)).toMatch(/^Ollama: ✗ not listening/)
})

test(
  'NFR-3 a hung server holds one request at most: ticks are skipped until the real fetch settles',
  { options: { pollIntervalSec: 2, probeTimeoutMs: 10000 } },
  async ($, on) => {
    const { clock, servers } = boot(on, { ollama: 'hang', lmstudio: 'up' })
    const toOllama = () => servers.fetched.filter(f => f.url.includes(':11434')).length
    await $.session.start(START)
    await clock.advance(10_000)
    expect(await ollama($)).toMatch(/no answer in time/)
    await clock.advance(49_999)
    expect(toOllama()).toBe(1)
    expect(servers.fetched.filter(f => f.url.includes(':1234')).length).toBe(30)
    servers.ollama = 'up'
    await clock.advance(4_001)
    expect(toOllama()).toBeGreaterThan(1)
    expect(servers.maxOpen.ollama).toBe(1)
    expect(await ollama($)).toMatch(/^Ollama: ✓ up/)
  },
)

test('FR-2.3 a 401 or 403 without a token is up, auth required', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: '403', lmstudio: '401' })
  await $.session.start(START)
  await clock.settle()
  expect(await ollama($)).toMatch(/^Ollama: ⚠ up, auth required/)
  expect(await lmstudio($)).toMatch(/^LM Studio: ⚠ up, auth required/)
  expect(servers.fetched.every(f => f.authorization === undefined)).toBe(true)
})

test(
  'FR-2.3 the token is sent only to lmstudioUrl, and only after it asked for auth',
  { options: { lmstudioApiToken: TOKEN } },
  async ($, on) => {
    const { clock, servers } = boot(on, { ollama: 'up', lmstudio: '401' })
    await $.session.start(START)
    await clock.settle()
    const lm = servers.fetched.filter(f => f.url.includes(':1234'))
    expect(lm.map(f => f.authorization)).toEqual([undefined, `Bearer ${TOKEN}`])
    expect(await lmstudio($)).toMatch(/^LM Studio: ✓ up/)
    await clock.advance(5000)
    expect(servers.fetched.filter(f => f.url.includes(':1234')).at(-1)?.authorization).toBe(`Bearer ${TOKEN}`)
    for (const f of servers.fetched.filter(f => f.url.includes(':11434'))) expect(f.authorization).toBeUndefined()
  },
)

test(
  'FR-2.3 a server that never asks for auth never sees the token',
  { options: { lmstudioApiToken: TOKEN } },
  async ($, on) => {
    const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'up' })
    await $.session.start(START)
    await clock.advance(15_000)
    for (const f of servers.fetched) expect(f.authorization).toBeUndefined()
  },
)

test('FR-2.2 a native 404 falls back to /v1/models and remembers it', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'native404' })
  await $.session.start(START)
  await clock.settle()
  expect(servers.fetched.filter(f => f.url.includes(':1234')).map(f => f.url)).toEqual([
    'http://127.0.0.1:1234/api/v1/models',
    'http://127.0.0.1:1234/v1/models',
  ])
  expect(await lmstudio($)).toMatch(/^LM Studio: ✓ up .*OpenAI-compatible API/)
  await clock.advance(5000)
  expect(servers.fetched.at(-1)?.url).toBe('http://127.0.0.1:1234/v1/models')
})

test('FR-1.3 FR-5.4 a 500 is degraded and a malformed 2xx is unreadable, neither crashes', async ($, on) => {
  const { clock } = boot(on, { ollama: '500', lmstudio: 'garbage' })
  await $.session.start(START)
  await clock.settle()
  expect(await ollama($)).toMatch(/^Ollama: ⚠ degraded \(unexpected HTTP status\)/)
  expect(await lmstudio($)).toMatch(/^LM Studio: ⚠ degraded \(unreadable response\)/)
})

test('FR-1.4 FR-2.4 a disabled backend shows off and is never probed', { options: { enableOllama: false } }, async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'up' })
  await $.session.start(START)
  await clock.advance(10_000)
  expect(await ollama($)).toBe('Ollama: – off')
  expect(servers.fetched.some(f => f.url.includes(':11434'))).toBe(false)
})

test('FR-3.3 a server that starts and stops is followed within one poll interval', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'down', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  expect(await ollama($)).toMatch(/^Ollama: ✗/)
  servers.ollama = 'up'
  await clock.advance(5000)
  expect(await ollama($)).toMatch(/^Ollama: ✓ up · v0\.40\.2/)
  servers.ollama = 'down'
  await clock.advance(5000)
  expect(await ollama($)).toMatch(/^Ollama: ✗ not listening \(connection refused\)/)
  expect(await ollama($)).not.toContain('0.40.2')
})

test('NFR-2 a repeated session.start replaces the poll timer instead of adding one', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'up' })
  await $.session.start(START)
  await $.session.start(START)
  await clock.settle()
  const before = servers.fetched.length
  await clock.advance(5000)
  expect(servers.fetched.length - before).toBe(2)
})

test(
  'FR-2.3 a wrong token stays auth required and is retried once per probe, not in a loop',
  { options: { lmstudioApiToken: 'fake-wrong-token-0000' } },
  async ($, on) => {
    const { clock, servers } = boot(on, { ollama: 'up', lmstudio: '401' })
    await $.session.start(START)
    await clock.settle()
    expect(await lmstudio($)).toMatch(/^LM Studio: ⚠ up, auth required/)
    expect(servers.fetched.filter(f => f.url.includes(':1234')).map(f => f.authorization)).toEqual([undefined, 'Bearer fake-wrong-token-0000'])
    await clock.advance(5000)
    expect(servers.fetched.filter(f => f.url.includes(':1234')).length).toBe(3)
  },
)

test('FR-1.2 FR-2.4 LM Studio not answering in time is not listening', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'hang' })
  await $.session.start(START)
  await clock.advance(1500)
  expect(await lmstudio($)).toMatch(/^LM Studio: ✗ not listening \(no answer in time\)/)
})

test('FR-2.2 a native 404 whose fallback is refused is not listening, and nothing is remembered', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'native404down' })
  await $.session.start(START)
  await clock.settle()
  expect(await lmstudio($)).toMatch(/^LM Studio: ✗ not listening \(connection refused\)/)
  expect(await lmstudio($)).not.toContain('OpenAI-compatible')
  await clock.advance(5000)
  expect(servers.fetched.filter(f => f.url.includes(':1234')).at(-2)?.url).toBe('http://127.0.0.1:1234/api/v1/models')
})

test('FR-1.2 a fetch refused by policy says so, without echoing the message', async ($, on) => {
  const { clock } = boot(on, { ollama: 'policy', lmstudio: 'up' })
  await $.session.start(START)
  await clock.settle()
  const line = await ollama($)
  expect(line).toMatch(/^Ollama: ✗ not listening \(blocked by policy\)/)
  expect(line).not.toContain('organization')
})

test('FR-5.1 an LM Studio with no models is up', async ($, on) => {
  const { clock } = boot(on, { ollama: 'empty', lmstudio: 'empty' })
  await $.session.start(START)
  await clock.settle()
  expect(await lmstudio($)).toMatch(/^LM Studio: ✓ up/)
})

test('FR-2.3 after LM Studio goes away, whatever answers next must ask for auth again', { options: { lmstudioApiToken: TOKEN } }, async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: '401' })
  await $.session.start(START)
  await clock.settle()
  servers.lmstudio = 'down'
  await clock.advance(5000)
  servers.lmstudio = 'up'
  await clock.advance(5000)
  expect(servers.fetched.filter(f => f.url.includes(':1234')).at(-1)?.authorization).toBeUndefined()
})
