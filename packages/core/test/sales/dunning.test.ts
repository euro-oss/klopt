import { describe, expect, it } from 'vitest'
import { LedgerError } from '../../src/errors.js'
import {
  DEFAULT_DUNNING_SCHEDULE,
  planDunning,
  stageOf,
  type DunnableInvoice,
} from '../../src/sales/dunning.js'

/**
 * Chasing an unpaid invoice.
 *
 * The rules worth protecting, in order of how badly they go wrong:
 *
 *  - **One reminder per stage, ever.** A retry after a bounce, or a job that
 *    runs twice, must not chase twice. A customer who gets the same demand
 *    three times stops reading them.
 *  - **One action per invoice per run.** An invoice forgotten for two months
 *    has three stages overdue; sending all three at once is not chasing.
 *  - **A credit note is never chased.** That is money owed the other way.
 */

const invoice = (overrides: Partial<DunnableInvoice> = {}): DunnableInvoice => ({
  invoiceId: 'i1',
  number: '2026-0001',
  kind: 'invoice',
  status: 'issued',
  dueDate: '2026-03-01',
  total: 121_000n,
  currency: 'EUR',
  contactName: 'Grote Klant N.V.',
  contactEmail: 'inkoop@groteklant.nl',
  remindersSent: [],
  ...overrides,
})

describe('when a reminder falls due', () => {
  it('is silent before the due date', () => {
    expect(planDunning([invoice()], '2026-02-28')).toEqual([])
  })

  it('is silent on the due date itself, which is not late', () => {
    expect(planDunning([invoice()], '2026-03-01')).toEqual([])
  })

  it('is silent for the first week, because a day late is not worth a letter', () => {
    expect(planDunning([invoice()], '2026-03-07')).toEqual([])
  })

  it('asks for the first reminder at seven days', () => {
    const [action] = planDunning([invoice()], '2026-03-08')
    expect(action?.stage.stage).toBe(1)
    expect(action?.stage.label).toBe('Betalingsherinnering')
    expect(action?.daysOverdue).toBe(7)
  })

  it('reaches the second at twenty-one days and the last at forty-two', () => {
    expect(planDunning([invoice()], '2026-03-22')[0]?.stage.stage).toBe(2)
    expect(planDunning([invoice()], '2026-04-12')[0]?.stage.stage).toBe(3)
  })

  it('stops after the last stage rather than inventing a fourth', () => {
    expect(planDunning([invoice({ remindersSent: [1, 2, 3] })], '2027-01-01')).toEqual([])
  })
})

describe('one reminder per stage, ever', () => {
  it('does not repeat a stage that has been sent', () => {
    expect(planDunning([invoice({ remindersSent: [1] })], '2026-03-08')).toEqual([])
  })

  it('moves on to the next stage when it comes due', () => {
    const [action] = planDunning([invoice({ remindersSent: [1] })], '2026-03-22')
    expect(action?.stage.stage).toBe(2)
  })

  it('sends only the newest stage when several are overdue at once', () => {
    // Two months late with nothing sent: three stages have passed. Sending all
    // three would be a form of shouting.
    const actions = planDunning([invoice()], '2026-05-01')
    expect(actions).toHaveLength(1)
    expect(actions[0]?.stage.stage).toBe(3)
  })

  it('skips a stage that was somehow missed rather than replaying it', () => {
    const actions = planDunning([invoice({ remindersSent: [3] })], '2026-05-01')
    expect(actions).toEqual([])
  })
})

describe('what is never chased', () => {
  it('a credit note, which is money owed the other way', () => {
    expect(planDunning([invoice({ kind: 'credit_note' })], '2026-05-01')).toEqual([])
  })

  it('a cancelled invoice, which is owed by nobody', () => {
    expect(planDunning([invoice({ status: 'cancelled' })], '2026-05-01')).toEqual([])
  })

  it('a draft, which was never sent in the first place', () => {
    expect(planDunning([invoice({ status: 'draft' })], '2026-05-01')).toEqual([])
  })
})

describe('what the list looks like', () => {
  it('puts the longest overdue first, which is the order to work through', () => {
    const actions = planDunning(
      [
        invoice({ invoiceId: 'a', dueDate: '2026-04-01' }),
        invoice({ invoiceId: 'b', dueDate: '2026-01-01' }),
        invoice({ invoiceId: 'c', dueDate: '2026-03-01' }),
      ],
      '2026-05-01',
    )
    expect(actions.map((action) => action.invoiceId)).toEqual(['b', 'c', 'a'])
  })

  it('lists an invoice with no email address, and says it cannot be sent', () => {
    const [action] = planDunning([invoice({ contactEmail: null })], '2026-03-08')
    // Listed rather than hidden: "I chased them and nothing happened" is the
    // case where a missing row helps least.
    expect(action?.sendable).toBe(false)
    expect(action?.contactEmail).toBeNull()
  })

  it('treats an empty address as no address', () => {
    expect(planDunning([invoice({ contactEmail: '' })], '2026-03-08')[0]?.sendable).toBe(false)
  })
})

describe('the schedule', () => {
  it('is honoured when a caller supplies their own', () => {
    const strict = [{ stage: 1, afterDays: 1, label: 'Direct', tone: 'demand' as const }]
    expect(planDunning([invoice()], '2026-03-02', strict)[0]?.stage.label).toBe('Direct')
  })

  it('is sorted by age, whatever order it was given in', () => {
    const jumbled = [
      { stage: 2, afterDays: 30, label: 'Later', tone: 'demand' as const },
      { stage: 1, afterDays: 5, label: 'Eerder', tone: 'reminder' as const },
    ]
    expect(planDunning([invoice()], '2026-03-10', jumbled)[0]?.stage.stage).toBe(1)
  })

  it('names a stage, for a report that shows history', () => {
    expect(stageOf(2)?.label).toBe('Tweede herinnering')
    expect(stageOf(9)).toBeNull()
  })

  it('has three stages and stops before the statutory-interest decision', () => {
    expect(DEFAULT_DUNNING_SCHEDULE).toHaveLength(3)
    expect(DEFAULT_DUNNING_SCHEDULE.at(-1)?.tone).toBe('final')
  })
})

describe('the date it is asked about', () => {
  it('must be a date', () => {
    expect(() => planDunning([invoice()], '01-03-2026')).toThrow(LedgerError)
    expect(() => planDunning([invoice()], 'today')).toThrow(LedgerError)
  })
})
