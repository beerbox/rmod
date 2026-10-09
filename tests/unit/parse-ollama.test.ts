import { describe, expect, test } from 'claude-code/testing'

import { parseJson } from '../../hooks/lib/models'
import { mergeOllama, parsePs, parseTags, parseVersion } from '../../hooks/lib/parse-ollama'
import { OLLAMA_PS, OLLAMA_PS_EMPTY, OLLAMA_TAGS, OLLAMA_TAGS_EMPTY, OLLAMA_VERSION } from '../fixtures'

describe('parse-ollama', () => {
  test('FR-1.3 parseVersion reads the 0.40.2 fixture', () => {
    expect(parseVersion(parseJson(OLLAMA_VERSION))).toBe('0.40.2')
  })

  test('FR-1.3 parseVersion rejects missing, non-string, oversized or odd versions', () => {
    for (const body of [undefined, null, {}, { version: 1 }, { version: '' }, { version: 'x'.repeat(33) }, { version: '1.0\n' }, { version: '<b>1</b>' }, []]) {
      expect(parseVersion(body)).toBeUndefined()
    }
    expect(parseVersion({ version: '0.12.0-rc1+build.5' })).toBe('0.12.0-rc1+build.5')
  })

  test('FR-5.1 parseTags reads the 0.40.2 fixture, treating MLX empty strings as unknown', () => {
    const r = parseTags(parseJson(OLLAMA_TAGS))
    expect(r?.truncated).toBe(0)
    expect(r?.models.map(m => m.id)).toEqual(['gemma4:12b-mlx', 'llama3.2:3b', 'nomic-embed-text:latest'])
    expect(r?.models[0]).toEqual({ id: 'gemma4:12b-mlx', loaded: false, sizeBytes: 6773358208, kind: 'llm' })
    expect(r?.models[1]).toEqual({ id: 'llama3.2:3b', loaded: false, sizeBytes: 2019393189, params: '3.2B', quant: 'Q4_K_M', kind: 'llm' })
    expect(r?.models[2]?.kind).toBe('embedding')
  })

  test('FR-5.1 parseTags reads an empty inventory', () => {
    expect(parseTags(parseJson(OLLAMA_TAGS_EMPTY))).toEqual({ models: [], truncated: 0 })
  })

  test('FR-5.1 parsePs reads loaded model names, and an empty list', () => {
    expect(parsePs(parseJson(OLLAMA_PS))).toEqual(['llama3.2:3b'])
    expect(parsePs(parseJson(OLLAMA_PS_EMPTY))).toEqual([])
  })

  test('FR-5.1 mergeOllama marks loaded models, sorts them first and adds loaded-only ones', () => {
    const ps = { models: [{ name: 'llama3.2:3b' }, { name: 'only-in-ps:7b' }] }
    const merged = mergeOllama(parseJson(OLLAMA_TAGS), ps)
    expect(merged?.models.map(m => [m.id, m.loaded])).toEqual([
      ['llama3.2:3b', true],
      ['only-in-ps:7b', true],
      ['gemma4:12b-mlx', false],
      ['nomic-embed-text:latest', false],
    ])
    expect(merged?.models[0]).toEqual({ id: 'llama3.2:3b', loaded: true, sizeBytes: 2019393189, params: '3.2B', quant: 'Q4_K_M', kind: 'llm' })
  })

  test('FR-5.1 mergeOllama with the real fixtures: nothing loaded', () => {
    const merged = mergeOllama(parseJson(OLLAMA_TAGS), parseJson(OLLAMA_PS_EMPTY))
    expect(merged?.models.every(m => m.loaded === false)).toBe(true)
  })

  test('FR-5.1 mergeOllama reports loaded as unknown when /api/ps is unreadable', () => {
    const merged = mergeOllama(parseJson(OLLAMA_TAGS), parseJson('Internal Server Error'))
    expect(merged?.models.length).toBe(3)
    expect(merged?.models.every(m => m.loaded === null)).toBe(true)
  })

  test('FR-5.4 mergeOllama is unreadable when /api/tags is, whatever /api/ps says', () => {
    expect(mergeOllama({ models: 'x' }, parseJson(OLLAMA_PS))).toBeUndefined()
  })

  test('FR-5.4 a body of the wrong shape is unreadable, not an empty list', () => {
    for (const body of [undefined, null, 'text', 42, [], {}, { models: 'x' }, { models: {} }]) {
      expect(parseTags(body)).toBeUndefined()
      expect(parsePs(body)).toBeUndefined()
    }
    expect(parseJson('{"models": [')).toBeUndefined()
    expect(parseJson('Ollama is running')).toBeUndefined()
  })

  test('FR-5.4 bad entries are skipped and the rest kept', () => {
    const r = parseTags({
      models: [null, 7, { name: '' }, { name: 42 }, { model: 'no-name-field' }, { name: 'ok:1b', size: -5 }, { name: 'ok:1b', size: 1 }],
    })
    expect(r?.models).toEqual([{ id: 'ok:1b', loaded: false }])
  })

  test('NFR-1 untrusted strings are clamped and stripped of control and bidi characters', () => {
    const r = parseTags({
      models: [
        { name: `${'a'.repeat(250)}`, details: { parameter_size: 'p'.repeat(40), quantization_level: 'Q4‮' } },
        { name: 'evil\u001b[31m⁦name', size: 1e30 },
      ],
    })
    expect(r?.models[0]?.id.length).toBe(200)
    expect(r?.models[0]?.params).toBeUndefined()
    expect(r?.models[0]?.quant).toBe('Q4')
    expect(r?.models[1]).toEqual({ id: 'evil[31mname', loaded: false })
  })

  test('NFR-3 more than 200 models are capped with a +N more count, loaded ones kept and counted once', () => {
    const many = { models: Array.from({ length: 250 }, (_, i) => ({ name: `m${String(i).padStart(3, '0')}` })) }
    const tags = parseTags(many)
    expect(tags?.models.length).toBe(200)
    expect(tags?.truncated).toBe(50)
    const merged = mergeOllama(many, { models: [{ name: 'm249' }] })
    expect(merged?.models[0]).toEqual({ id: 'm249', loaded: true })
    expect(merged?.models.length).toBe(200)
    expect(merged?.truncated).toBe(50)
  })

  test('NFR-3 a huge list is scanned only up to a bound and the rest counted', () => {
    const huge = { models: Array.from({ length: 20000 }, (_, i) => ({ name: `m${i}` })) }
    const r = parseTags(huge)
    expect(r?.models.length).toBe(200)
    expect(r?.truncated).toBe(19800)
  })

  test('NFR-1 duplicate and prototype-like names are handled as plain data', () => {
    const r = parseTags({ models: [{ name: '__proto__' }, { name: 'constructor' }, { name: 'constructor' }] })
    expect(r?.models.map(m => m.id)).toEqual(['__proto__', 'constructor'])
  })

  test('NFR-1 invisible, line-breaking and tag characters are stripped; cuts never split a code point', () => {
    const r = parseTags({
      models: [
        { name: 'tag\u{E0041}\u{E0042}ged' },
        { name: 'line\u2028sep\u2029x' },
        { name: 'soft\u00adhy\u2060ph\u061cen\u180e' },
        { name: 'pua\ue000x\ufff9y' },
        { name: `${'a'.repeat(199)}\u{1F600}tail` },
      ],
    })
    expect(r?.models.map(m => m.id)).toEqual(['a'.repeat(199) + '\u{1F600}', 'linesepx', 'puaxy', 'softhyphen', 'tagged'])
  })

  test('NFR-3 parseJson accepts a body just under 4 MB and rejects one just over', () => {
    const pad = (n: number) => `{"models":[],"pad":"${'x'.repeat(n - 22)}"}`
    expect(pad(4_000_000).length).toBe(4_000_000)
    expect(parseJson(pad(4_000_000))).toBeDefined()
    expect(parseJson(pad(4_000_001))).toBeUndefined()
  })

  test('FR-5.1 remote (cloud) models are not listed as local, and their host is never kept', () => {
    const r = parseTags({ models: [{ name: 'gpt-oss:120b-cloud', remote_model: 'gpt-oss:120b', remote_host: 'https://ollama.example' }, { name: 'local:1b' }] })
    expect(r?.models).toEqual([{ id: 'local:1b', loaded: false }])
  })

  test('FR-5.1 loaded models carry VRAM and expiry from /api/ps; tags keep their disk size', () => {
    const merged = mergeOllama(parseJson(OLLAMA_TAGS), parseJson(OLLAMA_PS))
    expect(merged?.models[0]).toEqual({
      id: 'llama3.2:3b',
      loaded: true,
      sizeBytes: 2019393189,
      params: '3.2B',
      quant: 'Q4_K_M',
      kind: 'llm',
      vramBytes: 3155164160,
      expiresAt: Date.UTC(2026, 9, 9, 11, 20, 0),
    })
  })

  test('FR-5.1 a ps-only model takes its size from /api/ps; a bad expiry is dropped', () => {
    const merged = mergeOllama({ models: [] }, { models: [{ name: 'p:1b', size: 100, size_vram: 50, expires_at: 'soon' }] })
    expect(merged?.models).toEqual([{ id: 'p:1b', loaded: true, sizeBytes: 100, vramBytes: 50 }])
  })

  test('FR-5.1 on a duplicate id the loaded copy wins', () => {
    const merged = mergeOllama({ models: [{ name: 'd:1b' }, { name: 'd:1b' }] }, { models: [{ name: 'd:1b' }] })
    expect(merged?.models).toEqual([{ id: 'd:1b', loaded: true }])
  })

  test('NFR-1 __proto__ as a JSON key never leaks inherited values', () => {
    const body = parseJson('{"__proto__":{"models":[{"name":"x"}]},"models":[{"name":"__proto__","details":{"__proto__":{"parameter_size":"9B"}}}]}')
    const r = parseTags(body)
    expect(r?.models).toEqual([{ id: '__proto__', loaded: false }])
    expect(({} as Record<string, unknown>)['models']).toBeUndefined()
  })
})
