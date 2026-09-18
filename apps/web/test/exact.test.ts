import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  closeDatabase,
  createDatabase,
  issueToken,
  runMigrations,
  withExactConnection,
  type Database,
} from '@klopt/db'
import { withLedger, withReporting, withSales, withSalesRead } from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { ApiError } from '../src/api/errors.js'
import { setDatabaseForTest } from '../src/api/database.js'
import {
  handleChooseExactDivision,
  handleCompleteExactConnection,
  handleConnectExact,
  handleDisconnectExact,
  handleGetExactConnection,
  handleRunExactImport,
  handleListExactDivisions,
  handlePreviewExactImport,
} from '../src/api/handlers/exact.js'
import { handleListAuditLog } from '../src/api/handlers/audit.js'
import {
  auditLogQuery,
  chooseExactDivisionBody,
  completeExactBody,
  connectExactBody,
  exactPreviewQuery,
  runExactImportBody,
} from '../src/api/schemas.js'
import { fakeExact, type FakeExact } from './support/exact-online.js'

/**
 * Connecting to Exact Online and previewing an import, against a real database
 * and a fake Exact (spec 13).
 *
 * `globalThis.fetch` is replaced rather than a client being injected, so the
 * handlers run exactly as they do in production — including the token
 * rotation, which is the part with a hazard in it. What the fake returns is
 * shaped the way Exact's own reference documentation says its rows are shaped:
 * `{ d: { results: [...] } }`, `Edm.Double` amounts, relation codes padded to
 * eighteen characters.
 *
 * The claims worth checking here are the ones a unit test cannot reach:
 *
 * - A rotated refresh token is stored, so the *next* request works.
 * - A callback whose `state` does not match is refused, and a matching one
 *   cannot be replayed.
 * - Choosing a division is checked against what Exact offers, and what was
 *   chosen lands in the audit log by name.
 * - The dry run reconciles, and writes nothing to the ledger.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
const realFetch = globalThis.fetch

function request(token: string, idempotencyKey?: string): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/x', { headers })
}

const context = (token: string, key?: string) =>
  resolveRequestContext({ database, request: request(token, key) })

async function newEntity() {
  const entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)
  const { token } = await issueToken(database, {
    entityId,
    name: 'exact-test',
    permissions: ['*'],
    actorKind: 'human',
    actorId: `human-${entityId.slice(0, 8)}`,
  })
  return { entityId, token }
}

const APP = {
  baseUrl: 'https://start.exactonline.nl',
  clientId: 'the-client-id',
  clientSecret: 'the-client-secret',
  redirectUri: 'https://klopt.test/exact/callback',
}

/** Connect, and answer the callback, so the tests below start connected. */
async function connect(token: string, exact: FakeExact) {
  const connected = await handleConnectExact(
    await context(token, `connect-${crypto.randomUUID()}`),
    connectExactBody.parse(APP),
  )

  const state = new URL(connected.body.authorizeUrl).searchParams.get('state')

  await handleCompleteExactConnection(
    await context(token, `complete-${crypto.randomUUID()}`),
    completeExactBody.parse({ code: 'the-code', state: state ?? '' }),
  )

  return { state, issued: exact.issued }
}

beforeAll(async () => {
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  await runMigrations(DATABASE_URL)
  setDatabaseForTest(database)
})

afterEach(() => {
  globalThis.fetch = realFetch
})

afterAll(async () => {
  // Take away the fixtures that would otherwise keep the worker busy.
  await cleanupSeededBackgroundWork(database)
  globalThis.fetch = realFetch
  await closeDatabase(database)
})

