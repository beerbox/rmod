import type { EngineInterface, Register, Timer } from 'claude-code'
import { atom, read, update } from 'claude-code'

import { bandLine } from './lib/band'
import { applyInventory, inventoryDue, ollamaInventory, sameInventory } from './lib/inventory'
import type { InventoryResult } from './lib/inventory'
import { defaultConfig, parseConfig } from './lib/config'
import type { Config } from './lib/config'
import { applyProbe, initialStatus, lmstudioProbe, ollamaProbe } from './lib/probe'
import type { LmStudioStep, ProbeOutcome, ProbeResult } from './lib/probe'
import { asStats, emptyStats, summarize } from './lib/stats'
import { statusText } from './lib/status-text'
import { freshMemory, transitionToast } from './lib/transitions'
import type { ToastMemory } from './lib/transitions'
import { parseJson } from './lib/models'
import { parseTags } from './lib/parse-ollama'
import { buildUrl } from './lib/url-guard'
import { bandTree } from './ui/band'
import type { BackendStatus, Health, LmStudioEndpoint } from '../types'

// Static analysis lets `$` reach only functions declared at the top of this file, and lets `read` /
// `update` take only atoms defined in this file. So the work and the atoms live here, and the
// module's mutable state is passed as `ctx`.

const ollamaStatus = atom({ plugin: 'rmod', key: 'ollama' } as const, initialStatus())
const lmstudioStatus = atom({ plugin: 'rmod', key: 'lmstudio' } as const, initialStatus())
const statsOllama = atom({ plugin: 'rmod', key: 'statsOllama' } as const, emptyStats())
const statsLmstudio = atom({ plugin: 'rmod', key: 'statsLmstudio' } as const, emptyStats())
/** Which LM Studio endpoint answered this session (FR-2.2); null until known. */
const lmstudioEndpoint = atom({ plugin: 'rmod', key: 'lmstudioEndpoint' } as const, null)

type Backend = 'ollama' | 'lmstudio'

type Ctx = {
  config: Config
  /** Kept out of Config so config can be logged or compared without leaking it. */
  token: string | undefined
  poll: Timer | undefined
  /**
   * No overlapping probes per backend (NFR-3). `pending`: a probe is running. `inflight`: fetches
   * still running, including ones whose probe already timed out, since `$.http.fetch` can't be
   * cancelled. A tick is skipped while either is set, so a hung server holds one request at most.
   */
  pending: { ollama: boolean; lmstudio: boolean }
  inflight: { ollama: number; lmstudio: number }
  /** FR-2.3: the token goes out only after a token-less probe to lmstudioUrl asked for auth. */
  lmAskedForAuth: boolean
  /** FR-3.4: what the person was last told about each backend. */
  toasts: { ollama: ToastMemory; lmstudio: ToastMemory }
  /** FR-5.1: when the Ollama inventory was last fetched, and whether /rmod-refresh asked for it now. */
  inventoryAt: number | undefined
  forceInventory: boolean
}

/** Whether an inventory result would change nothing in `s` (so it isn't written and redrawn). */
const unchanged = (s: BackendStatus, r: InventoryResult): boolean =>
  'models' in r && s.modelsError === undefined && s.modelsAt !== undefined && sameInventory(s, r.models)

/** Writes an inventory result unless it is what state already holds. Static analysis wants each atom named. */
const writeInventory = async ($: EngineInterface, backend: Backend, r: InventoryResult, at: number): Promise<void> => {
  if (backend === 'ollama') {
    if (!unchanged(await read($, ollamaStatus), r)) await update($, ollamaStatus, prev => applyInventory(prev, r, at))
  } else if (!unchanged(await read($, lmstudioStatus), r)) {
    await update($, lmstudioStatus, prev => applyInventory(prev, r, at))
  }
}

