/**
 * The vocabulary of the two cross-cutting reads (spec 10.3).
 *
 * Here rather than in the repository that implements them, because the query
 * schema in apps/web reaches the browser and @klopt/db does not. A list of
 * five strings is domain vocabulary; where the rows live is not.
 */

/** What a search looks in. Deliberately a closed list — see `discovery.search`. */
export type SearchResourceType =
  'contact' | 'sales-invoice' | 'purchase-invoice' | 'journal-entry' | 'document'

export const SEARCH_RESOURCE_TYPES: readonly [SearchResourceType, ...SearchResourceType[]] = [
  'contact',
  'sales-invoice',
  'purchase-invoice',
  'journal-entry',
  'document',
]
