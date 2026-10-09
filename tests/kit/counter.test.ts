import { expect, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, ToolCallResult } from 'claude-code'

import { boot, session, START } from './boot'
import { typed } from './helpers'

const OLLAMA = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:11434' }

/** How the fake model answers one step. */
type Reply = { ttftMs: number; totalMs: number; outTokens?: number }

/** A fake model: one text chunk after ttftMs, the result after totalMs. */
const fakeModel = (on: On, clock: MockClock) => {
  const reply: Reply = { ttftMs: 500, totalMs: 2500, outTokens: 100 }
  on('turn.step', async function* ($, e) {
    await clock.sleep(reply.ttftMs)
    yield { kind: 'text', index: 0, text: 'hello' }
    await clock.sleep(reply.totalMs - reply.ttftMs)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'hello',
      toolUses: [],
      stopReason: 'end_turn',
      usage:
        reply.outTokens === undefined
          ? null
          : { input_tokens: 10, output_tokens: reply.outTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: e.model },
    }
  })
  return reply
}

/** Runs one model step to its end while the mock clock advances; returns what the caller saw. */
const step = async ($: Engine, clock: MockClock, model: string, advanceMs: number) => {
  const stream = $.turn.step({ turnId: 't1', index: 0, model, messageCount: 1 })
  const chunks: unknown[] = []
  const run = (async () => {
    let r = await stream.next()
    while (r.done !== true) {
      chunks.push(r.value)
      r = await stream.next()
    }
    return r.value
  })()
  const settled = run.then(
    value => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  )
  await clock.advance(advanceMs)
  return { chunks, ...(await settled) }
}

test('FR-4.1a FR-4.2 a model step to a local ANTHROPIC_BASE_URL counts, with latency, TTFT and tok/s', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' }, OLLAMA)
  fakeModel(on, clock)
  await $.session.start(START)
  await clock.settle()
  await step($, clock, 'gemma4:12b-mlx', 2500)
  expect(await session($)).toBe('Session: 1 local requests (1 model, 0 tool) · 1 ok, 0 failed · avg 2.5s · p95 2.5s · 50 tok/s')
})

test('NFR-2 the model stream and result pass through unchanged', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' }, OLLAMA)
  fakeModel(on, clock)
  await $.session.start(START)
  await clock.settle()
  const r = await step($, clock, 'gemma4:12b-mlx', 2500)
  expect(r.chunks).toEqual([{ kind: 'text', index: 0, text: 'hello' }])
  expect(r.value).toEqual({
    turnId: 't1',
    index: 0,
    answer: 'hello',
    toolUses: [],
    stopReason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'gemma4:12b-mlx' },
  })
})

test('FR-4.3 a model step shows as in flight while it streams', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' }, OLLAMA)
  fakeModel(on, clock)
  await $.session.start(START)
  await clock.settle()
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })
  const first = stream.next()
  await clock.advance(500)
  await first
  expect(await session($)).toMatch(/1 in flight/)
  const rest = (async () => {
    let r = await stream.next()
    while (r.done !== true) r = await stream.next()
  })()
  await clock.advance(2000)
  await rest
  expect(await session($)).not.toMatch(/in flight/)
})

test('FR-4.1a a step to a remote model counts nothing and is not touched', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' })
  fakeModel(on, clock)
  await $.session.start(START)
  await clock.settle()
  const r = await step($, clock, 'claude-opus-5-5', 2500)
  expect(r.chunks.length).toBe(1)
  expect(await session($)).toBe('')
})

test('FR-4.1a without a local base URL, a model id from the Ollama inventory counts there', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' })
  fakeModel(on, clock)
  await $.session.start(START)
  await clock.settle()
  await step($, clock, 'llama3.2:3b', 2500)
  expect(await session($)).toMatch(/^Session: 1 local requests \(1 model, 0 tool\)/)
})

test('FR-4.2 NFR-2 a step the caller stops reading (an interrupt) counts as failed, with no speed sample', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' }, OLLAMA)
  fakeModel(on, clock)
  await $.session.start(START)
  await clock.settle()
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })
  const first = stream.next()
  await clock.advance(500)
  expect((await first).value).toEqual({ kind: 'text', index: 0, text: 'hello' })
  await stream.return(undefined as never)
  await clock.settle()
  const line = await session($)
  expect(line).toMatch(/^Session: 1 local requests \(1 model, 0 tool\) · 0 ok, 1 failed$/)
})

