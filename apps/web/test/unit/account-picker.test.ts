import { describe, expect, it } from 'vitest'
import {
  filterAccounts,
  isPostable,
  resolveAccount,
  type PickableAccount,
} from '../../src/lib/account-picker.js'

/**
 * The picker contract, tested by naming fragments.
 *
 * The screen it serves used to be a native `<datalist>` over account numbers
 * only, which works perfectly for somebody who knows the chart by heart and
 * leaves everybody else scrolling. `1300`, `deb` and `debiteuren` all have to
 * find Debiteuren (docs/keyboard-map.md).
 */

const CHART: readonly PickableAccount[] = [
  { number: '1100', name: 'Bank' },
  { number: '1300', name: 'Debiteuren' },
  { number: '1600', name: 'Crediteuren' },
  { number: '1500', name: 'Af te dragen BTW' },
  { number: '4400', name: 'Kantoorkosten' },
  { number: '4410', name: 'Telefoon en internet' },
  { number: '8000', name: 'Omzet hoog tarief' },
  { number: '9998', name: 'Oude kostenpost', isBlocked: true },
]

const numbers = (accounts: readonly PickableAccount[]): string[] =>
  accounts.map((account) => account.number)

describe('filtering the chart by what was typed', () => {
  it('shows everything before anything is typed', () => {
    expect(filterAccounts(CHART, '')).toHaveLength(CHART.length)
    expect(filterAccounts(CHART, '   ')).toHaveLength(CHART.length)
  })

  it('finds an account by its number', () => {
    expect(numbers(filterAccounts(CHART, '44'))).toEqual(['4400', '4410'])
  })

  it('finds the same account by its name', () => {
    expect(numbers(filterAccounts(CHART, 'deb'))).toEqual(['1300'])
    expect(numbers(filterAccounts(CHART, 'debiteuren'))).toEqual(['1300'])
  })

  it('ignores case, because nobody holds shift for a grootboekrekening', () => {
    expect(numbers(filterAccounts(CHART, 'KANTOOR'))).toEqual(['4400'])
  })

  it('takes several terms in any order', () => {
    expect(numbers(filterAccounts(CHART, 'kosten 44'))).toEqual(['4400'])
    expect(numbers(filterAccounts(CHART, '44 kosten'))).toEqual(['4400'])
  })

  it('puts an exact number first, then the numbers it starts', () => {
    // `1500` is typed by somebody who means 1500, even though 1300's name has
    // no digits and four other accounts contain the fragment.
    expect(numbers(filterAccounts(CHART, '1500'))).toEqual(['1500'])
  })

  it('prefers a word that starts a name over a fragment inside one', () => {
    expect(numbers(filterAccounts(CHART, 'tarief'))).toEqual(['8000'])
    expect(numbers(filterAccounts(CHART, 'telefoon'))).toEqual(['4410'])
  })

  it('sinks a blocked account below the ones that can be posted to', () => {
    expect(numbers(filterAccounts(CHART, 'kosten'))).toEqual(['4400', '9998'])
  })

  it('finds nothing rather than guessing', () => {
    expect(filterAccounts(CHART, 'zzz')).toEqual([])
  })
})

describe('what the text in a field stands for', () => {
  it('takes an exact number as written', () => {
    expect(resolveAccount(CHART, '4400')?.name).toBe('Kantoorkosten')
    expect(resolveAccount(CHART, ' 4400 ')?.name).toBe('Kantoorkosten')
  })

  it('resolves a fragment with one match', () => {
    expect(resolveAccount(CHART, 'debiteuren')?.number).toBe('1300')
  })

  it('refuses to choose between two', () => {
    expect(resolveAccount(CHART, '44')).toBeNull()
  })

  it('never resolves to an account the ledger would refuse', () => {
    // A blocked account offered as a valid choice is a posting that fails at
    // the end of the form rather than at the field.
    expect(resolveAccount(CHART, '9998')).toBeNull()
    expect(resolveAccount(CHART, 'oude')).toBeNull()
  })

  it('is nothing when the field is empty', () => {
    expect(resolveAccount(CHART, '')).toBeNull()
  })
})

describe('which accounts the ledger would take a posting to', () => {
  it('is every account that is not blocked', () => {
    expect(isPostable({ number: '1100', name: 'Bank' })).toBe(true)
    expect(isPostable({ number: '9998', name: 'Oude kostenpost', isBlocked: true })).toBe(false)
  })
})