describe('connecting', () => {
  it('refuses a plain-http redirect, because Exact will not register one', () => {
    // Refused here rather than at Exact's App Center, where the error is
    // somebody else's and does not name the fix.
    const refused = connectExactBody.safeParse({
      ...APP,
      redirectUri: 'http://localhost:3000/exact/callback',
    })

    expect(refused.success).toBe(false)
    expect(JSON.stringify(refused.error?.issues)).toContain('pnpm dev:https')
  })

  it('refuses a client secret it cannot encrypt, rather than storing it as typed', async () => {
    // A client secret in a database dump is discovered by somebody else, later.
    // Spec 14: never in the database in plaintext.
    fakeExact()
    const { token } = await newEntity()
    const key = process.env['KLOPT_ENCRYPTION_KEY']
    delete process.env['KLOPT_ENCRYPTION_KEY']

    try {
      await expect(
        handleConnectExact(await context(token, 'connect-nokey'), connectExactBody.parse(APP)),
      ).rejects.toMatchObject({ code: 'validation_failed' })

      // And nothing was written, so there is no half-connection to explain.
      const result = await handleGetExactConnection(await context(token))
      expect(result.body).toMatchObject({ connection: null, canStoreSecrets: false })
    } finally {
      process.env['KLOPT_ENCRYPTION_KEY'] = key
    }
  })

  it('answers with nothing at all before anybody has connected', async () => {
    const { token } = await newEntity()
    const result = await handleGetExactConnection(await context(token))

    expect(result.body).toMatchObject({ connection: null, canStoreSecrets: true })
  })

  it('hands back an authorize URL carrying a state nobody could guess', async () => {
    const exact = fakeExact()
    const { token } = await newEntity()

    const result = await handleConnectExact(
      await context(token, 'connect-1'),
      connectExactBody.parse(APP),
    )

    const url = new URL(result.body.authorizeUrl)
    expect(url.host).toBe('start.exactonline.nl')
    expect(url.searchParams.get('client_id')).toBe(APP.clientId)
    expect(url.searchParams.get('state')?.length).toBeGreaterThan(20)
    // Nothing has been asked of Exact yet: the consent happens in the browser.
    expect(exact.asked).toEqual([])
  })

  it('never returns the client secret, whatever it is asked', async () => {
    fakeExact()
    const { token } = await newEntity()
    await handleConnectExact(await context(token, 'connect-2'), connectExactBody.parse(APP))

    const result = await handleGetExactConnection(await context(token))
    expect(JSON.stringify(result.body)).not.toContain(APP.clientSecret)
  })

  it('refuses a callback whose state does not match the attempt', async () => {
    // Without this the callback will act on a code somebody else obtained.
    fakeExact()
    const { token } = await newEntity()
    await handleConnectExact(await context(token, 'connect-3'), connectExactBody.parse(APP))

    await expect(
      handleCompleteExactConnection(
        await context(token, 'complete-3'),
        completeExactBody.parse({ code: 'the-code', state: 'not-the-state' }),
      ),
    ).rejects.toThrow(/does not match/)
  })

  it('refuses the same callback twice, because the nonce is spent', async () => {
    const exact = fakeExact()
    const { token } = await newEntity()
    const { state } = await connect(token, exact)

    await expect(
      handleCompleteExactConnection(
        await context(token, 'complete-again'),
        completeExactBody.parse({ code: 'the-code', state: state ?? '' }),
      ),
    ).rejects.toThrow(/does not match/)
  })

  it('names the Exact user on the connection, so a screen can say whose it is', async () => {
    const exact = fakeExact()
    const { token } = await newEntity()
    await connect(token, exact)

    const result = await handleGetExactConnection(await context(token))
    expect(result.body).toMatchObject({
      connection: { connected: true, userName: 'H. Stokvis', ready: false },
    })
  })
})

