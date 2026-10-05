import { renderFindingMessage, type FindingMessageKey } from '../finding-messages.js'
import type { AccountType, JournalLineInput } from '../ledger/types.js'
import type { MoneybirdAdministration } from '../ports/moneybird.js'
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
): MoneybirdProblem {
  const messageKey = `moneybird.${code}` as FindingMessageKey
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

export interface MoneybirdPlannedTaxRate {
  readonly moneybirdId: string
  readonly name: string
  readonly percentage: string
  readonly taxRateType: string
  readonly proposedCode: string | null
  readonly mappedCode: string | null
  readonly mapped: boolean
  readonly used: boolean
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

export interface MoneybirdImportPlan {
  readonly administration: MoneybirdAdministration
  readonly accounts: readonly MoneybirdPlannedAccount[]
  readonly taxRates: readonly MoneybirdPlannedTaxRate[]
  readonly contacts: readonly MoneybirdPlannedContact[]
  readonly entries: readonly MoneybirdPlannedEntry[]
  readonly financialAccounts: readonly MoneybirdPlannedFinancialAccount[]
  readonly documents: readonly MoneybirdPlannedDocument[]
  readonly years: readonly number[]
  readonly reconciliation: readonly YearTrialBalance[]
  readonly notImported: readonly string[]
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

function qtyOf(amount: string | null): number {
  if (amount === null) return 1
  const match = /(-?\d+(?:\.\d+)?)/.exec(amount.replace(',', '.'))
  if (match?.[1] === undefined) return 1
  const value = Number(match[1])
  return Number.isFinite(value) && value !== 0 ? value : 1
}

function percentageText(value: number): string {
  return value.toFixed(value % 1 === 0 ? 0 : 1)
}

function proposeTaxCode(rate: MoneybirdTaxRate, rules: readonly ExistingTaxRule[]): string | null {
  const bps = Math.round(rate.percentage * 100)
  const direction = rate.taxRateType === 'purchase_invoice' ? 'input' : 'output'
  const matches = rules.filter(
    (rule) => rule.rateBasisPoints === bps && rule.direction === direction,
  )
  return matches[0]?.code ?? null
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

  const existingAccounts = new Set(options.existingAccountNumbers)
  const existingContacts = new Set(options.existingContactNumbers)
  const existingExternal = new Set(options.existingExternalIds)
  const lockedYears = new Set(options.lockedYears)
  const existingTaxCodes = new Set(options.existingTaxRules.map((rule) => rule.code))

  if (snapshot.administration.currency === null) {
    warnings.push(
      problem('unknown_currency', 'administration.currency', {
        currency: '(none)',
        functionalCurrency: options.currency,
      }),
    )
  } else if (snapshot.administration.currency.toUpperCase() !== options.currency.toUpperCase()) {
    problems.push(
      problem('unknown_currency', 'administration.currency', {
        currency: snapshot.administration.currency,
        functionalCurrency: options.currency,
      }),
    )
  }

  if (snapshot.administration.fiscalYearStartMonth === null) {
    warnings.push(problem('fiscal_year_start_unknown', 'administration.period_start_date'))
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
    if (classified.derived) {
      warnings.push(
        problem('derived_account_type', `accounts.${account.id}`, {
          name: account.name,
          number: account.number,
          accountType: account.accountType,
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
        }),
      )
      continue
    }
    seenNumbers.add(number)

    const planned: MoneybirdPlannedAccount = {
      moneybirdId: account.id,
      number,
      name: account.name,
      type: classified.type,
      normalBalance: classified.normalBalance,
      rgsCode: account.rgsCode,
      moneybirdType: account.accountType,
      exists: existingAccounts.has(number),
      derived: classified.derived,
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

  const taxRates: MoneybirdPlannedTaxRate[] = snapshot.taxRates.map((rate) => {
    const proposed = proposeTaxCode(rate, options.existingTaxRules)
    const confirmed = options.confirmedTaxMappings[rate.id]?.trim() || null
    const mappedCode = confirmed ?? proposed
    const mapped = mappedCode !== null && existingTaxCodes.has(mappedCode)
    const used = usedTaxRateIds.has(rate.id)
    if (used && !mapped) {
      problems.push(
        problem('unmapped_tax_rate', `taxRates.${rate.id}`, {
          name: rate.name,
          percentage: percentageText(rate.percentage),
        }),
      )
    }
    return {
      moneybirdId: rate.id,
      name: rate.name,
      percentage: percentageText(rate.percentage),
      taxRateType: rate.taxRateType,
      proposedCode: proposed,
      mappedCode: mapped ? mappedCode : null,
      mapped,
      used,
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
    const number = contact.customerId ?? `MB-${contact.id}`
    if (seenContactNumbers.has(number)) {
      problems.push(
        problem('contact_number_collision', `contacts.${contact.id}`, {
          number,
          name: contactName(contact),
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
      problems.push(
        problem('unmapped_account', path, {
          name: moneybirdId,
          number: '',
          accountType: '',
        }),
      )
      return fallback
    }
    return number
  }

  const entries: MoneybirdPlannedEntry[] = []

  const pushEntry = (entry: MoneybirdPlannedEntry): void => {
    const year = String(entry.year)
    if (lockedYears.has(year)) {
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
    if (debit !== credit) {
      problems.push(
        problem('unbalanced_document', entry.externalId, {
          reference: entry.documentNumber,
          debit: debit.toString(),
          credit: credit.toString(),
        }),
      )
      return
    }
    if (entry.currency !== options.currency) {
      problems.push(
        problem('unknown_currency', entry.externalId, {
          currency: entry.currency,
          functionalCurrency: options.currency,
        }),
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
        warnings.push(
          problem('attachment_without_url', `${path}.${attachment.id}`, {
            filename: attachment.filename,
          }),
        )
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

    for (const detail of invoice.details) {
      const quantity = qtyOf(detail.amount)
      let net = detail.price * BigInt(Math.round(quantity))
      const percent = detail.taxRateId === null ? 0 : (taxPercentById.get(detail.taxRateId) ?? 0)
      if (invoice.pricesAreInclTax && percent !== 0) {
        const grossLine = net
        net = (grossLine * 10000n) / BigInt(Math.round((100 + percent) * 100))
      }
      if (net < 0n) net = -net
      if (net === 0n) continue
      const taxCode =
        detail.taxRateId === null ? null : (taxById.get(detail.taxRateId)?.mappedCode ?? null)
      const tax = percent === 0 ? 0n : (net * BigInt(Math.round(percent * 100))) / 10000n
      const accountNumber = resolveAccount(
        detail.ledgerAccountId,
        '8000',
        `salesInvoices.${invoice.id}.details.${detail.id}`,
      )
      lines.push(
        line(
          accountNumber,
          revenueIsCredit ? 0n : net,
          revenueIsCredit ? net : 0n,
          detail.description || invoice.invoiceId,
          {
            taxCode,
            taxRole: taxCode === null ? null : 'base',
            taxAmount: taxCode === null ? null : revenueIsCredit ? tax : -tax,
          },
        ),
      )
    }

    const tax = invoice.totalTax < 0n ? -invoice.totalTax : invoice.totalTax
    if (tax !== 0n) {
      lines.push(
        line(
          vatPayableAccount,
          revenueIsCredit ? 0n : tax,
          revenueIsCredit ? tax : 0n,
          `BTW ${invoice.invoiceId}`,
        ),
      )
    }

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
    const contactNumber =
      document.contactId === null ? null : (contactNumberById.get(document.contactId) ?? null)
    const payableIsCredit = !isCredit
    const lines: JournalLineInput[] = []
    const gross = document.totalIncl < 0n ? -document.totalIncl : document.totalIncl

    for (const detail of document.details) {
      const quantity = qtyOf(detail.amount)
      let net = detail.price * BigInt(Math.round(quantity))
      if (net < 0n) net = -net
      if (net === 0n) continue
      const taxCode =
        detail.taxRateId === null ? null : (taxById.get(detail.taxRateId)?.mappedCode ?? null)
      const percent = detail.taxRateId === null ? 0 : (taxPercentById.get(detail.taxRateId) ?? 0)
      const tax = percent === 0 ? 0n : (net * BigInt(Math.round(percent * 100))) / 10000n
      const accountNumber = resolveAccount(
        detail.ledgerAccountId,
        '4000',
        `${document.kind}s.${document.id}.details.${detail.id}`,
      )
      lines.push(
        line(
          accountNumber,
          payableIsCredit ? net : 0n,
          payableIsCredit ? 0n : net,
          detail.description || document.reference,
          {
            taxCode,
            taxRole: taxCode === null ? null : 'base',
            taxAmount: taxCode === null ? null : payableIsCredit ? tax : -tax,
          },
        ),
      )
    }

    const tax = document.totalTax < 0n ? -document.totalTax : document.totalTax
    if (tax !== 0n) {
      lines.push(
        line(
          vatReceivableAccount,
          payableIsCredit ? tax : 0n,
          payableIsCredit ? 0n : tax,
          `BTW ${document.reference}`,
        ),
      )
    }

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
      warnings.push(
        problem('trial_balance_empty', `reconciliation.${String(year)}`, { year: String(year) }),
      )
      return {
        year,
        source: 'empty',
        totalDebit: 0n,
        totalCredit: 0n,
        balanced: true,
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
    warnings.push(problem('trial_balance_empty', 'reconciliation', { year: '(none)' }))
  }

  return {
    administration: snapshot.administration,
    accounts,
    taxRates,
    contacts,
    entries,
    financialAccounts,
    documents,
    years,
    reconciliation,
    notImported: [...MONEYBIRD_NOT_IMPORTED],
    warnings,
    problems,
  }
}
