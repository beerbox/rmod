import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_MCP_SERVER_NAMES, parseConfig } from '../../hooks/lib/config'

// What the loader hands register() when nothing is configured: the manifest's defaults.
const MANIFEST_DEFAULTS = {
  enableOllama: true,
  ollamaUrl: '',
  enableLmStudio: true,
  lmstudioUrl: 'http://127.0.0.1:1234',
  pollIntervalSec: 5,
  probeTimeoutMs: 1500,
  modelsRefreshSec: 30,
  showBand: true,
  localMcpServerNames: DEFAULT_MCP_SERVER_NAMES,
} as const

const FAKE_TOKEN = 'fake-test-token-not-real-0000'

describe('config', () => {
  test('FR-6.2 manifest defaults give the documented config and no warnings', () => {
    const { config, token, warnings } = parseConfig(MANIFEST_DEFAULTS, undefined)
    expect(warnings).toEqual([])
    expect(token).toBeUndefined()
    expect(config).toMatchObject({
      enableOllama: true,
      enableLmStudio: true,
      showBand: true,
      ollamaUrl: 'http://127.0.0.1:11434',
      ollamaSource: 'default',
      ollamaExposed: false,
      lmstudioUrl: 'http://127.0.0.1:1234',
      pollMs: 5000,
      probeTimeoutMs: 1500,
      modelsRefreshMs: 30000,
    })
    expect(config.mcpServerNames).toEqual(['ollama', 'lmstudio', 'lm-studio', 'lm_studio'])
  })

  test('FR-6.2 an empty options object also falls back to defaults silently', () => {
    const { config, warnings } = parseConfig({}, undefined)
    expect(warnings).toEqual([])
    expect(config.pollMs).toBe(5000)
    expect(config.lmstudioUrl).toBe('http://127.0.0.1:1234')
  })

  test('FR-6.2 valid overrides are used, with base URLs stripped of paths', () => {
    const { config, warnings } = parseConfig(
      {
        ...MANIFEST_DEFAULTS,
        enableOllama: false,
        ollamaUrl: 'http://localhost:11500/',
        lmstudioUrl: 'http://[::1]:4321/api',
        pollIntervalSec: 2,
        probeTimeoutMs: 10000,
        modelsRefreshSec: 3600,
        showBand: false,
        localMcpServerNames: ' MyLocal , ollama ',
      },
      undefined,
    )
    expect(warnings).toEqual([])
    expect(config).toMatchObject({
      enableOllama: false,
      ollamaUrl: 'http://localhost:11500',
      ollamaSource: 'config',
      lmstudioUrl: 'http://[::1]:4321',
      pollMs: 2000,
      probeTimeoutMs: 10000,
      modelsRefreshMs: 3600000,
      showBand: false,
    })
    expect(config.mcpServerNames).toEqual(['mylocal', 'ollama'])
  })

  test('FR-1.1 empty ollamaUrl uses a loopback OLLAMA_HOST', () => {
    const { config, warnings } = parseConfig({ ...MANIFEST_DEFAULTS, ollamaUrl: '  ' }, '127.0.0.1:11500')
    expect(warnings).toEqual([])
    expect(config).toMatchObject({ ollamaUrl: 'http://127.0.0.1:11500', ollamaSource: 'env', ollamaExposed: false })
  })

  test('FR-1.1 OLLAMA_HOST=0.0.0.0 probes 127.0.0.1 and flags exposure', () => {
    const { config } = parseConfig(MANIFEST_DEFAULTS, '0.0.0.0:11434')
    expect(config).toMatchObject({ ollamaUrl: 'http://127.0.0.1:11434', ollamaSource: 'env', ollamaExposed: true })
  })

  test('FR-1.1 a configured ollamaUrl wins over OLLAMA_HOST', () => {
    const { config } = parseConfig({ ...MANIFEST_DEFAULTS, ollamaUrl: 'http://127.0.0.1:11999' }, '127.0.0.1:11500')
    expect(config).toMatchObject({ ollamaUrl: 'http://127.0.0.1:11999', ollamaSource: 'config' })
  })

  test('FR-6.3 a non-loopback OLLAMA_HOST is ignored with one warning', () => {
    const { config, warnings } = parseConfig(MANIFEST_DEFAULTS, '192.168.1.10:11434')
    expect(config).toMatchObject({ ollamaUrl: 'http://127.0.0.1:11434', ollamaSource: 'default' })
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toMatch(/OLLAMA_HOST/)
  })

  test('FR-6.3 a non-loopback URL falls back to the default with one warning per field', () => {
    const { config, warnings } = parseConfig(
      { ...MANIFEST_DEFAULTS, ollamaUrl: 'http://evil.com:11434', lmstudioUrl: 'http://192.168.1.10:1234' },
      undefined,
    )
    expect(config.ollamaUrl).toBe('http://127.0.0.1:11434')
    expect(config.lmstudioUrl).toBe('http://127.0.0.1:1234')
    expect(warnings.length).toBe(2)
    expect(warnings[0]).toMatch(/ollamaUrl/)
    expect(warnings[1]).toMatch(/lmstudioUrl/)
    // The rejected value is never echoed.
    expect(warnings.join(' ')).not.toMatch(/evil|192\.168/)
  })

  test('NFR-2 defensive: out-of-range or non-numeric numbers fall back to defaults (the loader refuses these first)', () => {
    const { config, warnings } = parseConfig(
      { ...MANIFEST_DEFAULTS, pollIntervalSec: 1, probeTimeoutMs: 20000, modelsRefreshSec: Number.NaN },
      undefined,
    )
    expect(config).toMatchObject({ pollMs: 5000, probeTimeoutMs: 1500, modelsRefreshMs: 30000 })
    expect(warnings.length).toBe(3)
    expect(warnings[0]).toMatch(/pollIntervalSec.*2.*300/)
  })

  test('NFR-2 defensive: wrong value types fall back to defaults (the loader refuses these first)', () => {
    const { config, warnings } = parseConfig(
      { enableOllama: 'yes', showBand: 1, pollIntervalSec: '5', lmstudioUrl: true },
      undefined,
    )
    expect(config).toMatchObject({ enableOllama: true, showBand: true, pollMs: 5000, lmstudioUrl: 'http://127.0.0.1:1234' })
    expect(warnings.length).toBe(4)
  })

  test('FR-6.3 bad server-name lists fall back to the default with one warning', () => {
    for (const bad of ['^mcp__(a|a)*$', 'ollama,lm studio', ',,,', Array.from({ length: 11 }, (_, i) => `w${i}`).join(','), 'x'.repeat(41)]) {
      const { config, warnings } = parseConfig({ ...MANIFEST_DEFAULTS, localMcpServerNames: bad }, undefined)
      expect(config.mcpServerNames).toEqual(DEFAULT_MCP_SERVER_NAMES.split(','))
      expect(warnings.length).toBe(1)
      expect(warnings[0]).toMatch(/localMcpServerNames/)
    }
  })

  test('NFR-1 the token is returned apart from Config and never appears in config or warnings', () => {
    const { config, token, warnings } = parseConfig(
      { ...MANIFEST_DEFAULTS, lmstudioApiToken: `  ${FAKE_TOKEN}  `, ollamaUrl: 'http://evil.com' },
      undefined,
    )
    expect(token).toBe(FAKE_TOKEN)
    expect(JSON.stringify(config)).not.toContain(FAKE_TOKEN)
    expect(warnings.join(' ')).not.toContain(FAKE_TOKEN)
  })

  test('NFR-1 an empty token is unset with no warning', () => {
    for (const empty of ['', '   ']) {
      const { token, warnings } = parseConfig({ ...MANIFEST_DEFAULTS, lmstudioApiToken: empty }, undefined)
      expect(token).toBeUndefined()
      expect(warnings).toEqual([])
    }
  })

  test('NFR-1 an oversized or multi-line token is unset with a warning that never echoes it', () => {
    for (const bad of ['x'.repeat(4097), 'fake-abc\nfake-def', 'fake-t\u00e9st', 'fake-\u{1f600}']) {
      const { token, warnings } = parseConfig({ ...MANIFEST_DEFAULTS, lmstudioApiToken: bad }, undefined)
      expect(token).toBeUndefined()
      expect(warnings.length).toBe(1)
      expect(warnings[0]).toMatch(/lmstudioApiToken/)
      expect(warnings[0]).not.toMatch(/xxxx|fake-/)
    }
  })

  test('NFR-1 the token is withheld when lmstudioUrl was rejected', () => {
    const { token, warnings } = parseConfig(
      { ...MANIFEST_DEFAULTS, lmstudioUrl: 'http://192.168.1.10:1234', lmstudioApiToken: FAKE_TOKEN },
      undefined,
    )
    expect(token).toBeUndefined()
    expect(warnings).toContain('rmod: lmstudioApiToken not sent because lmstudioUrl was rejected')
    expect(warnings.join(' ')).not.toContain(FAKE_TOKEN)
  })

  test('FR-6.3 a rejected ollamaUrl falls back to the default, not to OLLAMA_HOST', () => {
    const { config } = parseConfig({ ...MANIFEST_DEFAULTS, ollamaUrl: 'http://evil.com' }, '127.0.0.1:11500')
    expect(config).toMatchObject({ ollamaUrl: 'http://127.0.0.1:11434', ollamaSource: 'default' })
  })
})
