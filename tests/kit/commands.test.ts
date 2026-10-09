import { expect, mock, test } from 'claude-code/testing'

import { typed } from './helpers'

test('FR-6.1 /rmod-status answers', async ($, on) => {
  const registered: { name: string; immediate: boolean }[] = []
  on('session.start', () => ({ cwd: '/work' }))
  mock.env(on, {})
  on('command.register', ($, e) => {
    registered.push({ name: e.name, immediate: e.immediate === true })
    return { value: { command: e.name } }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
  }
  expect(registered).toContainEqual({ name: 'rmod-status', immediate: true })

  const answer = await $.command.run(typed('rmod-status'))
  expect(answer.text).toMatch(/^rmod\nOllama: .*\nLM Studio: /)
})

test('NFR-2 session.start still passes on when command registration fails', async ($, on) => {
  const logs: string[] = []
  on('session.start', () => ({ cwd: '/work' }))
  mock.env(on, {})
  on('command.register', () => ({ deny: 'refused by test' }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })

  const r = await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(r).toEqual({ cwd: '/work' })
  expect(logs).toEqual(['rmod: could not register /rmod-status', 'rmod: could not register /rmod-refresh'])
})
