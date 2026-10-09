import { describe, expect, test } from 'claude-code/testing'

import { applyInventory, inventoryDue, ollamaInventory, sameInventory } from '../../hooks/lib/inventory'
import { formatBytes, modelRows } from '../../hooks/lib/model-list'
import { initialStatus, lmstudioProbe } from '../../hooks/lib/probe'
import type { ProbeOutcome } from '../../hooks/lib/probe'
import { LMSTUDIO_API_V1_MODELS, LMSTUDIO_V1_MODELS, OLLAMA_PS, OLLAMA_PS_EMPTY, OLLAMA_TAGS } from '../fixtures'

const ok = (text: string, status = 200): ProbeOutcome => ({ kind: 'response', status, text, ms: 5 })

describe('inventory', () => {
  test('FR-5.1 the Ollama inventory merges /api/tags with /api/ps, loaded first', () => {
    const r = ollamaInventory(ok(OLLAMA_TAGS), ok(OLLAMA_PS))
    expect('models' in r && r.models.models.map(m => [m.id, m.loaded])).toEqual([
      ['llama3.2:3b', true],
      ['gemma4:12b-mlx', false],
      ['nomic-embed-text:latest', false],
    ])
  })

  test('FR-5.1 a failed /api/ps leaves loaded unknown; a failed /api/tags is an error kind', () => {
    const r = ollamaInventory(ok(OLLAMA_TAGS), { kind: 'timeout' })
    expect('models' in r && r.models.models.every(m => m.loaded === null)).toBe(true)
    expect(ollamaInventory({ kind: 'timeout' }, ok(OLLAMA_PS))).toEqual({ error: 'timeout' })
    expect(ollamaInventory({ kind: 'rejected', message: 'ECONNREFUSED' }, ok(OLLAMA_PS))).toEqual({ error: 'refused' })
    expect(ollamaInventory(ok('', 500), ok(OLLAMA_PS))).toEqual({ error: 'http' })
    expect(ollamaInventory(ok('{"models":"x"}'), ok(OLLAMA_PS_EMPTY))).toEqual({ error: 'parse' })
  })

  test('FR-5.1 LM Studio models come with the probe: native has loaded state, the fallback has ids only', () => {
    const native = lmstudioProbe(ok(LMSTUDIO_API_V1_MODELS), 'native', false)
    expect(native.models?.models.length).toBe(4)
    expect(native.models?.models[0]).toMatchObject({ id: 'qwen/qwen3-8b', loaded: true })
    const fallback = lmstudioProbe(ok(LMSTUDIO_V1_MODELS), 'openai', false)
    expect(fallback.models?.models.every(m => m.loaded === null)).toBe(true)
    expect(lmstudioProbe(ok('', 401), 'native', false).models).toBeUndefined()
  })

  test('FR-5.4 an unreadable inventory keeps the last good list and records the error', () => {
    const good = applyInventory(initialStatus(), { models: { models: [{ id: 'a', loaded: true }], truncated: 0 } }, 1000)
    expect(good).toMatchObject({ models: [{ id: 'a', loaded: true }], modelsTruncated: 0, modelsAt: 1000 })
    expect(good.modelsError).toBeUndefined()
    const bad = applyInventory(good, { error: 'parse' }, 2000)
    expect(bad).toMatchObject({ models: [{ id: 'a', loaded: true }], modelsAt: 1000, modelsError: 'parse' })
    const again = applyInventory(bad, { models: { models: [], truncated: 0 } }, 3000)
    expect(again.modelsError).toBeUndefined()
    expect(again.modelsAt).toBe(3000)
  })

  test('FR-5.1 the inventory is due on first sight, when a backend comes up, on the interval, and on demand', () => {
    const fresh = initialStatus()
    const seen = { ...fresh, modelsAt: 1000 }
    expect(inventoryDue(fresh, undefined, 0, 30_000, false, false)).toBe(true)
    expect(inventoryDue(seen, 1000, 30_999, 30_000, false, false)).toBe(false)
    expect(inventoryDue(seen, 1000, 31_000, 30_000, false, false)).toBe(true)
    expect(inventoryDue(seen, 1000, 2000, 30_000, true, false)).toBe(true)
    expect(inventoryDue(seen, 1000, 2000, 30_000, false, true)).toBe(true)
    // State fresh after /clear: fetch again at once.
    expect(inventoryDue(fresh, 1000, 2000, 30_000, false, false)).toBe(true)
    // After a failed attempt, wait for the interval rather than retrying every probe.
    expect(inventoryDue({ ...fresh, modelsError: 'parse' }, 1000, 2000, 30_000, false, false)).toBe(false)
  })

  test('NFR-3 an unchanged inventory is recognised so state is not rewritten every probe', () => {
    const a = { ...initialStatus(), models: [{ id: 'a', loaded: true }], modelsTruncated: 0 }
    expect(sameInventory(a, { models: [{ id: 'a', loaded: true }], truncated: 0 })).toBe(true)
    expect(sameInventory(a, { models: [{ id: 'a', loaded: false }], truncated: 0 })).toBe(false)
    expect(sameInventory(a, { models: [{ id: 'a', loaded: true }], truncated: 1 })).toBe(false)
  })
})

describe('model-list', () => {
  test('FR-5.3 rows: loaded ● first, available ○, size, parameters, quantization and kind where known', () => {
    const r = ollamaInventory(ok(OLLAMA_TAGS), ok(OLLAMA_PS))
    const rows = modelRows('models' in r ? r.models.models : [], 0, () => 0)
    expect(rows).toEqual([
      { marker: '●', name: 'llama3.2:3b', detail: '2.0 GB · 3.2B · Q4_K_M · 3.2 GB VRAM', requests: 0 },
      { marker: '○', name: 'gemma4:12b-mlx', detail: '6.8 GB', requests: 0 },
      { marker: '○', name: 'nomic-embed-text:latest', detail: '274 MB · 137M · F16 · embedding', requests: 0 },
    ])
  })

  test('FR-5.3 unknown loaded state, session request counts, and +N more', () => {
    const rows = modelRows([{ id: 'x', loaded: null }], 12, id => (id === 'x' ? 3 : 0))
    expect(rows).toEqual([
      { marker: '◌', name: 'x', detail: '', requests: 3 },
      { marker: '', name: '+12 more', detail: '', requests: 0 },
    ])
  })

  test('FR-5.3 sizes read as MB under a gigabyte and GB above', () => {
    expect(formatBytes(274_302_450)).toBe('274 MB')
    expect(formatBytes(6_773_358_208)).toBe('6.8 GB')
    expect(formatBytes(512)).toBe('1 MB')
  })
})
