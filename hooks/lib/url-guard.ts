// Loopback-only URL guard (docs/SECURITY.md §3). Pure: no `$`.
//
// WHATWG URL parsing normalises `2130706433`, `0x7f.0.0.1` and `0177.0.0.1`
// to `127.0.0.1`, so checking `new URL(raw).hostname` alone is not enough.
// The raw authority text must itself be one of the allowed spellings, and the
// parsed URL must agree with it.

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]'])
/** All-interfaces binds an OLLAMA_HOST may name, and the loopback address rmod probes instead. */
const ALL_INTERFACES: ReadonlyMap<string, string> = new Map([
  ['0.0.0.0', '127.0.0.1'],
  ['[::]', '[::1]'],
])

export type GuardResult = { ok: true; base: string } | { ok: false; reason: string }

type Parts = { scheme: string; host: string; port: number | undefined }

/** Splits `scheme://host[:port][/...]` from the raw text; undefined on anything odd. */
const splitRaw = (raw: string): { scheme: string; authority: string } | undefined => {
  if (raw.length === 0 || raw.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(raw)) return undefined
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(?:[/?#].*)?$/.exec(raw)
  if (m === null) return undefined
  const [, scheme = '', authority = ''] = m
  return { scheme: scheme.toLowerCase(), authority }
}

const splitAuthority = (authority: string): { host: string; port: string | undefined } | undefined => {
  const m = /^(\[[0-9A-Fa-f:.]+\]|[^:[\]@]*)(?::(\d{1,5}))?$/.exec(authority)
  if (m === null) return undefined
  const [, host = '', port] = m
  return { host: host.toLowerCase(), port }
}

const toPort = (port: string | undefined): number | undefined | null => {
  if (port === undefined) return undefined
  const n = Number(port)
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
}

const check = (raw: string): Parts | string => {
  const split = splitRaw(raw)
  if (split === undefined) return 'not a plain http(s) URL'
  if (split.scheme !== 'http' && split.scheme !== 'https') return 'scheme must be http or https'
  if (split.authority.includes('@')) return 'credentials in the URL are not allowed'
  const auth = splitAuthority(split.authority)
  if (auth === undefined) return 'malformed host or port'
  if (!LOOPBACK_HOSTS.has(auth.host)) return 'host must be loopback (127.0.0.1, ::1 or localhost)'
  const port = toPort(auth.port)
  if (port === null) return 'port must be 1-65535'

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return 'URL does not parse'
  }
  if (parsed.username !== '' || parsed.password !== '') return 'credentials in the URL are not allowed'
  if (parsed.hostname !== auth.host) return 'host must be loopback (127.0.0.1, ::1 or localhost)'
  return { scheme: split.scheme, host: auth.host, port }
}

const baseOf = (p: Parts): string => `${p.scheme}://${p.host}${p.port === undefined ? '' : `:${p.port}`}`

/** Validates a configured base URL and returns it with any path, query or hash removed. */
export const guardBaseUrl = (raw: string): GuardResult => {
  const r = check(raw)
  return typeof r === 'string' ? { ok: false, reason: r } : { ok: true, base: baseOf(r) }
}

export const isLoopbackUrl = (raw: string): boolean => typeof check(raw) !== 'string'

/**
 * Joins a guarded base and a constant endpoint path (`/api/version`).
 * Undefined when the base is not a clean loopback base or the path is not a plain absolute path.
 */
export const buildUrl = (base: string, path: string): string | undefined => {
  const g = guardBaseUrl(base)
  if (!g.ok || g.base !== base) return undefined
  if (!/^\/(?!\/)[A-Za-z0-9._~\-/]*$/.test(path) || /(^|\/)\.\.?(\/|$)/.test(path)) return undefined
  const url = base + path
  return isLoopbackUrl(url) ? url : undefined
}

/**
 * Turns an `OLLAMA_HOST` value (`0.0.0.0:11434`, `localhost`, `:11500`, `http://127.0.0.1:11434`)
 * into a guarded base URL, with Ollama's own defaults (envconfig.Host): no scheme means http and
 * port 11434; an explicit `http://` or `https://` without a port means 80 or 443.
 * All-interfaces binds are probed on loopback and flagged as exposed: `0.0.0.0` as `127.0.0.1`,
 * `[::]` as `[::1]`.
 */
export const normalizeOllamaHost = (raw: string): { url: string; exposed: boolean } | undefined => {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const hasScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)
  const withScheme = hasScheme ? trimmed : `http://${trimmed}`
  const split = splitRaw(withScheme)
  if (split === undefined || split.authority.includes('@')) return undefined
  const auth = splitAuthority(split.authority)
  if (auth === undefined) return undefined
  const loopback = ALL_INTERFACES.get(auth.host)
  const exposed = loopback !== undefined
  const host = auth.host === '' ? '127.0.0.1' : (loopback ?? auth.host)
  const port = toPort(auth.port)
  if (port === null) return undefined
  const defaultPort = !hasScheme ? 11434 : split.scheme === 'https' ? 443 : 80
  const g = guardBaseUrl(`${split.scheme}://${host}:${port ?? defaultPort}`)
  return g.ok ? { url: g.base, exposed } : undefined
}
