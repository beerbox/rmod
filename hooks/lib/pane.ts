// The /rmod pane's content (FR-3.5, FR-4.4, FR-5.3). Pure: no `$`; the drawing is in hooks/ui/pane.tsx.

import type { BackendStatus, Stats } from '../../types'
import { formatMs, TONE } from './band'
import type { Tone } from './band'
import { modelRows } from './model-list'
import type { ModelRow } from './model-list'
import { requestsFor, summarize } from './stats'
import { ERROR_TEXT, HEALTH_TEXT } from './status-text'

export type PaneSection = {
  name: string
  /** Glyph + word, version, probe time and how long ago it was checked. */
  status: string
  tone: Tone
  /** The stats table as lines of label/value pairs (FR-4.4). */
  stats: string[]
  models: ModelRow[]
  /** Why there is no list, or that the last one couldn't be read (FR-5.4). */
  modelsNote?: string
}

const ago = (now: number, at: number | undefined): string | undefined =>
  at === undefined ? undefined : `${Math.max(0, Math.round((now - at) / 1000))} s ago`

const statusLine = (s: BackendStatus, now: number): string => {
  const parts = [`${HEALTH_TEXT[s.health]}${s.error === undefined || s.health === 'off' ? '' : ` (${ERROR_TEXT[s.error]})`}`]
  if (s.health === 'up' && s.version !== undefined) parts.push(`v${s.version}`)
  if (s.health !== 'down' && s.health !== 'off' && s.probeMs !== undefined) parts.push(`${Math.round(s.probeMs)} ms`)
  const checked = s.health === 'off' ? undefined : ago(now, s.checkedAt)
  if (checked !== undefined) parts.push(`checked ${checked}`)
  return parts.join(' · ')
}

/** FR-4.4: requests (model/tool), in flight, ok/failed, avg, p50, p95, last, avg TTFT, tok/s, last request N s ago. */
export const statsLines = (stats: Stats, now: number): string[] => {
  const sum = summarize(stats)
  if (sum.total === 0 && sum.inFlight === 0) return ['no local requests yet']
  const lines = [`requests ${sum.total} (${sum.model} model / ${sum.tool} tool) · in flight ${sum.inFlight} · ${sum.ok} ok / ${sum.failed} failed`]
  const speed = [
    sum.avgMs === undefined ? undefined : `avg ${formatMs(sum.avgMs)}`,
    sum.p50Ms === undefined ? undefined : `p50 ${formatMs(sum.p50Ms)}`,
    sum.p95Ms === undefined ? undefined : `p95 ${formatMs(sum.p95Ms)}`,
    sum.lastMs === undefined ? undefined : `last ${formatMs(sum.lastMs)}`,
    sum.avgTtftMs === undefined ? undefined : `TTFT ${formatMs(sum.avgTtftMs)}`,
    sum.tokPerSec === undefined ? undefined : `${Math.round(sum.tokPerSec)} tok/s`,
  ].filter((p): p is string => p !== undefined)
  if (speed.length > 0) lines.push(speed.join(' · '))
  const last = ago(now, sum.lastAt)
  if (last !== undefined) lines.push(`last request ${last}`)
  return lines
}

const modelsNoteOf = (s: BackendStatus): string | undefined => {
  if (s.health === 'off') return undefined
  if (s.modelsError !== undefined) return '⚠ unreadable response (showing the last good list)'
  if (s.modelsAt === undefined) return s.health === 'up' ? 'model list not read yet' : undefined
  return s.models.length === 0 && s.modelsTruncated === 0 ? 'no models' : undefined
}

export const paneSection = (name: string, s: BackendStatus, stats: Stats, now: number): PaneSection => {
  const section: PaneSection = {
    name,
    status: statusLine(s, now),
    tone: TONE[s.health],
    stats: s.health === 'off' ? [] : statsLines(stats, now),
    models: s.health === 'off' || s.modelsAt === undefined ? [] : modelRows(s.models, s.modelsTruncated, id => requestsFor(stats, id)),
  }
  const note = modelsNoteOf(s)
  if (note !== undefined) section.modelsNote = note
  return section
}
