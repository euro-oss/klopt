/**
 * Helpers for Moneybird tax-mapping save + 422 handling (#71 PM).
 *
 * `setTaxMappings` must not leave a rejected code looking mapped (CI nudge): roll back
 * paths in `violations[]` under `taxRates.<id>` to the previous value.
 */

export interface TaxMappingViolation {
  readonly path?: string | null
  readonly message?: string
  readonly code?: string
}

/** Index `taxRates.<moneybirdId>` violation messages for inline display. */
export function taxViolationsByRateId(
  violations: readonly TaxMappingViolation[],
): Readonly<Record<string, string>> {
  const byRate: Record<string, string> = {}
  for (const row of violations) {
    const path = row.path ?? ''
    const match = /^taxRates\.(.+)$/.exec(path)
    if (match === null) continue
    const id = match[1]
    if (id === undefined || id === '') continue
    const message = (row.message ?? '').trim()
    if (message === '') continue
    byRate[id] = message
  }
  return byRate
}

/**
 * After a 422, restore each rejected rate to its pre-attempt value (or drop it
 * when it was newly added). Untouched rates keep the attempted mapping.
 */
export function rollbackRejectedTaxMappings(input: {
  readonly previous: Readonly<Record<string, string>>
  readonly attempted: Readonly<Record<string, string>>
  readonly rejectedIds: ReadonlySet<string>
}): Record<string, string> {
  const next: Record<string, string> = { ...input.attempted }
  for (const id of input.rejectedIds) {
    const prior = input.previous[id]
    if (prior !== undefined && prior !== '') next[id] = prior
    else delete next[id]
  }
  return next
}
