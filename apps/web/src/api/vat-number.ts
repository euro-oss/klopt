import { createOfflineVatNumberValidator, createViesValidator } from '@klopt/adapters'
import type { VatNumberValidator } from '@klopt/core'

/**
 * Who answers "is this VAT number valid".
 *
 * The offline validator is the default (spec 8, rule 1: every adapter family
 * has an implementation that needs no third party, and it is the default in a
 * fresh install). It checks the shape, records that nothing confirmed the
 * number, and lets the ICP opgaaf refuse to file — which is honest. The books
 * work; the zero-rate claim does not, because nothing has backed it.
 *
 * Set `KLOPT_VIES_ENDPOINT` to `default` to use the Commission's register, or
 * to a URL to point at a proxy — several member states' tax advisers run one,
 * and an install behind an egress filter needs one.
 */

const DEFAULT = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number'

let validator: VatNumberValidator | null = null

export function vatNumberValidator(): VatNumberValidator {
  if (validator !== null) return validator

  const configured = process.env['KLOPT_VIES_ENDPOINT']
  if (configured === undefined || configured === '') {
    validator = createOfflineVatNumberValidator()
  } else {
    validator = createViesValidator({
      endpoint: configured === 'default' ? DEFAULT : configured,
    })
  }
  return validator
}

/** Test seam. Nothing in the suite may reach a public register. */
export function setVatNumberValidatorForTest(value: VatNumberValidator | null): void {
  validator = value
}
