import type { TimestampWitness } from '@klopt/core'
import { createNoTimestampWitness } from './none.js'
import { createRfc3161Witness } from './rfc3161.js'

export interface TimestampEnvironment {
  readonly KLOPT_TIMESTAMP_URL?: string | undefined
  readonly KLOPT_TIMESTAMP_POLICY_OID?: string | undefined
}

/**
 * One choice, made in one place, because the worker seals on a schedule and
 * the API seals on request. Two processes disagreeing about whether seals are
 * witnessed would leave a year of snapshots where half can prove their date.
 */
export function resolveTimestampWitness(environment: TimestampEnvironment): TimestampWitness {
  const url = environment.KLOPT_TIMESTAMP_URL?.trim() ?? ''
  if (url === '') return createNoTimestampWitness()

  return createRfc3161Witness({
    url,
    ...(environment.KLOPT_TIMESTAMP_POLICY_OID == null
      ? {}
      : { policyOid: environment.KLOPT_TIMESTAMP_POLICY_OID }),
  })
}
