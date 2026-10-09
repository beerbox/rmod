import { describe, expect, test } from 'claude-code/testing'

import { parseJson } from '../../hooks/lib/models'
import { parseOpenAiModels, parseV1Models } from '../../hooks/lib/parse-lmstudio'
import { LMSTUDIO_API_V1_MODELS, LMSTUDIO_API_V1_MODELS_EMPTY, LMSTUDIO_V1_MODELS } from '../fixtures'

describe('parse-lmstudio', () => {
  test('FR-5.1 parseV1Models reads the native fixture, loaded first', () => {
    const r = parseV1Models(parseJson(LMSTUDIO_API_V1_MODELS))
    expect(r?.truncated).toBe(0)
    expect(r?.models).toEqual([
      { id: 'qwen/qwen3-8b', loaded: true, sizeBytes: 5027783488, params: '8B', quant: 'Q4_K_M', kind: 'llm' },
      { id: 'example/tiny-1b', loaded: false, sizeBytes: 700000000, kind: 'llm' },
      { id: 'google/gemma-3-12b', loaded: false, sizeBytes: 8070000000, params: '12B', quant: '4bit', kind: 'llm' },
      { id: 'text-embedding-nomic-embed-text-v1.5', loaded: false, sizeBytes: 84106624, kind: 'embedding' },
    ])
  })

  test('FR-5.1 parseV1Models reads an empty inventory', () => {
    expect(parseV1Models(parseJson(LMSTUDIO_API_V1_MODELS_EMPTY))).toEqual({ models: [], truncated: 0 })
  })

  test('FR-5.1 parseOpenAiModels reads ids only, with loaded unknown', () => {
    const r = parseOpenAiModels(parseJson(LMSTUDIO_V1_MODELS))
    expect(r?.models.map(m => m.id)).toEqual(['google/gemma-3-12b', 'qwen/qwen3-8b', 'text-embedding-nomic-embed-text-v1.5'])
    expect(r?.models.every(m => m.loaded === null && Object.keys(m).length === 2)).toBe(true)
  })

  test('FR-5.4 a body of the wrong shape is unreadable', () => {
    for (const body of [undefined, null, [], {}, { models: 'x' }, { data: [] }, { error: 'Unauthorized' }]) {
      expect(parseV1Models(body)).toBeUndefined()
    }
    for (const body of [undefined, null, [], {}, { data: 'x' }, { models: [] }]) {
      expect(parseOpenAiModels(body)).toBeUndefined()
    }
  })

  test('FR-5.4 bad entries are skipped; odd field types become unknown', () => {
    const r = parseV1Models({
      models: [
        null,
        { key: '' },
        { display_name: 'no key' },
        { key: 'a/x', type: 'vision', loaded_instances: 'yes', quantization: 'Q4', size_bytes: 'big', params_string: 7 },
      ],
    })
    expect(r?.models).toEqual([{ id: 'a/x', loaded: null }])
  })

  test('NFR-3 more than 200 models are capped with a +N more count', () => {
    const many = { data: Array.from({ length: 230 }, (_, i) => ({ id: `m${i}` })) }
    const r = parseOpenAiModels(many)
    expect(r?.models.length).toBe(200)
    expect(r?.truncated).toBe(30)
  })
})
