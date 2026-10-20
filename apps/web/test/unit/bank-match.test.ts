import { describe, expect, it } from 'vitest'
import { planFiscalYear } from '@klopt/core'
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
  MATCH_QUEUE_CAP,
  periodLockForDate,
  periodLockFromViolation,
  remainingLabel,
  suggestionBookedAmount,
  suggestionLabel,
  type FiscalYearWithPeriods,
} from '../../src/lib/bank-match.js'
import { periodLabel, sentencePeriodLabel } from '../../src/lib/period-label.js'

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

const yearName = (year: string) => `boekjaar ${year}`

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

describe('bank-match remaining label', () => {
  const exact = (count: number) => `${String(count)} regels nog te koppelen`
  const capped = '500+ regels nog te koppelen'

  it('shows the exact count at 499 and 500, and caps only above the page size', () => {
    expect(MATCH_QUEUE_CAP).toBe(500)
    expect(remainingLabel(499, capped, exact)).toBe('499 regels nog te koppelen')
    expect(remainingLabel(500, capped, exact)).toBe('500 regels nog te koppelen')
    expect(remainingLabel(501, capped, exact)).toBe('500+ regels nog te koppelen')
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
    expect(formatPeriodLabel(lock!, 'nl-NL', yearName, years)).toBe('Q3 2026')
    expect(formatBankDayWithYear('2026-09-30', 'nl-NL')).toMatch(/2026/)
  })

  it('returns soft-closed for everyone; booking gate is separate', () => {
    const lock = periodLockForDate(years, '2026-10-15')
    expect(lock).toMatchObject({ status: 'soft_closed', kind: 'month' })
    expect(isBookingBlocked(lock, true)).toBe(false)
    expect(isBookingBlocked(lock, false)).toBe(true)
  })

  it('names a closed year as boekjaar and capitalises sentence starts', () => {
    const lock = periodLockForDate(years, '2025-06-01')
    expect(lock?.kind).toBe('year')
    expect(formatPeriodLabel(lock!, 'nl-NL', yearName, years)).toBe('boekjaar 2025')
    expect(sentencePeriodLabel(years, { fiscalYear: '2025', period: '12' })).toBe('Boekjaar 2025')
    expect(formatPeriodLabel(lock!, 'en-GB', yearName, years)).toBe('fiscal year 2025')
    expect(sentencePeriodLabel(years, { fiscalYear: '2025', period: '12' }, 'en-GB')).toBe(
      'Fiscal year 2025',
    )
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
    expect(periodLabel(years, { fiscalYear: '2026', period: '9' })).toBe('Q3 2026')
  })

  it('uses the shared periodLabel when fiscal years are empty', () => {
    const lock = periodLockFromViolation([], 'period_hard_closed', {
      fiscalYear: '2026',
      period: '9',
    })
    expect(lock).toMatchObject({
      fiscalYear: '2026',
      period: 9,
      status: 'hard_closed',
      kind: 'sequence',
    })
    expect(formatPeriodLabel(lock, 'nl-NL', yearName, [])).toBe('periode 9 van boekjaar 2026')
    expect(periodLabel([], { fiscalYear: '2026', period: '9' })).toBe('periode 9 van boekjaar 2026')
    expect(formatPeriodLabel(lock, 'en-GB', yearName, [])).toBe('period 9 of fiscal year 2026')
  })

  it('names the month from violation startsOn when fiscal years are empty', () => {
    const lock = periodLockFromViolation([], 'period_hard_closed', {
      fiscalYear: '2026',
      period: '10',
      startsOn: '2026-10-01',
      endsOn: '2026-10-31',
      yearStatus: 'open',
    })
    expect(lock).toMatchObject({
      kind: 'month',
      startsOn: '2026-10-01',
      endsOn: '2026-10-31',
    })
    expect(formatPeriodLabel(lock, 'nl-NL', yearName, [])).toBe('oktober 2026')
    expect(
      periodLabel([], {
        fiscalYear: '2026',
        period: '10',
        startsOn: '2026-10-01',
        yearStatus: 'open',
      }),
    ).toBe('oktober 2026')
  })

  it('still returns a lock when violation detail is missing', () => {
    const lock = periodLockFromViolation(years, 'period_hard_closed', undefined)
    expect(lock.kind).toBe('sequence')
    expect(periodLabel(years, undefined)).toBe('deze periode')
    expect(sentencePeriodLabel(years, undefined)).toBe('Deze periode')
    expect(periodLabel(years, undefined, 'en-GB')).toBe('this period')
  })

  it('uses calendar year of period start for July-start FY quarters', () => {
    const layout = planFiscalYear('2026', 7)
    const julyYears: readonly FiscalYearWithPeriods[] = [
      {
        code: layout.code,
        startsOn: layout.startsOn,
        endsOn: layout.endsOn,
        status: 'open',
        periods: layout.periods.map((row) => ({
          ...row,
          status: row.sequence >= 7 && row.sequence <= 9 ? 'hard_closed' : 'open',
        })),
      },
    ]
    const lock = periodLockForDate(julyYears, '2027-03-15')
    expect(lock).toMatchObject({ kind: 'quarter', fiscalYear: '2026', period: 9 })
    expect(formatPeriodLabel(lock!, 'nl-NL', yearName, julyYears)).toBe('Q1 2027')
    expect(formatPeriodLabel(lock!, 'en-GB', yearName)).toBe('Q1 2027')
  })

  it('keeps month kind when a quarter mixes soft- and hard-closed', () => {
    const mixed: readonly FiscalYearWithPeriods[] = [
      {
        ...years[0]!,
        periods: years[0]!.periods.map((row) => {
          if (row.sequence === 7 || row.sequence === 8) return { ...row, status: 'soft_closed' }
          if (row.sequence === 9) return { ...row, status: 'hard_closed' }
          return row
        }),
      },
      years[1]!,
    ]
    const lock = periodLockForDate(mixed, '2026-09-15')
    expect(lock).toMatchObject({ kind: 'month', status: 'hard_closed' })
    expect(formatPeriodLabel(lock!, 'nl-NL', yearName, mixed)).toBe('september 2026')
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
