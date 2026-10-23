import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildInvoiceEntry,
  buildPurchaseEntry,
  buildVatReturn,
  planMoneybirdImport,
  priceInvoice,
  type ExistingTaxRule,
  type JournalLineInput,
  type MoneybirdImportOptions,
  type TaxCodeRule,
  type TaxCodeSnapshot,
  type VatJournalLine,
} from '../../src/index.js'
import { loadChart } from '../../src/setup/chart.js'
import { snapshot } from './fixture.js'

/**
 * Moneybird import vs native booking — same rubrieken (#94).
 */

const NL_MKB = loadChart(
  JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        '..',
        'reference-data',
        'charts',
        'nl-mkb.json',
      ),
      'utf8',
    ),
  ),
)

const nlMkbTaxRules: readonly ExistingTaxRule[] = NL_MKB.taxCodes.map((code) => ({
  code: code.code,
  rateBasisPoints: code.rateBasisPoints,
  direction: code.direction,
  scope: code.scope,
  reverseCharge: code.reverseCharge,
  deductionCode: code.deductionCode,
  deductibility: code.deductibility,
}))

const RULES: readonly TaxCodeRule[] = NL_MKB.taxCodes.map((code) => ({
  code: code.code,
  description: code.description,
  rateBasisPoints: code.rateBasisPoints,
  validFrom: '2020-01-01',
  validTo: null,
  direction: code.direction,
  baseRubriek: code.baseRubriek,
  vatRubriek: code.vatRubriek,
  reverseCharge: code.reverseCharge,
  scope: code.scope,
  deductibility: code.deductibility,
  proRataBasisPoints: code.proRataBasisPoints,
  supplyKind: code.supplyKind,
  ublCategory: code.ublCategory,
  deductionCode: code.deductionCode,
}))

const CONTROL = ['1500', '1510']

const options = (): MoneybirdImportOptions => ({
  entityId: 'entity-1',
  currency: 'EUR',
  existingAccountNumbers: [],
  existingContactNumbers: [],
  existingTaxRules: nlMkbTaxRules,
  confirmedAccountMappings: {},
  confirmedTaxMappings: { '21': 'H21', '22': 'VH21', '29': 'L9' },
  existingExternalIds: [],
  lockedYears: [],
  entityFiscalYearStartMonth: 1,
})

function toVatLines(
  lines: readonly JournalLineInput[],
  opts: {
    readonly entryId: string
    readonly bookingDate: string
    readonly sourceDocumentRef: string
  },
): VatJournalLine[] {
  return lines.map((line, index) => ({
    entryId: opts.entryId,
    entryNumber: opts.entryId,
    journalCode: 'MEM',
    bookingDate: opts.bookingDate,
    lineNumber: index + 1,
    accountNumber: line.accountNumber,
    accountName: line.accountNumber,
    description: line.description ?? '',
    taxCode: line.taxCode,
    taxRole: line.taxRole,
    sourceDocumentRef: opts.sourceDocumentRef,
    signedMinorUnits: line.debit - line.credit,
  }))
}

function returnOf(lines: readonly VatJournalLine[]) {
  return buildVatReturn({
    periodFrom: '2026-01-01',
    periodTo: '2026-03-31',
    lines,
    rules: RULES,
    controlAccountNumbers: CONTROL,
  })
}

function taxAccountFor(code: string): string | null {
  if (
    code.endsWith('-VOOR') ||
    (code.startsWith('V') && !code.includes('ONTV') && code !== 'VERL')
  ) {
    return '1510'
  }
  return '1500'
}

function snapshotOf(code: string, rateBasisPoints: number): TaxCodeSnapshot {
  return {
    id: code.toLowerCase(),
    code,
    description: code,
    rateBasisPoints,
    isReverseCharge: false,
    ublCategory: 'S',
  }
}

