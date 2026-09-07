import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LedgerError } from '../../src/errors.js'
import {
  batchTotal,
  isValidBic,
  isValidIban,
  offendingSepaCharacters,
  validatePaymentBatch,
  type PaymentBatch,
} from '../../src/payments/model.js'
import { generatePain001, painAmount, painText } from '../../src/payments/pain001.js'
import { isEditable, nextState } from '../../src/payments/approval.js'

/**
 * Outbound payments (spec 7.4).
 *
 * The golden file is validated against the ISO 20022 schema **if one is
 * present**. Unlike XAF and UBL there is none in the repository: ISO publishes
 * its XSDs behind registration and the redistribution terms are not settled, so
 * vendoring one would repeat the question ADR 0011 already has open. An
 * operator who has downloaded it can drop it in `reference-data/pain/` and this
 * test starts checking against it.
 *
 * Which is why `validatePaymentBatch` carries the weight, and why it checks the
 * IBAN check digits — a thing no XSD would have caught, and the commonest
 * reason a bank rejects a whole batch.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const GOLDEN_DIR = join(HERE, '__golden__')
const SCHEMA = join(HERE, '..', '..', '..', '..', 'reference-data', 'pain', 'pain.001.001.03.xsd')

const batch = (overrides: Partial<PaymentBatch> = {}): PaymentBatch => ({
  id: 'b1',
  reference: 'BATCH-2026-04-01',
  state: 'approved',
  debtorName: 'De Tol Beheer B.V.',
  debtorIban: 'NL02ABNA0123456789',
  debtorBic: 'ABNANL2A',
  requestedExecutionDate: '2026-04-03',
  approvedAt: '2026-04-01T09:30:00.000Z',
  instructions: [
    {
      id: 'i1',
      endToEndId: 'INK-2026-0007',
      creditorName: 'Telecom B.V.',
      creditorIban: 'NL20INGB0001234567',
      creditorBic: 'INGBNL2A',
      amount: 4_550n,
      currency: 'EUR',
      remittanceInformation: 'Factuur INK-2026-0007',
      remittanceReference: null,
    },
    {
      id: 'i2',
      endToEndId: 'INK-2026-0008',
      creditorName: 'Groothandel Van Dam',
      creditorIban: 'NL91RABO0315273637',
      creditorBic: null,
      amount: 121_000n,
      currency: 'EUR',
      remittanceInformation: 'Levering maart',
      remittanceReference: 'REF-887766',
    },
  ],
  ...overrides,
})

function goldenFile(name: string, actual: string): void {
  const path = join(GOLDEN_DIR, name)

  if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(path)) {
    mkdirSync(GOLDEN_DIR, { recursive: true })
    writeFileSync(path, actual)
    if (process.env['UPDATE_GOLDEN'] !== '1') {
      throw new Error(
        `Golden file ${name} did not exist and has been created. Review and commit it.`,
      )
    }
    return
  }

  expect(actual).toBe(readFileSync(path, 'utf8'))
}

const hasXmllint = (() => {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
})()

describe('IBAN check digits', () => {
  it('accepts real ones', () => {
    for (const iban of [
      'NL02ABNA0123456789',
      'NL91ABNA0417164300',
      'NL20INGB0001234567',
      'BE68539007547034',
      'DE89370400440532013000',
    ]) {
      expect(isValidIban(iban), iban).toBe(true)
    }
  })

  it('rejects a transposed digit, which is the whole reason it exists', () => {
    // A mistyped IBAN is the commonest error in a payment file, and the bank
    // rejects the entire batch for one bad account.
    expect(isValidIban('NL91ABNA0417164301')).toBe(false)
    expect(isValidIban('NL02ABNA0123456798')).toBe(false)
  })

  it('ignores spaces and case, because people paste both', () => {
    expect(isValidIban('nl91 abna 0417 1643 00')).toBe(true)
  })

  it('rejects things that are not IBANs at all', () => {
    for (const bad of ['', 'NL', '0417164300', 'NL91-ABNA-0417164300', 'XX00A']) {
      expect(isValidIban(bad), bad).toBe(false)
    }
  })
})

describe('BIC', () => {
  it('accepts eight and eleven characters', () => {
    expect(isValidBic('ABNANL2A')).toBe(true)
    expect(isValidBic('ABNANL2AXXX')).toBe(true)
  })

  it('rejects anything else', () => {
    for (const bad of ['ABNANL', 'ABNANL2AX', '12345678', 'abnanl2']) {
      expect(isValidBic(bad), bad).toBe(false)
    }
  })
})

describe('the characters SEPA accepts', () => {
  it('passes an ordinary Dutch name', () => {
    expect(offendingSepaCharacters("O'Brien & Zn")).toEqual(['&'])
    expect(offendingSepaCharacters('Van Dam B.V.')).toEqual([])
  })

  it('names the character, rather than saying no', () => {
    // A bank that receives an unsupported character either rejects the file or
    // silently transliterates it, after which the payee cannot match it.
    expect(offendingSepaCharacters('Café Zürich')).toEqual(['é', 'ü'])
  })
})

describe('validating a batch', () => {
  it('accepts a good one', () => {
    expect(validatePaymentBatch(batch())).toEqual([])
  })

  it('reports every bad IBAN, not the first', () => {
    const problems = validatePaymentBatch(
      batch({
        instructions: batch().instructions.map((instruction) => ({
          ...instruction,
          creditorIban: 'NL91ABNA0417164301',
        })),
      }),
    )
    expect(problems.filter((problem) => problem.code === 'invalid_iban')).toHaveLength(2)
    expect(problems[0]?.path).toBe('instructions.0.creditorIban')
  })

  it('catches a duplicate end-to-end id, which a bank may read as a double payment', () => {
    const [first] = batch().instructions
    const problems = validatePaymentBatch(
      batch({ instructions: [first!, { ...first!, id: 'i2' }] }),
    )
    expect(problems.map((problem) => problem.code)).toContain('duplicate_end_to_end_id')
  })

  it('refuses a currency SEPA does not carry', () => {
    const problems = validatePaymentBatch(
      batch({
        instructions: [{ ...batch().instructions[0]!, currency: 'USD' }],
      }),
    )
    expect(problems.map((problem) => problem.code)).toContain('invalid_currency')
  })

  it('refuses a payment of zero and an empty batch', () => {
    expect(
      validatePaymentBatch(
        batch({ instructions: [{ ...batch().instructions[0]!, amount: 0n }] }),
      ).map((problem) => problem.code),
    ).toContain('invalid_amount')

    expect(
      validatePaymentBatch(batch({ instructions: [] })).map((problem) => problem.code),
    ).toContain('empty_batch')
  })

  it('adds up to the control sum', () => {
    expect(batchTotal(batch())).toBe(125_550n)
  })
})

describe('reproducibility', () => {
  it('stamps CreDtTm from the approval, so two downloads are the same bytes', () => {
    // The evidence chain records the hash of what went to the bank. A
    // `CreDtTm` read from the clock makes a second download a different file,
    // which used to make the handler test pass or fail depending on whether
    // the two calls happened to straddle a second.
    const approved = batch({ approvedAt: '2026-04-01T09:30:00.000Z' })
    expect(generatePain001(approved)).toBe(generatePain001(approved))
    expect(generatePain001(approved)).toContain('<CreDtTm>2026-04-01T09:30:00</CreDtTm>')
  })

  it('falls back to the clock only when there is no approval', () => {
    // An unapproved batch has no payment file, so this is unreachable in
    // practice — but a generator that produced nothing for a missing timestamp
    // would be worse than one that produced something.
    const xml = generatePain001(batch({ approvedAt: null }))
    expect(xml).toMatch(/<CreDtTm>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}<\/CreDtTm>/)
  })
})

describe('the generated file', () => {
  const xml = generatePain001(batch(), { createdAt: '2026-04-01T09:00:00' })

  it('matches the committed golden file', () => {
    goldenFile('batch-2026-04-01.pain001.xml', xml)
  })

  it.runIf(hasXmllint && existsSync(SCHEMA))(
    'validates against the ISO 20022 schema, when one has been supplied',
    () => {
      const path = join(GOLDEN_DIR, '.tmp.pain001.xml')
      mkdirSync(GOLDEN_DIR, { recursive: true })
      writeFileSync(path, xml)
      // Throws on a validation failure, which is the assertion.
      execFileSync('xmllint', ['--noout', '--schema', SCHEMA, path], { stdio: 'pipe' })
    },
  )

  it('declares the version every Dutch bank still accepts', () => {
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.001.001.03')
  })

  it('books each transfer separately, so the statement shows one line per payee', () => {
    // Batch booking shows one line for the lot, which is exactly what makes
    // the reconciliation afterwards impossible.
    expect(xml).toContain('<BtchBookg>false</BtchBookg>')
  })

  it('states the count and the control sum, twice, as the message requires', () => {
    expect(xml.match(/<NbOfTxs>2<\/NbOfTxs>/g)).toHaveLength(2)
    expect(xml.match(/<CtrlSum>1255\.50<\/CtrlSum>/g)).toHaveLength(2)
  })

  it('writes a structured reference when there is one, and free text otherwise', () => {
    // The message allows one or the other, never both.
    expect(xml).toContain('<Ustrd>Factuur INK-2026-0007</Ustrd>')
    expect(xml).toContain('<Ref>REF-887766</Ref>')
    expect(xml).toContain('<Cd>SCOR</Cd>')

    const structured = xml.slice(xml.indexOf('INK-2026-0008'))
    expect(structured).not.toContain('<Ustrd>')
  })

  it('writes NOTPROVIDED when the payer BIC is unknown', () => {
    const withoutBic = generatePain001(batch({ debtorBic: null }), {
      createdAt: '2026-04-01T09:00:00',
    })
    expect(withoutBic).toContain('<Id>NOTPROVIDED</Id>')
    expect(withoutBic).not.toContain('<BIC>ABNANL2A</BIC>')
  })

  it('omits the payee BIC, which SEPA has not needed since 2016', () => {
    const second = xml.slice(xml.indexOf('INK-2026-0008'))
    expect(second).not.toContain('CdtrAgt')
  })
})

describe('amounts and lengths', () => {
  it('formats minor units without a float', () => {
    expect(painAmount(0n)).toBe('0.00')
    expect(painAmount(5n)).toBe('0.05')
    expect(painAmount(125_550n)).toBe('1255.50')
    expect(painAmount(12_345_678_901_234_567n)).toBe('123456789012345.67')
  })

  it('refuses a negative amount rather than writing one', () => {
    expect(() => painAmount(-1n)).toThrow(/unsigned/)
  })

  it('trims a long name on a word boundary', () => {
    const name = 'Groothandel Van Dam en Zonen Beheer en Exploitatie Maatschappij Nederland B.V.'
    const trimmed = painText(name, 70)
    expect(trimmed.length).toBeLessThanOrEqual(70)
    // Not mid-word: a bank that truncates does it mid-word, in the middle of
    // the reference the payee needs.
    expect(trimmed.endsWith(' ')).toBe(false)
    expect(name.startsWith(trimmed)).toBe(true)
  })

  it('collapses whitespace, because a bank counts every character', () => {
    expect(painText('  Van   Dam \n B.V. ', 70)).toBe('Van Dam B.V.')
  })
})

describe('the two-person rule', () => {
  it('lets one person submit', () => {
    expect(
      nextState('submit', 'draft', { userId: 'a', submittedBy: null, actorKind: 'human' }),
    ).toBe('submitted')
  })

  it('refuses an approval by whoever submitted it', () => {
    // The only thing standing between a compromised account and the bank.
    expect(() =>
      nextState('approve', 'submitted', { userId: 'a', submittedBy: 'a', actorKind: 'human' }),
    ).toThrow(/somebody other than the person who submitted/)
  })

  it('refuses an approval by a script, whoever submitted', () => {
    // The point of a second person is human judgement. A scheduled job that
    // approves whatever was submitted is one person with a cron entry.
    expect(() =>
      nextState('approve', 'submitted', {
        userId: 'robot',
        submittedBy: 'a',
        actorKind: 'script',
      }),
    ).toThrow(/has to be approved by a person/)
  })

  it('accepts an approval by anybody else', () => {
    expect(
      nextState('approve', 'submitted', { userId: 'b', submittedBy: 'a', actorKind: 'human' }),
    ).toBe('approved')
  })

  it('lets the submitter reject their own batch', () => {
    // Spotting your own mistake should never need a second person.
    expect(
      nextState('reject', 'submitted', { userId: 'a', submittedBy: 'a', actorKind: 'human' }),
    ).toBe('rejected')
  })

  it('will not approve a draft, or export something unapproved', () => {
    expect(() =>
      nextState('approve', 'draft', { userId: 'b', submittedBy: null, actorKind: 'human' }),
    ).toThrow(LedgerError)
    expect(() =>
      nextState('export', 'submitted', { userId: 'b', submittedBy: 'a', actorKind: 'human' }),
    ).toThrow(LedgerError)
  })

  it('will not approve the same batch twice', () => {
    expect(() =>
      nextState('approve', 'approved', { userId: 'c', submittedBy: 'a', actorKind: 'human' }),
    ).toThrow(LedgerError)
  })

  it('sends a rejected batch back to draft, and an approved one nowhere', () => {
    expect(
      nextState('reopen', 'rejected', { userId: 'a', submittedBy: 'a', actorKind: 'human' }),
    ).toBe('draft')
    // Withdrawing an approval is a new approval decision, so it is a reject.
    expect(() =>
      nextState('reopen', 'approved', { userId: 'a', submittedBy: 'a', actorKind: 'human' }),
    ).toThrow(LedgerError)
  })

  it('freezes the instructions the moment it is submitted', () => {
    // An approver who approves a batch that then changes has approved nothing.
    expect(isEditable('draft')).toBe(true)
    for (const state of ['submitted', 'approved', 'exported', 'rejected'] as const) {
      expect(isEditable(state), state).toBe(false)
    }
  })
})
