// Classifies health probes (FR-1, FR-2). Pure: no `$`; register.tsx does the fetch and the timeout race.
//
// Server text and rejection messages are untrusted and may hold URLs: they are only classified,
// never kept. What reaches state is rmod's own Health and ProbeError words.

import type { BackendStatus, Health, LmStudioEndpoint, ProbeError } from '../../types'
import { parseJson } from './models'
import { parseVersion } from './parse-ollama'
import { parseOpenAiModels, parseV1Models } from './parse-lmstudio'

/** What one probe came to: a response (any status), a rejected fetch, or no answer in time. */
export type ProbeOutcome =
  | { kind: 'response'; status: number; text: string; ms: number }
  | { kind: 'rejected'; message: string }
  | { kind: 'timeout' }

export type ProbeResult = { health: Health; error?: ProbeError; version?: string; probeMs?: number }

export const initialStatus = (): BackendStatus => ({ health: 'unknown', models: [], modelsTruncated: 0 })

/** A rejected fetch: an organization's web-fetch policy, or nothing reachable there. */
export const classifyRejection = (message: string): ProbeError => (/polic/i.test(message) ? 'policy' : 'refused')

const notListening = (o: Exclude<ProbeOutcome, { kind: 'response' }>): ProbeResult =>
  o.kind === 'timeout' ? { health: 'down', error: 'timeout' } : { health: 'down', error: classifyRejection(o.message) }

/** Any HTTP answer means listening (SPEC §2): 2xx up, 401/403 auth required, anything else degraded. */
const byStatus = (status: number, probeMs: number): ProbeResult | undefined => {
  if (status === 401 || status === 403) return { health: 'auth', probeMs }
  if (status < 200 || status > 299) return { health: 'degraded', error: 'http', probeMs }
  return undefined
}

/** `GET /api/version` (FR-1.2, FR-1.3). */
export const ollamaProbe = (o: ProbeOutcome): ProbeResult => {
  if (o.kind !== 'response') return notListening(o)
  const bad = byStatus(o.status, o.ms)
  if (bad !== undefined) return bad
  const version = parseVersion(parseJson(o.text))
  return version === undefined ? { health: 'degraded', error: 'parse', probeMs: o.ms } : { health: 'up', version, probeMs: o.ms }
}

export type LmStudioStep = {
  result: ProbeResult
  /** `fallback`: try `/v1/models` (FR-2.2). `retryWithToken`: ask again with the token, if one is set (FR-2.3). */
  next: 'done' | 'fallback' | 'retryWithToken'
}

/** `GET /api/v1/models` (native) or `GET /v1/models` (fallback) (FR-2). */
export const lmstudioProbe = (o: ProbeOutcome, endpoint: Exclude<LmStudioEndpoint, null>, tokenSent: boolean): LmStudioStep => {
  if (o.kind !== 'response') return { result: notListening(o), next: 'done' }
  if (o.status === 404 && endpoint === 'native') return { result: { health: 'degraded', error: 'http', probeMs: o.ms }, next: 'fallback' }
  const bad = byStatus(o.status, o.ms)
  if (bad !== undefined) return { result: bad, next: bad.health === 'auth' && !tokenSent ? 'retryWithToken' : 'done' }
  const body = parseJson(o.text)
  const list = endpoint === 'native' ? parseV1Models(body) : parseOpenAiModels(body)
  return { result: list === undefined ? { health: 'degraded', error: 'parse', probeMs: o.ms } : { health: 'up', probeMs: o.ms }, next: 'done' }
}

/** The new status after a probe: health fields replaced (stale version/error dropped), models kept. */
export const applyProbe = (prev: BackendStatus, r: ProbeResult, at: number): BackendStatus => {
  const next: BackendStatus = { health: r.health, checkedAt: at, models: prev.models, modelsTruncated: prev.modelsTruncated }
  if (r.version !== undefined) next.version = r.version
  if (r.probeMs !== undefined) next.probeMs = r.probeMs
  if (r.error !== undefined) next.error = r.error
  if (prev.modelsAt !== undefined) next.modelsAt = prev.modelsAt
  if (prev.modelsError !== undefined) next.modelsError = prev.modelsError
  return next
}
