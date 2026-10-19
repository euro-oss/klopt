import { describe, expect, it } from 'vitest'
import {
  absoluteMinor,
  confidenceTone,
  formatBankDayWithYear,
  formatEuro,
  formatPeriodLabel,
  ibanTail,
  isBookingBlocked,
  isOutgoing,
  isPeriodLockViolation,
  periodLockForDate,
  periodLockFromViolation,
  suggestionBookedAmount,
  suggestionLabel,
  type FiscalYearWithPeriods,
} from '../../src/lib/bank-match.js'

const years: readonly FiscalYearWithPeriods[] = [
  {
    code: '2026',
    startsOn: '2026-01-01',
    endsOn: '2026-12-31',
    status: 'open',
    periods: [
      {
        sequence: 1,
        startsOn: '2026-01-01',
        endsOn: '2026-01-31',
        status: 'open',
      },
      {
        sequence: 7,
        startsOn: '2026-07-01',
        endsOn: '2026-07-31',
        status: 'hard_closed',
      },
      {
        sequence: 8,
        startsOn: '2026-08-01',
        endsOn: '2026-08-31',
        status: 'hard_closed',
      },
      {
        sequence: 9,
        startsOn: '2026-09-01',
        endsOn: '2026-09-30',
        status: 'hard_closed',
      },
      {
        sequence: 10,
        startsOn: '2026-10-01',
        endsOn: '2026-10-31',
        status: 'soft_closed',
      },
      {
        sequence: 11,
        startsOn: '2026-11-01',
        endsOn: '2026-11-30',
        status: 'open',
      },
    ],
  },
  {
    code: '2025',
    startsOn: '2025-01-01',
    endsOn: '2025-12-31',
    status: 'closed',
    periods: [
      {
        sequence: 12,
        startsOn: '2025-12-01',
        endsOn: '2025-12-31',
        status: 'hard_closed',
      },
    ],
  },
]

describe('bank-match amounts', () => {
  it('treats negative minor units as Af (outgoing)', () => {
    expect(isOutgoing('-145200')).toBe(true)
    expect(isOutgoing('145200')).toBe(false)
    expect(absoluteMinor('-145200')).toBe(145200n)
  })

  it('formats euro with a non-breaking space after the symbol', () => {
    expect(formatEuro('145200')).toBe('€\u00a01.452,00')
    expect(formatEuro('-145200')).toBe('€\u00a01.452,00')
  })

  it('takes the IBAN tail for the subtitle', () => {
    expect(ibanTail('NL02ABNA0123456789')).toBe('6789')
    expect(ibanTail('4821')).toBe('4821')
  })
})

describe('bank-match confidence', () => {
  it('maps scores to plain-Dutch tones', () => {
    expect(confidenceTone(99)).toBe('certain')
    expect(confidenceTone(90)).toBe('certain')
    expect(confidenceTone(70)).toBe('likely')
    expect(confidenceTone(40)).toBe('possible')
  })
})

describe('bank-match period locks', () => {
  it('names a fully closed quarter as Q3', () => {
    const lock = periodLockForDate(years, '2026-09-30')
    expect(lock).toMatchObject({
      status: 'hard_closed',
      kind: 'quarter',
      fiscalYear: '2026',
    })
    expect(formatPeriodLabel(lock!, 'nl-NL', (year) => `boekjaar ${year}`)).toBe('Q3 2026')
    expect(formatBankDayWithYear('2026-09-30', 'nl-NL')).toMatch(/2026/)
  })

  it('returns soft-closed for everyone; booking gate is separate', () => {
    const lock = periodLockForDate(years, '2026-10-15')
    expect(lock).toMatchObject({ status: 'soft_closed', kind: 'month' })
    expect(isBookingBlocked(lock, true)).toBe(false)
    expect(isBookingBlocked(lock, false)).toBe(true)
  })

  it('names a closed year as boekjaar', () => {
    const lock = periodLockForDate(years, '2025-06-01')
    expect(lock?.kind).toBe('year')
    expect(formatPeriodLabel(lock!, 'nl-NL', (year) => `boekjaar ${year}`)).toBe('boekjaar 2025')
  })

  it('derives a lock from confirmMatch violation detail', () => {
    expect(isPeriodLockViolation('period_hard_closed')).toBe(true)
    expect(isPeriodLockViolation('period_soft_closed')).toBe(true)
    const lock = periodLockFromViolation(years, 'period_hard_closed', {
      fiscalYear: '2026',
      period: '9',
    })
    expect(lock).toMatchObject({
      fiscalYear: '2026',
      period: 9,
      status: 'hard_closed',
      kind: 'quarter',
    })
  })
})

describe('bank-match suggestion labels', () => {
  it('sums multi-invoice allocation amounts', () => {
    expect(
      suggestionBookedAmount(
        {
          allocations: [{ amount: '50000' }, { amount: '25000' }],
        },
        '100000',
      ),
    ).toBe('€\u00a0750,00')
  })

  it('prefers the account name in simple mode', () => {
    expect(
      suggestionLabel(
        { allocations: [], accountNumber: '4410', reason: 'geleerd' },
        { preferAccountName: true, accountName: 'Telecom' },
      ),
    ).toBe('Telecom')
    expect(
      suggestionLabel(
        { allocations: [], accountNumber: '4410', reason: 'geleerd' },
        { preferAccountName: false },
      ),
    ).toBe('4410')
  })
})
