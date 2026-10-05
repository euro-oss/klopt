import type { AccountType } from '../ledger/types.js'
import {
  readArray,
  readBoolean,
  readDate,
  readId,
  readMinor,
  readNumber,
  readString,
  requireDate,
  requireId,
  requireString,
} from './read.js'

/**
 * Moneybird resources an import reads, parsed from public API v2 shapes
 * (developer.moneybird.com). Field names are theirs.
 */

export type MoneybirdAccountType =
  | 'sales'
  | 'direct_costs'
  | 'overhead_costs'
  | 'other_income'
  | 'current_assets'
  | 'fixed_assets'
  | 'non_current_assets'
  | 'current_liabilities'
  | 'equity'
  | 'non_current_liabilities'

export interface MoneybirdLedgerAccount {
  readonly id: string
  readonly name: string
  /** The GL number (`account_id` in Moneybird). */
  readonly number: string
  readonly accountType: string
  readonly parentId: string | null
  readonly allowedDocumentTypes: readonly string[]
  readonly isSystem: boolean
  readonly rgsCode: string | null
}

export function parseLedgerAccount(row: Record<string, unknown>): MoneybirdLedgerAccount {
  return {
    id: requireId(row, 'id'),
    name: readString(row, 'name') ?? requireId(row, 'id'),
    number: readString(row, 'account_id') ?? requireId(row, 'id'),
    accountType: readString(row, 'account_type') ?? 'current_assets',
    parentId: readId(row, 'parent_id'),
    allowedDocumentTypes: readArray(row, 'allowed_document_types').filter(
      (value): value is string => typeof value === 'string',
    ),
    isSystem: readBoolean(row, 'is_system'),
    rgsCode: readString(row, 'rgs_code'),
  }
}

const DEBIT_TYPES: ReadonlySet<AccountType> = new Set(['asset', 'expense'])

const TYPE_BY_MONEYBIRD: Readonly<Record<string, AccountType>> = {
  sales: 'revenue',
  other_income: 'revenue',
  direct_costs: 'expense',
  overhead_costs: 'expense',
  expenses: 'expense',
  current_assets: 'asset',
  fixed_assets: 'asset',
  non_current_assets: 'asset',
  current_liabilities: 'liability',
  non_current_liabilities: 'liability',
  equity: 'equity',
}

export interface ClassifiedAccount {
  readonly type: AccountType
  readonly normalBalance: 'debit' | 'credit'
  readonly derived: boolean
}

export function classifyAccount(account: MoneybirdLedgerAccount): ClassifiedAccount {
  const mapped = TYPE_BY_MONEYBIRD[account.accountType]
  if (mapped !== undefined) {
    return {
      type: mapped,
      normalBalance: DEBIT_TYPES.has(mapped) ? 'debit' : 'credit',
      derived: false,
    }
  }
  // Unknown type: treat as an asset so the chart still imports, and warn.
  return { type: 'asset', normalBalance: 'debit', derived: true }
}

export interface MoneybirdTaxRate {
  readonly id: string
  readonly name: string
  readonly percentage: number
  readonly taxRateType: string
  readonly country: string | null
  readonly active: boolean
  readonly reportReference: string | null
}

export function parseTaxRate(row: Record<string, unknown>): MoneybirdTaxRate {
  return {
    id: requireId(row, 'id'),
    name: readString(row, 'name') ?? requireId(row, 'id'),
    percentage: readNumber(row, 'percentage') ?? 0,
    taxRateType: readString(row, 'tax_rate_type') ?? 'sales_invoice',
    country: readString(row, 'country'),
    active: row['active'] === undefined ? true : readBoolean(row, 'active'),
    reportReference: readString(row, 'report_reference') ?? readString(row, 'tax_report_reference'),
  }
}

