import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { ApiError } from '../src/api/errors.js'
import {
  handleCreateBankAccount,
  handleImportStatement,
  handleListBankAccounts,
  handleListBankTransactions,
} from '../src/api/handlers/bank.js'
import {
  createBankAccountBody,
  importStatementBody,
  transactionsQuery,
} from '../src/api/schemas.js'

/**
 * Statement import against a real database.
 *
 * The core tests cover the two formats and the planning. What this covers is
 * the part that needs Postgres: **importing the same file twice adds nothing
 * the second time.** That is the unique index doing the work rather than a
 * lookup, and it is the difference between a bank balance you can trust and one
 * that doubles every time somebody clicks the button again.
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
const read = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

let database: Database
let token: string

const request = (idempotencyKey?: string): Request => {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/api/v1/bank-statements', { headers })
}

const contextFor = async (idempotencyKey?: string) =>
  resolveRequestContext({ database, request: request(idempotencyKey) })

async function anAccount(iban = 'NL02ABNA0123456789'): Promise<string> {
  const created = await handleCreateBankAccount(
    await contextFor(uuidv7()),
    createBankAccountBody.parse({ iban, name: 'Rekening-courant', ledgerAccountNumber: '1100' }),
  )
  return (created.body as { id: string }).id
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)

  const entityId = await seedEntity(database)
  const issued = await issueToken(database, {
    entityId,
    name: 'bank-test',
    permissions: ['*'],
    actorKind: 'script',
    actorId: 'test',
  })
  token = issued.token
}, 60_000)

afterAll(async () => {
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('recording a bank account', () => {
  it('links it to the ledger account it posts to', async () => {
    const id = await anAccount(`NL02ABNA${String(Date.now()).slice(-10)}`)
    const list = await handleListBankAccounts(await contextFor())
    const account = list.body.accounts.find((item) => item.id === id)

    expect(account?.ledgerAccountNumber).toBe('1100')
    expect(account?.feedProvider).toBe('file')
    // No feed, so no consent to expire. Not "active" — there is nothing there.
    expect(account?.consentState).toBe('not_required')
  })

  it('refuses a ledger account that is not in the chart', async () => {
    const failed = await handleCreateBankAccount(
      await contextFor(uuidv7()),
      createBankAccountBody.parse({
        iban: 'NL99BANK0000000001',
        name: 'X',
        ledgerAccountNumber: '9998',
      }),
    ).catch((error: unknown) => error)

    expect(failed).toBeInstanceOf(ApiError)
    expect((failed as ApiError).violations[0]).toMatchObject({
      code: 'unknown_account',
      path: 'ledgerAccountNumber',
    })
  })
})

describe('importing a statement', () => {
  it('says what it would do before doing it', async () => {
    const bankAccountId = await anAccount('NL02ABNA0123456789')

    const dry = await handleImportStatement(
      await contextFor(),
      importStatementBody.parse({ bankAccountId, content: read('statement.mt940'), dryRun: true }),
    )

    expect(dry.body).toMatchObject({
      dryRun: true,
      statements: 2,
      entries: 4,
      newEntries: 4,
      duplicates: 0,
      format: 'mt940',
    })
    expect(dry.body).toMatchObject({ period: { from: '2026-03-01', to: '2026-03-05' } })

    // And wrote nothing.
    const after = await handleListBankTransactions(
      await contextFor(),
      transactionsQuery.parse({ bankAccountId }),
    )
    expect(after.body.transactions).toEqual([])
  })

  it('imports the entries, signed so positive is money in', async () => {
    const bankAccountId = await anAccount('NL02ABNA0000000002')
    const content = read('statement.mt940').replace(/NL02ABNA0123456789/g, 'NL02ABNA0000000002')

    const result = await handleImportStatement(
      await contextFor(uuidv7()),
      importStatementBody.parse({ bankAccountId, content }),
    )

    expect(result.status).toBe(201)
    expect(result.body).toMatchObject({ imported: 4, duplicates: 0, statements: 2 })
    expect(result.body).toMatchObject({ openingBalance: '125000', closingBalance: '291235' })

    const list = await handleListBankTransactions(
      await contextFor(),
      transactionsQuery.parse({ bankAccountId }),
    )
    expect(list.body.transactions.map((item) => item.amount)).toEqual([
      '-215',
      '50000',
      '-4550',
      '121000',
    ])
    expect(list.body.transactions.every((item) => item.status === 'unmatched')).toBe(true)
  })

  it('adds nothing the second time, which is the whole point', async () => {
    const bankAccountId = await anAccount('NL02ABNA0000000003')
    const content = read('statement.mt940').replace(/NL02ABNA0123456789/g, 'NL02ABNA0000000003')

    await handleImportStatement(
      await contextFor(uuidv7()),
      importStatementBody.parse({ bankAccountId, content }),
    )
    const again = await handleImportStatement(
      await contextFor(uuidv7()),
      importStatementBody.parse({ bankAccountId, content }),
    )

    expect(again.body).toMatchObject({ imported: 0, duplicates: 4 })

    const list = await handleListBankTransactions(
      await contextFor(),
      transactionsQuery.parse({ bankAccountId, limit: 1000 }),
    )
    expect(list.body.transactions).toHaveLength(4)
  })

  it('imports the same statement from either format and gets the same rows', async () => {
    const fromMt940 = await anAccount('NL02ABNA0000000004')
    const fromCamt = await anAccount('NL02ABNA0000000005')

    await handleImportStatement(
      await contextFor(uuidv7()),
      importStatementBody.parse({
        bankAccountId: fromMt940,
        content: read('statement.mt940')
          .split(/^\s*-\s*$/m)[0]!
          .replace(/NL02ABNA0123456789/g, 'NL02ABNA0000000004'),
      }),
    )
    await handleImportStatement(
      await contextFor(uuidv7()),
      importStatementBody.parse({
        bankAccountId: fromCamt,
        content: read('statement.camt.xml').replace(/NL02ABNA0123456789/g, 'NL02ABNA0000000005'),
      }),
    )

    const comparable = async (bankAccountId: string) => {
      const list = await handleListBankTransactions(
        await contextFor(),
        transactionsQuery.parse({ bankAccountId }),
      )
      return list.body.transactions.map((item) => ({
        amount: item.amount,
        bookingDate: item.bookingDate,
        counterpartyName: item.counterpartyName,
        counterpartyIban: item.counterpartyIban,
        endToEndId: item.endToEndId,
      }))
    }

    // Spec 7.4's requirement, checked at the far end of the pipeline rather
    // than only at the parser.
    expect(await comparable(fromCamt)).toEqual(await comparable(fromMt940))
  })

  it('refuses a file for a different account', async () => {
    const bankAccountId = await anAccount('NL02ABNA0000000006')

    const failed = await handleImportStatement(
      await contextFor(uuidv7()),
      importStatementBody.parse({ bankAccountId, content: read('statement.mt940') }),
    ).catch((error: unknown) => error)

    expect(failed).toBeInstanceOf(ApiError)
    const violations = (failed as ApiError).violations
    // One per statement in the file, each naming the account it is really for.
    expect(violations.map((item) => item.code)).toEqual(['account_mismatch', 'account_mismatch'])
    expect(violations[0]?.message).toContain('is for NL02ABNA0123456789')
  })

  it('refuses a truncated file rather than importing a wrong balance', async () => {
    const bankAccountId = await anAccount('NL02ABNA0000000007')
    const content = read('statement.mt940')
      .replace(/NL02ABNA0123456789/g, 'NL02ABNA0000000007')
      // Drop a line, leaving the closing balance unreachable.
      .replace(/:61:2603030303D45,50[^\n]*\n:86:[^\n]*\n/, '')

    await expect(
      handleImportStatement(
        await contextFor(uuidv7()),
        importStatementBody.parse({ bankAccountId, content }),
      ),
    ).rejects.toThrow(/does not add up/)
  })

  it('warns about a gap without refusing the file', async () => {
    const bankAccountId = await anAccount('NL02ABNA0000000008')
    const content = read('statement.mt940').replace(/NL02ABNA0123456789/g, 'NL02ABNA0000000008')

    // Import statement 42 first, which sets the account's high-water mark, then
    // a file that starts at 41 — no gap. Instead, jump ahead.
    await handleImportStatement(
      await contextFor(uuidv7()),
      importStatementBody.parse({ bankAccountId, content }),
    )

    const ahead = content
      .replace(':28C:41/1', ':28C:60/1')
      .replace(':28C:42/1', ':28C:61/1')
      .replace(/:20:STMT-2026-041/, ':20:STMT-2026-060')
      .replace(/:20:STMT-2026-042/, ':20:STMT-2026-061')

    const result = await handleImportStatement(
      await contextFor(uuidv7()),
      importStatementBody.parse({ bankAccountId, content: ahead }),
    )

    expect(result.status).toBe(201)
    const gap = result.body.problems.find((problem) => problem.code === 'sequence_gap')
    expect(gap?.message).toContain('43 to 59')
  })

  it('refuses a file that is neither format', async () => {
    const bankAccountId = await anAccount('NL02ABNA0000000009')
    await expect(
      handleImportStatement(
        await contextFor(uuidv7()),
        importStatementBody.parse({ bankAccountId, content: 'datum;bedrag\n2026-01-01;10' }),
      ),
    ).rejects.toThrow(/Not recognisable/)
  })

  it('needs an idempotency key to write, but not to look', async () => {
    const bankAccountId = await anAccount('NL02ABNA0000000010')
    const content = read('statement.mt940').replace(/NL02ABNA0123456789/g, 'NL02ABNA0000000010')

    await expect(
      handleImportStatement(
        await contextFor(),
        importStatementBody.parse({ bankAccountId, content }),
      ),
    ).rejects.toThrow(ApiError)

    // A dry run is a read in everything but its verb.
    const dry = await handleImportStatement(
      await contextFor(),
      importStatementBody.parse({ bankAccountId, content, dryRun: true }),
    )
    expect(dry.body).toMatchObject({ dryRun: true })
  })
})

describe('the reconciliation position', () => {
  it('reports the statement balance and what is still unmatched', async () => {
    const bankAccountId = await anAccount('NL02ABNA0000000011')
    const content = read('statement.mt940').replace(/NL02ABNA0123456789/g, 'NL02ABNA0000000011')
    await handleImportStatement(
      await contextFor(uuidv7()),
      importStatementBody.parse({ bankAccountId, content }),
    )

    const list = await handleListBankAccounts(await contextFor())
    const account = list.body.accounts.find((item) => item.id === bankAccountId)

    expect(account?.reconciliation).toMatchObject({
      statementBalance: '291235',
      statementDate: '2026-03-05',
      unmatchedCount: 4,
    })
    // Nothing is matched yet, so everything the bank says is still to be booked.
    expect(account?.reconciliation.unmatchedTotal).toBe('166235')
  })
})
