// Ollama response parsers (FR-1.3, FR-5.1, FR-5.4). Pure: no `$`. Input is untrusted JSON.
// Shapes: docs/LOCAL_SERVERS.md (verified against Ollama 0.40.2).

import type { ModelInfo } from '../../types'
import { cleanBytes, cleanId, cleanShort, cleanTime, finalize, isRecord, listAt, MAX_MODELS, modelInfo } from './models'
import type { ModelList } from './models'

/** `GET /api/version` → `{ version }`. Undefined unless it is a plain version string of at most 32 characters. */
export const parseVersion = (body: unknown): string | undefined => {
  if (!isRecord(body)) return undefined
  const v = body['version']
  return typeof v === 'string' && /^[0-9A-Za-z.+_-]{1,32}$/.test(v) ? v : undefined
}

const kindOf = (capabilities: unknown): ModelInfo['kind'] => {
  if (!Array.isArray(capabilities)) return undefined
  const caps: readonly unknown[] = capabilities
  return caps.includes('embedding') ? 'embedding' : 'llm'
}

/** The tag entries before dedupe and cap, so a merge with `/api/ps` caps only once. */
const tagEntries = (body: unknown): { models: ModelInfo[]; unscanned: number } | undefined => {
  const list = listAt(body, 'models')
  if (list === undefined) return undefined
  const models: ModelInfo[] = []
  for (const entry of list.items) {
    if (!isRecord(entry)) continue
    // Cloud models (remote_host set) are not local: out of scope (SPEC §5). The host is never stored.
    if (typeof entry['remote_host'] === 'string') continue
    const id = cleanId(entry['name'])
    if (id === undefined) continue
    const details = isRecord(entry['details']) ? entry['details'] : {}
    models.push(
      modelInfo(id, false, {
        sizeBytes: cleanBytes(entry['size']),
        // MLX models report these as "": cleanShort turns that into unknown.
        params: cleanShort(details['parameter_size']),
        quant: cleanShort(details['quantization_level']),
        kind: kindOf(entry['capabilities']),
      }),
    )
  }
  return { models, unscanned: list.unscanned }
}

/** `GET /api/tags` → available models, all `loaded: false`. */
export const parseTags = (body: unknown): ModelList | undefined => {
  const t = tagEntries(body)
  return t === undefined ? undefined : finalize(t.models, t.unscanned)
}

type Loaded = { sizeBytes?: number; vramBytes?: number; expiresAt?: number }

/** `/api/ps` entries by name (at most MAX_MODELS), with their memory figures. */
const psEntries = (body: unknown): Map<string, Loaded> | undefined => {
  const list = listAt(body, 'models')
  if (list === undefined) return undefined
  const loaded = new Map<string, Loaded>()
  for (const entry of list.items) {
    if (loaded.size >= MAX_MODELS) break
    if (!isRecord(entry)) continue
    const id = cleanId(entry['name'])
    if (id === undefined || loaded.has(id)) continue
    loaded.set(id, {
      sizeBytes: cleanBytes(entry['size']),
      vramBytes: cleanBytes(entry['size_vram']),
      expiresAt: cleanTime(entry['expires_at']),
    })
  }
  return loaded
}

/** `GET /api/ps` → names of the models loaded in memory (at most MAX_MODELS). */
export const parsePs = (body: unknown): string[] | undefined => {
  const loaded = psEntries(body)
  return loaded === undefined ? undefined : [...loaded.keys()]
}

/**
 * The Ollama inventory from the `/api/tags` and `/api/ps` bodies. Undefined when the tags are
 * unreadable (FR-5.4). An unreadable `/api/ps` makes every loaded state unknown. Loaded models
 * missing from the tags are added. Loaded models sort first, so the cap never drops one.
 */
export const mergeOllama = (tagsBody: unknown, psBody: unknown): ModelList | undefined => {
  const tags = tagEntries(tagsBody)
  if (tags === undefined) return undefined
  const loaded = psEntries(psBody)
  if (loaded === undefined) return finalize(tags.models.map(m => ({ ...m, loaded: null })), tags.unscanned)
  const merged: ModelInfo[] = tags.models.map(m => {
    const ps = loaded.get(m.id)
    // Keep the tags' disk size; /api/ps `size` is the in-memory size and is used only for ps-only models.
    return ps === undefined ? { ...m, loaded: false } : modelInfo(m.id, true, { ...m, vramBytes: ps.vramBytes, expiresAt: ps.expiresAt })
  })
  const known = new Set(tags.models.map(m => m.id))
  let psOnly = 0
  for (const [id, ps] of loaded) {
    if (known.has(id)) continue
    merged.push(modelInfo(id, true, ps))
    psOnly += 1
  }
  // A ps-only model may sit in the unscanned tail of the tags: don't count it twice.
  return finalize(merged, Math.max(0, tags.unscanned - psOnly))
}
