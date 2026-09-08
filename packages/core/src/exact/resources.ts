import type { AccountType } from '../ledger/types.js'
import {
  readBoolean,
  readDate,
  readGuid,
  readKey,
  readMinor,
  readNumber,
  readString,
  requireDate,
  requireGuid,
  requireMinor,
  requireString,
} from './read.js'

/**
 * The Exact resources an import reads, and what each row means (spec 13).
 *
 * Every column named here was read off Exact's own reference pages
 * (`HlpRestAPIResourcesDetails.aspx`), not inferred from a sample response. The
 * `*_SELECT` lists are part of that: Exact returns all two-hundred-odd columns
 * of `crm/Accounts` when you do not ask for fewer, so naming the columns is
 * both the documentation and the request.
 */

// ---------------------------------------------------------------------------
// Chart of accounts: financial/GLAccounts
// ---------------------------------------------------------------------------

export const GL_ACCOUNT_SELECT = [
  'ID',
  'Code',
  'Description',
  'BalanceSide',
  'BalanceType',
  'Type',
  'TypeDescription',
  'IsBlocked',
  'VATCode',
  'ReportingCode',
  'Costcenter',
  'Costunit',
] as const

export interface ExactGLAccount {
  readonly id: string
  readonly code: string
  readonly description: string
  /** 'D' or 'C'. */
  readonly balanceSide: string | null
  /** 'B' (balance sheet) or 'W' (profit and loss). */
  readonly balanceType: string | null
  /** Exact's own account type. See `ACCOUNT_TYPE_BY_EXACT_TYPE`. */
  readonly type: number | null
  readonly typeDescription: string | null
  readonly isBlocked: boolean
  readonly vatCode: string | null
  /** Used in Exact's own yearly report export. Sometimes an RGS code. */
  readonly reportingCode: string | null
}

export function parseGLAccount(row: Record<string, unknown>): ExactGLAccount {
  return {
    id: requireGuid(row, 'ID'),
    code: requireString(row, 'Code'),
    description: readString(row, 'Description') ?? requireString(row, 'Code'),
    balanceSide: readString(row, 'BalanceSide'),
    balanceType: readString(row, 'BalanceType'),
    type: readNumber(row, 'Type'),
    typeDescription: readString(row, 'TypeDescription'),
    isBlocked: readBoolean(row, 'IsBlocked'),
    vatCode: readString(row, 'VATCode'),
    reportingCode: readString(row, 'ReportingCode'),
  }
}

/**
 * Exact's `Type` to ours.
 *
 * Exact has thirty-odd account types where we have five, so this is a widening
 * that throws information away — deliberately, because the information it
 * throws away is Exact's opinion about presentation and what it keeps is the
 * only thing the ledger needs: which side of which statement.
 *
 * The two entries worth arguing about:
 *
 * - **35, accumulated depreciation, is an `asset`.** It is a credit-side asset,
 *   which is exactly what a contra-asset is, and `normalBalance` carries the
 *   side. Calling it a liability would put it on the wrong half of the balance
 *   sheet.
 * - **50 and 52 are `equity`.** They are balance-sheet credit accounts, which
 *   the fallback below would call liabilities. This is the case the fallback
 *   cannot get right on its own, and the reason `Type` is consulted first.
 *
 * `90` (General), `300`, `301` and `302` (year-end reflection and costing) are
 * absent on purpose: Exact does not say which side they land on, so they go
 * through the fallback and get a warning.
 */
