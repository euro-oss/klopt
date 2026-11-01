import { describe, expect, it } from 'vitest'
import {
  canSubmitElectronically,
  collapseEmptyRubrieken,
  daysBetweenIso,
  formatVatHeaderDate,
  formatVatOpensDate,
  groupPeriodsByYear,
  manualFilingSummaryText,
  pickDefaultVatPeriod,
  vatPeriodShortLabel,
  vatPeriodStatus,
  type VatPeriodRow,
} from '../../src/lib/vat-screen.js'

function period(overrides: Partial<VatPeriodRow> & Pick<VatPeriodRow, 'code'>): VatPeriodRow {
  const code = overrides.code
  const [year = '2025', rest = 'Q1'] = code.split('-')
  const quarter = rest.startsWith('Q') ? Number(rest.slice(1)) : 1
  const fromMonth = String((quarter - 1) * 3 + 1).padStart(2, '0')
  const toMonth = String(quarter * 3).padStart(2, '0')
  const toDay = toMonth === '03' || toMonth === '12' ? '31' : '30'
  return {
    kind: 'quarterly',
    label: code,
    from: `${year}-${fromMonth}-01`,
    to: `${year}-${toMonth}-${toDay}`,
    deadline: `${year === '2025' && rest === 'Q4' ? '2026' : year}-${String((Number(toMonth) % 12) + 1).padStart(2, '0')}-31`,
    filed: false,
    sequence: 0,
    filedAt: null,
    payable: null,
    ...overrides,
  }
}

describe('vatPeriodStatus', () => {
  it('marks a filed period as marked (never "filed with the tax office")', () => {
    const status = vatPeriodStatus(period({ code: '2025-Q4', filed: true }), '2026-01-15')
    expect(status).toEqual({ kind: 'marked', tone: 'success', labelKey: 'vat.status.marked' })
  })

  it('says when a future period opens', () => {
    const status = vatPeriodStatus(
      period({ code: '2026-Q2', from: '2026-04-01', to: '2026-06-30', deadline: '2026-07-31' }),
      '2026-01-15',
    )
    expect(status.kind).toBe('opens')
    if (status.kind === 'opens') expect(status.opensOn).toBe('2026-04-01')
  })

  it('formats opens dates as short day+month like the Vat board sample', () => {
    expect(formatVatOpensDate('2026-01-01', 'en')).toBe('1 Jan')
    expect(formatVatOpensDate('2026-10-01', 'en')).toBe('1 Oct')
    expect(formatVatOpensDate('2026-01-01', 'nl')).toBe('1 jan')
    expect(formatVatOpensDate('2026-10-01', 'nl')).toBe('1 okt')
  })

  it('formats header dates as long day+month+year (31 January 2026)', () => {
    expect(formatVatHeaderDate('2026-01-31', 'en')).toBe('31 January 2026')
    expect(formatVatHeaderDate('2025-12-31', 'en')).toBe('31 December 2025')
    expect(formatVatHeaderDate('2026-01-31', 'nl')).toBe('31 januari 2026')
  })

  it('is late after the deadline', () => {
    const status = vatPeriodStatus(
      period({ code: '2025-Q3', from: '2025-07-01', to: '2025-09-30', deadline: '2025-10-31' }),
      '2025-11-02',
    )
    expect(status).toEqual({ kind: 'late', tone: 'danger', labelKey: 'vat.status.late' })
  })

  it('is ready to file after the period ends and before the deadline', () => {
    const status = vatPeriodStatus(
      period({ code: '2025-Q4', from: '2025-10-01', to: '2025-12-31', deadline: '2026-01-31' }),
      '2026-01-10',
    )
    expect(status).toEqual({ kind: 'ready', tone: 'draft', labelKey: 'vat.status.ready' })
  })

  it('is due tomorrow when one day remains', () => {
    const status = vatPeriodStatus(
      period({ code: '2025-Q4', from: '2025-10-01', to: '2025-12-31', deadline: '2026-01-31' }),
      '2026-01-30',
    )
    expect(status.kind).toBe('dueSoon')
    if (status.kind === 'dueSoon') expect(status.labelKey).toBe('vat.status.dueTomorrow')
  })
})

