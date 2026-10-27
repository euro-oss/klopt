import { renderFindingMessage, type FindingMessageKey } from '../finding-messages.js'
import type { AccountType, JournalLineInput } from '../ledger/types.js'
import type { MoneybirdAdministration } from '../ports/moneybird.js'
import { purchaseCodeNeedsSelfAssessedVat } from '../vat/return.js'
import { applyFxToLines, type FxRateChoice } from './fx.js'
import {
  isSpecialAcquisitionPurchaseRate,
  matchVatCodes,
  nextFreeNumber,
  rankVatCodes,
  type VatMatchQuery,
} from './account-ranker.js'
import {
  classifyAccount,
  contactName,
  yearOf,
  type MoneybirdAttachment,
  type MoneybirdContact,
  type MoneybirdFinancialAccount,
  type MoneybirdFinancialMutation,
  type MoneybirdGeneralDocument,
  type MoneybirdJournalDocument,
  type MoneybirdLedgerAccount,
  type MoneybirdPurchaseDocument,
  type MoneybirdSalesInvoice,
  type MoneybirdTaxRate,
} from './resources.js'

/**
 * What importing a Moneybird administration would do, before it does it.
 *
 * Snapshot then plan — a pure function of what was read and what already
 * exists here. The report a human approves is the thing that gets executed.
 *
 * Unlike Exact, this plan includes booked history (invoices, receipts, bank
 * mutations, general journal). See ADR 0060.
 */

export type MoneybirdProblemCode =
  | 'unknown_currency'
  | 'unmapped_account'
  | 'unmapped_tax_rate'
  | 'incompatible_tax_rate'
  | 'null_percentage_vat_mismatch'
  | 'self_assessed_vat_unsupported'
  | 'tax_code_not_in_force'
  | 'account_number_collision'
  | 'contact_number_collision'
  | 'resource_unreadable'
  | 'trial_balance_empty'
  | 'trial_balance_unbalanced'
  | 'trial_balance_account_missing'
  | 'period_locked'
  | 'unbalanced_document'
  | 'attachment_without_url'
  | 'draft_skipped'
  | 'derived_account_type'
  | 'fiscal_year_start_mismatch'
  | 'fiscal_year_start_unknown'

export interface MoneybirdProblem {
  readonly code: MoneybirdProblemCode
  readonly path: string | null
  readonly message: string
  readonly messageKey: FindingMessageKey
  readonly detail: Readonly<Record<string, string>>
}

function problem(
  code: MoneybirdProblemCode,
  path: string | null,
  detail: Readonly<Record<string, string>> = {},
  messageKeyOverride?: FindingMessageKey,
): MoneybirdProblem {
  const messageKey = messageKeyOverride ?? (`moneybird.${code}` as FindingMessageKey)
  return {
    code,
    path,
    messageKey,
    detail,
    message: renderFindingMessage(messageKey, detail),
  }
}

export interface UnreadableResource {
  readonly resource: string
  readonly status: number
  readonly message: string
}

export interface MoneybirdSnapshot {
  readonly administration: MoneybirdAdministration
  readonly ledgerAccounts: readonly MoneybirdLedgerAccount[]
  readonly taxRates: readonly MoneybirdTaxRate[]
  readonly contacts: readonly MoneybirdContact[]
  readonly salesInvoices: readonly MoneybirdSalesInvoice[]
  readonly purchaseInvoices: readonly MoneybirdPurchaseDocument[]
  readonly receipts: readonly MoneybirdPurchaseDocument[]
  readonly financialAccounts: readonly MoneybirdFinancialAccount[]
  readonly financialMutations: readonly MoneybirdFinancialMutation[]
  readonly journalDocuments: readonly MoneybirdJournalDocument[]
  readonly generalDocuments: readonly MoneybirdGeneralDocument[]
  readonly unreadable: readonly UnreadableResource[]
}

export interface ExistingTaxRule {
  readonly code: string
  readonly rateBasisPoints: number
  readonly direction: 'input' | 'output'
  /** Optional chart metadata for primary/other ranking (#70). */
  readonly scope?: string
  readonly reverseCharge?: string
  readonly deductionCode?: string | null
  readonly deductibility?: string
  /** Validity window — when set, documents outside it raise `tax_code_not_in_force`. */
  readonly validFrom?: string
  readonly validTo?: string | null
}

/**
 * Decisions taken on the Moneybird import screen (issue #42).
 *
 * Persisted on `moneybird_connections.import_decisions`. None of these post
 * journal entries by themselves — posting still goes through `postJournalEntry`
 * at commit.
 */
export interface MoneybirdImportDecisions {
  /** One-click "Ja, dit is EUR" when Moneybird sent no currency. */
  readonly confirmedCurrencyIsFunctional?: boolean
  /** One-click "Klopt, {maand}" when Moneybird omitted period_start_date. */
  readonly confirmedFiscalYearStart?: boolean
  /** Years the user acknowledged as empty — honesty stays `empty`, never reconciled. */
  readonly acknowledgedEmptyYears?: readonly string[]
  /** Documents / locked-period entries left out; listed under "Niet overgezet". */
  readonly excludedExternalIds?: readonly string[]
  /** Locked years the user chose to leave out entirely. */
  readonly excludedLockedYears?: readonly string[]
  /**
   * Open (or any) years the user chose not to import in the wizard (#100).
   * Unselected years are simply not imported — no blocking finding.
   */
  readonly excludedYears?: readonly string[]
  /** Contact renumbers after a collision ("Volgend vrij nummer"). */
  readonly contactNumberOverrides?: Readonly<Record<string, string>>
  /** Account-type picks after `derived_account_type`. */
  readonly accountTypeOverrides?: Readonly<Record<string, AccountType>>
  /** Per-document FX rate from the Koers step. */
  readonly exchangeRates?: Readonly<Record<string, FxRateChoice>>
  /** Attachments flagged "Later toevoegen". */
  readonly deferredAttachmentIds?: readonly string[]
}

export interface MoneybirdImportOptions {
  readonly entityId: string
  readonly currency: string
  readonly existingAccountNumbers: readonly string[]
  readonly existingContactNumbers: readonly string[]
  readonly existingTaxRules: readonly ExistingTaxRule[]
  readonly confirmedAccountMappings: Readonly<Record<string, string>>
  readonly confirmedTaxMappings: Readonly<Record<string, string>>
  /** External Moneybird ids already imported (`sales_invoice:123`, …). */
  readonly existingExternalIds: readonly string[]
  /** Hard-closed fiscal year codes. Posting into one is a problem, not a silent post. */
  readonly lockedYears: readonly string[]
  /** This entity's fiscal year start month (1–12). Moneybird must match it. */
  readonly entityFiscalYearStartMonth: number
  /** Fix decisions from the finding cards; see `MoneybirdImportDecisions`. */
  readonly decisions?: MoneybirdImportDecisions
  readonly receivableAccount?: string
  readonly payableAccount?: string
  readonly vatPayableAccount?: string
  readonly vatReceivableAccount?: string
  readonly salesJournal?: string
  readonly purchaseJournal?: string
  readonly bankJournal?: string
  readonly memorialJournal?: string
}

export interface MoneybirdPlannedAccount {
  readonly moneybirdId: string
  readonly number: string
  readonly name: string
  readonly type: AccountType
  readonly normalBalance: 'debit' | 'credit'
  readonly rgsCode: string | null
  readonly moneybirdType: string
  readonly exists: boolean
  readonly derived: boolean
  readonly mapped: boolean
  readonly proposedNumber: string
}

export interface MoneybirdVatCandidate {
  readonly code: string
  /** Plain domestic standard first; verlegd / ICP / invoer / … under other. */
  readonly group: 'primary' | 'other'
}

export interface MoneybirdPlannedTaxRate {
  readonly moneybirdId: string
  readonly name: string
  readonly percentage: string
  readonly taxRateType: string
  readonly proposedCode: string | null
  readonly mappedCode: string | null
  readonly mapped: boolean
  readonly used: boolean
  /**
   * Chart codes compatible with this Moneybird rate, primary (standard) first.
   * Additive for the btw picker (#70); finding contract unchanged.
   */
  readonly candidates: readonly MoneybirdVatCandidate[]
}

