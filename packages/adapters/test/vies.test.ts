import { describe, expect, it } from 'vitest'
import {
  createOfflineVatNumberValidator,
  createViesValidator,
  parseViesResponse,
} from '../src/vat-number/index.js'

/**
 * The VIES adapter, without VIES.
 *
 * Nothing here reaches the Commission's register: hitting a public service from
 * a test suite is rude and flaky, and the part that can be wrong is the
 * parsing. In particular `userError`, which decides whether `valid: false`
 * means "this number is not registered" or "you asked wrong" — conflating the
 * two stores somebody's typo as the counterparty's fault, and the counterparty
 * is the one who gets a letter about it.
 */

const REQUEST = { vatNumber: 'DE123456789', requesterVatNumber: 'NL123456789B01' }

/** The adapter always sends a JSON string; this asserts that rather than coercing. */
function bodyOf(init: RequestInit | undefined): string {
  const body = init?.body
  if (typeof body !== 'string') throw new Error('Expected a JSON string body.')
  return body
}
const AT = { checkedAt: '2026-04-02T09:00:00.000Z', source: 'vies', raw: '{}' }

describe('parseViesResponse', () => {
  it('reads a valid answer, with the consultation number that proves it', () => {
    const check = parseViesResponse(
      REQUEST,
      {
        countryCode: 'DE',
        vatNumber: '123456789',
        requestDate: '2026-04-02+02:00',
        valid: true,
        requestIdentifier: 'WAPIAAAAX123456789',
        name: 'Kunde GmbH',
        address: 'Hauptstrasse 1, Berlin',
        userError: 'VALID',
      },
      AT,
    )

    expect(check).toMatchObject({
      vatNumber: 'DE123456789',
      countryCode: 'DE',
      outcome: 'valid',
      name: 'Kunde GmbH',
      requestIdentifier: 'WAPIAAAAX123456789',
      checkedAt: '2026-04-02T09:00:00.000Z',
      error: null,
    })
  })

  it('reads a number that is simply not registered', () => {
    const check = parseViesResponse(
      REQUEST,
      { countryCode: 'DE', valid: false, userError: 'INVALID' },
      AT,
    )

    expect(check.outcome).toBe('invalid')
    expect(check.error).toBeNull()
  })

  it('does not call a member state outage an invalid number', () => {
    // The distinction that matters. `MS_UNAVAILABLE` means Germany's register
    // did not answer, which says nothing at all about the number.
    for (const userError of [
      'MS_UNAVAILABLE',
      'SERVICE_UNAVAILABLE',
      'TIMEOUT',
      'GLOBAL_MAX_CONCURRENT_REQ',
      'MS_MAX_CONCURRENT_REQ',
    ]) {
      const check = parseViesResponse(REQUEST, { valid: false, userError }, AT)
      expect(check.outcome, userError).toBe('unavailable')
      expect(check.error, userError).toContain(userError)
    }
  })

  it('does not call our own bad request an invalid number either', () => {
    const check = parseViesResponse(REQUEST, { valid: false, userError: 'INVALID_INPUT' }, AT)
    expect(check.outcome).toBe('unavailable')
  })

  it('treats a member state’s withheld name as absent, not as "---"', () => {
    const check = parseViesResponse(
      REQUEST,
      { valid: true, userError: 'VALID', name: '---', address: '   ' },
      AT,
    )

    expect(check.name).toBeNull()
    expect(check.address).toBeNull()
  })

  it('keeps the response verbatim, whatever we made of it', () => {
    const raw = '{"valid":true,"somethingNew":42}'
    const check = parseViesResponse(REQUEST, JSON.parse(raw), { ...AT, raw })
    expect(check.raw).toBe(raw)
  })

  it('survives a response that is not the shape we expect', () => {
    const check = parseViesResponse(REQUEST, null, AT)
    expect(check.outcome).toBe('invalid')
    expect(check.vatNumber).toBe('DE123456789')
  })
})

