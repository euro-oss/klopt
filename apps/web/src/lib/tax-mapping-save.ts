/**
 * Helpers for Moneybird tax-mapping save + 422 handling (#71 PM / Designer).
 *
 * `setTaxMappings` must not leave a rejected code looking mapped: roll back
 * paths in `violations[]` under `taxRates.<id>` to the previous value.
 * Display leads with a plain rollback line, then the finding explanation.
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
  readonly rejected: string
  readonly current: string
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

/**
 * Plain je-voice lead: what was rejected vs what stays, then the finding reason.
 */
export function formatTaxMappingRollbackMessage(input: {
  readonly t: Translate
  readonly rejected: string
  readonly current: string
  readonly reason: string
}): string {
  const lead =
    input.current.trim() === ''
      ? input.t('moneybird.taxMapping.rollbackCleared', { rejected: input.rejected })
      : input.t('moneybird.taxMapping.rollback', {
          rejected: input.rejected,
          current: input.current,
        })
  const reason = input.reason.trim()
  if (reason === '') return lead
  return `${lead} ${reason}`
}

/** Index `taxRates.<id>` into display-ready messages (localised when possible). */
export function taxViolationsByRateId(
  violations: readonly TaxMappingViolation[],
  t: Translate,
  codes?: {
    readonly previous: Readonly<Record<string, string>>
    readonly attempted: Readonly<Record<string, string>>
  },
): Readonly<Record<string, TaxMappingViolationView>> {
  const byRate: Record<string, TaxMappingViolationView> = {}
  for (const row of violations) {
    const path = row.path ?? ''
    if (path === '') continue
    const match = /^taxRates\.(.+)$/.exec(path)
    if (match === null) continue
    const id = match[1]
    if (id === undefined || id === '') continue
    const reason = formatTaxViolationMessage(t, row)
    const rejected = (codes?.attempted[id] ?? row.detail?.['mappedCode'] ?? '').trim()
    const current = (codes?.previous[id] ?? '').trim()
    // Blank English message and no messageKey → nothing to show.
    if (reason === '' && rejected === '') continue
    const message =
      rejected !== '' ? formatTaxMappingRollbackMessage({ t, rejected, current, reason }) : reason
    if (message === '') continue
    byRate[id] = {
      message,
      messageKey: row.messageKey?.trim() || null,
      rejected,
      current,
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
  const taxViolations = taxViolationsByRateId(input.violations, input.t, {
    previous: input.previous,
    attempted: input.attempted,
  })
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

/**
 * Scroll the first rejected `moneybird-tax-<id>` row into view and focus its
 * input. Respects prefers-reduced-motion (#71 Designer).
 */
export function scrollTaxMappingViolationIntoView(rateId: string): void {
  if (rateId === '') return
  requestAnimationFrame(() => {
    const reduce =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const row = document.getElementById(`moneybird-tax-${rateId}`)
    row?.scrollIntoView({
      behavior: reduce ? 'auto' : 'smooth',
      block: 'center',
    })
    const input = row?.querySelector('input')
    if (input instanceof HTMLElement) input.focus({ preventScroll: true })
  })
}
