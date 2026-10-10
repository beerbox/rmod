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
 * Words that mark an MCP server as local when its name (the part between `mcp__` and the next `__`)
 * contains one, in any letter case. Literal substrings, not a regular expression: matching costs
 * linear time whatever the person configures, so a tool call can never be held up (NFR-2).
 */
export const DEFAULT_MCP_SERVER_NAMES = 'ollama,lmstudio,lm-studio,lm_studio'

const MAX_TOKEN_LENGTH = 4096
const MAX_SERVER_NAMES = 10
/** Letters, digits, `-` and `_`: what an MCP server name can hold. */
const SERVER_WORD = /^[a-z0-9_-]{1,40}$/

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
  /** Lower-case words; an MCP server whose name contains one is local (FR-4.1b). */
  mcpServerNames: readonly string[]
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

const serverNames = (o: Options, warn: (m: string) => void): readonly string[] => {
  const fallback = DEFAULT_MCP_SERVER_NAMES.split(',')
  const raw = str(o, 'localMcpServerNames', warn)
  if (raw === undefined) return fallback
  const words = raw
    .toLowerCase()
    .split(',')
    .map(w => w.trim())
    .filter(w => w !== '')
  if (words.length === 0 || words.length > MAX_SERVER_NAMES || !words.every(w => SERVER_WORD.test(w))) {
    warn(`rmod: localMcpServerNames must be up to ${MAX_SERVER_NAMES} comma-separated words of letters, digits, - or _; using the default`)
    return fallback
  }
  return words
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
    mcpServerNames: serverNames(options, warn),
  }

  let token = tokenOf(options, warn)
  if (token !== undefined && lmField.rejected) {
    // The token was meant for the server the user named, not whatever answers on the default port.
    warn('rmod: lmstudioApiToken not sent because lmstudioUrl was rejected')
    token = undefined
  }
  return { config, token, warnings }
}