export interface MoneybirdContact {
  readonly id: string
  readonly companyName: string | null
  readonly firstname: string | null
  readonly lastname: string | null
  readonly customerId: string | null
  readonly taxNumber: string | null
  readonly chamberOfCommerce: string | null
  readonly sendInvoicesToEmail: string | null
  readonly phone: string | null
  readonly address1: string | null
  readonly zipcode: string | null
  readonly city: string | null
  readonly country: string | null
  readonly sepaIban: string | null
  readonly deliveryMethod: string | null
}

export function parseContact(row: Record<string, unknown>): MoneybirdContact {
  return {
    id: requireId(row, 'id'),
    companyName: readString(row, 'company_name'),
    firstname: readString(row, 'firstname'),
    lastname: readString(row, 'lastname'),
    customerId: readString(row, 'customer_id'),
    taxNumber: readString(row, 'tax_number'),
    chamberOfCommerce: readString(row, 'chamber_of_commerce'),
    sendInvoicesToEmail: readString(row, 'send_invoices_to_email'),
    phone: readString(row, 'phone'),
    address1: readString(row, 'address1'),
    zipcode: readString(row, 'zipcode'),
    city: readString(row, 'city'),
    country: readString(row, 'country'),
    sepaIban: readString(row, 'sepa_iban'),
    deliveryMethod: readString(row, 'delivery_method'),
  }
}

export function contactName(contact: MoneybirdContact): string {
  if (contact.companyName !== null) return contact.companyName
  const person = [contact.firstname, contact.lastname].filter(Boolean).join(' ').trim()
  return person === '' ? contact.id : person
}

export interface MoneybirdDocumentDetail {
  readonly id: string
  readonly description: string
  readonly amount: string | null
  readonly price: bigint
  readonly taxRateId: string | null
  readonly ledgerAccountId: string | null
  readonly period: string | null
}

function parseDetail(row: Record<string, unknown>): MoneybirdDocumentDetail {
  return {
    id: requireId(row, 'id'),
    description: readString(row, 'description') ?? '',
    amount: readString(row, 'amount'),
    price: readMinor(row, 'price') ?? 0n,
    taxRateId: readId(row, 'tax_rate_id'),
    ledgerAccountId: readId(row, 'ledger_account_id'),
    period: readString(row, 'period'),
  }
}

export interface MoneybirdAttachment {
  readonly id: string
  readonly filename: string
  readonly contentType: string | null
  readonly size: number | null
  readonly downloadUrl: string | null
}

export function parseAttachment(row: Record<string, unknown>): MoneybirdAttachment {
  return {
    id: requireId(row, 'id'),
    filename: readString(row, 'filename') ?? requireId(row, 'id'),
    contentType: readString(row, 'content_type'),
    size: readNumber(row, 'size'),
    downloadUrl: readString(row, 'download_url') ?? readString(row, 'url'),
  }
}

function parseAttachments(row: Record<string, unknown>): readonly MoneybirdAttachment[] {
  return readArray(row, 'attachments')
    .filter(
      (value): value is Record<string, unknown> => typeof value === 'object' && value !== null,
    )
    .map(parseAttachment)
}

function parseDetails(row: Record<string, unknown>): readonly MoneybirdDocumentDetail[] {
  return readArray(row, 'details')
    .filter(
      (value): value is Record<string, unknown> => typeof value === 'object' && value !== null,
    )
    .map(parseDetail)
}

export interface MoneybirdSalesInvoice {
  readonly id: string
  readonly contactId: string | null
  readonly invoiceId: string
  readonly state: string
  readonly invoiceDate: string
  readonly dueDate: string | null
  readonly reference: string | null
  readonly currency: string
  readonly pricesAreInclTax: boolean
  readonly totalExcl: bigint
  readonly totalIncl: bigint
  readonly totalTax: bigint
  readonly details: readonly MoneybirdDocumentDetail[]
  readonly attachments: readonly MoneybirdAttachment[]
  readonly originalSalesInvoiceId: string | null
}

