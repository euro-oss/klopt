import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signing a webhook (spec 10.2: "signed payloads").
 *
 * The receiver has to be able to answer two questions: did this come from the
 * Klopt instance I connected, and is it happening now. A bare HMAC over the
 * body answers only the first — anybody who captured a delivery once can send
 * it again for as long as the secret lives, and "invoice issued" replayed a
 * month later is a real thing to be able to do to somebody's integration.
 *
 * So the timestamp is *inside* the signed material. It cannot be adjusted
 * without invalidating the signature, and the receiver refuses anything too
 * old. This is the scheme Stripe and GitHub converged on independently, which
 * is the strongest argument available for not inventing a third.
 *
 *     Klopt-Signature: t=1789124845,v1=9f86d0818...
 *
 * `v1` is the scheme version, not the event version. A second scheme would be
 * sent alongside as `v2` so a receiver can migrate without downtime.
 */

/** How much clock skew a receiver should tolerate. Five minutes, both ways. */
export const SIGNATURE_TOLERANCE_SECONDS = 300

/** The bytes that get signed: the timestamp, a dot, the body. */
function signedPayload(timestamp: number, body: string): string {
  return `${String(timestamp)}.${body}`
}

/** The header value to send. `timestamp` is epoch seconds. */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  const digest = createHmac('sha256', secret).update(signedPayload(timestamp, body)).digest('hex')
  return `t=${String(timestamp)},v1=${digest}`
}

export type SignatureVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'malformed' | 'stale' | 'mismatch' }

/**
 * Check a header against a body.
 *
 * Exported because it is the reference implementation: a receiver in this
 * repository — a test, an example, a first-party module — should not be
 * writing its own, and neither should the documentation be describing one in
 * prose that drifts from what is sent.
 */
export function verifyWebhook(
  secret: string,
  body: string,
  header: string,
  now: number,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): SignatureVerdict {
  const parts = new Map(
    header.split(',').map((part) => {
      const index = part.indexOf('=')
      return index === -1
        ? ([part.trim(), ''] as const)
        : ([part.slice(0, index).trim(), part.slice(index + 1).trim()] as const)
    }),
  )

  const timestamp = Number(parts.get('t'))
  const provided = parts.get('v1')
  if (!Number.isFinite(timestamp) || provided === undefined || provided === '') {
    return { ok: false, reason: 'malformed' }
  }

  // Before the comparison, not after: a stale signature is a valid signature,
  // and the whole point is to refuse it anyway.
  if (Math.abs(now - timestamp) > toleranceSeconds) return { ok: false, reason: 'stale' }

  const expected = createHmac('sha256', secret).update(signedPayload(timestamp, body)).digest()
  let supplied: Buffer
  try {
    supplied = Buffer.from(provided, 'hex')
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  // `timingSafeEqual` throws on a length mismatch rather than returning false,
  // and the length is not a secret, so it is checked first.
  if (supplied.length !== expected.length) return { ok: false, reason: 'mismatch' }
  return timingSafeEqual(supplied, expected) ? { ok: true } : { ok: false, reason: 'mismatch' }
}
