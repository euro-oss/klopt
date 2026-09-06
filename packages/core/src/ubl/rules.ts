import { lineNet, taxOn } from '../sales/pricing.js'
import type { UblDocument, UblParty } from './model.js'

/**
 * Pre-flight against the EN 16931, Peppol BIS 3.0 and NLCIUS rules (spec 7.5).
 *
 * "Validate against the current schematron **before** send." The schematron is
 * the authority and runs over the generated XML; this runs over the document
 * *before* it is generated, so that a bookkeeper is told "the administration
 * has no address" rather than being handed an XPath assertion failure.
 *
 * Every rule here carries the official identifier and the official message,
 * copied from `reference-data/peppol/bis-3/`. Two reasons: an integrator can
 * look the code up in the Peppol documentation and find the same words, and
 * when the schematron layer lands, a disagreement between the two is visible as
 * the same id appearing on one side and not the other.
 *
 * This is a **subset**, deliberately: the rules our own generator can violate.
 * It is not a schematron and does not claim to be one. Rules about allowances,
 * charges, delivery, tax representatives and invoice periods are absent because
 * nothing here can produce those constructs yet.
 */

export interface UblRuleViolation {
  /** The official rule identifier, e.g. `BR-S-02` or `NL-R-002`. */
  readonly rule: string
  /** The rule's own wording, so it matches the published documentation. */
  readonly message: string
  /** Dotted path into the document, for a form to point at. */
  readonly path: string | null
}

/** VAT categories that must carry a zero rate and an exemption reason. */
const ZERO_RATED = new Set(['AE', 'E', 'Z', 'G', 'K'])

const NL_PAYMENT_MEANS = new Set(['30', '48', '49', '57', '58', '59'])
/** 0106 is a KvK number, 0190 an OIN. NL-R-003 accepts only these two. */
const NL_LEGAL_SCHEMES = new Set(['0106', '0190'])