export function parseSalesInvoice(row: Record<string, unknown>): MoneybirdSalesInvoice {
  const invoiceDate = requireDate(row, 'invoice_date')
  return {
    id: requireId(row, 'id'),
    contactId: readId(row, 'contact_id'),
    invoiceId: readString(row, 'invoice_id') ?? requireId(row, 'id'),
    state: readString(row, 'state') ?? 'open',
    invoiceDate,
    dueDate: readDate(row, 'due_date'),
    reference: readString(row, 'reference'),
    currency: (readString(row, 'currency') ?? 'EUR').toUpperCase(),
    pricesAreInclTax: readBoolean(row, 'prices_are_incl_tax'),
    totalExcl: readMinor(row, 'total_price_excl_tax') ?? 0n,
    totalIncl: readMinor(row, 'total_price_incl_tax') ?? 0n,
    totalTax: readMinor(row, 'total_tax') ?? 0n,
    details: parseDetails(row),
    attachments: parseAttachments(row),
    originalSalesInvoiceId: readId(row, 'original_sales_invoice_id'),
  }
}

export interface MoneybirdPurchaseDocument {
  readonly id: string
  readonly kind: 'purchase_invoice' | 'receipt'
  readonly contactId: string | null
  readonly reference: string
  readonly date: string
  readonly dueDate: string | null
  readonly currency: string
  readonly state: string
  readonly totalExcl: bigint
  readonly totalIncl: bigint
  readonly totalTax: bigint
  readonly details: readonly MoneybirdDocumentDetail[]
  readonly attachments: readonly MoneybirdAttachment[]
}

function parsePurchaseLike(
  row: Record<string, unknown>,
  kind: 'purchase_invoice' | 'receipt',
): MoneybirdPurchaseDocument {
  const date = requireDate(row, 'date')
  return {
    id: requireId(row, 'id'),
    kind,
    contactId: readId(row, 'contact_id'),
    reference: readString(row, 'reference') ?? requireId(row, 'id'),
    date,
    dueDate: readDate(row, 'due_date'),
    currency: (readString(row, 'currency') ?? 'EUR').toUpperCase(),
    state: readString(row, 'state') ?? 'open',
    totalExcl: readMinor(row, 'total_price_excl_tax') ?? 0n,
    totalIncl: readMinor(row, 'total_price_incl_tax') ?? 0n,
    totalTax: readMinor(row, 'total_tax') ?? 0n,
    details: parseDetails(row),
    attachments: parseAttachments(row),
  }
}

export function parsePurchaseInvoice(row: Record<string, unknown>): MoneybirdPurchaseDocument {
  return parsePurchaseLike(row, 'purchase_invoice')
}

export function parseReceipt(row: Record<string, unknown>): MoneybirdPurchaseDocument {
  return parsePurchaseLike(row, 'receipt')
}

export interface MoneybirdFinancialAccount {
  readonly id: string
  readonly name: string
  readonly identifier: string | null
  readonly type: string
  readonly currency: string
  readonly ledgerAccountId: string | null
}

export function parseFinancialAccount(row: Record<string, unknown>): MoneybirdFinancialAccount {
  return {
    id: requireId(row, 'id'),
    name: readString(row, 'name') ?? requireId(row, 'id'),
    identifier: readString(row, 'identifier'),
    type: readString(row, 'type') ?? 'bank',
    currency: (readString(row, 'currency') ?? 'EUR').toUpperCase(),
    ledgerAccountId: readId(row, 'ledger_account_id'),
  }
}

export interface MoneybirdMutationPayment {
  readonly id: string
  readonly invoiceType: string | null
  readonly invoiceId: string | null
  readonly ledgerAccountId: string | null
  readonly price: bigint
  readonly paymentDate: string | null
}