test('FR-4.2 a step without usage counts, with no tok/s', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' }, OLLAMA)
  const reply = fakeModel(on, clock)
  delete reply.outTokens
  await $.session.start(START)
  await clock.settle()
  await step($, clock, 'm', 2500)
  expect(await session($)).toBe('Session: 1 local requests (1 model, 0 tool) · 1 ok, 0 failed · avg 2.5s · p95 2.5s')
})

/** A tool stub: answers every call with `answer`, after `ms` on the mock clock. */
const fakeTools = (on: On, clock: MockClock) => {
  const tool: { answer: ToolCallResult; ms: number } = { answer: { result: 'ok' }, ms: 100 }
  on('tool.call', async () => {
    await clock.sleep(tool.ms)
    return tool.answer
  })
  return tool
}

const callTool = async ($: Engine, clock: MockClock, input: Parameters<Engine['tool']['call']>[0]) => {
  const p = $.tool.call(input)
  await clock.advance(100)
  return p
}

test('FR-4.1b FR-4.2 a Bash curl to Ollama counts as a tool request; the command text is never kept', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' })
  fakeTools(on, clock)
  await $.session.start(START)
  await clock.settle()
  const r = await callTool($, clock, { tool: 'Bash', command: 'curl -s localhost:11434/api/generate -d SECRETPROMPT' })
  expect(r).toEqual({ result: 'ok' })
  const line = await session($)
  expect(line).toBe('Session: 1 local requests (0 model, 1 tool) · 1 ok, 0 failed · avg 100ms · p95 100ms')
  expect((await $.command.run(typed('rmod-status'))).text).not.toContain('SECRETPROMPT')
})

test('FR-4.1 FR-4.2 NFR-2 a tool error counts as failed; a refused call is no request; both pass through unchanged', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'up' })
  const tool = fakeTools(on, clock)
  await $.session.start(START)
  await clock.settle()
  tool.answer = { result: 'boom', isError: true }
  expect(await callTool($, clock, { tool: 'WebFetch', url: 'http://127.0.0.1:1234/v1/models', prompt: 'x' })).toEqual({ result: 'boom', isError: true })
  tool.answer = { deny: 'not allowed' }
  // The generated types list only the MCP servers connected at load; an Ollama MCP server isn't one here.
  const mcpCall = { tool: 'mcp__ollama__generate' } as unknown as Parameters<Engine['tool']['call']>[0]
  expect(await callTool($, clock, mcpCall)).toEqual({ deny: 'not allowed' })
  expect(await session($)).toBe('Session: 1 local requests (0 model, 1 tool) · 0 ok, 1 failed')
})

test('FR-4.1b non-local tools and background Bash are not counted', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'up' })
  fakeTools(on, clock)
  await $.session.start(START)
  await clock.settle()
  await callTool($, clock, { tool: 'Bash', command: 'ls -la' })
  await callTool($, clock, { tool: 'Read', file_path: '/work/a.txt' })
  await callTool($, clock, { tool: 'Bash', command: 'ollama run x', run_in_background: true })
  expect(await session($)).toBe('')
})

test('FR-4.5 FR-6.1 /rmod-reset clears the counters on demand', async ($, on) => {
  const { clock, registered } = boot(on, { ollama: 'up', lmstudio: 'down' })
  fakeTools(on, clock)
  await $.session.start(START)
  await clock.settle()
  expect(registered).toContain('rmod-reset')
  await callTool($, clock, { tool: 'Bash', command: 'ollama run x' })
  expect(await session($)).not.toBe('')
  expect((await $.command.run(typed('rmod-reset'))).text).toMatch(/counters reset/)
  expect(await session($)).toBe('')
})

test('FR-3.2 FR-4.3 the band shows the session summary', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' })
  fakeTools(on, clock)
  await $.session.start(START)
  await clock.settle()
  await callTool($, clock, { tool: 'Bash', command: 'curl 127.0.0.1:11434/api/tags' })
  const ui = await $.ui.mount({
    plugin: 'rmod',
    surface: 'terminal',
    component: 'AbovePrompt',
    viewport: { columns: 165, rows: 40 },
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 5 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: '   │ local reqs 1 · avg 100ms · p95 100ms' })).toBeDefined()
})

/** A model step stub that answers with a fixed result and chunks, for pass-through and failure tests. */
const fixedModel = (on: On, clock: MockClock, chunks: readonly unknown[], stopReason: 'end_turn' | null) =>
  on('turn.step', async function* ($, e) {
    for (const c of chunks) {
      await clock.sleep(100)
      yield c as { kind: 'text'; index: number; text: string }
    }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason, usage: null }
  })

