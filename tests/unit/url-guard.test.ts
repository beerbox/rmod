import { describe, expect, test } from 'claude-code/testing'

import { buildUrl, guardBaseUrl, isLoopbackUrl, normalizeOllamaHost } from '../../hooks/lib/url-guard'

describe('url-guard', () => {
  test('NFR-1 accepts the loopback hosts with and without a port', () => {
    for (const raw of [
      'http://127.0.0.1:11434',
      'http://127.0.0.1',
      'https://127.0.0.1:1234',
      'http://localhost:1234',
      'http://LOCALHOST:1234',
      'http://[::1]:11434',
    ]) {
      expect(isLoopbackUrl(raw)).toBe(true)
    }
  })

  test('NFR-1 rejects every bypass case in SECURITY.md §3', () => {
    for (const raw of [
      'http://127.0.0.1@evil.com',
      'http://evil.com#@127.0.0.1',
      'http://localhost.evil.com',
      'http://127.0.0.1.nip.io',
      'http://2130706433',
      'http://0x7f.0.0.1',
      'http://0177.0.0.1',
      'http://[::ffff:7f00:1]',
      'http://0.0.0.0',
      'http://192.168.1.10',
      'file:///etc/passwd',
      'javascript:alert(1)',
      '',
    ]) {
      expect(isLoopbackUrl(raw)).toBe(false)
    }
  })

  test('NFR-1 rejects userinfo, bad ports, odd schemes and whitespace tricks', () => {
    for (const raw of [
      'http://user:pass@127.0.0.1:1234',
      'http://user@localhost',
      'http://127.0.0.1:0',
      'http://127.0.0.1:65536',
      'http://127.0.0.1:99999',
      'http://127.0.0.1:12ab',
      'ftp://127.0.0.1',
      'ws://127.0.0.1:1234',
      ' http://127.0.0.1:1234',
      'http://127.0.0.1:1234 ',
      'http://127.0.0.1\\@evil.com',
      'http:/127.0.0.1',
      '//127.0.0.1',
      'http://127.1',
      'http://[0:0:0:0:0:0:0:1]',
      'http://127.0.0.2',
      'http://localhost.',
      'http://127.0.0.1.',
      'http://127.0.0.1.:1234',
      'http://loc%61lhost',
      'http://%31%32%37.0.0.1',
      'http://\uff4cocalhost',
      'http://127\u30020\u30020\u30021',
      'http://local\u00adhost',
      'http://local\u200bhost',
      'http://[::1%25lo0]',
      'http://[::ffff:127.0.0.1]',
      'http://[0::1]',
      'http://127.0.0.1;@evil.com',
      'http://[::1]:1234@evil.com',
      'http://[::1].evil.com',
      'http://local\nhost',
      'http://localhost\t:1234',
      'http:\\\\127.0.0.1',
      'http://127.0.0.1:',
      `http://127.0.0.1/${'a'.repeat(3000)}`,
    ]) {
      expect(isLoopbackUrl(raw)).toBe(false)
    }
  })

  test('FR-6.3 guardBaseUrl strips path, query and hash and says why it rejects', () => {
    expect(guardBaseUrl('http://127.0.0.1:11434/api?x=1#y')).toEqual({ ok: true, base: 'http://127.0.0.1:11434' })
    expect(guardBaseUrl('http://localhost:1234/')).toEqual({ ok: true, base: 'http://localhost:1234' })
    expect(guardBaseUrl('http://[::1]:1234')).toEqual({ ok: true, base: 'http://[::1]:1234' })
    const bad = guardBaseUrl('http://192.168.1.10:11434')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toMatch(/loopback/)
  })

  test('NFR-1 buildUrl joins a constant path and refuses anything else', () => {
    expect(buildUrl('http://127.0.0.1:11434', '/api/version')).toBe('http://127.0.0.1:11434/api/version')
    expect(buildUrl('http://127.0.0.1:1234', '/v1/models')).toBe('http://127.0.0.1:1234/v1/models')
    expect(buildUrl('http://evil.com', '/api/version')).toBeUndefined()
    expect(buildUrl('http://127.0.0.1:11434', 'api/version')).toBeUndefined()
    expect(buildUrl('http://127.0.0.1:11434', '//evil.com/x')).toBeUndefined()
    expect(buildUrl('http://127.0.0.1:11434', '/api?x=1')).toBeUndefined()
    expect(buildUrl('http://127.0.0.1:11434', '/@evil.com')).toBeUndefined()
    for (const dots of ['/../x', '/api/../../x', '/./x', '/api/..', '/.']) {
      expect(buildUrl('http://127.0.0.1:11434', dots)).toBeUndefined()
    }
  })

  test('NFR-1 buildUrl only takes a base in the canonical form guardBaseUrl returns', () => {
    for (const base of ['http://LOCALHOST:1', 'http://127.0.0.1:080', 'http://127.0.0.1:11434/']) {
      expect(buildUrl(base, '/api/version')).toBeUndefined()
    }
    expect(guardBaseUrl('http://127.0.0.1:080')).toEqual({ ok: true, base: 'http://127.0.0.1:80' })
    expect(guardBaseUrl('http://LOCALHOST:1')).toEqual({ ok: true, base: 'http://localhost:1' })
  })

  test('FR-1.1 normalizeOllamaHost handles host:port, bare hosts, schemes and 0.0.0.0', () => {
    expect(normalizeOllamaHost('127.0.0.1:11500')).toEqual({ url: 'http://127.0.0.1:11500', exposed: false })
    expect(normalizeOllamaHost('localhost')).toEqual({ url: 'http://localhost:11434', exposed: false })
    expect(normalizeOllamaHost('http://127.0.0.1:11434')).toEqual({ url: 'http://127.0.0.1:11434', exposed: false })
    expect(normalizeOllamaHost('0.0.0.0:11434')).toEqual({ url: 'http://127.0.0.1:11434', exposed: true })
    expect(normalizeOllamaHost('0.0.0.0')).toEqual({ url: 'http://127.0.0.1:11434', exposed: true })
    expect(normalizeOllamaHost(':11434')).toEqual({ url: 'http://127.0.0.1:11434', exposed: false })
    expect(normalizeOllamaHost('[::1]:11434')).toEqual({ url: 'http://[::1]:11434', exposed: false })
    expect(normalizeOllamaHost('[::]:11500')).toEqual({ url: 'http://[::1]:11500', exposed: true })
    expect(normalizeOllamaHost('[::]')).toEqual({ url: 'http://[::1]:11434', exposed: true })
  })

  test('FR-1.1 normalizeOllamaHost uses Ollama default ports: 11434 bare, 80 for http://, 443 for https://', () => {
    expect(normalizeOllamaHost('127.0.0.1')).toEqual({ url: 'http://127.0.0.1:11434', exposed: false })
    expect(normalizeOllamaHost('http://127.0.0.1')).toEqual({ url: 'http://127.0.0.1:80', exposed: false })
    expect(normalizeOllamaHost('https://localhost')).toEqual({ url: 'https://localhost:443', exposed: false })
  })

  test('FR-1.1 normalizeOllamaHost never treats prototype names as all-interfaces hosts', () => {
    for (const raw of ['constructor', 'toString:11434', '__proto__']) {
      expect(normalizeOllamaHost(raw)).toBeUndefined()
    }
  })

  test('FR-1.1 normalizeOllamaHost rejects non-loopback and junk values', () => {
    for (const raw of ['192.168.1.10:11434', 'evil.com', 'http://evil.com:11434', '2130706433', '', '   ', 'http://user@127.0.0.1']) {
      expect(normalizeOllamaHost(raw)).toBeUndefined()
    }
  })
})
