// LM Studio response parsers (FR-2.2, FR-5.1, FR-5.4). Pure: no `$`. Input is untrusted JSON.
// Shapes: docs/LOCAL_SERVERS.md (lmstudio.ai/docs/developer/rest/list, 2026-10-09).

import type { ModelInfo } from '../../types'
import { cleanBytes, cleanId, cleanShort, finalize, isRecord, listAt, modelInfo } from './models'
import type { ModelList } from './models'

const kindOf = (type: unknown): ModelInfo['kind'] => (type === 'llm' || type === 'embedding' ? type : undefined)

const loadedOf = (instances: unknown): boolean | null => (Array.isArray(instances) ? instances.length > 0 : null)

/** `GET /api/v1/models` (native) → `{ models: [{ key, type, loaded_instances, ... }] }`. */
export const parseV1Models = (body: unknown): ModelList | undefined => {
  const list = listAt(body, 'models')
  if (list === undefined) return undefined
  const models: ModelInfo[] = []
  for (const entry of list.items) {
    if (!isRecord(entry)) continue
    const id = cleanId(entry['key'])
    if (id === undefined) continue
    const quantization = entry['quantization']
    models.push(
      modelInfo(id, loadedOf(entry['loaded_instances']), {
        sizeBytes: cleanBytes(entry['size_bytes']),
        params: cleanShort(entry['params_string']),
        quant: isRecord(quantization) ? cleanShort(quantization['name']) : undefined,
        kind: kindOf(entry['type']),
      }),
    )
  }
  return finalize(models, list.unscanned)
}

/** `GET /v1/models` (OpenAI-compatible fallback) → ids only; loaded is unknown. */
export const parseOpenAiModels = (body: unknown): ModelList | undefined => {
  const list = listAt(body, 'data')
  if (list === undefined) return undefined
  const models: ModelInfo[] = []
  for (const entry of list.items) {
    const id = isRecord(entry) ? cleanId(entry['id']) : undefined
    if (id !== undefined) models.push(modelInfo(id, null, {}))
  }
  return finalize(models, list.unscanned)
}
