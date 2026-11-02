/**
 * Read-only Exact → Klopt VAT recognition for the import wizard (#100).
 *
 * A code is recognised only when its Exact code string, rate and side all
 * agree with a Klopt chart row (PM: when in doubt, leave it unrecognised).
 * There is no rate+side-only fallback and no code-only match. Sales, export,
 * EU and non-EU / reverse-charge descriptions stay unrecognised so they never
 * land on a domestic purchase code.
 *
 * This is display-only. Import still keeps an account's Exact default VAT only
 * when the Exact code string already exists on the chart (`planExactImport`).
 */

import { isSpecialAcquisitionPurchaseRate, type VatMatchRule } from '../moneybird/account-ranker.js'
import type { ExactVatCode } from './resources.js'

/** Klopt chart row shape needed to recognise an Exact VAT code. */
export type ExactVatKloptRule = VatMatchRule & {
  readonly description?: string
}

export interface ExactVatAccountRef {
  readonly number: string
  readonly name: string
  /** Exact VAT code on the GL account, when set. */
  readonly vatCode: string | null
}

export interface ExactVatMappingRow {
  readonly exactCode: string
  readonly exactName: string
  /** Percentage text as shown to humans, e.g. `21` or `0`. */
  readonly percentage: string
  readonly appliesTo: 'both' | 'purchase' | 'sales' | 'unknown'
  readonly reverseCharge: boolean
  /** Klopt code when recognised; null when not. */
  readonly kloptCode: string | null
  /** Klopt description when recognised. */
  readonly kloptLabel: string | null
  /**
   * GL accounts that reference this Exact code when Klopt does not recognise
   * it — they come over without a default btw-code on import today.
   */
  readonly accountsLosingDefault: readonly ExactVatAccountRef[]
  /** True when Exact code string equals an existing Klopt code and matched. */
  readonly codeMatch: boolean
}

export interface ExactVatMappingSummary {
  readonly rows: readonly ExactVatMappingRow[]
  readonly recognised: number
  /** Active (non-blocked) Exact VAT codes in the preview. */
  readonly codeCount: number
}

/** Exact stores the rate as a fraction; Klopt chart uses basis points. */
function percentageText(fraction: number): string {
  const percent = fraction * 100
  const rounded = Math.round(percent * 100) / 100
  return String(rounded)
}

function appliesTo(code: ExactVatCode): ExactVatMappingRow['appliesTo'] {
  switch (code.transactionType) {
    case 'B':
      return 'both'
    case 'P':
      return 'purchase'
    case 'S':
      return 'sales'
    default:
      return 'unknown'
  }
}

/** Exact percentage fraction → Klopt rateBasisPoints. */
function rateBasisPoints(fraction: number): number {
  return Math.round(fraction * 10000)
}

function sideAgrees(code: ExactVatCode, rule: ExactVatKloptRule): boolean {
  const side = appliesTo(code)
  if (side === 'sales') return rule.direction === 'output'
  if (side === 'purchase') return rule.direction === 'input'
  // Exact "both" / unknown never agrees with a single-direction Klopt row.
  return false
}

/**
 * Descriptions that must never auto-map to a domestic chart code — export,
 * EU / non-EU acquisition, reverse charge. Broader than Moneybird's purchase
 * helper so "buiten de EU", "export" and "uitvoer" also refuse (#161 QA).
 */
export function isUnrecognisedExactVatDescription(description: string): boolean {
  const text = description.toLowerCase()
  if (isSpecialAcquisitionPurchaseRate({ name: description })) return true
  return (
    /\bexport\b/.test(text) ||
    /\buitvoer\b/.test(text) ||
    /\bbuiten\s+de\s+eu\b/.test(text) ||
    /\bzero\s*rated\b/.test(text) ||
    /\beu-landen\b/.test(text) ||
    /\buit\s+eu\b/.test(text) ||
    /\bfrom\s+eu\b/.test(text) ||
    /\beu\s+service/.test(text) ||
    /\bservice\s+purchase/.test(text)
  )
}

function isSpecialExactVat(code: ExactVatCode): boolean {
  if (code.charged) return true
  return isUnrecognisedExactVatDescription(code.description)
}

/**
 * Pick the Klopt code Exact would map to for the read-only preview.
 *
 * Recognised only when code string, rate and side all agree with one Klopt
 * row. Specials (charged / export / EU / …) always stay unrecognised.
 */
export function recogniseExactVatCode(
  code: ExactVatCode,
  rules: readonly ExactVatKloptRule[],
): { readonly rule: ExactVatKloptRule; readonly codeMatch: boolean } | null {
  if (code.isBlocked) return null
  if (isSpecialExactVat(code)) return null

  const byCode = rules.find((rule) => rule.code === code.code)
  if (byCode === undefined) return null
  if (byCode.rateBasisPoints !== rateBasisPoints(code.percentage)) return null
  if (!sideAgrees(code, byCode)) return null

  return { rule: byCode, codeMatch: true }
}

/**
 * Build the read-only Exact VAT preview rows (#100 step 5 Exact).
 *
 * Blocked Exact codes are omitted (same as `planExactImport`). Accounts that
 * reference an Exact code which is not recognised are listed under
 * `accountsLosingDefault` — import drops their default today.
 */
export function mapExactVatCodes(args: {
  readonly vatCodes: readonly ExactVatCode[]
  readonly accounts: readonly ExactVatAccountRef[]
  readonly kloptRules: readonly ExactVatKloptRule[]
  /** Klopt tax code strings that already exist (for lose-default). */
  readonly existingTaxCodes: readonly string[]
}): ExactVatMappingSummary {
  const existing = new Set(args.existingTaxCodes)
  const active = args.vatCodes.filter((code) => !code.isBlocked)

  const rows: ExactVatMappingRow[] = active.map((code) => {
    const recognised = recogniseExactVatCode(code, args.kloptRules)
    const kloptCode = recognised?.rule.code ?? null
    const accountsLosingDefault =
      kloptCode === null ? args.accounts.filter((account) => account.vatCode === code.code) : []

    return {
      exactCode: code.code,
      exactName: code.description,
      percentage: percentageText(code.percentage),
      appliesTo: appliesTo(code),
      reverseCharge: code.charged,
      kloptCode,
      kloptLabel: recognised?.rule.description ?? recognised?.rule.code ?? null,
      accountsLosingDefault,
      // codeMatch only when the triple match succeeded — a bare string on the
      // chart that failed rate/side is not a match for the preview.
      codeMatch: recognised?.codeMatch === true && existing.has(code.code),
    }
  })

  return {
    rows,
    recognised: rows.filter((row) => row.kloptCode !== null).length,
    codeCount: rows.length,
  }
}