const MESSAGES: Readonly<Record<string, string>> = {
  'BR-02': 'An Invoice shall have an Invoice number (BT-1).',
  'BR-03': 'An Invoice shall have an Invoice issue date (BT-2).',
  'BR-05': 'An Invoice shall have an Invoice currency code (BT-5).',
  'BR-06': 'An Invoice shall contain the Seller name (BT-27).',
  'BR-07': 'An Invoice shall contain the Buyer name (BT-44).',
  'BR-08': 'An Invoice shall contain the Seller postal address.',
  'BR-09': 'The Seller postal address (BG-5) shall contain a Seller country code (BT-40).',
  'BR-10': 'An Invoice shall contain the Buyer postal address (BG-8).',
  'BR-11': 'The Buyer postal address shall contain a Buyer country code (BT-55).',
  'BR-16': 'An Invoice shall have at least one Invoice line (BG-25)',
  'BR-CO-09':
    'The Seller VAT identifier (BT-31), the Seller tax representative VAT identifier (BT-63) ' +
    'and the Buyer VAT identifier (BT-48) shall have a prefix in accordance with ISO code ' +
    'ISO 3166-1 alpha-2 by which the country of issue may be identified.',
  'BR-CO-10': 'Sum of Invoice line net amount (BT-106) = Σ Invoice line net amount (BT-131).',
  'BR-CO-13':
    'Invoice total amount without VAT (BT-109) = Σ Invoice line net amount (BT-131) - Sum of ' +
    'allowances on document level (BT-107) + Sum of charges on document level (BT-108).',
  'BR-CO-15':
    'Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + ' +
    'Invoice total VAT amount (BT-110).',
  'BR-CO-16':
    'Amount due for payment (BT-115) = Invoice total amount with VAT (BT-112) - Paid amount ' +
    '(BT-113) + Rounding amount (BT-114).',
  'BR-CO-26':
    'In order for the buyer to automatically identify a supplier, the Seller identifier ' +
    '(BT-29), the Seller legal registration identifier (BT-30) and/or the Seller VAT ' +
    'identifier (BT-31) shall be present.',
  'BR-S-02':
    'An Invoice that contains an Invoice line (BG-25) where the Invoiced item VAT category ' +
    'code (BT-151) is "Standard rated" shall contain the Seller VAT Identifier (BT-31), the ' +
    'Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT ' +
    'identifier (BT-63).',
  'BR-S-05':
    'In an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is ' +
    '"Standard rated" the Invoiced item VAT rate (BT-152) shall be greater than zero.',
  'BR-S-08':
    'For each different value of VAT category rate (BT-119) where the VAT category code ' +
    '(BT-118) is "Standard rated", the VAT category taxable amount (BT-116) in a VAT ' +
    'breakdown (BG-23) shall equal the sum of Invoice line net amounts (BT-131) where the VAT ' +
    'rate (BT-152) equals the VAT category rate (BT-119).',
  'BR-S-09':
    'The VAT category tax amount (BT-117) in a VAT breakdown (BG-23) where VAT category code ' +
    '(BT-118) is "Standard rated" shall equal the VAT category taxable amount (BT-116) ' +
    'multiplied by the VAT category rate (BT-119).',
  'BR-AE-02':
    'An Invoice that contains an Invoice line (BG-25) where the Invoiced item VAT category ' +
    'code (BT-151) is "Reverse charge" shall contain the Seller VAT Identifier (BT-31), the ' +
    'Seller Tax registration identifier (BT-32) and/or the Seller tax representative VAT ' +
    'identifier (BT-63) and the Buyer VAT identifier (BT-48) and/or the Buyer legal ' +
    'registration identifier (BT-47).',
  'PEPPOL-EN16931-R003': 'A buyer reference or purchase order reference MUST be provided.',
  'PEPPOL-EN16931-R010': 'Buyer electronic address MUST be provided',
  'PEPPOL-EN16931-R020': 'Seller electronic address MUST be provided',
  'PEPPOL-EN16931-R120':
    'Invoice line net amount MUST equal (Invoiced quantity * (Item net price/item price base ' +
    'quantity) + Sum of invoice line charge amount - sum of invoice line allowance amount',
  'NL-R-001':
    'For suppliers in the Netherlands, if the document is a creditnote, the document MUST ' +
    'contain an invoice reference (cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID)',
  'NL-R-002':
    "For suppliers in the Netherlands the supplier's address " +
    '(cac:AccountingSupplierParty/cac:Party/cac:PostalAddress) MUST contain street name ' +
    '(cbc:StreetName), city (cbc:CityName) and post code (cbc:PostalZone)',
  'NL-R-003':
    'For suppliers in the Netherlands, the legal entity identifier MUST be either a KVK or ' +
    'OIN number (schemeID 0106 or 0190)',
  'NL-R-004':
    'For suppliers in the Netherlands, if the customer is in the Netherlands, the customer ' +
    'address (cac:AccountingCustomerParty/cac:Party/cac:PostalAddress) MUST contain the ' +
    'street name (cbc:StreetName), the city (cbc:CityName) and post code (cbc:PostalZone)',
  'NL-R-005':
    "For suppliers in the Netherlands, if the customer is in the Netherlands, the customer's " +
    'legal entity identifier MUST be either a KVK or OIN number (schemeID 0106 or 0190)',
  'NL-R-007':
    'For suppliers in the Netherlands, the supplier MUST provide a means of payment ' +
    '(cac:PaymentMeans) if the payment is from customer to supplier',
  'NL-R-008':
    'For suppliers in the Netherlands, if the customer is in the Netherlands, the payment ' +
    'means code (cac:PaymentMeans/cbc:PaymentMeansCode) MUST be one of 30, 48, 49, 57, 58 or 59',
}

/** The zero-rate and exemption-reason rules, which differ only by category. */
const CATEGORY_RULES: Readonly<Record<string, { rate: string; amount: string; reason: string }>> = {
  AE: { rate: 'BR-AE-05', amount: 'BR-AE-08', reason: 'BR-AE-10' },
  E: { rate: 'BR-E-05', amount: 'BR-E-08', reason: 'BR-E-10' },
  Z: { rate: 'BR-Z-05', amount: 'BR-Z-08', reason: 'BR-Z-09' },
  G: { rate: 'BR-G-05', amount: 'BR-G-08', reason: 'BR-G-10' },
  K: { rate: 'BR-IC-05', amount: 'BR-IC-08', reason: 'BR-IC-10' },
}

