import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
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
    return { text: 'rmod loaded' }
  })
}
