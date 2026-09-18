import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { TIMESTAMP_QUERY_MEDIA_TYPE, toHex } from '@klopt/core'
import { createNoTimestampWitness } from '../src/timestamp/none.js'
import { createRfc3161Witness } from '../src/timestamp/rfc3161.js'
import { resolveTimestampWitness } from '../src/timestamp/resolve.js'

/**
 * Asking a timestamp authority to witness a seal (spec 7.6, ADR 0058).
 *
 * Everything here is about the one property the sealed snapshot depends on:
 * the authority is somebody else's server, and nothing it does — being down,
 * being slow, answering about the wrong thing, answering nonsense — may stop a
 * seal being taken. Each of those is a test, and each expects an outcome
 * rather than an exception.
 */

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'core',
  'test',
  'snapshot',
  '__fixtures__',
)
const REPLY = new Uint8Array(readFileSync(join(FIXTURES, 'reply.tsr')))
const IMPRINT = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

/**
 * The fixture reply, re-aimed at whatever hash the request asked about.
 *
 * The signature no longer covers it, which is deliberate: nothing here
 * verifies a TSA signature — that needs the authority's certificate chain and
 * a trust decision belonging to whoever checks the evidence. What is being
 * tested is the round trip.
 */
const FIXTURE_NONCE = '9cd29a855197f624'

const bytes = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))

function overwrite(buffer: Uint8Array, find: Uint8Array, put: Uint8Array): Uint8Array {
  for (let at = 0; at + find.length <= buffer.length; at += 1) {
    if (find.every((byte, index) => buffer[at + index] === byte)) buffer.set(put, at)
  }
  return buffer
}

function replyAbout(sha256: string, nonce = FIXTURE_NONCE): Uint8Array {
  const patched = overwrite(REPLY.slice(), bytes(IMPRINT), bytes(sha256))
  return overwrite(patched, bytes(FIXTURE_NONCE), bytes(nonce))
}

/**
 * The reply an honest authority would send back to this exact request.
 *
 * It has to echo the nonce, because that is the check the client makes: a
 * reply carrying a different one is an answer to somebody else's question. A
 * fake that always sent the fixture's nonce would only ever exercise the
 * failure path.
 */
function replyTo(request: Uint8Array): Uint8Array {
  const hex = toHex(request)
  const imprintAt = hex.indexOf('0420') + 4
  const sha256 = hex.slice(imprintAt, imprintAt + 64)

  // The INTEGER straight after the messageImprint is the nonce, minus the
  // leading zero DER adds to keep it positive.
  const after = imprintAt + 64
  const length = Number.parseInt(hex.slice(after + 2, after + 4), 16)
  const value = hex.slice(after + 4, after + 4 + length * 2).replace(/^00/, '')

  /**
   * Back to eight bytes before it is echoed.
   *
   * DER drops a leading zero byte, so about one nonce in 256 arrives seven
   * bytes wide — and `replyAbout` overwrites the fixture's nonce field byte
   * for byte, which would leave the fixture's last byte standing and send
   * back a different number. The client is right to reject that, so the test
   * failed once every few hundred runs on a fault of its own making.
   */
  const nonce = value.padStart(FIXTURE_NONCE.length, '0')

  return replyAbout(sha256, nonce)
}

const der = (bytes: Uint8Array) =>
  new Response(bytes.slice().buffer, {
    status: 200,
    headers: { 'content-type': 'application/timestamp-reply' },
  })

const SEAL = 'f'.repeat(63) + '1'