export interface MoneybirdPlannedContact {
  readonly moneybirdId: string
  readonly number: string
  readonly name: string
  readonly isCustomer: boolean
  readonly isSupplier: boolean
  readonly vatNumber: string | null
  readonly kvkNumber: string | null
  readonly countryCode: string
  readonly email: string | null
  readonly phone: string | null
  readonly iban: string | null
  readonly address: {
    readonly line1: string | null
    readonly postcode: string | null
    readonly city: string | null
    readonly countryCode: string
  } | null
  readonly exists: boolean
  readonly externalId: string
}

export interface MoneybirdPlannedEntry {
  readonly externalId: string
  readonly kind:
    'sales_invoice' | 'credit_note' | 'purchase_invoice' | 'receipt' | 'journal' | 'bank_mutation'
  readonly journalCode: string
  readonly bookingDate: string
  readonly documentDate: string
  readonly description: string
  readonly sourceDocumentRef: string
  readonly contactNumber: string | null
  readonly documentNumber: string
  readonly outstanding: bigint
  readonly currency: string
  readonly year: number
  readonly exists: boolean
  readonly matched: boolean
  readonly financialAccountId: string | null
  readonly lines: readonly JournalLineInput[]
  readonly attachmentIds: readonly string[]
}

export interface MoneybirdPlannedFinancialAccount {
  readonly moneybirdId: string
  readonly name: string
  readonly identifier: string | null
  readonly type: string
  readonly ledgerAccountNumber: string | null
  readonly exists: boolean
}

export interface MoneybirdPlannedDocument {
  readonly moneybirdId: string
  readonly kind: string
  readonly reference: string
  readonly date: string | null
  readonly attachments: readonly MoneybirdAttachment[]
}

export interface YearTrialBalance {
  readonly year: number
  readonly source: 'read' | 'empty' | 'unreadable'
  readonly totalDebit: bigint | null
  readonly totalCredit: bigint | null
  readonly balanced: boolean | null
  readonly accountCount: number
  readonly lines: readonly {
    readonly accountNumber: string
    readonly debit: bigint
    readonly credit: bigint
  }[]
}

/** One source document considered for a year — used by TB drill-down. */
export interface MoneybirdYearDocument {
  readonly year: number
  readonly externalId: string
  readonly kind: MoneybirdPlannedEntry['kind']
  readonly reference: string
  readonly documentDate: string
  readonly description: string
  readonly debit: string
  readonly credit: string
  readonly balanced: boolean
}

export interface MoneybirdImportPlan {
  readonly administration: MoneybirdAdministration
  readonly accounts: readonly MoneybirdPlannedAccount[]
  readonly taxRates: readonly MoneybirdPlannedTaxRate[]
  readonly contacts: readonly MoneybirdPlannedContact[]
  readonly entries: readonly MoneybirdPlannedEntry[]
  /**
   * Foreign-currency entries blocked only on a missing rate. The Koers step
   * previews these lines; they are not posted until an FX decision is saved.
   */
  readonly pendingFx: readonly MoneybirdPlannedEntry[]
  readonly financialAccounts: readonly MoneybirdPlannedFinancialAccount[]
  readonly documents: readonly MoneybirdPlannedDocument[]
  /**
   * Documents evaluated per year (including unbalanced ones). Drill-down for
   * an unbalanced trial balance filters to `balanced === false`.
   */
  readonly yearDocuments: readonly MoneybirdYearDocument[]
  readonly years: readonly number[]
  readonly reconciliation: readonly YearTrialBalance[]
  readonly notImported: readonly string[]
  /**
   * Documents / locked years the user explicitly left out. Shown on the commit
   * report under "Niet overgezet" — separate from `notImported` (product gaps).
   */
  readonly excluded: readonly string[]
  readonly warnings: readonly MoneybirdProblem[]
  readonly problems: readonly MoneybirdProblem[]
}

export const MONEYBIRD_NOT_IMPORTED = [
  'oauth',
  'two_way_sync',
  'scheduled_sync',
  'recurring_sales_invoices',
  'estimates',
  'time_entries',
  'projects',
  'products',
  'mollie_payments_settings',
  'workflows',
  'document_styles',
  'email_templates',
  'payroll',
  'generic_saas_importer_framework',
] as const

const DRAFT_STATES = new Set(['draft', 'scheduled', 'pending', 'new'])

const blankLine = {
  currency: null,
  exchangeRate: null,
  exchangeRateSource: null,
  taxCode: null,
  taxRole: null,
  taxAmount: null,
  dimensions: [],
  subledgerKind: null,
  subledgerId: null,
} as const

function line(
  accountNumber: string,
  debit: bigint,
  credit: bigint,
  description: string,
  extra: Partial<JournalLineInput> = {},
): JournalLineInput {
  return { ...blankLine, accountNumber, description, debit, credit, ...extra }
}

/** Greatest common divisor of two non-negative bigints. */
function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) {
    const t = y
    y = x % y
    x = t
  }
  return x === 0n ? 1n : x
}

/**
 * Moneybird line quantity as an exact fraction (supports "2.5", "2,5", "1 x").
 * Null / unparseable / zero → 1, matching the previous `qtyOf` default.
 */
function parseQtyFraction(amount: string | null): { readonly num: bigint; readonly den: bigint } {
  if (amount === null) return { num: 1n, den: 1n }
  const match = /(-?\d+(?:[.,]\d+)?)/.exec(amount)
  if (match?.[1] === undefined) return { num: 1n, den: 1n }
  const raw = match[1].replace(',', '.')
  const neg = raw.startsWith('-')
  const body = neg ? raw.slice(1) : raw
  const dot = body.indexOf('.')
  const whole = dot === -1 ? body : body.slice(0, dot)
  const frac = dot === -1 ? '' : body.slice(dot + 1)
  const den = 10n ** BigInt(frac.length)
  const num = BigInt(whole === '' ? '0' : whole) * den + BigInt(frac === '' ? '0' : frac)
  if (num === 0n) return { num: 1n, den: 1n }
  const signed = neg ? -num : num
  const g = gcd(signed, den)
  return { num: signed / g, den: den / g }
}

function percentageText(value: number): string {
  // Em dash so finding copy never renders a bare "(%)" for empty / NaN (#70 PM).
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(value % 1 === 0 ? 0 : 1)
}

/** Finding detail: `21%` or `—` (never `(—%)` once templates wrap with parentheses). */
function percentageFindingDetail(value: number): string {
  const text = percentageText(value)
  return text === '—' ? '—' : `${text}%`
}

function taxRateDocumentSides(
  rate: MoneybirdTaxRate,
  snapshot: Pick<MoneybirdSnapshot, 'salesInvoices' | 'purchaseInvoices' | 'receipts'>,
): { readonly onSales: boolean; readonly onPurchase: boolean } {
  let onSales = false
  let onPurchase = false
  for (const invoice of snapshot.salesInvoices) {
    if (invoice.details.some((detail) => detail.taxRateId === rate.id)) onSales = true
  }
  for (const document of [...snapshot.purchaseInvoices, ...snapshot.receipts]) {
    if (document.details.some((detail) => detail.taxRateId === rate.id)) onPurchase = true
  }
  return { onSales, onPurchase }
}

/**
 * Special copy when an unknown-direction rate is used on both sales and
 * purchase sides — mapping stays undecidable (#70 PM).
 */
function incompatibleTaxRateMessageKey(
  rate: MoneybirdTaxRate,
  taxRateType: string,
  snapshot: Pick<MoneybirdSnapshot, 'salesInvoices' | 'purchaseInvoices' | 'receipts'>,
): FindingMessageKey {
  if (!taxRateDecidable(rate, taxRateType)) {
    const { onSales, onPurchase } = taxRateDocumentSides(rate, snapshot)
    if (onSales && onPurchase) return 'moneybird.incompatible_tax_rate_both_sides'
  }
  return 'moneybird.incompatible_tax_rate'
}

/** Half-up division of non-negative integers. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n
  return (numerator * 2n + denominator) / (denominator * 2n)
}

/** Half-up division that preserves the sign of `numerator / denominator`. */
function divideHalfUpSigned(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n
  const neg = numerator < 0n !== denominator < 0n
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator
  const q = divideHalfUp(n, d)
  return neg ? -q : q
}

/**
 * Signed line amount in minor units: `price × qty` with exact decimal qty
 * (no `Math.round` on quantity). Half-up only when the product is not an
 * integer number of cents (#90 PM follow-up).
 */
