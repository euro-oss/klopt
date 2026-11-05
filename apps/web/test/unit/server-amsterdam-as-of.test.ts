import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { overdueQuery } from '../../src/api/schemas.js'
import { todayInAmsterdam } from '../../src/lib/amsterdam-date.js'
import { supplierOpenSummary } from '../../src/lib/contacts-list.js'

/** 2026-11-06 00:30 Amsterdam (CET) while UTC is still 2026-11-05 (#121). */
const AMSTERDAM_MIDNIGHT_BOUNDARY = new Date('2026-11-05T23:30:00.000Z')

describe('server asOf defaults to Amsterdam today (#121)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(AMSTERDAM_MIDNIGHT_BOUNDARY)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('overdueQuery defaults asOf to Amsterdam, not UTC', () => {
    expect(AMSTERDAM_MIDNIGHT_BOUNDARY.toISOString().slice(0, 10)).toBe('2026-11-05')
    expect(todayInAmsterdam()).toBe('2026-11-06')
    expect(overdueQuery.parse({}).asOf).toBe('2026-11-06')
  })

  it('treats a purchase due 2026-11-05 as overdue when asOf defaults to Amsterdam today', () => {
    const asOf = overdueQuery.parse({}).asOf
    const summary = supplierOpenSummary(
      [
        {
          id: 'bill-1',
          contactNumber: 'LEV-1',
          total: '10000',
          outstanding: '10000',
          dueDate: '2026-11-05',
          status: 'booked',
        },
      ],
      asOf,
    )
    expect(summary.overdueCount).toBe(1)
  })

  it('matches handleListOverdueInvoices ageing when dueDate is 2026-11-05', () => {
    const asOf = overdueQuery.parse({}).asOf
    const asOfMs = new Date(`${asOf}T00:00:00Z`).getTime()
    const dueMs = new Date('2026-11-05T00:00:00Z').getTime()
    const daysOverdue = Math.floor((asOfMs - dueMs) / 86_400_000)
    expect(daysOverdue).toBe(1)
    expect(daysOverdue > 0).toBe(true)
  })
})
