// Parses and validates the mod's userConfig options (FR-6.2, FR-6.3). Pure: no `$`.
//
// Every invalid field falls back to its default and adds one warning line that
// names the field and the rule, never the rejected value (it could be a secret
// pasted into the wrong field). The LM Studio token is returned apart from
// Config, so Config can be logged or compared without leaking it.

import { guardBaseUrl, normalizeOllamaHost, portOf } from './url-guard'

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'
export const DEFAULT_LMSTUDIO_URL = 'http://127.0.0.1:1234'
/**
 * An MCP tool whose server name (the part between `mcp__` and the next `__`) contains "ollama" or
 * "lm studio" (lmstudio, lm-studio, lm_studio) in any letter case. Server names may hold single
 * underscores (plugin servers are `mcp__plugin_<plugin>_<server>__<tool>`).
 */
export const DEFAULT_MCP_PATTERN = '^mcp__(?:[A-Za-z0-9-]|_(?!_))*(?:[Oo][Ll][Ll][Aa][Mm][Aa]|[Ll][Mm][-_]?[Ss][Tt][Uu][Dd][Ii][Oo])(?:[A-Za-z0-9-]|_(?!_))*__'

const MAX_PATTERN_LENGTH = 200
const MAX_TOKEN_LENGTH = 4096
/**
 * Heuristic ReDoS guard for user patterns, which run on every MCP tool call (NFR-2):
 * a quantified group that itself holds a quantifier (`(a+)+`, `(x*){2,}`) or a backreference.
 */
