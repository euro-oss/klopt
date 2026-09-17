/**
 * The document a UBL invoice is generated from (spec 7.5).
 *
 * A deliberate intermediate: not our `sales_invoices` row and not UBL either.
 * Two reasons. The generator stays framework-free and database-free, so a
 * golden-file test needs no Postgres. And every field carries the **BT number**
 * from EN 16931 that it becomes, which is what makes the rule checks in
 * `rules.ts` legible — a violation says BT-31, and the field it means is
 * findable by searching for BT-31.
 */

/** Which flavour of EN 16931 the document claims to be. */
export type UblProfile = 'peppol-bis-3' | 'nlcius'

export const CUSTOMIZATION_ID: Readonly<Record<UblProfile, string>> = {
  'peppol-bis-3': 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
  // SI-UBL 2.0, the Dutch CIUS. Used for domestic exchange outside Peppol.
  nlcius: 'urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0',
}

export const PROFILE_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0'

export const UBL_INVOICE_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'
export const UBL_CREDIT_NOTE_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'
export const CAC_NAMESPACE =
  'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2'
export const CBC_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'

/** UNCL1001. 380 is a commercial invoice, 381 a credit note. */
export const INVOICE_TYPE_CODE = '380'
export const CREDIT_NOTE_TYPE_CODE = '381'

export interface UblAddress {
  /** BT-35 / BT-50. */
  readonly street: string | null
  /** BT-36 / BT-51. */
  readonly additionalStreet: string | null
  /** BT-37 / BT-52. */
  readonly city: string | null
  /** BT-38 / BT-53. */
  readonly postalZone: string | null
  /** BT-39 / BT-54. */
  readonly countrySubentity: string | null
  /** BT-40 / BT-55. Mandatory, ISO 3166-1 alpha-2. */
  readonly countryCode: string
}

export interface UblParty {
  /** BT-34 / BT-49, with BT-34-1 / BT-49-1 as the scheme. */
  readonly electronicAddress: string | null
  readonly electronicAddressScheme: string | null
  /** BT-28 / BT-45, the trading name. Omitted when it equals the legal name. */
  readonly tradingName: string | null
  /** BT-27 / BT-44, the registered name. Mandatory. */
  readonly legalName: string
  readonly address: UblAddress
  /** BT-31 / BT-48, the VAT identifier. */
  readonly vatNumber: string | null
  /** BT-30 / BT-47, the legal registration identifier — a KvK number here. */
  readonly registrationNumber: string | null
  readonly registrationScheme: string | null
  /** BT-41 / BT-56. */
  readonly contactName: string | null
  /** BT-42 / BT-57. */
  readonly contactPhone: string | null
  /** BT-43 / BT-58. */
  readonly contactEmail: string | null
}

/**
 * One VAT breakdown row (BG-23).
 *
 * `exemptionReason` is what makes a zero-rated line legal: EN 16931 requires a
 * reason for every category that is not standard-rated, and the schematron
 * checks it per category.
 */
export interface UblTaxSubtotal {
  /** BT-116. */
  readonly taxableAmount: bigint
  /** BT-117. */
  readonly taxAmount: bigint
  /** BT-118. UNCL5305: S, Z, E, AE, K, G, O, L, M. */
  readonly categoryCode: string
  /** BT-119, as basis points. */
  readonly rateBasisPoints: number
  /** BT-120. */
  readonly exemptionReason: string | null
  /** BT-121. */
  readonly exemptionReasonCode: string | null
}

export interface UblLine {
  /** BT-126. */
  readonly id: string
  /** BT-129, a decimal string. */
  readonly quantity: string
  /** BT-130, a UN/ECE Recommendation 20 code. */
  readonly unitCode: string
  /** BT-131. */
  readonly netAmount: bigint
  /** BT-153. */
  readonly name: string
  /** BT-154. */
  readonly description: string | null
  /** BT-146. */
  readonly unitPrice: bigint
  /** BT-151. */
  readonly categoryCode: string
  /** BT-152, as basis points. */
  readonly rateBasisPoints: number
  /** BT-133, the buyer's cost centre. */
  readonly accountingCost: string | null
}

export interface UblPaymentMeans {
  /** BT-81. UNCL4461: 30 credit transfer, 58 SEPA credit transfer. */
  readonly code: string
  /** BT-83, the remittance reference the payer quotes. */
  readonly remittanceInformation: string | null
  /** BT-84. */
  readonly iban: string | null
  /** BT-86. */
  readonly bic: string | null
  /** BT-85. */
  readonly accountName: string | null
}

export interface UblDocument {
  readonly profile: UblProfile
  readonly kind: 'invoice' | 'credit_note'
  /** BT-1. */
  readonly number: string
  /** BT-2. */
  readonly issueDate: string
  /** BT-9. */
  readonly dueDate: string | null
  /** BT-5, ISO 4217. */
  readonly currency: string
  /** BT-10. */
  readonly buyerReference: string | null
  /** BT-13. */
  readonly orderReference: string | null
  /** BT-22. */
  readonly note: string | null
  /** BT-25, the invoice a credit note corrects. */
  readonly precedingInvoiceNumber: string | null
  /** BT-26. */
  readonly precedingInvoiceIssueDate: string | null
  readonly seller: UblParty
  readonly buyer: UblParty
  readonly paymentMeans: UblPaymentMeans | null
  /** BT-20. */
  readonly paymentTerms: string | null
  readonly taxSubtotals: readonly UblTaxSubtotal[]
  /** BT-110, the sum of the subtotals. */
  readonly taxTotal: bigint
  /** BT-106. */
  readonly lineTotal: bigint
  /** BT-109. */
  readonly taxExclusiveTotal: bigint
  /** BT-112. */
  readonly taxInclusiveTotal: bigint
  /** BT-113. */
  readonly prepaidAmount: bigint
  /** BT-115. */
  readonly payableAmount: bigint
  readonly lines: readonly UblLine[]
}
