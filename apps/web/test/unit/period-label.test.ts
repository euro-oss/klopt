import { describe, expect, it } from 'vitest'
import { planFiscalYear } from '@klopt/core'
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

/** July-start FY 2026 (periods Jul 2026 … Jun 2027), periods 7–9 = Jan–Mar 2027. */
function julyStartYears(
  periodStatuses: Record<number, string> = {
    7: 'hard_closed',
    8: 'hard_closed',
    9: 'hard_closed',
  },
): readonly PeriodLabelYear[] {
  const layout = planFiscalYear('2026', 7)
  return [
    {
      code: layout.code,
      startsOn: layout.startsOn,
      endsOn: layout.endsOn,
      status: 'open',
      periods: layout.periods.map((row) => ({
        ...row,
        status: periodStatuses[row.sequence] ?? 'open',
      })),
    },
  ]
}

describe('periodLabel', () => {
  it('names a single closed month with its year', () => {
    expect(periodLabel(years, { fiscalYear: '2026', period: '10' }, 'nl-NL')).toBe('oktober 2026')
  })

  it('names a fully closed quarter as Qn calendar year', () => {
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

  it('uses the calendar year of period start for a July-start fiscal year', () => {
    const july = julyStartYears()
    // July-start: periods 7–9 are Jan/Feb/Mar 2027. Labelling period 9 must
    // read Q1 2027 (calendar year of startsOn), not Q1 2026 from the FY code.
    expect(july[0]!.periods.find((row) => row.sequence === 7)?.startsOn).toBe('2027-01-01')
    expect(july[0]!.periods.find((row) => row.sequence === 9)?.startsOn).toBe('2027-03-01')
    expect(periodLabel(july, { fiscalYear: '2026', period: '9' }, 'nl-NL')).toBe('Q1 2027')
    expect(periodLabel(july, { fiscalYear: '2026', period: '9' }, 'en-GB')).toBe('Q1 2027')
  })

  it('names the month when a quarter mixes soft- and hard-closed', () => {
    const mixed: readonly PeriodLabelYear[] = [
      {
        ...years[0]!,
        periods: years[0]!.periods.map((row) => {
          if (row.sequence === 7) return { ...row, status: 'soft_closed' }
          if (row.sequence === 8) return { ...row, status: 'soft_closed' }
          if (row.sequence === 9) return { ...row, status: 'hard_closed' }
          return row
        }),
      },
      years[1]!,
    ]
    expect(periodLabel(mixed, { fiscalYear: '2026', period: '9' }, 'nl-NL')).toBe('september 2026')
    expect(periodLabel(mixed, { fiscalYear: '2026', period: '7' }, 'nl-NL')).toBe('juli 2026')
  })

  it('localises fallback words for English', () => {
    expect(periodLabel(years, { fiscalYear: '2025', period: '12' }, 'en-GB')).toBe(
      'fiscal year 2025',
    )
    expect(periodLabel([], { fiscalYear: '2026', period: '9' }, 'en-GB')).toBe(
      'Period 9 of fiscal year 2026',
    )
    expect(periodLabel([], { fiscalYear: '2026' }, 'en-GB')).toBe('fiscal year 2026')
    expect(periodLabel([], { period: '9' }, 'en-GB')).toBe('Period 9')
    expect(periodLabel(years, undefined, 'en-GB')).toBe('this period')
    expect(periodLabel(years, { fiscalYear: '2026', period: '10' }, 'en-GB')).toBe('October 2026')
  })

  it('names the month from violation startsOn when years are missing', () => {
    // Bookkeeper / API client whose GET /fiscal-years failed still gets a real
    // name from the posting refusal payload.
    expect(
      periodLabel(
        [],
        {
          fiscalYear: '2026',
          period: '10',
          startsOn: '2026-10-01',
          endsOn: '2026-10-31',
          yearStatus: 'open',
        },
        'nl-NL',
      ),
    ).toBe('oktober 2026')
    expect(
      periodLabel(
        null,
        {
          fiscalYear: '2026',
          period: '10',
          startsOn: '2026-10-01',
          endsOn: '2026-10-31',
          yearStatus: 'open',
        },
        'en-GB',
      ),
    ).toBe('October 2026')
  })

  it('names a closed year from yearStatus when years are missing', () => {
    expect(
      periodLabel(
        [],
        {
          fiscalYear: '2025',
          period: '12',
          startsOn: '2025-12-01',
          endsOn: '2025-12-31',
          yearStatus: 'closed',
        },
        'nl-NL',
      ),
    ).toBe('boekjaar 2025')
    expect(
      periodLabel(
        undefined,
        {
          fiscalYear: '2025',
          period: '12',
          startsOn: '2025-12-01',
          endsOn: '2025-12-31',
          yearStatus: 'closed',
        },
        'en-GB',
      ),
    ).toBe('fiscal year 2025')
  })

  it('uses the missing-detail path when detail has no year, period, or startsOn', () => {
    expect(periodLabel(years, undefined, 'nl-NL')).toBe('deze periode')
    expect(periodLabel([], null, 'nl-NL')).toBe('deze periode')
    expect(periodLabel(undefined, {}, 'en-GB')).toBe('this period')
    expect(periodLabel(null, { endsOn: '2026-10-31' }, 'nl-NL')).toBe('deze periode')
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

  it('capitalises English fiscal-year and this-period labels', () => {
    expect(sentencePeriodLabel(years, { fiscalYear: '2025', period: '12' }, 'en-GB')).toBe(
      'Fiscal year 2025',
    )
    expect(sentencePeriodLabel(years, undefined, 'en-GB')).toBe('This period')
    expect(sentencePeriodLabel([], { fiscalYear: '2026', period: '9' }, 'en-GB')).toBe(
      'Period 9 of fiscal year 2026',
    )
  })
})
