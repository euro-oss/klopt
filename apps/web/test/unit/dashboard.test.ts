import { describe, expect, it } from 'vitest'
import {
  ATTENTION_TONE,
  barHeightPercent,
  buildPeriodRows,
  calendarParts,
  capitalizeWord,
  chartPeriodsThroughToday,
  dayPartAt,
  greetingName,
  ibanTail,
  maxMonthAmount,
} from '../../src/lib/dashboard.js'
import { WORK_QUEUE_ORDER } from '../../src/lib/work-queue.js'

describe('dashboard greeting helpers', () => {
  it('takes the first name for the greeting, and never the email', () => {
    expect(greetingName('Hidde de Vries')).toBe('Hidde')
    expect(greetingName('  Ana  ')).toBe('Ana')
    expect(greetingName('')).toBeNull()
    expect(greetingName('   ')).toBeNull()
  })

  it('capitalises the weekday for the subline', () => {
    expect(capitalizeWord('maandag')).toBe('Maandag')
    expect(capitalizeWord('')).toBe('')
  })

  it('reads calendar parts from an ISO date', () => {
    const parts = calendarParts('2026-10-19')
    expect(parts).toEqual({ year: 2026, month: 10, day: 19, weekday: 1 })
  })

  it('splits the day the way Dutch greetings do', () => {
    expect(dayPartAt(8)).toBe('morning')
    expect(dayPartAt(12)).toBe('afternoon')
    expect(dayPartAt(19)).toBe('evening')
  })

  it('prints the last four of an IBAN', () => {
    expect(ibanTail('NL91 ABNA 0417 1643 00')).toBe('4300')
  })
})

describe('dashboard chart scale', () => {
  it('fills the tallest bar and keeps a short bar visible', () => {
    const max = maxMonthAmount([
      { month: 5, sequence: 5, income: '100000', expenses: '50000', partial: false },
      { month: 6, sequence: 6, income: '10000', expenses: '0', partial: true },
    ])
    expect(max).toBe(100000n)
    expect(barHeightPercent('100000', max)).toBe(100)
    expect(barHeightPercent('10000', max)).toBeGreaterThanOrEqual(2)
    expect(barHeightPercent('0', max)).toBe(0)
  })

  it('takes the six periods ending at today, not future boekjaar months', () => {
    const periods = Array.from({ length: 12 }, (_, index) => ({
      sequence: index + 1,
      startsOn: `2026-${String(index + 1).padStart(2, '0')}-01`,
    }))
    const window = chartPeriodsThroughToday(periods, '2026-10-19')
    expect(window.map((period) => period.sequence)).toEqual([5, 6, 7, 8, 9, 10])
  })
})

describe('dashboard period rows', () => {
  it('lists the open month, a closed quarter, and a closed prior year', () => {
    const rows = buildPeriodRows({
      today: '2026-10-18',
      activeCode: '2026',
      years: [
        {
          code: '2025',
          status: 'closed',
          periods: [],
        },
        {
          code: '2026',
          status: 'open',
          periods: [
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
              status: 'open',
            },
          ],
        },
      ],
    })

    expect(rows).toEqual([
      { id: 'month-10', kind: 'month', labelRef: '10', status: 'open' },
      { id: 'quarter-3', kind: 'quarter', labelRef: '3', status: 'closed' },
      { id: 'year-2025', kind: 'year', labelRef: '2025', status: 'closed' },
    ])
  })
})

describe('werklijst tones', () => {
  it('assigns a tone to every queue kind, and never uses yellow for severity', () => {
    for (const kind of WORK_QUEUE_ORDER) {
      expect(ATTENTION_TONE[kind]).toMatch(/^(error|attention|info|neutral)$/)
    }
    expect(ATTENTION_TONE['import.blocking']).toBe('error')
    expect(ATTENTION_TONE['sales.overdue']).toBe('attention')
    expect(ATTENTION_TONE['vat.filing']).toBe('info')
  })
})

describe('honest kerncijfers copy', () => {
  it('labels the overdue-only figure as te laat bij klanten, not as all receivables', async () => {
    const { nl } = await import('../../src/i18n/nl.js')
    const { en } = await import('../../src/i18n/en.js')
    expect(nl['dash.figure.receivables']).toBe('Te laat bij klanten')
    expect(en['dash.figure.receivables']).toBe('Overdue')
    expect(nl['dash.figure.receivablesEmpty']).toBe('Niets te laat')
    expect(en['dash.figure.receivablesEmpty']).toBe('Nothing overdue')
    expect(nl['dash.figure.receivables']).not.toMatch(/Nog te ontvangen|Te laat betaald/)
    expect(en['dash.figure.receivables']).not.toMatch(/Still to receive/)
    expect(nl['queue.empty']).toBe('Niets wacht op je')
    expect(nl['queue.emptyAction']).toBe('Nieuwe factuur')
    expect(nl['dash.figure.payablesHint_one']).toBe('{count} leverancier')
    expect(nl['dash.figure.payablesHint_other']).toBe('{count} leveranciers')
    expect(en['dash.figure.payablesHint_one']).toBe('{count} supplier')
    expect(en['dash.figure.payablesHint_other']).toBe('{count} suppliers')
    expect(nl['queue.salesDraft_one']).toBe('{count} concept om te versturen')
    expect(nl['queue.salesDraft_other']).toBe('{count} concepten om te versturen')
    expect(nl['queue.salesOverdueOne']).toMatch(/€\u00a0\{amount\}/)
    expect(en['queue.salesOverdueOne']).toMatch(/€\u00a0\{amount\}/)
    expect(nl['queue.vatFilingBodyRefund']).toMatch(/terug te krijgen/)
    expect(nl['invoice.postedAsLink']).not.toMatch(/journaalpost/)
    expect(nl['queue.purchaseBookBody']).not.toMatch(/journaalpost/)
    // Bank body must not invent a suggestion count.
    expect(nl['queue.bankUnmatchedBody']).not.toMatch(/\d/)
    expect(en['queue.bankUnmatchedBody']).not.toMatch(/\d/)
  })
})
