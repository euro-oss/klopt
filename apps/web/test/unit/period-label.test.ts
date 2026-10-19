import { describe, expect, it } from 'vitest'
import {
  capitalizePeriodLabel,
  periodLabel,
  sentencePeriodLabel,
  type PeriodLabelYear,
} from '../../src/lib/period-label.js'

const years: readonly PeriodLabelYear[] = [
  {
    code: '2026',
    startsOn: '2026-01-01',
    endsOn: '2026-12-31',
    status: 'open',
    periods: [
      {
        sequence: 3,
        startsOn: '2026-03-01',
        endsOn: '2026-03-31',
        status: 'soft_closed',
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
        status: 'hard_closed',
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

describe('periodLabel', () => {
  it('names a single closed month with its year', () => {
    expect(
      periodLabel(years, { fiscalYear: '2026', period: '10' }, 'nl-NL'),
    ).toBe('oktober 2026')
  })

  it('names a fully closed quarter as Qn year', () => {
    expect(periodLabel(years, { fiscalYear: '2026', period: '9' }, 'nl-NL')).toBe('Q3 2026')
  })

  it('names a closed fiscal year as boekjaar', () => {
    expect(periodLabel(years, { fiscalYear: '2025', period: '12' }, 'nl-NL')).toBe('boekjaar 2025')
  })

  it('falls back to a neutral sequence label when years are empty', () => {
    expect(periodLabel([], { fiscalYear: '2026', period: '9' }, 'nl-NL')).toBe(
      'Periode 9 van boekjaar 2026',
    )
    expect(periodLabel(undefined, { fiscalYear: '2026', period: '9' }, 'nl-NL')).toBe(
      'Periode 9 van boekjaar 2026',
    )
    expect(periodLabel(null, { year: '2026', period: '9' }, 'nl-NL')).toBe(
      'Periode 9 van boekjaar 2026',
    )
  })

  it('returns a safe generic when detail is missing', () => {
    expect(periodLabel(years, undefined)).toBe('deze periode')
    expect(periodLabel(years, null)).toBe('deze periode')
    expect(periodLabel(years, {})).toBe('deze periode')
    expect(periodLabel([], undefined)).toBe('deze periode')
  })

  it('never returns blank, a bare Q label, or a lone dash', () => {
    for (const label of [
      periodLabel(years, { fiscalYear: '2026', period: '10' }),
      periodLabel(years, { fiscalYear: '2026', period: '9' }),
      periodLabel(years, { fiscalYear: '2025', period: '1' }),
      periodLabel([], { fiscalYear: '2026', period: '9' }),
      periodLabel([], { fiscalYear: '2026' }),
      periodLabel([], { period: '9' }),
      periodLabel([], {}),
      periodLabel(undefined, undefined),
    ]) {
      expect(label.trim().length).toBeGreaterThan(0)
      expect(label).not.toBe('-')
      expect(label).not.toMatch(/^Q\d\s*$/)
      expect(label).not.toMatch(/\s-\s*$/)
    }
  })
})

describe('sentencePeriodLabel', () => {
  it('capitalises the start of the sentence', () => {
    expect(sentencePeriodLabel(years, { fiscalYear: '2025', period: '12' })).toBe('Boekjaar 2025')
    expect(sentencePeriodLabel([], { fiscalYear: '2026', period: '9' })).toBe(
      'Periode 9 van boekjaar 2026',
    )
    expect(sentencePeriodLabel(years, undefined)).toBe('Deze periode')
    expect(capitalizePeriodLabel('oktober 2026')).toBe('Oktober 2026')
  })
})
