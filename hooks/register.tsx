import type { Register } from 'claude-code'

import { defaultConfig, parseConfig } from './lib/config'
import type { Config } from './lib/config'

export const register: Register = (on, options) => {
  // Re-derived on every load: a change in /config reloads the module with new options.
  // OLLAMA_HOST needs `$`, so session.start parses again with it.
  let config: Config
  try {
    config = parseConfig(options, undefined).config
  } catch {
    config = defaultConfig()
  }

  on('session.start', async ($, e, next) => {
    try {
      const parsed = parseConfig(options, await $.env.get('OLLAMA_HOST'))
      config = parsed.config
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
    return next(e)
  })

  on('command.run', { command: 'rmod-status' }, async () => {
    return { text: `rmod loaded · Ollama ${config.ollamaUrl} · LM Studio ${config.lmstudioUrl}` }
  })
}
