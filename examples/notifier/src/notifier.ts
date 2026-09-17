/**
 * What to say about an event, having looked the resource up.
 *
 * This is the half of a module that is actually about the business. It takes a
 * verified event — a type and a reference, which is all Klopt sends — fetches
 * the thing it points at, and produces one line somebody could read in a chat
 * channel.
 *
 * The fetch is the interesting part. Klopt does not put the invoice in the
 * webhook, so a module has to ask for it with its own token, and Klopt checks
 * that token against the resource. A module whose token was narrowed, or
 * revoked, or scoped to another administration stops being able to see things
 * the moment that happens rather than the next time somebody remembers.
 */

/** Exactly what arrives in the body. See `docs/api-stability.md`. */
export interface KloptEvent {
  readonly id: string
  readonly occurredAt: string
  readonly type: string
  readonly version: number
  readonly entityId: string
  readonly resource: { readonly type: string | null; readonly id: string | null }
}

export interface Klopt {
  /** `GET /api/v1/...`, returning parsed JSON, or null when refused. */
  get(path: string): Promise<unknown>
}

/** The types this module acts on. Everything else is ignored, quietly. */
const INTERESTING = new Set([
  'sales.invoice.issued',
  'purchase.invoice.approved',
  'vat.return.filed',
])

export async function describe(klopt: Klopt, event: KloptEvent): Promise<string | null> {
  // Unknown types are skipped rather than refused. New ones appear without
  // warning — that is what the stability promise says — so a module that threw
  // on one it did not recognise would break itself on somebody else's release.
  if (!INTERESTING.has(event.type)) return null
  if (event.resource.id === null) return null

  switch (event.type) {
    case 'sales.invoice.issued': {
      const body = (await klopt.get(`/api/v1/sales-invoices/${event.resource.id}`)) as {
        invoice?: { number?: string; total?: string; contactName?: string }
      } | null

      const invoice = body?.invoice
      if (invoice === undefined) return null
      return `Factuur ${invoice.number ?? '?'} verstuurd aan ${invoice.contactName ?? 'onbekend'} — ${invoice.total ?? '?'}`
    }

    case 'purchase.invoice.approved': {
      const body = (await klopt.get(`/api/v1/purchase-invoices/${event.resource.id}`)) as {
        invoice?: { supplierInvoiceNumber?: string; total?: string; contactName?: string }
      } | null

      const invoice = body?.invoice
      if (invoice === undefined) return null
      return `Inkoopfactuur ${invoice.supplierInvoiceNumber ?? '?'} van ${invoice.contactName ?? 'onbekend'} is goedgekeurd voor betaling — ${invoice.total ?? '?'}`
    }

    case 'vat.return.filed':
      // No fetch: the filing endpoint needs a period code this event does not
      // carry, and "the aangifte is in" is the whole message anyway. A module
      // that fetched something it did not need would be spending somebody's
      // rate limit to say the same thing.
      return 'De BTW-aangifte is ingediend.'

    default:
      return null
  }
}
