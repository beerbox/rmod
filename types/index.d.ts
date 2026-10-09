// rmod's $.state contract (docs/ARCHITECTURE.md §3). Self-contained: no imports.
// Bounds: latMs, ttftMs and models hold at most 200 entries; byModel at most 50 keys.

export type BackendId = 'ollama' | 'lmstudio'

export type Health = 'unknown' | 'up' | 'auth' | 'degraded' | 'down' | 'off'

/** rmod's own error kinds: never server or exception text (metadata only). */
export type ProbeError = 'refused' | 'timeout' | 'policy' | 'http' | 'parse' | 'config'

/** Which LM Studio endpoint answered (FR-2.2); null until known. */
export type LmStudioEndpoint = 'native' | 'openai' | null

export type ModelInfo = {
  id: string
  /** null when the backend can't say (LM Studio's OpenAI-compatible fallback). */
  loaded: boolean | null
  sizeBytes?: number
  params?: string
  quant?: string
  kind?: 'llm' | 'embedding'
}

export type BackendStatus = {
  health: Health
  version?: string
  probeMs?: number
  checkedAt?: number
  error?: ProbeError
  models: readonly ModelInfo[]
  modelsTruncated: number
  modelsAt?: number
  modelsError?: ProbeError
}

export type Stats = {
  total: number
  model: number
  tool: number
  inFlight: number
  ok: number
  failed: number
  latMs: readonly number[]
  ttftMs: readonly number[]
  outTokens: number
  genMs: number
  lastAt?: number
  /** Keyed by untrusted model ids: write with spreads/Object.fromEntries, never obj[id] =. */
  byModel: Readonly<Record<string, number>>
}

declare module 'claude-code' {
  interface PluginState {
    rmod: {
      ollama: BackendStatus
      lmstudio: BackendStatus
      statsOllama: Stats
      statsLmstudio: Stats
      bandHidden: boolean
      lmstudioEndpoint: LmStudioEndpoint
    }
  }
}
