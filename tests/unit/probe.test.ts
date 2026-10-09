import { describe, expect, test } from 'claude-code/testing'

import { applyProbe, classifyRejection, initialStatus, lmstudioProbe, ollamaProbe } from '../../hooks/lib/probe'
import type { ProbeOutcome } from '../../hooks/lib/probe'
import { LMSTUDIO_API_V1_MODELS, LMSTUDIO_V1_MODELS, OLLAMA_VERSION } from '../fixtures'

const ok = (text: string, status = 200, ms = 12): ProbeOutcome => ({ kind: 'response', status, text, ms })

describe('probe', () => {
  test('FR-1.3 a 2xx Ollama version probe is up with the version and round-trip time', () => {
    expect(ollamaProbe(ok(OLLAMA_VERSION))).toEqual({ health: 'up', version: '0.40.2', probeMs: 12 })
  })

  test('FR-1.2 refused, unreachable and timed-out probes are not listening', () => {
    expect(ollamaProbe({ kind: 'rejected', message: '$.http.fetch(http://127.0.0.1:11434/api/version) failed: ECONNREFUSED' })).toEqual({ health: 'down', error: 'refused' })
    expect(ollamaProbe({ kind: 'rejected', message: 'ENOTFOUND' })).toEqual({ health: 'down', error: 'refused' })
    expect(ollamaProbe({ kind: 'timeout' })).toEqual({ health: 'down', error: 'timeout' })
  })

  test('FR-1.2 a policy refusal is reported as policy, and the message is never kept', () => {
    expect(classifyRejection('refused by the organization web-fetch policy')).toBe('policy')
    const r = ollamaProbe({ kind: 'rejected', message: 'blocked by policy for http://127.0.0.1:11434 SECRET' })
    expect(r).toEqual({ health: 'down', error: 'policy' })
    expect(JSON.stringify(r)).not.toContain('SECRET')
  })

  test('FR-2.3 401 and 403 mean up but auth required; other statuses mean degraded', () => {
    expect(ollamaProbe(ok('', 401))).toEqual({ health: 'auth', probeMs: 12 })
    expect(ollamaProbe(ok('', 403))).toEqual({ health: 'auth', probeMs: 12 })
    expect(ollamaProbe(ok('oops', 500))).toEqual({ health: 'degraded', error: 'http', probeMs: 12 })
    expect(ollamaProbe(ok('', 404))).toEqual({ health: 'degraded', error: 'http', probeMs: 12 })
  })

  test('FR-1.3 a 2xx with an unreadable version is degraded, not up', () => {
    expect(ollamaProbe(ok('Ollama is running'))).toEqual({ health: 'degraded', error: 'parse', probeMs: 12 })
    expect(ollamaProbe(ok('{"version":"<script>"}'))).toEqual({ health: 'degraded', error: 'parse', probeMs: 12 })
  })

  test('FR-2.1 a 2xx native LM Studio probe is up', () => {
    expect(lmstudioProbe(ok(LMSTUDIO_API_V1_MODELS), 'native', false)).toEqual({ result: { health: 'up', probeMs: 12 }, next: 'done' })
  })

  test('FR-2.2 a native 404 asks for the OpenAI-compatible fallback; the fallback reads /v1/models', () => {
    expect(lmstudioProbe(ok('Not Found', 404), 'native', false).next).toBe('fallback')
    expect(lmstudioProbe(ok(LMSTUDIO_V1_MODELS), 'openai', false)).toEqual({ result: { health: 'up', probeMs: 12 }, next: 'done' })
    expect(lmstudioProbe(ok('Not Found', 404), 'openai', false)).toEqual({ result: { health: 'degraded', error: 'http', probeMs: 12 }, next: 'done' })
  })

  test('FR-2.3 a 401 without a token asks to retry with one; with a token it is auth required', () => {
    expect(lmstudioProbe(ok('{"error":"Unauthorized"}', 401), 'native', false)).toEqual({ result: { health: 'auth', probeMs: 12 }, next: 'retryWithToken' })
    expect(lmstudioProbe(ok('', 403), 'native', true)).toEqual({ result: { health: 'auth', probeMs: 12 }, next: 'done' })
  })

  test('FR-5.4 a 2xx LM Studio body of the wrong shape is degraded', () => {
    expect(lmstudioProbe(ok('{"models":"x"}'), 'native', false).result).toEqual({ health: 'degraded', error: 'parse', probeMs: 12 })
    expect(lmstudioProbe(ok('<html>'), 'openai', false).result).toEqual({ health: 'degraded', error: 'parse', probeMs: 12 })
  })

  test('FR-1.2 LM Studio not listening is down', () => {
    expect(lmstudioProbe({ kind: 'timeout' }, 'native', false)).toEqual({ result: { health: 'down', error: 'timeout' }, next: 'done' })
  })

  test('FR-1.3 applyProbe replaces the health fields, keeps the models and drops stale ones', () => {
    const prev = { ...initialStatus(), health: 'up' as const, version: '0.40.1', probeMs: 5, models: [{ id: 'a', loaded: false }], modelsTruncated: 2 }
    expect(applyProbe(prev, { health: 'down', error: 'refused' }, 1000)).toEqual({
      health: 'down',
      error: 'refused',
      checkedAt: 1000,
      models: [{ id: 'a', loaded: false }],
      modelsTruncated: 2,
    })
    expect(applyProbe(prev, { health: 'up', version: '0.40.2', probeMs: 9 }, 2000)).toMatchObject({ health: 'up', version: '0.40.2', probeMs: 9, checkedAt: 2000 })
  })

  test('FR-3.1 the initial status is unknown with no models', () => {
    expect(initialStatus()).toEqual({ health: 'unknown', models: [], modelsTruncated: 0 })
  })
})
