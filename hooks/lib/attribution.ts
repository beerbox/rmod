// Which local backend a model request or tool call belongs to (FR-4.1). Pure: no `$`.
//
// Every function returns a BackendId or null and keeps nothing: the command text, URL or tool input
// it reads is never stored, returned or logged (FR-4.6). Backends are matched by port, so every
// loopback spelling (127.0.0.1, localhost, [::1]) counts as the same host. Ties go to Ollama
// (same port) or to the first match in a command; a model id in both inventories counts for neither.

import type { BackendId, ModelInfo } from '../../types'
import type { Config } from './config'
import { inlineScript, programOf, simpleCommands } from './shell'
import { isLoopbackUrl, portOf } from './url-guard'

/** The ports of the enabled backends, and of disabled ones (which get nothing attributed). */
export type Targets = { ollama?: number; lmstudio?: number; offPorts?: readonly number[] }

const BACKENDS: readonly BackendId[] = ['ollama', 'lmstudio']
/** Only this much of a command is read, to keep each tool call's bookkeeping well under NFR-2's 5 ms. */
const MAX_SCAN_CHARS = 10_000
const MAX_TOOL_NAME = 128
const MAX_SCRIPT_DEPTH = 2

/** Programs whose loopback host:port arguments are requests. */
const CLIENTS: ReadonlySet<string> = new Set(['curl', 'wget', 'http', 'https', 'xh', 'httpie', 'aria2c'])
/** Programs that take host and port as two arguments. */
const SOCKET_CLIENTS: ReadonlySet<string> = new Set(['nc', 'ncat', 'netcat', 'telnet'])
/** Interpreters whose inline code may hold the URL anywhere (`python3 -c "...localhost:11434..."`). */
const INTERPRETERS: ReadonlySet<string> = new Set(['python', 'python3', 'node', 'deno', 'bun', 'ruby', 'perl'])
/** Runs on another machine: out of scope (SPEC §5). */
const REMOTE: ReadonlySet<string> = new Set(['ssh', 'mosh'])

const HOST = String.raw`(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)`
/** A whole argument that is a loopback URL or host:port: `http://localhost:11434/api`, `127.0.0.1:1234`. */
const URL_ARG = new RegExp(String.raw`^(?:https?://)?${HOST}:(\d{1,5})(?:[/?#]|$)`, 'i')
/** A loopback host:port anywhere in a code string, not glued to a longer name or number. */
const IN_CODE = new RegExp(String.raw`(?<![\w.-])${HOST}(?![\w.-]):(\d{1,5})(?!\d)`, 'gi')
const LOOPBACK_HOST = new RegExp(`^${HOST}$`, 'i')

export const targetsOf = (c: Pick<Config, 'enableOllama' | 'enableLmStudio' | 'ollamaUrl' | 'lmstudioUrl'>): Targets => {
  const t: Targets = {}
  const off: number[] = []
  const o = portOf(c.ollamaUrl)
  const l = portOf(c.lmstudioUrl)
  if (o !== undefined) {
    if (c.enableOllama) t.ollama = o
    else off.push(o)
  }
  if (l !== undefined) {
    if (c.enableLmStudio) t.lmstudio = l
    else off.push(l)
  }
  if (off.length > 0) t.offPorts = off
  return t
}

const byPort = (targets: Targets, port: number): BackendId | null => BACKENDS.find(b => targets[b] === port) ?? null

const backendOfArgs = (program: string, args: readonly string[], targets: Targets): BackendId | null => {
  if (CLIENTS.has(program)) {
    for (const a of args) {
      const m = URL_ARG.exec(a)
      const b = m === null ? null : byPort(targets, Number(m[1]))
      if (b !== null) return b
    }
  } else if (SOCKET_CLIENTS.has(program)) {
    for (let i = 0; i + 1 < args.length; i += 1) {
      if (LOOPBACK_HOST.test(args[i] ?? '')) {
        const b = byPort(targets, Number(args[i + 1]))
        if (b !== null) return b
      }
    }
  } else if (INTERPRETERS.has(program)) {
    for (const a of args) {
      for (const m of a.matchAll(IN_CODE)) {
        const b = byPort(targets, Number(m[1]))
        if (b !== null) return b
      }
    }
  }
  return null
}