describe('asking an authority', () => {
  it('sends a DER query and reads the reply', async () => {
    const calls: { url: string; contentType: string | null; body: Uint8Array }[] = []
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const body = new Uint8Array(init?.body as ArrayBuffer)
      calls.push({
        // `Request` stringifies to `[object Object]`, so read its url properly.
        url: input instanceof Request ? input.url : input.toString(),
        contentType: new Headers(init?.headers).get('content-type'),
        body,
      })
      return Promise.resolve(der(replyTo(body)))
    })

    const witness = createRfc3161Witness({ url: 'https://tsa.test/tsr', fetch })
    const outcome = await witness.stamp(SEAL)

    expect(calls[0]?.contentType).toBe(TIMESTAMP_QUERY_MEDIA_TYPE)
    // The seal, and nothing else about the administration, leaves the building.
    expect(toHex(calls[0]!.body)).toContain(SEAL)
    expect(outcome.kind).toBe('stamped')
    if (outcome.kind !== 'stamped') return
    expect(outcome.authority).toBe('https://tsa.test/tsr')
    expect(outcome.token.imprintSha256).toBe(SEAL)
    expect(outcome.token.genTime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('sends a different nonce every time', async () => {
    // It is what ties a reply to this question rather than to one somebody
    // asked earlier. A fixed one would make a replayed token undetectable.
    const bodies: string[] = []
    const fetch = vi.fn((_: unknown, init?: RequestInit) => {
      const body = new Uint8Array(init?.body as ArrayBuffer)
      bodies.push(toHex(body))
      return Promise.resolve(der(replyTo(body)))
    })

    const witness = createRfc3161Witness({ url: 'https://tsa.test/tsr', fetch })
    await witness.stamp(SEAL)
    await witness.stamp(SEAL)

    expect(bodies[0]).not.toBe(bodies[1])
  })
})

describe('when the authority does not cooperate', () => {
  const failing = (fetch: typeof globalThis.fetch) =>
    createRfc3161Witness({ url: 'https://tsa.test/tsr', fetch }).stamp(SEAL)

  it('reports an HTTP error rather than throwing', async () => {
    const outcome = await failing(vi.fn(() => Promise.resolve(new Response('no', { status: 503 }))))

    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind !== 'unavailable') return
    expect(outcome.reason).toContain('503')
  })

  it('reports a refusal, with what the authority said', async () => {
    // PKIStatusInfo { status 2 (rejection), "bad request" }, no token.
    const rejection = Uint8Array.from(
      '30143012020102300d0c0b6261642072657175657374'.match(/../g)!,
      (pair) => Number.parseInt(pair, 16),
    )
    const outcome = await failing(vi.fn(() => Promise.resolve(der(rejection))))

    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind !== 'unavailable') return
    expect(outcome.reason).toContain('rejection')
    expect(outcome.reason).toContain('bad request')
  })

  it('reports a reply that is not a reply', async () => {
    const outcome = await failing(
      vi.fn(() => Promise.resolve(der(new TextEncoder().encode('<html>oops</html>')))),
    )

    expect(outcome.kind).toBe('unavailable')
  })

  it('reports a network failure', async () => {
    const outcome = await failing(vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))))

    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind !== 'unavailable') return
    expect(outcome.reason).toContain('ECONNREFUSED')
  })

  it('refuses a reply about somebody else’s hash', async () => {
    // A cache or a proxy answering with a token that is not about our seal.
    const outcome = await failing(vi.fn(() => Promise.resolve(der(replyAbout('a'.repeat(64))))))

    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind !== 'unavailable') return
    expect(outcome.reason).toContain('not the seal we asked about')
  })
})

describe('what a fresh install gets', () => {
  it('is no witness at all, with the setting to change it named', async () => {
    const outcome = await createNoTimestampWitness().stamp(SEAL)

    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind !== 'unavailable') return
    expect(outcome.reason).toContain('KLOPT_TIMESTAMP_URL')
  })

  it('stays that way for an empty or absent URL', () => {
    // A compose file with `KLOPT_TIMESTAMP_URL=` set and empty means the same
    // as not set. Treating it as a URL would produce one failed request per
    // seal, for ever, with nothing pointing at the cause.
    expect(resolveTimestampWitness({}).name).toBe('none')
    expect(resolveTimestampWitness({ KLOPT_TIMESTAMP_URL: '' }).name).toBe('none')
    expect(resolveTimestampWitness({ KLOPT_TIMESTAMP_URL: '  ' }).name).toBe('none')
  })

  it('uses the authority once one is named', () => {
    expect(resolveTimestampWitness({ KLOPT_TIMESTAMP_URL: 'https://freetsa.org/tsr' }).name).toBe(
      'https://freetsa.org/tsr',
    )
  })
})
