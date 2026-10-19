import { describe, expect, it } from 'vitest'
import {
  ATTENTION_TONE,
  barHeightPercent,
  buildPeriodRows,
  dayPartAt,
  greetingName,
  ibanTail,
  maxMonthAmount,
} from '../../src/lib/dashboard.js'
import { WORK_QUEUE_ORDER } from '../../src/lib/work-queue.js'

describe('dashboard greeting helpers', () => {
  it('takes the first name for the greeting', () => {
    expect(greetingName('Hidde de Vries')).toBe('Hidde')
    expect(greetingName('  Ana  ')).toBe('Ana')
    expect(greetingName('', 'hidde@example.nl')).toBe('hidde')
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
  it('labels the overdue-only figure as verlopen, not as all receivables', async () => {
    const { nl } = await import('../../src/i18n/nl.js')
    const { en } = await import('../../src/i18n/en.js')
    expect(nl['dash.figure.receivables']).toBe('Verlopen facturen')
    expect(en['dash.figure.receivables']).toBe('Overdue invoices')
    expect(nl['dash.figure.receivables']).not.toMatch(/Nog te ontvangen/)
    expect(en['dash.figure.receivables']).not.toMatch(/Still to receive/)
    // Bank body must not invent a suggestion count.
    expect(nl['queue.bankUnmatchedBody']).not.toMatch(/\d/)
    expect(en['queue.bankUnmatchedBody']).not.toMatch(/\d/)
  })
})
