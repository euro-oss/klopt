import { escapeXml } from '../xaf/generate.js'
import {
  CAC_NAMESPACE,
  CBC_NAMESPACE,
  CREDIT_NOTE_TYPE_CODE,
  CUSTOMIZATION_ID,
  INVOICE_TYPE_CODE,
  PROFILE_ID,
  UBL_CREDIT_NOTE_NAMESPACE,
  UBL_INVOICE_NAMESPACE,
  type UblAddress,
  type UblDocument,
  type UblLine,
  type UblParty,
  type UblTaxSubtotal,
} from './model.js'

/**
 * UBL 2.1, in the Peppol BIS Billing 3.0 shape (spec 7.5).
 *
 * Written by hand against the schema, for the same reasons the XAF generator
 * is: **UBL's XSD sequences are ordered**, so the order of the writes below is
 * the contract and is worth having visible in one list; and every amount is a
 * two-decimal string produced from a bigint without touching a float, which is
 * exactly the guarantee a generic serialiser loses.
 *
 * "The XML is the legal invoice, the PDF is a rendering" (spec 7.5). Treat this
 * file accordingly: the output is the document, not a report about it.
 */

const INDENT = '  '

class XmlWriter {
  private readonly parts: string[] = []
  private depth = 0

  open(name: string, attributes: Record<string, string | null> = {}): void {
    const attrs = Object.entries(attributes)
      .filter((pair): pair is [string, string] => pair[1] !== null)
      .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
      .join('')
    this.parts.push(`${INDENT.repeat(this.depth)}<${name}${attrs}>\n`)
    this.depth += 1
  }

  close(name: string): void {
    this.depth -= 1
    this.parts.push(`${INDENT.repeat(this.depth)}</${name}>\n`)
  }

  /** Writes nothing when the value is null. UBL marks absence by omission. */
  leaf(name: string, value: string | null, attributes: Record<string, string | null> = {}): void {
    if (value === null) return
    const attrs = Object.entries(attributes)
      .filter((pair): pair is [string, string] => pair[1] !== null)
      .map(([key, attribute]) => ` ${key}="${escapeXml(attribute)}"`)
      .join('')
    this.parts.push(`${INDENT.repeat(this.depth)}<${name}${attrs}>${escapeXml(value)}</${name}>\n`)
  }

  toString(): string {
    return this.parts.join('')
  }
}

/**
 * Minor units to a decimal string, through integers only.
 *
 * Signed, unlike XAF: a credit note in UBL carries positive amounts and is
 * distinguished by its document type, but a negative line on an ordinary
 * invoice is legal and must survive.
 */
export function ublAmount(minorUnits: bigint, exponent = 2): string {
  const negative = minorUnits < 0n
  const digits = (negative ? -minorUnits : minorUnits).toString().padStart(exponent + 1, '0')
  const whole = digits.slice(0, digits.length - exponent)
  const fraction = exponent === 0 ? '' : `.${digits.slice(digits.length - exponent)}`
  return `${negative ? '-' : ''}${whole}${fraction}`
}

/**
 * Basis points to the percentage UBL wants: 2100 becomes `21`, 875 becomes
 * `8.75`. No trailing zeros — `21.00` is legal but nothing else writes it, and
 * a golden file that matches what other systems produce is easier to compare.
 */
export function ublPercent(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100)
  const fraction = Math.abs(basisPoints % 100)
  if (fraction === 0) return String(whole)
  return `${String(whole)}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`
}

function writeAddress(writer: XmlWriter, address: UblAddress): void {
  writer.open('cac:PostalAddress')
  writer.leaf('cbc:StreetName', address.street)
  writer.leaf('cbc:AdditionalStreetName', address.additionalStreet)
  writer.leaf('cbc:CityName', address.city)
  writer.leaf('cbc:PostalZone', address.postalZone)
  writer.leaf('cbc:CountrySubentity', address.countrySubentity)
  writer.open('cac:Country')
  writer.leaf('cbc:IdentificationCode', address.countryCode)
  writer.close('cac:Country')
  writer.close('cac:PostalAddress')
}

