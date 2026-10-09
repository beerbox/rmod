// Fake Ollama and LM Studio servers for kit tests: one http.fetch stub that branches on the URL.

import type { MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { LMSTUDIO_API_V1_MODELS, LMSTUDIO_V1_MODELS, OLLAMA_PS, OLLAMA_PS_EMPTY, OLLAMA_TAGS, OLLAMA_TAGS_EMPTY, OLLAMA_VERSION } from '../fixtures'

/** How a fake server answers. `hang` never answers within any timeout rmod allows. */
export type Mode = 'up' | 'down' | 'hang' | '401' | '403' | '500' | 'garbage' | 'native404' | 'native404down' | 'native404auth' | 'policy' | 'empty' | 'slow' | '404' | 'tagsGarbage' | 'ps500'

export type Fetched = { url: string; authorization: string | undefined }

export type Servers = {
  ollama: Mode
  lmstudio: Mode
  /** Every request rmod made, in order. */
  fetched: Fetched[]
  /** The most requests to each server that were ever open at once. */
  maxOpen: { ollama: number; lmstudio: number }
}

const reply = (status: number, text: string) => ({ value: { status, ok: status >= 200 && status < 300, headers: {}, text } })
const refused = (url: string) => ({ deny: `$.http.fetch(${url}) failed: ECONNREFUSED` })

/** A healthy Ollama: version, available models and loaded models, each on its own endpoint. */
const ollamaUp = (url: string) =>
  url.endsWith('/api/tags') ? reply(200, OLLAMA_TAGS) : url.endsWith('/api/ps') ? reply(200, OLLAMA_PS) : reply(200, OLLAMA_VERSION)

const answer = async (clock: MockClock, mode: Mode, url: string, isOllama: boolean, authorization: string | undefined) => {
  switch (mode) {
    case 'ps500':
      return url.endsWith('/api/ps') ? reply(500, '') : ollamaUp(url)
    case 'tagsGarbage':
      return url.endsWith('/api/tags') ? reply(200, '{"models":"x"}') : ollamaUp(url)
    case 'down':
      return refused(url)
    case 'hang':
      await clock.sleep(60_000)
      return isOllama ? ollamaUp(url) : reply(200, LMSTUDIO_API_V1_MODELS)
    case '401':
      // An LM Studio with "require API token" on accepts the right token.
      return authorization === 'Bearer fake-test-token-not-real-0000' ? reply(200, LMSTUDIO_API_V1_MODELS) : reply(401, '{"error":"Unauthorized"}')
    case '403':
      return reply(403, '')
    case '500':
      return reply(500, 'Internal Server Error')
    case 'garbage':
      return reply(200, '<html>not json</html>')
    case 'native404':
      return url.endsWith('/api/v1/models') ? reply(404, 'Not Found') : reply(200, LMSTUDIO_V1_MODELS)
    case 'native404down':
      return url.endsWith('/api/v1/models') ? reply(404, 'Not Found') : refused(url)
    case 'native404auth':
      // An older LM Studio (no native API) with "require API token" on.
      if (url.endsWith('/api/v1/models')) return reply(404, 'Not Found')
      return authorization === 'Bearer fake-test-token-not-real-0000' ? reply(200, LMSTUDIO_V1_MODELS) : reply(401, '')
    case 'slow':
      await clock.sleep(37)
      return isOllama ? ollamaUp(url) : reply(200, LMSTUDIO_API_V1_MODELS)
    case '404':
      return reply(404, 'Not Found')
    case 'policy':
      return { deny: `$.http.fetch(${url}) refused by the organization's web-fetch policy` }
    case 'empty':
      if (!isOllama) return reply(200, '{"models":[]}')
      return reply(200, url.endsWith('/api/tags') ? OLLAMA_TAGS_EMPTY : url.endsWith('/api/ps') ? OLLAMA_PS_EMPTY : OLLAMA_VERSION)
    case 'up':
      return isOllama ? ollamaUp(url) : reply(200, LMSTUDIO_API_V1_MODELS)
  }
}

/**
 * Registers the http.fetch stub. Change `servers.ollama` / `servers.lmstudio` between ticks to
 * simulate a server starting or stopping.
 */
export const fakeServers = (on: On, clock: MockClock, initial: { ollama: Mode; lmstudio: Mode }): Servers => {
  const servers: Servers = { ...initial, fetched: [], maxOpen: { ollama: 0, lmstudio: 0 } }
  const open = { ollama: 0, lmstudio: 0 }
  on('http.fetch', async ($, e) => {
    const authorization = e.init?.headers?.['Authorization']
    servers.fetched.push({ url: e.url, authorization })
    const isOllama = e.url.startsWith('http://127.0.0.1:11434/')
    if (!isOllama && !e.url.startsWith('http://127.0.0.1:1234/')) return refused(e.url)
    const which = isOllama ? 'ollama' : 'lmstudio'
    open[which] += 1
    servers.maxOpen[which] = Math.max(servers.maxOpen[which], open[which])
    try {
      return await answer(clock, isOllama ? servers.ollama : servers.lmstudio, e.url, isOllama, authorization)
    } finally {
      open[which] -= 1
    }
  })
  return servers
}