function parseMutationPayment(row: Record<string, unknown>): MoneybirdMutationPayment {
  return {
    id: requireId(row, 'id'),
    invoiceType: readString(row, 'invoice_type') ?? readString(row, 'paymentable_type'),
    invoiceId: readId(row, 'invoice_id') ?? readId(row, 'paymentable_id'),
    ledgerAccountId: readId(row, 'ledger_account_id'),
    price: readMinor(row, 'price') ?? 0n,
    paymentDate: readDate(row, 'payment_date'),
  }
}

export interface MoneybirdFinancialMutation {
  readonly id: string
  readonly financialAccountId: string
  readonly date: string
  readonly message: string | null
  readonly amount: bigint
  readonly contraAccountName: string | null
  readonly contraAccountNumber: string | null
  readonly batchReference: string | null
  readonly amountOpen: bigint
  readonly state: string
  readonly payments: readonly MoneybirdMutationPayment[]
}

export function parseFinancialMutation(row: Record<string, unknown>): MoneybirdFinancialMutation {
  return {
    id: requireId(row, 'id'),
    financialAccountId: requireId(row, 'financial_account_id'),
    date: requireDate(row, 'date'),
    message: readString(row, 'message'),
    amount: readMinor(row, 'amount') ?? 0n,
    contraAccountName: readString(row, 'contra_account_name'),
    contraAccountNumber: readString(row, 'contra_account_number'),
    batchReference: readString(row, 'batch_reference'),
    amountOpen: readMinor(row, 'amount_open') ?? 0n,
    state: readString(row, 'state') ?? 'unprocessed',
    payments: readArray(row, 'payments')
      .filter(
        (value): value is Record<string, unknown> => typeof value === 'object' && value !== null,
      )
      .map(parseMutationPayment),
  }
}

export interface MoneybirdJournalLine {
  readonly id: string
  readonly ledgerAccountId: string | null
  readonly debit: bigint
  readonly credit: bigint
  readonly description: string
  readonly taxRateId: string | null
  readonly rowOrder: number | null
}

function parseJournalLine(row: Record<string, unknown>): MoneybirdJournalLine {
  return {
    id: requireId(row, 'id'),
    ledgerAccountId: readId(row, 'ledger_account_id'),
    debit: readMinor(row, 'debit') ?? 0n,
    credit: readMinor(row, 'credit') ?? 0n,
    description: readString(row, 'description') ?? '',
    taxRateId: readId(row, 'tax_rate_id'),
    rowOrder: readNumber(row, 'row_order'),
  }
}

export interface MoneybirdJournalDocument {
  readonly id: string
  readonly reference: string
  readonly date: string
  readonly origin: string | null
  readonly details: readonly MoneybirdJournalLine[]
  readonly attachments: readonly MoneybirdAttachment[]
}

export function parseJournalDocument(row: Record<string, unknown>): MoneybirdJournalDocument {
  return {
    id: requireId(row, 'id'),
    reference: readString(row, 'reference') ?? requireId(row, 'id'),
    date: requireDate(row, 'date'),
    origin: readString(row, 'origin'),
    details: readArray(row, 'general_journal_document_entries')
      .concat(readArray(row, 'details'))
      .filter(
        (value): value is Record<string, unknown> => typeof value === 'object' && value !== null,
      )
      .map(parseJournalLine),
    attachments: parseAttachments(row),
  }
}

export interface MoneybirdGeneralDocument {
  readonly id: string
  readonly reference: string
  readonly date: string | null
  readonly contactId: string | null
  readonly attachments: readonly MoneybirdAttachment[]
}

export function parseGeneralDocument(row: Record<string, unknown>): MoneybirdGeneralDocument {
  return {
    id: requireId(row, 'id'),
    reference: readString(row, 'reference') ?? requireString(row, 'id'),
    date: readDate(row, 'date'),
    contactId: readId(row, 'contact_id'),
    attachments: parseAttachments(row),
  }
}

export function yearOf(date: string): number {
  return Number(date.slice(0, 4))
}