const RISKY_PATTERN = /\([^)]*[+*}][^)]*\)\s*[+*{]|\\[1-9]|\\k</

export type Config = {
  enableOllama: boolean
  enableLmStudio: boolean
  showBand: boolean
  ollamaUrl: string
  /** Where ollamaUrl came from: the user's setting, OLLAMA_HOST, or the built-in default. */
  ollamaSource: 'config' | 'env' | 'default'
  /** OLLAMA_HOST binds all interfaces (0.0.0.0); rmod still probes 127.0.0.1. */
  ollamaExposed: boolean
  lmstudioUrl: string
  pollMs: number
  probeTimeoutMs: number
  modelsRefreshMs: number
  /** Compiled without flags, so `test` keeps no lastIndex state. */
  mcpPattern: RegExp
}

export type ParsedConfig = {
  config: Config
  /** The LM Studio API token, trimmed; undefined when unset or unusable. */
  token: string | undefined
  warnings: string[]
}

type Options = Readonly<Record<string, unknown>>

const bool = (o: Options, key: string, fallback: boolean, warn: (m: string) => void): boolean => {
  const v = o[key]
  if (v === undefined) return fallback
  if (typeof v === 'boolean') return v
  warn(`rmod: ${key} must be true or false; using ${String(fallback)}`)
  return fallback
}

const num = (o: Options, key: string, min: number, max: number, fallback: number, warn: (m: string) => void): number => {
  const v = o[key]
  if (v === undefined) return fallback
  if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return v
  warn(`rmod: ${key} must be a number from ${min} to ${max}; using ${fallback}`)
  return fallback
}

/** A configured string, trimmed; undefined when unset or blank (blank is never an error). */
const str = (o: Options, key: string, warn: (m: string) => void): string | undefined => {
  const v = o[key]
  if (v === undefined) return undefined
  if (typeof v !== 'string') {
    warn(`rmod: ${key} must be text; using the default`)
    return undefined
  }
  const t = v.trim()
  return t === '' ? undefined : t
}

/** A configured base URL: `base` when valid, `rejected` when set but not loopback; neither when blank. */
const urlField = (o: Options, key: string, fallback: string, warn: (m: string) => void): { base?: string; rejected: boolean } => {
  const raw = str(o, key, warn)
  if (raw === undefined) return { rejected: false }
  const g = guardBaseUrl(raw)
  if (g.ok) return { base: g.base, rejected: false }
  warn(`rmod: ${key} rejected (${g.reason}); using ${fallback}`)
  return { rejected: true }
}

const pattern = (o: Options, warn: (m: string) => void): RegExp => {
  const fallback = new RegExp(DEFAULT_MCP_PATTERN)
  const raw = str(o, 'localMcpToolPattern', warn)
  if (raw === undefined) return fallback
  const why =
    raw.length > MAX_PATTERN_LENGTH
      ? `longer than ${MAX_PATTERN_LENGTH} characters`
      : /^\/.*\/[a-z]*$/.test(raw)
        ? 'write it without slashes or flags'
        : RISKY_PATTERN.test(raw)
          ? 'nested quantifiers and backreferences are not allowed'
          : undefined
  if (why === undefined) {
    try {
      return new RegExp(raw)
    } catch {
      warn('rmod: localMcpToolPattern is not a valid regular expression; using the default')
      return fallback
    }
  }
  warn(`rmod: localMcpToolPattern rejected (${why}); using the default`)
  return fallback
}

const tokenOf = (o: Options, warn: (m: string) => void): string | undefined => {
  const v = o['lmstudioApiToken']
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  if (t === '') return undefined
  if (t.length > MAX_TOKEN_LENGTH || !/^[\x21-\x7e]+$/.test(t)) {
    warn('rmod: lmstudioApiToken is not usable (too long, or not printable ASCII); sending no token')
    return undefined
  }
  return t
}

/** The config rmod uses when nothing else can be read: the manifest's defaults. */
export const defaultConfig = (): Config => parseConfig({}, undefined).config

/**
 * @param options what register() received (manifest defaults filled in by the loader)
 * @param ollamaHostEnv the OLLAMA_HOST environment value, if any
 */
export const parseConfig = (options: Options, ollamaHostEnv: string | undefined): ParsedConfig => {
  const warnings: string[] = []
  const warn = (m: string) => {
    warnings.push(m)
  }

  const enableOllama = bool(options, 'enableOllama', true, warn)
  const enableLmStudio = bool(options, 'enableLmStudio', true, warn)
  const showBand = bool(options, 'showBand', true, warn)

  let ollamaUrl = DEFAULT_OLLAMA_URL
  let ollamaSource: Config['ollamaSource'] = 'default'
  let ollamaExposed = false
  const ollamaField = urlField(options, 'ollamaUrl', DEFAULT_OLLAMA_URL, warn)
  if (ollamaField.base !== undefined) {
    ollamaUrl = ollamaField.base
    ollamaSource = 'config'
  } else if (!ollamaField.rejected && ollamaHostEnv !== undefined && ollamaHostEnv.trim() !== '') {
    const env = normalizeOllamaHost(ollamaHostEnv)
    if (env !== undefined) {
      ollamaUrl = env.url
      ollamaSource = 'env'
      ollamaExposed = env.exposed
    } else {
      warn(`rmod: OLLAMA_HOST is not a loopback address; probing ${DEFAULT_OLLAMA_URL}`)
    }
  }

  const lmField = urlField(options, 'lmstudioUrl', DEFAULT_LMSTUDIO_URL, warn)
  const lmstudioUrl = lmField.base ?? DEFAULT_LMSTUDIO_URL
  if (enableOllama && enableLmStudio && portOf(ollamaUrl) === portOf(lmstudioUrl)) {
    warn('rmod: ollamaUrl and lmstudioUrl use the same port; requests to it count as Ollama')
  }

  const config: Config = {
    enableOllama,
    enableLmStudio,
    showBand,
    ollamaUrl,
    ollamaSource,
    ollamaExposed,
    lmstudioUrl,
    pollMs: num(options, 'pollIntervalSec', 2, 300, 5, warn) * 1000,
    probeTimeoutMs: num(options, 'probeTimeoutMs', 200, 10000, 1500, warn),
    modelsRefreshMs: num(options, 'modelsRefreshSec', 10, 3600, 30, warn) * 1000,
    mcpPattern: pattern(options, warn),
  }

  let token = tokenOf(options, warn)
  if (token !== undefined && lmField.rejected) {
    // The token was meant for the server the user named, not whatever answers on the default port.
    warn('rmod: lmstudioApiToken not sent because lmstudioUrl was rejected')
    token = undefined
  }
  return { config, token, warnings }
}
