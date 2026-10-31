import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { translate, translatePlural } from '../../src/i18n/locale.js'
import type { MessageKey } from '../../src/i18n/nl.js'
import {
  ATTENTION_TONE,
  bankFigureValueKind,
  calendarParts,
  capitalizeWord,
  dayPartAt,
  glanceBarPercent,
  greetingName,
  homeQueueOverdueManyBody,
  homeQueueOverdueOneBody,
  homeQueueVatBody,
  homeQueueVatDeadlineIso,
  payablesFigureValueKind,
  profitFigureValueKind,
  showHomeHeaderNewInvoice,
} from '../../src/lib/dashboard.js'
import { WORK_QUEUE_ORDER } from '../../src/lib/work-queue.js'

const t = ((key: string, vars?: Record<string, string>): string => {
  if (vars === undefined) return key
  return `${key}:${Object.entries(vars)
    .map(([name, value]) => `${name}=${value}`)
    .join(',')}`
}) as (key: MessageKey, vars?: Record<string, string>) => string

const plural = ((key: string, count: number, values?: Record<string, string | number>): string => {
  const suffix = count === 1 ? '_one' : '_other'
  const resolved = `${key}${suffix}`
  if (values === undefined) return resolved
  return `${resolved}:${Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join(',')}`
}) as (key: string, count: number, values?: Record<string, string | number>) => string

describe('dashboard greeting helpers', () => {
  it('takes the first name for the greeting, and never the email', () => {
    expect(greetingName('Sanne Voorbeeld')).toBe('Sanne')
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
    expect(nl['dash.glance.ageTitle']).toBe('Te late facturen per aantal dagen')
    expect(en['dash.glance.ageTitle']).toBe('Overdue invoices by days late')
    expect(nl['ageing.bucket.over90']).toBe('Meer dan 90 dagen')
    expect(en['ageing.bucket.over90']).toBe('More than 90 days')
    expect(nl['queue.salesOverdueOneBody_one']).toBe('Factuur {number} · {days} dag te laat')
    expect(nl['queue.salesOverdueOneBody_other']).toBe('Factuur {number} · {days} dagen te laat')
    expect(en['queue.salesOverdueOneBody_one']).toBe('Invoice {number} · {days} day late')
    expect(en['queue.salesOverdueOneBody_other']).toBe('Invoice {number} · {days} days late')
    expect(nl['queue.salesOverdueOneBodyDays_one']).toBe('{days} dag te laat')
    expect(nl['queue.salesOverdueOneBodyDays_other']).toBe('{days} dagen te laat')
    expect(en['queue.salesOverdueOneBodyDays_one']).toBe('{days} day late')
    expect(en['queue.salesOverdueOneBodyDays_other']).toBe('{days} days late')
    // Multi-overdue title + oldest qualifier (Legal #117).
    expect(nl['queue.salesOverdue_one']).toBe('{count} factuur te laat')
    expect(nl['queue.salesOverdue_other']).toBe('{count} facturen te laat')
    expect(en['queue.salesOverdue_one']).toBe('{count} invoice overdue')
    expect(en['queue.salesOverdue_other']).toBe('{count} invoices overdue')
    expect(nl['queue.salesOverdueOldestBody_one']).toBe('Oudste: {days} dag te laat')
    expect(nl['queue.salesOverdueOldestBody_other']).toBe('Oudste: {days} dagen te laat')
    expect(en['queue.salesOverdueOldestBody_one']).toBe('Oldest: {days} day late')
    expect(en['queue.salesOverdueOldestBody_other']).toBe('Oldest: {days} days late')
  })

  it('scales P&L glance bars against the larger of income and expenses', () => {
    expect(glanceBarPercent('100000', 100000n)).toBe(100)
    expect(glanceBarPercent('39000', 100000n)).toBe(39)
    expect(glanceBarPercent('0', 100000n)).toBe(0)
  })
})

