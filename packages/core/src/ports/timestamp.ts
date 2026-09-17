import type { TimeStampToken } from '../snapshot/rfc3161.js'

/**
 * Somebody outside who will say they saw a seal (spec 7.6).
 *
 * The sealed snapshot is the "prove nothing changed" artefact, and it is
 * complete except for one thing: it is entirely ours. The chain head, the
 * manifest and the seal all come from this instance, so an inspector asking
 * "and when was this sealed" has our own word for the date — in the one
 * situation where our word is what is in question.
 *
 * A timestamp authority closes that. It signs "I saw this hash at this time",
 * and the hash is 32 bytes over a manifest that is itself a few kilobytes, so
 * nothing about the administration leaves the building. It is the smallest
 * possible thing to tell a third party and the largest possible thing to be
 * able to prove.
 *
 * ## It never fails a seal
 *
 * `stamp` does not throw and does not reject. A seal is worth having without a
 * witness — it still detects a change, it just cannot date itself — and a
 * sealing run that failed because somebody else's HTTPS endpoint was down
 * would be a scheduled job that stops producing evidence for reasons nothing
 * to do with the books. So an unreachable authority is an outcome, recorded
 * with its reason, rather than an exception.
 */

export type TimestampOutcome =
  | {
      readonly kind: 'stamped'
      /** Where it came from, so an auditor knows whose certificate to fetch. */
      readonly authority: string
      readonly token: TimeStampToken
    }
  | {
      readonly kind: 'unavailable'
      /** Recorded on the snapshot. "There is no witness" needs a why. */
      readonly reason: string
    }

export interface TimestampWitness {
  /** `none`, or the authority's URL. Goes on the row and into the audit log. */
  readonly name: string
  /** @param sha256 The seal, lowercase hex. Nothing else is ever sent. */
  stamp(sha256: string): Promise<TimestampOutcome>
}
