import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkPurchaseInvoice,
  isBookable,
  parseUblInvoice,
  suggestTaxCode,
  type ParseUblInvoiceOptions,
  type TaxCodeRule,
} from '../../src/index.js'

/**
 * Reading an invoice somebody sent us.
 *
 * The test worth having is the round trip: an invoice this system generated in
 * M1, read back as a purchase draft. If the two halves disagree about what a
 * UBL invoice is, the round trip is where it shows — and it is the same
 * exercise a real counterparty puts us through, only with a document we can
 * regenerate when it fails.
 */

const GOLDEN = join(import.meta.dirname, '..', 'ubl', '__golden__')

const TAX_CODES: ParseUblInvoiceOptions['taxCodes'] = [
  {
    code: 'VH21',
    rateBasisPoints: 2100,
    direction: 'input',
    ublCategory: 'S',
    scope: 'domestic',
    reverseCharge: 'none',
    deductibility: 'full',
  },
  {
    code: 'VL9',
    rateBasisPoints: 900,
    direction: 'input',
    ublCategory: 'S',
    scope: 'domestic',
    reverseCharge: 'none',
    deductibility: 'full',
  },
  {
    code: 'VERL-VOOR',
    rateBasisPoints: 2100,
    direction: 'input',
    ublCategory: 'AE',
    scope: 'domestic',
    reverseCharge: 'domestic',
    deductibility: 'full',
  },
  // The 5b half of a reverse-charge pair. Indistinguishable from VH21 by
  // scope, rate and deductibility, and it sorts before it — which is how it
  // won an ordinary domestic line until `isDeductionHalf` stopped it.
  {
    code: 'VERL-DEDUCT',
    rateBasisPoints: 2100,
    direction: 'input',
    ublCategory: 'S',
    scope: 'domestic',
    reverseCharge: 'none',
    deductibility: 'full',
    isDeductionHalf: true,
  },
  {
    code: 'ICV21',
    rateBasisPoints: 2100,
    direction: 'input',
    ublCategory: 'K',
    scope: 'intra_community_acquisition',
    reverseCharge: 'none',
    deductibility: 'full',
  },
  // An output code, which must never be suggested for a purchase.
  {
    code: 'H21',
    rateBasisPoints: 2100,
    direction: 'output',
    ublCategory: 'S',
    scope: 'domestic',
    reverseCharge: 'none',
    deductibility: 'full',
  },
]

const OPTIONS: ParseUblInvoiceOptions = {
  functionalCurrency: 'EUR',
  suspenseAccountNumber: '2000',
  taxCodes: TAX_CODES,
}

const parse = (xml: string, overrides: Partial<ParseUblInvoiceOptions> = {}) =>
  parseUblInvoice(xml, { ...OPTIONS, ...overrides })

function golden(name: string): string {
  return readFileSync(join(GOLDEN, name), 'utf8')
}

describe('the round trip with our own outbound UBL', () => {
  it('reads back an invoice this system generated', () => {
    const parsed = parse(golden('peppol-bis-3-invoice.xml'))

    expect(parsed.invoice.kind).toBe('invoice')
    expect(parsed.invoice.supplierInvoiceNumber).not.toBe('')
    expect(parsed.invoice.currency).toBe('EUR')

    // The amounts are the document's, and they agree with each other — which
    // is the property `check.ts` will demand before it can be booked. The
    // golden invoice runs two rates, 21% and 9%.
    expect(parsed.invoice.netMinorUnits).toBe(150_000n)
    expect(parsed.invoice.taxMinorUnits).toBe(25_500n)
    expect(parsed.invoice.totalMinorUnits).toBe(175_500n)

    expect(parsed.supplier.name).not.toBeNull()
    expect(parsed.findings.filter((finding) => finding.severity === 'blocking')).toEqual([])
  })

  it('produces a draft that our own checks accept', () => {
    // The end-to-end claim: what comes out of the reader is bookable, once a
    // human has confirmed the coding. Nothing about the parse leaves the draft
    // internally inconsistent.
    const parsed = parse(golden('peppol-bis-3-invoice.xml'))

    // Both rates the golden invoice uses. A rule missing for one of them is a
    // blocking finding, which is itself the right behaviour.
    const rule = (code: string, rateBasisPoints: number): TaxCodeRule => ({
      code,
      description: code,
      rateBasisPoints,
      validFrom: '2020-01-01',
      validTo: null,
      direction: 'input',
      baseRubriek: null,
      vatRubriek: '5b',
      reverseCharge: 'none',
      scope: 'domestic',
      deductibility: 'full',
      proRataBasisPoints: null,
      supplyKind: 'not_applicable',
      ublCategory: 'S',
      deductionCode: null,
    })
    const rules: TaxCodeRule[] = [rule('VH21', 2100), rule('VL9', 900)]

    const findings = checkPurchaseInvoice({
      invoice: parsed.invoice,
      rules,
      isDuplicate: false,
    })
    expect(isBookable(findings)).toBe(true)
    expect(findings).toEqual([])
  })

  it('reads back a credit note as a credit note', () => {
    const parsed = parse(golden('peppol-bis-3-credit-note.xml'))

    expect(parsed.invoice.kind).toBe('credit_note')
    expect(parsed.findings.some((finding) => finding.code === 'credit_note')).toBe(true)
    expect(parsed.invoice.lines.length).toBeGreaterThan(0)
  })

  it('reads back a reverse-charge invoice with no VAT on its lines', () => {
    const parsed = parse(golden('peppol-bis-3-reverse-charge.xml'))

    // The sender charged nothing, so the document carries nothing. What we owe
    // is our question, and the suggested code is the one that asks it.
    expect(parsed.invoice.taxMinorUnits).toBe(0n)
    expect(parsed.invoice.lines.every((line) => line.taxMinorUnits === 0n)).toBe(true)
    expect(parsed.declaredTax[0]?.categoryCode).toBe('AE')
    expect(parsed.invoice.lines[0]?.taxCode).toBe('VERL-VOOR')
  })
})