describe('Home queue body missing fields (PM #112)', () => {
  it('drops the invoice-number clause when the number is missing', () => {
    expect(homeQueueOverdueOneBody({ contactName: 'Acme', daysOverdue: 12 }, t, plural)).toBe(
      'queue.salesOverdueOneBodyDays_other:days=12',
    )
  })

  it('drops the days clause when days overdue is missing', () => {
    expect(
      homeQueueOverdueOneBody({ contactName: 'Acme', invoiceNumber: '2026-001' }, t, plural),
    ).toBe('queue.salesOverdueOneBodyNumber:number=2026-001')
  })

  it('falls back to the generic overdue body when both clauses are missing', () => {
    expect(homeQueueOverdueOneBody({ contactName: 'Acme' }, t, plural)).toBe(
      'queue.salesOverdueBody',
    )
  })

  it('drops the days clause when days overdue is zero (never show a 0)', () => {
    expect(
      homeQueueOverdueOneBody(
        { contactName: 'Acme', invoiceNumber: '2026-001', daysOverdue: 0 },
        t,
        plural,
      ),
    ).toBe('queue.salesOverdueOneBodyNumber:number=2026-001')
    expect(homeQueueOverdueOneBody({ contactName: 'Acme', daysOverdue: 0 }, t, plural)).toBe(
      'queue.salesOverdueBody',
    )
  })

  it('keeps both clauses when number and days are present', () => {
    expect(
      homeQueueOverdueOneBody(
        { contactName: 'Acme', invoiceNumber: '2026-001', daysOverdue: 12 },
        t,
        plural,
      ),
    ).toBe('queue.salesOverdueOneBody_other:number=2026-001,days=12')
  })

  it('uses the singular day form for one day overdue in NL and EN (Legal #112)', () => {
    const detail = { contactName: 'Acme', invoiceNumber: '2026-001', daysOverdue: 1 }
    const nlT = (key: MessageKey, values?: Record<string, string>) => translate('nl', key, values)
    const nlPlural = (key: string, count: number, values?: Record<string, string | number>) =>
      translatePlural('nl', key, count, values)
    const enT = (key: MessageKey, values?: Record<string, string>) => translate('en', key, values)
    const enPlural = (key: string, count: number, values?: Record<string, string | number>) =>
      translatePlural('en', key, count, values)

    expect(homeQueueOverdueOneBody(detail, nlT, nlPlural)).toBe('Factuur 2026-001 · 1 dag te laat')
    expect(homeQueueOverdueOneBody(detail, enT, enPlural)).toBe('Invoice 2026-001 · 1 day late')
    expect(homeQueueOverdueOneBody({ contactName: 'Acme', daysOverdue: 1 }, nlT, nlPlural)).toBe(
      '1 dag te laat',
    )
    expect(homeQueueOverdueOneBody({ contactName: 'Acme', daysOverdue: 1 }, enT, enPlural)).toBe(
      '1 day late',
    )
  })

  it('drops the VAT deadline clause when the deadline is missing', () => {
    expect(homeQueueVatDeadlineIso({ vatPeriod: '2026-Q3' })).toBeNull()
    expect(homeQueueVatBody({ vatPeriod: '2026-Q3' }, null, t)).toBe('')
  })

  it('never substitutes a dash or zero for a missing VAT deadline', () => {
    const body = homeQueueVatBody({ vatPeriod: '2026-Q3', vatPayable: '10000' }, null, t)
    expect(body).toBe('')
    expect(body).not.toMatch(/—/)
    expect(body).not.toMatch(/\b0\b/)
  })

  it('never puts a dash into overdue body when a field is missing', () => {
    for (const detail of [
      { contactName: 'Acme' },
      { contactName: 'Acme', invoiceNumber: '2026-001' },
      { contactName: 'Acme', daysOverdue: 12 },
      { contactName: 'Acme', invoiceNumber: '', daysOverdue: 0 },
    ] as const) {
      const body = homeQueueOverdueOneBody(detail, t, plural)
      expect(body).not.toMatch(/—/)
      expect(body).not.toMatch(/:days=0\b/)
    }
  })

  it('keeps the single-invoice overdue body (number · days) for count 1', () => {
    const nlT = (key: MessageKey, values?: Record<string, string>) => translate('nl', key, values)
    const nlPlural = (key: string, count: number, values?: Record<string, string | number>) =>
      translatePlural('nl', key, count, values)
    const enT = (key: MessageKey, values?: Record<string, string>) => translate('en', key, values)
    const enPlural = (key: string, count: number, values?: Record<string, string | number>) =>
      translatePlural('en', key, count, values)
    const detail = { contactName: 'Acme', invoiceNumber: '2026-001', daysOverdue: 12 }
    expect(homeQueueOverdueOneBody(detail, nlT, nlPlural)).toBe(
      'Factuur 2026-001 · 12 dagen te laat',
    )
    expect(homeQueueOverdueOneBody(detail, enT, enPlural)).toBe('Invoice 2026-001 · 12 days late')
  })

  it('multi-overdue body qualifies the oldest days-late (Legal #117)', () => {
    const nlPlural = (key: string, count: number, values?: Record<string, string | number>) =>
      translatePlural('nl', key, count, values)
    const enPlural = (key: string, count: number, values?: Record<string, string | number>) =>
      translatePlural('en', key, count, values)

    expect(homeQueueOverdueManyBody({ contactName: 'Acme', daysOverdue: 1 }, nlPlural)).toBe(
      'Oudste: 1 dag te laat',
    )
    expect(homeQueueOverdueManyBody({ contactName: 'Acme', daysOverdue: 1 }, enPlural)).toBe(
      'Oldest: 1 day late',
    )
    expect(homeQueueOverdueManyBody({ contactName: 'Acme', daysOverdue: 120 }, nlPlural)).toBe(
      'Oudste: 120 dagen te laat',
    )
    expect(homeQueueOverdueManyBody({ contactName: 'Acme', daysOverdue: 120 }, enPlural)).toBe(
      'Oldest: 120 days late',
    )
    expect(homeQueueOverdueManyBody({ contactName: 'Acme', daysOverdue: 0 }, plural)).toBe('')
    expect(homeQueueOverdueManyBody(undefined, plural)).toBe('')
    expect(homeQueueOverdueManyBody({ contactName: 'Acme' }, plural)).toBe('')
  })
})

