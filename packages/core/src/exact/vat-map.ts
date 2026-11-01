/**
 * Read-only Exact → Klopt VAT recognition for the import wizard (#100).
 *
 * Exact administrations name codes freely (`1`, `H`, `BTW21`). Klopt recognises
 * a code when its string already exists here, or when exactly one plain
 * domestic primary chart code fits the Exact rate and side — the same ranking
 * Moneybird uses. Reverse-charge / EU / export names stay unrecognised so the
 * wizard can show an honest "Klopt herkent deze niet" without inventing a map.
 *
 * This is display-only. Import still keeps an account's Exact default VAT only
 * when the Exact code string already exists on the chart (`planExactImport`).
 */

import {
  isSpecialAcquisitionPurchaseRate,
  rankVatCodes,
  type VatMatchRule,
} from '../moneybird/account-ranker.js'
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
  /** True when Exact code string equals an existing Klopt code. */
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

function sideHint(description: string): 'sales' | 'purchase' | null {
  const text = description.toLowerCase()
  if (/inkoop|purchase|ink\.|ink /.test(text)) return 'purchase'
  if (/verkoop|sales|verk\.|verk /.test(text)) return 'sales'
  return null
}

function isSpecialExactVat(code: ExactVatCode): boolean {
  if (code.charged) return true
  return isSpecialAcquisitionPurchaseRate({ name: code.description })
}

/**
 * Bare "geen btw" at 0% without EU/export wording — design maps this to VGEEN.
 */
function isPlainGeenBtw(code: ExactVatCode): boolean {
  if (code.percentage !== 0) return false
  if (isSpecialExactVat(code)) return false
  const text = code.description.toLowerCase()
  return /geen\s*btw|geen\s*btw\.|niet van toepassing|no\s*vat|zero\s*rated/.test(text)
}

function recogniseByRate(
  code: ExactVatCode,
  rules: readonly ExactVatKloptRule[],
  taxRateType: 'sales_invoice' | 'purchase_invoice',
): ExactVatKloptRule | null {
  const ranked = rankVatCodes(rules, {
    percentage: code.percentage * 100,
    taxRateType,
  })
  if (ranked.suggestedCode === null) return null
  return rules.find((rule) => rule.code === ranked.suggestedCode) ?? null
}

/**
 * Pick the Klopt code Exact would map to for the read-only preview.
 *
 * Order: string match on the chart → refuse specials → rate+side primary →
 * plain "geen btw" → VGEEN when that code exists.
 */
export function recogniseExactVatCode(
  code: ExactVatCode,
  rules: readonly ExactVatKloptRule[],
): { readonly rule: ExactVatKloptRule; readonly codeMatch: boolean } | null {
  const byCode = rules.find((rule) => rule.code === code.code)
  if (byCode !== undefined) return { rule: byCode, codeMatch: true }

  if (code.isBlocked) return null
  if (isSpecialExactVat(code)) return null

  const side = appliesTo(code)
  const hint = sideHint(code.description)

  if (side === 'sales' || (side === 'both' && hint === 'sales')) {
    const hit = recogniseByRate(code, rules, 'sales_invoice')
    if (hit !== null) return { rule: hit, codeMatch: false }
  }
  if (side === 'purchase' || (side === 'both' && hint === 'purchase')) {
    const hit = recogniseByRate(code, rules, 'purchase_invoice')
    if (hit !== null) return { rule: hit, codeMatch: false }
  }
  if (side === 'both' && hint === null) {
    const sales = recogniseByRate(code, rules, 'sales_invoice')
    const purchase = recogniseByRate(code, rules, 'purchase_invoice')
    if (sales !== null && purchase === null) return { rule: sales, codeMatch: false }
    if (purchase !== null && sales === null) return { rule: purchase, codeMatch: false }
  }

  if (isPlainGeenBtw(code)) {
    const vgeen = rules.find((rule) => rule.code === 'VGEEN')
    if (vgeen !== undefined) return { rule: vgeen, codeMatch: false }
  }

  return null
}

/**
 * Build the read-only Exact VAT preview rows (#100 step 5 Exact).
 *
 * Blocked Exact codes are omitted (same as `planExactImport`). Accounts that
 * reference an Exact code which is not a string match on the Klopt chart are
 * listed under `accountsLosingDefault` — import drops their default today.
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
    // Only unrecognised codes surface lose-default accounts (design #100 / #101).
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
      codeMatch: recognised?.codeMatch === true || existing.has(code.code),
    }
  })

  return {
    rows,
    recognised: rows.filter((row) => row.kloptCode !== null).length,
    codeCount: rows.length,
  }
}
