import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Checking a Klopt webhook signature.
 *
 * Written from `docs/api-stability.md` and the header format, **not** imported
 * from `@klopt/core`. That is the point of this example: an integrator has no
 * access to Klopt's internals, so if the scheme cannot be reimplemented in
 * thirty lines from the documentation, the documentation is wrong.
 *
 * The header looks like:
 *
 *     Klopt-Signature: t=1789124845,v1=9f86d0818...
 *
 * `v1` is HMAC-SHA256 over `${t}.${rawBody}`, keyed with the signing secret
 * shown once when the endpoint was created.
 *
 * Two things a receiver must do and it is easy to do only the first:
 *
 *   1. Compare the digest in constant time.
 *   2. Refuse a timestamp outside a tolerance. The timestamp is inside the
 *      signed material, so it cannot be moved — but a delivery captured an
 *      hour ago carries a perfectly valid signature, and acting on it twice is
 *      exactly what an attacker who captured it wants.
 *
 * Verify against the **raw body bytes**, before parsing. `JSON.parse` followed
 * by `JSON.stringify` does not round-trip whitespace or key order, and the
 * signature is over what was sent.
 */

const TOLERANCE_SECONDS = 300

export type Verdict = 'ok' | 'malformed' | 'stale' | 'mismatch'

export function verify(
  secret: string,
  rawBody: string,
  header: string,
  nowSeconds: number,
): Verdict {
  const fields = new Map<string, string>()
  for (const part of header.split(',')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    fields.set(part.slice(0, index).trim(), part.slice(index + 1).trim())
  }

  const timestamp = Number(fields.get('t'))
  const provided = fields.get('v1')
  if (!Number.isFinite(timestamp) || provided === undefined || provided === '') return 'malformed'

  if (Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) return 'stale'

  const expected = createHmac('sha256', secret)
    .update(`${String(timestamp)}.${rawBody}`)
    .digest()

  let supplied: Buffer
  try {
    supplied = Buffer.from(provided, 'hex')
  } catch {
    return 'malformed'
  }

  // `timingSafeEqual` throws when the lengths differ, and a malformed delivery
  // must not crash the receiver.
  if (supplied.length !== expected.length) return 'mismatch'
  return timingSafeEqual(supplied, expected) ? 'ok' : 'mismatch'
}
