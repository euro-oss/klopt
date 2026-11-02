import { describe, expect, it } from 'vitest'
import { batchFourEyesLine } from '../../src/lib/batch-four-eyes.js'
import { translate, translatePlural } from '../../src/i18n/locale.js'

describe('batchFourEyesLine', () => {
  it('shows the nameless form when there is no display name', () => {
    expect(
      batchFourEyesLine({
        done: true,
        who: null,
        notYet: 'Nog niet ingediend',
        withWho: 'Ingediend door someone@example.nl',
        withoutWho: 'Ingediend',
      }),
    ).toBe('Ingediend')

    expect(
      batchFourEyesLine({
        done: true,
        who: '   ',
        notYet: 'Not approved yet',
        withWho: 'Approved by …',
        withoutWho: 'Approved',
      }),
    ).toBe('Approved')
  })

  it('shows "door {who}" only when a name is present', () => {
    expect(
      batchFourEyesLine({
        done: true,
        who: 'eva@example.nl',
        notYet: 'Nog niet ingediend',
        withWho: 'Ingediend door eva@example.nl',
        withoutWho: 'Ingediend',
      }),
    ).toBe('Ingediend door eva@example.nl')
  })

  it('never uses the withWho template before the step is done', () => {
    expect(
      batchFourEyesLine({
        done: false,
        who: null,
        notYet: 'Nog niet goedgekeurd',
        withWho: 'Goedgekeurd door …',
        withoutWho: 'Goedgekeurd',
      }),
    ).toBe('Nog niet goedgekeurd')
  })
})

describe('batch.heading and supplierPaysDays plurals', () => {
  it('picks factuur / facturen and bill / bills for 1 and 2', () => {
    expect(translatePlural('nl', 'batch.heading', 1, { date: '10-02-2026', count: 1 })).toBe(
      'Batch van 10-02-2026 · 1 factuur',
    )
    expect(translatePlural('nl', 'batch.heading', 2, { date: '10-02-2026', count: 2 })).toBe(
      'Batch van 10-02-2026 · 2 facturen',
    )
    expect(translatePlural('en', 'batch.heading', 1, { date: '10-02-2026', count: 1 })).toBe(
      'Batch of 10-02-2026 · 1 bill',
    )
    expect(translatePlural('en', 'batch.heading', 2, { date: '10-02-2026', count: 2 })).toBe(
      'Batch of 10-02-2026 · 2 bills',
    )
  })

  it('picks dag / dagen and day / days for 1 and 2', () => {
    expect(translatePlural('nl', 'purchaseNew.supplierPaysDays', 1, { days: 1 })).toBe('1 dag')
    expect(translatePlural('nl', 'purchaseNew.supplierPaysDays', 2, { days: 2 })).toBe('2 dagen')
    expect(translatePlural('en', 'purchaseNew.supplierPaysDays', 1, { days: 1 })).toBe('1 day')
    expect(translatePlural('en', 'purchaseNew.supplierPaysDays', 2, { days: 2 })).toBe('2 days')
  })

  it('keeps nameless four-eyes catalogue keys free of door and ellipsis', () => {
    expect(translate('nl', 'batch.submitted')).toBe('Ingediend')
    expect(translate('nl', 'batch.approved')).toBe('Goedgekeurd')
    expect(translate('en', 'batch.submitted')).toBe('Submitted')
    expect(translate('en', 'batch.approved')).toBe('Approved')
    expect(translate('nl', 'batch.submitted')).not.toMatch(/door|…|\.\.\./)
    expect(translate('nl', 'batch.approved')).not.toMatch(/door|…|\.\.\./)
  })
})
