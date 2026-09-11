import { describe, expect, it } from 'vitest'
import { signWebhook, verifyWebhook } from '../../src/events/signature.js'

/**
 * Webhook signatures (spec 10.2).
 *
 * The receiver has to be able to tell that a delivery came from the instance
 * they connected, and that it is happening now. The second half is the one
 * that is easy to leave out and expensive to leave out.
 */

const SECRET = 'whsec_test_0123456789'
const BODY = '{"id":"01890000-0000-7000-8000-000000000001","type":"sales.invoice.issued"}'
const NOW = 1_789_124_845

describe('signing a webhook', () => {
  it('verifies what it signed', () => {
    const header = signWebhook(SECRET, BODY, NOW)
    expect(verifyWebhook(SECRET, BODY, header, NOW)).toEqual({ ok: true })
  })

  it('carries the timestamp and the scheme version in the header', () => {
    // The format is part of the contract: a receiver parses it.
    expect(signWebhook(SECRET, BODY, NOW)).toMatch(/^t=1789124845,v1=[0-9a-f]{64}$/)
  })

  it('refuses a body that changed by one character', () => {
    const header = signWebhook(SECRET, BODY, NOW)
    const tampered = BODY.replace('sales.invoice.issued', 'sales.invoice.issueD')
    expect(verifyWebhook(SECRET, tampered, header, NOW)).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('refuses the wrong secret', () => {
    const header = signWebhook(SECRET, BODY, NOW)
    expect(verifyWebhook('whsec_someone_else', BODY, header, NOW)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })

  it('refuses a replay from an hour ago, even though the signature is genuine', () => {
    // The reason the timestamp is inside the signed material rather than
    // beside it. This delivery really was signed by us; it is simply not
    // happening now, and an integration that acts on it acts twice.
    const header = signWebhook(SECRET, BODY, NOW - 3600)
    expect(verifyWebhook(SECRET, BODY, header, NOW)).toEqual({ ok: false, reason: 'stale' })
  })

  it('refuses a timestamp from the future by the same margin', () => {
    const header = signWebhook(SECRET, BODY, NOW + 3600)
    expect(verifyWebhook(SECRET, BODY, header, NOW)).toEqual({ ok: false, reason: 'stale' })
  })

  it('tolerates the clock skew a real receiver has', () => {
    const header = signWebhook(SECRET, BODY, NOW - 120)
    expect(verifyWebhook(SECRET, BODY, header, NOW)).toEqual({ ok: true })
  })

  it('will not let a moved timestamp buy a fresh window', () => {
    // Editing `t=` to something recent is the obvious attack on a scheme that
    // signs only the body. It fails here because `t` is signed.
    const genuine = signWebhook(SECRET, BODY, NOW - 3600)
    const digest = genuine.split('v1=')[1]!
    const moved = `t=${String(NOW)},v1=${digest}`

    expect(verifyWebhook(SECRET, BODY, moved, NOW)).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('says so rather than throwing on a header that is not one', () => {
    for (const header of ['', 'nonsense', 't=abc,v1=def', `t=${String(NOW)}`, 'v1=deadbeef']) {
      expect(verifyWebhook(SECRET, BODY, header, NOW).ok).toBe(false)
    }
  })

  it('refuses a digest of the wrong length without throwing', () => {
    // `timingSafeEqual` throws on a length mismatch, which would turn a
    // malformed delivery into a crashed receiver.
    expect(verifyWebhook(SECRET, BODY, `t=${String(NOW)},v1=ab`, NOW)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })
})
