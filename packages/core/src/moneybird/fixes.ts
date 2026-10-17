/**
 * Fix type for every Moneybird finding code (issue #42 Phase 1).
 *
 * The shared FindingCard contract is `oneClick` | `guided` | `explainOnly`.
 * Some codes have more than one case (unknown_currency); callers pick the
 * variant from path / detail before looking up the fix.
 *
 * Honesty: unread ≠ empty ≠ reconciled. Codes that mean "could not read" or
 * "read and vacant" carry an honesty hint so the UI never paints them as
 * reconciled.
 *
 * Browser-safe: also exported as `@klopt/core/moneybird-fixes`. This module
 * must stay free of `node:crypto` / `node:fs` so the Moneybird screen can
 * import it without pulling the main `@klopt/core` barrel into the client.
 */

import type { MoneybirdProblem, MoneybirdProblemCode } from './plan.js'

/** FindingCard fix discriminator — kept identical to the web contract. */
export type MoneybirdFixType = 'oneClick' | 'guided' | 'explainOnly'

export type MoneybirdFixSeverity = 'blocking' | 'warning'

/** Which honesty claim a finding expresses, when it expresses one. */
export type MoneybirdFixHonesty = 'unread' | 'empty'

/**
 * Variants of `unknown_currency`: the same code, three different fixes.
 *
 * - `missing` — administration has no currency; one-click "Ja, dit is EUR".
 * - `administration` — books currency ≠ Moneybird currency; explain-only.
 * - `document` — one document needs a rate; guided Koers step.
 */
export type UnknownCurrencyVariant = 'missing' | 'administration' | 'document'

export interface MoneybirdFixSpec {
  readonly code: MoneybirdProblemCode
  readonly fixType: MoneybirdFixType
  /** Default severity when the planner emits this as a problem or warning. */
  readonly severity: MoneybirdFixSeverity
  /** Present when the finding itself is an honesty claim. */
  readonly honesty: MoneybirdFixHonesty | null
  /**
   * True when applying the fix may change journal amounts (needs a preview).
   * Mapping-only and acknowledgement fixes stay false.
   */
  readonly changesBooks: boolean
}

const SPECS: Readonly<Record<MoneybirdProblemCode, MoneybirdFixSpec>> = {
  unmapped_account: {
    code: 'unmapped_account',
    fixType: 'guided',
    severity: 'blocking',
    honesty: null,
    changesBooks: false,
  },
  unmapped_tax_rate: {
    code: 'unmapped_tax_rate',
    fixType: 'guided',
    severity: 'blocking',
    honesty: null,
    changesBooks: false,
  },
  trial_balance_account_missing: {
    code: 'trial_balance_account_missing',
    fixType: 'guided',
    severity: 'blocking',
    honesty: null,
    changesBooks: false,
  },
  account_number_collision: {
    code: 'account_number_collision',
    fixType: 'guided',
    severity: 'blocking',
    honesty: null,
    changesBooks: false,
  },
  contact_number_collision: {
    code: 'contact_number_collision',
    fixType: 'oneClick',
    severity: 'blocking',
    honesty: null,
    changesBooks: false,
  },
  derived_account_type: {
    code: 'derived_account_type',
    fixType: 'guided',
    severity: 'warning',
    honesty: null,
    changesBooks: false,
  },
  // Default for the catalogue; callers must use `fixForUnknownCurrency`.
  unknown_currency: {
    code: 'unknown_currency',
    fixType: 'guided',
    severity: 'blocking',
    honesty: null,
    changesBooks: true,
  },
  fiscal_year_start_unknown: {
    code: 'fiscal_year_start_unknown',
    fixType: 'oneClick',
    severity: 'warning',
    honesty: null,
    changesBooks: false,
  },
  fiscal_year_start_mismatch: {
    code: 'fiscal_year_start_mismatch',
    fixType: 'explainOnly',
    severity: 'blocking',
    honesty: null,
    changesBooks: false,
  },
  resource_unreadable: {
    code: 'resource_unreadable',
    fixType: 'guided',
    severity: 'warning',
    honesty: 'unread',
    changesBooks: false,
  },
  trial_balance_empty: {
    code: 'trial_balance_empty',
    fixType: 'oneClick',
    severity: 'warning',
    honesty: 'empty',
    changesBooks: false,
  },
  trial_balance_unbalanced: {
    code: 'trial_balance_unbalanced',
    fixType: 'guided',
    severity: 'blocking',
    honesty: null,
    changesBooks: false,
  },
  period_locked: {
    code: 'period_locked',
    fixType: 'guided',
    severity: 'blocking',
    honesty: null,
    changesBooks: false,
  },
  unbalanced_document: {
    code: 'unbalanced_document',
    fixType: 'explainOnly',
    severity: 'blocking',
    honesty: null,
    changesBooks: false,
  },
  attachment_without_url: {
    code: 'attachment_without_url',
    fixType: 'oneClick',
    severity: 'warning',
    honesty: null,
    changesBooks: false,
  },
  draft_skipped: {
    code: 'draft_skipped',
    fixType: 'explainOnly',
    severity: 'warning',
    honesty: null,
    changesBooks: false,
  },
}

