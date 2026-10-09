// The status band's content (FR-3.1, FR-3.2, FR-3.8, FR-5.2, NFR-5). Pure: no `$`; the drawing is in hooks/ui/band.tsx.
//
// Every state is a glyph plus a word; `tone` only adds colour. The line is built from the most
// detailed variant down until one fits `bodyColumns`. Below COMPACT_BELOW columns it collapses
// to icons and numbers.

import type { BackendStatus, Health, Stats } from '../../types'
import { summarize } from './stats'

export const COMPACT_BELOW = 60

export type Tone = 'ok' | 'bad' | 'warn' | 'dim' | 'plain'
/** `shrink`: the part that is cut first if the row is still too wide (wide glyphs in some terminals). */
export type Segment = { text: string; tone: Tone; shrink?: true }

export type BandInput = {
  ollama: BackendStatus
  lmstudio: BackendStatus
  statsOllama: Stats
  statsLmstudio: Stats
}

const GLYPH: { readonly [H in Health]: string } = { up: '✓', auth: '⚠', degraded: '⚠', down: '✗', unknown: '…', off: '–' }
const WORD: { readonly [H in Health]: string } = { up: '', auth: ' auth', degraded: ' degraded', down: '', unknown: '', off: ' off' }
const TONE: { readonly [H in Health]: Tone } = { up: 'ok', auth: 'warn', degraded: 'warn', down: 'bad', unknown: 'dim', off: 'dim' }

export const formatMs = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)}ms` : ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`

type Detail = { version: boolean; models: boolean; avg: boolean; p95: boolean; tokPerSec: boolean }

const FULL: Detail = { version: true, models: true, avg: true, p95: true, tokPerSec: true }
/** Detail dropped in this order until the line fits. */
const VARIANTS: readonly Detail[] = [
  FULL,
  { ...FULL, tokPerSec: false },
  { ...FULL, tokPerSec: false, p95: false },
  { ...FULL, tokPerSec: false, p95: false, version: false },
  { version: false, models: false, avg: true, p95: false, tokPerSec: false },
  { version: false, models: false, avg: false, p95: false, tokPerSec: false },
]

/** `N models (M loaded)` once the inventory is known; just `N models` when loaded state is unknown. */
export const modelCount = (s: BackendStatus): string | undefined => {
  if (s.modelsAt === undefined || s.health === 'off' || s.health === 'down') return undefined
  const n = s.models.length + s.modelsTruncated
  const unknown = s.models.some(m => m.loaded === null)
  const loaded = s.models.filter(m => m.loaded === true).length
  const label = `${n} model${n === 1 ? '' : 's'}`
  return unknown ? label : `${label} (${loaded} loaded)`
}

const backend = (name: string, s: BackendStatus, d: Detail): Segment => {
  let text = `${GLYPH[s.health]} ${name}${WORD[s.health]}`
  if (d.version && s.health === 'up' && s.version !== undefined) text += ` ${s.version}`
  const models = d.models ? modelCount(s) : undefined
  if (models !== undefined) text += ` · ${models}`
  return { text, tone: TONE[s.health] }
}

const summary = (i: BandInput, d: Detail): string | undefined => {
  const sum = summarize(i.statsOllama, i.statsLmstudio)
  if (sum.total === 0 && sum.inFlight === 0) return undefined
  let text = `local reqs ${sum.total}${sum.inFlight > 0 ? ` (⟳${sum.inFlight})` : ''}`
  if (d.avg && sum.avgMs !== undefined) text += ` · avg ${formatMs(sum.avgMs)}`
  if (d.p95 && sum.p95Ms !== undefined) text += ` · p95 ${formatMs(sum.p95Ms)}`
  if (d.tokPerSec && sum.tokPerSec !== undefined) text += ` · ${Math.round(sum.tokPerSec)} tok/s`
  return text
}

const full = (i: BandInput, d: Detail): Segment[] => {
  const line: Segment[] = [backend('Ollama', i.ollama, d), { text: '   ', tone: 'plain' }, backend('LM Studio', i.lmstudio, d)]
  const sum = summary(i, d)
  if (sum !== undefined) line.push({ text: `   │ ${sum}`, tone: 'plain', shrink: true })
  return line
}

const compact = (i: BandInput, columns: number): Segment[] => {
  const head: Segment[] = [
    { text: `${GLYPH[i.ollama.health]}O`, tone: TONE[i.ollama.health] },
    { text: ' ', tone: 'plain' },
    { text: `${GLYPH[i.lmstudio.health]}L`, tone: TONE[i.lmstudio.health] },
  ]
  const sum = summarize(i.statsOllama, i.statsLmstudio)
  const tails = sum.total === 0 && sum.inFlight === 0 ? [] : [` · ${sum.total} req${sum.avgMs === undefined ? '' : ` · ${formatMs(sum.avgMs)}`}`, ` · ${sum.total} req`]
  for (const tail of tails) if (5 + tail.length <= columns) return [...head, { text: tail, tone: 'plain', shrink: true }]
  return head
}

const width = (line: readonly Segment[]): number => line.reduce((n, s) => n + s.text.length, 0)

/** The band's segments for a body `columns` wide. */
export const bandLine = (i: BandInput, columns: number): Segment[] => {
  if (columns >= COMPACT_BELOW) {
    for (const d of VARIANTS) {
      const line = full(i, d)
      if (width(line) <= columns) return line
    }
  }
  return compact(i, columns)
}
