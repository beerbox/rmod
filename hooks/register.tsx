import type { EngineInterface, Register, Timer, ToolCallResult, TurnStepResult } from 'claude-code'
import { atom, read, update } from 'claude-code'

import { backendForModelStep, classifyToolCall, targetsOf } from './lib/attribution'
import { bandLine } from './lib/band'
import { applyInventory, inventoryDue, ollamaInventory, sameInventory } from './lib/inventory'
import type { InventoryResult } from './lib/inventory'
import { defaultConfig, parseConfig } from './lib/config'
import type { Config } from './lib/config'
import { applyProbe, initialStatus, lmstudioProbe, ollamaProbe } from './lib/probe'
import type { LmStudioStep, ProbeOutcome, ProbeResult } from './lib/probe'
import { isBackgroundBash, isFirstOutput, stepSucceeded, toolOutcome, usageOf } from './lib/requests'
import { asStats, begin, cancel, emptyStats, end, reset, summarize } from './lib/stats'
import { statusText } from './lib/status-text'
import { freshMemory, transitionToast } from './lib/transitions'
import type { ToastMemory } from './lib/transitions'
import { parseJson } from './lib/models'
import { parseTags } from './lib/parse-ollama'
import { paneSection } from './lib/pane'
import { buildUrl } from './lib/url-guard'
import { bandTree } from './ui/band'
import { paneTree } from './ui/pane'
import type { BackendStatus, Health, LmStudioEndpoint, ModelInfo, Stats } from '../types'

// Static analysis lets `$` reach only functions declared at the top of this file, and lets `read` /
// `update` take only atoms defined in this file. So the work and the atoms live here, and the
// module's mutable state is passed as `ctx`.

const ollamaStatus = atom({ plugin: 'rmod', key: 'ollama' } as const, initialStatus())
const lmstudioStatus = atom({ plugin: 'rmod', key: 'lmstudio' } as const, initialStatus())
const statsOllama = atom({ plugin: 'rmod', key: 'statsOllama' } as const, emptyStats())
const statsLmstudio = atom({ plugin: 'rmod', key: 'statsLmstudio' } as const, emptyStats())
/** FR-3.6: drawn from ctx.bandHidden; this atom only makes the band and pane redraw when it changes. */
const bandHidden = atom({ plugin: 'rmod', key: 'bandHidden' } as const, false)
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
  /** FR-4.1a: ANTHROPIC_BASE_URL, read at session.start. */
  baseUrl: string | undefined
  /** FR-4.1a: model ids per backend, cached as inventories are written so a model step reads no state. */
  models: { ollama: readonly ModelInfo[]; lmstudio: readonly ModelInfo[] }
  /**
   * Stats writes in order, never awaited by a tool or model hook (NFR-2): begin and end land in the
   * order they were made without delaying the request.
   */
  statsQueue: Promise<void>
  /** Writes queued and not yet settled; past MAX_PENDING_WRITES new ones are dropped. */
  pendingWrites: number
  /**
   * FR-3.6: the person's band choice, loaded from $.store at session.start (showBand is only the
   * default). Kept here because /clear resets $.state: the band reads this, the tick re-seeds the atom.
   */
  bandHidden: boolean
  /** Band-setting writes in order, so a double press leaves $.store with the last choice. */
  bandQueue: Promise<void>
  /** FR-3.7: `claude -p` or the SDK: panes are "placed" there but nothing draws them. */
  headless: boolean
}

const PANE_ID = 'rmod'
const STORE_BAND_HIDDEN = 'bandHidden'

/** FR-5.1: re-read the inventories now, from a timer (the probes' sleeps must not run in a hook). */
const requestRefresh = ($: EngineInterface, ctx: Ctx): void => {
  ctx.forceInventory = true
  try {
    $.clock.after(0, () => tick($, ctx))
  } catch {
    // The next poll picks up the forced refresh.
  }
}

/** FR-4.5: clear the counters, keeping requests still running. */
const resetCounters = ($: EngineInterface, ctx: Ctx): void => {
  record($, ctx, 'ollama', async () => reset)
  record($, ctx, 'lmstudio', async () => reset)
}

