import { describe, expect, it } from 'vitest'
import { resolveBaseUrl } from '../../src/api/auth-instance.js'

describe('resolveBaseUrl', () => {
  it('defaults to localhost http outside production', () => {
    expect(resolveBaseUrl({ NODE_ENV: 'development' })).toBe('http://localhost:3000')
  })

  it('refuses to boot in production without an https origin', () => {
    expect(() => resolveBaseUrl({ NODE_ENV: 'production' })).toThrow(/https:\/\//)
    expect(() =>
      resolveBaseUrl({ NODE_ENV: 'production', KLOPT_BASE_URL: 'http://books.example' }),
    ).toThrow(/https:\/\//)
  })

  it('accepts an https origin in production', () => {
    expect(
      resolveBaseUrl({ NODE_ENV: 'production', KLOPT_BASE_URL: 'https://books.example' }),
    ).toBe('https://books.example')
  })
})