const ACCOUNT_TYPE_BY_EXACT_TYPE: Readonly<Record<number, AccountType>> = {
  10: 'asset', // Cash
  12: 'asset', // Bank
  14: 'liability', // Credit card
  16: 'asset', // Payment services
  20: 'asset', // Accounts receivable
  21: 'asset', // Prepayment accounts receivable
  22: 'liability', // Accounts payable
  24: 'liability', // VAT
  25: 'liability', // Employees payable
  26: 'asset', // Prepaid expenses
  27: 'liability', // Accrued expenses
  29: 'liability', // Income taxes payable
  30: 'asset', // Fixed assets
  32: 'asset', // Other assets
  35: 'asset', // Accumulated depreciation
  40: 'asset', // Inventory
  50: 'equity', // Capital stock
  52: 'equity', // Retained earnings
  55: 'liability', // Long term debt
  60: 'liability', // Current portion of debt
  100: 'liability', // Tax payable
  110: 'revenue', // Revenue
  111: 'expense', // Cost of goods
  120: 'expense', // Other costs
  121: 'expense', // Sales, general administrative expenses
  122: 'expense', // Depreciation costs
  123: 'expense', // Research and development
  125: 'expense', // Employee costs
  126: 'expense', // Employment costs
  130: 'expense', // Exceptional costs
  140: 'revenue', // Exceptional income
  150: 'expense', // Income taxes
  160: 'revenue', // Interest income
}

const DEBIT_TYPES: ReadonlySet<AccountType> = new Set(['asset', 'expense'])

export interface ClassifiedAccount {
  readonly type: AccountType
  readonly normalBalance: 'debit' | 'credit'
  /** Set when `Type` did not decide it and `BalanceType`/`BalanceSide` did. */
  readonly derived: boolean
}

/**
 * Which of our five an Exact account is.
 *
 * `BalanceSide` decides the normal balance in every case — it is the account's
 * own side in Exact and there is nothing to infer. `BalanceType` plus the side
 * is the fallback for the type, and it is right for everything except equity,
 * which is why `Type` is asked first.
 */
export function classifyAccount(account: ExactGLAccount): ClassifiedAccount {
  const known = account.type === null ? undefined : ACCOUNT_TYPE_BY_EXACT_TYPE[account.type]

  const type: AccountType =
    known ??
    (account.balanceType === 'W'
      ? account.balanceSide === 'C'
        ? 'revenue'
        : 'expense'
      : account.balanceSide === 'C'
        ? 'liability'
        : 'asset')

  // An account with no side at all is possible in Exact and has to land
  // somewhere. Its type's ordinary side is the only defensible answer, and the
  // caller is told the classification was derived.
  const normalBalance: 'debit' | 'credit' =
    account.balanceSide === 'C'
      ? 'credit'
      : account.balanceSide === 'D'
        ? 'debit'
        : DEBIT_TYPES.has(type)
          ? 'debit'
          : 'credit'

  return { type, normalBalance, derived: known === undefined || account.balanceSide === null }
}

// ---------------------------------------------------------------------------
// Contacts: crm/Accounts
// ---------------------------------------------------------------------------

export const CRM_ACCOUNT_SELECT = [
  'ID',
  'Code',
  'Name',
  'Type',
  'Status',
  'IsSales',
  'IsSupplier',
  'Blocked',
  'VATNumber',
  'ChamberOfCommerce',
  'Email',
  'Phone',
  'Website',
  'AddressLine1',
  'AddressLine2',
  'Postcode',
  'City',
  'State',
  'Country',
  'PaymentConditionSales',
  'PaymentConditionPurchase',
] as const

export interface ExactAccount {
  readonly id: string
  /** Trimmed. Exact pads this to eighteen characters with leading spaces. */
  readonly code: string
  readonly name: string
  /** 'A' = relation, 'D' = division. Divisions are not relations. */
  readonly type: string | null
  /** Filled means customer. 'A' none, 'S' suspect, 'P' prospect, 'C' customer. */
  readonly status: string | null
  readonly isSales: boolean
  readonly isSupplier: boolean
  readonly blocked: boolean
  readonly vatNumber: string | null
  readonly chamberOfCommerce: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly website: string | null
  readonly addressLine1: string | null
  readonly addressLine2: string | null
  readonly postcode: string | null
  readonly city: string | null
  readonly state: string | null
  readonly country: string | null
  readonly paymentConditionSales: string | null
  readonly paymentConditionPurchase: string | null
}

