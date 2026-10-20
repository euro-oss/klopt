/**
 * Helpers for Moneybird tax-mapping save + 422 handling (#71 PM).
 *
 * `setTaxMappings` must not leave a rejected code looking mapped: roll back
 * paths in `violations[]` under `taxRates.<id>` to the previous value.
 * Display uses `finding.<messageKey>` (NL/EN), falling back to `message`.
 */

import { detailForDisplay } from './finding-card.js'
import type { MessageKey } from '../i18n/nl.js'

export interface TaxMappingViolation {
  readonly path?: string | null
  readonly message?: string
  readonly code?: string
  readonly messageKey?: string | null
  readonly detail?: Readonly<Record<string, string>>
}

/** One rate’s inline error after a saveMappings 422. */
export interface TaxMappingViolationView {
  readonly message: string
  readonly messageKey: string | null
}

type Translate = (key: MessageKey, values?: Readonly<Record<string, string>>) => string

/** Localise a violation via `finding.<messageKey>`, else the English `message`. */
export function formatTaxViolationMessage(t: Translate, violation: TaxMappingViolation): string {
  const messageKey = violation.messageKey?.trim() ?? ''
  if (messageKey !== '') {
    const key = `finding.${messageKey}` as MessageKey
    const translated = t(key, detailForDisplay(violation.detail))
    if (translated !== undefined && translated !== key && !translated.startsWith('finding.')) {
      return translated
    }
  }
  return (violation.message ?? '').trim()
}

/** Index `taxRates.<id>` into display-ready messages (localised when possible). */
export function taxViolationsByRateId(
  violations: readonly TaxMappingViolation[],
  t: Translate,
): Readonly<Record<string, TaxMappingViolationView>> {
  const byRate: Record<string, TaxMappingViolationView> = {}
  for (const row of violations) {
    const path = row.path ?? ''
    const match = /^taxRates\.(.+)$/.exec(path)
    if (match === null) continue
    const id = match[1]
    if (id === undefined || id === '') continue
    const message = formatTaxViolationMessage(t, row)
    if (message === '') continue
    byRate[id] = {
      message,
      messageKey: row.messageKey?.trim() || null,
    }
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

/** Apply a 422: index violations, roll back rejected rates, return both. */
export function applyTaxMappingSaveFailure(input: {
  readonly previous: Readonly<Record<string, string>>
  readonly attempted: Readonly<Record<string, string>>
  readonly violations: readonly TaxMappingViolation[]
  readonly t: Translate
}): {
  readonly taxMappings: Record<string, string>
  readonly taxViolations: Readonly<Record<string, TaxMappingViolationView>>
  readonly rejectedIds: readonly string[]
} {
  const taxViolations = taxViolationsByRateId(input.violations, input.t)
  const rejectedIds = Object.keys(taxViolations)
  const taxMappings =
    rejectedIds.length > 0
      ? rollbackRejectedTaxMappings({
          previous: input.previous,
          attempted: input.attempted,
          rejectedIds: new Set(rejectedIds),
        })
      : { ...input.previous }
  return { taxMappings, taxViolations, rejectedIds }
}

/** Scroll the first rejected `moneybird-tax-<id>` row into view (#71 PM). */
export function scrollTaxMappingViolationIntoView(rateId: string): void {
  if (rateId === '') return
  requestAnimationFrame(() => {
    document.getElementById(`moneybird-tax-${rateId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  })
}
