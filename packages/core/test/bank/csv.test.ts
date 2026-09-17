import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BankStatementError } from '../../src/bank/model.js'
import {
  DEFAULT_CSV_MAPPING,
  guessCsvMapping,
  parseBankCsv,
  parseCsv,
  sniffDelimiter,
} from '../../src/bank/csv.js'
import { planImport } from '../../src/bank/import.js'

/**
 * The CSV mapper (spec 7.4).
 *
 * "A configurable CSV mapper for the stragglers." Configurable is the point:
 * there is no CSV standard and every bank invents its own columns, so the
 * fixtures here are the real shapes ING and Rabobank export, and the test is
 * that one parser reads both from a mapping rather than from a special case.
 *
 * The awkward fixture exists because a description field eventually contains a
 * delimiter, a newline and a quote, and a hand-rolled splitter that has not
 * been made to face all three is a splitter that silently loses rows.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const read = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

describe('splitting a CSV', () => {
  it('reads a quoted field containing the delimiter', () => {
    expect(parseCsv('a;"b;c";d', ';')).toEqual([['a', 'b;c', 'd']])
  })

  it('reads a quoted field containing a newline', () => {
    expect(parseCsv('a;"line\nbreak"\nnext;row', ';')).toEqual([
      ['a', 'line\nbreak'],
      ['next', 'row'],
    ])
  })

  it('reads a doubled quote as one quote', () => {
    expect(parseCsv('a;"say ""hi"""', ';')).toEqual([['a', 'say "hi"']])
  })

  it('drops a trailing blank line rather than making a row of it', () => {
    expect(parseCsv('a;b\n\n', ';')).toEqual([['a', 'b']])
  })

  it('strips a byte-order mark, which would otherwise poison the first header', () => {
    expect(parseCsv('\uFEFFDatum;Bedrag', ';')[0]?.[0]).toBe('Datum')
  })
})

describe('sniffing the delimiter', () => {
  it('picks the one that actually separates the columns', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',')
  })

  it('is not fooled by a comma inside a quoted header', () => {
    expect(sniffDelimiter('"Naam, tegenpartij";Bedrag')).toBe(';')
  })
})

describe('an ING export', () => {
  const guess = guessCsvMapping(read('ing.csv'))
  const [statement] = parseBankCsv(read('ing.csv'), {
    accountIban: 'NL02ABNA0123456789',
    mapping: guess.mapping,
  })

  it('is guessed well enough to be worth checking rather than filling in', () => {
    expect(guess.mapping.delimiter).toBe(';')
    expect(guess.mapping.bookingDate).toBe('Datum')
    expect(guess.mapping.amount).toBe('Bedrag (EUR)')
    // ING writes the direction in a separate column, not a sign.
    expect(guess.mapping.amountStyle).toBe('indicator')
    expect(guess.mapping.indicator).toBe('Af Bij')
    expect(guess.mapping.dateFormat).toBe('yyyyMMdd')
    expect(guess.mapping.decimalSeparator).toBe(',')
    expect(guess.mapping.balanceAfter).toBe('Saldo na mutatie')
  })

  it('signs the amounts from the indicator column', () => {
    expect(statement?.entries.map((entry) => entry.amount)).toEqual([121_000n, -4_550n, 50_000n])
  })

  it('reads the counterparty and the description', () => {
    expect(statement?.entries[0]?.counterpartyName).toBe('Grote Klant N.V.')
    expect(statement?.entries[0]?.counterpartyIban).toBe('NL91RABO0315273637')
    expect(statement?.entries[0]?.description).toBe('Factuur 2026-0001')
  })

  it('recovers the balances from the running column', () => {
    // The column says what the balance was *after* each mutation, so the
    // opening balance is the first one minus the first mutation.
    expect(statement?.openingBalance).toBe(125_000n)
    expect(statement?.closingBalance).toBe(291_450n)
  })

  it('says which columns it could not place, so nothing is silently ignored', () => {
    expect(guess.unmatched).toContain('Code')
    expect(guess.unmatched).toContain('Mutatiesoort')
  })
})

describe('a Rabobank export', () => {
  const guess = guessCsvMapping(read('rabobank.csv'))
  const [statement] = parseBankCsv(read('rabobank.csv'), {
    accountIban: 'NL02ABNA0123456789',
    mapping: guess.mapping,
  })

  it('is a comma-delimited file with signed amounts', () => {
    expect(guess.mapping.delimiter).toBe(',')
    expect(guess.mapping.amountStyle).toBe('signed')
    expect(guess.mapping.dateFormat).toBe('yyyy-MM-dd')
  })

  it('reads the sign from the amount itself', () => {
    expect(statement?.entries.map((entry) => entry.amount)).toEqual([121_000n, -4_550n])
  })

  it('reads the payment reference, which Rabobank puts in its own column', () => {
    expect(statement?.entries[0]?.remittanceReference).toBe('2026-0001')
  })
})

describe('the awkward things a description contains', () => {
  const [statement] = parseBankCsv(read('awkward.csv'), {
    accountIban: 'NL02ABNA0123456789',
    mapping: {
      ...DEFAULT_CSV_MAPPING,
      delimiter: ';',
      bookingDate: 'Datum',
      amount: 'Bedrag',
      counterpartyName: 'Naam tegenpartij',
      counterpartyIban: null,
      description: 'Omschrijving',
      dateFormat: 'dd-MM-yyyy',
    },
  })

  it('keeps a comma inside a name', () => {
    expect(statement?.entries[0]?.counterpartyName).toBe('Klant, met komma')
  })

  it('keeps a newline inside a description', () => {
    expect(statement?.entries[0]?.description).toBe('Factuur 2026-0001\ntweede regel')
  })

  it('keeps a quote inside a description', () => {
    expect(statement?.entries[1]?.description).toBe('Zei "tot ziens"')
  })

  it('reads thousands separators the Dutch way round', () => {
    expect(statement?.entries[0]?.amount).toBe(121_000n)
  })
})

describe('the debit and credit column style', () => {
  const mapping = {
    ...DEFAULT_CSV_MAPPING,
    delimiter: ';',
    bookingDate: 'Datum',
    amount: 'Af',
    creditAmount: 'Bij',
    amountStyle: 'debit_credit_columns' as const,
    counterpartyName: null,
    counterpartyIban: null,
    description: 'Omschrijving',
    dateFormat: 'dd-MM-yyyy',
  }

  it('signs from whichever column is filled', () => {
    const [statement] = parseBankCsv(
      'Datum;Af;Bij;Omschrijving\n02-03-2026;;1210,00;in\n03-03-2026;45,50;;uit\n',
      { accountIban: 'NL02ABNA0123456789', mapping },
    )
    expect(statement?.entries.map((entry) => entry.amount)).toEqual([121_000n, -4_550n])
  })

  it('refuses a row with both filled, which means the mapping is wrong', () => {
    expect(() =>
      parseBankCsv('Datum;Af;Bij;Omschrijving\n02-03-2026;1,00;2,00;beide\n', {
        accountIban: 'NL02ABNA0123456789',
        mapping,
      }),
    ).toThrow(/Both the debit and the credit/)
  })

  it('refuses a row with neither filled', () => {
    expect(() =>
      parseBankCsv('Datum;Af;Bij;Omschrijving\n02-03-2026;;;geen\n', {
        accountIban: 'NL02ABNA0123456789',
        mapping,
      }),
    ).toThrow(/Neither the debit nor the credit/)
  })
})

describe('columns by index, for a file with no header', () => {
  it('reads them positionally', () => {
    const [statement] = parseBankCsv('02-03-2026;1210,00;Grote Klant;Factuur\n', {
      accountIban: 'NL02ABNA0123456789',
      mapping: {
        ...DEFAULT_CSV_MAPPING,
        delimiter: ';',
        hasHeader: false,
        bookingDate: '0',
        amount: '1',
        counterpartyName: '2',
        counterpartyIban: null,
        description: '3',
        dateFormat: 'dd-MM-yyyy',
      },
    })

    expect(statement?.entries[0]).toMatchObject({
      amount: 121_000n,
      counterpartyName: 'Grote Klant',
      description: 'Factuur',
    })
  })
})

describe('what a CSV cannot tell you', () => {
  const withoutBalance = 'Datum;Bedrag;Omschrijving\n02-03-2026;1210,00;in\n'
  const mapping = {
    ...DEFAULT_CSV_MAPPING,
    delimiter: ';',
    bookingDate: 'Datum',
    amount: 'Bedrag',
    counterpartyName: null,
    counterpartyIban: null,
    description: 'Omschrijving',
    dateFormat: 'dd-MM-yyyy',
  }

  it('leaves the balances null rather than inventing a zero', () => {
    // A fabricated zero would appear on the bank screen as this account's
    // balance, which is worse than admitting there is none.
    const [statement] = parseBankCsv(withoutBalance, {
      accountIban: 'NL02ABNA0123456789',
      mapping,
    })
    expect(statement?.openingBalance).toBeNull()
    expect(statement?.closingBalance).toBeNull()
  })

  it('is imported anyway, with a warning that the strongest check cannot run', () => {
    const statements = parseBankCsv(withoutBalance, {
      accountIban: 'NL02ABNA0123456789',
      mapping,
    })
    const plan = planImport(statements, {
      accountIban: 'NL02ABNA0123456789',
      currency: 'EUR',
      lastSequenceNumber: null,
    })

    expect(plan.problems.map((problem) => problem.code)).toContain('no_balance_declared')
    expect(plan.problems.every((problem) => problem.severity === 'warning')).toBe(true)
    expect(plan.dedupeKeys).toHaveLength(1)
  })

  it('deduplicates on content, because there is no bank reference to trust', () => {
    const statements = parseBankCsv(read('ing.csv'), {
      accountIban: 'NL02ABNA0123456789',
      mapping: guessCsvMapping(read('ing.csv')).mapping,
    })
    const plan = planImport(statements, {
      accountIban: 'NL02ABNA0123456789',
      currency: 'EUR',
      lastSequenceNumber: null,
    })

    expect(plan.dedupeKeys.every((key) => key.startsWith('sha256:'))).toBe(true)
    expect(new Set(plan.dedupeKeys).size).toBe(3)
  })
})

describe('what is refused', () => {
  const mapping = {
    ...DEFAULT_CSV_MAPPING,
    delimiter: ';',
    bookingDate: 'Datum',
    amount: 'Bedrag',
    counterpartyName: null,
    counterpartyIban: null,
    description: null,
    dateFormat: 'dd-MM-yyyy',
  }

  it('a date that is not in the configured format', () => {
    expect(() =>
      parseBankCsv('Datum;Bedrag\n2026-03-02;10,00\n', {
        accountIban: 'NL02ABNA0123456789',
        mapping,
      }),
    ).toThrow(/is not a date in dd-MM-yyyy/)
  })

  it('a line of zero, which is not a mutation', () => {
    expect(() =>
      parseBankCsv('Datum;Bedrag\n02-03-2026;0,00\n', {
        accountIban: 'NL02ABNA0123456789',
        mapping,
      }),
    ).toThrow(/not a mutation/)
  })

  it('an empty file', () => {
    expect(() => parseBankCsv('', { accountIban: 'NL02ABNA0123456789', mapping })).toThrow(
      BankStatementError,
    )
  })

  it('a file with a header and nothing else', () => {
    expect(() =>
      parseBankCsv('Datum;Bedrag\n', { accountIban: 'NL02ABNA0123456789', mapping }),
    ).toThrow(/header and no rows/)
  })
})
