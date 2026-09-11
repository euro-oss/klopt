/**
 * The public event catalogue (spec 9.3, 10.2).
 *
 * Every state change worth telling somebody about emits a versioned event in
 * the same transaction that made it. This file is the list of what those are,
 * and it is a **contract**: an integrator writes code against these names, so
 * removing one or changing what it means breaks software this project does not
 * own. See `docs/api-stability.md`.
 *
 * ## Events are thin, deliberately
 *
 * An event carries what happened and which resource it happened to. It does
 * **not** carry the resource. Three reasons, and the third is the one that
 * settles it:
 *
 *   1. A payload is a second copy of a shape the REST API already defines, and
 *      two definitions of an invoice drift.
 *   2. It would freeze internal field names into a public contract by
 *      accident, which is how a refactor becomes a breaking change.
 *   3. **It would put personal data in a webhook.** A payload leaves the
 *      instance, lands in somebody's logs and is retried into them; a resource
 *      reference makes the consumer come back and ask, with their own token,
 *      and be refused if their access has since been taken away. After the
 *      erasure work in ADR 0039 it would be strange to spend the afternoon
 *      removing a contact's phone number from the database and the evening
 *      posting it to four subscribers.
 *
 * So: `sales.invoice.issued` with an id. Then `GET /api/v1/sales-invoices/:id`
 * if you want to know more, and the permission check happens there.
 *
 * ## Versioning
 *
 * The version is on the event, not on the endpoint. A consumer that
 * understands v1 keeps working when v2 appears alongside it, and a v2 is only
 * needed if the *meaning* changes — the shape barely can, being a reference.
 */

/**
 * Every event this system publishes.
 *
 * Adding one is ordinary. Removing or renaming one is a breaking change to a
 * published contract, and `docs/api-stability.md` says what that costs.
 */
export const EVENT_TYPES = {
  'ledger.entry.posted': {
    version: 1,
    resource: 'journal_entry',
    summary: 'A journal entry was posted. Immutable from this moment.',
  },
  'sales.invoice.issued': {
    version: 1,
    resource: 'sales_invoice',
    summary: 'A sales invoice took a number and posted. It can no longer be edited.',
  },
  'sales.invoice.sent': {
    version: 1,
    resource: 'sales_invoice',
    summary: 'A sales invoice was delivered, or delivery was attempted.',
  },
  'purchase.invoice.booked': {
    version: 1,
    resource: 'purchase_invoice',
    summary: 'A purchase invoice posted: the liability and the input VAT now exist.',
  },
  'purchase.invoice.approved': {
    version: 1,
    resource: 'purchase_invoice',
    summary: 'A purchase invoice was authorised for payment.',
  },
  'vat.return.filed': {
    version: 1,
    resource: 'vat_filing',
    summary: 'A BTW-aangifte was filed, and its periods are soft-closed.',
  },
} as const

export type EventType = keyof typeof EVENT_TYPES

/** What a consumer reads off `/api/v1/events`. */
export interface PublishedEvent {
  /** Also the dedup id. Monotonic, so it doubles as the cursor. */
  readonly id: string
  readonly occurredAt: string
  readonly type: EventType
  readonly version: number
  /** Which administration it happened in. */
  readonly entityId: string
  readonly resource: { readonly type: string; readonly id: string }
}

/** The version to stamp on a freshly emitted event of this type. */
export function versionOf(type: EventType): number {
  return EVENT_TYPES[type].version
}

/** The resource kind an event of this type points at. */
export function resourceOf(type: EventType): string {
  return EVENT_TYPES[type].resource
}
