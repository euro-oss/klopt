import type { TimestampOutcome, TimestampWitness } from '@klopt/core'

/**
 * No witness, which is the default.
 *
 * Spec 8's first rule: the implementation that needs no third party is what a
 * fresh install gets. A seal without a witness still detects a change — it
 * just cannot prove its own date to somebody who does not take our word for
 * it, and the snapshot says so in as many words rather than leaving a null
 * that could mean anything.
 */
export function createNoTimestampWitness(): TimestampWitness {
  return {
    name: 'none',
    stamp(): Promise<TimestampOutcome> {
      return Promise.resolve({
        kind: 'unavailable',
        reason:
          'No timestamp authority is configured, so this seal has only our word for its date. Set KLOPT_TIMESTAMP_URL to an RFC 3161 endpoint.',
      })
    },
  }
}
