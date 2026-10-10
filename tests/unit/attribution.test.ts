import { describe, expect, test } from 'claude-code/testing'

import { backendForModelStep, backendOfMcpTool, classifyToolCall, targetsOf } from '../../hooks/lib/attribution'
import { DEFAULT_MCP_SERVER_NAMES, parseConfig } from '../../hooks/lib/config'
import type { ModelInfo } from '../../types'

const BOTH = targetsOf({ enableOllama: true, enableLmStudio: true, ollamaUrl: 'http://127.0.0.1:11434', lmstudioUrl: 'http://127.0.0.1:1234' })
const MCP = DEFAULT_MCP_SERVER_NAMES.split(',')
const bash = (command: string) => classifyToolCall('Bash', { command }, BOTH, MCP)
const fetch = (url: string) => classifyToolCall('WebFetch', { url, prompt: 'x' }, BOTH, MCP)
const m = (id: string): ModelInfo => ({ id, loaded: false })

describe('attribution', () => {
  test('FR-4.1 targetsOf takes the ports of enabled backends only', () => {
    expect(BOTH).toEqual({ ollama: 11434, lmstudio: 1234 })
    expect(targetsOf({ enableOllama: false, enableLmStudio: true, ollamaUrl: 'http://127.0.0.1:11434', lmstudioUrl: 'http://[::1]:4321' })).toEqual({ lmstudio: 4321, offPorts: [11434] })
    expect(targetsOf({ enableOllama: true, enableLmStudio: false, ollamaUrl: 'http://127.0.0.1', lmstudioUrl: 'https://localhost' })).toEqual({ ollama: 80, offPorts: [443] })
  })

  test('FR-4.1b Bash commands that reach a backend port on any loopback spelling count', () => {
    expect(bash('curl -s http://127.0.0.1:11434/api/generate -d @req.json')).toBe('ollama')
    expect(bash('curl localhost:11434/api/tags | jq .')).toBe('ollama')
    expect(bash("curl 'http://[::1]:1234/v1/chat/completions'")).toBe('lmstudio')
    expect(bash('http POST LOCALHOST:1234/v1/models')).toBe('lmstudio')
  })

  test('FR-4.1b real requests inside wrappers, scripts and pipelines count', () => {
    expect(bash('bash -c "ollama run x"')).toBe('ollama')
    expect(bash("sh -lc 'lms chat q'")).toBe('lmstudio')
    expect(bash('bash -c "bash -c \\"curl localhost:11434/x\\""')).toBe('ollama')
    expect(bash('OLLAMA_HOST=127.0.0.1:11434 ollama run x')).toBe('ollama')
    expect(bash('nohup env FOO=1 ollama run x &')).toBe('ollama')
    expect(bash('timeout 30 curl -s 127.0.0.1:1234/v1/models')).toBe('lmstudio')
    expect(bash('cat req.json | curl -d @- http://localhost:11434/api/chat && echo done')).toBe('ollama')
    expect(bash('result=$(curl -s localhost:1234/v1/models)')).toBe('lmstudio')
    expect(bash('curl 0.0.0.0:11434/api/tags')).toBe('ollama')
    expect(bash('nc -z localhost 11434')).toBe('ollama')
    expect(bash('python3 -c "import urllib.request as u; u.urlopen(\'http://localhost:1234/v1/models\')"')).toBe('lmstudio')
    expect(bash('curl \\\n  http://localhost:11434/api/tags')).toBe('ollama')
  })

  test('FR-4.1b a command naming both backends goes to the first request in it', () => {
    expect(bash('curl localhost:1234/v1/models; curl localhost:11434/api/tags')).toBe('lmstudio')
    expect(bash('ollama run x; lms chat y')).toBe('ollama')
  })

  test('FR-4.1b long commands are read up to the scan limit, not skipped', () => {
    expect(bash(`curl -s localhost:11434/api/generate -d '${'x'.repeat(20_000)}'`)).toBe('ollama')
  })

  test('FR-4.1b Bash commands that run the local CLIs count', () => {
    expect(bash('ollama run llama3.2:3b "hi"')).toBe('ollama')
    expect(bash('cd /tmp && /opt/homebrew/bin/ollama run qwen3')).toBe('ollama')
    expect(bash('echo hi | lms chat qwen/qwen3-8b')).toBe('lmstudio')
    expect(bash('time lms chat')).toBe('lmstudio')
  })

  test('FR-4.1b Bash commands that only look similar do not count', () => {
    for (const command of [
      'ls -la',
      'curl http://127.0.0.1:114340/x',
      'curl http://127.0.0.1:1123',
      'curl http://notlocalhost:11434/x',
      'curl http://localhost.evil.com:11434/x',
      'curl http://192.168.1.10:11434/api/tags',
      'curl https://example.com/?next=127.0.0.1',
      'ollama list',
      'ollama pull llama3.2',
      'brew install ollama',
      'grep -r "ollama run" docs/',
      "grep -r 'see ollama run' docs/",
      'git commit -m "docs: explain ollama run and lms chat"',
      'echo "try: ollama run x"',
      "grep -rn '127.0.0.1:11434' hooks/",
      'rg localhost:1234 docs',
      'cat <<EOF > notes.md\nRun ollama run llama3.2 or curl localhost:11434\nEOF',
      'cat <<-\'X\' > a.md\n\tlms chat q\n\tX',
      '# hits localhost:1234\nls',
      'ls # ollama run x',
      'curl -d \'{"url":"http://localhost:11434"}\' https://example.com/hook',
      'ssh gpu-box curl localhost:11434/api/tags',
      'ssh gpu-box ollama run x',
      'curl http://0.0.0.0.evil.com:11434/',
      'lms ls',
      'echo lmschat',
      'myollama run x',
    ]) {
      expect(bash(command)).toBeNull()
    }
  })

  test('FR-4.1b WebFetch to a backend URL counts; other URLs do not', () => {
    expect(fetch('http://127.0.0.1:11434/api/tags')).toBe('ollama')
    expect(fetch('http://localhost:1234/v1/models')).toBe('lmstudio')
    expect(fetch('https://ollama.com/library')).toBeNull()
    expect(fetch('http://127.0.0.1:8080/')).toBeNull()
    expect(fetch('http://127.0.0.1@evil.com:11434/')).toBeNull()
    expect(classifyToolCall('WebFetch', { url: 42 }, BOTH, MCP)).toBeNull()
  })

  test('FR-4.1b the default server names match underscores, plugin prefixes and any letter case', () => {
    for (const [tool, backend] of [
      ['mcp__ollama__generate', 'ollama'],
      ['mcp__ollama_local__chat', 'ollama'],
      ['mcp__ollama-mcp__list_models', 'ollama'],
      ['mcp__plugin_tools_ollama__run', 'ollama'],
      ['mcp__Ollama__chat', 'ollama'],
      ['mcp__lmstudio__chat', 'lmstudio'],
      ['mcp__lm-studio__chat', 'lmstudio'],
      ['mcp__lm_studio_bridge__complete', 'lmstudio'],
      ['mcp__LMStudio__chat', 'lmstudio'],
      ['mcp__OLLAMA__chat', 'ollama'],
      ['mcp__LM_STUDIO__chat', 'lmstudio'],
    ] as const) {
      expect(classifyToolCall(tool, {}, BOTH, MCP)).toBe(backend)
    }
  })

  test('FR-4.1b other MCP tools, and tools whose server is not local, do not count', () => {
    for (const tool of [
      'mcp__github__search_ollama_issues',
      'mcp__claude_ai_Claude_Docs__read',
      'mcp__docs__ollama__x',
      'Read',
      'mcp__',
      `mcp__ollama${'x'.repeat(200)}__long`,
    ]) {
      expect(classifyToolCall(tool, {}, BOTH, MCP)).toBeNull()
    }
  })

  test('FR-4.1b a custom server name without a backend name goes to the only enabled backend, else nowhere', () => {
    const custom = ['mylocal']
    expect(classifyToolCall('mcp__mylocal__chat', {}, BOTH, custom)).toBeNull()
    expect(classifyToolCall('mcp__mylocal__chat', {}, { lmstudio: 1234 }, custom)).toBe('lmstudio')
    expect(backendOfMcpTool('mcp__mylocal__chat', { ollama: 11434 })).toBe('ollama')
  })

  test('FR-4.1b a disabled backend gets no tool requests', () => {
    const onlyLm = { lmstudio: 1234 }
    expect(classifyToolCall('Bash', { command: 'ollama run x' }, onlyLm, MCP)).toBeNull()
    expect(classifyToolCall('Bash', { command: 'curl 127.0.0.1:11434/' }, onlyLm, MCP)).toBeNull()
    expect(classifyToolCall('mcp__ollama__chat', {}, onlyLm, MCP)).toBeNull()
  })

  test('FR-4.1b odd inputs never throw and never count', () => {
    expect(classifyToolCall('Bash', {}, BOTH, MCP)).toBeNull()
    expect(classifyToolCall('Bash', { command: 7 }, BOTH, MCP)).toBeNull()
    expect(classifyToolCall('Bash', { command: `echo ${'x'.repeat(50_000)}; curl 127.0.0.1:11434` }, BOTH, MCP)).toBeNull()
    expect(bash('\'unterminated "quote')).toBeNull()
    expect(bash('$(((((')).toBeNull()
  })

  test('FR-4.1a a loopback ANTHROPIC_BASE_URL on a backend port attributes every step there', () => {
    const inv = { ollama: [], lmstudio: [] }
    expect(backendForModelStep('http://localhost:11434', 'claude-opus-5-5', BOTH, inv)).toBe('ollama')
    expect(backendForModelStep('http://127.0.0.1:1234/', 'whatever', BOTH, inv)).toBe('lmstudio')
  })

  test('FR-4.1a otherwise an exact model id in one inventory picks that backend', () => {
    const inv = { ollama: [m('llama3.2:3b'), m('shared')], lmstudio: [m('qwen/qwen3-8b'), m('shared')] }
    expect(backendForModelStep(undefined, 'llama3.2:3b', BOTH, inv)).toBe('ollama')
    expect(backendForModelStep('', 'qwen/qwen3-8b', BOTH, inv)).toBe('lmstudio')
    expect(backendForModelStep('http://127.0.0.1:4000', 'qwen/qwen3-8b', BOTH, inv)).toBe('lmstudio')
    expect(backendForModelStep(undefined, 'shared', BOTH, inv)).toBeNull()
    expect(backendForModelStep(undefined, 'claude-opus-5-5', BOTH, inv)).toBeNull()
    expect(backendForModelStep(undefined, 'LLAMA3.2:3B', BOTH, inv)).toBeNull()
  })

  test('FR-4.1a the URL wins over the model name; non-local URLs and disabled backends do not count', () => {
    const inv = { ollama: [m('llama3.2:3b')], lmstudio: [] }
    expect(backendForModelStep('http://127.0.0.1:1234', 'llama3.2:3b', BOTH, inv)).toBe('lmstudio')
    expect(backendForModelStep('http://192.168.1.10:11434', 'nope', BOTH, inv)).toBeNull()
    expect(backendForModelStep('http://127.0.0.1:9999', 'nope', BOTH, inv)).toBeNull()
    expect(backendForModelStep('http://127.0.0.1:11434', 'x', { lmstudio: 1234 }, inv)).toBeNull()
    // A remote base URL, or one on a disabled backend's port, never falls back to the model name.
    const lm = { ollama: [], lmstudio: [m('qwen/qwen3-8b')] }
    expect(backendForModelStep('https://api.anthropic.com', 'qwen/qwen3-8b', BOTH, lm)).toBeNull()
    expect(backendForModelStep('http://127.0.0.1:11434', 'qwen/qwen3-8b', { lmstudio: 1234, offPorts: [11434] }, lm)).toBeNull()
    expect(backendForModelStep(undefined, 'llama3.2:3b', { lmstudio: 1234 }, inv)).toBeNull()
  })

  test('NFR-2 MCP server names are literal words: regex syntax in them is just text, never a pattern', () => {
    // '(a|a)*' would backtrack as a regex; as a literal word it matches only a server named with those characters.
    expect(classifyToolCall(`mcp__${'a'.repeat(120)}__x`, {}, BOTH, ['(a|a)*'])).toBeNull()
    expect(classifyToolCall('mcp__x(a|a)*y__run', {}, { ollama: 11434 }, ['(a|a)*'])).toBe('ollama')
    const { config, warnings } = parseConfig({ localMcpServerNames: '(a|a)*' }, undefined)
    expect(warnings.length).toBe(1)
    expect(config.mcpServerNames).toEqual(MCP)
  })

  test('FR-6.3 the default server names pass rmod\'s own validation', () => {
    const { config, warnings } = parseConfig({ localMcpServerNames: DEFAULT_MCP_SERVER_NAMES }, undefined)
    expect(warnings).toEqual([])
    expect(config.mcpServerNames).toEqual(MCP)
  })

  test('FR-4.1a Ollama names match with or without the implicit :latest tag', () => {
    const inv = { ollama: [m('qwen3:latest'), m('llama3.2:3b')], lmstudio: [m('qwen3')] }
    expect(backendForModelStep(undefined, 'llama3.2', { ollama: 11434 }, inv)).toBeNull()
    expect(backendForModelStep(undefined, 'qwen3', { ollama: 11434 }, inv)).toBe('ollama')
    expect(backendForModelStep(undefined, 'qwen3:latest', BOTH, { ollama: [m('qwen3')], lmstudio: [] })).toBe('ollama')
    expect(backendForModelStep(undefined, 'qwen3:latest', { lmstudio: 1234 }, inv)).toBeNull()
  })

  test('FR-6.3 a shared port for both backends is warned about', () => {
    const { warnings } = parseConfig({ ollamaUrl: 'http://127.0.0.1:1234' }, undefined)
    expect(warnings).toEqual(['rmod: ollamaUrl and lmstudioUrl use the same port; requests to it count as Ollama'])
  })

  test('FR-4.6 attribution returns only a backend name or null, never input text', () => {
    const results = ['curl localhost:11434/x', 'SECRET ls', 'lms chat'].map(bash)
    for (const r of results) expect(r === null || r === 'ollama' || r === 'lmstudio').toBe(true)
  })
})