const backendOfCommand = (command: string, targets: Targets, depth: number): BackendId | null => {
  for (const words of simpleCommands(command.slice(0, MAX_SCAN_CHARS))) {
    const p = programOf(words)
    if (p === undefined || REMOTE.has(p.program)) continue
    const script = inlineScript(p.program, p.args)
    if (script !== undefined) {
      const b = depth < MAX_SCRIPT_DEPTH ? backendOfCommand(script, targets, depth + 1) : null
      if (b !== null) return b
      continue
    }
    const verb = p.args.find(a => !a.startsWith('-'))
    if (p.program === 'ollama' && verb === 'run' && targets.ollama !== undefined) return 'ollama'
    if (p.program === 'lms' && verb === 'chat' && targets.lmstudio !== undefined) return 'lmstudio'
    const b = backendOfArgs(p.program, p.args, targets)
    if (b !== null) return b
  }
  return null
}

const backendOfUrl = (url: string, targets: Targets): BackendId | null => {
  const port = portOf(url)
  return port === undefined ? null : byPort(targets, port)
}

/**
 * The backend an MCP tool belongs to: the one its server name mentions, else the only enabled
 * backend, else none.
 */
export const backendOfMcpTool = (tool: string, targets: Targets): BackendId | null => {
  const server = tool.slice('mcp__'.length).split('__')[0] ?? ''
  const named: BackendId | null = /ollama/i.test(server) ? 'ollama' : /lm[-_]?studio/i.test(server) ? 'lmstudio' : null
  if (named !== null) return targets[named] !== undefined ? named : null
  const enabled = BACKENDS.filter(b => targets[b] !== undefined)
  return enabled.length === 1 ? (enabled[0] ?? null) : null
}

/**
 * FR-4.1b: a Bash command that runs `ollama run` / `lms chat`, or sends a network client to a
 * backend's loopback port (not one that only mentions it in quotes, comments or heredocs); WebFetch to
 * a backend URL; MCP tools matching `mcpPattern`. `input` is the tool call's arguments (`e` itself).
 */
export const classifyToolCall = (
  tool: string,
  input: Readonly<Record<string, unknown>>,
  targets: Targets,
  mcpPattern: RegExp,
): BackendId | null => {
  if (tool === 'Bash') {
    const command = input['command']
    return typeof command === 'string' ? backendOfCommand(command, targets, 0) : null
  }
  if (tool === 'WebFetch') {
    const url = input['url']
    return typeof url === 'string' ? backendOfUrl(url, targets) : null
  }
  if (tool.startsWith('mcp__') && tool.length <= MAX_TOOL_NAME && mcpPattern.test(tool)) {
    return backendOfMcpTool(tool, targets)
  }
  return null
}

/** Ollama treats `name` and `name:latest` as the same model. */
const sameModel = (b: BackendId, a: string, z: string): boolean =>
  a === z || (b === 'ollama' && (a.includes(':') ? a : `${a}:latest`) === (z.includes(':') ? z : `${z}:latest`))

/**
 * FR-4.1a: a loopback `ANTHROPIC_BASE_URL` on an enabled backend's port attributes every step there.
 * The model id decides only when there is no base URL, or it is loopback on a port that is no
 * backend's (a local proxy): then an id found in exactly one enabled inventory picks that backend.
 * A remote base URL, or one on a disabled backend's port, attributes nothing.
 */
export const backendForModelStep = (
  baseUrl: string | undefined,
  model: string,
  targets: Targets,
  inventories: { readonly [B in BackendId]: readonly ModelInfo[] },
): BackendId | null => {
  if (baseUrl !== undefined && baseUrl.trim() !== '') {
    if (!isLoopbackUrl(baseUrl)) return null
    const port = portOf(baseUrl)
    if (port === undefined || targets.offPorts?.includes(port) === true) return null
    const b = byPort(targets, port)
    if (b !== null) return b
  }
  const owners = BACKENDS.filter(b => targets[b] !== undefined && inventories[b].some(m => sameModel(b, m.id, model)))
  return owners.length === 1 ? (owners[0] ?? null) : null
}