/** FR-3.6: flip the band, remember it across sessions, redraw the band and the pane. */
const toggleBand = ($: EngineInterface, ctx: Ctx): void => {
  ctx.bandHidden = !ctx.bandHidden
  const hidden = ctx.bandHidden
  ctx.bandQueue = ctx.bandQueue.then(async () => {
    try {
      await update($, bandHidden, () => hidden)
    } catch {
      // The band still reads ctx; the next tick re-seeds the atom.
    }
    // An equal-value write (right after /clear) may not redraw: ask for one.
    try {
      $.ui.invalidate('ui.render')
    } catch {
      // The next state write redraws.
    }
    try {
      await $.store.set(STORE_BAND_HIDDEN, hidden)
    } catch {
      $.ui.log('rmod: could not save the band setting')
    }
  }).catch(() => {})
}

const MAX_PENDING_WRITES = 100
const WRITE_TIMEOUT_MS = 2000

/**
 * Queues one stats change for a backend. `change` may await the clock reads the request hook
 * started without awaiting, so no request waits on rmod. Each write is raced against a timer, so
 * one that never settles can't stall the queue. Failures are dropped: counting never affects a request.
 */
const record = (
  $: EngineInterface,
  ctx: Ctx,
  backend: Backend,
  change: () => Promise<(s: Stats) => Stats>,
  optional = false,
): boolean => {
  // Only an optional write (a begin) may be dropped past the cap. An end or cancel always runs,
  // and a dropped begin drops its end too (the caller checks the return value), so in-flight can't stick.
  if (optional && ctx.pendingWrites >= MAX_PENDING_WRITES) return false
  ctx.pendingWrites += 1
  ctx.statsQueue = ctx.statsQueue
    .then(async () => {
      const apply = await change()
      const write =
        backend === 'ollama' ? update($, statsOllama, s => apply(asStats(s))) : update($, statsLmstudio, s => apply(asStats(s)))
      const stop = new AbortController()
      const timer = $.clock.sleep(WRITE_TIMEOUT_MS, { signal: stop.signal }).catch(() => {})
      try {
        await Promise.race([write, timer])
      } finally {
        stop.abort()
      }
    })
    .catch(() => {})
    .finally(() => {
      ctx.pendingWrites -= 1
    })
  return true
}

/** The end of a counted tool call: a refusal takes the begin back, anything else is a sample. */
const recordToolEnd = ($: EngineInterface, ctx: Ctx, b: Backend, t0: Promise<number | undefined>, r: ToolCallResult | undefined): void => {
  const at = stamp($)
  const outcome = toolOutcome(r)
  record($, ctx, b, async () => {
    if (outcome === 'refused') return cancel
    const [start, endAt] = await Promise.all([t0, at])
    const s0 = start ?? 0
    const sample = { kind: 'tool' as const, ok: outcome === 'ok', latencyMs: (endAt ?? s0) - s0, at: endAt ?? s0 }
    return s => end(s, sample)
  })
}

/** A clock read started now and awaited later (inside `record`), so the request never waits on it. */
const stamp = ($: EngineInterface): Promise<number | undefined> => $.clock.now().then(
  t => t,
  () => undefined,
)

/** Whether an inventory result would change nothing in `s` (so it isn't written and redrawn). */
const unchanged = (s: BackendStatus, r: InventoryResult): boolean =>
  'models' in r && s.modelsError === undefined && s.modelsAt !== undefined && sameInventory(s, r.models)

/** Writes an inventory result unless it is what state already holds. Static analysis wants each atom named. */
const writeInventory = async ($: EngineInterface, ctx: Ctx, backend: Backend, r: InventoryResult, at: number): Promise<void> => {
  if ('models' in r) ctx.models[backend] = r.models.models
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
  await writeInventory($, ctx, 'ollama', ollamaInventory(tags, ps), await $.clock.now())
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
  // Through a then, so even a synchronous throw from fetch lands in `.finally` and frees the slot.
  const request = Promise.resolve()
    .then(() => $.http.fetch(url, headers === undefined ? undefined : { headers }))
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
  if (step.models !== undefined) await writeInventory($, ctx, 'lmstudio', { models: step.models }, at)
}

/** Probes one backend unless its previous probe is still pending. rmod's own failures never escape. */
const runProbe = async ($: EngineInterface, ctx: Ctx, backend: Backend): Promise<void> => {
  // NFR-3: one open request per backend. A fetch that never settles (it can't be cancelled) holds
  // the backend at "no answer in time" until it does, or until the mod reloads.
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
    // FR-3.6: after /clear the atom is back at its default; put the person's choice back.
    const hidden = ctx.bandHidden
    if ((await read($, bandHidden)) !== hidden) await update($, bandHidden, () => hidden)
  } catch {
    // Try again next tick.
  }
}

