import { describe, expect, it } from 'vitest'
import {
  bookedCountFromReport,
  countNotInForceDocuments,
  importFailureKind,
  importProgressPercent,
  klaarFilingBlocked,
  klaarTransferCount,
  rebuildExcludedRates,
} from '../../src/lib/import-wizard-run.js'

describe('import wizard run helpers (#105 Legal/PM)', () => {
  it('treats failed with no report as zero booked', () => {
    expect(importFailureKind({ state: 'failed', report: null })).toBe('failed')
    expect(importFailureKind({ state: 'failed', report: { entriesPosted: 0 } })).toBe('failed')
  })

  it('treats failed with booked entries as failedPartial', () => {
    expect(
      importFailureKind({
        state: 'failed',
        report: { imported: true, entriesPosted: 3, invoicesImported: 2 },
      }),
    ).toBe('failedPartial')
    expect(bookedCountFromReport({ entriesPosted: 3, invoicesImported: 2 })).toBeGreaterThan(0)
  })

  it('takes Klaar summary counts from every booked document type', () => {
    // Prefer entriesPosted so journals/bank mutations match step 8 (Designer #105).
    expect(klaarTransferCount({ invoicesImported: 3, entriesPosted: 4 })).toBe(4)
    expect(klaarTransferCount({ entriesPosted: 4 })).toBe(4)
    expect(klaarTransferCount({ invoicesImported: 2, bankTransactionsCreated: 1 })).toBe(3)
    expect(klaarTransferCount(null)).toBe(0)
  })

  it('counts distinct not-in-force documents per year (not yearDocs × rates)', () => {
    const docs = [
      { year: 2025, externalId: 'sales_invoice:1' },
      { year: 2025, externalId: 'purchase_invoice:2' },
      { year: 2026, externalId: 'sales_invoice:3' },
    ]
    const withRefs = countNotInForceDocuments({
      year: '2025',
      usedRates: [
        { moneybirdId: 'r1', proposedCode: 'VGEEN' },
        { moneybirdId: 'r2', proposedCode: 'GEEN' },
      ],
      taxMappings: {},
      previousTaxMappings: {},
      taxCodeValidFromIso: new Map([
        ['VGEEN', '2026-01-01'],
        ['GEEN', '2026-01-01'],
      ]),
      docsForRate: (id) =>
        id === 'r1' ? ['sales_invoice:1'] : id === 'r2' ? ['purchase_invoice:2'] : [],
      yearDocuments: docs,
    })
    expect(withRefs.count).toBe(2)
    expect([...withRefs.codes].sort()).toEqual(['GEEN', 'VGEEN'])

    // Without per-rate refs, still de-dupe — never 2 rates × 2 docs = 4.
    const withoutRefs = countNotInForceDocuments({
      year: '2025',
      usedRates: [
        { moneybirdId: 'r1', proposedCode: 'VGEEN' },
        { moneybirdId: 'r2', proposedCode: 'GEEN' },
      ],
      taxMappings: {},
      previousTaxMappings: {},
      taxCodeValidFromIso: new Map([
        ['VGEEN', '2026-01-01'],
        ['GEEN', '2026-01-01'],
      ]),
      docsForRate: () => [],
      yearDocuments: docs,
    })
    expect(withoutRefs.count).toBe(2)
  })

  it('never reports 100% until done', () => {
    expect(importProgressPercent({ state: 'pending' }, true)).toBeLessThan(100)
    expect(importProgressPercent({ state: 'running' }, true)).toBeLessThan(100)
    expect(importProgressPercent({ state: 'done' }, true)).toBe(100)
    expect(importProgressPercent({ state: 'failed' }, true)).toBe(0)
  })

  it('shows deadline only for #95 self-assessed blocks', () => {
    expect(
      klaarFilingBlocked({
        problems: [],
        warnings: [{ code: 'self_assessed_vat_unsupported' }],
      }),
    ).toEqual({ blocked: true, showDeadline: true })
    expect(
      klaarFilingBlocked({
        problems: [],
        warnings: [{ code: 'moneybird_vat_without_tax_rate' }],
      }),
    ).toEqual({ blocked: true, showDeadline: false })
    expect(klaarFilingBlocked({ problems: [], warnings: [] })).toEqual({
      blocked: false,
      showDeadline: false,
    })
  })

  it('rebuilds excluded rates from persisted external ids', () => {
    const rebuilt = rebuildExcludedRates({
      excludedExternalIds: ['sales_invoice:1', 'sales_invoice:2', 'purchase_invoice:9'],
      rates: [{ moneybirdId: 'r1' }, { moneybirdId: 'r2' }],
      docsForRate: (id) =>
        id === 'r1' ? ['sales_invoice:1', 'sales_invoice:2'] : ['purchase_invoice:8'],
    })
    expect([...rebuilt.rateIds]).toEqual(['r1'])
    expect(rebuilt.byRate['r1']).toEqual(['sales_invoice:1', 'sales_invoice:2'])
  })
})