/** FR-5.1: `/api/tags` + `/api/ps` when due. Two more requests per modelsRefreshSec, not per poll. */
const refreshOllamaModels = async ($: EngineInterface, ctx: Ctx, cameUp: boolean): Promise<void> => {
  const now = await $.clock.now()
  if (!inventoryDue(await read($, ollamaStatus), ctx.inventoryAt, now, ctx.config.modelsRefreshMs, cameUp, ctx.forceInventory)) return
  ctx.inventoryAt = now
  ctx.forceInventory = false
  const tagsUrl = buildUrl(ctx.config.ollamaUrl, '/api/tags')
  const psUrl = buildUrl(ctx.config.ollamaUrl, '/api/ps')
  if (tagsUrl === undefined || psUrl === undefined) return
  const tags = await probe($, ctx, 'ollama', tagsUrl)
  // A failed or unreadable /api/tags decides; skip /api/ps then.
  const tagsReadable = tags.kind === 'response' && tags.status >= 200 && tags.status <= 299 && parseTags(parseJson(tags.text)) !== undefined
  const ps: ProbeOutcome = tagsReadable ? await probe($, ctx, 'ollama', psUrl) : { kind: 'timeout' }
  await writeInventory($, 'ollama', ollamaInventory(tags, ps), await $.clock.now())
}

/** Shows the toast a probe result calls for, if any (FR-3.4). */
const announce = ($: EngineInterface, ctx: Ctx, backend: Backend, health: Health): void => {
  const r = transitionToast(backend === 'ollama' ? 'Ollama' : 'LM Studio', ctx.toasts[backend], health)
  ctx.toasts[backend] = r.memory
  if (r.toast !== undefined) $.ui.toast(r.toast)
}

/**
 * One loopback GET raced against the probe timeout (`$.http.fetch` has no timeout of its own).
 * A late answer is ignored. A rejection's message is passed on only to be classified, never kept.
 */
const probe = async (
  $: EngineInterface,
  ctx: Ctx,
  backend: Backend,
  url: string,
  headers?: Record<string, string>,
): Promise<ProbeOutcome> => {
  const t0 = await $.clock.now()
  const stopTimer = new AbortController()
  const timeout = $.clock.sleep(ctx.config.probeTimeoutMs, { signal: stopTimer.signal }).then(
    (): ProbeOutcome => ({ kind: 'timeout' }),
    (): ProbeOutcome => ({ kind: 'timeout' }),
  )
  ctx.inflight[backend] += 1
  const request = $.http
    .fetch(url, headers === undefined ? undefined : { headers })
    .then(
      async (r): Promise<ProbeOutcome> => ({ kind: 'response', status: r.status, text: r.text, ms: (await $.clock.now()) - t0 }),
      (err: unknown): ProbeOutcome => ({ kind: 'rejected', message: err instanceof Error ? err.message : String(err) }),
    )
    .finally(() => {
      ctx.inflight[backend] -= 1
      // The race is over once the fetch settles: stop the timeout's sleep instead of leaving it pending.
      stopTimer.abort()
    })
  return Promise.race([request, timeout])
}

const probeOllama = async ($: EngineInterface, ctx: Ctx): Promise<void> => {
  const url = buildUrl(ctx.config.ollamaUrl, '/api/version')
  const r: ProbeResult = url === undefined ? { health: 'degraded', error: 'config' } : ollamaProbe(await probe($, ctx, 'ollama', url))
  const at = await $.clock.now()
  const wasUp = (await read($, ollamaStatus)).health === 'up'
  await update($, ollamaStatus, s => applyProbe(s, r, at))
  announce($, ctx, 'ollama', r.health)
  if (r.health === 'up') await refreshOllamaModels($, ctx, !wasUp)
}

const askLmStudio = async ($: EngineInterface, ctx: Ctx, endpoint: Exclude<LmStudioEndpoint, null>, withToken: boolean): Promise<LmStudioStep> => {
  const url = buildUrl(ctx.config.lmstudioUrl, endpoint === 'native' ? '/api/v1/models' : '/v1/models')
  if (url === undefined) return { result: { health: 'degraded', error: 'config' }, next: 'done' }
  // The token is sent only to the guarded lmstudioUrl, never to Ollama or anywhere else.
  const headers = withToken && ctx.token !== undefined ? { Authorization: `Bearer ${ctx.token}` } : undefined
  return lmstudioProbe(await probe($, ctx, 'lmstudio', url, headers), endpoint, headers !== undefined)
}