describe('parseUblInvoice', () => {
  const minimal = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>F-2026-0042</cbc:ID>
  <cbc:IssueDate>2026-02-10</cbc:IssueDate>
  <cbc:DueDate>2026-03-12</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>KOSTENPLAATS-7</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="0106">87654321</cbc:EndpointID>
      <cac:PartyName><cbc:Name>Leverancier B.V.</cbc:Name></cac:PartyName>
      <cac:PostalAddress><cac:Country><cbc:IdentificationCode>NL</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      <cac:PartyTaxScheme><cbc:CompanyID>NL987654321B01</cbc:CompanyID></cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:CompanyID>87654321</cbc:CompanyID></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:PaymentMeans>
    <cbc:PaymentID>0123456789012345</cbc:PaymentID>
    <cac:PayeeFinancialAccount><cbc:ID>NL02ABNA0123456789</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">210.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1210.00</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Kantoorartikelen</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
  </cac:InvoiceLine>
</Invoice>`

  it('takes the sender’s totals as stated', () => {
    const parsed = parse(minimal)
    expect(parsed.invoice).toMatchObject({
      supplierInvoiceNumber: 'F-2026-0042',
      invoiceDate: '2026-02-10',
      dueDate: '2026-03-12',
      netMinorUnits: 100_000n,
      taxMinorUnits: 21_000n,
      totalMinorUnits: 121_000n,
    })
    expect(parsed.findings).toEqual([])
  })

  it('reads the sender’s identity in every form the document offers', () => {
    const parsed = parse(minimal)
    expect(parsed.supplier).toMatchObject({
      name: 'Leverancier B.V.',
      vatNumber: 'NL987654321B01',
      kvkNumber: '87654321',
      iban: 'NL02ABNA0123456789',
      electronicAddress: '87654321',
      electronicAddressScheme: '0106',
      countryCode: 'NL',
    })
  })

  it('keeps the buyer and payment references, because a payment quotes them', () => {
    const parsed = parse(minimal)
    expect(parsed.buyerReference).toBe('KOSTENPLAATS-7')
    expect(parsed.paymentReference).toBe('0123456789012345')
  })

  it('suggests one of our input codes from the sender’s category', () => {
    const parsed = parse(minimal)
    expect(parsed.invoice.lines[0]?.taxCode).toBe('VH21')
    // Never an output code, whatever the category says.
    expect(parsed.invoice.lines[0]?.taxCode).not.toBe('H21')
  })

  it('parks every line on the suspense account until somebody codes it', () => {
    // The account a cost belongs on is not in the document — it is a judgement
    // about what the cost is for. Guessing would put a laptop in stationery.
    const parsed = parse(minimal)
    expect(parsed.invoice.lines.every((line) => line.accountNumber === '2000')).toBe(true)
  })

  it('reads a bare integer amount as euros, not as cents', () => {
    // `1210` in a document means twelve hundred and ten euro. The same string
    // typed into a form by a human means twelve euro ten, which is why the
    // document path does not reuse the human parser.
    const parsed = parse(
      minimal.replace(
        '<cbc:TaxExclusiveAmount currencyID="EUR">1000.00<',
        '<cbc:TaxExclusiveAmount currencyID="EUR">1000<',
      ),
    )
    expect(parsed.invoice.netMinorUnits).toBe(100_000n)
  })

  it('warns when the sender cannot be identified beyond a name', () => {
    const anonymous = minimal
      .replace(/<cbc:EndpointID[^>]*>[^<]*<\/cbc:EndpointID>/, '')
      .replace(/<cac:PartyTaxScheme>[\s\S]*?<\/cac:PartyTaxScheme>/, '')
      .replace(/<cac:PartyLegalEntity>[\s\S]*?<\/cac:PartyLegalEntity>/, '')

    const parsed = parse(anonymous)
    const finding = parsed.findings.find((entry) => entry.code === 'no_supplier_identifier')
    expect(finding?.severity).toBe('warning')
    // Still parsed: a document nobody can match is still a document to look at.
    expect(parsed.invoice.totalMinorUnits).toBe(121_000n)
  })

  it('blocks a document with no invoice number, which nothing can identify', () => {
    const parsed = parse(minimal.replace('<cbc:ID>F-2026-0042</cbc:ID>', ''))
    const finding = parsed.findings.find((entry) => entry.code === 'no_invoice_number')
    expect(finding?.severity).toBe('blocking')
  })

  it('falls back to the issue date when there is no due date, and says so', () => {
    const parsed = parse(minimal.replace('<cbc:DueDate>2026-03-12</cbc:DueDate>', ''))
    expect(parsed.invoice.dueDate).toBe('2026-02-10')
    expect(parsed.findings.some((entry) => entry.code === 'no_due_date')).toBe(true)
  })

  it('warns about a foreign currency rather than converting it', () => {
    const parsed = parse(
      minimal.replace('>EUR</cbc:DocumentCurrencyCode>', '>USD</cbc:DocumentCurrencyCode>'),
    )
    expect(parsed.invoice.currency).toBe('USD')
    expect(parsed.findings.some((entry) => entry.code === 'currency_not_functional')).toBe(true)
  })

  it('warns when the document total does not match its own lines', () => {
    // A document-level charge or allowance, usually. Both figures are kept as
    // they are; inventing a line to reconcile them would be inventing data.
    const parsed = parse(
      minimal.replace(
        '<cbc:TaxExclusiveAmount currencyID="EUR">1000.00<',
        '<cbc:TaxExclusiveAmount currencyID="EUR">1100.00<',
      ),
    )
    expect(parsed.findings.some((entry) => entry.code === 'totals_disagree_with_lines')).toBe(true)
    expect(parsed.invoice.netMinorUnits).toBe(110_000n)
  })

  it('says so when no tax code fits, rather than picking one', () => {
    const parsed = parse(
      minimal.replace('<cbc:Percent>21</cbc:Percent>', '<cbc:Percent>13.5</cbc:Percent>'),
    )
    expect(parsed.invoice.lines[0]?.taxCode).toBe('')
    expect(parsed.findings.some((entry) => entry.code === 'unmapped_tax_category')).toBe(true)
  })

  it('refuses something that is not a UBL invoice at all', () => {
    expect(() => parse('<html><body>hello</body></html>')).toThrow(/Invoice or CreditNote/)
    expect(() => parse('not xml')).toThrow()
  })

  it('refuses an invoice with no lines', () => {
    expect(() =>
      parse(minimal.replace(/<cac:InvoiceLine>[\s\S]*?<\/cac:InvoiceLine>/, '')),
    ).toThrow(/no invoice lines/)
  })
})

describe('suggestTaxCode', () => {
  const line = (categoryCode: string | null, percent: string | null) => ({
    lineNumber: 1,
    categoryCode,
    percent,
  })

  it('matches a domestic rate exactly, in basis points', () => {
    expect(suggestTaxCode(TAX_CODES, line('S', '21'))).toBe('VH21')
    expect(suggestTaxCode(TAX_CODES, line('S', '21.00'))).toBe('VH21')
    expect(suggestTaxCode(TAX_CODES, line('S', '9'))).toBe('VL9')
  })

  it('reads a reverse charge from the category, not from the rate', () => {
    // AE carries no percentage at all, which is the point: the rate is ours.
    expect(suggestTaxCode(TAX_CODES, line('AE', null))).toBe('VERL-VOOR')
    expect(suggestTaxCode(TAX_CODES, line('K', null))).toBe('ICV21')
  })

  it('never suggests the deduction half of a reverse-charge pair', () => {
    // It looks exactly like an ordinary domestic input code. Suggesting it for
    // a normal invoice would put the VAT in rubriek 5b with no matching
    // liability in 2a or 4b — an understatement nothing downstream would catch.
    expect(suggestTaxCode(TAX_CODES, line('S', '21'))).toBe('VH21')
    expect(suggestTaxCode(TAX_CODES, line('S', '21'))).not.toBe('VERL-DEDUCT')
  })

  it('never suggests an output code', () => {
    const outputsOnly = TAX_CODES.filter((code) => code.direction === 'output')
    expect(suggestTaxCode(outputsOnly, line('S', '21'))).toBeNull()
  })

  it('returns null rather than guessing at an unfamiliar rate', () => {
    expect(suggestTaxCode(TAX_CODES, line('S', '13.5'))).toBeNull()
    expect(suggestTaxCode(TAX_CODES, line(null, null))).toBeNull()
  })
})