describe('pickDefaultVatPeriod', () => {
  const rows = [
    period({ code: '2026-Q1', from: '2026-01-01', to: '2026-03-31', deadline: '2026-04-30' }),
    period({ code: '2026-Q2', from: '2026-04-01', to: '2026-06-30', deadline: '2026-07-31' }),
    period({ code: '2026-Q3', from: '2026-07-01', to: '2026-09-30', deadline: '2026-10-31' }),
    period({ code: '2026-Q4', from: '2026-10-01', to: '2026-12-31', deadline: '2027-01-31' }),
  ]

  it('prefers the most recent ended unfiled period', () => {
    expect(pickDefaultVatPeriod(rows, '2026-08-15')).toBe('2026-Q2')
  })

  it('falls back to the period that contains today', () => {
    const allFiled = rows.map((row) => ({ ...row, filed: true }))
    expect(pickDefaultVatPeriod(allFiled, '2026-08-15')).toBe('2026-Q3')
  })

  it('returns null when there are no periods', () => {
    expect(pickDefaultVatPeriod([], '2026-01-01')).toBeNull()
  })
})

describe('collapseEmptyRubrieken', () => {
  const rows = [
    {
      id: '1a',
      label: 'Sales 21%',
      carries: 'both' as const,
      computed: false,
      base: '100',
      vat: '21',
    },
    { id: '1b', label: 'Sales 9%', carries: 'both' as const, computed: false, base: '0', vat: '0' },
    { id: '5a', label: 'Owed', carries: 'vat' as const, computed: true, base: '0', vat: '21' },
  ]

  it('hides empty non-computed boxes until shown', () => {
    const collapsed = collapseEmptyRubrieken(rows, false)
    expect(collapsed.emptyCount).toBe(1)
    expect(collapsed.visible.map((row) => row.id)).toEqual(['1a', '5a'])
  })

  it('shows every box when expanded', () => {
    expect(collapseEmptyRubrieken(rows, true).visible).toHaveLength(3)
  })
})

describe('vatPeriodShortLabel / group / download / electronic', () => {
  it('shortens quarterly and monthly codes', () => {
    expect(vatPeriodShortLabel('quarterly', '2025-Q4')).toBe('Q4')
    expect(vatPeriodShortLabel('monthly', '2025-03')).toBe('03')
    expect(vatPeriodShortLabel('annual', '2025')).toBe('2025')
  })

  it('groups years newest first with newest period first', () => {
    const groups = groupPeriodsByYear([
      period({ code: '2025-Q1' }),
      period({ code: '2026-Q1' }),
      period({ code: '2025-Q4' }),
    ])
    expect(groups.map((group) => group.year)).toEqual([2026, 2025])
    expect(groups[1]?.periods.map((row) => row.code)).toEqual(['2025-Q4', '2025-Q1'])
  })

  it('only treats Digipoort / SBR as electronic submit', () => {
    expect(
      canSubmitElectronically([
        { kind: 'manual', available: true },
        { kind: 'digipoort', available: false },
      ]),
    ).toBe(false)
    expect(canSubmitElectronically([{ kind: 'digipoort', available: true }])).toBe(true)
  })

  it('builds a plain-text summary without claiming submission', () => {
    const text = manualFilingSummaryText({
      periodLabel: 'Q4 2025',
      from: '2025-10-01',
      to: '2025-12-31',
      deadline: '2026-01-31',
      payable: '60731',
      rubrieken: [
        {
          id: '1a',
          label: 'Sales 21%',
          carries: 'both',
          computed: false,
          base: '385853',
          vat: '81029',
        },
      ],
    })
    expect(text).toContain('AANGIFTE OMZETBELASTING')
    expect(text).toContain('1a Sales 21%')
    expect(text).not.toMatch(/ingediend|filed with the tax office/i)
    expect(text).toContain('Zelf indienen')
  })

  it('counts whole days between ISO dates', () => {
    expect(daysBetweenIso('2026-01-30', '2026-01-31')).toBe(1)
  })
})
