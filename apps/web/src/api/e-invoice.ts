import { createEmailEInvoiceTransport } from '@klopt/adapters'
import type { EInvoiceTransport } from '@klopt/core'
import { getEmailTransport } from './email.js'

/**
 * How an invoice leaves the building.
 *
 * One transport today: email, which is spec 8's rule 1 — the implementation
 * that needs no third party and is the default in a fresh install. A Peppol
 * access point is credential-gated per entity (spec 8, rule 2) and slots in
 * behind the same port; the reason it is not here is that it cannot be built or
 * tested without an account and a service provider agreement, not that the
 * shape is unclear.
 *
 * When it arrives, the choice becomes: ask each transport `reachable()` in
 * order of preference and use the first that says yes, which is what makes
 * spec 8's rule 4 — degrade to the fallback with a visible warning — a decision
 * made before sending rather than a recovery afterwards.
 */

let transport: EInvoiceTransport | null = null

export function eInvoiceTransport(): EInvoiceTransport {
  transport ??= createEmailEInvoiceTransport({ email: getEmailTransport() })
  return transport
}

/** Test seam. */
export function setEInvoiceTransportForTest(value: EInvoiceTransport | null): void {
  transport = value
}
