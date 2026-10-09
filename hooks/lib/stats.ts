// Request statistics per backend (FR-4.2, FR-4.3, FR-4.6, NFR-3). Pure: no `$`. Every update returns a new Stats.
//
// Speed figures (latency, TTFT, tok/s) come from successful requests only (SPEC FR-4.2): a backend
// that fails fast must not look quick. Every request still counts in total, ok/failed and lastAt.

import type { Stats } from '../../types'
import { cleanId } from './models'

export const MAX_SAMPLES = 200
export const MAX_BY_MODEL = 50
const MAX_LATENCY_MS = 24 * 60 * 60 * 1000
const MAX_TOKENS = 10_000_000
/** Below this, the time after the first token is too short to measure a rate from. */
const MIN_GEN_MS = 50

/** One finished request: metadata only, never prompt, output or command text (FR-4.6). */
export type Sample = {
  kind: 'model' | 'tool'
  /** False for an error, an abort or a tool error. */
  ok: boolean
  latencyMs: number
  /** Clock time when it finished. */
  at: number
  /** Time to the first streamed chunk (model requests only). */
  ttftMs?: number
  /** Output tokens from `usage` (model requests only). */
  outTokens?: number
  model?: string
}

export type Summary = {
  total: number
  model: number
  tool: number
  inFlight: number
  ok: number
  failed: number
  avgMs?: number
  p50Ms?: number
  p95Ms?: number
  lastMs?: number
  avgTtftMs?: number
  tokPerSec?: number
  lastAt?: number
}

export const emptyStats = (): Stats => ({
  total: 0,
  model: 0,
  tool: 0,
  inFlight: 0,
  ok: 0,
  failed: 0,
  latMs: [],
  ttftMs: [],
  outTokens: 0,
  rateTokens: 0,
  genMs: 0,
  byModel: {},
  byModelOther: 0,
})

const count = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0)

const samples = (v: unknown): number[] =>
  Array.isArray(v)
    ? v.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0).slice(-MAX_SAMPLES)
    : []

/**
 * A full, bounded Stats from whatever `$.state` holds: after a hot reload it may be a value from an
 * older contract, or partial. Missing or malformed fields become their empty values.
 */
export const asStats = (v: unknown): Stats => {
  if (typeof v !== 'object' || v === null) return emptyStats()
  const o = v as Readonly<Record<string, unknown>>
  const counts = new Map<string, number>()
  const rawByModel = o['byModel']
  if (typeof rawByModel === 'object' && rawByModel !== null) {
    for (const [k, n] of Object.entries(rawByModel)) {
      if (counts.size >= MAX_BY_MODEL) break
      if (count(n) > 0) counts.set(k, count(n))
    }
  }
  const s: Stats = {
    total: count(o['total']),
    model: count(o['model']),
    tool: count(o['tool']),
    inFlight: count(o['inFlight']),
    ok: count(o['ok']),
    failed: count(o['failed']),
    latMs: samples(o['latMs']),
    ttftMs: samples(o['ttftMs']),
    outTokens: count(o['outTokens']),
    rateTokens: count(o['rateTokens']),
    genMs: count(o['genMs']),
    byModel: Object.fromEntries(counts),
    byModelOther: count(o['byModelOther']),
  }
  const lastAt = o['lastAt']
  if (typeof lastAt === 'number' && Number.isFinite(lastAt)) s.lastAt = lastAt
  return s
}

export const begin = (s: Stats): Stats => ({ ...s, inFlight: s.inFlight + 1 })

/** Takes back a `begin` for something that turned out not to be a request (a refused tool call). */
export const cancel = (s: Stats): Stats => ({ ...s, inFlight: Math.max(0, s.inFlight - 1) })

/** Clears the counters but keeps requests still running, so the band doesn't hide live work. */
export const reset = (s: Stats): Stats => ({ ...emptyStats(), inFlight: s.inFlight })

const ms = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), MAX_LATENCY_MS) : 0

const tokens = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_TOKENS ? v : undefined

const push = (list: readonly number[], v: number): number[] => [...list.slice(-(MAX_SAMPLES - 1)), v]

/** How many requests this session sent for `model` (0 when unknown or counted in byModelOther). */
export const requestsFor = (s: Stats, model: string): number =>
  Object.hasOwn(s.byModel, model) ? (s.byModel[model] ?? 0) : 0