export function parseAccount(row: Record<string, unknown>): ExactAccount {
  return {
    id: requireGuid(row, 'ID'),
    // `readString` trims, which is what turns Exact's eighteen-character padded
    // key into a debiteurennummer somebody can read.
    code: requireString(row, 'Code'),
    name: readString(row, 'Name') ?? requireString(row, 'Code'),
    type: readString(row, 'Type'),
    status: readString(row, 'Status'),
    isSales: readBoolean(row, 'IsSales'),
    isSupplier: readBoolean(row, 'IsSupplier'),
    blocked: readBoolean(row, 'Blocked'),
    vatNumber: readString(row, 'VATNumber'),
    chamberOfCommerce: readString(row, 'ChamberOfCommerce'),
    email: readString(row, 'Email'),
    phone: readString(row, 'Phone'),
    website: readString(row, 'Website'),
    addressLine1: readString(row, 'AddressLine1'),
    addressLine2: readString(row, 'AddressLine2'),
    postcode: readString(row, 'Postcode'),
    city: readString(row, 'City'),
    state: readString(row, 'State'),
    country: readString(row, 'Country'),
    paymentConditionSales: readString(row, 'PaymentConditionSales'),
    paymentConditionPurchase: readString(row, 'PaymentConditionPurchase'),
  }
}

/**
 * Whether a relation is a customer, a supplier, both or neither.
 *
 * `Status === 'C'` is Exact's own answer to "is this a customer", and
 * `IsSales` is "may be sold to", which is not the same thing — a prospect has
 * `IsSales` and has never been invoiced. Both are accepted, because a relation
 * that turns out to have an open receivable needs the role whatever Exact says,
 * and the open-items pass adds it if this did not.
 */
export function rolesFor(account: ExactAccount): {
  readonly isCustomer: boolean
  readonly isSupplier: boolean
} {
  return {
    isCustomer: account.status === 'C' || account.isSales,
    isSupplier: account.isSupplier,
  }
}

// ---------------------------------------------------------------------------
// Payment conditions: cashflow/PaymentConditions
// ---------------------------------------------------------------------------

export const PAYMENT_CONDITION_SELECT = [
  'Code',
  'Description',
  'PaymentDays',
  'PaymentEndOfMonths',
] as const

export interface ExactPaymentCondition {
  readonly code: string
  readonly description: string
  readonly paymentDays: number
  /**
   * Month-endings to include in the due date. Non-zero means "end of month plus
   * n", which our `paymentTermsDays` cannot express — reported rather than
   * approximated.
   */
  readonly paymentEndOfMonths: number
}

