import { violation, LedgerError, type LedgerViolation } from '../errors.js'
import type { AccountType, JournalType, NormalBalance } from '../ledger/types.js'
import type { Chart, ChartRoles } from './chart.js'
import { planFiscalYear, type FiscalYearLayout } from './fiscal-year.js'
import type { Deductibility, ReverseCharge, SupplyKind, TaxScope } from '../vat/tax-code.js'

/**
 * Setting up a new administration.
 *
 * Principle 4 says self-hosted is complete, not crippled. An installation whose
 * only route to a first administration is a SQL fixture is crippled, so this is
 * the domain half of fixing that: everything a provisioning transaction needs,
 * derived from a chart of accounts and validated, with no database in sight.
 *
 * The plan is deliberately inert. It computes and checks; the repository writes
 * it. That split is what lets the interesting part — is this a coherent set of
 * books? — be tested without Postgres, and it keeps the transaction that
 * creates an entity down to a sequence of inserts with nothing to think about.
 */

export interface EntitySetupCommand {
  readonly name: string
  /** The statutory name. Defaults to `name`, which is right for a sole trader. */
  readonly legalName?: string | null
  readonly kvkNumber?: string | null
  readonly vatNumber?: string | null
  readonly functionalCurrency?: string
  /** 1–12. A boekjaar need not be a calendar year (spec 6.4). */
  readonly fiscalYearStartMonth?: number
  /** The book year to open, labelled by the year it starts in. */
  readonly firstFiscalYear: string
  readonly vatRounding?: 'per_invoice' | 'per_line'
}

export interface PlannedAccount {
  readonly number: string
  readonly name: string
  readonly type: AccountType
  readonly normalBalance: NormalBalance
  readonly rgsCode: string | null
}

export interface PlannedJournal {
  readonly code: string
  readonly name: string
  readonly type: JournalType
}

export interface PlannedTaxCode {
  readonly code: string
  readonly description: string
  readonly rateBasisPoints: number
  readonly direction: 'output' | 'input'
  readonly isReverseCharge: boolean
  readonly ublCategory: string
  readonly baseRubriek: string | null
  readonly vatRubriek: string | null
  readonly scope: TaxScope
  readonly reverseCharge: ReverseCharge
  readonly deductibility: Deductibility
  readonly proRataBasisPoints: number | null
  readonly supplyKind: SupplyKind
  readonly deductionCode: string | null
  /** Resolved from the chart's role, so a custom chart need not use 1500. */
  readonly accountNumber: string
  readonly validFrom: string
}

export interface PlannedEntity {
  readonly name: string
  readonly legalName: string
  readonly kvkNumber: string | null
  readonly vatNumber: string | null
  readonly functionalCurrency: string
  readonly fiscalYearStartMonth: number
  readonly rgsVersion: string
  readonly rgsVariant: string
  readonly vatRounding: 'per_invoice' | 'per_line'
}

export interface EntitySetupPlan {
  readonly chartCode: string
  readonly entity: PlannedEntity
  readonly fiscalYear: FiscalYearLayout
  readonly accounts: readonly PlannedAccount[]
  readonly journals: readonly PlannedJournal[]
  readonly taxCodes: readonly PlannedTaxCode[]
  readonly roles: ChartRoles
}

const CURRENCY = /^[A-Z]{3}$/
const KVK = /^\d{8}$/
/** NL VAT numbers are exactly `NL` + 9 digits + `B` + 2. Others vary by state. */
const VAT_NL = /^NL\d{9}B\d{2}$/
const VAT_EU = /^[A-Z]{2}[A-Z0-9+*.]{2,12}$/

function optional(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Everything a provisioning transaction needs, or every reason it cannot run.
 *
 * Collects all violations rather than throwing on the first, so a setup form
 * shows every bad field at once instead of one per round trip.
 */
export function planEntitySetup(command: EntitySetupCommand, chart: Chart): EntitySetupPlan {
  const violations: LedgerViolation[] = []

  const name = command.name.trim()
  if (name === '') {
    violations.push(violation('invalid_name', 'name', 'An administration needs a name.'))
  } else if (name.length > 200) {
    violations.push(violation('invalid_name', 'name', 'A name is at most 200 characters.'))
  }

  const currency = (command.functionalCurrency ?? chart.currency).toUpperCase()
  if (!CURRENCY.test(currency)) {
    violations.push(
      violation('invalid_currency', 'functionalCurrency', 'Use a three-letter ISO 4217 code.'),
    )
  }

  const kvkNumber = optional(command.kvkNumber)
  if (kvkNumber !== null && !KVK.test(kvkNumber)) {
    violations.push(violation('invalid_kvk_number', 'kvkNumber', 'A KvK number is eight digits.'))
  }

  const vatNumber = optional(command.vatNumber)?.toUpperCase().replace(/\s/g, '') ?? null
  if (vatNumber !== null) {
    const shape = vatNumber.startsWith('NL') ? VAT_NL : VAT_EU
    if (!shape.test(vatNumber)) {
      violations.push(
        violation(
          'invalid_vat_number',
          'vatNumber',
          'A Dutch VAT number looks like NL123456789B01.',
        ),
      )
    }
  }

  const startMonth = command.fiscalYearStartMonth ?? 1

  // Delegated rather than duplicated: the fiscal year planner already owns the
  // rules about a four-digit code and a month in range, and two copies of a
  // validation drift apart.
  let fiscalYear: FiscalYearLayout | null = null
  try {
    fiscalYear = planFiscalYear(command.firstFiscalYear, startMonth)
  } catch (error: unknown) {
    if (!(error instanceof LedgerError)) throw error
    violations.push(...error.violations)
  }

  if (violations.length > 0 || fiscalYear === null) {
    throw new LedgerError(violations)
  }

  const taxCodes: PlannedTaxCode[] = chart.taxCodes.map((code) => ({
    code: code.code,
    description: code.description,
    rateBasisPoints: code.rateBasisPoints,
    direction: code.direction,
    isReverseCharge: code.isReverseCharge,
    ublCategory: code.ublCategory,
    baseRubriek: code.baseRubriek,
    vatRubriek: code.vatRubriek,
    scope: code.scope,
    reverseCharge: code.reverseCharge,
    deductibility: code.deductibility,
    proRataBasisPoints: code.proRataBasisPoints,
    supplyKind: code.supplyKind,
    deductionCode: code.deductionCode,
    // `loadChart` already proved every role points at an account this chart has.
    accountNumber: chart.roles[code.accountRole],
    // Valid from the day the books open: a tax code that predates the entity
    // would be selectable on an entry that cannot exist.
    validFrom: fiscalYear.startsOn,
  }))

  return {
    chartCode: chart.code,
    entity: {
      name,
      legalName: optional(command.legalName) ?? name,
      kvkNumber,
      vatNumber,
      functionalCurrency: currency,
      fiscalYearStartMonth: startMonth,
      rgsVersion: chart.rgsVersion,
      rgsVariant: chart.rgsVariant,
      vatRounding: command.vatRounding ?? 'per_invoice',
    },
    fiscalYear,
    accounts: chart.accounts.map((account) => ({
      number: account.number,
      name: account.name,
      type: account.type,
      normalBalance: account.normalBalance,
      rgsCode: account.rgsCode,
    })),
    journals: chart.journals.map((journal) => ({ ...journal })),
    taxCodes,
    roles: chart.roles,
  }
}
