// Model inventories in state (FR-5.1, FR-5.4). Pure: no `$`; register.tsx does the fetches.

import type { BackendStatus, ProbeError } from '../../types'
import type { ModelList } from './models'
import { parseJson } from './models'
import { mergeOllama } from './parse-ollama'
import { classifyRejection } from './probe'
import type { ProbeOutcome } from './probe'

export type InventoryResult = { models: ModelList } | { error: ProbeError }

/** Why a body could not be read, or the body when it can be (2xx). */
const bodyOf = (o: ProbeOutcome): { text: string } | { error: ProbeError } => {
  if (o.kind === 'timeout') return { error: 'timeout' }
  if (o.kind === 'rejected') return { error: classifyRejection(o.message) }
  return o.status >= 200 && o.status <= 299 ? { text: o.text } : { error: 'http' }
}

/** `/api/tags` decides; `/api/ps` failing only makes loaded state unknown. */
export const ollamaInventory = (tags: ProbeOutcome, ps: ProbeOutcome): InventoryResult => {
  const t = bodyOf(tags)
  if ('error' in t) return t
  const p = bodyOf(ps)
  const list = mergeOllama(parseJson(t.text), 'text' in p ? parseJson(p.text) : undefined)
  return list === undefined ? { error: 'parse' } : { models: list }
}

/** The status with a new inventory, or with the error recorded and the last good list kept (FR-5.4). */
export const applyInventory = (prev: BackendStatus, r: InventoryResult, at: number): BackendStatus => {
  if ('error' in r) return { ...prev, modelsError: r.error }
  const { modelsError: _dropped, ...rest } = prev
  return { ...rest, models: r.models.models, modelsTruncated: r.models.truncated, modelsAt: at }
}

/**
 * Whether to fetch the inventory now: asked for, just came up, never tried, state fresh after
 * /clear (no list and no error), or `refreshMs` since the last attempt. After a failed attempt it
 * waits for the interval rather than retrying on every probe.
 */
export const inventoryDue = (
  s: BackendStatus,
  lastAttempt: number | undefined,
  now: number,
  refreshMs: number,
  cameUp: boolean,
  force: boolean,
): boolean =>
  force || cameUp || lastAttempt === undefined || (s.modelsAt === undefined && s.modelsError === undefined) || now - lastAttempt >= refreshMs

/** True when `list` is what the status already holds, so state isn't rewritten (and redrawn) for nothing. */
export const sameInventory = (s: BackendStatus, list: ModelList): boolean =>
  s.modelsTruncated === list.truncated && JSON.stringify(s.models) === JSON.stringify(list.models)
