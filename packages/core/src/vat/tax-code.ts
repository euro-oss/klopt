import { violation, LedgerError, type LedgerViolation } from '../errors.js'
import { findRubriek, isAssignableRubriek } from './rubrieken.js'

/**
 * A tax code as a rule, not a percentage (spec 7.2).
 *
 * M1 shipped the four fields a sales invoice cannot be written without: code,
 * rate, direction, UBL category. Everything that decides what a transaction
 * *means* for the return is here, and the reason to model it rather than infer
 * it is that inference is wrong in the cases that matter. "21%" does not tell
 * you whether the base belongs in 1a or 4b. A zero rate does not tell you
 * whether it is an export (3a), an intra-community supply (3b), a domestic
 * reverse charge (1e, with the VAT at the customer), or an exemption (1e as
 * well, but with no right to deduct on the cost side).
 *
 * The validity window is part of the rule because rates change by decree and
 * the journal must keep reporting old periods at the old rate. A rate change
 * is a new row, never an update.
 */

/**
 * Who accounts for the VAT.
 *
 * `import_article_23` is the deferment licence: import VAT is not paid at the
 * border but declared in the return, landing the base and VAT in 4a and the
 * deduction in 5b, so the cash never leaves. Anyone importing goods cares
 * about this a great deal, which is why it is its own case and not a comment.
 */
export type ReverseCharge = 'none' | 'domestic' | 'import_article_23'

/**
 * What kind of transaction the code describes. Drives ICP and the rubrieken.
 */
export type TaxScope =
  | 'domestic'
  | 'intra_community_supply'
  | 'intra_community_acquisition'
  | 'import'
  | 'export'
  | 'private_use'
  | 'exempt'
  | 'out_of_scope'

/**
 * Input VAT is not always recoverable. A code that is `none` posts the VAT to
 * the expense rather than to the receivable control account; `pro_rata` splits
 * it, and the split ratio is on the code because it is set per activity and
 * revised annually.
 */
export type Deductibility = 'full' | 'pro_rata' | 'none'

/** Goods or services — the ICP opgaaf reports the two separately. */
export type SupplyKind = 'goods' | 'services' | 'not_applicable'

export interface TaxCodeRule {
  readonly code: string
  readonly description: string
  readonly rateBasisPoints: number
  readonly validFrom: string
  readonly validTo: string | null
  readonly direction: 'output' | 'input'
  /** Where the taxable base is declared. `null` only for out-of-scope codes. */
  readonly baseRubriek: string | null
  /** Where the VAT is declared. `null` for a base-only code. */
  readonly vatRubriek: string | null
  readonly reverseCharge: ReverseCharge
  readonly scope: TaxScope
  readonly deductibility: Deductibility
  /** Recoverable share in basis points. Required when `pro_rata`. */
  readonly proRataBasisPoints: number | null
  readonly supplyKind: SupplyKind
  readonly ublCategory: string
  /**
   * The input code carrying the deduction side of a reverse charge.
   *
   * An intra-community acquisition is two movements in the ledger: the VAT you
   * owe (credit 1500, declared in 4b) and the same VAT you deduct (debit 1510,
   * declared in 5b). Two tax codes rather than one, because two journal lines
   * exist and the return is derived from the journal — but the pair is stated
   * here so a purchase entry can be built from one choice rather than two, and
   * so the acquisition code's base is never counted twice.
   */
  readonly deductionCode: string | null
}

/**
 * Whether this code carries only the deduction half of a reverse charge.
 *
 * Recognised by pointing its VAT at 5b while sitting in a scope that has its
 * own base box: the base belongs to the code it is paired with, so declaring
 * it again here would count the same purchase twice.
 */
export function isReverseChargeDeduction(rule: TaxCodeRule): boolean {
  return (
    rule.direction === 'input' &&
    rule.vatRubriek === '5b' &&
    (rule.scope === 'import' || rule.scope === 'intra_community_acquisition')
  )
}

/** Whether the code feeds the ICP opgaaf, which cross-checks rubriek 3b. */
export function feedsIcp(rule: TaxCodeRule): boolean {
  return rule.scope === 'intra_community_supply'
}