function writeParty(writer: XmlWriter, element: string, party: UblParty): void {
  writer.open(element)
  writer.open('cac:Party')

  writer.leaf('cbc:EndpointID', party.electronicAddress, {
    schemeID: party.electronicAddressScheme,
  })

  if (party.registrationNumber !== null) {
    writer.open('cac:PartyIdentification')
    writer.leaf('cbc:ID', party.registrationNumber, { schemeID: party.registrationScheme })
    writer.close('cac:PartyIdentification')
  }

  // BT-28 only when it differs from BT-27. Emitting the same string twice is
  // legal and is the sort of thing that makes a rendering read badly.
  if (party.tradingName !== null && party.tradingName !== party.legalName) {
    writer.open('cac:PartyName')
    writer.leaf('cbc:Name', party.tradingName)
    writer.close('cac:PartyName')
  }

  writeAddress(writer, party.address)

  if (party.vatNumber !== null) {
    writer.open('cac:PartyTaxScheme')
    writer.leaf('cbc:CompanyID', party.vatNumber)
    writer.open('cac:TaxScheme')
    writer.leaf('cbc:ID', 'VAT')
    writer.close('cac:TaxScheme')
    writer.close('cac:PartyTaxScheme')
  }

  writer.open('cac:PartyLegalEntity')
  writer.leaf('cbc:RegistrationName', party.legalName)
  writer.leaf('cbc:CompanyID', party.registrationNumber, { schemeID: party.registrationScheme })
  writer.close('cac:PartyLegalEntity')

  if (party.contactName !== null || party.contactPhone !== null || party.contactEmail !== null) {
    writer.open('cac:Contact')
    writer.leaf('cbc:Name', party.contactName)
    writer.leaf('cbc:Telephone', party.contactPhone)
    writer.leaf('cbc:ElectronicMail', party.contactEmail)
    writer.close('cac:Contact')
  }

  writer.close('cac:Party')
  writer.close(element)
}

function writeTaxSubtotal(writer: XmlWriter, currency: string, subtotal: UblTaxSubtotal): void {
  writer.open('cac:TaxSubtotal')
  writer.leaf('cbc:TaxableAmount', ublAmount(subtotal.taxableAmount), { currencyID: currency })
  writer.leaf('cbc:TaxAmount', ublAmount(subtotal.taxAmount), { currencyID: currency })
  writer.open('cac:TaxCategory')
  writer.leaf('cbc:ID', subtotal.categoryCode)
  writer.leaf('cbc:Percent', ublPercent(subtotal.rateBasisPoints))
  writer.leaf('cbc:TaxExemptionReasonCode', subtotal.exemptionReasonCode)
  writer.leaf('cbc:TaxExemptionReason', subtotal.exemptionReason)
  writer.open('cac:TaxScheme')
  writer.leaf('cbc:ID', 'VAT')
  writer.close('cac:TaxScheme')
  writer.close('cac:TaxCategory')
  writer.close('cac:TaxSubtotal')
}

function writeLine(
  writer: XmlWriter,
  kind: UblDocument['kind'],
  currency: string,
  line: UblLine,
): void {
  const element = kind === 'invoice' ? 'cac:InvoiceLine' : 'cac:CreditNoteLine'
  const quantityElement = kind === 'invoice' ? 'cbc:InvoicedQuantity' : 'cbc:CreditedQuantity'

  writer.open(element)
  writer.leaf('cbc:ID', line.id)
  writer.leaf(quantityElement, line.quantity, { unitCode: line.unitCode })
  writer.leaf('cbc:LineExtensionAmount', ublAmount(line.netAmount), { currencyID: currency })
  writer.leaf('cbc:AccountingCost', line.accountingCost)

  writer.open('cac:Item')
  writer.leaf('cbc:Description', line.description)
  writer.leaf('cbc:Name', line.name)
  writer.open('cac:ClassifiedTaxCategory')
  writer.leaf('cbc:ID', line.categoryCode)
  writer.leaf('cbc:Percent', ublPercent(line.rateBasisPoints))
  writer.open('cac:TaxScheme')
  writer.leaf('cbc:ID', 'VAT')
  writer.close('cac:TaxScheme')
  writer.close('cac:ClassifiedTaxCategory')
  writer.close('cac:Item')

  writer.open('cac:Price')
  writer.leaf('cbc:PriceAmount', ublAmount(line.unitPrice), { currencyID: currency })
  writer.close('cac:Price')

  writer.close(element)
}

