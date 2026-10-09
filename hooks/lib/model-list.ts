// The pane's model rows (FR-5.3). Pure: no `$`. Names are already sanitised by the parsers.

import type { ModelInfo } from '../../types'

export type ModelRow = {
  /** ● loaded, ○ available, ◌ loaded state unknown (LM Studio's fallback API); empty for the "+N more" row. */
  marker: '●' | '○' | '◌' | ''
  name: string
  detail: string
  /** Requests this session sent to this model. */
  requests: number
}

/** Decimal units, as Ollama and LM Studio show sizes. */
export const formatBytes = (b: number): string => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`)

const detailOf = (m: ModelInfo): string =>
  [
    m.sizeBytes === undefined ? undefined : formatBytes(m.sizeBytes),
    m.params,
    m.quant,
    m.kind === 'embedding' ? 'embedding' : undefined,
    m.vramBytes === undefined ? undefined : `${formatBytes(m.vramBytes)} VRAM`,
  ]
    .filter((p): p is string => p !== undefined)
    .join(' · ')

/** Rows in the inventory's order (loaded first, from the parsers), then `+N more` past the cap. */
export const modelRows = (models: readonly ModelInfo[], truncated: number, requestsFor: (id: string) => number): ModelRow[] => {
  const rows: ModelRow[] = models.map(m => ({
    marker: m.loaded === true ? '●' : m.loaded === null ? '◌' : '○',
    name: m.id,
    detail: detailOf(m),
    requests: requestsFor(m.id),
  }))
  if (truncated > 0) rows.push({ marker: '', name: `+${truncated} more`, detail: '', requests: 0 })
  return rows
}
