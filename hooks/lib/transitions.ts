// Which health changes deserve a toast (FR-3.4). Pure: no `$`.
//
// A toast says what the person was last told has changed. "Stopped listening" needs two probes in
// a row that found the backend down, so one slow answer (a timeout while a model loads) toasts
// nothing. "Listening again" follows only a backend the person knows to be down. The first probe
// sets what the person is told without a toast.

import type { Health } from '../../types'

const listening = (h: Health): boolean => h === 'up' || h === 'auth' || h === 'degraded'

/** Probes in a row that must find a backend down before "stopped listening" is shown. */
export const DOWN_CONFIRMATIONS = 2

export type ToastMemory = {
  /** What the person was last told (or saw at the first probe); undefined before any probe. */
  shown: 'listening' | 'down' | undefined
  /** Probes in a row that found the backend down. */
  downStreak: number
}

export const freshMemory = (): ToastMemory => ({ shown: undefined, downStreak: 0 })

/** The memory after a probe found `health`, and the toast to show for it, if any. */
export const transitionToast = (name: string, m: ToastMemory, health: Health): { memory: ToastMemory; toast?: string } => {
  if (health === 'unknown' || health === 'off') return { memory: m }
  if (listening(health)) {
    const memory: ToastMemory = { shown: 'listening', downStreak: 0 }
    return m.shown === 'down' ? { memory, toast: `✓ ${name} is listening again` } : { memory }
  }
  const downStreak = m.downStreak + 1
  if (m.shown === undefined) return { memory: { shown: 'down', downStreak } }
  if (m.shown === 'listening' && downStreak >= DOWN_CONFIRMATIONS) {
    return { memory: { shown: 'down', downStreak }, toast: `✗ ${name} stopped listening` }
  }
  return { memory: { shown: m.shown, downStreak } }
}