/** The share of input VAT that may be reclaimed, in basis points. */
export function recoverableBasisPoints(rule: TaxCodeRule): number {
  switch (rule.deductibility) {
    case 'full':
      return 10_000
    case 'none':
      return 0
    case 'pro_rata':
      return rule.proRataBasisPoints ?? 0
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

/**
 * Everything wrong with a tax code, in one pass.
 *
 * A misconfigured code does not fail loudly — it produces a return that is
 * plausible and wrong, quarter after quarter, until the Belastingdienst asks.
 * So the incoherent combinations are refused at configuration time, where
 * somebody is still looking at the screen.
 */
export function checkTaxCodeRule(rule: TaxCodeRule): readonly LedgerViolation[] {
  const problems: LedgerViolation[] = []
  const at = (field: string) => `taxCodes.${rule.code}.${field}`

  if (rule.code.trim() === '') {
    problems.push(violation('invalid_tax_code.tax_code_code', at('code')))
  }
  if (
    !Number.isInteger(rule.rateBasisPoints) ||
    rule.rateBasisPoints < 0 ||
    rule.rateBasisPoints > 10_000
  ) {
    problems.push(violation('invalid_tax_code.rate_basis_points', at('rateBasisPoints')))
  }
  if (!isIsoDate(rule.validFrom)) {
    problems.push(violation('invalid_date.validfrom_date', at('validFrom')))
  }
  if (rule.validTo !== null && !isIsoDate(rule.validTo)) {
    problems.push(violation('invalid_date.validto_date_null', at('validTo')))
  }
  if (rule.validTo !== null && isIsoDate(rule.validFrom) && rule.validTo < rule.validFrom) {
    problems.push(violation('invalid_date.validity_window_end', at('validTo')))
  }

  for (const [field, id] of [
    ['baseRubriek', rule.baseRubriek],
    ['vatRubriek', rule.vatRubriek],
  ] as const) {
    if (id === null) continue
    if (findRubriek(id) === undefined) {
      problems.push(violation('unknown_rubriek.rubriek_btw_aangifte', at(field), { id }))
    } else if (!isAssignableRubriek(id)) {
      problems.push(violation('unknown_rubriek.rubriek_computed_subtotal', at(field), { id }))
    }
  }

  // The form has no base box for a domestic purchase: rubriek 5b reports VAT
  // only. So a base rubriek is required where a box exists and forbidden where
  // one does not, rather than always.
  // Rubriek 5b reports VAT and nothing else: the form has no box for the base
  // of a domestic purchase. So a code whose VAT lands in 5b declares no base,
  // and every other code does — including a reverse-charge acquisition, whose
  // base belongs in 2a, 4a or 4b alongside the VAT it owes.
  const declaresBase = rule.vatRubriek !== '5b' && rule.scope !== 'out_of_scope'

  if (declaresBase && rule.baseRubriek === null) {
    problems.push(violation('invalid_tax_code.base_box_named', at('baseRubriek')))
  }
  if (!declaresBase && rule.baseRubriek !== null) {
    problems.push(violation('invalid_tax_code.aangifte_base_box', at('baseRubriek')))
  }

  const base = rule.baseRubriek === null ? undefined : findRubriek(rule.baseRubriek)
  if (base !== undefined && base.carries === 'vat') {
    problems.push(
      violation('invalid_tax_code.rubriek_reports_base', at('baseRubriek'), { id: base.id }),
    )
  }
  const vat = rule.vatRubriek === null ? undefined : findRubriek(rule.vatRubriek)
  if (vat !== undefined && vat.carries === 'base') {
    problems.push(
      violation('invalid_tax_code.rubriek_reports_vat', at('vatRubriek'), { id: vat.id }),
    )
  }

  // A rate with nowhere to declare its VAT is the misconfiguration that silently
  // under-declares: the base shows up, the tax does not.
  if (rule.rateBasisPoints > 0 && rule.vatRubriek === null) {
    problems.push(violation('invalid_tax_code.rate_needs_rubriek', at('vatRubriek')))
  }
  if (rule.rateBasisPoints === 0 && rule.vatRubriek !== null) {
    problems.push(violation('invalid_tax_code.zero_rate_code', at('vatRubriek')))
  }

  if (rule.deductibility === 'pro_rata') {
    if (
      rule.proRataBasisPoints === null ||
      !Number.isInteger(rule.proRataBasisPoints) ||
      rule.proRataBasisPoints <= 0 ||
      rule.proRataBasisPoints >= 10_000
    ) {
      problems.push(violation('invalid_tax_code.pro_rata_code', at('proRataBasisPoints')))
    }
  } else if (rule.proRataBasisPoints !== null) {
    problems.push(violation('invalid_tax_code.recoverable_share_only', at('proRataBasisPoints')))
  }

  if (rule.direction === 'output' && rule.deductibility !== 'full') {
    problems.push(violation('invalid_tax_code.deductibility_describes_input', at('deductibility')))
  }

  // Scope decides the box, so the two must agree or the return is wrong in a
  // way no total will reveal.
  const expectedBase: Partial<Record<TaxScope, readonly string[]>> = {
    intra_community_supply: ['3b', '3c'],
    intra_community_acquisition: ['4b'],
    import: ['4a'],
    export: ['3a'],
    private_use: ['1d'],
  }
  const allowed = expectedBase[rule.scope]
  if (allowed !== undefined && rule.baseRubriek !== null && !allowed.includes(rule.baseRubriek)) {
    problems.push(
      violation('invalid_tax_code.scope_declares_base', at('baseRubriek'), {
        scope: rule.scope,
        allowed: allowed.join(' or '),
        baseRubriek: rule.baseRubriek,
      }),
    )
  }

  if (rule.scope === 'intra_community_supply' && rule.supplyKind === 'not_applicable') {
    problems.push(violation('invalid_tax_code.supply_kind_named', at('supplyKind')))
  }

  if (
    rule.reverseCharge === 'domestic' &&
    rule.rateBasisPoints !== 0 &&
    rule.direction === 'output'
  ) {
    problems.push(violation('invalid_tax_code.under_domestic_reverse', at('rateBasisPoints')))
  }
  if (rule.reverseCharge === 'import_article_23' && rule.scope !== 'import') {
    problems.push(violation('invalid_tax_code.article_deferment_applies', at('scope')))
  }

  return problems
}

export function assertTaxCodeRule(rule: TaxCodeRule): void {
  const problems = checkTaxCodeRule(rule)
  if (problems.length > 0) throw new LedgerError(problems)
}

/** The rule in force on a date, from a code's history. */
export function ruleInForce(
  rules: readonly TaxCodeRule[],
  code: string,
  onDate: string,
): TaxCodeRule | undefined {
  return rules.find(
    (rule) =>
      rule.code === code &&
      rule.validFrom <= onDate &&
      (rule.validTo === null || rule.validTo >= onDate),
  )
}
