// Shared helpers for model inventories from untrusted servers (FR-5, NFR-1, NFR-3). Pure: no `$`.

import type { ModelInfo } from '../../types'

export const MAX_MODELS = 200
/** How many raw entries a parser looks at; the rest are only counted. */
export const MAX_SCAN = 5000
const MAX_BODY_CHARS = 4_000_000
const MAX_ID_CHARS = 200
const MAX_SHORT_CHARS = 32

export type ModelList = { models: ModelInfo[]; truncated: number }

/** JSON.parse that never throws; undefined for oversized or malformed bodies. */
export const parseJson = (text: string): unknown => {
  if (text.length > MAX_BODY_CHARS) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

export const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Characters that could repaint, reorder or hide text: controls (Cc), format characters such as
 * bidi overrides, zero-width and tag characters (Cf), line/paragraph separators (Zl, Zp),
 * private-use (Co) and lone surrogates (Cs).
 */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}]/gu

/** A display-safe string: unsafe characters removed, trimmed, cut to `max` code points; undefined when empty. */
export const cleanText = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  // Bound the work first (a code point is at most 2 UTF-16 units), then cut on code points.
  const t = [...v.slice(0, max * 4).replace(UNSAFE, '').trim()].slice(0, max).join('').trim()
  return t === '' ? undefined : t
}

export const cleanId = (v: unknown): string | undefined => cleanText(v, MAX_ID_CHARS)

/** A short label (parameters, quantization). Too long means garbage, so it is dropped, not cut. */
export const cleanShort = (v: unknown): string | undefined => {
  if (typeof v !== 'string' || v.length > MAX_SHORT_CHARS * 2) return undefined
  const t = cleanText(v, MAX_SHORT_CHARS + 1)
  return t === undefined || t.length > MAX_SHORT_CHARS ? undefined : t
}

export const cleanBytes = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined

/** Builds a ModelInfo without undefined-valued keys, so results compare and serialise cleanly. */
export const modelInfo = (id: string, loaded: boolean | null, extra: Omit<ModelInfo, 'id' | 'loaded'>): ModelInfo => {
  const m: ModelInfo = { id, loaded }
  if (extra.sizeBytes !== undefined) m.sizeBytes = extra.sizeBytes
  if (extra.params !== undefined) m.params = extra.params
  if (extra.quant !== undefined) m.quant = extra.quant
  if (extra.kind !== undefined) m.kind = extra.kind
  if (extra.vramBytes !== undefined) m.vramBytes = extra.vramBytes
  if (extra.expiresAt !== undefined) m.expiresAt = extra.expiresAt
  return m
}

/** An ISO 8601 timestamp as epoch ms; undefined unless it parses to a finite time. */
export const cleanTime = (v: unknown): number | undefined => {
  if (typeof v !== 'string' || v.length > 64) return undefined
  // Ollama sends nanoseconds (`.000000000Z`); Date.parse is only specified for milliseconds.
  const t = Date.parse(v.replace(/(\.\d{3})\d+/, '$1'))
  return Number.isFinite(t) ? t : undefined
}

const rank = (m: ModelInfo): number => (m.loaded === true ? 0 : m.loaded === null ? 1 : 2)

/**
 * Dedupes by id (the most-loaded copy wins), sorts loaded first then by id, and caps at MAX_MODELS.
 * `unscanned` counts raw entries a parser never looked at; they count as truncated, so past
 * MAX_SCAN entries the `+N more` figure is an upper bound (it includes invalid and duplicate entries).
 */
export const finalize = (entries: Iterable<ModelInfo>, unscanned = 0): ModelList => {
  const byId = new Map<string, ModelInfo>()
  for (const m of entries) {
    // On a duplicate id keep the entry with the better loaded state (loaded > unknown > unloaded).
    const seen = byId.get(m.id)
    if (seen === undefined || rank(m) < rank(seen)) byId.set(m.id, m)
  }
  const all = [...byId.values()].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { models: all.slice(0, MAX_MODELS), truncated: Math.max(0, all.length - MAX_MODELS) + unscanned }
}

/** The array under `key` of a record body, or undefined when the body is not of that shape. */
export const listAt = (body: unknown, key: string): { items: readonly unknown[]; unscanned: number } | undefined => {
  if (!isRecord(body)) return undefined
  const list = body[key]
  if (!Array.isArray(list)) return undefined
  const items: readonly unknown[] = list
  return { items: items.slice(0, MAX_SCAN), unscanned: Math.max(0, items.length - MAX_SCAN) }
}