const probeLmStudio = async ($: EngineInterface, ctx: Ctx): Promise<void> => {
  // A status never checked means fresh state: a new session after /clear, /resume or /branch
  // (which reset $.state and fire no session.start). That session must be asked for auth again.
  if ((await read($, lmstudioStatus)).checkedAt === undefined) ctx.lmAskedForAuth = false
  const remembered = await read($, lmstudioEndpoint)
  let endpoint = remembered ?? 'native'
  // At most two requests per tick (NFR-3): a fallback and a token retry in the same tick would be three.
  let requests = 1
  let step = await askLmStudio($, ctx, endpoint, ctx.lmAskedForAuth)
  if (step.next === 'fallback') {
    endpoint = 'openai'
    requests += 1
    step = await askLmStudio($, ctx, endpoint, ctx.lmAskedForAuth)
  }
  if (step.next === 'retryWithToken' && ctx.token !== undefined) {
    ctx.lmAskedForAuth = true
    // After a fallback, the endpoint is remembered below and the next tick asks with the token.
    if (requests < 2) step = await askLmStudio($, ctx, endpoint, true)
  }
  if ((step.result.health === 'up' || step.result.health === 'auth') && endpoint !== remembered) {
    const found = endpoint
    await update($, lmstudioEndpoint, () => found)
  }
  // Whatever answers on the port next must ask for auth again before it gets the token.
  if (step.result.health === 'down') ctx.lmAskedForAuth = false
  const at = await $.clock.now()
  const r = step.result
  await update($, lmstudioStatus, s => applyProbe(s, r, at))
  announce($, ctx, 'lmstudio', r.health)
  // FR-5.1: the probe's own response is the inventory: no extra request.
  if (step.models !== undefined) await writeInventory($, 'lmstudio', { models: step.models }, at)
}

/** Probes one backend unless its previous probe is still pending. rmod's own failures never escape. */
const runProbe = async ($: EngineInterface, ctx: Ctx, backend: Backend): Promise<void> => {
  if (ctx.pending[backend] || ctx.inflight[backend] > 0) return
  ctx.pending[backend] = true
  try {
    if (backend === 'ollama') await probeOllama($, ctx)
    else await probeLmStudio($, ctx)
  } catch {
    // Keep the last known state and try again next tick.
  } finally {
    ctx.pending[backend] = false
  }
}

/**
 * Keeps a disabled backend showing off (FR-1.4, FR-2.4), also after /clear has reset $.state to
 * `unknown` without a session.start. Reads first, so an unchanged value is never rewritten.
 */
const keepOff = async ($: EngineInterface, ctx: Ctx): Promise<void> => {
  try {
    if (!ctx.config.enableOllama && (await read($, ollamaStatus)).health !== 'off') await update($, ollamaStatus, s => onOff(s, false))
    if (!ctx.config.enableLmStudio && (await read($, lmstudioStatus)).health !== 'off') await update($, lmstudioStatus, s => onOff(s, false))
  } catch {
    // Try again next tick.
  }
}

/** One poll: each enabled backend, in parallel. */
const tick = ($: EngineInterface, ctx: Ctx): void => {
  void keepOff($, ctx)
  if (ctx.config.enableOllama) void runProbe($, ctx, 'ollama')
  if (ctx.config.enableLmStudio) void runProbe($, ctx, 'lmstudio')
}

/**
 * (Re)starts the poll timer and applies on/off (FR-1.4, FR-2.4). A second session.start replaces
 * the timer instead of adding one. The first probe runs from a timer, where `$` calls outside a
 * hook are documented to run.
 */
const startPolling = async ($: EngineInterface, ctx: Ctx): Promise<void> => {
  try {
    ctx.poll?.cancel()
    ctx.poll = $.clock.every(ctx.config.pollMs, () => tick($, ctx))
    $.clock.after(0, () => tick($, ctx))
  } catch {
    $.ui.log('rmod: could not start polling')
  }
  try {
    await update($, ollamaStatus, s => onOff(s, ctx.config.enableOllama))
    await update($, lmstudioStatus, s => onOff(s, ctx.config.enableLmStudio))
  } catch {
    // The next probe writes the state anyway.
  }
}

/** The /rmod-status text (FR-3.7), also the answer to /rmod-refresh. */
const statusOf = async ($: EngineInterface, ctx: Ctx): Promise<string> =>
  statusText({
    ollama: onOff(await read($, ollamaStatus), ctx.config.enableOllama),
    lmstudio: onOff(await read($, lmstudioStatus), ctx.config.enableLmStudio),
    ollamaUrl: ctx.config.ollamaUrl,
    lmstudioUrl: ctx.config.lmstudioUrl,
    ollamaExposed: ctx.config.ollamaExposed,
    lmstudioEndpoint: await read($, lmstudioEndpoint),
    statsOllama: asStats(await read($, statsOllama)),
    statsLmstudio: asStats(await read($, statsLmstudio)),
  })