const countModel = (s: Stats, raw: unknown): Pick<Stats, 'byModel' | 'byModelOther'> => {
  const id = cleanId(raw)
  if (id === undefined) return { byModel: s.byModel, byModelOther: s.byModelOther }
  // A Map, then Object.fromEntries: untrusted ids such as `__proto__` stay plain own keys.
  const counts = new Map(Object.entries(s.byModel))
  if (!counts.has(id) && counts.size >= MAX_BY_MODEL) return { byModel: s.byModel, byModelOther: s.byModelOther + 1 }
  counts.set(id, (counts.get(id) ?? 0) + 1)
  return { byModel: Object.fromEntries(counts), byModelOther: s.byModelOther }
}

/** The part of a successful model request that feeds tok/s, or nothing when it can't be measured. */
const rate = (latency: number, ttft: number | undefined, out: number | undefined): { tokens: number; ms: number } | undefined => {
  if (out === undefined) return undefined
  const afterFirst = ttft === undefined ? latency : latency - ttft
  // One chunk, or a first token at the very end: measure over the whole request instead.
  const span = afterFirst >= Math.max(MIN_GEN_MS, latency * 0.1) ? afterFirst : latency
  return span > 0 ? { tokens: out, ms: span } : undefined
}

export const end = (s: Stats, sample: Sample): Stats => {
  const isModel = sample.kind === 'model'
  const latency = ms(sample.latencyMs)
  const t = isModel ? sample.ttftMs : undefined
  // Ignored unless it is a real time that fits inside the request: a first token can't come after the end.
  const ttft = typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= latency ? t : undefined
  const out = isModel ? tokens(sample.outTokens) : undefined
  const measured = sample.ok ? rate(latency, ttft, out) : undefined

  // Only known fields are copied: nothing else on `sample` (text of any kind) reaches state (FR-4.6).
  const next: Stats = {
    ...s,
    total: s.total + 1,
    model: s.model + (isModel ? 1 : 0),
    tool: s.tool + (isModel ? 0 : 1),
    inFlight: Math.max(0, s.inFlight - 1),
    ok: s.ok + (sample.ok ? 1 : 0),
    failed: s.failed + (sample.ok ? 0 : 1),
    latMs: sample.ok ? push(s.latMs, latency) : s.latMs,
    ttftMs: sample.ok && ttft !== undefined ? push(s.ttftMs, ttft) : s.ttftMs,
    outTokens: s.outTokens + (out ?? 0),
    rateTokens: s.rateTokens + (measured?.tokens ?? 0),
    genMs: s.genMs + (measured?.ms ?? 0),
    ...(sample.model === undefined ? {} : countModel(s, sample.model)),
  }
  if (typeof sample.at === 'number' && Number.isFinite(sample.at)) next.lastAt = sample.at
  return next
}

const nearestRank = (sorted: readonly number[], p: number): number | undefined => {
  if (sorted.length === 0) return undefined
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length))) - 1]
}

/** Nearest-rank percentile; undefined for no samples. */
export const percentile = (list: readonly number[], p: number): number | undefined =>
  nearestRank([...list].sort((a, b) => a - b), p)

const mean = (list: readonly number[]): number | undefined =>
  list.length === 0 ? undefined : list.reduce((a, b) => a + b, 0) / list.length

const sum = (all: readonly Stats[], pick: (s: Stats) => number): number => all.reduce((n, s) => n + pick(s), 0)

/** Display figures for one backend, or for several combined (the band's total). Unknowns are left out. */
export const summarize = (...all: readonly Stats[]): Summary => {
  const lat = all.flatMap(s => s.latMs).sort((a, b) => a - b)
  const genMs = sum(all, s => s.genMs)
  // The backend that finished a request most recently gives lastAt; lastMs is its newest successful latency.
  const newest = all.reduce<Stats | undefined>(
    (best, s) => (s.lastAt !== undefined && (best?.lastAt === undefined || s.lastAt > best.lastAt) ? s : best),
    undefined,
  )
  const lastMs = newest?.latMs.at(-1) ?? [...all].reverse().find(s => s.latMs.length > 0)?.latMs.at(-1)

  const out: Summary = {
    total: sum(all, s => s.total),
    model: sum(all, s => s.model),
    tool: sum(all, s => s.tool),
    inFlight: sum(all, s => s.inFlight),
    ok: sum(all, s => s.ok),
    failed: sum(all, s => s.failed),
  }
  const set = <K extends keyof Summary>(k: K, v: Summary[K] | undefined) => {
    if (v !== undefined) out[k] = v
  }
  set('avgMs', mean(lat))
  set('p50Ms', nearestRank(lat, 50))
  set('p95Ms', nearestRank(lat, 95))
  set('lastMs', lastMs)
  set('avgTtftMs', mean(all.flatMap(s => s.ttftMs)))
  set('tokPerSec', genMs > 0 ? (sum(all, s => s.rateTokens) * 1000) / genMs : undefined)
  set('lastAt', newest?.lastAt)
  return out
}
