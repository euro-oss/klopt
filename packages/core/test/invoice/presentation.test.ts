import { describe, expect, it } from 'vitest'
import { presentInvoice } from '../../src/invoice/presentation.js'
import { referenceCreditNote, referenceInvoice, reverseChargeInvoice } from '../ubl/fixture.js'

/**
 * The invoice as a human reads it.
 *
 * Built from the same source the XML is, which is the property worth
 * protecting: a document that says 1.755,00 to the customer and 1750.00 to
 * their software is worse than either one being wrong on its own. So the
 * assertions here are about **wording and agreement**, not layout — where the
 * box sits on the page is the renderer's business and nobody's test.
 */

describe('an ordinary invoice', () => {
  const presented = presentInvoice(referenceInvoice())

  it('is titled and numbered', () => {
    expect(presented.title).toBe('Factuur')
    expect(presented.number).toBe('VRK-2026-00001')
  })

  it('carries the amounts the ledger holds, formatted once', () => {
    expect(presented.totals).toEqual([
      { label: 'Subtotaal', amount: '1.500,00' },
      { label: 'Btw', amount: '255,00' },
      { label: 'Te betalen', amount: '1.755,00', emphasis: true },
    ])
  })

  it('breaks the VAT down by rate, as the XML does', () => {
    expect(presented.taxRows).toEqual([
      { label: 'Btw 21%', base: '1.000,00', amount: '210,00' },
      { label: 'Btw 9%', base: '500,00', amount: '45,00' },
    ])
  })

  it('shows the dates and both references', () => {
    expect(presented.meta).toEqual([
      { label: 'Factuurdatum', value: '15-03-2026' },
      { label: 'Vervaldatum', value: '14-04-2026' },
      { label: 'Uw referentie', value: 'KOSTENPLAATS-42' },
      { label: 'Inkoopnummer', value: 'PO-9912' },
    ])
  })

  it('asks for payment in words a payer can act on', () => {
    expect(presented.payment).toContain('1.755,00 EUR')
    expect(presented.payment).toContain('30 dagen')
    expect(presented.payment).toContain('NL02ABNA0123456789')
    // The remittance reference, without which the payment cannot be matched.
    expect(presented.payment).toContain('VRK-2026-00001')
  })

  it('prints the statutory name only when it differs from the trading name', () => {
    // The fixture trades as "Speelgoedwinkel De Tol" and is registered as
    // "De Tol Beheer B.V.", so both belong on the letterhead.
    expect(presented.seller.name).toBe('Speelgoedwinkel De Tol')
    expect(presented.seller.addressLines).toContain('De Tol Beheer B.V.')

    // The buyer has one name, and printing it twice looks like a mistake.
    expect(presented.buyer.name).toBe('Grote Klant N.V.')
    expect(presented.buyer.addressLines).not.toContain('Grote Klant N.V.')
  })

  it('shows the identifiers a Dutch invoice must carry', () => {
    expect(presented.seller.identifiers).toEqual(['Btw-nr. NL123456789B01', 'KvK 12345678'])
  })

  it('leaves out a country line for a Dutch address, and keeps it otherwise', () => {
    expect(presented.buyer.addressLines).not.toContain('NL')
    const foreign = presentInvoice(reverseChargeInvoice())
    expect(foreign.buyer.addressLines).toContain('BE')
  })

  it('says nothing about VAT grounds when VAT was charged', () => {
    expect(presented.notices).toEqual([])
  })
})

describe('a credit note', () => {
  const presented = presentInvoice(referenceCreditNote())

  it('is titled as one and asks for nothing to be paid', () => {
    expect(presented.title).toBe('Creditnota')
    expect(presented.payment).toBeNull()
    expect(presented.totals.at(-1)?.label).toBe('Te crediteren')
  })

  it('has no due date, because there is nothing to pay by', () => {
    expect(presented.meta.map((item) => item.label)).not.toContain('Vervaldatum')
  })

  it('names the invoice it corrects, with its date', () => {
    expect(presented.meta).toContainEqual({
      label: 'Betreft factuur',
      value: 'VRK-2026-00001 van 15-03-2026',
    })
  })
})

describe('when no VAT is charged', () => {
  it('states the grounds, which Wet OB art. 35a requires', () => {
    const presented = presentInvoice(reverseChargeInvoice())
    expect(presented.notices).toEqual(['Btw verlegd.'])
  })

  it('takes an exemption reason from the tax code, which is the only thing that knows', () => {
    const source = reverseChargeInvoice()
    const presented = presentInvoice({
      ...source,
      lines: [
        {
          ...source.lines[0]!,
          ublCategory: 'E',
          taxDescription: 'medische vrijstelling art. 11-1-g',
        },
      ],
    })

    expect(presented.notices).toEqual(['Vrijgesteld van btw: medische vrijstelling art. 11-1-g.'])
  })

  it('says so for an intra-community supply', () => {
    const source = reverseChargeInvoice()
    const presented = presentInvoice({
      ...source,
      lines: [{ ...source.lines[0]!, ublCategory: 'K' }],
    })
    expect(presented.notices[0]).toContain('Intracommunautaire levering')
  })
})
