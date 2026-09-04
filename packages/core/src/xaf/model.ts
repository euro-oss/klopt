/**
 * XAF 3.2, the XML Auditfile Financieel (spec 7.3).
 *
 * "The single highest-leverage feature in the product." It is also the
 * anti-lock-in guarantee: a complete, valid XAF with RGS codes is available at
 * all times, in one click.
 *
 * This module is the typed model. It mirrors the published schema
 * (`reference-data/xaf/XmlAuditfileFinancieel3.2.xsd`) closely enough that
 * element order in the generator is the schema's element order, because XSD
 * sequences are ordered and getting that wrong is the single easiest way to
 * produce an invalid file.
 *
 * Amounts are `bigint` minor units here and become two-decimal strings at the
 * very last moment, in the generator. XAF has no signed amounts: every figure
 * is unsigned and carries a `D`/`C` alongside it.
 */

/** `D` debit, `C` credit. */
export type XafDebitCredit = 'D' | 'C'

/** `B` balance sheet, `P` profit and loss, `M` memoriaal/other. */
export type XafAccountType = 'B' | 'P' | 'M'

/**
 * Journal type. The schema allows B C G M O P S T Y Z; these are the ones a
 * Dutch bookkeeping system actually issues.
 */
export type XafJournalType = 'B' | 'C' | 'M' | 'P' | 'S' | 'Z'

/** `CU` customer, `SU` supplier, `CS` both, `ZZ` other. */
export type XafSubledgerType = 'CU' | 'SU' | 'CS' | 'ZZ'

export interface XafHeader {
  readonly fiscalYear: string
  readonly startDate: string
  readonly endDate: string
  readonly curCode: string
  readonly dateCreated: string
  readonly softwareDesc: string
  readonly softwareVersion: string
}

export interface XafAddress {
  readonly streetname: string | null
  readonly number: string | null
  readonly city: string | null
  readonly postalCode: string | null
  readonly country: string | null
}

export interface XafCompany {
  readonly companyIdent: string | null
  readonly companyName: string
  readonly taxRegistrationCountry: string
  readonly taxRegIdent: string
  readonly streetAddress: XafAddress | null
}

export interface XafCustomerSupplier {
  readonly custSupID: string
  readonly custSupName: string | null
  readonly taxRegistrationCountry: string | null
  readonly taxRegIdent: string | null
  /** `C` customer, `S` supplier, `B` both, `O` other. */
  readonly custSupTp: 'C' | 'S' | 'B' | 'O' | null
}

export interface XafLedgerAccount {
  readonly accID: string
  readonly accDesc: string
  readonly accTp: XafAccountType
  /**
   * The RGS reference code. This is the field the Belastingdienst's ODB is
   * pushing for, and the reason an accountant will accept the export.
   */
  readonly leadCode: string | null
  readonly leadDescription: string | null
  /** The RGS reference number, e.g. `1101000`. */
  readonly leadReference: string | null
}

export interface XafVatCode {
  readonly vatID: string
  readonly vatDesc: string
  readonly vatToPayAccID: string | null
  readonly vatToClaimAccID: string | null
}

export interface XafPeriod {
  readonly periodNumber: number
  readonly periodDesc: string | null
  readonly startDatePeriod: string
  readonly endDatePeriod: string
}

export interface XafOpeningBalanceLine {
  readonly nr: string
  readonly accID: string
  readonly amount: bigint
  readonly amountType: XafDebitCredit
}

export interface XafOpeningBalance {
  readonly opBalDate: string
  readonly opBalDesc: string | null
  readonly lines: readonly XafOpeningBalanceLine[]
}

export interface XafVat {
  readonly vatID: string
  /** Percentage, up to three decimals. Not money — a rate. */
  readonly vatPerc: string
  readonly vatAmnt: bigint
  readonly vatAmntTp: XafDebitCredit
}

export interface XafCurrency {
  readonly curCode: string
  readonly curAmnt: bigint
}

export interface XafTransactionLine {
  readonly nr: string
  readonly accID: string
  readonly docRef: string
  readonly effDate: string
  readonly desc: string | null
  readonly amount: bigint
  readonly amountType: XafDebitCredit
  readonly custSupID: string | null
  readonly invRef: string | null
  /** Cost centre, from the entity's own dimensions. */
  readonly costID: string | null
  readonly projID: string | null
  readonly vat: XafVat | null
  /** Present only when the line was entered in a foreign currency. */
  readonly currency: XafCurrency | null
}

export interface XafTransaction {
  readonly nr: string
  readonly desc: string | null
  readonly periodNumber: number
  readonly trDt: string
  readonly sourceID: string | null
  readonly userID: string | null
  readonly lines: readonly XafTransactionLine[]
}

export interface XafJournal {
  readonly jrnID: string
  readonly desc: string
  readonly jrnTp: XafJournalType
  readonly offsetAccID: string | null
  readonly transactions: readonly XafTransaction[]
}

export interface XafDocument {
  readonly header: XafHeader
  readonly company: XafCompany
  readonly customersSuppliers: readonly XafCustomerSupplier[]
  readonly ledgerAccounts: readonly XafLedgerAccount[]
  readonly vatCodes: readonly XafVatCode[]
  readonly periods: readonly XafPeriod[]
  readonly openingBalance: XafOpeningBalance | null
  readonly journals: readonly XafJournal[]
}

export const XAF_NAMESPACE = 'http://www.auditfiles.nl/XAF/3.2'
export const XAF_VERSION = '3.2'

/** Maximum lengths the schema enforces, for the semantic validator. */
export const XAF_LIMITS = {
  identification35: 35,
  string9: 9,
  string10: 10,
  string20: 20,
  string30: 30,
  string50: 50,
  string999: 999,
  string9999: 9999,
} as const

/** Dagboek type to XAF journal type. */
export function xafJournalType(journalType: string): XafJournalType {
  switch (journalType) {
    case 'bank':
      return 'B'
    case 'kas':
      return 'C'
    case 'inkoop':
      return 'P'
    case 'verkoop':
      return 'S'
    case 'memoriaal':
      return 'M'
    default:
      return 'Z'
  }
}

/** Account type to XAF's three-way split. */
export function xafAccountType(accountType: string): XafAccountType {
  switch (accountType) {
    case 'asset':
    case 'liability':
    case 'equity':
      return 'B'
    case 'revenue':
    case 'expense':
      return 'P'
    default:
      return 'M'
  }
}
