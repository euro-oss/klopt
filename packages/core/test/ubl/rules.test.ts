import { describe, expect, it } from 'vitest'
import { toUblDocument } from '../../src/ubl/from-invoice.js'
import { checkUblRules } from '../../src/ubl/rules.js'
import { referenceCreditNote, referenceInvoice, reverseChargeInvoice } from './fixture.js'

/**
 * The pre-flight rules (spec 7.5).
 *
 * Each case breaks exactly one rule, and asserts the official identifier —
 * because the identifier is the contract. A bookkeeper sees the message, an
 * integrator branches on `NL-R-002`, and when the schematron layer lands the
 * two can be compared rule by rule.
 */

const rulesFor = (source: Parameters<typeof toUblDocument>[0]): string[] =>
  checkUblRules(toUblDocument(source)).map((violation) => violation.rule)

describe('what a Dutch seller must have', () => {
  it('is clean to begin with', () => {
    expect(rulesFor(referenceInvoice())).toEqual([])
  })

  it('needs a street, a city and a postcode (NL-R-002)', () => {
    const rules = rulesFor({
      ...referenceInvoice(),
      seller: { ...referenceInvoice().seller, street: null, city: null, postalCode: null },
    })
    // BR-08 fires too: an address with none of the three is no address at all.
    expect(rules).toContain('NL-R-002')
    expect(rules).toContain('BR-08')
  })

  it('needs a KvK number, in scheme 0106 (NL-R-003)', () => {
    expect(
      rulesFor({
        ...referenceInvoice(),
        seller: { ...referenceInvoice().seller, kvkNumber: null },
      }),
    ).toContain('NL-R-003')
  })

  it('needs a payment instruction on an invoice (NL-R-007)', () => {
    expect(rulesFor({ ...referenceInvoice(), iban: null })).toContain('NL-R-007')
  })

  it('needs none of that on a credit note, which nobody pays', () => {
    expect(rulesFor({ ...referenceCreditNote(), iban: null })).toEqual([])
  })

  it('must reference the invoice a credit note corrects (NL-R-001)', () => {
    expect(rulesFor({ ...referenceCreditNote(), precedingInvoiceNumber: null })).toContain(
      'NL-R-001',
    )
  })
})

describe('what the buyer must have', () => {
  it('needs an address when they are Dutch too (NL-R-004)', () => {
    expect(
      rulesFor({
        ...referenceInvoice(),
        buyer: { ...referenceInvoice().buyer, street: null, city: null, postalCode: null },
      }),
    ).toContain('NL-R-004')
  })

  it('needs an electronic address, always (PEPPOL-EN16931-R010)', () => {
    expect(
      rulesFor({
        ...referenceInvoice(),
        buyer: { ...referenceInvoice().buyer, electronicAddress: null },
      }),
    ).toContain('PEPPOL-EN16931-R010')
  })

  it('is spared the Dutch rules when they are not Dutch', () => {
    // The Belgian buyer in this fixture has no KvK number and no Dutch address,
    // and that is correct: NL-R-004 and NL-R-005 are conditional on the buyer's
    // country, not the seller's.
    expect(rulesFor(reverseChargeInvoice())).toEqual([])
  })
})

describe('the reference a Peppol invoice cannot go without', () => {
  it('accepts a purchase order reference instead of a buyer reference', () => {
    expect(rulesFor({ ...referenceInvoice(), buyerReference: null })).toEqual([])
  })

  it('refuses when neither is present (PEPPOL-EN16931-R003)', () => {
    expect(
      rulesFor({ ...referenceInvoice(), buyerReference: null, orderReference: null }),
    ).toContain('PEPPOL-EN16931-R003')
  })
})

describe('VAT categories', () => {
  it('wants a rate above zero on a standard-rated line (BR-S-05)', () => {
    const invoice = referenceInvoice()
    expect(
      rulesFor({
        ...invoice,
        tax: 4_500n,
        total: 154_500n,
        lines: [{ ...invoice.lines[0]!, rateBasisPoints: 0, tax: 0n }, invoice.lines[1]!],
      }),
    ).toContain('BR-S-05')
  })

  it('wants the seller VAT number when anything is standard rated (BR-S-02)', () => {
    expect(
      rulesFor({
        ...referenceInvoice(),
        seller: { ...referenceInvoice().seller, vatNumber: null },
      }),
    ).toContain('BR-S-02')
  })

  it('wants the tax to be the taxable amount times the rate (BR-S-09)', () => {
    const invoice = referenceInvoice()
    expect(
      rulesFor({
        ...invoice,
        tax: 25_400n,
        total: 175_400n,
        lines: [{ ...invoice.lines[0]!, tax: 20_900n }, invoice.lines[1]!],
      }),
    ).toContain('BR-S-09')
  })

  it('wants a zero rate on a reverse-charge line (BR-AE-05)', () => {
    const source = reverseChargeInvoice()
    expect(
      rulesFor({
        ...source,
        lines: [{ ...source.lines[0]!, rateBasisPoints: 2100 }],
      }),
    ).toContain('BR-AE-05')
  })

  it('wants both parties identifiable for reverse charge (BR-AE-02)', () => {
    const source = reverseChargeInvoice()
    expect(
      rulesFor({
        ...source,
        buyer: { ...source.buyer, vatNumber: null, kvkNumber: null },
      }),
    ).toContain('BR-AE-02')
  })

  it('wants a country prefix on a VAT number (BR-CO-09)', () => {
    expect(
      rulesFor({
        ...referenceInvoice(),
        seller: { ...referenceInvoice().seller, vatNumber: '123456789B01' },
      }),
    ).toContain('BR-CO-09')
  })
})

describe('arithmetic', () => {
  it('catches a stored total that is not the sum of the lines (BR-CO-10)', () => {
    // The invariant that matters most here: the totals are read from the stored
    // invoice rather than recomputed, so a drift between the two shows up as a
    // rule violation instead of silently producing a document that validates.
    expect(rulesFor({ ...referenceInvoice(), net: 149_900n })).toContain('BR-CO-10')
  })

  it('catches a total with VAT that does not add up (BR-CO-15)', () => {
    expect(rulesFor({ ...referenceInvoice(), total: 175_400n })).toContain('BR-CO-15')
  })

  it('catches a line whose net is not quantity times price (PEPPOL-EN16931-R120)', () => {
    const invoice = referenceInvoice()
    expect(
      rulesFor({
        ...invoice,
        lines: [{ ...invoice.lines[0]!, quantity: '9' }, invoice.lines[1]!],
      }),
    ).toContain('PEPPOL-EN16931-R120')
  })

  it('reports every broken rule at once, not the first', () => {
    const rules = rulesFor({
      ...referenceInvoice(),
      number: '',
      buyerReference: null,
      orderReference: null,
      seller: {
        ...referenceInvoice().seller,
        street: null,
        city: null,
        postalCode: null,
        electronicAddress: null,
      },
    })
    expect(new Set(rules)).toEqual(
      new Set(['BR-02', 'BR-08', 'PEPPOL-EN16931-R020', 'PEPPOL-EN16931-R003', 'NL-R-002']),
    )
  })

  it('names a path a form can point at', () => {
    const violations = checkUblRules(
      toUblDocument({
        ...referenceInvoice(),
        seller: { ...referenceInvoice().seller, kvkNumber: null },
      }),
    )
    expect(violations.map((item) => item.path)).toContain('seller.registrationScheme')
  })
})
