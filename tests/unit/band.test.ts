import { describe, expect, test } from 'claude-code/testing'

import { bandLine, COMPACT_BELOW, formatMs } from '../../hooks/lib/band'
import type { BandInput } from '../../hooks/lib/band'
import { initialStatus } from '../../hooks/lib/probe'
import { begin, emptyStats, end } from '../../hooks/lib/stats'
import { freshMemory, transitionToast } from '../../hooks/lib/transitions'
import type { BackendStatus, Health } from '../../types'

const s = (over: Partial<BackendStatus>): BackendStatus => ({ ...initialStatus(), ...over })
const text = (input: BandInput, columns: number) => bandLine(input, columns).map(seg => seg.text).join('')

const idle: BandInput = {
  ollama: s({ health: 'up', version: '0.40.2' }),
  lmstudio: s({ health: 'down', error: 'refused' }),
  statsOllama: emptyStats(),
  statsLmstudio: emptyStats(),
}

let busy = emptyStats()
for (const latencyMs of [1000, 2000, 3000, 6000]) busy = end(begin(busy), { kind: 'model', ok: true, latencyMs, at: latencyMs, outTokens: 100 })
busy = begin(busy)
const withStats: BandInput = {
  ...idle,
  ollama: s({ health: 'up', version: '0.40.2', modelsAt: 1, models: [{ id: 'a', loaded: true }, { id: 'b', loaded: false }, { id: 'c', loaded: false }] }),
  statsOllama: busy,
}

describe('band', () => {
  test('FR-3.1 NFR-5 each backend shows a glyph and its name, with a tone for colour', () => {
    expect(bandLine(idle, 120)).toEqual([
      { text: '✓ Ollama 0.40.2', tone: 'ok' },
      { text: '   ', tone: 'plain' },
      { text: '✗ LM Studio', tone: 'bad' },
    ])
  })

  test('FR-3.1 auth, degraded, checking and off have their own glyph, word and tone', () => {
    const line = bandLine({ ...idle, ollama: s({ health: 'auth' }), lmstudio: s({ health: 'degraded' }) }, 120)
    expect(line[0]).toEqual({ text: '⚠ Ollama auth', tone: 'warn' })
    expect(line[2]).toEqual({ text: '⚠ LM Studio degraded', tone: 'warn' })
    const quiet = bandLine({ ...idle, ollama: s({}), lmstudio: s({ health: 'off' }) }, 120)
    expect(quiet[0]).toEqual({ text: '… Ollama', tone: 'dim' })
    expect(quiet[2]).toEqual({ text: '– LM Studio off', tone: 'dim' })
  })

  test('FR-3.2 FR-5.2 the band shows model counts and the session summary when known', () => {
    expect(text(withStats, 140)).toBe('✓ Ollama 0.40.2 · 3 models (1 loaded)   ✗ LM Studio   │ local reqs 4 (⟳1) · avg 3.0s · p95 6.0s · 33 tok/s')
  })

  test('FR-3.8 the band drops detail to fit bodyColumns, keeping status first', () => {
    const fits = (n: number) => expect(text(withStats, n).length).toBeLessThanOrEqual(n)
    for (const n of [100, 90, 80, 70, 60]) fits(n)
    expect(text(withStats, 80)).toContain('✓ Ollama')
    expect(text(withStats, 80)).toContain('local reqs 4')
  })

  test(`FR-3.8 below ${COMPACT_BELOW} columns the band collapses to icons and numbers`, () => {
    expect(text(withStats, 59)).toBe('✓O ✗L · 4 req · 3.0s')
    expect(text(idle, 40)).toBe('✓O ✗L')
    expect(text({ ...idle, ollama: s({ health: 'off' }), lmstudio: s({ health: 'auth' }) }, 30)).toBe('–O ⚠L')
  })

  test('FR-3.8 even the compact line never exceeds a tiny width', () => {
    expect(text(withStats, 8).length).toBeLessThanOrEqual(8)
  })

  test('FR-4.2 times read as ms under a second and as seconds above', () => {
    expect(formatMs(840)).toBe('840ms')
    expect(formatMs(2345)).toBe('2.3s')
    expect(formatMs(65_000)).toBe('65s')
  })

  test('FR-3.4 toasts follow what the person was last told, confirmed over two probes', () => {
    const run = (healths: readonly Health[]) => {
      let m = freshMemory()
      const toasts: string[] = []
      for (const h of healths) {
        const r = transitionToast('Ollama', m, h)
        m = r.memory
        if (r.toast !== undefined) toasts.push(r.toast)
      }
      return toasts
    }
    // No toast on the first probe, whatever it finds, nor while nothing changes.
    expect(run(['up', 'up', 'up'])).toEqual([])
    expect(run(['down', 'down'])).toEqual([])
    // One blip (a single timeout) toasts nothing.
    expect(run(['up', 'down', 'up', 'down', 'up'])).toEqual([])
    // Down for two probes is announced once; coming back is announced once.
    expect(run(['up', 'down', 'down', 'down', 'up', 'up'])).toEqual(['✗ Ollama stopped listening', '✓ Ollama is listening again'])
    // Starting down and coming up is a change the person sees.
    expect(run(['down', 'up'])).toEqual(['✓ Ollama is listening again'])
    // auth and degraded still listen: no toast between them and up.
    expect(run(['up', 'auth', 'degraded', 'up'])).toEqual([])
    // unknown (state reset by /clear) and off neither toast nor reset what the person was told.
    expect(run(['up', 'unknown', 'up', 'off', 'up'])).toEqual([])
  })
})
