import { describe, expect, test } from 'claude-code/testing'

import { asStats, begin, emptyStats, end, MAX_BY_MODEL, MAX_SAMPLES, percentile, requestsFor, summarize } from '../../hooks/lib/stats'
import type { Stats } from '../../types'

const tool = (latencyMs: number, ok = true, at = 1000) => ({ kind: 'tool', ok, latencyMs, at }) as const

const deepFreeze = <T>(v: T): T => {
  if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x)
    Object.freeze(v)
  }
  return v
}

describe('stats', () => {
  test('FR-4.2 a fresh Stats is all zero and summarises to unknowns', () => {
    const s = emptyStats()
    expect(s).toEqual({ total: 0, model: 0, tool: 0, inFlight: 0, ok: 0, failed: 0, latMs: [], ttftMs: [], outTokens: 0, rateTokens: 0, genMs: 0, byModel: {}, byModelOther: 0 })
    expect(summarize(s)).toEqual({ total: 0, model: 0, tool: 0, inFlight: 0, ok: 0, failed: 0 })
  })

  test('FR-4.3 begin shows a request in flight, end settles it', () => {
    const running = begin(emptyStats())
    expect(running.inFlight).toBe(1)
    const done = end(running, tool(120))
    expect(done).toMatchObject({ inFlight: 0, total: 1, tool: 1, model: 0, ok: 1, failed: 0, latMs: [120], lastAt: 1000 })
  })

  test('FR-4.2 updates are immutable, including full buffers and byModel', () => {
    let full = emptyStats()
    for (let i = 0; i < MAX_SAMPLES; i += 1) full = end(begin(full), { kind: 'model', ok: true, latencyMs: 100, at: i, ttftMs: 10, model: 'm' })
    const before = JSON.stringify(full)
    const frozen = deepFreeze(full)
    const after = end(begin(frozen), { kind: 'model', ok: true, latencyMs: 7, at: 999, ttftMs: 1, outTokens: 5, model: 'm' })
    expect(JSON.stringify(frozen)).toBe(before)
    expect(after.latMs.at(-1)).toBe(7)
    expect(requestsFor(after, 'm')).toBe(MAX_SAMPLES + 1)
  })

  test('FR-4.2 model and tool requests count separately and together; failures count', () => {
    let s = emptyStats()
    s = end(begin(s), { kind: 'model', ok: true, latencyMs: 2000, at: 1, ttftMs: 500, outTokens: 300, model: 'llama3.2:3b' })
    s = end(begin(s), tool(100, false))
    s = end(begin(s), { kind: 'model', ok: false, latencyMs: 50, at: 2, model: 'llama3.2:3b' })
    expect(s).toMatchObject({ total: 3, model: 2, tool: 1, ok: 1, failed: 2, inFlight: 0, lastAt: 2 })
    expect(requestsFor(s, 'llama3.2:3b')).toBe(2)
  })

  test('FR-4.2 avg, p50, p95 and last come from the latency samples', () => {
    let s = emptyStats()
    for (let i = 1; i <= 100; i += 1) s = end(begin(s), tool(i * 10))
    const sum = summarize(s)
    expect(sum.avgMs).toBe(505)
    expect(sum.p50Ms).toBe(500)
    expect(sum.p95Ms).toBe(950)
    expect(sum.lastMs).toBe(1000)
  })

  test('FR-4.2 percentile uses nearest rank and handles one sample', () => {
    expect(percentile([42], 50)).toBe(42)
    expect(percentile([42], 95)).toBe(42)
    expect(percentile([3, 1, 2], 50)).toBe(2)
    expect(percentile([], 50)).toBeUndefined()
  })

  test('FR-4.2 TTFT and tok/s use generation time after the first token', () => {
    let s = emptyStats()
    s = end(begin(s), { kind: 'model', ok: true, latencyMs: 3000, at: 1, ttftMs: 1000, outTokens: 100 })
    s = end(begin(s), { kind: 'model', ok: true, latencyMs: 1500, at: 2, ttftMs: 500, outTokens: 50 })
    const sum = summarize(s)
    expect(sum.avgTtftMs).toBe(750)
    expect(s.outTokens).toBe(150)
    expect(s.genMs).toBe(3000)
    expect(sum.tokPerSec).toBe(50)
  })

  test('FR-4.2 tok/s falls back to the whole latency when TTFT is unknown, and is unknown without usage', () => {
    const withUsage = end(begin(emptyStats()), { kind: 'model', ok: true, latencyMs: 2000, at: 1, outTokens: 40 })
    expect(summarize(withUsage).tokPerSec).toBe(20)
    expect(summarize(withUsage).avgTtftMs).toBeUndefined()
    const noUsage = end(begin(emptyStats()), { kind: 'model', ok: true, latencyMs: 2000, at: 1, ttftMs: 100 })
    expect(summarize(noUsage).tokPerSec).toBeUndefined()
  })

  test('NFR-3 latency and TTFT keep only the newest 200 samples', () => {
    let s = emptyStats()
    for (let i = 0; i < 250; i += 1) s = end(begin(s), { kind: 'model', ok: true, latencyMs: i, at: i, ttftMs: i })
    expect(s.latMs.length).toBe(MAX_SAMPLES)
    expect(s.ttftMs.length).toBe(MAX_SAMPLES)
    expect(s.latMs[0]).toBe(50)
    expect(s.latMs[199]).toBe(249)
    expect(s.total).toBe(250)
  })

  test('NFR-3 byModel keeps at most 50 keys and counts the rest under one overflow key', () => {
    let s = emptyStats()
    for (let i = 0; i < 60; i += 1) s = end(begin(s), { kind: 'model', ok: true, latencyMs: 1, at: i, model: `m${i}` })
    s = end(begin(s), { kind: 'model', ok: true, latencyMs: 1, at: 99, model: 'm0' })
    expect(Object.keys(s.byModel).length).toBe(MAX_BY_MODEL)
    expect(requestsFor(s, 'm0')).toBe(2)
    expect(requestsFor(s, 'm59')).toBe(0)
    expect(s.byModelOther).toBe(10)
  })

  test('NFR-1 byModel keys are sanitised and prototype names stay plain data', () => {
    let s = emptyStats()
    for (const model of ['__proto__', 'constructor', 'ev‮il', '']) s = end(begin(s), { kind: 'model', ok: true, latencyMs: 1, at: 1, model })
    expect(requestsFor(s, '__proto__')).toBe(1)
    expect(requestsFor(s, 'constructor')).toBe(1)
    expect(requestsFor(s, 'evil')).toBe(1)
    expect(requestsFor(s, 'toString')).toBe(0)
    expect(Object.keys(s.byModel).sort()).toEqual(['__proto__', 'constructor', 'evil'])
    expect(({} as Record<string, unknown>)['total']).toBeUndefined()
  })

  test('NFR-1 bad numbers are clamped or ignored, never stored as NaN', () => {
    let s: Stats = emptyStats()
    s = end(begin(s), { kind: 'model', ok: true, latencyMs: Number.NaN, at: Number.NaN, ttftMs: -5, outTokens: 1.5 })
    s = end(begin(s), { kind: 'model', ok: true, latencyMs: -10, at: 5, ttftMs: 9e9, outTokens: -3 })
    expect(s.latMs).toEqual([0, 0])
    expect(s.ttftMs).toEqual([])
    expect(s.outTokens).toBe(0)
    expect(s.lastAt).toBe(5)
    expect(JSON.stringify(summarize(s))).not.toContain('null')
  })

  test('FR-4.3 end never drives in-flight below zero (a reset mid-request)', () => {
    expect(end(emptyStats(), tool(5)).inFlight).toBe(0)
  })

  test('FR-4.2 summarize combines backends into one total', () => {
    const a = end(begin(emptyStats()), tool(100, true, 3))
    const b = end(begin(begin(emptyStats())), { kind: 'model', ok: true, latencyMs: 300, at: 7, outTokens: 30 })
    const sum = summarize(a, b)
    expect(sum).toMatchObject({ total: 2, tool: 1, model: 1, ok: 2, failed: 0, inFlight: 1, avgMs: 200, lastAt: 7, lastMs: 300 })
    expect(sum.tokPerSec).toBe(100)
  })

  test('FR-4.2 failed requests count but never feed latency, TTFT or tok/s', () => {
    let s = end(begin(emptyStats()), { kind: 'model', ok: true, latencyMs: 2000, at: 1, ttftMs: 500, outTokens: 150 })
    s = end(begin(s), { kind: 'model', ok: false, latencyMs: 3, at: 2, ttftMs: 1, outTokens: 9000 })
    s = end(begin(s), tool(1, false, 3))
    expect(s).toMatchObject({ total: 3, ok: 1, failed: 2, latMs: [2000], ttftMs: [500], lastAt: 3 })
    expect(summarize(s)).toMatchObject({ avgMs: 2000, p50Ms: 2000, p95Ms: 2000, lastMs: 2000, avgTtftMs: 500, tokPerSec: 100 })
  })

  test('FR-4.2 a one-chunk reply (first token at the end) is rated over the whole request, not inflated', () => {
    let s = end(begin(emptyStats()), { kind: 'model', ok: true, latencyMs: 2000, at: 1, ttftMs: 1000, outTokens: 100 })
    s = end(begin(s), { kind: 'model', ok: true, latencyMs: 500, at: 2, ttftMs: 500, outTokens: 400 })
    // 100 tok over 1000 ms after the first token, plus 400 tok over the whole 500 ms.
    expect(s.genMs).toBe(1500)
    expect(s.rateTokens).toBe(500)
    expect(Math.round(summarize(s).tokPerSec ?? 0)).toBe(333)
  })

  test('FR-4.2 a zero-length reply adds tokens to the total but not to the rate', () => {
    const s = end(begin(emptyStats()), { kind: 'model', ok: true, latencyMs: 0, at: 1, outTokens: 10 })
    expect(s).toMatchObject({ outTokens: 10, rateTokens: 0, genMs: 0 })
    expect(summarize(s).tokPerSec).toBeUndefined()
  })

  test('FR-4.2 tool samples never feed the model-only TTFT and token figures', () => {
    const s = end(begin(emptyStats()), { kind: 'tool', ok: true, latencyMs: 400, at: 1, ttftMs: 10, outTokens: 99 })
    expect(s).toMatchObject({ tool: 1, ttftMs: [], outTokens: 0, rateTokens: 0, genMs: 0, latMs: [400] })
  })

  test('FR-4.6 only metadata reaches Stats: extra text fields on a sample are dropped', () => {
    const sample = { kind: 'model', ok: true, latencyMs: 5, at: 1, model: 'm', prompt: 'SECRET-PROMPT', command: 'rm -rf ~', text: 'OUTPUT' } as const
    const s = end(begin(emptyStats()), sample)
    const json = JSON.stringify(s)
    for (const word of ['SECRET-PROMPT', 'rm -rf', 'OUTPUT', 'prompt', 'command', '"text"']) expect(json).not.toContain(word)
  })

  test('NFR-3 asStats turns stale, partial or junk state into a full bounded Stats', () => {
    expect(asStats(undefined)).toEqual(emptyStats())
    expect(asStats('junk')).toEqual(emptyStats())
    const old = { total: 4, ok: 3, failed: 1, latMs: [1, 'x', -2, Number.NaN, 5], byModel: { a: 2, b: 'x', __proto__: 1 }, lastAt: 9 }
    const s = asStats(JSON.parse(JSON.stringify(old)))
    expect(s).toMatchObject({ total: 4, ok: 3, failed: 1, latMs: [1, 5], rateTokens: 0, byModelOther: 0, lastAt: 9 })
    expect(s.byModel).toEqual({ a: 2 })
    const big = asStats({ latMs: Array.from({ length: 999 }, (_, i) => i), byModel: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`m${i}`, 1])) })
    expect(big.latMs.length).toBe(MAX_SAMPLES)
    expect(Object.keys(big.byModel).length).toBe(MAX_BY_MODEL)
    expect(end(begin(asStats({ total: 1 })), tool(3)).total).toBe(2)
  })
})
