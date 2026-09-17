import { resolveTimestampWitness } from '@klopt/adapters'
import type { TimestampWitness } from '@klopt/core'

/**
 * Who, if anybody, will say they saw a seal (spec 7.6, ADR 0058).
 *
 * None by default, per spec 8's first rule: a fresh install needs no third
 * party. `KLOPT_TIMESTAMP_URL` points at an RFC 3161 authority and the seals
 * taken from then on can prove their own date to somebody who does not take
 * our word for it.
 *
 * The choice lives in `@klopt/adapters` because the worker seals on a schedule
 * and makes the same one. Two processes disagreeing would leave a year of
 * snapshots where half can prove their date and half cannot, for no reason
 * anybody could reconstruct later.
 */

let witness: TimestampWitness | null = null

export function timestampWitness(): TimestampWitness {
  witness ??= resolveTimestampWitness(process.env)
  return witness
}

/** Test seam. */
export function setTimestampWitnessForTest(value: TimestampWitness | null): void {
  witness = value
}
