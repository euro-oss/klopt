import { describe, expect, it } from 'vitest'
import headless, { isHeadless, servesPath } from '../src/server-middleware/headless.js'

/**
 * Spec 10.1's headless mode, at the level the middleware decides it.
 *
 * > `klopt serve --headless` starts the API and the worker with no web app
 * > mounted.
 *
 * The walk-through in ADR 0042 covers the same ground over real HTTP; this is
 * here so that a change to the prefix list fails in a second rather than in a
 * container. The interesting cases are the near misses: a path that merely
 * begins with the letters of a machine surface is not one.
 */

const event = (url: string) => ({ req: { url } })

describe('the switch', () => {
  it('is off unless the variable is exactly 1', () => {
    expect(isHeadless({})).toBe(false)
    expect(isHeadless({ KLOPT_HEADLESS: '' })).toBe(false)
    expect(isHeadless({ KLOPT_HEADLESS: '0' })).toBe(false)
    // 'true' is not 1, deliberately: one spelling, so a typo in a compose file
    // is a boot in the mode the operator expected rather than a silent half.
    expect(isHeadless({ KLOPT_HEADLESS: 'true' })).toBe(false)
    expect(isHeadless({ KLOPT_HEADLESS: '1' })).toBe(true)
  })
})

describe('what a machine can still reach', () => {
  it('serves the API and the discovery documents', () => {
    expect(servesPath('/api/v1/sales/invoices')).toBe(true)
    expect(servesPath('/api/auth/sign-in/email-otp')).toBe(true)
    expect(servesPath('/.well-known/oauth-protected-resource')).toBe(true)
  })

  it('serves nothing else', () => {
    expect(servesPath('/')).toBe(false)
    expect(servesPath('/sign-in')).toBe(false)
    expect(servesPath('/sales/invoices')).toBe(false)
    expect(servesPath('/assets/index-a1b2c3.js')).toBe(false)
  })

  it('does not mistake a lookalike for the API', () => {
    // The prefixes end in a slash for this reason. A route named `/apiary` or
    // a tenant slug beginning "api" would otherwise be served by a build that
    // has no UI in it, which is a 500 where a 404 was meant.
    expect(servesPath('/apiary')).toBe(false)
    expect(servesPath('/api-docs')).toBe(false)
    expect(servesPath('/.well-knownish')).toBe(false)
  })
})

describe('the middleware', () => {
  it('stands aside when the UI is mounted', () => {
    delete process.env['KLOPT_HEADLESS']
    expect(headless(event('http://localhost:3000/sign-in'))).toBeUndefined()
  })

  it('refuses a page with a problem document', async () => {
    process.env['KLOPT_HEADLESS'] = '1'
    try {
      const response = headless(event('http://localhost:3000/sales/invoices'))
      expect(response?.status).toBe(404)
      expect(response?.headers.get('content-type')).toBe('application/problem+json')

      const problem = (await response?.json()) as { code: string; detail: string }
      // 404 rather than 501: the honest answer to "is there a web app here" is
      // no, and an operator reading a log wants the reason, so `code` says
      // which kind of nothing this is.
      expect(problem.code).toBe('headless')
      expect(problem.detail).toContain('/api')
    } finally {
      delete process.env['KLOPT_HEADLESS']
    }
  })

  it('lets the API through', () => {
    process.env['KLOPT_HEADLESS'] = '1'
    try {
      expect(headless(event('http://localhost:3000/api/v1/events'))).toBeUndefined()
      expect(
        headless(event('http://localhost:3000/.well-known/oauth-protected-resource')),
      ).toBeUndefined()
    } finally {
      delete process.env['KLOPT_HEADLESS']
    }
  })

  it('reads the path, not the query string', () => {
    process.env['KLOPT_HEADLESS'] = '1'
    try {
      expect(headless(event('http://localhost:3000/api/v1/events?since=/sign-in'))).toBeUndefined()
      expect(headless(event('http://localhost:3000/?next=/api/v1/events'))?.status).toBe(404)
    } finally {
      delete process.env['KLOPT_HEADLESS']
    }
  })
})