function signedLineMinor(detail: {
  readonly amount: string | null
  readonly price: bigint
}): bigint {
  const { num, den } = parseQtyFraction(detail.amount)
  return divideHalfUpSigned(detail.price * num, den)
}

/**
 * Signed line VAT: half-up on the final per-line tax only. Uses exact decimal
 * quantities and keeps the sign of `price × qty` (discount / credit lines).
 * When prices include VAT, tax is `round(gross × rate / (100 + rate))`.
 */
function signedLineTaxHalfUp(
  detail: { readonly amount: string | null; readonly price: bigint },
  percent: number,
  pricesAreInclTax: boolean,
): bigint {
  if (!Number.isFinite(percent) || percent === 0) return 0n
  const { num, den } = parseQtyFraction(detail.amount)
  if (detail.price === 0n || num === 0n) return 0n
  const bps = BigInt(Math.round(percent * 100))
  if (pricesAreInclTax) {
    return divideHalfUpSigned(detail.price * num * bps, den * (10000n + bps))
  }
  return divideHalfUpSigned(detail.price * num * bps, den * 10000n)
}

/**
 * True when a document that uses a null-% rate has a `totalTax` that cannot be
 * explained by its taxed lines (#90 PM):
 *
 * - Only null / 0% lines → zero tolerance (any VAT blocks).
 * - Mixed with taxed lines → signed half-up line VAT, allow ≤ 1 cent per taxed line.
 */
function documentNullPercentageVatMismatch(
  details: readonly {
    readonly amount: string | null
    readonly price: bigint
    readonly taxRateId: string | null
  }[],
  totalTax: bigint,
  taxPercentById: ReadonlyMap<string, number>,
  nullRateIds: ReadonlySet<string>,
  pricesAreInclTax: boolean,
): boolean {
  const usedNull = details.some(
    (detail) => detail.taxRateId !== null && nullRateIds.has(detail.taxRateId),
  )
  if (!usedNull) return false

  let taxedLines = 0n
  let expected = 0n
  for (const detail of details) {
    if (detail.taxRateId === null) continue
    if (nullRateIds.has(detail.taxRateId)) continue
    const raw = taxPercentById.get(detail.taxRateId) ?? Number.NaN
    if (!Number.isFinite(raw) || raw === 0) continue
    taxedLines += 1n
    expected += signedLineTaxHalfUp(detail, raw, pricesAreInclTax)
  }

  if (taxedLines === 0n) return totalTax !== 0n
  const diff = expected > totalTax ? expected - totalTax : totalTax - expected
  return diff > taxedLines
}

/**
 * Debit/credit for a signed line amount: positive follows `favorCredit`,
 * negative flips sides (discount lines on a normal document).
 */
function signedDebitCredit(
  amount: bigint,
  favorCredit: boolean,
): { readonly debit: bigint; readonly credit: bigint } {
  if (amount === 0n) return { debit: 0n, credit: 0n }
  if (amount > 0n) {
    return favorCredit ? { debit: 0n, credit: amount } : { debit: amount, credit: 0n }
  }
  const abs = -amount
  return favorCredit ? { debit: abs, credit: 0n } : { debit: 0n, credit: abs }
}

/**
 * VAT control lines tagged like native sales/purchase posting: one `taxRole:
 * 'tax'` line per mapped code, amounts from the base lines' `taxAmount`.
 * Residual vs `totalTax` (rounding) lands on the largest group so the entry
 * still balances.
 */
