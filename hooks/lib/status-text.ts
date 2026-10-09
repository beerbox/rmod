// The plain-text status that /rmod-status returns (FR-3.7, NFR-5). Pure: no `$`.
// Glyph + word for every state, so the meaning never depends on colour.

import type { BackendStatus, Health, LmStudioEndpoint, ProbeError } from '../../types'

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
}

export const statusText = (i: StatusInput): string =>
  [
    'rmod',
    line('Ollama', i.ollama, i.ollamaUrl, i.ollamaExposed ? ['OLLAMA_HOST listens on all interfaces'] : []),
    line('LM Studio', i.lmstudio, i.lmstudioUrl, i.lmstudioEndpoint === 'openai' ? ['OpenAI-compatible API (older LM Studio)'] : []),
  ].join('\n')
