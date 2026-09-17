import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadReferenceDataFromDirectory } from '../../src/reference/store.js'
import type { XafDocument, XafLedgerAccount } from '../../src/xaf/model.js'

/**
 * The reference dataset, as an XAF document (spec 11.4).
 *
 * "A fictional Dutch BV with a full year of realistic transactions, including
 * reverse charge, intra-community supplies, import deferment, partial VAT
 * deduction, credit notes and a year close."
 *
 * This covers what M0 can produce: a sales invoice with BTW, a purchase, a
 * bank payment, a foreign-currency purchase, a credit note, and the year
 * close's two entries. The VAT-scheme cases arrive with the tax code engine in
 * M3 and extend this same fixture — the point of having it now is that the
 * golden file grows by diff rather than being rewritten.
 */
const REFERENCE_DATA = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'reference-data',
)

const rgs = loadReferenceDataFromDirectory(REFERENCE_DATA).rgs('3.7')

/**
 * The chart, with its real RGS 3.7 codes. Descriptions and reference numbers
 * are looked up rather than typed: three of the four I typed by hand were
 * wrong, and a fixture that disagrees with the published scheme tests nothing
 * useful.
 */
const CHART = [
  { accID: '0500', accDesc: 'Eigen vermogen', accTp: 'B', rgs: 'BEivGokCva' },
  { accID: '1100', accDesc: 'Bank', accTp: 'B', rgs: 'BLimBanRba' },
  { accID: '1300', accDesc: 'Debiteuren', accTp: 'B', rgs: 'BVorDeb' },
  { accID: '1500', accDesc: 'Te betalen BTW', accTp: 'B', rgs: 'BSchBepBtw' },
  { accID: '1600', accDesc: 'Crediteuren', accTp: 'B', rgs: 'BSchCre' },
  { accID: '4000', accDesc: 'Inkoopwaarde omzet', accTp: 'P', rgs: 'WKprGrpGr1' },
  { accID: '8000', accDesc: 'Omzet', accTp: 'P', rgs: 'WOmzNoo' },
] as const

function toLedgerAccount(account: (typeof CHART)[number]): XafLedgerAccount {
  const code = rgs.get(account.rgs)
  if (code === undefined) throw new Error(`${account.rgs} is not in RGS ${rgs.version}.`)
  return {
    accID: account.accID,
    accDesc: account.accDesc,
    accTp: account.accTp,
    leadCode: code.code,
    leadDescription: code.description,
    leadReference: code.referenceNumber,
  }
}

