import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ATTENTION_TONE,
  bankFigureValueKind,
  calendarParts,
  capitalizeWord,
  dayPartAt,
  glanceBarPercent,
  greetingName,
  payablesFigureValueKind,
  profitFigureValueKind,
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
})

describe('werklijst tones', () => {
  it('assigns a tone to every queue kind, and never uses yellow for severity', () => {
    for (const kind of WORK_QUEUE_ORDER) {
      expect(ATTENTION_TONE[kind]).toMatch(/^(error|attention|info|neutral|brand)$/)
    }
    expect(ATTENTION_TONE['import.blocking']).toBe('error')
    expect(ATTENTION_TONE['sales.overdue']).toBe('error')
    expect(ATTENTION_TONE['bank.unmatched']).toBe('brand')
    expect(ATTENTION_TONE['vat.filing']).toBe('neutral')
  })
})

describe('figure tile value kinds (PM #112)', () => {
  it('bank: no account / no statement omit the value; failed read leaves it empty', () => {
    expect(bankFigureValueKind(null)).toBe('omit')
    expect(bankFigureValueKind({ status: 'unavailable' })).toBe('empty')
    expect(bankFigureValueKind({ status: 'ok', balance: null })).toBe('omit')
    expect(bankFigureValueKind({ status: 'ok', balance: '125000' })).toBe('amount')
  })

  it('payables: failed read is empty; a real zero is still an amount', () => {
    expect(payablesFigureValueKind(null)).toBe('empty')
    expect(payablesFigureValueKind('0')).toBe('amount')
    expect(payablesFigureValueKind('4200')).toBe('amount')
  })

  it('profit: failed read is empty; a real zero is still an amount', () => {
    expect(profitFigureValueKind(null)).toBe('empty')
    expect(profitFigureValueKind('0')).toBe('amount')
    expect(profitFigureValueKind('-1200')).toBe('amount')
  })
})

describe('honest kerncijfers copy', () => {
  it('labels the overdue-only figure as te laat bij klanten, not as all receivables', async () => {
    const { nl } = await import('../../src/i18n/nl.js')
    const { en } = await import('../../src/i18n/en.js')
    expect(nl['dash.figure.receivables']).toBe('Te laat bij klanten')
    expect(en['dash.figure.receivables']).toBe('Overdue from customers')
    expect(nl['dash.figure.receivablesEmpty']).toBe('Niets te laat')
    expect(en['dash.figure.receivablesEmpty']).toBe('Nothing overdue')
    expect(nl['dash.figure.receivables']).not.toMatch(/Nog te ontvangen|Te laat betaald/)
    expect(en['dash.figure.receivables']).not.toMatch(/Still to receive|Customers owe you/)
    expect(nl['queue.empty']).toBe('Niets te doen')
    expect(en['queue.empty']).toBe('Nothing waiting')
    expect(nl['queue.title']).toBe('Te doen')
    expect(en['queue.title']).toBe('To do')
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
    // No four-eyes promise until bill approval copy is confirmed (PM #107).
    expect(nl['queue.purchaseApproveBody']).not.toMatch(/tweede paar|vier ogen/i)
    expect(en['queue.purchaseApproveBody']).not.toMatch(/second pair|four.?eyes/i)
    // Bank body must not invent a suggestion count.
    expect(nl['queue.bankUnmatchedBody']).not.toMatch(/\d/)
    expect(en['queue.bankUnmatchedBody']).not.toMatch(/\d/)
    // No invented work-time estimate.
    expect(nl['dash.greetingSubCount_one']).not.toMatch(/minuut|minute/i)
    expect(en['dash.greetingSubCount_one']).not.toMatch(/minute/i)
  })

  it('keeps Legal #112 Unavailable / emptyBody / exportBody verbatim', async () => {
    const { nl } = await import('../../src/i18n/nl.js')
    const { en } = await import('../../src/i18n/en.js')
    expect(nl['dash.figure.payablesUnavailable']).toBe('Niet beschikbaar')
    expect(en['dash.figure.payablesUnavailable']).toBe('Not available')
    expect(nl['dash.figure.profitUnavailable']).toBe('Niet beschikbaar')
    expect(en['dash.figure.profitUnavailable']).toBe('Not available')
    expect(nl['dash.figure.bankUnavailable']).toBe('Niet beschikbaar')
    expect(en['dash.figure.bankUnavailable']).toBe('Not available')
    expect(nl['queue.emptyBody']).toBe('Voor dit boekjaar staat er nu niets voor je klaar.')
    expect(en['queue.emptyBody']).toBe('Nothing is waiting for you in this book year right now.')
    expect(nl['dash.exportBody']).toBe(
      'Kies een boekjaar en download het als XAF 3.2-auditfile, met RGS-codes waar je rekeningen gekoppeld zijn.',
    )
    expect(en['dash.exportBody']).toBe(
      'Pick a book year and download it as an XAF 3.2 audit file, with RGS codes where your accounts are mapped.',
    )
    expect(nl['dash.glance.ageTitle']).toBe('Hoe laat klanten betalen')
    expect(nl['ageing.bucket.over90']).toBe('Meer dan 90 dagen')
    expect(en['ageing.bucket.over90']).toBe('More than 90 days')
  })

  it('scales P&L glance bars against the larger of income and expenses', () => {
    expect(glanceBarPercent('100000', 100000n)).toBe(100)
    expect(glanceBarPercent('39000', 100000n)).toBe(39)
    expect(glanceBarPercent('0', 100000n)).toBe(0)
  })
})

describe('Home overdue parity with debtor-ageing (PM + Legal #112)', () => {
  it('does not filter overdue invoices by due-date withinFiscalYear', () => {
    const source = readFileSync(join(import.meta.dirname, '../../src/server/dashboard.ts'), 'utf8')
    expect(source).toContain('const overdueInvoices = overdue.body.invoices')
    expect(source).not.toMatch(
      /overdue\.body\.invoices\.filter\(\(invoice\) =>\s*withinFiscalYear\(scope, invoice\.dueDate\)/,
    )
    expect(source).toContain('debtorAgeing(overdueInvoices)')
    // Failed payables stay null — never coerce to '0'.
    expect(source).toContain('total: payables === null ? null : payables.body.total')
    expect(source).not.toContain("payables?.body.total ?? '0'")
  })

  it('Home passes fiscalYear on ageing Details and bucket links', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../../src/routes/_app/index.tsx'),
      'utf8',
    )
    expect(source).toContain('search={{ ...yearSearch, bucket }}')
    expect(source).toMatch(/AgeingGlance[\s\S]*yearCode/)
    expect(source).toContain("item.kind === 'sales.overdue' ? { fiscalYear: Number(fiscalYear) }")
    // Bonnetje → /inbox shows the real inbox shortcut, not n r.
    expect(source).toMatch(/to="\/inbox"[\s\S]*?<Keycap>g<\/Keycap>/)
    expect(source).not.toMatch(/to="\/inbox"[\s\S]*?<Keycap>n<\/Keycap>\s*<Keycap>r<\/Keycap>/)
    // No Kloppen de boeken block on Home.
    expect(source).not.toContain('dash.healthTitle')
  })
})
