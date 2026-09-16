import { createHash } from 'node:crypto'

/**
 * Optimistic concurrency (spec 10.2).
 *
 * > Optimistic concurrency on mutable resources.
 *
 * Most of this ledger is immutable — a posted entry cannot be edited, which is
 * the whole point of it — so the question only arises on the few resources
 * that can be changed in place: a contact, and the administration's own
 * settings. Both are forms two people can have open at once, and without this
 * the second save silently overwrites the first.
 *
 * ## Over the resource, not the representation
 *
 * The obvious implementation hashes the response body, and it is wrong here.
 * `GET /contacts/:id` includes how many invoices are open against them, which
 * changes when somebody in another room issues one. A precondition computed
 * over that would refuse an edit because of activity that has nothing to do
 * with the fields being edited.
 *
 * So the tag is over the resource's own editable state, and the same function
 * produces it on the way out and checks it on the way in. Anything the caller
 * cannot change does not belong in it.
 *
 * ## Why not a version column
 *
 * Neither table has one, and neither has an `updated_at` either — so this
 * would be a migration on two tables plus the discipline to maintain it.
 * Hashing the state is exact in a way a timestamp is not: two writes in the
 * same millisecond are distinguishable, and a write that changes nothing
 * produces the same tag, which is the correct answer to "has this moved".
 */

/** A strong entity tag over a resource's editable state. */
export function etagOf(resource: unknown): string {
  return `"${createHash('sha256').update(stableJson(resource)).digest('hex').slice(0, 32)}"`
}

/**
 * JSON with object keys in a fixed order.
 *
 * `JSON.stringify` follows insertion order, so the same contact serialised by
 * two code paths that build the object differently would hash differently.
 * Sorting removes that as a source of spurious 412s.
 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)

  return `{${entries.join(',')}}`
}