const ZERO_AMOUNT_RULES: Readonly<Record<string, string>> = {
  AE: 'BR-AE-09',
  E: 'BR-E-09',
  Z: 'BR-Z-09',
  G: 'BR-G-09',
  K: 'BR-IC-09',
}

const COUNTRY_PREFIX = /^[A-Z]{2}/

function blank(value: string | null): boolean {
  return value === null || value.trim() === ''
}

function partyIsIdentifiable(party: UblParty): boolean {
  return !blank(party.vatNumber) || !blank(party.registrationNumber)
}

/**
 * Every rule this document breaks, not the first one.
 *
 * A bookkeeper who has never filled in the administration's address is going to
 * break four rules at once, and telling them one per attempt is four round
 * trips to learn one thing.
 */
export function checkUblRules(document: UblDocument): readonly UblRuleViolation[] {
  const found: UblRuleViolation[] = []
  const fail = (rule: string, path: string | null): void => {
    found.push({ rule, message: MESSAGES[rule] ?? rule, path })
  }

  if (blank(document.number)) fail('BR-02', 'number')
  if (blank(document.issueDate)) fail('BR-03', 'issueDate')
  if (blank(document.currency)) fail('BR-05', 'currency')
  if (document.lines.length === 0) fail('BR-16', 'lines')

  const { seller, buyer } = document

  if (blank(seller.legalName)) fail('BR-06', 'seller.legalName')
  if (blank(buyer.legalName)) fail('BR-07', 'buyer.legalName')

  const sellerAddressEmpty =
    blank(seller.address.street) && blank(seller.address.city) && blank(seller.address.postalZone)
  if (sellerAddressEmpty) fail('BR-08', 'seller.address')
  if (blank(seller.address.countryCode)) fail('BR-09', 'seller.address.countryCode')

  const buyerAddressEmpty =
    blank(buyer.address.street) && blank(buyer.address.city) && blank(buyer.address.postalZone)
  if (buyerAddressEmpty) fail('BR-10', 'buyer.address')
  if (blank(buyer.address.countryCode)) fail('BR-11', 'buyer.address.countryCode')

  if (!partyIsIdentifiable(seller)) fail('BR-CO-26', 'seller')

  for (const [party, path] of [
    [seller, 'seller.vatNumber'],
    [buyer, 'buyer.vatNumber'],
  ] as const) {
    if (!blank(party.vatNumber) && !COUNTRY_PREFIX.test(party.vatNumber ?? '')) {
      fail('BR-CO-09', path)
    }
  }

  if (blank(seller.electronicAddress)) fail('PEPPOL-EN16931-R020', 'seller.electronicAddress')
  if (blank(buyer.electronicAddress)) fail('PEPPOL-EN16931-R010', 'buyer.electronicAddress')
  if (blank(document.buyerReference) && blank(document.orderReference)) {
    fail('PEPPOL-EN16931-R003', 'buyerReference')
  }

  // Line-level category and arithmetic rules.
  const netByCategory = new Map<string, bigint>()

  document.lines.forEach((line, index) => {
    const key = `${line.categoryCode}:${String(line.rateBasisPoints)}`
    netByCategory.set(key, (netByCategory.get(key) ?? 0n) + line.netAmount)

    if (line.categoryCode === 'S' && line.rateBasisPoints <= 0) {
      fail('BR-S-05', `lines.${String(index)}.rateBasisPoints`)
    }
    if (ZERO_RATED.has(line.categoryCode) && line.rateBasisPoints !== 0) {
      fail(
        CATEGORY_RULES[line.categoryCode]?.rate ?? 'BR-Z-05',
        `lines.${String(index)}.rateBasisPoints`,
      )
    }
    if (lineNet(line.quantity, line.unitPrice) !== line.netAmount) {
      fail('PEPPOL-EN16931-R120', `lines.${String(index)}.netAmount`)
    }
  })

  const categories = new Set(document.lines.map((line) => line.categoryCode))
  if (categories.has('S') && blank(seller.vatNumber)) fail('BR-S-02', 'seller.vatNumber')
  if (categories.has('AE') && (blank(seller.vatNumber) || !partyIsIdentifiable(buyer))) {
    fail('BR-AE-02', 'buyer.vatNumber')
  }

  document.taxSubtotals.forEach((subtotal, index) => {
    const key = `${subtotal.categoryCode}:${String(subtotal.rateBasisPoints)}`
    const expected = netByCategory.get(key) ?? 0n

    if (subtotal.taxableAmount !== expected) {
      const rule =
        subtotal.categoryCode === 'S'
          ? 'BR-S-08'
          : (CATEGORY_RULES[subtotal.categoryCode]?.amount ?? 'BR-S-08')
      fail(rule, `taxSubtotals.${String(index)}.taxableAmount`)
    }

    if (subtotal.categoryCode === 'S') {
      if (taxOn(subtotal.taxableAmount, subtotal.rateBasisPoints) !== subtotal.taxAmount) {
        fail('BR-S-09', `taxSubtotals.${String(index)}.taxAmount`)
      }
    } else if (ZERO_RATED.has(subtotal.categoryCode)) {
      if (subtotal.taxAmount !== 0n) {
        fail(
          ZERO_AMOUNT_RULES[subtotal.categoryCode] ?? 'BR-Z-09',
          `taxSubtotals.${String(index)}.taxAmount`,
        )
      }
      // Zero-rated is only legal with a reason. Z is the exception: a zero rate
      // is a rate, not an exemption, so EN 16931 asks for no reason at all.
      if (
        subtotal.categoryCode !== 'Z' &&
        blank(subtotal.exemptionReason) &&
        blank(subtotal.exemptionReasonCode)
      ) {
        fail(
          CATEGORY_RULES[subtotal.categoryCode]?.reason ?? 'BR-E-10',
          `taxSubtotals.${String(index)}.exemptionReason`,
        )
      }
    }
  })

  const lineSum = document.lines.reduce((sum, line) => sum + line.netAmount, 0n)
  const taxSum = document.taxSubtotals.reduce((sum, subtotal) => sum + subtotal.taxAmount, 0n)

  if (document.lineTotal !== lineSum) fail('BR-CO-10', 'lineTotal')
  if (document.taxExclusiveTotal !== document.lineTotal) fail('BR-CO-13', 'taxExclusiveTotal')
  if (document.taxInclusiveTotal !== document.taxExclusiveTotal + taxSum) {
    fail('BR-CO-15', 'taxInclusiveTotal')
  }
  if (document.payableAmount !== document.taxInclusiveTotal - document.prepaidAmount) {
    fail('BR-CO-16', 'payableAmount')
  }

  // The Dutch rules, which apply because of where the *seller* is.
  if (seller.address.countryCode.toUpperCase() === 'NL') {
    if (document.kind === 'credit_note' && blank(document.precedingInvoiceNumber)) {
      fail('NL-R-001', 'precedingInvoiceNumber')
    }
    if (
      blank(seller.address.street) ||
      blank(seller.address.city) ||
      blank(seller.address.postalZone)
    ) {
      fail('NL-R-002', 'seller.address')
    }
    if (!NL_LEGAL_SCHEMES.has(seller.registrationScheme ?? ''))
      fail('NL-R-003', 'seller.registrationScheme')

    if (buyer.address.countryCode.toUpperCase() === 'NL') {
      if (
        blank(buyer.address.street) ||
        blank(buyer.address.city) ||
        blank(buyer.address.postalZone)
      ) {
        fail('NL-R-004', 'buyer.address')
      }
      if (!NL_LEGAL_SCHEMES.has(buyer.registrationScheme ?? '')) {
        fail('NL-R-005', 'buyer.registrationScheme')
      }
      if (document.paymentMeans !== null && !NL_PAYMENT_MEANS.has(document.paymentMeans.code)) {
        fail('NL-R-008', 'paymentMeans.code')
      }
    }

    if (document.kind === 'invoice' && document.paymentMeans === null) {
      fail('NL-R-007', 'paymentMeans')
    }
  }

  return found
}