function pushTaggedVatLines(
  lines: JournalLineInput[],
  options: {
    readonly vatAccount: string
    readonly totalTax: bigint
    readonly favorCredit: boolean
    readonly description: string
  },
): void {
  if (options.totalTax === 0n) return

  const byCode = new Map<string, bigint>()
  for (const item of lines) {
    if (item.taxRole !== 'base' || item.taxCode === null || item.taxAmount === null) continue
    if (item.taxAmount === 0n) continue
    byCode.set(item.taxCode, (byCode.get(item.taxCode) ?? 0n) + item.taxAmount)
  }

  if (byCode.size === 0) {
    // No mapped base tax to split — keep a single untagged line so the entry
    // still balances; the return's moneybird_untagged_vat hard block will fire.
    const vatSides = signedDebitCredit(options.totalTax, options.favorCredit)
    lines.push(line(options.vatAccount, vatSides.debit, vatSides.credit, options.description))
    return
  }

  let sum = 0n
  for (const amount of byCode.values()) sum += amount
  if (sum !== options.totalTax) {
    let largestCode: string | null = null
    let largestAbs = -1n
    for (const [code, amount] of byCode) {
      const abs = amount < 0n ? -amount : amount
      if (abs > largestAbs) {
        largestAbs = abs
        largestCode = code
      }
    }
    if (largestCode !== null) {
      byCode.set(largestCode, (byCode.get(largestCode) ?? 0n) + (options.totalTax - sum))
    }
  }

  for (const [taxCode, amount] of [...byCode.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (amount === 0n) continue
    const vatSides = signedDebitCredit(amount, options.favorCredit)
    lines.push(
      line(
        options.vatAccount,
        vatSides.debit,
        vatSides.credit,
        `${taxCode} ${options.description}`,
        {
          taxCode,
          taxRole: 'tax',
          taxAmount: amount,
        },
      ),
    )
  }
}

function ruleInForceOn(
  rules: readonly ExistingTaxRule[],
  code: string,
  onDate: string,
): ExistingTaxRule | undefined {
  return rules.find((rule) => {
    if (rule.code !== code) return false
    if (rule.validFrom !== undefined && onDate < rule.validFrom) return false
    if (rule.validTo != null && onDate > rule.validTo) return false
    return true
  })
}

/**
 * Null-% Moneybird rates whose documents' `totalTax` does not match line VAT
 * when null-rate lines are treated as 0%. Keyed by tax rate id → document refs.
 */
function nullPercentageVatMismatchRefs(
  snapshot: Pick<MoneybirdSnapshot, 'salesInvoices' | 'purchaseInvoices' | 'receipts' | 'taxRates'>,
): ReadonlyMap<string, readonly string[]> {
  const taxPercentById = new Map(snapshot.taxRates.map((rate) => [rate.id, rate.percentage]))
  const nullRateIds = new Set(
    snapshot.taxRates.filter((rate) => !Number.isFinite(rate.percentage)).map((rate) => rate.id),
  )
  if (nullRateIds.size === 0) return new Map()

  const refsByRate = new Map<string, string[]>()
  const note = (rateId: string, reference: string): void => {
    const list = refsByRate.get(rateId)
    if (list === undefined) refsByRate.set(rateId, [reference])
    else if (!list.includes(reference)) list.push(reference)
  }

  for (const invoice of snapshot.salesInvoices) {
    if (DRAFT_STATES.has(invoice.state)) continue
    if (
      !documentNullPercentageVatMismatch(
        invoice.details,
        invoice.totalTax,
        taxPercentById,
        nullRateIds,
        invoice.pricesAreInclTax,
      )
    ) {
      continue
    }
    for (const detail of invoice.details) {
      if (detail.taxRateId !== null && nullRateIds.has(detail.taxRateId)) {
        note(detail.taxRateId, invoice.invoiceId)
      }
    }
  }

  for (const document of [...snapshot.purchaseInvoices, ...snapshot.receipts]) {
    if (DRAFT_STATES.has(document.state)) continue
    if (
      !documentNullPercentageVatMismatch(
        document.details,
        document.totalTax,
        taxPercentById,
        nullRateIds,
        document.pricesAreInclTax,
      )
    ) {
      continue
    }
    for (const detail of document.details) {
      if (detail.taxRateId !== null && nullRateIds.has(detail.taxRateId)) {
        note(detail.taxRateId, document.reference)
      }
    }
  }

  return refsByRate
}

/**
 * Effective Moneybird `tax_rate_type` for matching.
 *
 * When Moneybird omitted the direction, derive it from documents that use the
 * rate (sales → sales_invoice, purchases/receipts → purchase_invoice). Mixed
 * or unused stays unknown (#70 PM).
 */
export function resolveMoneybirdTaxRateType(
  rate: MoneybirdTaxRate,
  snapshot: Pick<MoneybirdSnapshot, 'salesInvoices' | 'purchaseInvoices' | 'receipts'>,
): string {
  if (rate.taxRateType === 'sales_invoice' || rate.taxRateType === 'purchase_invoice') {
    return rate.taxRateType
  }
  const { onSales, onPurchase } = taxRateDocumentSides(rate, snapshot)
  if (onSales && !onPurchase) return 'sales_invoice'
  if (onPurchase && !onSales) return 'purchase_invoice'
  return rate.taxRateType
}

/**
 * Percentage used for chart matching. A null / missing Moneybird percentage
 * (stored as NaN) is treated as 0% so "Geen btw" can map to VGEEN / 0% sales
 * codes — never auto-confirmed; the user still picks (#90).
 */
function matchingPercentage(rate: MoneybirdTaxRate): number {
  return Number.isFinite(rate.percentage) ? rate.percentage : 0
}

function rateForMatching(rate: MoneybirdTaxRate, taxRateType: string): VatMatchQuery {
  return {
    percentage: matchingPercentage(rate),
    taxRateType,
    excludeOutOfScopeInput:
      taxRateType === 'purchase_invoice' && isSpecialAcquisitionPurchaseRate(rate),
  }
}

/**
 * Suggest a Klopt VAT code only when exactly one *primary* (plain domestic
 * standard) chart rule matches — e.g. H21 / VH21 / L9 / VL9. Verlegd, ICP and
 * invoer stay secondary. Ambiguous 0% sales (all `other`) stay unmapped (#70).
 */
function proposeTaxCode(
  rate: MoneybirdTaxRate,
  taxRateType: string,
  rules: readonly ExistingTaxRule[],
): string | null {
  return rankVatCodes(rules, rateForMatching(rate, taxRateType)).suggestedCode
}

function vatCandidatesFor(
  rate: MoneybirdTaxRate,
  taxRateType: string,
  rules: readonly ExistingTaxRule[],
): readonly MoneybirdVatCandidate[] {
  return rankVatCodes(rules, rateForMatching(rate, taxRateType)).candidates.map((entry) => ({
    code: entry.rule.code,
    group: entry.group,
  }))
}

/**
 * True when direction is known so matchVatCodes can decide. A missing
 * percentage is decidable as 0% (#90); mixed/unknown direction is not.
 */
function taxRateDecidable(_rate: MoneybirdTaxRate, taxRateType: string): boolean {
  return taxRateType === 'sales_invoice' || taxRateType === 'purchase_invoice'
}

/** True when a confirmed mapping is direction- and rate-compatible with the chart. */
function taxMappingCompatible(
  rate: MoneybirdTaxRate,
  taxRateType: string,
  code: string,
  rules: readonly ExistingTaxRule[],
  options: { readonly refuseZeroPercent?: boolean } = {},
): boolean {
  if (!taxRateDecidable(rate, taxRateType)) return false
  const matches = matchVatCodes(rules, rateForMatching(rate, taxRateType))
  const hit = matches.find((rule) => rule.code === code)
  if (hit === undefined) return false
  // Null-% rate whose documents still carry VAT: never accept a 0% Klopt code (#90 PM).
  if (options.refuseZeroPercent === true && hit.rateBasisPoints === 0) return false
  return true
}

/**
 * Confirmed VAT mappings that the chart cannot accept (wrong direction/rate, or
 * an undecidable Moneybird rate). Used by the planner and by `saveMappings`
 * so rejection happens on save, not only on preview/run (#70 PM).
 */
export function findIncompatibleTaxMappings(
  snapshot: MoneybirdSnapshot,
  rules: readonly ExistingTaxRule[],
  mappings: Readonly<Record<string, string>>,
): readonly MoneybirdProblem[] {
  const existingTaxCodes = new Set(rules.map((rule) => rule.code))
  const vatMismatchRates = nullPercentageVatMismatchRefs(snapshot)
  const found: MoneybirdProblem[] = []
  for (const rate of snapshot.taxRates) {
    const confirmedRaw = mappings[rate.id]?.trim() || null
    if (confirmedRaw === null || confirmedRaw === '') continue
    const taxRateType = resolveMoneybirdTaxRateType(rate, snapshot)
    const detail = {
      name: rate.name,
      percentage: percentageFindingDetail(rate.percentage),
      mappedCode: confirmedRaw,
      taxRateType,
    }
    if (!existingTaxCodes.has(confirmedRaw)) {
      found.push(
        problem(
          'incompatible_tax_rate',
          `taxRates.${rate.id}`,
          detail,
          incompatibleTaxRateMessageKey(rate, taxRateType, snapshot),
        ),
      )
      continue
    }
    const refuseZeroPercent = !Number.isFinite(rate.percentage) && vatMismatchRates.has(rate.id)
    if (!taxMappingCompatible(rate, taxRateType, confirmedRaw, rules, { refuseZeroPercent })) {
      found.push(
        problem(
          'incompatible_tax_rate',
          `taxRates.${rate.id}`,
          detail,
          incompatibleTaxRateMessageKey(rate, taxRateType, snapshot),
        ),
      )
    }
  }
  return found
}

function pickControl(
  preferred: string | undefined,
  planned: readonly MoneybirdPlannedAccount[],
  existing: ReadonlySet<string>,
  fallback: string,
  match: (account: MoneybirdPlannedAccount) => boolean,
): string {
  if (preferred !== undefined && preferred !== '') return preferred
  const named = planned.find(match)
  if (named !== undefined) return named.number
  if (existing.has(fallback) || planned.some((account) => account.number === fallback)) {
    return fallback
  }
  return fallback
}

export function planMoneybirdImport(
  snapshot: MoneybirdSnapshot,
  options: MoneybirdImportOptions,
): MoneybirdImportPlan {
  const problems: MoneybirdProblem[] = []
  const warnings: MoneybirdProblem[] = []
  const decisions = options.decisions ?? {}
  const excludedExternal = new Set(decisions.excludedExternalIds ?? [])
  const excludedLockedYears = new Set(decisions.excludedLockedYears ?? [])
  const excludedYears = new Set(decisions.excludedYears ?? [])
  const acknowledgedEmptyYears = new Set(decisions.acknowledgedEmptyYears ?? [])
  const deferredAttachments = new Set(decisions.deferredAttachmentIds ?? [])
  const contactOverrides = decisions.contactNumberOverrides ?? {}
  const accountTypeOverrides = decisions.accountTypeOverrides ?? {}
  const exchangeRates = decisions.exchangeRates ?? {}
  const excluded: string[] = []

  const existingAccounts = new Set(options.existingAccountNumbers)
  const existingContacts = new Set(options.existingContactNumbers)
  const existingExternal = new Set(options.existingExternalIds)
  const lockedYears = new Set(options.lockedYears)
  const existingTaxCodes = new Set(options.existingTaxRules.map((rule) => rule.code))

  // Snapshot ledger names by Moneybird id — resolveAccount must never put the
  // raw id in `detail.name` (issue #42).
  const ledgerNameById = new Map(
    snapshot.ledgerAccounts.map((account) => [account.id, account.name] as const),
  )
  const ledgerNumberById = new Map(
    snapshot.ledgerAccounts.map((account) => [account.id, account.number] as const),
  )
  const ledgerTypeById = new Map(
    snapshot.ledgerAccounts.map((account) => [account.id, account.accountType] as const),
  )

  if (snapshot.administration.currency === null) {
    if (decisions.confirmedCurrencyIsFunctional !== true) {
      warnings.push(
        problem('unknown_currency', 'administration.currency', {
          currency: '(none)',
          functionalCurrency: options.currency,
        }),
      )
    }
  } else if (snapshot.administration.currency.toUpperCase() !== options.currency.toUpperCase()) {
    problems.push(
      problem('unknown_currency', 'administration.currency', {
        currency: snapshot.administration.currency,
        functionalCurrency: options.currency,
      }),
    )
  }

  if (snapshot.administration.fiscalYearStartMonth === null) {
    if (decisions.confirmedFiscalYearStart !== true) {
      warnings.push(
        problem('fiscal_year_start_unknown', 'administration.period_start_date', {
          month: String(options.entityFiscalYearStartMonth),
        }),
      )
    }
  } else if (snapshot.administration.fiscalYearStartMonth !== options.entityFiscalYearStartMonth) {
    problems.push(
      problem('fiscal_year_start_mismatch', 'administration.period_start_date', {
        moneybirdMonth: String(snapshot.administration.fiscalYearStartMonth),
        entityMonth: String(options.entityFiscalYearStartMonth),
      }),
    )
  }

  for (const missing of snapshot.unreadable) {
    warnings.push(
      problem('resource_unreadable', missing.resource, {
        resource: missing.resource,
        status: String(missing.status),
        detail: missing.message,
      }),
    )
  }

  const seenNumbers = new Set<string>()
  const accounts: MoneybirdPlannedAccount[] = []
  const accountById = new Map<string, MoneybirdPlannedAccount>()

  for (const account of snapshot.ledgerAccounts) {
    const classified = classifyAccount(account)
    const typeOverride = accountTypeOverrides[account.id]
    const derivedUnresolved = classified.derived && typeOverride === undefined
    if (derivedUnresolved) {
      warnings.push(
        problem('derived_account_type', `accounts.${account.id}`, {
          name: account.name,
          number: account.number,
          accountType: account.accountType,
          suggestedType: classified.type,
          ...(account.rgsCode === null ? {} : { rgsCode: account.rgsCode }),
          moneybirdId: account.id,
        }),
      )
    }

    const confirmed = options.confirmedAccountMappings[account.id]?.trim() ?? ''
    const proposed = account.number
    const number = confirmed === '' ? proposed : confirmed

    if (seenNumbers.has(number)) {
      problems.push(
        problem('account_number_collision', `accounts.${account.id}`, {
          number,
          name: account.name,
          suggested: nextFreeNumber(number, seenNumbers),
        }),
      )
      continue
    }
    seenNumbers.add(number)

    const planned: MoneybirdPlannedAccount = {
      moneybirdId: account.id,
      number,
      name: account.name,
      type: typeOverride ?? classified.type,
      normalBalance: classified.normalBalance,
      rgsCode: account.rgsCode,
      moneybirdType: account.accountType,
      exists: existingAccounts.has(number),
      derived: classified.derived && typeOverride === undefined,
      mapped: confirmed !== '' || proposed !== '',
      proposedNumber: proposed,
    }
    accounts.push(planned)
    accountById.set(account.id, planned)
  }

  const usedTaxRateIds = new Set<string>()
  const usedAccountIds = new Set<string>()

  const markTax = (id: string | null): void => {
    if (id !== null) usedTaxRateIds.add(id)
  }
  const markAccount = (id: string | null): void => {
    if (id !== null) usedAccountIds.add(id)
  }

  for (const invoice of snapshot.salesInvoices) {
    for (const detail of invoice.details) {
      markTax(detail.taxRateId)
      markAccount(detail.ledgerAccountId)
    }
  }
  for (const document of [...snapshot.purchaseInvoices, ...snapshot.receipts]) {
    for (const detail of document.details) {
      markTax(detail.taxRateId)
      markAccount(detail.ledgerAccountId)
    }
  }
  for (const journal of snapshot.journalDocuments) {
    for (const detail of journal.details) {
      markTax(detail.taxRateId)
      markAccount(detail.ledgerAccountId)
    }
  }
  for (const account of snapshot.financialAccounts) markAccount(account.ledgerAccountId)

  const vatMismatchByRate = nullPercentageVatMismatchRefs(snapshot)
  for (const [rateId, refs] of vatMismatchByRate) {
    const rate = snapshot.taxRates.find((row) => row.id === rateId)
    if (rate === undefined) continue
    problems.push(
      problem(
        'null_percentage_vat_mismatch',
        `taxRates.${rateId}`,
        {
          name: rate.name,
          percentage: percentageFindingDetail(rate.percentage),
          references: refs.join(', '),
          count: String(refs.length),
        },
        refs.length === 1
          ? 'moneybird.null_percentage_vat_mismatch_one'
          : 'moneybird.null_percentage_vat_mismatch_other',
      ),
    )
  }

  const taxRates: MoneybirdPlannedTaxRate[] = snapshot.taxRates.map((rate) => {
    const taxRateType = resolveMoneybirdTaxRateType(rate, snapshot)
    const refuseZeroPercent = !Number.isFinite(rate.percentage) && vatMismatchByRate.has(rate.id)
    // When documents still carry VAT on a null-% rate, offering 0% codes would
    // invite a mapping that drops that VAT — leave the picker empty (#90 PM).
    const candidates = refuseZeroPercent
      ? []
      : vatCandidatesFor(rate, taxRateType, options.existingTaxRules)
    const proposed = refuseZeroPercent
      ? null
      : proposeTaxCode(rate, taxRateType, options.existingTaxRules)
    const confirmedRaw = options.confirmedTaxMappings[rate.id]?.trim() || null
    const used = usedTaxRateIds.has(rate.id)

    let confirmed: string | null = null
    let incompatible = false
    if (confirmedRaw !== null && existingTaxCodes.has(confirmedRaw)) {
      // Accept only when direction (declared or derived) + rate (missing → 0%)
      // make the code a matchVatCodes hit. Unknown direction or a wrong code
      // is incompatible_tax_rate; never accept unvalidated (#70 / #90).
      if (
        !taxMappingCompatible(rate, taxRateType, confirmedRaw, options.existingTaxRules, {
          refuseZeroPercent,
        })
      ) {
        incompatible = true
        problems.push(
          problem(
            'incompatible_tax_rate',
            `taxRates.${rate.id}`,
            {
              name: rate.name,
              percentage: percentageFindingDetail(rate.percentage),
              mappedCode: confirmedRaw,
              taxRateType,
            },
            incompatibleTaxRateMessageKey(rate, taxRateType, snapshot),
          ),
        )
      } else {
        confirmed = confirmedRaw
      }
    }

    // After rejecting a bad confirmed pick, do not silently apply proposed —
    // the finding asks the user to choose again (#70).
    const mappedCode = confirmed ?? (incompatible ? null : proposed)
    const mapped = mappedCode !== null && existingTaxCodes.has(mappedCode)
    // incompatible_tax_rate / null_percentage_vat_mismatch already block; do
    // not also emit unmapped_tax_rate for the same rate.
    if (used && !mapped && !incompatible && !vatMismatchByRate.has(rate.id)) {
      problems.push(
        problem('unmapped_tax_rate', `taxRates.${rate.id}`, {
          name: rate.name,
          percentage: percentageFindingDetail(rate.percentage),
        }),
      )
    }
    return {
      moneybirdId: rate.id,
      name: rate.name,
      percentage: percentageText(rate.percentage),
      // Surface the effective direction (declared or derived) for the picker.
      taxRateType,
      proposedCode: proposed,
      mappedCode: mapped ? mappedCode : null,
      mapped,
      used,
      candidates,
    }
  })

  const taxById = new Map(taxRates.map((rate) => [rate.moneybirdId, rate]))
  const taxPercentById = new Map(snapshot.taxRates.map((rate) => [rate.id, rate.percentage]))

  for (const account of accounts) {
    if (usedAccountIds.has(account.moneybirdId) && account.number.trim() === '') {
      problems.push(
        problem('unmapped_account', `accounts.${account.moneybirdId}`, {
          name: account.name,
          number: account.proposedNumber,
          accountType: account.moneybirdType,
        }),
      )
    }
  }

  const numberByMoneybirdId = new Map(
    accounts.map((account) => [account.moneybirdId, account.number]),
  )

  const seenContactNumbers = new Set<string>()
  const contacts: MoneybirdPlannedContact[] = []
  const contactNumberById = new Map<string, string>()

  const salesContactIds = new Set(
    snapshot.salesInvoices
      .map((invoice) => invoice.contactId)
      .filter((id): id is string => id !== null),
  )
  const purchaseContactIds = new Set(
    [...snapshot.purchaseInvoices, ...snapshot.receipts]
      .map((document) => document.contactId)
      .filter((id): id is string => id !== null),
  )

  for (const contact of snapshot.contacts) {
    const preferred = contact.customerId ?? `MB-${contact.id}`
    const overridden = contactOverrides[contact.id]?.trim()
    const number = overridden !== undefined && overridden !== '' ? overridden : preferred
    if (seenContactNumbers.has(number)) {
      const suggested = nextFreeNumber(number, [...seenContactNumbers, ...existingContacts])
      problems.push(
        problem('contact_number_collision', `contacts.${contact.id}`, {
          number,
          name: contactName(contact),
          suggested,
          moneybirdId: contact.id,
        }),
      )
      continue
    }
    seenContactNumbers.add(number)
    contactNumberById.set(contact.id, number)
    const country = (contact.country ?? 'NL').toUpperCase().slice(0, 2)
    const hasAddress =
      contact.address1 !== null || contact.zipcode !== null || contact.city !== null
    contacts.push({
      moneybirdId: contact.id,
      number,
      name: contactName(contact),
      isCustomer: salesContactIds.has(contact.id),
      isSupplier: purchaseContactIds.has(contact.id),
      vatNumber: contact.taxNumber,
      kvkNumber: contact.chamberOfCommerce,
      countryCode: country,
      email: contact.sendInvoicesToEmail,
      phone: contact.phone,
      iban: contact.sepaIban,
      address: hasAddress
        ? {
            line1: contact.address1,
            postcode: contact.zipcode,
            city: contact.city,
            countryCode: country,
          }
        : null,
      exists: existingContacts.has(number),
      externalId: contact.id,
    })
  }

  const receivableAccount = pickControl(
    options.receivableAccount,
    accounts,
    existingAccounts,
    '1300',
    (account) => /debiteur/i.test(account.name) && account.type === 'asset',
  )
  const payableAccount = pickControl(
    options.payableAccount,
    accounts,
    existingAccounts,
    '1600',
    (account) => /crediteur/i.test(account.name) && account.type === 'liability',
  )
  const vatPayableAccount = pickControl(
    options.vatPayableAccount,
    accounts,
    existingAccounts,
    '1500',
    (account) => /btw/i.test(account.name) && account.type === 'liability',
  )
  const vatReceivableAccount = pickControl(
    options.vatReceivableAccount,
    accounts,
    existingAccounts,
    '1510',
    (account) => /voorbelasting|vorderen btw/i.test(account.name) && account.type === 'asset',
  )

  const salesJournal = options.salesJournal ?? 'VRK'
  const purchaseJournal = options.purchaseJournal ?? 'INK'
  const bankJournal = options.bankJournal ?? 'BNK'
  const memorialJournal = options.memorialJournal ?? 'MEM'

  const resolveAccount = (moneybirdId: string | null, fallback: string, path: string): string => {
    if (moneybirdId === null) return fallback
    const number = numberByMoneybirdId.get(moneybirdId)
    if (number === undefined || number === '') {
      // Never put the raw Moneybird id in `detail.name` (#42). Prefer the
      // chart name; fall back to a placeholder when the id is not in the chart.
      const knownName = ledgerNameById.get(moneybirdId)
      problems.push(
        problem('unmapped_account', path, {
          name: knownName ?? '(unknown)',
          number: ledgerNumberById.get(moneybirdId) ?? '',
          accountType: ledgerTypeById.get(moneybirdId) ?? '',
          moneybirdId,
        }),
      )
      return fallback
    }
    return number
  }

  const entries: MoneybirdPlannedEntry[] = []
  const pendingFx: MoneybirdPlannedEntry[] = []
  const yearDocuments: MoneybirdYearDocument[] = []

  const pushEntry = (entry: MoneybirdPlannedEntry): void => {
    if (excludedExternal.has(entry.externalId)) {
      excluded.push(entry.externalId)
      return
    }
    const year = String(entry.year)
    // Wizard year selection (#100): unselected years are simply not imported.
    if (excludedYears.has(year) || excludedLockedYears.has(year)) {
      excluded.push(entry.externalId)
      return
    }
    if (lockedYears.has(year)) {
      if (excludedExternal.has(entry.externalId)) {
        excluded.push(entry.externalId)
        return
      }
      problems.push(
        problem('period_locked', entry.externalId, {
          year,
          reference: entry.documentNumber,
        }),
      )
      return
    }
    const debit = entry.lines.reduce((sum, item) => sum + item.debit, 0n)
    const credit = entry.lines.reduce((sum, item) => sum + item.credit, 0n)
    yearDocuments.push({
      year: entry.year,
      externalId: entry.externalId,
      kind: entry.kind,
      reference: entry.documentNumber,
      documentDate: entry.documentDate,
      description: entry.description,
      debit: debit.toString(),
      credit: credit.toString(),
      balanced: debit === credit,
    })
    if (debit !== credit) {
      if (excludedExternal.has(entry.externalId)) {
        excluded.push(entry.externalId)
        return
      }
      problems.push(
        problem('unbalanced_document', entry.externalId, {
          year,
          reference: entry.documentNumber,
          debit: debit.toString(),
          credit: credit.toString(),
        }),
      )
      return
    }
    if (entry.currency !== options.currency) {
      const choice = exchangeRates[entry.externalId]
      if (choice !== undefined && choice.rate !== '') {
        entries.push({
          ...entry,
          lines: applyFxToLines(entry.lines, entry.currency, choice),
        })
        return
      }
      pendingFx.push(entry)
      problems.push(
        problem(
          'unknown_currency',
          entry.externalId,
          {
            currency: entry.currency,
            functionalCurrency: options.currency,
            documentDate: entry.documentDate,
            reference: entry.documentNumber,
          },
          'moneybird.unknown_currency_document',
        ),
      )
      return
    }
    entries.push(entry)
  }

  const noteAttachment = (
    attachments: readonly MoneybirdAttachment[],
    path: string,
  ): readonly string[] => {
    const ids: string[] = []
    for (const attachment of attachments) {
      if (attachment.downloadUrl === null) {
        if (!deferredAttachments.has(attachment.id)) {
          warnings.push(
            problem('attachment_without_url', `${path}.${attachment.id}`, {
              filename: attachment.filename,
              attachmentId: attachment.id,
            }),
          )
        }
        continue
      }
      ids.push(attachment.id)
    }
    return ids
  }

  for (const invoice of snapshot.salesInvoices) {
    if (DRAFT_STATES.has(invoice.state)) {
      warnings.push(
        problem('draft_skipped', `salesInvoices.${invoice.id}`, {
          reference: invoice.invoiceId,
          state: invoice.state,
        }),
      )
      continue
    }

    const isCredit = invoice.totalExcl < 0n || invoice.originalSalesInvoiceId !== null
    // Credit notes identified by originalSalesInvoiceId often carry positive
    // amounts. Normalise their sign before signedDebitCredit so they reverse
    // like main; already-negative credit notes must not be flipped again (#90).
    const flipSign = isCredit && invoice.totalExcl >= 0n
    const contactNumber =
      invoice.contactId === null ? null : (contactNumberById.get(invoice.contactId) ?? null)
    const revenueIsCredit = !isCredit
    const lines: JournalLineInput[] = []

    const gross = invoice.totalIncl < 0n ? -invoice.totalIncl : invoice.totalIncl
    lines.push(
      line(
        receivableAccount,
        revenueIsCredit ? gross : 0n,
        revenueIsCredit ? 0n : gross,
        `${contactNumber ?? ''} ${invoice.invoiceId}`.trim(),
        { subledgerKind: 'customer', subledgerId: null },
      ),
    )

    const salesCodesNotInForce = new Set<string>()
    for (const detail of invoice.details) {
      const percent = detail.taxRateId === null ? 0 : (taxPercentById.get(detail.taxRateId) ?? 0)
      let tax = signedLineTaxHalfUp(detail, percent, invoice.pricesAreInclTax)
      let net: bigint
      if (invoice.pricesAreInclTax && Number.isFinite(percent) && percent !== 0) {
        net = signedLineMinor(detail) - tax
      } else {
        net = signedLineMinor(detail)
      }
      if (flipSign) {
        net = -net
        tax = -tax
      }
      if (net === 0n && tax === 0n) continue
      const taxCode =
        detail.taxRateId === null ? null : (taxById.get(detail.taxRateId)?.mappedCode ?? null)
      if (taxCode !== null) {
        const known = options.existingTaxRules.some((rule) => rule.code === taxCode)
        const inForce = ruleInForceOn(options.existingTaxRules, taxCode, invoice.invoiceDate)
        if (known && inForce === undefined) salesCodesNotInForce.add(taxCode)
      }
      const accountNumber = resolveAccount(
        detail.ledgerAccountId,
        '8000',
        `salesInvoices.${invoice.id}.details.${detail.id}`,
      )
      // Signed line amounts: positive revenue credits, discount/credit-note
      // negatives debit — do not abs() then flip via isCredit (#90 PM).
      const sides = signedDebitCredit(net, true)
      lines.push(
        line(accountNumber, sides.debit, sides.credit, detail.description || invoice.invoiceId, {
          taxCode,
          taxRole: taxCode === null ? null : 'base',
          taxAmount: taxCode === null ? null : tax,
        }),
      )
    }
    for (const taxCode of [...salesCodesNotInForce].sort()) {
      problems.push(
        problem('tax_code_not_in_force', `salesInvoices.${invoice.id}`, {
          reference: invoice.invoiceId,
          bookingDate: invoice.invoiceDate,
          taxCode,
        }),
      )
    }

    pushTaggedVatLines(lines, {
      vatAccount: vatPayableAccount,
      totalTax: flipSign ? -invoice.totalTax : invoice.totalTax,
      favorCredit: true,
      description: `BTW ${invoice.invoiceId}`,
    })

    const externalId = `sales_invoice:${invoice.id}`
    pushEntry({
      externalId,
      kind: isCredit ? 'credit_note' : 'sales_invoice',
      journalCode: salesJournal,
      bookingDate: invoice.invoiceDate,
      documentDate: invoice.invoiceDate,
      description: `Verkoopfactuur ${invoice.invoiceId}`,
      sourceDocumentRef: `moneybird:${snapshot.administration.id}:${externalId}`,
      contactNumber,
      documentNumber: invoice.invoiceId,
      outstanding: invoice.totalIncl,
      currency: invoice.currency,
      year: yearOf(invoice.invoiceDate),
      exists: existingExternal.has(externalId),
      matched: false,
      financialAccountId: null,
      lines,
      attachmentIds: noteAttachment(invoice.attachments, `salesInvoices.${invoice.id}`),
    })
  }

  for (const document of [...snapshot.purchaseInvoices, ...snapshot.receipts]) {
    if (DRAFT_STATES.has(document.state)) {
      warnings.push(
        problem('draft_skipped', `${document.kind}s.${document.id}`, {
          reference: document.reference,
          state: document.state,
        }),
      )
      continue
    }

    const isCredit = document.totalExcl < 0n
    // Same rule as sales: positive-amount purchase credit notes normalise once;
    // already-negative amounts keep signed behaviour (#90).
    const flipSign = isCredit && document.totalExcl >= 0n
    const contactNumber =
      document.contactId === null ? null : (contactNumberById.get(document.contactId) ?? null)
    const payableIsCredit = !isCredit
    const lines: JournalLineInput[] = []
    const gross = document.totalIncl < 0n ? -document.totalIncl : document.totalIncl

    const selfAssessedCodes = new Set<string>()
    const purchaseCodesNotInForce = new Set<string>()
    for (const detail of document.details) {
      const percent = detail.taxRateId === null ? 0 : (taxPercentById.get(detail.taxRateId) ?? 0)
      let tax = signedLineTaxHalfUp(detail, percent, document.pricesAreInclTax)
      let net: bigint
      if (document.pricesAreInclTax && Number.isFinite(percent) && percent !== 0) {
        net = signedLineMinor(detail) - tax
      } else {
        net = signedLineMinor(detail)
      }
      if (flipSign) {
        net = -net
        tax = -tax
      }
      if (net === 0n && tax === 0n) continue
      const taxCode =
        detail.taxRateId === null ? null : (taxById.get(detail.taxRateId)?.mappedCode ?? null)
      if (taxCode !== null) {
        const rule = options.existingTaxRules.find((entry) => entry.code === taxCode)
        if (rule !== undefined && purchaseCodeNeedsSelfAssessedVat(rule)) {
          selfAssessedCodes.add(taxCode)
        }
        const known = rule !== undefined
        const inForce = ruleInForceOn(options.existingTaxRules, taxCode, document.date)
        if (known && inForce === undefined) purchaseCodesNotInForce.add(taxCode)
      }
      const accountNumber = resolveAccount(
        detail.ledgerAccountId,
        '4000',
        `${document.kind}s.${document.id}.details.${detail.id}`,
      )
      // Signed line amounts: positive expense debits, discount/credit negatives credit.
      const sides = signedDebitCredit(net, false)
      lines.push(
        line(accountNumber, sides.debit, sides.credit, detail.description || document.reference, {
          taxCode,
          taxRole: taxCode === null ? null : 'base',
          taxAmount: taxCode === null ? null : tax,
        }),
      )
    }

    for (const taxCode of [...selfAssessedCodes].sort()) {
      // Warning only: the document still imports; filing is blocked on the
      // return until #95 books the self-assessed pair (PM #96).
      warnings.push(
        problem('self_assessed_vat_unsupported', `${document.kind}s.${document.id}`, {
          reference: document.reference,
          taxCode,
        }),
      )
    }
    for (const taxCode of [...purchaseCodesNotInForce].sort()) {
      problems.push(
        problem('tax_code_not_in_force', `${document.kind}s.${document.id}`, {
          reference: document.reference,
          bookingDate: document.date,
          taxCode,
        }),
      )
    }

    pushTaggedVatLines(lines, {
      vatAccount: vatReceivableAccount,
      totalTax: flipSign ? -document.totalTax : document.totalTax,
      favorCredit: false,
      description: `BTW ${document.reference}`,
    })

    lines.push(
      line(
        payableAccount,
        payableIsCredit ? 0n : gross,
        payableIsCredit ? gross : 0n,
        `${contactNumber ?? ''} ${document.reference}`.trim(),
        { subledgerKind: 'supplier', subledgerId: null },
      ),
    )

    const externalId = `${document.kind}:${document.id}`
    pushEntry({
      externalId,
      kind: document.kind,
      journalCode: purchaseJournal,
      bookingDate: document.date,
      documentDate: document.date,
      description:
        document.kind === 'receipt' ? `Bon ${document.reference}` : `Inkoop ${document.reference}`,
      sourceDocumentRef: `moneybird:${snapshot.administration.id}:${externalId}`,
      contactNumber,
      documentNumber: document.reference,
      outstanding: document.totalIncl,
      currency: document.currency,
      year: yearOf(document.date),
      exists: existingExternal.has(externalId),
      matched: false,
      financialAccountId: null,
      lines,
      attachmentIds: noteAttachment(document.attachments, `${document.kind}s.${document.id}`),
    })
  }

  for (const journal of snapshot.journalDocuments) {
    if (journal.details.length === 0) continue
    const lines: JournalLineInput[] = journal.details.map((detail) => {
      const accountNumber = resolveAccount(
        detail.ledgerAccountId,
        '0500',
        `journal.${journal.id}.${detail.id}`,
      )
      const taxCode =
        detail.taxRateId === null ? null : (taxById.get(detail.taxRateId)?.mappedCode ?? null)
      return line(
        accountNumber,
        detail.debit,
        detail.credit,
        detail.description || journal.reference,
        {
          taxCode,
          taxRole: taxCode === null ? null : 'base',
          taxAmount: taxCode === null ? null : 0n,
        },
      )
    })
    const externalId = `journal:${journal.id}`
    pushEntry({
      externalId,
      kind: 'journal',
      journalCode: memorialJournal,
      bookingDate: journal.date,
      documentDate: journal.date,
      description: journal.reference,
      sourceDocumentRef: `moneybird:${snapshot.administration.id}:${externalId}`,
      contactNumber: null,
      documentNumber: journal.reference,
      outstanding: 0n,
      currency: options.currency,
      year: yearOf(journal.date),
      exists: existingExternal.has(externalId),
      matched: false,
      financialAccountId: null,
      lines,
      attachmentIds: noteAttachment(journal.attachments, `journal.${journal.id}`),
    })
  }

  const financialAccounts: MoneybirdPlannedFinancialAccount[] = snapshot.financialAccounts.map(
    (account) => ({
      moneybirdId: account.id,
      name: account.name,
      identifier: account.identifier,
      type: account.type,
      ledgerAccountNumber:
        account.ledgerAccountId === null
          ? '1100'
          : (numberByMoneybirdId.get(account.ledgerAccountId) ?? '1100'),
      exists: false,
    }),
  )
  const financialById = new Map(financialAccounts.map((account) => [account.moneybirdId, account]))

  const salesContactByInvoiceId = new Map(
    snapshot.salesInvoices
      .filter((invoice) => invoice.contactId !== null)
      .map((invoice) => [invoice.id, invoice.contactId!]),
  )
  const purchaseContactByInvoiceId = new Map(
    [...snapshot.purchaseInvoices, ...snapshot.receipts]
      .filter((document) => document.contactId !== null)
      .map((document) => [document.id, document.contactId!]),
  )

  for (const mutation of snapshot.financialMutations) {
    const financial = financialById.get(mutation.financialAccountId)
    const bankAccountNumber = financial?.ledgerAccountNumber ?? '1100'
    const incoming = mutation.amount >= 0n
    const magnitude = incoming ? mutation.amount : -mutation.amount
    const lines: JournalLineInput[] = [
      line(
        bankAccountNumber,
        incoming ? magnitude : 0n,
        incoming ? 0n : magnitude,
        mutation.message ?? mutation.id,
      ),
    ]

    let contactNumber: string | null = null
    if (mutation.payments.length === 0) {
      lines.push(
        line(
          incoming ? receivableAccount : payableAccount,
          incoming ? 0n : magnitude,
          incoming ? magnitude : 0n,
          mutation.contraAccountName ?? mutation.message ?? mutation.id,
        ),
      )
    } else {
      for (const payment of mutation.payments) {
        const payMagnitude = payment.price < 0n ? -payment.price : payment.price
        const sales = (payment.invoiceType ?? '').toLowerCase().includes('sales')
        const accountNumber = sales ? receivableAccount : payableAccount
        const contactId =
          payment.invoiceId === null
            ? null
            : sales
              ? (salesContactByInvoiceId.get(payment.invoiceId) ?? null)
              : (purchaseContactByInvoiceId.get(payment.invoiceId) ?? null)
        const paymentContact =
          contactId === null ? null : (contactNumberById.get(contactId) ?? null)
        if (contactNumber === null) contactNumber = paymentContact
        lines.push(
          line(
            accountNumber,
            incoming ? 0n : payMagnitude,
            incoming ? payMagnitude : 0n,
            payment.invoiceId ?? mutation.id,
            paymentContact === null
              ? {}
              : { subledgerKind: sales ? 'customer' : 'supplier', subledgerId: null },
          ),
        )
      }
      const allocated = mutation.payments.reduce(
        (sum, payment) => sum + (payment.price < 0n ? -payment.price : payment.price),
        0n,
      )
      const remainder = magnitude - allocated
      if (remainder !== 0n) {
        lines.push(
          line(
            incoming ? receivableAccount : payableAccount,
            incoming ? 0n : remainder < 0n ? -remainder : remainder,
            incoming ? (remainder < 0n ? -remainder : remainder) : 0n,
            'Rest bankmutatie',
          ),
        )
      }
    }

    const externalId = `bank_mutation:${mutation.id}`
    pushEntry({
      externalId,
      kind: 'bank_mutation',
      journalCode: bankJournal,
      bookingDate: mutation.date,
      documentDate: mutation.date,
      description: mutation.message ?? `Bankmutatie ${mutation.id}`,
      sourceDocumentRef: `moneybird:${snapshot.administration.id}:${externalId}`,
      contactNumber,
      documentNumber: mutation.id,
      outstanding: mutation.amount,
      currency: options.currency,
      year: yearOf(mutation.date),
      exists: existingExternal.has(externalId),
      matched: mutation.payments.length > 0,
      financialAccountId: mutation.financialAccountId,
      lines,
      attachmentIds: [],
    })
  }

  const documents: MoneybirdPlannedDocument[] = [
    ...snapshot.salesInvoices.map((invoice) => ({
      moneybirdId: invoice.id,
      kind: 'sales_invoice',
      reference: invoice.invoiceId,
      date: invoice.invoiceDate,
      attachments: invoice.attachments,
    })),
    ...snapshot.purchaseInvoices.map((document) => ({
      moneybirdId: document.id,
      kind: 'purchase_invoice',
      reference: document.reference,
      date: document.date,
      attachments: document.attachments,
    })),
    ...snapshot.receipts.map((document) => ({
      moneybirdId: document.id,
      kind: 'receipt',
      reference: document.reference,
      date: document.date,
      attachments: document.attachments,
    })),
    ...snapshot.journalDocuments.map((document) => ({
      moneybirdId: document.id,
      kind: 'journal',
      reference: document.reference,
      date: document.date,
      attachments: document.attachments,
    })),
    ...snapshot.generalDocuments.map((document) => ({
      moneybirdId: document.id,
      kind: 'general_document',
      reference: document.reference,
      date: document.date,
      attachments: document.attachments,
    })),
  ]

  for (const document of snapshot.generalDocuments) {
    noteAttachment(document.attachments, `generalDocuments.${document.id}`)
  }

  const years = [
    ...new Set(
      [
        ...entries.map((entry) => entry.year),
        ...documents.map((document) => (document.date === null ? null : yearOf(document.date))),
      ].filter((year): year is number => year !== null),
    ),
  ].sort((a, b) => a - b)

  // Every resource that feeds journal entries. Unreadable is not empty and
  // must not be called reconciled — including purchases, receipts, and the
  // rest of `documents/*`, not only sales and the general journal.
  const sourceUnreadable = snapshot.unreadable.some((item) =>
    /ledger_accounts|sales_invoices|purchase_invoices|receipts|financial_mutations|general_journal|documents\//.test(
      item.resource,
    ),
  )

  const reconciliation: YearTrialBalance[] = years.map((year) => {
    if (sourceUnreadable) {
      return {
        year,
        source: 'unreadable',
        totalDebit: null,
        totalCredit: null,
        balanced: null,
        accountCount: 0,
        lines: [],
      }
    }
    const byAccount = new Map<string, { debit: bigint; credit: bigint }>()
    for (const entry of entries.filter((item) => item.year === year)) {
      for (const item of entry.lines) {
        const current = byAccount.get(item.accountNumber) ?? { debit: 0n, credit: 0n }
        current.debit += item.debit
        current.credit += item.credit
        byAccount.set(item.accountNumber, current)
      }
    }
    const lines = [...byAccount.entries()]
      .map(([accountNumber, totals]) => ({ accountNumber, ...totals }))
      .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
    const totalDebit = lines.reduce((sum, item) => sum + item.debit, 0n)
    const totalCredit = lines.reduce((sum, item) => sum + item.credit, 0n)
    if (lines.length === 0) {
      // Acknowledging an empty year records the acknowledgement; honesty stays
      // `empty` and is never promoted to reconciled (issue #42).
      if (!acknowledgedEmptyYears.has(String(year))) {
        warnings.push(
          problem('trial_balance_empty', `reconciliation.${String(year)}`, {
            year: String(year),
          }),
        )
      }
      return {
        year,
        source: 'empty',
        totalDebit: 0n,
        totalCredit: 0n,
        // Empty is not a balanced read — same honesty as unreadable (issue #42).
        balanced: null,
        accountCount: 0,
        lines,
      }
    }
    if (totalDebit !== totalCredit) {
      problems.push(
        problem('trial_balance_unbalanced', `reconciliation.${String(year)}`, {
          year: String(year),
          debit: totalDebit.toString(),
          credit: totalCredit.toString(),
        }),
      )
    }
    for (const line of lines) {
      const known =
        existingAccounts.has(line.accountNumber) ||
        accounts.some((account) => account.number === line.accountNumber)
      if (!known) {
        problems.push(
          problem(
            'trial_balance_account_missing',
            `reconciliation.${String(year)}.${line.accountNumber}`,
            {
              year: String(year),
              number: line.accountNumber,
            },
          ),
        )
      }
    }
    return {
      year,
      source: 'read',
      totalDebit,
      totalCredit,
      balanced: totalDebit === totalCredit,
      accountCount: lines.length,
      lines,
    }
  })

  if (years.length === 0 && !sourceUnreadable) {
    if (!acknowledgedEmptyYears.has('(none)')) {
      warnings.push(problem('trial_balance_empty', 'reconciliation', { year: '(none)' }))
    }
  }

  // Locked years left out wholesale — list them once on the commit report.
  for (const year of excludedLockedYears) {
    const label = `period_locked:${year}`
    if (!excluded.includes(label)) excluded.push(label)
  }

  return {
    administration: snapshot.administration,
    accounts,
    taxRates,
    contacts,
    entries,
    pendingFx,
    financialAccounts,
    documents,
    yearDocuments,
    years,
    reconciliation,
    notImported: [...MONEYBIRD_NOT_IMPORTED],
    excluded,
    warnings,
    problems,
  }
}