test('FR-4.2 a step that resolves with no stop reason (no response arrived) counts as failed', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' }, OLLAMA)
  fixedModel(on, clock, [], null)
  await $.session.start(START)
  await clock.settle()
  await step($, clock, 'm', 100)
  expect(await session($)).toBe('Session: 1 local requests (1 model, 0 tool) · 0 ok, 1 failed')
})

test('NFR-2 thinking, text and stop chunks pass through unchanged, in order', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' }, OLLAMA)
  // A stub can't make engine chunks (only the engine pulls those); isFirstOutput's unit test covers them.
  const chunks = [{ kind: 'thinking', index: 0, text: 'hmm' }, { kind: 'text', index: 1, text: 'hi' }, { kind: 'stop', stopReason: 'end_turn', usage: null }]
  fixedModel(on, clock, chunks, 'end_turn')
  await $.session.start(START)
  await clock.settle()
  const r = await step($, clock, 'm', 300)
  expect(r.chunks).toEqual(chunks)
  expect(await session($)).toMatch(/^Session: 1 local requests \(1 model, 0 tool\) · 1 ok/)
})

test('FR-4.1a a model step to LM Studio counts there, by base URL or by inventory id', async ($, on) => {
  const { clock } = boot(on, { ollama: 'down', lmstudio: 'up' }, { ANTHROPIC_BASE_URL: 'http://localhost:1234' })
  fakeModel(on, clock)
  await $.session.start(START)
  await clock.settle()
  await step($, clock, 'qwen/qwen3-8b', 2500)
  expect(await session($)).toMatch(/^Session: 1 local requests \(1 model, 0 tool\)/)
})

test('FR-4.1a a subagent step to a local backend counts like the main thread', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' }, OLLAMA)
  fakeModel(on, clock)
  await $.session.start(START)
  await clock.settle()
  const stream = $.turn.step({ turnId: 't2', index: 0, model: 'gemma4:12b-mlx', messageCount: 1, agentId: 'sub-1' })
  const run = (async () => {
    let r = await stream.next()
    while (r.done !== true) r = await stream.next()
  })()
  await clock.advance(2500)
  await run
  expect(await session($)).toMatch(/^Session: 1 local requests \(1 model, 0 tool\)/)
})

test('FR-4.1a an Ollama model named without its :latest tag matches the inventory', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' })
  fakeModel(on, clock)
  await $.session.start(START)
  await clock.settle()
  await step($, clock, 'nomic-embed-text', 2500)
  expect(await session($)).toMatch(/^Session: 1 local requests/)
})

test('FR-4.1c rmod\'s own probes are never counted', async ($, on) => {
  const { clock, servers } = boot(on, { ollama: 'up', lmstudio: 'up' })
  await $.session.start(START)
  await clock.advance(60_000)
  expect(servers.fetched.length).toBeGreaterThan(20)
  expect(await session($)).toBe('')
})

test('FR-4.6 nothing a request carried reaches what rmod shows: no command, URL or prompt text', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' }, OLLAMA)
  fakeTools(on, clock)
  fakeModel(on, clock)
  await $.session.start(START)
  await clock.settle()
  await callTool($, clock, { tool: 'Bash', command: "curl localhost:11434/api/generate -d '{\"prompt\":\"PROMPT-SECRET\"}'" })
  await callTool($, clock, { tool: 'WebFetch', url: 'http://127.0.0.1:11434/api/tags?key=URL-SECRET', prompt: 'ASK-SECRET' })
  await step($, clock, 'gemma4:12b-mlx', 2500)
  const text = (await $.command.run(typed('rmod-status'))).text ?? ''
  for (const secret of ['PROMPT-SECRET', 'URL-SECRET', 'ASK-SECRET', 'curl', 'hello']) expect(text).not.toContain(secret)
})

test('FR-4.5 /rmod-reset keeps a request that is still running', async ($, on) => {
  const { clock } = boot(on, { ollama: 'up', lmstudio: 'down' }, OLLAMA)
  fakeModel(on, clock)
  await $.session.start(START)
  await clock.settle()
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })
  const first = stream.next()
  await clock.advance(500)
  await first
  await $.command.run(typed('rmod-reset'))
  expect(await session($)).toBe('Session: 0 local requests (0 model, 0 tool) · 0 ok, 0 failed · 1 in flight')
  const rest = (async () => {
    let r = await stream.next()
    while (r.done !== true) r = await stream.next()
  })()
  await clock.advance(2000)
  await rest
  expect(await session($)).toMatch(/^Session: 1 local requests .*1 ok/)
})
