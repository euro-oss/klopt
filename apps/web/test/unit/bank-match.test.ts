import { describe, expect, it } from 'vitest'
import {
  absoluteMinor,
  confidenceTone,
  formatEuro,
  ibanTail,
  isOutgoing,
  isPeriodLockViolation,
  periodLockForDate,
  periodLockFromViolation,
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
  it('names a fully closed quarter', () => {
    const lock = periodLockForDate(years, '2026-09-30', false)
    expect(lock).toMatchObject({
      status: 'hard_closed',
      kind: 'quarter',
      fiscalYear: '2026',
    })
  })

  it('keeps soft-closed open for accountants', () => {
    expect(periodLockForDate(years, '2026-10-15', true)).toBeNull()
    expect(periodLockForDate(years, '2026-10-15', false)).toMatchObject({
      status: 'soft_closed',
      kind: 'month',
    })
  })

  it('locks a closed year wholesale', () => {
    expect(periodLockForDate(years, '2025-06-01', true)).toMatchObject({
      status: 'year_closed',
      kind: 'year',
      fiscalYear: '2025',
    })
  })

  it('leaves open months alone', () => {
    expect(periodLockForDate(years, '2026-11-12', false)).toBeNull()
  })

  it('reads lock detail off a confirmMatch violation', () => {
    expect(isPeriodLockViolation('period_hard_closed')).toBe(true)
    expect(isPeriodLockViolation('period_soft_closed')).toBe(true)
    expect(isPeriodLockViolation('unbalanced')).toBe(false)
    expect(periodLockFromViolation({ fiscalYear: '2026', period: '9' })).toEqual({
      fiscalYear: '2026',
      period: 9,
    })
  })
})

describe('bank-match suggestion labels', () => {
  it('prefers invoice numbers, then account, then reason', () => {
    expect(
      suggestionLabel({
        allocations: [{ number: '2026-0131' }],
        accountNumber: '1300',
        reason: 'Zelfde bedrag',
      }),
    ).toBe('2026-0131')
    expect(
      suggestionLabel({
        allocations: [],
        accountNumber: '4400',
        reason: 'Zo boekte je Makro',
      }),
    ).toBe('4400')
    expect(
      suggestionLabel({
        allocations: [],
        accountNumber: null,
        reason: 'Zo boekte je Makro',
      }),
    ).toBe('Zo boekte je Makro')
  })
})
