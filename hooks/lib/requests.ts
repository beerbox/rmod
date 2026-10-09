// Reading model steps and tool results for the request counter (FR-4.2, FR-4.6). Pure: no `$`.
// Only kinds, counts and the model id are read. Never text, input or output.

/** A chunk that is the model's own output (TTFT ends here), not the engine's envelope or a stop marker. */
export const isFirstOutput = (chunk: { readonly kind: string }): boolean =>
  chunk.kind === 'text' || chunk.kind === 'thinking' || chunk.kind === 'tool' || chunk.kind === 'input'

/** Output tokens and the answering model from a step's `usage`, when present and sane. */
export const usageOf = (usage: unknown): { outTokens?: number; model?: string } => {
  if (typeof usage !== 'object' || usage === null) return {}
  const u = usage as Readonly<Record<string, unknown>>
  const out: { outTokens?: number; model?: string } = {}
  const t = u['output_tokens']
  if (typeof t === 'number' && Number.isSafeInteger(t) && t >= 0) out.outTokens = t
  const m = u['model']
  if (typeof m === 'string' && m !== '') out.model = m
  return out
}

/** What a tool call came to: refused (never reached the backend: not a request), failed, or ok. */
export const toolOutcome = (r: unknown): 'refused' | 'failed' | 'ok' => {
  if (typeof r !== 'object' || r === null) return 'failed'
  const o = r as Readonly<Record<string, unknown>>
  if (typeof o['deny'] === 'string') return 'refused'
  return o['isError'] === true ? 'failed' : 'ok'
}

/** A step with no stop reason never got a response (failed or interrupted before a message). */
export const stepSucceeded = (r: { readonly stopReason: unknown } | undefined): boolean => r !== undefined && r.stopReason !== null

/** Bash run in the background returns at once: its latency isn't the request's, so it isn't counted. */
export const isBackgroundBash = (tool: string, input: Readonly<Record<string, unknown>>): boolean =>
  tool === 'Bash' && input['run_in_background'] === true
