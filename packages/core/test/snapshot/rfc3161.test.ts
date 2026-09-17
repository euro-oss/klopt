import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { encodeTimeStampRequest, readTimeStampResponse } from '../../src/snapshot/rfc3161.js'
import { fromHex, toHex } from '../../src/snapshot/der.js'

/**
 * Talking to a timestamp authority, checked against OpenSSL's bytes.
 *
 * The fixtures are a real `openssl ts -query` and a real `openssl ts -reply`
 * from a throwaway TSA. That matters more than usual here: a hand-rolled DER
 * encoder that is only ever tested against its own decoder agrees with itself
 * and with nothing else, and the failure appears the first time a real
 * authority reads it.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const read = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)))

/** The hash and nonce the fixtures were generated with. */
const SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
const NONCE = '9cd29a855197f624'

describe('the request', () => {
  it('is byte-for-byte what openssl produces', () => {
    const encoded = encodeTimeStampRequest({ sha256: SHA256, nonce: NONCE })
    expect(toHex(encoded)).toBe(toHex(read('request.tsq')))
  })

  it('leaves out the certificate request when it is not wanted', () => {
    const withCert = encodeTimeStampRequest({ sha256: SHA256, nonce: NONCE, certReq: true })
    const without = encodeTimeStampRequest({ sha256: SHA256, nonce: NONCE, certReq: false })

    // `BOOLEAN FALSE` is the DEFAULT and DER omits a default, so the field is
    // absent rather than encoded as 0x010100.
    expect(without.length).toBe(withCert.length - 3)
    expect(toHex(withCert).endsWith('0101ff')).toBe(true)
    expect(toHex(without).endsWith('0101ff')).toBe(false)
  })

  it('names a policy when the authority requires one', () => {
    const encoded = encodeTimeStampRequest({
      sha256: SHA256,
      nonce: NONCE,
      policyOid: '1.2.3.4.1',
    })
    // 06 04 2a 03 04 01 — the OID, in front of the nonce.
    expect(toHex(encoded)).toContain('06042a030401')
  })

  it('keeps a nonce whose first bit is set positive', () => {
    // Two's complement: without a leading zero this reads as negative, the
    // authority echoes something else back, and the reply looks replayed.
    const encoded = encodeTimeStampRequest({ sha256: SHA256, nonce: 'ff00000000000001' })
    expect(toHex(encoded)).toContain('020900ff00000000000001')
  })
})

describe('the reply', () => {
  it('reads what the authority signed', () => {
    const response = readTimeStampResponse(read('reply.tsr'), { sha256: SHA256, nonce: NONCE })

    expect(response.status).toBe('granted')
    expect(response.token?.imprintSha256).toBe(SHA256)
    expect(response.token?.policyOid).toBe('1.2.3.4.1')
    expect(response.token?.serialNumber).toBe('2')
    // The authority's clock, not ours. RFC 3339, from its GeneralizedTime.
    expect(response.token?.genTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(response.token?.token).toBe(Buffer.from(read('reply.tsr')).toString('base64'))
  })

  it('refuses a reply about a different hash', () => {
    // A cache or a proxy answering with somebody else's token. The seal it
    // attests to is the only thing that makes it evidence about ours.
    expect(() =>
      readTimeStampResponse(read('reply.tsr'), { sha256: 'a'.repeat(64), nonce: NONCE }),
    ).toThrow(/not the seal we asked about/)
  })

  it('refuses a reply whose nonce is not the one we sent', () => {
    expect(() =>
      readTimeStampResponse(read('reply.tsr'), { sha256: SHA256, nonce: '0000000000000001' }),
    ).toThrow(/answer to another question/)
  })

  it('reports a rejection rather than pretending there is a token', () => {
    // PKIStatusInfo { status 2 (rejection), statusString "bad request" }
    const rejection = fromHex('30143012020102300d0c0b6261642072657175657374')
    const response = readTimeStampResponse(rejection, { sha256: SHA256, nonce: NONCE })

    expect(response.status).toBe('rejection')
    expect(response.statusText).toBe('bad request')
    expect(response.token).toBeNull()
  })
})
