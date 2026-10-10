// Checks that plugin.json userConfig defaults match the defaults in hooks/lib/config.ts.
// The test kit can't read JSON, so this runs from /verify instead. Usage: node scripts/check-manifest.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
const source = readFileSync(join(root, 'hooks', 'lib', 'config.ts'), 'utf8')

const constant = name => {
  const m = new RegExp(`export const ${name} = '((?:[^'\\\\]|\\\\.)*)'`).exec(source)
  if (m === null) throw new Error(`config.ts: ${name} not found`)
  return m[1].replace(/\\(.)/g, '$1')
}

const checks = [
  ['localMcpServerNames', constant('DEFAULT_MCP_SERVER_NAMES')],
  ['lmstudioUrl', constant('DEFAULT_LMSTUDIO_URL')],
  ['ollamaUrl', ''],
]
let failed = false
for (const [field, expected] of checks) {
  const actual = manifest.userConfig?.[field]?.default
  if (actual !== expected) {
    console.error(`plugin.json userConfig.${field}.default is ${JSON.stringify(actual)}, config.ts expects ${JSON.stringify(expected)}`)
    failed = true
  }
}
if (failed) process.exit(1)
console.log('manifest defaults match config.ts')
