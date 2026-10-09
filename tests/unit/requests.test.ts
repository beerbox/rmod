import { describe, expect, test } from 'claude-code/testing'

import { isBackgroundBash, isFirstOutput, stepSucceeded, toolOutcome, usageOf } from '../../hooks/lib/requests'
import { begin, cancel, emptyStats, end, reset } from '../../hooks/lib/stats'

describe('requests', () => {
  test('FR-4.2 time to first token ends at the first output chunk, not at the envelope or a stop', () => {
    for (const kind of ['text', 'thinking', 'tool', 'input']) expect(isFirstOutput({ kind })).toBe(true)
    for (const kind of ['engine', 'stop']) expect(isFirstOutput({ kind })).toBe(false)
  })

  test('FR-4.2 usage gives output tokens and the answering model; anything odd is ignored', () => {
    expect(usageOf({ input_tokens: 9, output_tokens: 120, model: 'llama3.2:3b' })).toEqual({ outTokens: 120, model: 'llama3.2:3b' })
    expect(usageOf(null)).toEqual({})
    expect(usageOf({ output_tokens: -1, model: '' })).toEqual({})
    expect(usageOf({ output_tokens: 1.5, model: 7 })).toEqual({})
  })

  test('FR-4.1 FR-4.2 a refused call is not a request; a tool error is a failure', () => {
    expect(toolOutcome({ result: 'ok' })).toBe('ok')
    expect(toolOutcome({ result: 'x', isError: true })).toBe('failed')
    expect(toolOutcome({ deny: 'no' })).toBe('refused')
    expect(toolOutcome(undefined)).toBe('failed')
  })

  test('FR-4.2 a step with no stop reason never got a response and is not a success', () => {
    expect(stepSucceeded({ stopReason: 'end_turn' })).toBe(true)
    expect(stepSucceeded({ stopReason: null })).toBe(false)
    expect(stepSucceeded(undefined)).toBe(false)
  })

  test('FR-4.3 FR-4.5 cancel takes back a begin; reset clears counts but keeps live requests', () => {
    expect(cancel(begin(emptyStats()))).toEqual(emptyStats())
    const s = begin(end(begin(emptyStats()), { kind: 'tool', ok: true, latencyMs: 5, at: 1 }))
    expect(reset(s)).toEqual({ ...emptyStats(), inFlight: 1 })
  })

  test('FR-4.1b background Bash is not counted', () => {
    expect(isBackgroundBash('Bash', { command: 'x', run_in_background: true })).toBe(true)
    expect(isBackgroundBash('Bash', { command: 'x' })).toBe(false)
    expect(isBackgroundBash('WebFetch', { run_in_background: true })).toBe(false)
  })
})
