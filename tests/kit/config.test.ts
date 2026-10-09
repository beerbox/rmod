import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { typed } from './helpers'

const FAKE_TOKEN = 'fake-test-token-not-real-0000'

/** Stubs what session.start calls and collects every $.ui.log line. */
const startStubs = (on: On, env: Record<string, string> = {}) => {
  const logs: string[] = []
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  mock.env(on, env)
  return logs
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('FR-6.2 manifest defaults load with no log lines and the default URLs', async ($, on) => {
  const logs = startStubs(on)
  await $.session.start(START)
  expect(logs).toEqual([])
  const answer = await $.command.run(typed('rmod-status'))
  expect(answer.text).toMatch(/Ollama: .*http:\/\/127\.0\.0\.1:11434/)
  expect(answer.text).toMatch(/LM Studio: .*http:\/\/127\.0\.0\.1:1234/)
})

test('FR-1.1 OLLAMA_HOST is used when ollamaUrl is left empty', async ($, on) => {
  const logs = startStubs(on, { OLLAMA_HOST: '127.0.0.1:11500' })
  await $.session.start(START)
  expect(logs).toEqual([])
  expect((await $.command.run(typed('rmod-status'))).text).toMatch(/Ollama: .*http:\/\/127\.0\.0\.1:11500/)
})

test(
  'FR-6.3 a non-loopback URL logs one line and falls back to the default',
  { options: { lmstudioUrl: 'http://192.168.1.10:1234' } },
  async ($, on) => {
    const logs = startStubs(on)
    await $.session.start(START)
    expect(logs.length).toBe(1)
    expect(logs[0]).toMatch(/lmstudioUrl/)
    expect(logs[0]).not.toMatch(/192\.168/)
    expect((await $.command.run(typed('rmod-status'))).text).toMatch(/LM Studio: .*http:\/\/127\.0\.0\.1:1234/)
  },
)

test(
  'NFR-1 the API token never reaches logs or command output',
  { options: { lmstudioApiToken: FAKE_TOKEN, ollamaUrl: 'http://evil.com' } },
  async ($, on) => {
    const logs = startStubs(on)
    await $.session.start(START)
    const answer = await $.command.run(typed('rmod-status'))
    expect(logs.join('\n')).not.toContain(FAKE_TOKEN)
    expect(answer.text).not.toContain(FAKE_TOKEN)
  },
)

test('NFR-2 session.start passes on when $.env.get is denied', async ($, on) => {
  const logs: string[] = []
  const registered: string[] = []
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('env.get', () => ({ deny: 'refused by test' }))

  expect(await $.session.start(START)).toEqual({ cwd: '/work' })
  expect(logs).toEqual(['rmod: could not read OLLAMA_HOST; using configured values'])
  expect(registered).toContain('rmod-status')
  expect((await $.command.run(typed('rmod-status'))).text).toMatch(/Ollama: .*http:\/\/127\.0\.0\.1:11434/)
})

test('FR-6.3 the loader refuses an out-of-range number before rmod runs', { options: { pollIntervalSec: 1 } }, async ($, on) => {
  startStubs(on)
  let message = ''
  try {
    await $.session.start(START)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(message).toMatch(/must be at least 2/)
})