describe('createViesValidator', () => {
  it('sends the requester’s own number, which is what earns a consultation number', async () => {
    let sent: unknown
    const validator = createViesValidator({
      endpoint: 'https://vies.test/check',
      fetch: (_url, init) => {
        sent = JSON.parse(bodyOf(init))
        return Promise.resolve(
          new Response(
            JSON.stringify({ valid: true, userError: 'VALID', requestIdentifier: 'ABC' }),
            { status: 200 },
          ),
        )
      },
      now: () => new Date('2026-04-02T09:00:00.000Z'),
    })

    const check = await validator.check(REQUEST)

    expect(sent).toEqual({
      countryCode: 'DE',
      vatNumber: '123456789',
      requesterMemberStateCode: 'NL',
      requesterNumber: '123456789B01',
    })
    expect(check.requestIdentifier).toBe('ABC')
  })

  it('asks anonymously when the entity has no VAT number, and gets no proof', async () => {
    let sent: Record<string, unknown> = {}
    const validator = createViesValidator({
      endpoint: 'https://vies.test/check',
      fetch: (_url, init) => {
        sent = JSON.parse(bodyOf(init)) as Record<string, unknown>
        return Promise.resolve(
          new Response(JSON.stringify({ valid: true, userError: 'VALID' }), { status: 200 }),
        )
      },
    })

    const check = await validator.check({ vatNumber: 'DE123456789', requesterVatNumber: null })

    expect(Object.keys(sent)).toEqual(['countryCode', 'vatNumber'])
    expect(check.outcome).toBe('valid')
    // Valid, and unprovable. The ICP screen says so in words.
    expect(check.requestIdentifier).toBeNull()
  })

  it('never asks about a number that is not the right shape', async () => {
    let called = false
    const validator = createViesValidator({
      endpoint: 'https://vies.test/check',
      fetch: () => {
        called = true
        return Promise.resolve(new Response('{}', { status: 200 }))
      },
    })

    const check = await validator.check({ vatNumber: 'DE12', requesterVatNumber: null })

    expect(called).toBe(false)
    expect(check.outcome).toBe('invalid')
    expect(check.error).toContain('VIES was not asked')
  })

  it('records an HTTP failure as unavailable rather than throwing', async () => {
    const validator = createViesValidator({
      endpoint: 'https://vies.test/check',
      fetch: () => Promise.resolve(new Response('gateway timeout', { status: 504 })),
    })

    const check = await validator.check(REQUEST)
    expect(check.outcome).toBe('unavailable')
    expect(check.error).toContain('504')
    expect(check.raw).toBe('gateway timeout')
  })

  it('records a network failure as unavailable rather than throwing', async () => {
    const validator = createViesValidator({
      endpoint: 'https://vies.test/check',
      fetch: () => Promise.reject(new Error('getaddrinfo ENOTFOUND')),
    })

    const check = await validator.check(REQUEST)
    expect(check.outcome).toBe('unavailable')
    expect(check.error).toContain('ENOTFOUND')
  })

  it('records a non-JSON answer as unavailable, keeping what came back', async () => {
    const validator = createViesValidator({
      endpoint: 'https://vies.test/check',
      fetch: () => Promise.resolve(new Response('<html>maintenance</html>', { status: 200 })),
    })

    const check = await validator.check(REQUEST)
    expect(check.outcome).toBe('unavailable')
    expect(check.raw).toContain('maintenance')
  })

  it('gives up rather than hanging, and says how long it waited', async () => {
    const validator = createViesValidator({
      endpoint: 'https://vies.test/check',
      timeoutMs: 10,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        }),
    })

    const check = await validator.check(REQUEST)
    expect(check.outcome).toBe('unavailable')
    expect(check.error).toContain('10ms')
  })
})

describe('the offline validator, which is the default', () => {
  it('checks the shape and refuses to claim anybody confirmed it', async () => {
    const validator = createOfflineVatNumberValidator({
      now: () => new Date('2026-04-02T09:00:00.000Z'),
    })

    const good = await validator.check({ vatNumber: 'de 123456789', requesterVatNumber: null })
    expect(good).toMatchObject({
      vatNumber: 'DE123456789',
      countryCode: 'DE',
      // Not `valid`. Nothing confirmed it, and pretending otherwise would let
      // an install with no network file a zero rate it cannot defend.
      outcome: 'unavailable',
      requestIdentifier: null,
      source: 'offline',
    })
    expect(good.error).toContain('KLOPT_VIES_ENDPOINT')

    const bad = await validator.check({ vatNumber: 'DE1', requesterVatNumber: null })
    expect(bad.outcome).toBe('invalid')
  })
})