describe('the token pair', () => {
  it('stores the rotated refresh token, so the next request still works', async () => {
    // Exact kills the old refresh token the instant it issues a new one. If the
    // rotation is not written down, this second call is the one that breaks —
    // which is the whole hazard, and why it is a request rather than an
    // assertion about a single call.
    const exact = fakeExact()
    const { token, entityId } = await newEntity()
    await connect(token, exact)

    // Force the stored access token to look expired, so the next call refreshes.
    await withExactConnection(database, (repository) =>
      repository.storeTokens({
        entityId,
        accessToken: exact.issued[exact.issued.length - 1]!.accessToken,
        refreshToken: exact.issued[exact.issued.length - 1]!.refreshToken,
        expiresAt: '1970-01-01T00:00:00.000Z',
      }),
    )

    const first = await handleListExactDivisions(await context(token))
    expect((first.body as { divisions: unknown[] }).divisions).toHaveLength(3)

    // And again. This is the call that fails if the rotation was not persisted.
    const second = await handleListExactDivisions(await context(token))
    expect((second.body as { divisions: unknown[] }).divisions).toHaveLength(3)
  })

  it('says re-authorising is the only way out when Exact revokes the app', async () => {
    const exact = fakeExact()
    const { token, entityId } = await newEntity()
    await connect(token, exact)

    exact.revoked = true
    await withExactConnection(database, (repository) =>
      repository.storeTokens({
        entityId,
        accessToken: 'stale',
        refreshToken: 'stale',
        expiresAt: '1970-01-01T00:00:00.000Z',
      }),
    )

    await expect(handleListExactDivisions(await context(token))).rejects.toThrow(
      /no longer accepts this connection/,
    )

    // And the reason is on the row, so the screen says it without asking again.
    const result = await handleGetExactConnection(await context(token))
    expect((result.body as { connection: { lastError: string } }).connection.lastError).toContain(
      'no longer valid',
    )
  })
})

describe('choosing an administration', () => {
  it('offers every administration this login reaches, ordinary ones first', async () => {
    // The user this was built for has test and production administrations under
    // one login. A practice division at the top of the list is a trap.
    const exact = fakeExact()
    const { token } = await newEntity()
    await connect(token, exact)

    const result = await handleListExactDivisions(await context(token))
    const divisions = (
      result.body as { divisions: readonly { code: number; cautions: readonly string[] }[] }
    ).divisions

    expect(divisions.map((division) => division.code)).toEqual([1000, 2000, 3000])
    expect(divisions[0]?.cautions).toEqual([])
    expect(divisions[1]?.cautions).toEqual(['practice'])
    expect(divisions[2]?.cautions).toEqual(['archived'])
  })

  it('records the choice, and what was odd about it at the time', async () => {
    const exact = fakeExact()
    const { token } = await newEntity()
    await connect(token, exact)

    const chosen = await handleChooseExactDivision(
      await context(token, 'choose-1'),
      chooseExactDivisionBody.parse({ divisionCode: 2000 }),
    )

    expect(chosen.body).toMatchObject({
      divisionCode: 2000,
      divisionName: 'Aardig Testje',
      cautions: ['practice'],
    })

    const connection = await handleGetExactConnection(await context(token))
    expect(connection.body).toMatchObject({
      connection: { divisionCode: 2000, divisionCautions: ['practice'], ready: true },
    })
  })

  it('puts the division in the audit log by name, not by position in a list', async () => {
    // "Somebody picked the test administration" is the question this entry
    // exists to answer six months later.
    const exact = fakeExact()
    const { token } = await newEntity()
    await connect(token, exact)
    await handleChooseExactDivision(
      await context(token, 'choose-2'),
      chooseExactDivisionBody.parse({ divisionCode: 2000 }),
    )

    const log = await handleListAuditLog(await context(token), auditLogQuery.parse({}))
    const entry = (
      log.body as { entries: readonly { action: string; after: Record<string, string> | null }[] }
    ).entries.find((row) => row.action === 'exact.chooseDivision')

    expect(entry?.after).toMatchObject({
      divisionCode: '2000',
      divisionName: 'Aardig Testje',
      cautions: 'practice',
    })
  })

  it('refuses a division this login cannot reach', async () => {
    // A number in a request body is not evidence of a right to that division.
    const exact = fakeExact()
    const { token } = await newEntity()
    await connect(token, exact)

    await expect(
      handleChooseExactDivision(
        await context(token, 'choose-3'),
        chooseExactDivisionBody.parse({ divisionCode: 9999 }),
      ),
    ).rejects.toThrow(/cannot reach administration 9999/)
  })

  it('refuses to preview before an administration has been chosen', async () => {
    const exact = fakeExact()
    const { token } = await newEntity()
    await connect(token, exact)

    await expect(
      handlePreviewExactImport(await context(token), exactPreviewQuery.parse({ year: '2026' })),
    ).rejects.toThrow(/No Exact administration has been chosen/)
  })

  it('refuses to preview a division the login has since lost', async () => {
    const exact = fakeExact()
    const { token } = await newEntity()
    await connect(token, exact)
    await handleChooseExactDivision(
      await context(token, 'choose-4'),
      chooseExactDivisionBody.parse({ divisionCode: 1000 }),
    )

    // The rights changed. Importing whatever this login can reach now would be
    // importing a different administration than the one that was approved.
    exact.divisions = exact.divisions.filter((division) => division['Code'] !== 1000)

    await expect(
      handlePreviewExactImport(await context(token), exactPreviewQuery.parse({ year: '2026' })),
    ).rejects.toThrow(/can no longer reach administration 1000/)
  })
})

