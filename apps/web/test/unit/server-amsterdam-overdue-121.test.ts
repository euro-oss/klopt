import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { overdueQuery } from '../../src/api/schemas.js'
import { debtorAgeing, type OverdueInvoice } from '../../src/lib/ageing.js'
import { todayInAmsterdam } from '../../src/lib/amsterdam-date.js'
import { planDunning, type DunnableInvoice } from '@klopt/core'

/** 2026-11-01 00:30 CET while UTC is still 2026-10-31 (#121). */
const CET_AFTER_MIDNIGHT = new Date('2026-10-31T23:30:00.000Z')

/** 2026-08-01 00:30 CEST while UTC is still 2026-07-31 (#121). */
const CEST_AFTER_MIDNIGHT = new Date('2026-07-31T22:30:00.000Z')

/** 2026-10-31 23:30 CET while UTC is 2026-10-31 22:30 — still the same Amsterdam day. */
const CET_LAST_HOUR = new Date('2026-10-31T22:30:00.000Z')

const dunnable = (dueDate: string): DunnableInvoice => ({
  invoiceId: 'inv-1',
  number: '2026-0001',
  kind: 'invoice',
  status: 'issued',
  dueDate,
  total: 100_00n,
  currency: 'EUR',
  contactName: 'Klant',
  contactEmail: 'klant@example.nl',
  remindersSent: [],
})

function daysOverdueFromDue(dueDate: string, asOf: string): number {
  const dayMs = 86_400_000
  return Math.floor(
    (new Date(`${asOf}T00:00:00Z`).getTime() - new Date(`${dueDate}T00:00:00Z`).getTime()) / dayMs,
  )
}

function overdueRows(asOf: string, dueDate: string): readonly OverdueInvoice[] {
  const daysOverdue = daysOverdueFromDue(dueDate, asOf)
  if (daysOverdue <= 0) return []
  return [
    {
      id: 'inv-1',
      number: '2026-0001',
      dueDate,
      total: '10000',
      contactName: 'Klant',
      daysOverdue,
    },
  ]
}

describe('Amsterdam midnight overdue boundaries (#121)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    delete process.env['KLOPT_E2E_TODAY_ISO']
    delete process.env['KLOPT_E2E_LEGAL_TOGGLE']
    process.env['NODE_ENV'] = 'test'
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
  })

  it('CET: invoice due 2026-10-31 is one day overdue just after local midnight', async () => {
    vi.setSystemTime(CET_AFTER_MIDNIGHT)
    vi.resetModules()
    const { localTodayIso: todayIso } = await import('../../src/lib/local-clock.js')
    expect(todayInAmsterdam()).toBe('2026-11-01')
    expect(todayIso()).toBe('2026-11-01')
    const asOf = overdueQuery.parse({}).asOf
    expect(asOf).toBe('2026-11-01')
    expect(daysOverdueFromDue('2026-10-31', asOf)).toBe(1)
    expect(planDunning([dunnable('2026-10-31')], asOf)).toHaveLength(0)
    expect(debtorAgeing(overdueRows(asOf, '2026-10-31')).totals.total).toBe('10000')
  })

  it('CEST: invoice due 2026-07-31 is one day overdue just after local midnight', () => {
    vi.setSystemTime(CEST_AFTER_MIDNIGHT)
    expect(todayInAmsterdam()).toBe('2026-08-01')
    const asOf = overdueQuery.parse({}).asOf
    expect(asOf).toBe('2026-08-01')
    expect(daysOverdueFromDue('2026-07-31', asOf)).toBe(1)
    expect(debtorAgeing(overdueRows(asOf, '2026-07-31')).rows).toHaveLength(1)
  })

  it('late on 31 October Amsterdam: due today is not overdue', () => {
    vi.setSystemTime(CET_LAST_HOUR)
    expect(todayInAmsterdam()).toBe('2026-10-31')
    const asOf = overdueQuery.parse({}).asOf
    expect(asOf).toBe('2026-10-31')
    expect(daysOverdueFromDue('2026-10-31', asOf)).toBe(0)
    expect(debtorAgeing(overdueRows(asOf, '2026-10-31')).rows).toHaveLength(0)
    expect(planDunning([dunnable('2026-10-31')], asOf)).toEqual([])
  })
})
