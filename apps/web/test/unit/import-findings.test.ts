import { describe, expect, it } from 'vitest'
import {
  honestySourcesFromExact,
  honestySourcesFromMoneybird,
  importProgressSteps,
} from '../../src/lib/import-findings.js'

describe('importProgressSteps', () => {
  it('starts on connect until linked', () => {
    expect(importProgressSteps({ connected: false, hasPreview: false, blockingCount: 0 })).toEqual([
      { id: 'connect', state: 'current' },
      { id: 'read', state: 'todo' },
      { id: 'review', state: 'todo' },
      { id: 'import', state: 'todo' },
    ])
  })

  it('keeps review current while blocking findings remain', () => {
    const steps = importProgressSteps({ connected: true, hasPreview: true, blockingCount: 2 })
    expect(steps.find((step) => step.id === 'review')?.state).toBe('current')
    expect(steps.find((step) => step.id === 'import')?.state).toBe('todo')
  })

  it('advances import when nothing blocks', () => {
    const steps = importProgressSteps({ connected: true, hasPreview: true, blockingCount: 0 })
    expect(steps.find((step) => step.id === 'import')?.state).toBe('current')
    expect(steps.find((step) => step.id === 'review')?.state).toBe('done')
  })
})

describe('honestySourcesFromMoneybird', () => {
  it('builds sales, purchases, year, and unread attachment cells', () => {
    const sources = honestySourcesFromMoneybird({
      counts: { salesInvoices: 412, purchaseInvoices: 200, documents: 68 },
      reconciliation: [{ year: 2024, source: 'empty', balanced: null }],
      unreadResource: { label: 'Bijlagen', detail: 'HTTP 403' },
      labels: {
        sales: 'Verkoopfacturen',
        purchases: 'Inkoop en bonnen',
        bookings: (year) => `Boekingen ${String(year)}`,
        readCount: (n) => `${String(n)} gelezen`,
        zeroRead: '0 gelezen',
      },
    })
    expect(sources).toHaveLength(4)
    expect(sources[0]?.honesty).toBe('reconciled')
    expect(sources[2]?.honesty).toBe('empty')
    expect(sources[3]?.honesty).toBe('unread')
    expect(sources[3]?.count).toBe('HTTP 403')
  })

  it('never paints an unreadable year as reconciled', () => {
    const sources = honestySourcesFromMoneybird({
      counts: {},
      reconciliation: [{ year: 2025, source: 'unreadable', balanced: true }],
      labels: {
        sales: 'S',
        purchases: 'P',
        bookings: (year) => String(year),
        readCount: (n) => String(n),
        zeroRead: '0',
      },
    })
    expect(sources.find((source) => source.id === 'year-2025')?.honesty).toBe('unread')
  })
})

describe('honestySourcesFromExact', () => {
  it('returns one cell when honesty is known', () => {
    expect(
      honestySourcesFromExact({
        honesty: 'reconciled',
        label: 'Openstaande posten',
        count: '12 / 4',
      }),
    ).toEqual([
      {
        id: 'exact-control',
        label: 'Openstaande posten',
        count: '12 / 4',
        honesty: 'reconciled',
      },
    ])
  })

  it('returns none when honesty is unknown', () => {
    expect(
      honestySourcesFromExact({ honesty: null, label: 'x', count: 'y' }),
    ).toEqual([])
  })
})
