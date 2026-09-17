import { describe, expect, it } from 'vitest'
import {
  balanceSheetAccounts,
  defaultJournal,
  openingJournals,
  type AccountOption,
  type JournalOption,
} from '../../src/lib/account-options.js'

/**
 * The rule behind the pickers on the Exact screen.
 *
 * These were free-text fields, and the cost of that showed up as a question:
 * "what account would that usually be? My corporate IBAN?" A field whose valid
 * values are a finite known list should not be something you have to be told
 * how to fill in — and a bank account is precisely the wrong answer, because an
 * opening balance is not money moving.
 */

const account = (
  number: string,
  name: string,
  type: AccountOption['type'],
  isBlocked = false,
): AccountOption => ({ number, name, type, isBlocked })

const CHART: readonly AccountOption[] = [
  account('1100', 'Bank', 'asset'),
  account('1300', 'Debiteuren', 'asset'),
  account('1600', 'Crediteuren', 'liability'),
  account('2000', 'Tussenrekening', 'asset'),
  account('0900', 'Onverdeelde winst', 'equity'),
  account('8000', 'Omzet', 'revenue'),
  account('4900', 'Algemene kosten', 'expense'),
  account('9998', 'Oude kostenpost', 'expense', true),
]

describe('which accounts an opening balance may touch', () => {
  it('offers assets, liabilities and equity', () => {
    const offered = balanceSheetAccounts(CHART).map((a) => a.number)
    expect(offered).toEqual(['1100', '1300', '1600', '2000', '0900'])
  })

  it('never offers a revenue or cost account', () => {
    // The expensive mistake: a debtor position booked against 8000 restates the
    // year's result by its whole value, and nothing looks wrong afterwards.
    const offered = balanceSheetAccounts(CHART).map((a) => a.type)
    expect(offered).not.toContain('revenue')
    expect(offered).not.toContain('expense')
  })

  it('keeps a blocked balance-sheet account so the screen can mark it', () => {
    // The ledger refuses to post to a blocked account with a clear message.
    // Hiding it here would turn that into "my account is missing".
    const blocked = account('1399', 'Oude debiteuren', 'asset', true)
    expect(balanceSheetAccounts([...CHART, blocked]).map((a) => a.number)).toContain('1399')
  })
})

describe('which dagboek an opening entry goes in', () => {
  const journals: readonly JournalOption[] = [
    { code: 'BNK', name: 'Bank', type: 'bank' },
    { code: 'INK', name: 'Inkoopboek', type: 'inkoop' },
    { code: 'KAS', name: 'Kas', type: 'kas' },
    { code: 'MEM', name: 'Memoriaal', type: 'memoriaal' },
    { code: 'VRK', name: 'Verkoopboek', type: 'verkoop' },
  ]

  it('is a memoriaal and nothing else', () => {
    // An overname is not a sale. Offering the verkoopboek would let somebody
    // file a migration as revenue.
    expect(openingJournals(journals).map((j) => j.code)).toEqual(['MEM'])
  })

  it('needs no choosing when there is one', () => {
    expect(defaultJournal(journals)).toBe('MEM')
  })

  it('asks when there is more than one', () => {
    const two = [...journals, { code: 'MEM2', name: 'Memoriaal 2', type: 'memoriaal' as const }]
    expect(defaultJournal(two)).toBe('')
  })

  it('asks nothing of an administration with no memoriaal', () => {
    expect(defaultJournal([{ code: 'VRK', name: 'Verkoopboek', type: 'verkoop' }])).toBe('')
  })
})
