import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolContext } from '../src/context.js'
import { listOpenItems, resolveListOpenItemsAsOf } from '../src/tools/open-items.js'

const NEW_YEAR_AMSTERDAM = new Date('2026-12-31T23:30:00.000Z')

const ENTITY = {
  id: '01a07c20-d6ab-7237-ae27-ae4def86811f',
  name: 'Voorbeeld BV',
  functionalCurrency: 'EUR',
}

describe('list_open_items asOf default (#121)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NEW_YEAR_AMSTERDAM)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolveListOpenItemsAsOf at Amsterdam New Year', () => {
    expect(resolveListOpenItemsAsOf(undefined)).toBe('2027-01-01')
  })

  function contextFor(captured: { asOf?: string }) {
    const api = {
      get: vi.fn((path: string, query?: Record<string, string>) => {
        if (path === '/entity') return Promise.resolve(ENTITY)
        Object.assign(captured, query)
        if (path === '/reports/overdue-invoices') {
          return Promise.resolve({ invoices: [] })
        }
        return Promise.resolve({
          buckets: [],
          total: '0',
          payableAccountNumber: '1600',
          reconciliation: { subledger: '0', controlAccount: '0', difference: '0' },
        })
      }),
    }
    return new ToolContext(api as never)
  }

  it('listOpenItems passes default asOf to the API', async () => {
    const captured: { asOf?: string } = {}
    await listOpenItems(contextFor(captured), { side: 'receivable' })
    expect(captured.asOf).toBe('2027-01-01')
  })

  it('listOpenItems honours an explicit asOf', async () => {
    const captured: { asOf?: string } = {}
    await listOpenItems(contextFor(captured), { asOf: '2026-05-01', side: 'receivable' })
    expect(captured.asOf).toBe('2026-05-01')
  })
})