/** One poll: each enabled backend, in parallel. */
const tick = ($: EngineInterface, ctx: Ctx): void => {
  void keepOff($, ctx)
  if (ctx.config.enableOllama) void runProbe($, ctx, 'ollama')
  if (ctx.config.enableLmStudio) void runProbe($, ctx, 'lmstudio')
  // The pane's "checked N s ago" and "last request N s ago" must age even when no probe writes
  // state (one still pending, both backends off). The engine throttles this; it does no I/O.
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The next state write redraws.
  }
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
  // Not awaited: session.start must never wait on bookkeeping (a host whose state writes hang
  // would hold the session's start). On/off is applied at read time anyway, so this only tidies state.
  void update($, ollamaStatus, s => onOff(s, ctx.config.enableOllama)).catch(() => {})
  void update($, lmstudioStatus, s => onOff(s, ctx.config.enableLmStudio)).catch(() => {})
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
    baseUrl: undefined,
    models: { ollama: [], lmstudio: [] },
    statsQueue: Promise.resolve(),
    pendingWrites: 0,
    bandHidden: false,
    bandQueue: Promise.resolve(),
    headless: false,
  }
  try {
    const parsed = parseConfig(options, undefined)
    ctx.config = parsed.config
    ctx.token = parsed.token
  } catch {
    // Keep the defaults.
  }

  on('session.start', async ($, e, next) => {
    ctx.headless = !e.isInteractive || e.surface === null
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
      ctx.baseUrl = await $.env.get('ANTHROPIC_BASE_URL')
    } catch {
      ctx.baseUrl = undefined
    }
    // FR-3.6: a saved choice wins; showBand is only the default. Anything but a boolean is ignored.
    ctx.bandHidden = !ctx.config.showBand
    try {
      const saved = await $.store.get(STORE_BAND_HIDDEN)
      if (typeof saved === 'boolean') ctx.bandHidden = saved
    } catch {
      // Keep the default.
    }
    try {
      await $.command.register({ name: 'rmod', description: 'rmod: open the local models pane', immediate: true })
    } catch {
      $.ui.log('rmod: could not register /rmod')
    }
    // A load or reload can't have requests of its own in flight: clear any count a lost one left behind.
    record($, ctx, 'ollama', async () => s => ({ ...s, inFlight: 0 }))
    record($, ctx, 'lmstudio', async () => s => ({ ...s, inFlight: 0 }))

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
        name: 'rmod-reset',
        description: 'rmod: reset this session\'s local request counters',
        immediate: true,
      })
    } catch {
      $.ui.log('rmod: could not register /rmod-reset')
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

  // FR-4.1a, FR-4.2: model requests to a local backend. An observer: every chunk is passed on as
  // it came and the result is returned unchanged. A step that isn't local is handed straight on.
  // Nothing on the request path awaits rmod: clock reads are started here and resolved in `record`.
  on('turn.step', async function* ($, e, next) {
    let backend: Backend | null = null
    try {
      backend = backendForModelStep(ctx.baseUrl, e.model, targetsOf(ctx.config), ctx.models)
    } catch {
      backend = null
    }
    if (backend === null) return yield* next(e)
    const b = backend
    const t0 = stamp($)
    let first: Promise<number | undefined> | undefined
    let result: TurnStepResult | undefined
    let done = false
    // Once only: from finally, or from the dispatch's abort if the stream is abandoned (FR-4.3).
    const finish = () => {
      if (done || !counted) return
      done = true
      const at = stamp($)
      const r = result
      record($, ctx, b, async () => {
        const [start, firstAt, endAt] = await Promise.all([t0, first, at])
        const s0 = start ?? 0
        const u = usageOf(r?.usage)
        const sample = {
          kind: 'model' as const,
          ok: stepSucceeded(r),
          latencyMs: (endAt ?? s0) - s0,
          at: endAt ?? s0,
          ttftMs: firstAt === undefined ? undefined : firstAt - s0,
          outTokens: u.outTokens,
          model: u.model ?? e.model,
        }
        return s => end(s, sample)
      })
    }
    const counted = record($, ctx, b, async () => begin, true)
    try {
      next.signal.addEventListener('abort', finish, { once: true })
    } catch {
      // No abort signal: finally still runs.
    }
    try {
      const stream = next(e)
      // Closing early makes `result` reject: that's an interrupt, already counted below.
      stream.result.catch(() => {})
      for await (const chunk of stream) {
        if (first === undefined && isFirstOutput(chunk)) first = stamp($)
        yield chunk
      }
      result = await stream.result
      return result
    } finally {
      finish()
    }
  })

  // FR-4.1b, FR-4.2: tool calls that reach a local backend. An observer: the result is returned
  // unchanged, and only the backend's name is kept, never the command, URL or input (FR-4.6).
  // A refused call never reached the backend, so it isn't a request (FR-4.1).
  on('tool.call', async ($, e, next) => {
    let backend: Backend | null = null
    try {
      const input = e as unknown as Readonly<Record<string, unknown>>
      const tool = String(e.tool)
      if (!isBackgroundBash(tool, input)) backend = classifyToolCall(tool, input, targetsOf(ctx.config), ctx.config.mcpServerNames)
    } catch {
      backend = null
    }
    if (backend === null) return next(e)
    const b = backend
    const t0 = stamp($)
    const counted = record($, ctx, b, async () => begin, true)
    let r: ToolCallResult | undefined
    try {
      r = await next(e)
      return r
    } finally {
      if (counted) recordToolEnd($, ctx, b, t0, r)
    }
  })

  // FR-3.1: the band above the prompt. Reads only; it never fetches or writes (NFR-3).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      // Subscribes the band to the setting; the value drawn is ctx's (FR-3.6).
      await read($, bandHidden)
      if (e.props.hasSurvey || ctx.bandHidden) return next(e)
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

  // FR-3.5: the pane. Reads only; the buttons' handlers do the work (NFR-3).
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    try {
      await read($, bandHidden)
      const now = await $.clock.now()
      const sections = [
        paneSection('Ollama', onOff(await read($, ollamaStatus), ctx.config.enableOllama), asStats(await read($, statsOllama)), now),
        paneSection('LM Studio', onOff(await read($, lmstudioStatus), ctx.config.enableLmStudio), asStats(await read($, statsLmstudio)), now),
      ]
      return paneTree($.ui.resolve(e), sections, ctx.bandHidden, {
        onRefresh: () => requestRefresh($, ctx),
        onReset: () => resetCounters($, ctx),
        onToggleBand: () => toggleBand($, ctx),
      })
    } catch {
      return next(e)
    }
  })

  on('command.run', { command: 'rmod' }, async $ => {
    try {
      // FR-3.7: where nothing draws, answer with the same information as text. `claude -p` places
      // every pane without drawing it, so it is told apart by the session, not by isPlaced.
      if (ctx.headless) return { text: await statusOf($, ctx) }
      const placed = await $.ui.open({ id: PANE_ID, title: 'rmod · local models', focus: true, closeOnEscape: true })
      return placed.isPlaced ? { text: 'rmod: pane opened (Esc closes it)' } : { text: await statusOf($, ctx) }
    } catch {
      return { text: 'rmod: could not open the pane; try /rmod-status' }
    }
  })

  on('command.run', { command: 'rmod-status' }, async $ => {
    try {
      return { text: await statusOf($, ctx) }
    } catch {
      return { text: 'rmod: status unavailable' }
    }
  })

  // FR-4.5: counters reset on demand. A request still running when this lands ends without going negative.
  on('command.run', { command: 'rmod-reset' }, async $ => {
    try {
      resetCounters($, ctx)
      const stop = new AbortController()
      try {
        await Promise.race([ctx.statsQueue, $.clock.sleep(1000, { signal: stop.signal }).catch(() => {})])
      } finally {
        stop.abort()
      }
      return { text: 'rmod: local request counters reset' }
    } catch {
      return { text: 'rmod: reset failed' }
    }
  })

  // FR-5.1: inventories on demand. The probes run from a timer, not in this hook: their timeout
  // sleeps would count against the hook's budget (three in a row at probeTimeoutMs = 10 s overruns it).
  on('command.run', { command: 'rmod-refresh' }, async $ => {
    try {
      const busy = ctx.pending.ollama || ctx.pending.lmstudio || ctx.inflight.ollama > 0 || ctx.inflight.lmstudio > 0
      requestRefresh($, ctx)
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