export function generateUbl(document: UblDocument): string {
  const invoice = document.kind === 'invoice'
  const root = invoice ? 'Invoice' : 'CreditNote'
  const currency = document.currency
  const writer = new XmlWriter()

  writer.open(root, {
    xmlns: invoice ? UBL_INVOICE_NAMESPACE : UBL_CREDIT_NOTE_NAMESPACE,
    'xmlns:cac': CAC_NAMESPACE,
    'xmlns:cbc': CBC_NAMESPACE,
  })

  writer.leaf('cbc:CustomizationID', CUSTOMIZATION_ID[document.profile])
  writer.leaf('cbc:ProfileID', PROFILE_ID)
  writer.leaf('cbc:ID', document.number)
  writer.leaf('cbc:IssueDate', document.issueDate)
  // A credit note carries no DueDate in BIS: there is nothing to pay by.
  if (invoice) writer.leaf('cbc:DueDate', document.dueDate)
  writer.leaf(
    invoice ? 'cbc:InvoiceTypeCode' : 'cbc:CreditNoteTypeCode',
    invoice ? INVOICE_TYPE_CODE : CREDIT_NOTE_TYPE_CODE,
  )
  writer.leaf('cbc:Note', document.note)
  writer.leaf('cbc:DocumentCurrencyCode', currency)
  writer.leaf('cbc:BuyerReference', document.buyerReference)

  if (document.orderReference !== null) {
    writer.open('cac:OrderReference')
    writer.leaf('cbc:ID', document.orderReference)
    writer.close('cac:OrderReference')
  }

  if (document.precedingInvoiceNumber !== null) {
    writer.open('cac:BillingReference')
    writer.open('cac:InvoiceDocumentReference')
    writer.leaf('cbc:ID', document.precedingInvoiceNumber)
    writer.leaf('cbc:IssueDate', document.precedingInvoiceIssueDate)
    writer.close('cac:InvoiceDocumentReference')
    writer.close('cac:BillingReference')
  }

  writeParty(writer, 'cac:AccountingSupplierParty', document.seller)
  writeParty(writer, 'cac:AccountingCustomerParty', document.buyer)

  if (document.paymentMeans !== null) {
    const means = document.paymentMeans
    writer.open('cac:PaymentMeans')
    writer.leaf('cbc:PaymentMeansCode', means.code)
    writer.leaf('cbc:PaymentID', means.remittanceInformation)
    if (means.iban !== null) {
      writer.open('cac:PayeeFinancialAccount')
      writer.leaf('cbc:ID', means.iban)
      writer.leaf('cbc:Name', means.accountName)
      if (means.bic !== null) {
        writer.open('cac:FinancialInstitutionBranch')
        writer.leaf('cbc:ID', means.bic)
        writer.close('cac:FinancialInstitutionBranch')
      }
      writer.close('cac:PayeeFinancialAccount')
    }
    writer.close('cac:PaymentMeans')
  }

  if (document.paymentTerms !== null) {
    writer.open('cac:PaymentTerms')
    writer.leaf('cbc:Note', document.paymentTerms)
    writer.close('cac:PaymentTerms')
  }

  writer.open('cac:TaxTotal')
  writer.leaf('cbc:TaxAmount', ublAmount(document.taxTotal), { currencyID: currency })
  for (const subtotal of document.taxSubtotals) writeTaxSubtotal(writer, currency, subtotal)
  writer.close('cac:TaxTotal')

  writer.open('cac:LegalMonetaryTotal')
  writer.leaf('cbc:LineExtensionAmount', ublAmount(document.lineTotal), { currencyID: currency })
  writer.leaf('cbc:TaxExclusiveAmount', ublAmount(document.taxExclusiveTotal), {
    currencyID: currency,
  })
  writer.leaf('cbc:TaxInclusiveAmount', ublAmount(document.taxInclusiveTotal), {
    currencyID: currency,
  })
  // BT-113 is optional, and writing `0.00` where nothing was prepaid is noise.
  if (document.prepaidAmount !== 0n) {
    writer.leaf('cbc:PrepaidAmount', ublAmount(document.prepaidAmount), { currencyID: currency })
  }
  writer.leaf('cbc:PayableAmount', ublAmount(document.payableAmount), { currencyID: currency })
  writer.close('cac:LegalMonetaryTotal')

  for (const line of document.lines) writeLine(writer, document.kind, currency, line)

  writer.close(root)

  return `<?xml version="1.0" encoding="UTF-8"?>\n${writer.toString()}`
}
