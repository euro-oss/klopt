import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { ApiError } from '../src/api/errors.js'
import {
  handleConfirmMatch,
  handleCreateBankAccount,
  handleIgnoreTransaction,
  handleImportStatement,
  handleListBankTransactions,
  handleListMatchRules,
  handleSetMatchRuleActive,
  handleSuggestMatches,
} from '../src/api/handlers/bank.js'
import {
  handleCreateContact,
  handleDraftInvoice,
  handleGetDunningQueue,
  handleIssueInvoice,
} from '../src/api/handlers/sales.js'
import { handleGetJournalEntry } from '../src/api/handlers/ledger.js'
import {
  confirmMatchBody,
  createBankAccountBody,
  createContactBody,
  draftInvoiceBody,
  importStatementBody,
  issueInvoiceBody,
  transactionsQuery,
} from '../src/api/schemas.js'

/**
 * Matching, end to end against a real database.
 *
 * The core tests cover the scoring against fixtures. What needs Postgres is the
 * consequence: confirming a match posts an entry, allocates against the
 * invoice, and the invoice then stops being outstanding — which is the thing
 * the dunning list has been overstating since M1, and the reason this milestone
 * matters more than it looks.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'core',
  'test',
  'bank',
  '__fixtures__',
)

let database: Database
let token: string
let bankAccountId: string
let iban: string

const request = (idempotencyKey?: string): Request => {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/api/v1/bank-transactions', { headers })
}

const contextFor = async (idempotencyKey?: string) =>
  resolveRequestContext({ database, request: request(idempotencyKey) })

/** An issued invoice for a customer whose IBAN is the one in the fixture. */
async function anInvoice(options: { amount?: string; number?: string } = {}): Promise<{
  invoiceId: string
  number: string
  contactNumber: string
}> {
  const contactNumber = `DEB-${randomUUID().slice(0, 8)}`
  await handleCreateContact(
    await contextFor(uuidv7()),
    createContactBody.parse({
      number: contactNumber,
      name: 'Grote Klant N.V.',
      isCustomer: true,
      email: 'inkoop@groteklant.nl',
    }),
  )

  const draft = await handleDraftInvoice(
    await contextFor(uuidv7()),
    draftInvoiceBody.parse({
      contactNumber,
      issueDate: '2026-03-01',
      buyerReference: 'KP-1',
      lines: [
        {
          description: 'Advieswerk',
          quantity: '1',
          unitPrice: options.amount ?? '100000',
          revenueAccountNumber: '8000',
          taxCode: 'H21',
        },
      ],
    }),
  )
  const invoiceId = (draft.body as { id: string }).id
  const issued = await handleIssueInvoice(
    await contextFor(uuidv7()),
    invoiceId,
    issueInvoiceBody.parse({}),
  )

  return {
    invoiceId,
    number: (issued.body as { number: string }).number,
    contactNumber,
  }
}

/** Import one line with a chosen amount and description. */
async function aTransaction(options: {
  amount: string
  description?: string
  counterparty?: string
  counterpartyIban?: string
  sequence: number
}): Promise<string> {
  const negative = options.amount.startsWith('-')
  const magnitude = negative ? options.amount.slice(1) : options.amount
  const mark = negative ? 'D' : 'C'
  const information =
    options.counterpartyIban === undefined && options.counterparty === undefined
      ? (options.description ?? '')
      : `/IBAN/${options.counterpartyIban ?? ''}/NAME/${options.counterparty ?? ''}/REMI/${options.description ?? ''}`

  const opening = 0
  const closing = negative
    ? -Number(magnitude.replace(',', '.'))
    : Number(magnitude.replace(',', '.'))
  const closingMark = closing < 0 ? 'D' : 'C'
  const closingAmount = Math.abs(closing).toFixed(2).replace('.', ',')

  const content = [
    `:20:STMT-${String(options.sequence)}`,
    `:25:${iban}`,
    `:28C:${String(options.sequence)}/1`,
    `:60F:C260401EUR${opening.toFixed(2).replace('.', ',')}`,
    `:61:2604020402${mark}${magnitude}NTRFNONREF//REF-${String(options.sequence)}-${randomUUID().slice(0, 8)}`,
    `:86:${information}`,
    `:62F:${closingMark}260402EUR${closingAmount}`,
    '-',
  ].join('\n')

  const before = await handleListBankTransactions(
    await contextFor(),
    transactionsQuery.parse({ bankAccountId, limit: 1000 }),
  )
  await handleImportStatement(
    await contextFor(uuidv7()),
    importStatementBody.parse({ bankAccountId, content }),
  )
  const after = await handleListBankTransactions(
    await contextFor(),
    transactionsQuery.parse({ bankAccountId, limit: 1000 }),
  )

  const known = new Set(before.body.transactions.map((item) => item.id))
  const added = after.body.transactions.find((item) => !known.has(item.id))
  if (added === undefined) throw new Error('The import added nothing.')
  return added.id
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)

  const entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)

  const issued = await issueToken(database, {
    entityId,
    name: 'matching-test',
    permissions: ['*'],
    actorKind: 'script',
    actorId: 'test',
  })
  token = issued.token

  iban = `NL${String(Date.now()).slice(-2)}TEST${String(Date.now()).slice(-10)}`
  const account = await handleCreateBankAccount(
    await contextFor(uuidv7()),
    createBankAccountBody.parse({ iban, name: 'Rekening-courant', ledgerAccountNumber: '1100' }),
  )
  bankAccountId = (account.body as { id: string }).id
  // Referenced so the fixture path is not dead weight if the helper changes.
  void readFileSync(join(FIXTURES, 'statement.mt940'), 'utf8')
}, 60_000)