describe('the dry run', () => {
  async function ready() {
    const exact = fakeExact()
    const { token, entityId } = await newEntity()
    await connect(token, exact)
    await handleChooseExactDivision(
      await context(token, `choose-${crypto.randomUUID()}`),
      chooseExactDivisionBody.parse({ divisionCode: 1000 }),
    )
    return { exact, token, entityId }
  }

  /**
   * The failure a real connection produced: 403 on `financial/ReportingBalance`
   * while `vat/VATCodes` — the same documented scope — answered 200. It used to
   * end the whole import with a 409 and Exact's raw JSON.
   */
  it('imports an administration whose trial balance it may not read', async () => {
    const { exact, token } = await ready()
    exact.forbidden.add('financial/ReportingBalance')

    const preview = await handlePreviewExactImport(
      await context(token),
      exactPreviewQuery.parse({ year: '2026' }),
    )

    expect(preview.status).toBe(200)

    // Nothing blocking: the trial balance was never a source of rows.
    expect(preview.body.problems).toEqual([])
    expect(preview.body.accounts.count).toBeGreaterThan(0)
    expect(preview.body.contacts.count).toBeGreaterThan(0)

    // And the report says why it cannot vouch for it, in terms of rights.
    const refusal = preview.body.warnings.find((warning) => warning.code === 'resource_unreadable')
    expect(refusal?.message).toContain('financial/ReportingBalance')
    expect(refusal?.message).toContain('rights')
  })

  it('reports an unread trial balance as unread, not as balanced', async () => {
    // The trap: an empty trial balance has debit equal to credit, so degrading
    // by substituting one would report a division as reconciled without having
    // looked — and would report every open item as a difference against a
    // control account of zero, which reads as an accusation about their books.
    const { exact, token } = await ready()
    exact.forbidden.add('financial/ReportingBalance')

    const preview = await handlePreviewExactImport(
      await context(token),
      exactPreviewQuery.parse({ year: '2026' }),
    )

    expect(preview.body).toMatchObject({
      reconciliation: {
        source: 'unreadable',
        balanced: null,
        totalDebit: null,
        totalCredit: null,
        receivable: { outcome: 'not_reconciled', ledger: null, difference: null },
        payable: { outcome: 'not_reconciled', ledger: null, difference: null },
      },
    })

    // The open items are still counted — a different resource answered them.
    expect(preview.body).toMatchObject({
      reconciliation: { receivable: { openItems: '1210.00' } },
    })
  })

  it('names the row it could not read, rather than answering “could not be completed”', async () => {
    /**
     * The reported symptom was two unrelated-looking messages for one failure:
     * "Id is not a GUID" recorded on the connection, and a bare
     * "The request could not be completed." on the screen. `ExactReadError`
     * was not mapped, so it fell through to the generic 500 — which
     * deliberately hides its message, because a 500's message can carry a
     * connection string.
     *
     * It is our defect either way, so it stays loud; it just has to say which
     * field, what was there, and how far the read got.
     */
    const { exact, token } = await ready()
    exact.malformed = true

    const failure = await handlePreviewExactImport(
      await context(token),
      exactPreviewQuery.parse({ year: '2026' }),
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiError)
    const error = failure as ApiError
    expect(error.code).toBe('conflict')
    expect(error.message).toContain('could not read')
    // Which field, and what was in it.
    expect(error.message).toContain('ID is not a GUID')
    expect(error.message).toContain('nonsense')
    // And which resource it died on, so a reader is not left guessing whether
    // it started at all.
    expect(error.message).toContain('bulk/Financial/GLAccounts')
  })

  it('clears the last error once a read works', async () => {
    /**
     * `lastError` was written by `recordFailure` and cleared by `recordImport`,
     * which nothing called. So the first failure a connection ever had stayed
     * on the screen for good — reported as "it now works although it still
     * shows Id is not a GUID".
     *
     * A panel that is always red is a panel nobody reads.
     */
    const { exact, token } = await ready()

    exact.malformed = true
    await expect(
      handlePreviewExactImport(await context(token), exactPreviewQuery.parse({ year: '2026' })),
    ).rejects.toThrow()

    const failed = await handleGetExactConnection(await context(token))
    expect(failed.body.connection?.lastError).toContain('ID is not a GUID')

    exact.malformed = false
    await handlePreviewExactImport(await context(token), exactPreviewQuery.parse({ year: '2026' }))

    const recovered = await handleGetExactConnection(await context(token))
    expect(recovered.body.connection?.lastError).toBeNull()
  })

  it('keeps the connection green when only one resource is refused', async () => {
    // The connection is fine; the refusal is a fact about one resource and
    // belongs in the report's warnings, not in the connection's error panel.
    const { exact, token } = await ready()
    exact.forbidden.add('financial/ReportingBalance')

    await handlePreviewExactImport(await context(token), exactPreviewQuery.parse({ year: '2026' }))

    const connection = await handleGetExactConnection(await context(token))
    expect(connection.body.connection?.lastError).toBeNull()
  })

  it('reconciles the open items against Exact’s own control accounts', async () => {
    const { token } = await ready()

    const result = await handlePreviewExactImport(
      await context(token),
      exactPreviewQuery.parse({ year: '2026' }),
    )

    expect(result.body).toMatchObject({
      dryRun: true,
      reconciliation: {
        year: 2026,
        balanced: true,
        totalDebit: '1815.00',
        totalCredit: '1815.00',
        receivable: {
          accountCodes: ['1300'],
          ledger: '1210.00',
          openItems: '1210.00',
          outcome: 'matches',
        },
        payable: {
          accountCodes: ['1600'],
          ledger: '605.00',
          openItems: '605.00',
          outcome: 'matches',
        },
      },
      problems: [],
    })
  })

  it('preserves the original invoice numbers, which dunning depends on', async () => {
    const { token } = await ready()
    const result = await handlePreviewExactImport(
      await context(token),
      exactPreviewQuery.parse({ year: '2026' }),
    )

    const sample = (result.body as { openItems: { sample: readonly { documentNumber: string }[] } })
      .openItems.sample

    expect(sample.map((item) => item.documentNumber).sort()).toEqual(['20260001', '700045'])
  })

  it('counts what is new against what these books already have', async () => {
    const { token } = await ready()
    const result = await handlePreviewExactImport(
      await context(token),
      exactPreviewQuery.parse({ year: '2026' }),
    )

    const body = result.body as {
      accounts: { count: number; new: number }
      contacts: { count: number; new: number; customers: number; suppliers: number }
    }

    // The seeded chart has its own accounts; Exact's five are all new here.
    expect(body.accounts.count).toBe(5)
    expect(body.contacts).toMatchObject({ count: 2, new: 2, customers: 1, suppliers: 1 })
  })

  it('records every request it made, so a slow import says where the time went', async () => {
    const { token } = await ready()
    const result = await handlePreviewExactImport(
      await context(token),
      exactPreviewQuery.parse({ year: '2026' }),
    )

    const requests = (result.body as { requests: readonly { path: string }[] }).requests
    expect(requests.map((entry) => entry.path)).toContain('financial/ReportingBalance')
    expect(requests.map((entry) => entry.path)).toContain('read/financial/PayablesList')
  })

  it('does not read the document archive unless it is asked to', async () => {
    // A division with ten years of scans has tens of thousands of rows, and the
    // reconciliation does not need one of them.
    const { exact, token } = await ready()
    await handlePreviewExactImport(await context(token), exactPreviewQuery.parse({ year: '2026' }))

    expect(exact.asked.some((url) => url.includes('bulk/Documents/Documents'))).toBe(false)
  })

  it('writes nothing to the ledger', async () => {
    const { entityId, token } = await ready()
    await handlePreviewExactImport(await context(token), exactPreviewQuery.parse({ year: '2026' }))

    const [row] = await database.execute<{ count: string }>(
      `select count(*)::text as count from klopt.journal_entries where entity_id = '${entityId}'`,
    )
    expect(row?.count).toBe('0')
  })
})