describe('Moneybird import VAT return parity with native booking', () => {
  it('matches sale, purchase, credit notes and a mixed-rate sale', () => {
    const base = snapshot()
    const planned = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          ...base.taxRates,
          {
            id: '29',
            name: 'BTW laag 9%',
            percentage: 9,
            taxRateType: 'sales_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        salesInvoices: [
          base.salesInvoices[0]!,
          {
            ...base.salesInvoices[0]!,
            id: '302',
            invoiceId: '2026-002',
            totalTax: -2100n,
            totalExcl: -10000n,
            totalIncl: -12100n,
            originalSalesInvoiceId: '301',
            details: [
              {
                ...base.salesInvoices[0]!.details[0]!,
                id: 'cn-sale',
                price: -10000n,
                amount: '1',
                taxRateId: '21',
              },
            ],
          },
          {
            ...base.salesInvoices[0]!,
            id: '303',
            invoiceId: '2026-003',
            totalTax: 3000n,
            totalExcl: 20000n,
            totalIncl: 23000n,
            details: [
              {
                ...base.salesInvoices[0]!.details[0]!,
                id: 'mix-h',
                price: 10000n,
                amount: '1',
                taxRateId: '21',
              },
              {
                ...base.salesInvoices[0]!.details[0]!,
                id: 'mix-l',
                price: 10000n,
                amount: '1',
                taxRateId: '29',
              },
            ],
          },
        ],
        purchaseInvoices: [
          base.purchaseInvoices[0]!,
          {
            ...base.purchaseInvoices[0]!,
            id: '402',
            reference: 'LEV-CN',
            totalTax: -2100n,
            totalExcl: -10000n,
            totalIncl: -12100n,
            details: [
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'cn-buy',
                price: -10000n,
                amount: '1',
                taxRateId: '22',
              },
            ],
          },
        ],
      },
      options(),
    )

    expect(planned.problems).toEqual([])

    const moneybirdLines = planned.entries
      .filter((entry) => ['sales_invoice', 'credit_note', 'purchase_invoice'].includes(entry.kind))
      .flatMap((entry) =>
        toVatLines(entry.lines, {
          entryId: entry.externalId,
          bookingDate: entry.bookingDate,
          sourceDocumentRef: entry.sourceDocumentRef,
        }),
      )

    const taxes = new Map<string, TaxCodeSnapshot>([
      ['H21', snapshotOf('H21', 2100)],
      ['L9', snapshotOf('L9', 900)],
    ])

    const saleLines = [
      {
        description: 'Advies',
        quantity: '1',
        unitCode: 'C62',
        unitPrice: 10000n,
        revenueAccountNumber: '8000',
        taxCode: 'H21',
      },
    ]
    const nativeSale = buildInvoiceEntry(
      {
        entityId: 'entity-1',
        journalCode: 'VRK',
        bookingDate: '2026-03-01',
        documentDate: '2026-03-01',
        invoiceNumber: '2026-001',
        contactName: 'Klant BV',
        contactId: 'c1',
        contactNumber: '1001',
        receivableAccountNumber: '1300',
        currency: 'EUR',
        isCreditNote: false,
        reference: null,
      },
      priceInvoice(saleLines, taxes, 'per_invoice'),
      taxAccountFor,
    )

    const nativeCredit = buildInvoiceEntry(
      {
        entityId: 'entity-1',
        journalCode: 'VRK',
        bookingDate: '2026-03-01',
        documentDate: '2026-03-01',
        invoiceNumber: '2026-002',
        contactName: 'Klant BV',
        contactId: 'c1',
        contactNumber: '1001',
        receivableAccountNumber: '1300',
        currency: 'EUR',
        isCreditNote: true,
        reference: null,
      },
      priceInvoice(saleLines, taxes, 'per_invoice'),
      taxAccountFor,
    )

    const mixedLines = [
      {
        description: 'Hoog',
        quantity: '1',
        unitCode: 'C62',
        unitPrice: 10000n,
        revenueAccountNumber: '8000',
        taxCode: 'H21',
      },
      {
        description: 'Laag',
        quantity: '1',
        unitCode: 'C62',
        unitPrice: 10000n,
        revenueAccountNumber: '8000',
        taxCode: 'L9',
      },
    ]
    const nativeMixed = buildInvoiceEntry(
      {
        entityId: 'entity-1',
        journalCode: 'VRK',
        bookingDate: '2026-03-01',
        documentDate: '2026-03-01',
        invoiceNumber: '2026-003',
        contactName: 'Klant BV',
        contactId: 'c1',
        contactNumber: '1001',
        receivableAccountNumber: '1300',
        currency: 'EUR',
        isCreditNote: false,
        reference: null,
      },
      priceInvoice(mixedLines, taxes, 'per_invoice'),
      taxAccountFor,
    )

    const vh21 = RULES.find((rule) => rule.code === 'VH21')!
    const nativePurchase = buildPurchaseEntry(
      {
        entityId: 'entity-1',
        journalCode: 'INK',
        bookingDate: '2026-03-05',
        contactNumber: '2001',
        contactName: 'Leverancier BV',
        contactId: 'c2',
        payableAccountNumber: '1600',
        invoice: {
          supplierInvoiceNumber: 'LEV-88',
          kind: 'invoice',
          invoiceDate: '2026-03-05',
          dueDate: '2026-04-05',
          currency: 'EUR',
          netMinorUnits: 10000n,
          taxMinorUnits: 2100n,
          totalMinorUnits: 12100n,
          lines: [
            {
              description: 'Huur',
              accountNumber: '4000',
              taxCode: 'VH21',
              netMinorUnits: 10000n,
              taxMinorUnits: 2100n,
            },
          ],
        },
      },
      [vh21],
      taxAccountFor,
    )

    const nativePurchaseCredit = buildPurchaseEntry(
      {
        entityId: 'entity-1',
        journalCode: 'INK',
        bookingDate: '2026-03-05',
        contactNumber: '2001',
        contactName: 'Leverancier BV',
        contactId: 'c2',
        payableAccountNumber: '1600',
        invoice: {
          supplierInvoiceNumber: 'LEV-CN',
          kind: 'credit_note',
          invoiceDate: '2026-03-05',
          dueDate: '2026-04-05',
          currency: 'EUR',
          netMinorUnits: 10000n,
          taxMinorUnits: 2100n,
          totalMinorUnits: 12100n,
          lines: [
            {
              description: 'Credit',
              accountNumber: '4000',
              taxCode: 'VH21',
              netMinorUnits: 10000n,
              taxMinorUnits: 2100n,
            },
          ],
        },
      },
      [vh21],
      taxAccountFor,
    )

    const nativeLines = [
      ...toVatLines(nativeSale.lines, {
        entryId: 'native-sale',
        bookingDate: '2026-03-01',
        sourceDocumentRef: 'native:sale',
      }),
      ...toVatLines(nativeCredit.lines, {
        entryId: 'native-credit',
        bookingDate: '2026-03-01',
        sourceDocumentRef: 'native:credit',
      }),
      ...toVatLines(nativeMixed.lines, {
        entryId: 'native-mixed',
        bookingDate: '2026-03-01',
        sourceDocumentRef: 'native:mixed',
      }),
      ...toVatLines(nativePurchase.lines, {
        entryId: 'native-purchase',
        bookingDate: '2026-03-05',
        sourceDocumentRef: 'native:purchase',
      }),
      ...toVatLines(nativePurchaseCredit.lines, {
        entryId: 'native-purchase-credit',
        bookingDate: '2026-03-05',
        sourceDocumentRef: 'native:purchase-credit',
      }),
    ]

    const moneybirdReturn = returnOf(moneybirdLines)
    const nativeReturn = returnOf(nativeLines)

    expect(moneybirdReturn.blocked).toBe(false)
    expect(nativeReturn.blocked).toBe(false)
    expect(
      moneybirdReturn.findings.filter((finding) =>
        ['moneybird_untagged_vat', 'rate_mismatch', 'untagged_control_movement'].includes(
          finding.code,
        ),
      ),
    ).toEqual([])

    for (const id of ['1a', '1b', '5b'] as const) {
      const fromImport = moneybirdReturn.rubrieken.find((row) => row.rubriek.id === id)
      const fromNative = nativeReturn.rubrieken.find((row) => row.rubriek.id === id)
      expect(fromImport?.baseMinorUnits, id).toBe(fromNative?.baseMinorUnits)
      expect(fromImport?.vatMinorUnits, id).toBe(fromNative?.vatMinorUnits)
    }
    expect(moneybirdReturn.owedMinorUnits).toBe(nativeReturn.owedMinorUnits)
    expect(moneybirdReturn.deductibleMinorUnits).toBe(nativeReturn.deductibleMinorUnits)
    expect(moneybirdReturn.payableMinorUnits).toBe(nativeReturn.payableMinorUnits)
  })
})