afterAll(async () => {
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('suggesting a match', () => {
  it('finds the invoice a payment quotes, and says why', async () => {
    const invoice = await anInvoice()
    const transactionId = await aTransaction({
      amount: '1210,00',
      description: `Betaling factuur ${invoice.number}`,
      sequence: 101,
    })

    const result = await handleSuggestMatches(await contextFor(), transactionId)
    const [best] = result.body.suggestions

    expect(best?.strategy).toBe('reference')
    expect(best?.confidence).toBeGreaterThanOrEqual(95)
    expect(best?.reason).toContain(invoice.number)
    expect(best?.allocations).toEqual([
      { invoiceId: invoice.invoiceId, number: invoice.number, amount: '121000' },
    ])
  })

  it('suggests nothing for a line with nothing to go on', async () => {
    const transactionId = await aTransaction({
      amount: '-2,15',
      description: 'Kosten betalingsverkeer',
      sequence: 102,
    })

    const result = await handleSuggestMatches(await contextFor(), transactionId)
    expect(result.body.suggestions).toEqual([])
  })
})

describe('confirming a match', () => {
  it('posts the entry, allocates the invoice, and closes it', async () => {
    const invoice = await anInvoice()
    const transactionId = await aTransaction({
      amount: '1210,00',
      description: `Betaling factuur ${invoice.number}`,
      sequence: 110,
    })

    const confirmed = await handleConfirmMatch(
      await contextFor(uuidv7()),
      transactionId,
      confirmMatchBody.parse({
        allocations: [{ invoiceId: invoice.invoiceId, amount: '121000' }],
      }),
    )

    expect(confirmed.body).toMatchObject({ allocated: 1 })

    // The entry is a real journal entry, and it balances because
    // postJournalEntry would have refused it otherwise.
    const entry = await handleGetJournalEntry(
      await contextFor(),
      (confirmed.body as { journalEntryId: string }).journalEntryId,
    )
    const lines = (
      entry.body as { entry: { lines: { accountNumber: string; debit: string; credit: string }[] } }
    ).entry.lines
    expect(lines.find((line) => line.accountNumber === '1100')?.debit).toBe('121000')
    expect(lines.find((line) => line.accountNumber === '1300')?.credit).toBe('121000')

    // The line is booked.
    const list = await handleListBankTransactions(
      await contextFor(),
      transactionsQuery.parse({ bankAccountId, limit: 1000 }),
    )
    expect(list.body.transactions.find((item) => item.id === transactionId)?.status).toBe('matched')

    // And the invoice is no longer a candidate for anything, because it is paid.
    const again = await handleSuggestMatches(await contextFor(), transactionId)
    expect(
      again.body.suggestions.some((item) =>
        item.allocations.some((allocation) => allocation.invoiceId === invoice.invoiceId),
      ),
    ).toBe(false)
  })

  it('stops the invoice being chased, which is what M1 could not do', async () => {
    const invoice = await anInvoice()
    const transactionId = await aTransaction({
      amount: '1210,00',
      description: `factuur ${invoice.number}`,
      sequence: 111,
    })

    const before = await handleGetDunningQueue(await contextFor(), { asOf: '2026-06-01' })
    expect(before.body.actions.map((item) => item.number)).toContain(invoice.number)

    await handleConfirmMatch(
      await contextFor(uuidv7()),
      transactionId,
      confirmMatchBody.parse({
        allocations: [{ invoiceId: invoice.invoiceId, amount: '121000' }],
      }),
    )

    const after = await handleGetDunningQueue(await contextFor(), { asOf: '2026-06-01' })
    expect(after.body.actions.map((item) => item.number)).not.toContain(invoice.number)
  })

  it('leaves a partly paid invoice open for the rest', async () => {
    const invoice = await anInvoice()
    const transactionId = await aTransaction({
      amount: '500,00',
      description: `deelbetaling ${invoice.number}`,
      sequence: 112,
    })

    await handleConfirmMatch(
      await contextFor(uuidv7()),
      transactionId,
      confirmMatchBody.parse({
        allocations: [{ invoiceId: invoice.invoiceId, amount: '50000' }],
      }),
    )

    const second = await aTransaction({
      amount: '710,00',
      description: `rest ${invoice.number}`,
      sequence: 113,
    })
    const suggestions = await handleSuggestMatches(await contextFor(), second)
    const [best] = suggestions.body.suggestions

    // 710.00 is exactly what is left, so the reference layer is certain again.
    expect(best?.allocations[0]?.amount).toBe('71000')
    expect(best?.confidence).toBeGreaterThanOrEqual(95)
  })

  it('refuses to allocate more than is open', async () => {
    const invoice = await anInvoice()
    const transactionId = await aTransaction({ amount: '2000,00', sequence: 114 })

    await expect(
      handleConfirmMatch(
        await contextFor(uuidv7()),
        transactionId,
        confirmMatchBody.parse({
          allocations: [{ invoiceId: invoice.invoiceId, amount: '200000' }],
          accountNumber: '8000',
        }),
      ),
    ).rejects.toThrow(/open/)
  })

  it('refuses a remainder with nowhere to go', async () => {
    const invoice = await anInvoice()
    const transactionId = await aTransaction({ amount: '1500,00', sequence: 115 })

    await expect(
      handleConfirmMatch(
        await contextFor(uuidv7()),
        transactionId,
        confirmMatchBody.parse({
          allocations: [{ invoiceId: invoice.invoiceId, amount: '121000' }],
        }),
      ),
    ).rejects.toThrow(/not accounted for/)
  })

  it('will not book the same line twice', async () => {
    const transactionId = await aTransaction({ amount: '-45,50', sequence: 116 })

    await handleConfirmMatch(
      await contextFor(uuidv7()),
      transactionId,
      confirmMatchBody.parse({ accountNumber: '4000' }),
    )

    await expect(
      handleConfirmMatch(
        await contextFor(uuidv7()),
        transactionId,
        confirmMatchBody.parse({ accountNumber: '4000' }),
      ),
    ).rejects.toThrow(/already booked/)
  })
})

describe('the ledger still decides', () => {
  it('refuses an account that needs a dimension, like any other posting', async () => {
    // 4300 requires a VEHICLE dimension in this fixture. A bank match goes
    // through postJournalEntry like everything else (spec 9.1), so the
    // requirement applies here without banking knowing it exists.
    const transactionId = await aTransaction({ amount: '-30,00', sequence: 160 })

    await expect(
      handleConfirmMatch(
        await contextFor(uuidv7()),
        transactionId,
        confirmMatchBody.parse({ accountNumber: '4300' }),
      ),
    ).rejects.toThrow(/requires a VEHICLE dimension/)
  })

  it('refuses a blocked account', async () => {
    const transactionId = await aTransaction({ amount: '-31,00', sequence: 161 })

    await expect(
      handleConfirmMatch(
        await contextFor(uuidv7()),
        transactionId,
        confirmMatchBody.parse({ accountNumber: '9999' }),
      ),
    ).rejects.toThrow()
  })
})

describe('learning from a confirmation', () => {
  it('remembers the account for a counterparty, and suggests it next time', async () => {
    const counterpartyIban = 'NL20INGB0009998887'
    const first = await aTransaction({
      amount: '-45,50',
      counterparty: 'Telecom B.V.',
      counterpartyIban,
      description: 'Abonnement maart',
      sequence: 120,
    })

    const confirmed = await handleConfirmMatch(
      await contextFor(uuidv7()),
      first,
      confirmMatchBody.parse({ accountNumber: '4000' }),
    )
    expect(confirmed.body).toMatchObject({ learned: true })

    // The rule is listed, with what it matches on and how often it has fired.
    const rules = await handleListMatchRules(await contextFor())
    const rule = rules.body.rules.find((item) => item.counterpartyIban === counterpartyIban)
    expect(rule).toMatchObject({ source: 'learned', accountNumber: '4000', timesApplied: 1 })

    // Next month's direct debit gets the suggestion.
    const second = await aTransaction({
      amount: '-45,50',
      counterparty: 'Telecom B.V.',
      counterpartyIban,
      description: 'Abonnement april',
      sequence: 121,
    })
    const suggestions = await handleSuggestMatches(await contextFor(), second)
    const learned = suggestions.body.suggestions.find((item) => item.strategy === 'learned_rule')

    expect(learned?.accountNumber).toBe('4000')
    expect(learned?.reason).toContain('Eerder zo geboekt')
  })

  it('learns nothing from a payment that quoted its invoice number', async () => {
    // The next payment will quote its own number, so there is nothing to learn.
    const invoice = await anInvoice()
    const transactionId = await aTransaction({
      amount: '1210,00',
      counterparty: 'Grote Klant N.V.',
      counterpartyIban: 'NL91RABO0315273637',
      description: `factuur ${invoice.number}`,
      sequence: 122,
    })

    const confirmed = await handleConfirmMatch(
      await contextFor(uuidv7()),
      transactionId,
      confirmMatchBody.parse({
        allocations: [{ invoiceId: invoice.invoiceId, amount: '121000' }],
      }),
    )
    expect(confirmed.body).toMatchObject({ learned: false })
  })

  it('raises the confidence of a rule that keeps being right', async () => {
    const counterpartyIban = 'NL20INGB0007776665'
    for (const [index, month] of ['maart', 'april', 'mei'].entries()) {
      const transactionId = await aTransaction({
        amount: '-9,99',
        counterparty: 'Streaming B.V.',
        counterpartyIban,
        description: `Abonnement ${month}`,
        sequence: 130 + index,
      })
      await handleConfirmMatch(
        await contextFor(uuidv7()),
        transactionId,
        confirmMatchBody.parse({ accountNumber: '4000' }),
      )
    }

    const rules = await handleListMatchRules(await contextFor())
    const rule = rules.body.rules.find((item) => item.counterpartyIban === counterpartyIban)
    // Three confirmations, one rule. Not three rules.
    expect(rule?.timesApplied).toBe(3)
  })

  it('lets a rule be switched off, which is the editable half', async () => {
    const counterpartyIban = 'NL20INGB0005554443'
    const transactionId = await aTransaction({
      amount: '-1,00',
      counterparty: 'Onzin B.V.',
      counterpartyIban,
      description: 'Iets',
      sequence: 140,
    })
    await handleConfirmMatch(
      await contextFor(uuidv7()),
      transactionId,
      confirmMatchBody.parse({ accountNumber: '4000' }),
    )

    const rules = await handleListMatchRules(await contextFor())
    const ruleId = rules.body.rules.find((item) => item.counterpartyIban === counterpartyIban)?.id
    expect(ruleId).toBeDefined()

    await handleSetMatchRuleActive(await contextFor(), ruleId!, { isActive: false })

    const next = await aTransaction({
      amount: '-1,00',
      counterparty: 'Onzin B.V.',
      counterpartyIban,
      description: 'Iets',
      sequence: 141,
    })
    const suggestions = await handleSuggestMatches(await contextFor(), next)
    expect(suggestions.body.suggestions.some((item) => item.strategy === 'learned_rule')).toBe(
      false,
    )
  })
})

describe('ignoring a line', () => {
  it('takes it out of the queue without posting anything', async () => {
    const transactionId = await aTransaction({ amount: '-0,01', sequence: 150 })

    const ignored = await handleIgnoreTransaction(await contextFor(uuidv7()), transactionId)
    expect(ignored.body).toMatchObject({ status: 'ignored' })

    const list = await handleListBankTransactions(
      await contextFor(),
      transactionsQuery.parse({ bankAccountId, status: 'unmatched', limit: 1000 }),
    )
    expect(list.body.transactions.map((item) => item.id)).not.toContain(transactionId)
  })

  it('refuses to ignore something already booked', async () => {
    const transactionId = await aTransaction({ amount: '-3,00', sequence: 151 })
    await handleConfirmMatch(
      await contextFor(uuidv7()),
      transactionId,
      confirmMatchBody.parse({ accountNumber: '4000' }),
    )

    await expect(
      handleIgnoreTransaction(await contextFor(uuidv7()), transactionId),
    ).rejects.toThrow(ApiError)
  })
})
