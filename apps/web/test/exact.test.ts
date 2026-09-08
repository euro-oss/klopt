import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  closeDatabase,
  createDatabase,
  issueToken,
  runMigrations,
  withExactConnection,
  type Database,
} from '@klopt/db'
import { seedEntity, seedSalesConfiguration } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import {
  handleChooseExactDivision,
  handleCompleteExactConnection,
  handleConnectExact,
  handleDisconnectExact,
  handleGetExactConnection,
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
} from '../src/api/schemas.js'

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

// ---------------------------------------------------------------------------
// A fake Exact Online
// ---------------------------------------------------------------------------

const padded = (code: string): string => code.padStart(18, ' ')
const guid = (n: number): string => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

interface FakeExact {
  /** Every URL asked, in order. */
  readonly asked: string[]
  /** Token pairs handed out, oldest first. */
  readonly issued: { accessToken: string; refreshToken: string }[]
  /** Refresh tokens that have been spent, and are therefore dead. */
  readonly spent: Set<string>
  divisions: readonly Record<string, unknown>[]
  /** Set to make the next refresh fail the way a revoked app does. */
  revoked: boolean
}

function fakeExact(): FakeExact {
  const state: FakeExact = {
    asked: [],
    issued: [],
    spent: new Set(),
    revoked: false,
    divisions: [
      {
        Code: 1000,
        Description: 'Voorbeeld BV',
        Currency: 'EUR',
        Country: 'NL',
        Status: 1,
        IsMainDivision: true,
        Current: true,
      },
      {
        Code: 2000,
        Description: 'Aardig Testje',
        Currency: 'EUR',
        Country: 'NL',
        Status: 1,
        IsPracticeDivision: true,
      },
      { Code: 3000, Description: 'Oude Holding BV', Currency: 'EUR', Country: 'NL', Status: 2 },
    ],
  }

  let issued = 0
  const nextPair = () => {
    issued += 1
    const pair = {
      accessToken: `access-${String(issued)}`,
      refreshToken: `refresh-${String(issued)}`,
    }
    state.issued.push(pair)
    return pair
  }

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  const collection = (rows: readonly unknown[]): Response => json({ d: { results: rows } })

  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    state.asked.push(url)

    if (url.includes('/api/oauth2/token')) {
      // Every caller here posts a form as a string; anything else is a bug in
      // the caller rather than something to stringify hopefully.
      const sent = typeof init?.body === 'string' ? init.body : ''
      const body = new URLSearchParams(sent)

      if (body.get('grant_type') === 'refresh_token') {
        const offered = body.get('refresh_token') ?? ''
        if (state.revoked || state.spent.has(offered)) {
          // Exact's own answer to a spent or revoked token.
          return Promise.resolve(
            json({ error: 'invalid_grant', error_description: 'Token is no longer valid' }, 400),
          )
        }
        state.spent.add(offered)
      }

      const pair = nextPair()
      return Promise.resolve(
        json({
          access_token: pair.accessToken,
          refresh_token: pair.refreshToken,
          // A string, because both forms have to work.
          expires_in: '600',
          token_type: 'bearer',
        }),
      )
    }

    // Everything below needs the current access token.
    const authorization = new Headers(init?.headers).get('authorization') ?? ''
    const current = state.issued[state.issued.length - 1]
    if (current === undefined || authorization !== `Bearer ${current.accessToken}`) {
      return Promise.resolve(new Response('unauthorised', { status: 401 }))
    }

    if (url.includes('current/Me')) {
      return Promise.resolve(
        collection([{ UserID: guid(9), FullName: 'H. Stokvis', CurrentDivision: 1000 }]),
      )
    }
    if (url.includes('system/Divisions')) return Promise.resolve(collection(state.divisions))

    if (url.includes('financial/GLAccounts')) {
      return Promise.resolve(
        collection([
          {
            ID: guid(1),
            Code: '1300',
            Description: 'Debiteuren',
            BalanceSide: 'D',
            BalanceType: 'B',
            Type: 20,
            TypeDescription: 'Accounts receivable',
            IsBlocked: false,
          },
          {
            ID: guid(2),
            Code: '1600',
            Description: 'Crediteuren',
            BalanceSide: 'C',
            BalanceType: 'B',
            Type: 22,
            TypeDescription: 'Accounts payable',
            IsBlocked: false,
          },
          {
            ID: guid(3),
            Code: '8000',
            Description: 'Omzet',
            BalanceSide: 'C',
            BalanceType: 'W',
            Type: 110,
            TypeDescription: 'Revenue',
            IsBlocked: false,
          },
          {
            ID: guid(4),
            Code: '4000',
            Description: 'Kantoorkosten',
            BalanceSide: 'D',
            BalanceType: 'W',
            Type: 121,
            TypeDescription: 'SG&A',
            IsBlocked: false,
          },
        ]),
      )
    }
    if (url.includes('vat/VATCodes')) {
      return Promise.resolve(
        collection([
          {
            Code: 'H',
            Description: 'BTW hoog',
            Percentage: 0.21,
            Type: 'E',
            VATTransactionType: 'B',
            IsBlocked: false,
          },
        ]),
      )
    }
    if (url.includes('cashflow/PaymentConditions')) {
      return Promise.resolve(
        collection([
          { Code: '30', Description: '30 dagen', PaymentDays: 30, PaymentEndOfMonths: 0 },
        ]),
      )
    }
    if (url.includes('financial/ReportingBalance')) {
      // 1 210,00 receivable, 605,00 payable, and 1 815,00 each way.
      return Promise.resolve(
        collection([
          {
            GLAccountCode: '1300',
            BalanceType: 'B',
            AmountDebit: 1210,
            AmountCredit: 0,
            Amount: 1210,
            Count: 1,
            ReportingYear: 2026,
            ReportingPeriod: 1,
            Status: 50,
          },
          {
            GLAccountCode: '8000',
            BalanceType: 'W',
            AmountDebit: 0,
            AmountCredit: 1210,
            Amount: -1210,
            Count: 1,
            ReportingYear: 2026,
            ReportingPeriod: 1,
            Status: 50,
          },
          {
            GLAccountCode: '1600',
            BalanceType: 'B',
            AmountDebit: 0,
            AmountCredit: 605,
            Amount: -605,
            Count: 1,
            ReportingYear: 2026,
            ReportingPeriod: 1,
            Status: 20,
          },
          {
            GLAccountCode: '4000',
            BalanceType: 'W',
            AmountDebit: 605,
            AmountCredit: 0,
            Amount: 605,
            Count: 1,
            ReportingYear: 2026,
            ReportingPeriod: 1,
            Status: 20,
          },
        ]),
      )
    }
    if (url.includes('crm/Accounts')) {
      return Promise.resolve(
        collection([
          {
            ID: guid(101),
            Code: padded('1000'),
            Name: 'Klant Een BV',
            Type: 'A',
            Status: 'C',
            IsSales: true,
            IsSupplier: false,
            Blocked: false,
            Country: 'NL',
            City: 'Amsterdam',
            PaymentConditionSales: '30',
          },
          {
            ID: guid(102),
            Code: padded('2000'),
            Name: 'Leverancier Twee BV',
            Type: 'A',
            Status: 'A',
            IsSales: false,
            IsSupplier: true,
            Blocked: false,
            Country: 'NL',
            City: 'Rotterdam',
          },
        ]),
      )
    }
    if (url.includes('ReceivablesList')) {
      return Promise.resolve(
        collection([
          {
            HID: 900001,
            AccountId: guid(101),
            AccountCode: padded('1000'),
            AccountName: 'Klant Een BV',
            Amount: 1210,
            AmountInTransit: 0,
            CurrencyCode: 'EUR',
            Description: 'Factuur 2026-001',
            DueDate: '2026-02-15T00:00:00',
            InvoiceDate: '2026-01-16T00:00:00',
            InvoiceNumber: 20260001,
            EntryNumber: 20260001,
            JournalCode: '70',
            YourRef: 'PO-441',
          },
        ]),
      )
    }
    if (url.includes('PayablesList')) {
      return Promise.resolve(
        collection([
          {
            HID: 900101,
            AccountId: guid(102),
            AccountCode: padded('2000'),
            AccountName: 'Leverancier Twee BV',
            Amount: 605,
            AmountInTransit: 0,
            CurrencyCode: 'EUR',
            Description: 'Inkoop',
            DueDate: '2026-02-28T00:00:00',
            InvoiceDate: '2026-01-29T00:00:00',
            InvoiceNumber: 700045,
            EntryNumber: 700045,
            JournalCode: '80',
            YourRef: 'LEV-88',
          },
        ]),
      )
    }

    return Promise.resolve(collection([]))
  }

  return state
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
  process.env['KLOPT_ENCRYPTION_KEY'] = 'test-key-not-for-production-0123456789'
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  await runMigrations(DATABASE_URL)
  setDatabaseForTest(database)
})

afterEach(() => {
  globalThis.fetch = realFetch
})

afterAll(async () => {
  globalThis.fetch = realFetch
  delete process.env['KLOPT_ENCRYPTION_KEY']
  await closeDatabase(database)
})

describe('connecting', () => {
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
          matches: true,
        },
        payable: { accountCodes: ['1600'], ledger: '605.00', openItems: '605.00', matches: true },
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

    // The seeded chart has its own accounts; Exact's four are all new here.
    expect(body.accounts.count).toBe(4)
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

    expect(exact.asked.some((url) => url.includes('documents/Documents'))).toBe(false)
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
