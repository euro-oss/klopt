import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import {
  closeDatabase,
  createAuth,
  createDatabase,
  issueToken,
  membershipsFor,
  runMigrations,
  type Auth,
  type Database,
} from '@klopt/db'
import { createMemoryEmailTransport } from '@klopt/adapters'
import { resolveRequestContext, resolveSetupContext } from '../src/api/auth.js'
import { setAuthForTest } from '../src/api/auth-instance.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { ApiError } from '../src/api/errors.js'
import {
  handleCreateEntity,
  handleCreateFiscalYear,
  handleListCharts,
  handleListFiscalYears,
} from '../src/api/handlers/setup.js'
import { handleGetTrialBalance, handlePostJournalEntry } from '../src/api/handlers/ledger.js'
import { handleListTaxCodes } from '../src/api/handlers/sales.js'
import { createEntityBody, postJournalEntryBody } from '../src/api/schemas.js'

/**
 * A fresh install, from nothing to a posted entry.
 *
 * This is the principle-4 test: "self-hosted is complete, not crippled". Until
 * these operations existed, the only way to get a first administration was to
 * run a test fixture — so the journey a real first user takes was the one
 * journey nothing exercised. It runs against a real database and real
 * better-auth sessions, and it ends by posting into books that this test
 * created rather than seeded.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let auth: Auth

const mailbox = createMemoryEmailTransport()

async function signUp(): Promise<{ userId: string; cookie: string }> {
  const email = `owner-${randomUUID()}@example.test`
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })

  const delivered = mailbox.sent.at(-1)
  if (delivered === undefined) throw new Error('No sign-in code was sent.')
  const otp = /\b(\d{6})\b/.exec(delivered.text)?.[1]
  if (otp === undefined) throw new Error('The message contained no six-digit code.')

  const response = await auth.api.signInEmailOTP({ body: { email, otp }, asResponse: true })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie === null) throw new Error('No session cookie was issued.')

  const body = (await response.json()) as { user: { id: string } }
  return { userId: body.user.id, cookie: setCookie.split(';')[0]! }
}

const request = (headers: Record<string, string>): Request =>
  new Request('https://klopt.test/api/v1/entities', { headers: new Headers(headers) })

const body = (overrides: Record<string, unknown> = {}) =>
  createEntityBody.parse({ name: 'Nieuwe Zaak', firstFiscalYear: '2026', ...overrides })

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)

  auth = createAuth({
    database,
    secret: 'test-secret-not-for-production-0123456789',
    baseUrl: 'https://klopt.test',
    email: mailbox,
  })
  setAuthForTest(auth)
}, 60_000)

afterAll(async () => {
  setAuthForTest(null)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('a signed-in user with no administration', () => {
  it('can see which charts they could provision from', async () => {
    const { cookie } = await signUp()
    const result = handleListCharts(
      await resolveSetupContext({ database, request: request({ cookie }) }),
    )

    const charts = (result.body as { charts: { code: string; accountCount: number }[] }).charts
    expect(charts.map((chart) => chart.code)).toContain('nl-mkb')
    expect(charts.every((chart) => chart.accountCount > 0)).toBe(true)
  })

  it('creates one, owns it, and can immediately post into it', async () => {
    const { userId, cookie } = await signUp()
    const entityId = uuidv7()

    const created = await handleCreateEntity(
      await resolveSetupContext({ database, request: request({ cookie }) }),
      entityId,
      body(),
    )
    expect(created.status).toBe(201)

    const memberships = await membershipsFor(database, userId)
    expect(memberships).toEqual([{ entityId, entityName: 'Nieuwe Zaak', role: 'owner' }])

    // The session now resolves to the new entity with an owner's permissions,
    // through exactly the same path as any other request.
    const context = await resolveRequestContext({
      database,
      request: request({ cookie, 'idempotency-key': uuidv7() }),
    })
    expect(context.entityId).toBe(entityId)

    const posted = await handlePostJournalEntry(
      context,
      postJournalEntryBody.parse({
        journalCode: 'VRK',
        bookingDate: '2026-03-15',
        documentDate: '2026-03-15',
        description: 'Eerste factuur',
        lines: [
          { accountNumber: '1300', debit: '12100' },
          { accountNumber: '8000', credit: '10000' },
          { accountNumber: '1500', credit: '2100' },
        ],
      }),
    )
    expect(posted.status).toBe(201)

    const trial = await handleGetTrialBalance(context, {
      fiscalYear: '2026',
      fromPeriod: 1,
      toPeriod: 13,
      currency: 'EUR',
      includeZeroRows: false,
    })
    const totals = trial.body as { totalDebit: string; totalCredit: string; difference: string }
    expect(totals.totalDebit).toBe('12100')
    expect(totals.totalCredit).toBe('12100')
    expect(totals.difference).toBe('0')
  })

  it('gets tax codes it can invoice with, wired to the right account', async () => {
    const { cookie } = await signUp()
    const entityId = uuidv7()
    await handleCreateEntity(
      await resolveSetupContext({ database, request: request({ cookie }) }),
      entityId,
      body(),
    )

    const context = await resolveRequestContext({ database, request: request({ cookie }) })
    const result = await handleListTaxCodes(context)
    const codes = (result.body as { taxCodes: { code: string; accountNumber: string | null }[] })
      .taxCodes

    const high = codes.find((code) => code.code === 'H21')
    expect(high?.accountNumber).toBe('1500')
  })

  it('creates one administration, not two, when the form is submitted twice', async () => {
    const { userId, cookie } = await signUp()
    const entityId = uuidv7()
    const context = await resolveSetupContext({ database, request: request({ cookie }) })

    const first = await handleCreateEntity(context, entityId, body())
    const second = await handleCreateEntity(context, entityId, body())

    expect(first.status).toBe(201)
    // 200, not 201: nothing was created the second time.
    expect(second.status).toBe(200)
    expect(await membershipsFor(database, userId)).toHaveLength(1)
  })

  it('refuses an id that is not a UUID', async () => {
    const { cookie } = await signUp()
    const context = await resolveSetupContext({ database, request: request({ cookie }) })

    await expect(handleCreateEntity(context, 'not-a-uuid', body())).rejects.toThrow(ApiError)
  })

  it('refuses a chart nobody ships', async () => {
    const { cookie } = await signUp()
    const context = await resolveSetupContext({ database, request: request({ cookie }) })

    await expect(
      handleCreateEntity(context, uuidv7(), body({ chartCode: 'imaginary' })),
    ).rejects.toThrow(/imaginary/)
  })
})

describe('provisioning is a human act', () => {
  it('refuses an API token outright', async () => {
    // A token is issued *by* an administration. Letting one create another
    // would put a second tenant behind the first one's credential.
    const { cookie } = await signUp()
    const entityId = uuidv7()
    await handleCreateEntity(
      await resolveSetupContext({ database, request: request({ cookie }) }),
      entityId,
      body(),
    )

    const token = await issueToken(database, {
      entityId,
      name: 'ci',
      permissions: ['*'],
      actorKind: 'script',
      actorId: 'ci',
    })

    await expect(
      resolveSetupContext({
        database,
        request: request({ authorization: `Bearer ${token.token}` }),
      }),
    ).rejects.toThrow(/cannot create another/)
  })

  it('refuses an anonymous caller', async () => {
    await expect(resolveSetupContext({ database, request: request({}) })).rejects.toThrow(ApiError)
  })
})

describe('opening the next book year', () => {
  it('is what makes a year close possible at all', async () => {
    const { cookie } = await signUp()
    const entityId = uuidv7()
    await handleCreateEntity(
      await resolveSetupContext({ database, request: request({ cookie }) }),
      entityId,
      body(),
    )

    const context = await resolveRequestContext({ database, request: request({ cookie }) })

    const before = await handleListFiscalYears(context)
    expect(before.body.fiscalYears.map((year) => year.code)).toEqual(['2026'])

    const opened = await handleCreateFiscalYear(context, { code: '2027' })
    expect(opened.status).toBe(201)
    expect(opened.body).toMatchObject({ startsOn: '2027-01-01', endsOn: '2027-12-31' })

    // Idempotent by the year code: asking twice does not produce two 2027s.
    const again = await handleCreateFiscalYear(context, { code: '2027' })
    expect(again.status).toBe(200)

    const after = await handleListFiscalYears(context)
    const years = after.body.fiscalYears
    expect(years.map((year) => year.code)).toEqual(['2026', '2027'])
    expect(years.every((year) => year.periods.length === 12)).toBe(true)
  })

  it('follows a non-calendar book year (spec 6.4)', async () => {
    const { cookie } = await signUp()
    const entityId = uuidv7()
    await handleCreateEntity(
      await resolveSetupContext({ database, request: request({ cookie }) }),
      entityId,
      body({ fiscalYearStartMonth: 7 }),
    )

    const context = await resolveRequestContext({ database, request: request({ cookie }) })
    const opened = await handleCreateFiscalYear(context, { code: '2027' })

    expect(opened.body).toMatchObject({ startsOn: '2027-07-01', endsOn: '2028-06-30' })
  })
})
