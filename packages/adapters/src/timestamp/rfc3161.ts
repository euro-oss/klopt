import { randomBytes } from 'node:crypto'
import {
  TIMESTAMP_QUERY_MEDIA_TYPE,
  TIMESTAMP_REPLY_MEDIA_TYPE,
  encodeTimeStampRequest,
  readTimeStampResponse,
  toHex,
  type TimestampOutcome,
  type TimestampWitness,
} from '@klopt/core'

/**
 * A timestamp authority over HTTP (RFC 3161 §3.4).
 *
 * The protocol is a POST of a DER request and a DER reply, with no
 * authentication and no session: there is nothing to configure beyond a URL,
 * which is the point — an operator can point this at their notary, their
 * national authority, or a free public one, and change it later without
 * changing anything about the seals already taken.
 */

export interface Rfc3161Options {
  /** The authority's endpoint, e.g. `https://freetsa.org/tsr`. */
  readonly url: string
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
  /** A policy the authority publishes, when it requires one to be named. */
  readonly policyOid?: string | null
  /**
   * Ask for the signing certificate in the token.
   *
   * On by default. A token nobody can check without separately obtaining the
   * signer's certificate is evidence that needs a phone call, seven years
   * later, to an authority that may no longer exist.
   */
  readonly certReq?: boolean
}

export function createRfc3161Witness(options: Rfc3161Options): TimestampWitness {
  const doFetch = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 10_000

  return {
    name: options.url,

    async stamp(sha256: string): Promise<TimestampOutcome> {
      // Eight random bytes, per request. It is what ties the reply to this
      // question rather than to one somebody made earlier.
      const nonce = toHex(randomBytes(8))
      const request = encodeTimeStampRequest({
        sha256,
        nonce,
        ...(options.policyOid == null ? {} : { policyOid: options.policyOid }),
        ...(options.certReq === undefined ? {} : { certReq: options.certReq }),
      })

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await doFetch(options.url, {
          method: 'POST',
          headers: {
            'content-type': TIMESTAMP_QUERY_MEDIA_TYPE,
            accept: TIMESTAMP_REPLY_MEDIA_TYPE,
          },
          // A fresh ArrayBuffer rather than the view: a Uint8Array over a
          // pooled buffer is not a `BodyInit`, and slicing is the honest fix.
          body: request.slice().buffer,
          signal: controller.signal,
        })

        if (!response.ok) {
          return {
            kind: 'unavailable',
            reason: `${options.url} answered ${String(response.status)}.`,
          }
        }

        const bytes = new Uint8Array(await response.arrayBuffer())
        const reply = readTimeStampResponse(bytes, { sha256, nonce })

        if (reply.token === null) {
          return {
            kind: 'unavailable',
            reason: `${options.url} refused the request: ${reply.status}${
              reply.statusText === null ? '' : ` (${reply.statusText})`
            }.`,
          }
        }

        return { kind: 'stamped', authority: options.url, token: reply.token }
      } catch (error: unknown) {
        /**
         * Everything, including a reply that does not parse.
         *
         * A seal is worth having without a witness, and a sealing run that
         * failed because somebody else's endpoint was down would be a
         * scheduled job that stops producing evidence for reasons nothing to
         * do with the books. The reason is recorded on the snapshot instead.
         */
        return {
          kind: 'unavailable',
          reason: `${options.url} could not be used: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}
