import { describe, expect, test } from 'claude-code/testing'

import { paneSection, statsLines } from '../../hooks/lib/pane'
import { initialStatus } from '../../hooks/lib/probe'
import { begin, emptyStats, end } from '../../hooks/lib/stats'
import type { BackendStatus } from '../../types'

const s = (over: Partial<BackendStatus>): BackendStatus => ({ ...initialStatus(), ...over })

describe('pane', () => {
  test('FR-4.4 the stats table: requests, in flight, ok/failed, speed figures and last request age', () => {
    let st = end(begin(emptyStats()), { kind: 'model', ok: true, latencyMs: 2000, at: 10_000, ttftMs: 400, outTokens: 80, model: 'llama3.2:3b' })
    st = end(begin(st), { kind: 'tool', ok: false, latencyMs: 30, at: 11_000 })
    st = begin(st)
    expect(statsLines(st, 23_000)).toEqual([
      'requests 2 (1 model / 1 tool) · in flight 1 · 1 ok / 1 failed',
      'avg 2.0s · p50 2.0s · p95 2.0s · last 2.0s · TTFT 400ms · 50 tok/s',
      'last request 12 s ago',
    ])
    expect(statsLines(emptyStats(), 0)).toEqual(['no local requests yet'])
  })

  test('FR-3.5 FR-5.3 a section: status with checked age, models loaded first with session request counts', () => {
    const st = end(begin(emptyStats()), { kind: 'model', ok: true, latencyMs: 1, at: 1, model: 'llama3.2:3b' })
    const sec = paneSection(
      'Ollama',
      s({
        health: 'up',
        version: '0.40.2',
        probeMs: 9,
        checkedAt: 7_000,
        modelsAt: 1,
        models: [{ id: 'llama3.2:3b', loaded: true, sizeBytes: 2_000_000_000 }, { id: 'gemma4:12b-mlx', loaded: false }],
        modelsTruncated: 3,
      }),
      st,
      10_000,
    )
    expect(sec.status).toBe('✓ up · v0.40.2 · 9 ms · checked 3 s ago')
    expect(sec.tone).toBe('ok')
    expect(sec.models).toEqual([
      { marker: '●', name: 'llama3.2:3b', detail: '2.0 GB', requests: 1 },
      { marker: '○', name: 'gemma4:12b-mlx', detail: '', requests: 0 },
      { marker: '', name: '+3 more', detail: '', requests: 0 },
    ])
    expect(sec.modelsNote).toBeUndefined()
  })

  test('FR-5.4 an unreadable list is noted and the last good list kept; off shows nothing more', () => {
    const bad = paneSection('Ollama', s({ health: 'up', modelsAt: 1, modelsError: 'parse', models: [{ id: 'a', loaded: false }] }), emptyStats(), 0)
    expect(bad.modelsNote).toBe('⚠ unreadable response (showing the last good list)')
    expect(bad.models.length).toBe(1)
    const off = paneSection('LM Studio', s({ health: 'off' }), emptyStats(), 0)
    expect(off).toEqual({ name: 'LM Studio', status: '– off', tone: 'dim', stats: [], models: [] })
    const down = paneSection('LM Studio', s({ health: 'down', error: 'refused', checkedAt: 0 }), emptyStats(), 4000)
    expect(down.status).toBe('✗ not listening (connection refused) · checked 4 s ago')
  })
})