/** FR-1.4 / FR-2.4: a disabled backend shows off; one enabled again after an earlier load starts over. */
const onOff = (s: BackendStatus, enabled: boolean): BackendStatus =>
  enabled ? (s.health === 'off' ? { ...s, health: 'unknown' } : s) : { ...s, health: 'off' }

export const register: Register = (on, options) => {
  // Re-derived on every load: a change in /config reloads the module with new options.
  // OLLAMA_HOST needs `$`, so session.start parses again with it.
  const ctx: Ctx = {
    config: defaultConfig(),
    token: undefined,
    poll: undefined,
    pending: { ollama: false, lmstudio: false },
    inflight: { ollama: 0, lmstudio: 0 },
    lmAskedForAuth: false,
    toasts: { ollama: freshMemory(), lmstudio: freshMemory() },
    inventoryAt: undefined,
    forceInventory: false,
  }
  try {
    const parsed = parseConfig(options, undefined)
    ctx.config = parsed.config
    ctx.token = parsed.token
  } catch {
    // Keep the defaults.
  }

  on('session.start', async ($, e, next) => {
    try {
      const parsed = parseConfig(options, await $.env.get('OLLAMA_HOST'))
      ctx.config = parsed.config
      ctx.token = parsed.token
      // FR-6.3: one line per invalid field. Warnings never carry the rejected value or the token.
      for (const line of parsed.warnings) $.ui.log(line)
    } catch {
      $.ui.log('rmod: could not read OLLAMA_HOST; using configured values')
    }

    try {
      await $.command.register({
        name: 'rmod-status',
        description: 'rmod: local Ollama / LM Studio status as plain text',
        immediate: true,
      })
    } catch {
      // Fixed text only: never echo the error, which could carry user data.
      $.ui.log('rmod: could not register /rmod-status')
    }
    try {
      await $.command.register({
        name: 'rmod-refresh',
        description: 'rmod: re-read the local model lists now',
        immediate: true,
      })
    } catch {
      $.ui.log('rmod: could not register /rmod-refresh')
    }

    await startPolling($, ctx)
    return next(e)
  })

  // FR-3.1: the band above the prompt. Reads only; it never fetches or writes (NFR-3).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.props.hasSurvey || !ctx.config.showBand) return next(e)
      const input = {
        // On/off is applied as it is read, so a disabled backend shows off at once after /clear.
        ollama: onOff(await read($, ollamaStatus), ctx.config.enableOllama),
        lmstudio: onOff(await read($, lmstudioStatus), ctx.config.enableLmStudio),
        statsOllama: asStats(await read($, statsOllama)),
        statsLmstudio: asStats(await read($, statsLmstudio)),
      }
      // Nothing to watch and nothing counted: leave the row to the engine.
      if (!ctx.config.enableOllama && !ctx.config.enableLmStudio && summarize(input.statsOllama, input.statsLmstudio).total === 0) return next(e)
      return bandTree($.ui.resolve(e), bandLine(input, e.props.bodyColumns))
    } catch {
      return next(e)
    }
  })

  on('command.run', { command: 'rmod-status' }, async $ => {
    try {
      return { text: await statusOf($, ctx) }
    } catch {
      return { text: 'rmod: status unavailable' }
    }
  })

  // FR-5.1: inventories on demand. The probes run from a timer, not in this hook: their timeout
  // sleeps would count against the hook's budget (three in a row at probeTimeoutMs = 10 s overruns it).
  on('command.run', { command: 'rmod-refresh' }, async $ => {
    try {
      const busy = ctx.pending.ollama || ctx.pending.lmstudio || ctx.inflight.ollama > 0 || ctx.inflight.lmstudio > 0
      ctx.forceInventory = true
      $.clock.after(0, () => tick($, ctx))
      return {
        text: busy
          ? 'rmod: a check is already running; the model lists refresh with it. Run /rmod-status in a moment.'
          : 'rmod: refreshing the model lists now. Run /rmod-status in a moment.',
      }
    } catch {
      return { text: 'rmod: refresh failed' }
    }
  })
}
