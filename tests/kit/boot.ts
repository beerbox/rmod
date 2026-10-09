// Boots rmod in a kit test: stubs what session.start calls, the clock, toasts and the two servers.

import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { typed } from './helpers'
import { fakeServers } from './servers'
import type { Mode } from './servers'

export const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

export const boot = (on: On, servers: { ollama: Mode; lmstudio: Mode }, env: Record<string, string> = {}) => {
  const clock: MockClock = mock.clock(on)
  const toasts: string[] = []
  const registered: string[] = []
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  mock.env(on, env)
  return { clock, toasts, registered, servers: fakeServers(on, clock, servers) }
}

/** What /rmod-status says about one backend: the kit has no state accessor, so tests read what a user would. */
const lineOf = async ($: Engine, name: 'Ollama' | 'LM Studio') =>
  ((await $.command.run(typed('rmod-status'))).text ?? '').split('\n').find(l => l.startsWith(`${name}:`)) ?? ''
export const ollama = ($: Engine) => lineOf($, 'Ollama')
export const lmstudio = ($: Engine) => lineOf($, 'LM Studio')
/** The /rmod-status Session line ('' before the first local request). */
export const session = async ($: Engine) =>
  ((await $.command.run(typed('rmod-status'))).text ?? '').split('\n').find(l => l.startsWith('Session:')) ?? ''