export function parsePaymentCondition(row: Record<string, unknown>): ExactPaymentCondition {
  return {
    code: requireString(row, 'Code'),
    description: readString(row, 'Description') ?? requireString(row, 'Code'),
    paymentDays: readNumber(row, 'PaymentDays') ?? 0,
    paymentEndOfMonths: readNumber(row, 'PaymentEndOfMonths') ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Open items: read/financial/ReceivablesList and PayablesList
// ---------------------------------------------------------------------------

export const OPEN_ITEM_SELECT = [
  'HID',
  'AccountId',
  'AccountCode',
  'AccountName',
  'Amount',
  'AmountInTransit',
  'CurrencyCode',
  'Description',
  'DueDate',
  'InvoiceDate',
  'InvoiceNumber',
  'EntryNumber',
  'JournalCode',
  'YourRef',
] as const

export interface ExactOpenItem {
  readonly hid: string
  /**
   * Exact's GUID for the relation. Carried, not matched on — the plan pairs an
   * open item to a contact by `accountCode`, which is the debiteurennummer a
   * human recognises. Nullable for that reason: a row with no GUID is still a
   * perfectly good open item, and refusing the import over a field nothing
   * reads would be a strict check with no benefit behind it.
   */
  readonly accountId: string | null
  readonly accountCode: string
  readonly accountName: string
  /** Outstanding, in minor units of `currency`. */
  readonly outstanding: bigint
  /** Already handed to a bank and not yet reconciled. */
  readonly inTransit: bigint
  readonly currency: string
  readonly description: string | null
  readonly dueDate: string
  readonly invoiceDate: string
  /**
   * The number the invoice carries in Exact. Preserved rather than renumbered,
   * because dunning and matching are conversations with somebody who is looking
   * at the old number (spec 13).
   */
  readonly invoiceNumber: string
  readonly entryNumber: string | null
  readonly journalCode: string | null
  /** The counterparty's own reference. On a purchase item this is their number. */
  readonly yourRef: string | null
}

export function parseOpenItem(row: Record<string, unknown>): ExactOpenItem {
  // `HID` is `Edm.Int64`, which Exact quotes — see `readKey`. Reading it as a
  // JSON number returned null for every row, and the fallback below used to be
  // `requireGuid(row, 'Id')`, which failed twice over: `Id` is marked Obsolete
  // in Exact's own reference and it is not in `OPEN_ITEM_SELECT`, so it was
  // reading a field that was never asked for. Every open item threw.
  const hid = readKey(row, 'HID')
  const invoiceNumber = readNumber(row, 'InvoiceNumber')
  const entryNumber = readNumber(row, 'EntryNumber')

  return {
    // A composite of columns that *are* selected, when there is no HID. It has
    // to be stable across re-imports, so it is built from the entry's own
    // coordinates rather than from its position in the response.
    hid:
      hid ??
      `${readString(row, 'JournalCode') ?? '?'}-${String(entryNumber ?? '?')}-${String(invoiceNumber ?? '?')}`,
    accountId: readGuid(row, 'AccountId'),
    accountCode: requireString(row, 'AccountCode'),
    accountName: readString(row, 'AccountName') ?? requireString(row, 'AccountCode'),
    outstanding: requireMinor(row, 'Amount'),
    inTransit: readMinor(row, 'AmountInTransit') ?? 0n,
    // The list is in the division's currency unless it says otherwise, and a
    // missing code with a non-zero amount is a row we should not guess about.
    currency: requireString(row, 'CurrencyCode'),
    description: readString(row, 'Description'),
    dueDate: requireDate(row, 'DueDate'),
    invoiceDate: requireDate(row, 'InvoiceDate'),
    invoiceNumber: String(invoiceNumber ?? entryNumber ?? hid ?? ''),
    entryNumber: entryNumber === null ? null : String(entryNumber),
    journalCode: readString(row, 'JournalCode'),
    yourRef: readString(row, 'YourRef'),
  }
}

// ---------------------------------------------------------------------------
// The trial balance a dry run reconciles against: financial/ReportingBalance
// ---------------------------------------------------------------------------

export const REPORTING_BALANCE_SELECT = [
  'GLAccountCode',
  'GLAccountDescription',
  'BalanceType',
  'AmountDebit',
  'AmountCredit',
  'Amount',
  'Count',
  'ReportingYear',
  'ReportingPeriod',
  'Status',
] as const

export interface ExactReportingBalance {
  readonly accountCode: string
  readonly accountDescription: string | null
  readonly balanceType: string | null
  readonly debit: bigint
  readonly credit: bigint
  /** Debit minus credit, as Exact computed it. Kept to cross-check the two. */
  readonly amount: bigint
  readonly transactions: number
  readonly year: number
  readonly period: number
  /** 20 = open, 50 = processed. Both are asked for; see `trialBalanceFilter`. */
  readonly status: number | null
}

export function parseReportingBalance(row: Record<string, unknown>): ExactReportingBalance {
  return {
    accountCode: requireString(row, 'GLAccountCode'),
    accountDescription: readString(row, 'GLAccountDescription'),
    balanceType: readString(row, 'BalanceType'),
    debit: readMinor(row, 'AmountDebit') ?? 0n,
    credit: readMinor(row, 'AmountCredit') ?? 0n,
    amount: readMinor(row, 'Amount') ?? 0n,
    transactions: readNumber(row, 'Count') ?? 0,
    year: readNumber(row, 'ReportingYear') ?? 0,
    period: readNumber(row, 'ReportingPeriod') ?? 0,
    status: readNumber(row, 'Status'),
  }
}

/**
 * Both statuses, or the totals are wrong.
 *
 * Exact's own note on `Status`: "20 = Open, 50 = Processed. To get 'after
 * entry' results, both should be included." An import that asked for only
 * processed rows would reconcile against a trial balance missing everything
 * entered but not yet processed, and the difference would look like our bug.
 */
export function trialBalanceFilter(year: number): string {
  return `ReportingYear eq ${String(year)} and (Status eq 20 or Status eq 50)`
}

// ---------------------------------------------------------------------------
// Documents: documents/Documents and documents/DocumentAttachments
// ---------------------------------------------------------------------------

export const DOCUMENT_SELECT = [
  'ID',
  'Subject',
  'DocumentDate',
  'AccountCode',
  'AccountName',
  'Type',
  'TypeDescription',
  'Category',
  'CategoryDescription',
  'AmountFC',
  'Currency',
  'SalesInvoiceNumber',
  'HID',
] as const

export interface ExactDocument {
  readonly id: string
  readonly subject: string
  readonly documentDate: string | null
  readonly accountCode: string | null
  readonly accountName: string | null
  readonly type: number | null
  readonly typeDescription: string | null
  readonly amount: bigint | null
  readonly currency: string | null
  readonly hid: number | null
}

export function parseDocument(row: Record<string, unknown>): ExactDocument {
  return {
    id: requireGuid(row, 'ID'),
    subject: readString(row, 'Subject') ?? 'zonder onderwerp',
    documentDate: readDate(row, 'DocumentDate'),
    accountCode: readString(row, 'AccountCode'),
    accountName: readString(row, 'AccountName'),
    type: readNumber(row, 'Type'),
    typeDescription: readString(row, 'TypeDescription'),
    amount: readMinor(row, 'AmountFC'),
    currency: readString(row, 'Currency'),
    hid: readNumber(row, 'HID'),
  }
}

export const ATTACHMENT_SELECT = ['ID', 'Document', 'FileName', 'FileSize', 'Url'] as const

export interface ExactAttachment {
  readonly id: string
  readonly documentId: string
  readonly fileName: string
  readonly fileSize: number
  /**
   * Where the bytes are. Exact's own note: this URL returns the file in its
   * original format, which is why the import follows it rather than asking for
   * the base64 `Attachment` column and holding every PDF in memory as a string.
   */
  readonly url: string | null
}

export function parseAttachment(row: Record<string, unknown>): ExactAttachment {
  return {
    id: requireGuid(row, 'ID'),
    documentId: requireGuid(row, 'Document'),
    fileName: readString(row, 'FileName') ?? 'bijlage',
    fileSize: readNumber(row, 'FileSize') ?? 0,
    url: readString(row, 'Url'),
  }
}

// ---------------------------------------------------------------------------
// VAT codes: vat/VATCodes
// ---------------------------------------------------------------------------

export const VAT_CODE_SELECT = [
  'Code',
  'Description',
  'Percentage',
  'Type',
  'VATTransactionType',
  'IsBlocked',
  'Charged',
] as const

export interface ExactVatCode {
  readonly code: string
  readonly description: string
  /** Exact stores this as a fraction: 0.21 for 21%. */
  readonly percentage: number
  /** 'B' zero-rated, 'E' excluding, 'I' including, 'N' none. */
  readonly type: string | null
  /** 'B' both, 'P' purchase, 'S' sales. */
  readonly transactionType: string | null
  readonly isBlocked: boolean
  /** Domestic reverse charge: the purchase gets a to-pay line as well. */
  readonly charged: boolean
}

export function parseVatCode(row: Record<string, unknown>): ExactVatCode {
  return {
    code: requireString(row, 'Code'),
    description: readString(row, 'Description') ?? requireString(row, 'Code'),
    percentage: readNumber(row, 'Percentage') ?? 0,
    type: readString(row, 'Type'),
    transactionType: readString(row, 'VATTransactionType'),
    isBlocked: readBoolean(row, 'IsBlocked'),
    charged: readBoolean(row, 'Charged'),
  }
}

/** The GUID column of a row, when only the reference matters. */
export function referenceOf(row: Record<string, unknown>, field: string): string | null {
  return readGuid(row, field)
}