describe('Home header Nieuwe factuur visibility (PM #117)', () => {
  it('hides the header CTA only when the dashboard loaded and the queue is empty', () => {
    expect(showHomeHeaderNewInvoice(true, 0)).toBe(false)
  })

  it('shows the header CTA when the queue has work', () => {
    expect(showHomeHeaderNewInvoice(true, 1)).toBe(true)
    expect(showHomeHeaderNewInvoice(true, 4)).toBe(true)
  })

  it('shows the header CTA when the dashboard read failed (count looks like 0)', () => {
    expect(showHomeHeaderNewInvoice(false, 0)).toBe(true)
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
    // Bonnetje → /inbox with no shortcut chip; keymap unchanged.
    const inboxLinks = source.match(/to="\/inbox"[\s\S]*?<\/Link>/g) ?? []
    expect(inboxLinks.length).toBeGreaterThanOrEqual(1)
    for (const link of inboxLinks) {
      expect(link).not.toContain('Keycap')
    }
    expect(source).not.toContain('dash.healthTitle')
    expect(source).not.toContain('dash.unmapped')
    expect(source).toContain('bg-ageing-up-to-30')
    expect(source).toContain('RiFileTextLine')
    expect(source).toContain('RiInbox2Line')
    // Empty queue: card surface + header CTA gated via showHomeHeaderNewInvoice.
    expect(source).toContain('bg-card rounded-[var(--radius-xl)] border')
    expect(source).toContain('showHomeHeaderNewInvoice(dashboard.ok, todoCount)')
    expect(source).toContain('headerNewInvoice &&')
    expect(source).toContain('homeQueueOverdueManyBody')
  })
})
