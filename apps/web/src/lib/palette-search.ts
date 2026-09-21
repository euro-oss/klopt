/**
 * What a search hit is, and where `Enter` on one goes.
 *
 * `GET /search` answers with a flat list of places to look — five resource
 * types, each hit carrying the API path that reads the whole thing (spec 10.3).
 * A palette needs two things that list does not have: the hits gathered under
 * the heading a reader recognises, and the *screen* each one opens, which is
 * not the API path.
 *
 * Both are decided here, as functions over plain data, for the same reason
 * every other keyboard rule in this application is: so they are tested by
 * naming a hit rather than by driving a browser.
 */

import type { MessageKey } from '~/i18n/nl'

/** A hit, as `discovery.search` serialises one. */
export interface SearchHit {
  readonly type: string
  readonly id: string
  readonly title: string
  readonly subtitle: string | null
  readonly date: string | null
  readonly amountMinorUnits: string | null
  readonly currency: string | null
  /** Relative to /api/v1, which is not where the reader is going. */
  readonly path: string
  readonly rank: number
}

/**
 * The shortest query the server will answer.
 *
 * `searchQuery` requires two characters, and a request that comes back 422
 * would show a validation problem to somebody who has simply not finished
 * typing. So one character searches the navigation and nothing else.
 */
export const MIN_SEARCH_LENGTH = 2

/**
 * How long the palette waits before asking.
 *
 * Long enough that typing `debiteuren` is one request rather than nine, short
 * enough to feel like the list is following the keys. The palette's navigation
 * entries filter on every keystroke regardless — those are in memory, and
 * making them wait for the network would be slower than before search existed.
 */
export const SEARCH_DEBOUNCE_MS = 180

export function isSearchable(query: string): boolean {
  return query.trim().length >= MIN_SEARCH_LENGTH
}

/**
 * The order the groups appear in, and what each is called.
 *
 * Fixed rather than "whatever the results happen to contain first", so the
 * palette does not reorder itself while somebody is reading it. A type the
 * server grows that is not listed here still shows, under its own raw name —
 * missing from this table is a reason to show a hit plainly, never to hide it.
 */
export const SEARCH_GROUPS: readonly { readonly type: string; readonly label: MessageKey }[] = [
  { type: 'contact', label: 'search.group.contact' },
  { type: 'sales-invoice', label: 'search.group.salesInvoice' },
  { type: 'purchase-invoice', label: 'search.group.purchaseInvoice' },
  { type: 'journal-entry', label: 'search.group.journalEntry' },
  { type: 'document', label: 'search.group.document' },
]

export interface SearchGroup {
  readonly type: string
  readonly label: MessageKey | null
  readonly hits: readonly SearchHit[]
}

/**
 * The hits, grouped by kind, in the order above.
 *
 * Empty groups are dropped: a palette listing "Documenten — nothing" for every
 * search is a palette that pushes the answer off the screen.
 */
export function groupHits(hits: readonly SearchHit[]): readonly SearchGroup[] {
  const known = SEARCH_GROUPS.map(({ type, label }) => ({
    type,
    label,
    hits: hits.filter((hit) => hit.type === type),
  }))

  const others = [...new Set(hits.map((hit) => hit.type))]
    .filter((type) => !SEARCH_GROUPS.some((group) => group.type === type))
    .map((type) => ({ type, label: null, hits: hits.filter((hit) => hit.type === type) }))

  return [...known, ...others].filter((group) => group.hits.length > 0)
}

/** The groups flattened back out, so an index into the list means one hit. */
export function flattenGroups(groups: readonly SearchGroup[]): readonly SearchHit[] {
  return groups.flatMap((group) => group.hits)
}

/**
 * Where a hit opens.
 *
 * A route for the four kinds that have a screen, and the document itself for
 * the fifth: a bijlage in het postvak is read by opening the file, which is
 * what the postvak's own link does. Returning the API path for it rather than
 * inventing a viewer keeps "Enter opens the right record" true without adding
 * a screen this issue did not ask for.
 *
 * A type with neither is `null`, and the palette shows the hit without making
 * it activatable — better than a row that navigates to nowhere.
 */
export type SearchDestination =
  | { readonly kind: 'route'; readonly to: string; readonly params: Record<string, string> }
  | { readonly kind: 'download'; readonly href: string }

export function destinationOf(hit: SearchHit): SearchDestination | null {
  switch (hit.type) {
    case 'contact':
      return { kind: 'route', to: '/contacts/$contactId', params: { contactId: hit.id } }
    case 'sales-invoice':
      return { kind: 'route', to: '/invoices/$invoiceId', params: { invoiceId: hit.id } }
    case 'purchase-invoice':
      return { kind: 'route', to: '/purchases/$invoiceId', params: { invoiceId: hit.id } }
    case 'journal-entry':
      return { kind: 'route', to: '/entries/$entryId', params: { entryId: hit.id } }
    case 'document':
      return { kind: 'download', href: `/api/v1/documents/${hit.id}` }
    default:
      return null
  }
}