describe('disconnecting', () => {
  it('forgets the connection and leaves the books alone', async () => {
    const exact = fakeExact()
    const { token } = await newEntity()
    await connect(token, exact)

    await handleDisconnectExact(await context(token, 'disconnect-1'))

    const result = await handleGetExactConnection(await context(token))
    expect(result.body).toMatchObject({ connection: null })
  })

  it('refuses to preview once disconnected, rather than using a stale token', async () => {
    const exact = fakeExact()
    const { token } = await newEntity()
    await connect(token, exact)
    await handleDisconnectExact(await context(token, 'disconnect-2'))

    await expect(
      handlePreviewExactImport(await context(token), exactPreviewQuery.parse({ year: '2026' })),
    ).rejects.toThrow(/not connected to Exact Online/)
  })
})

describe('the import itself', () => {
  async function ready() {
    const exact = fakeExact()
    const { token, entityId } = await newEntity()
    await connect(token, exact)
    await handleChooseExactDivision(
      await context(token, `choose-${crypto.randomUUID()}`),
      chooseExactDivisionBody.parse({ divisionCode: 1000 }),
    )
    return { exact, token, entityId }
  }

  const request = (overrides: Record<string, unknown> = {}) =>
    runExactImportBody.parse({
      year: 2026,
      openingDate: '2026-01-01',
      journalCode: 'MEM',
      receivableAccount: '1300',
      payableAccount: '1600',
      openingBalanceAccount: '0500',
      ...overrides,
    })

  it('brings the chart, the relations and the open items across', async () => {
    const { token, entityId } = await ready()

    const result = await handleRunExactImport(
      await context(token, `import-${crypto.randomUUID()}`),
      request(),
    )

    expect(result.status).toBe(201)
    expect(result.body.contactsCreated).toBeGreaterThan(0)
    expect(result.body.openItemsImported).toBe(2)
    expect(result.body.receivableCount).toBe(1)
    expect(result.body.payableCount).toBe(1)
    expect(result.body.openingEntryId).not.toBeNull()

    // The open items are documents as well as a balance: the ageing reads the
    // invoice tables, and dunning quotes the number the customer knows.
    const invoices = await withSalesRead(database, (repository) =>
      repository.listInvoices({ entityId, status: 'issued', limit: 50 }),
    )
    expect(invoices.map((invoice) => invoice.number)).toEqual(['20260001'])
  })

  it('keeps Exact’s own invoice numbers rather than allocating ours', async () => {
    /**
     * Our number series is a legal claim about invoices *we* issued, and it has
     * to be gapless. Running an import through the issuing path would spend
     * numbers out of it on another system's history — so the imported invoice
     * keeps Exact's number and the counter is untouched.
     */
    const { token, entityId } = await ready()

    await handleRunExactImport(await context(token, `import-${crypto.randomUUID()}`), request())

    const next = await withSales(database, ({ sales }) =>
      sales.allocateInvoiceNumber(entityId, '2026', ''),
    )
    // The first number of the year, not the fourth: nothing was taken.
    expect(next).toBe('2026-0001')
  })

  it('posts one opening entry that balances, with a line per open item', async () => {
    const { token, entityId } = await ready()

    const result = await handleRunExactImport(
      await context(token, `import-${crypto.randomUUID()}`),
      request(),
    )

    const entry = await withLedger(database, (repository) =>
      repository.findEntryById(entityId, String(result.body.openingEntryId)),
    )

    // Two open items plus the counter-line.
    expect(entry?.lines).toHaveLength(3)

    const debit = (entry?.lines ?? []).reduce((sum, line) => sum + line.debit, 0n)
    const credit = (entry?.lines ?? []).reduce((sum, line) => sum + line.credit, 0n)
    expect(debit).toBe(credit)

    // Debtors on 1300, creditors on 1600, and the difference on the account the
    // caller chose — never one this code picked.
    const on = (number: string) =>
      (entry?.lines ?? []).filter((line) => line.accountNumber === number)
    expect(on('1300')).toHaveLength(1)
    expect(on('1600')).toHaveLength(1)
    expect(on('0500')).toHaveLength(1)
  })

  it('lands the open items on the control accounts the ageing reads', async () => {
    // The point of importing both a document and a balance: if these disagree,
    // the ageing is empty while 1300 says three thousand, or the reverse.
    const { token, entityId } = await ready()

    await handleRunExactImport(await context(token, `import-${crypto.randomUUID()}`), request())

    const rows = await withReporting(database, (repository) =>
      repository.trialBalanceRows({
        entityId,
        fiscalYearCode: '2026',
        fromPeriod: 1,
        toPeriod: 12,
        currency: 'EUR',
      }),
    )
    const debtors = rows.find((row) => row.accountNumber === '1300')
    expect(debtors?.periodDebit).toBe(121_000n)
  })

  it('accepts a counter-account the import itself is bringing across', async () => {
    /**
     * The restriction this removes: the check ran before the read, so the
     * counter-account had to already be in the chart. A first-time migration
     * could not use the tussenrekening it was importing from Exact — which is
     * the obvious thing to want, since that is where the old system kept it.
     *
     * The accounts land in the same transaction as the entry that uses them,
     * so the only thing standing in the way was the order of two checks.
     */
    const { token, entityId } = await ready()

    // 2000 Tussenrekening exists in Exact's chart and not in this one, which is
    // the ordinary case: the old system is where a suspense account lives.
    const before = await withReporting(database, (repository) => repository.listAccounts(entityId))
    expect(before.map((account) => account.number)).not.toContain('2000')

    const result = await handleRunExactImport(
      await context(token, `import-${crypto.randomUUID()}`),
      request({ openingBalanceAccount: '2000' }),
    )

    expect(result.status).toBe(201)

    const entry = await withLedger(database, (repository) =>
      repository.findEntryById(entityId, String(result.body.openingEntryId)),
    )
    expect((entry?.lines ?? []).filter((line) => line.accountNumber === '2000')).toHaveLength(1)
  })

  it('refuses an account it was told to use and cannot find', async () => {
    const { token } = await ready()

    await expect(
      handleRunExactImport(
        await context(token, `import-${crypto.randomUUID()}`),
        request({ openingBalanceAccount: '4242' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('refuses to import an administration the dry run calls blocked', async () => {
    // The same refusal the preview makes, applied where it costs something.
    const { exact, token } = await ready()
    exact.otherCurrency = true

    await expect(
      handleRunExactImport(await context(token, `import-${crypto.randomUUID()}`), request()),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('needs an idempotency key, because it writes', async () => {
    const { token } = await ready()

    await expect(handleRunExactImport(await context(token), request())).rejects.toMatchObject({
      code: 'idempotency_key_required',
    })
  })
})