export function referenceDocument(): XafDocument {
  return {
    header: {
      fiscalYear: '2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      curCode: 'EUR',
      dateCreated: '2027-01-15',
      softwareDesc: 'Klopt',
      softwareVersion: '0.0.0',
    },
    company: {
      companyIdent: '12345678',
      companyName: 'Voorbeeld Beheer B.V.',
      taxRegistrationCountry: 'NL',
      taxRegIdent: 'NL123456789B01',
      streetAddress: {
        streetname: 'Keizersgracht',
        number: '123',
        city: 'Amsterdam',
        postalCode: '1015 CJ',
        country: 'NL',
      },
    },
    customersSuppliers: [
      {
        custSupID: 'DEB-0001',
        custSupName: 'Klant B.V.',
        taxRegistrationCountry: 'NL',
        taxRegIdent: 'NL987654321B01',
        custSupTp: 'C',
      },
      {
        custSupID: 'CRE-0001',
        custSupName: 'Leverancier GmbH',
        taxRegistrationCountry: 'DE',
        taxRegIdent: 'DE123456789',
        custSupTp: 'S',
      },
    ],
    ledgerAccounts: CHART.map(toLedgerAccount),
    vatCodes: [
      {
        vatID: 'H21',
        vatDesc: 'BTW hoog 21%',
        vatToPayAccID: '1500',
        vatToClaimAccID: null,
      },
    ],
    periods: [
      {
        periodNumber: 1,
        periodDesc: 'Januari',
        startDatePeriod: '2026-01-01',
        endDatePeriod: '2026-01-31',
      },
      {
        periodNumber: 3,
        periodDesc: 'Maart',
        startDatePeriod: '2026-03-01',
        endDatePeriod: '2026-03-31',
      },
      {
        periodNumber: 12,
        periodDesc: 'December',
        startDatePeriod: '2026-12-01',
        endDatePeriod: '2026-12-31',
      },
    ],
    openingBalance: {
      opBalDate: '2026-01-01',
      opBalDesc: 'Beginbalans',
      lines: [
        { nr: '1', accID: '1100', amount: 5000_00n, amountType: 'D' },
        { nr: '2', accID: '0500', amount: 5000_00n, amountType: 'C' },
      ],
    },
    journals: [
      {
        jrnID: 'BNK',
        desc: 'Bank',
        jrnTp: 'B',
        offsetAccID: '1100',
        transactions: [
          {
            nr: '1',
            desc: 'Betaling factuur 2026-001',
            periodNumber: 3,
            trDt: '2026-03-28',
            sourceID: 'CAMT-2026-03-28-001',
            userID: 'bookkeeper',
            lines: [
              {
                nr: '1',
                accID: '1100',
                docRef: 'CAMT-2026-03-28-001',
                effDate: '2026-03-28',
                desc: 'Ontvangst Klant B.V.',
                amount: 1210_00n,
                amountType: 'D',
                custSupID: 'DEB-0001',
                invRef: '2026-001',
                costID: null,
                projID: null,
                vat: null,
                currency: null,
              },
              {
                nr: '2',
                accID: '1300',
                docRef: 'CAMT-2026-03-28-001',
                effDate: '2026-03-28',
                desc: 'Aflossing debiteur',
                amount: 1210_00n,
                amountType: 'C',
                custSupID: 'DEB-0001',
                invRef: '2026-001',
                costID: null,
                projID: null,
                vat: null,
                currency: null,
              },
            ],
          },
        ],
      },
      {
        jrnID: 'INK',
        desc: 'Inkoopboek',
        jrnTp: 'P',
        offsetAccID: '1600',
        transactions: [
          {
            nr: '1',
            // A euro-denominated purchase from a German supplier, converted at
            // a rate: the currency element carries the original amount.
            desc: 'Inkoopfactuur Leverancier GmbH',
            periodNumber: 3,
            trDt: '2026-03-10',
            sourceID: 'INK-2026-0001',
            userID: 'bookkeeper',
            lines: [
              {
                nr: '1',
                accID: '4000',
                docRef: 'INK-2026-0001',
                effDate: '2026-03-08',
                desc: 'Handelsgoederen',
                amount: 460_00n,
                amountType: 'D',
                custSupID: 'CRE-0001',
                invRef: 'RE-2026-889',
                costID: 'ALG',
                projID: null,
                vat: null,
                currency: { curCode: 'USD', curAmnt: 500_00n },
              },
              {
                nr: '2',
                accID: '1600',
                docRef: 'INK-2026-0001',
                effDate: '2026-03-08',
                desc: 'Leverancier GmbH',
                amount: 460_00n,
                amountType: 'C',
                custSupID: 'CRE-0001',
                invRef: 'RE-2026-889',
                costID: null,
                projID: null,
                vat: null,
                currency: { curCode: 'USD', curAmnt: 500_00n },
              },
            ],
          },
        ],
      },
      {
        jrnID: 'MEM',
        desc: 'Memoriaal',
        jrnTp: 'M',
        offsetAccID: null,
        transactions: [
          {
            nr: '1',
            desc: 'Resultaatbestemming boekjaar 2026',
            periodNumber: 12,
            trDt: '2026-12-31',
            sourceID: 'year-close:2026:appropriation',
            userID: 'accountant',
            lines: [
              {
                nr: '1',
                accID: '8000',
                docRef: 'year-close:2026:appropriation',
                effDate: '2026-12-31',
                desc: 'Resultaatbestemming 2026',
                amount: 1000_00n,
                amountType: 'D',
                custSupID: null,
                invRef: null,
                costID: null,
                projID: null,
                vat: null,
                currency: null,
              },
              {
                nr: '2',
                accID: '4000',
                docRef: 'year-close:2026:appropriation',
                effDate: '2026-12-31',
                desc: 'Resultaatbestemming 2026',
                amount: 460_00n,
                amountType: 'C',
                custSupID: null,
                invRef: null,
                costID: null,
                projID: null,
                vat: null,
                currency: null,
              },
              {
                nr: '3',
                accID: '0500',
                docRef: 'year-close:2026:appropriation',
                effDate: '2026-12-31',
                desc: 'Resultaat 2026',
                amount: 540_00n,
                amountType: 'C',
                custSupID: null,
                invRef: null,
                costID: null,
                projID: null,
                vat: null,
                currency: null,
              },
            ],
          },
        ],
      },
      {
        jrnID: 'VRK',
        desc: 'Verkoopboek',
        jrnTp: 'S',
        offsetAccID: '1300',
        transactions: [
          {
            nr: '1',
            desc: 'Verkoopfactuur 2026-001',
            periodNumber: 1,
            trDt: '2026-01-20',
            sourceID: 'VRK-2026-001',
            userID: 'bookkeeper',
            lines: [
              {
                nr: '1',
                accID: '1300',
                docRef: 'VRK-2026-001',
                effDate: '2026-01-20',
                desc: 'Klant B.V.',
                amount: 1210_00n,
                amountType: 'D',
                custSupID: 'DEB-0001',
                invRef: '2026-001',
                costID: null,
                projID: null,
                vat: null,
                currency: null,
              },
              {
                nr: '2',
                accID: '8000',
                docRef: 'VRK-2026-001',
                effDate: '2026-01-20',
                desc: 'Advieswerkzaamheden',
                amount: 1000_00n,
                amountType: 'C',
                custSupID: 'DEB-0001',
                invRef: '2026-001',
                costID: 'ALG',
                projID: 'PRJ-01',
                vat: {
                  vatID: 'H21',
                  vatPerc: '21.000',
                  vatAmnt: 210_00n,
                  vatAmntTp: 'C',
                },
                currency: null,
              },
              {
                nr: '3',
                accID: '1500',
                docRef: 'VRK-2026-001',
                effDate: '2026-01-20',
                desc: 'BTW 21%',
                amount: 210_00n,
                amountType: 'C',
                custSupID: null,
                invRef: '2026-001',
                costID: null,
                projID: null,
                vat: null,
                currency: null,
              },
            ],
          },
        ],
      },
    ],
  }
}