const UNKNOWN_CURRENCY_SPECS: Readonly<Record<UnknownCurrencyVariant, MoneybirdFixSpec>> = {
  missing: {
    code: 'unknown_currency',
    fixType: 'oneClick',
    severity: 'warning',
    honesty: null,
    changesBooks: false,
  },
  administration: {
    code: 'unknown_currency',
    fixType: 'explainOnly',
    severity: 'blocking',
    honesty: null,
    changesBooks: false,
  },
  document: {
    code: 'unknown_currency',
    fixType: 'guided',
    severity: 'blocking',
    honesty: null,
    changesBooks: true,
  },
}

/** Every Moneybird problem code that has a documented fix. */
export const MONEYBIRD_PROBLEM_CODES: readonly MoneybirdProblemCode[] = Object.keys(
  SPECS,
) as MoneybirdProblemCode[]

export function fixSpecFor(code: MoneybirdProblemCode): MoneybirdFixSpec {
  return SPECS[code]
}

export function fixForUnknownCurrency(variant: UnknownCurrencyVariant): MoneybirdFixSpec {
  return UNKNOWN_CURRENCY_SPECS[variant]
}

/**
 * Which `unknown_currency` case a problem is.
 *
 * Administration-level findings use path `administration.currency`. A missing
 * currency is recorded as detail.currency `(none)`. Everything else is a
 * per-document rate step.
 */
export function unknownCurrencyVariantOf(
  problem: Pick<MoneybirdProblem, 'path' | 'detail'>,
): UnknownCurrencyVariant {
  if (problem.path === 'administration.currency') {
    return problem.detail['currency'] === '(none)' ? 'missing' : 'administration'
  }
  return 'document'
}

/** The fix spec that belongs to this concrete finding. */
export function fixSpecForProblem(problem: MoneybirdProblem): MoneybirdFixSpec {
  if (problem.code === 'unknown_currency') {
    return fixForUnknownCurrency(unknownCurrencyVariantOf(problem))
  }
  return fixSpecFor(problem.code)
}

/**
 * Honesty guard: a year that is unread or empty is never reconciled.
 *
 * Returns false when a caller would claim `reconciled` for a source that is
 * not a balanced read — the UI and the planner both refuse that claim.
 */
export function mayClaimReconciled(
  source: 'read' | 'empty' | 'unreadable',
  balanced: boolean | null,
): boolean {
  if (source === 'unreadable' || source === 'empty') return false
  return balanced === true
}

/**
 * Honesty for a finding code that carries one — never `reconciled`.
 *
 * `resource_unreadable` → unread. `trial_balance_empty` → empty. Acknowledging
 * an empty year records the acknowledgement; it does not promote the year to
 * reconciled.
 */
export function honestyForFinding(code: MoneybirdProblemCode): MoneybirdFixHonesty | null {
  return SPECS[code].honesty
}
