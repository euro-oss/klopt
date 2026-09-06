import type { UblInvoiceSource, UblPartySource } from '../../src/ubl/from-invoice.js'

/**
 * The reference invoice, in the shape the mapper takes.
 *
 * A Dutch seller and a Dutch buyer, because that is the case the NL-R rules
 * apply to and the case a self-hoster meets first. Two VAT rates, so the
 * breakdown has more than one row and the grouping is actually exercised.
 */

export const SELLER: UblPartySource = {
  legalName: 'De Tol Beheer B.V.',
  tradingName: 'Speelgoedwinkel De Tol',
  street: 'Keizersgracht',
  houseNumber: '123-B',
  postalCode: '1015 CJ',
  city: 'Amsterdam',
  countryCode: 'NL',
  vatNumber: 'NL123456789B01',
  kvkNumber: '12345678',
  electronicAddress: '12345678',
  electronicAddressScheme: '0106',
  contactName: 'Jan de Boer',
  phone: '+31 20 555 1234',
  email: 'facturen@detol.nl',
}

export const BUYER: UblPartySource = {
  legalName: 'Grote Klant N.V.',
  tradingName: null,
  street: 'Coolsingel',
  houseNumber: '42',
  postalCode: '3011 AD',
  city: 'Rotterdam',
  countryCode: 'NL',
  vatNumber: 'NL987654321B01',
  kvkNumber: '87654321',
  electronicAddress: '87654321',
  electronicAddressScheme: '0106',
  contactName: null,
  phone: null,
  email: 'inkoop@groteklant.nl',
}

export function referenceInvoice(): UblInvoiceSource {
  return {
    profile: 'peppol-bis-3',
    kind: 'invoice',
    number: 'VRK-2026-00001',
    issueDate: '2026-03-15',
    dueDate: '2026-04-14',
    currency: 'EUR',
    buyerReference: 'KOSTENPLAATS-42',
    orderReference: 'PO-9912',
    note: null,
    precedingInvoiceNumber: null,
    precedingInvoiceIssueDate: null,
    seller: SELLER,
    buyer: BUYER,
    iban: 'NL02ABNA0123456789',
    bic: 'ABNANL2A',
    net: 150_000n,
    tax: 25_500n,
    total: 175_500n,
    lines: [
      {
        lineNumber: 1,
        description: 'Advieswerk maart 2026',
        quantity: '10',
        unitCode: 'HUR',
        unitPrice: 10_000n,
        net: 100_000n,
        tax: 21_000n,
        ublCategory: 'S',
        rateBasisPoints: 2100,
        taxDescription: 'BTW hoog 21%',
      },
      {
        lineNumber: 2,
        description: 'Boeken',
        quantity: '5',
        unitCode: 'EA',
        unitPrice: 10_000n,
        net: 50_000n,
        tax: 4_500n,
        ublCategory: 'S',
        rateBasisPoints: 900,
        taxDescription: 'BTW laag 9%',
      },
    ],
  }
}

/** The same invoice, credited in full. */
export function referenceCreditNote(): UblInvoiceSource {
  return {
    ...referenceInvoice(),
    kind: 'credit_note',
    number: 'VRK-2026-00002',
    issueDate: '2026-03-20',
    dueDate: '2026-03-20',
    precedingInvoiceNumber: 'VRK-2026-00001',
    precedingInvoiceIssueDate: '2026-03-15',
  }
}

/** A reverse-charge invoice to a Belgian buyer: no VAT, and a reason required. */
export function reverseChargeInvoice(): UblInvoiceSource {
  return {
    ...referenceInvoice(),
    number: 'VRK-2026-00003',
    buyer: {
      ...BUYER,
      legalName: 'Grote Klant BVBA',
      street: 'Grote Markt',
      houseNumber: '1',
      postalCode: '2000',
      city: 'Antwerpen',
      countryCode: 'BE',
      vatNumber: 'BE0123456789',
      kvkNumber: null,
      electronicAddress: 'BE0123456789',
      electronicAddressScheme: '9925',
    },
    net: 100_000n,
    tax: 0n,
    total: 100_000n,
    lines: [
      {
        lineNumber: 1,
        description: 'Advieswerk maart 2026',
        quantity: '10',
        unitCode: 'HUR',
        unitPrice: 10_000n,
        net: 100_000n,
        tax: 0n,
        ublCategory: 'AE',
        rateBasisPoints: 0,
        taxDescription: 'BTW verlegd',
      },
    ],
  }
}
