// The plain-text status that /rmod-status returns (FR-3.7, NFR-5). Pure: no `$`.
// Glyph + word for every state, so the meaning never depends on colour.

import type { BackendStatus, Health, LmStudioEndpoint, ProbeError, Stats } from '../../types'
import { formatMs, modelCount } from './band'
import { summarize } from './stats'

export const HEALTH_TEXT: { readonly [H in Health]: string } = {
  up: '✓ up',
  auth: '⚠ up, auth required',
  degraded: '⚠ degraded',
  down: '✗ not listening',
  unknown: '… checking',
  off: '– off',
}

export const ERROR_TEXT: { readonly [E in ProbeError]: string } = {
  refused: 'connection refused',
  timeout: 'no answer in time',
  policy: 'blocked by policy',
  http: 'unexpected HTTP status',
  parse: 'unreadable response',
  config: 'invalid URL',
}

const line = (name: string, s: BackendStatus, url: string, extra: readonly string[]): string => {
  const parts = [`${name}: ${HEALTH_TEXT[s.health]}${s.error === undefined || s.health === 'off' ? '' : ` (${ERROR_TEXT[s.error]})`}`]
  if (s.health === 'up' && s.version !== undefined) parts.push(`v${s.version}`)
  if (s.health !== 'down' && s.health !== 'off' && s.probeMs !== undefined) parts.push(`${Math.round(s.probeMs)} ms`)
  const models = modelCount(s)
  if (models !== undefined) parts.push(models)
  if (s.health !== 'off') parts.push(url)
  return [...parts, ...extra].join(' · ')
}

export type StatusInput = {
  ollama: BackendStatus
  lmstudio: BackendStatus
  ollamaUrl: string
  lmstudioUrl: string
  ollamaExposed: boolean
  lmstudioEndpoint: LmStudioEndpoint
  statsOllama: Stats
  statsLmstudio: Stats
}

/** The band's session summary as a line, or nothing before the first local request. */
const sessionLine = (i: StatusInput): string[] => {
  const sum = summarize(i.statsOllama, i.statsLmstudio)
  if (sum.total === 0 && sum.inFlight === 0) return []
  const parts = [`Session: ${sum.total} local requests (${sum.model} model, ${sum.tool} tool)`, `${sum.ok} ok, ${sum.failed} failed`]
  if (sum.inFlight > 0) parts.push(`${sum.inFlight} in flight`)
  if (sum.avgMs !== undefined) parts.push(`avg ${formatMs(sum.avgMs)}`)
  if (sum.p95Ms !== undefined) parts.push(`p95 ${formatMs(sum.p95Ms)}`)
  if (sum.tokPerSec !== undefined) parts.push(`${Math.round(sum.tokPerSec)} tok/s`)
  return [parts.join(' · ')]
}

export const statusText = (i: StatusInput): string =>
  [
    'rmod',
    line('Ollama', i.ollama, i.ollamaUrl, i.ollamaExposed ? ['OLLAMA_HOST listens on all interfaces'] : []),
    line('LM Studio', i.lmstudio, i.lmstudioUrl, i.lmstudioEndpoint === 'openai' ? ['OpenAI-compatible API (older LM Studio)'] : []),
    ...sessionLine(i),
  ].join('\n')
