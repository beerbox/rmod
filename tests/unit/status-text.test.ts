import { describe, expect, test } from 'claude-code/testing'

import { initialStatus } from '../../hooks/lib/probe'
import { statusText } from '../../hooks/lib/status-text'
import type { BackendStatus } from '../../types'

const base = { ollamaUrl: 'http://127.0.0.1:11434', lmstudioUrl: 'http://127.0.0.1:1234', ollamaExposed: false, lmstudioEndpoint: null }
const s = (over: Partial<BackendStatus>): BackendStatus => ({ ...initialStatus(), ...over })

describe('status-text', () => {
  test('FR-3.7 NFR-5 every state has a glyph and a word', () => {
    const text = statusText({ ...base, ollama: s({ health: 'up', version: '0.40.2', probeMs: 11.6 }), lmstudio: s({ health: 'down', error: 'timeout' }) })
    expect(text).toBe('rmod\nOllama: ✓ up · v0.40.2 · 12 ms · http://127.0.0.1:11434\nLM Studio: ✗ not listening (no answer in time) · http://127.0.0.1:1234')
  })

  test('FR-3.7 auth, degraded, checking and off read as words too', () => {
    expect(statusText({ ...base, ollama: s({ health: 'auth', probeMs: 3 }), lmstudio: s({ health: 'degraded', error: 'parse', probeMs: 4 }) })).toBe(
      'rmod\nOllama: ⚠ up, auth required · 3 ms · http://127.0.0.1:11434\nLM Studio: ⚠ degraded (unreadable response) · 4 ms · http://127.0.0.1:1234',
    )
    expect(statusText({ ...base, ollama: s({}), lmstudio: s({ health: 'off' }) })).toBe('rmod\nOllama: … checking · http://127.0.0.1:11434\nLM Studio: – off')
  })

  test('FR-1.1 FR-2.2 exposure and the fallback endpoint are noted', () => {
    const text = statusText({ ...base, ollamaExposed: true, lmstudioEndpoint: 'openai', ollama: s({ health: 'up' }), lmstudio: s({ health: 'up' }) })
    expect(text).toContain('OLLAMA_HOST listens on all interfaces')
    expect(text).toContain('OpenAI-compatible API')
  })
})
