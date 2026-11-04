import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import {
  closeDatabase,
  createAuth,
  createDatabase,
  issueToken,
  LegalAcceptancesRepository,
  membershipsFor,
  runMigrations,
  withSetup,
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
import type { LegalLinksConfig } from '../src/api/legal-links.js'
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
    expect(memberships).toEqual([
      { entityId, entityName: 'Nieuwe Zaak', role: 'owner', isDemo: false },
    ])

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

  it('rolls back the administration when the terms/DPA acceptance insert fails', async () => {
    const { userId, cookie } = await signUp()
    const entityId = uuidv7()
    const context = await resolveSetupContext({ database, request: request({ cookie }) })

    // Force the acceptance insert to fail (FK: user_id must exist). Same
    // transaction as provision — the administration must not remain.
    await expect(
      handleCreateEntity(context, entityId, body(), {
        afterProvision: async (tx) => {
          await new LegalAcceptancesRepository(tx).recordTermsDpa({
            id: uuidv7(),
            userId: 'user_missing_for_acceptance_rollback',
            termsVersion: '2026-11-02',
            dpaVersion: '2026-11-02-dpa',
          })
        },
      }),
    ).rejects.toThrow()

    expect(await membershipsFor(database, userId)).toEqual([])
    expect(await withSetup(database, (setup) => setup.findEntity(entityId))).toBeNull()
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

/**
 * Hosted legal acceptance on create (QA SECURITY BLOCKER on #169).
 *
 * REST (`PUT /api/v1/entities/{id}`) calls `handleCreateEntity` with no
 * options, so env-driven `readLegalLinks()` is what it enforces. The Setup
 * server function passes request-aware `legal` — covered below as the same
 * handler with an explicit config.
 */
describe('hosted create requires terms/DPA acceptance', () => {
  const HOSTED_KEYS = [
    'KLOPT_TERMS_URL',
    'KLOPT_DPA_URL',
    'KLOPT_TERMS_VERSION',
    'KLOPT_DPA_VERSION',
  ] as const

  const hostedEnv = {
    KLOPT_TERMS_URL: 'https://example.test/terms',
    KLOPT_DPA_URL: 'https://example.test/dpa',
    KLOPT_TERMS_VERSION: '2026-11-02-terms-test',
    KLOPT_DPA_VERSION: '2026-11-02-dpa-test',
  } as const

  const hostedLegal: LegalLinksConfig = {
    privacyUrl: null,
    termsUrl: hostedEnv.KLOPT_TERMS_URL,
    dpaUrl: hostedEnv.KLOPT_DPA_URL,
    termsVersion: hostedEnv.KLOPT_TERMS_VERSION,
    dpaVersion: hostedEnv.KLOPT_DPA_VERSION,
    privacyVersion: null,
  }

  async function withHostedEnv<T>(run: () => Promise<T>): Promise<T> {
    const previous = Object.fromEntries(HOSTED_KEYS.map((key) => [key, process.env[key]]))
    Object.assign(process.env, hostedEnv)
    try {
      return await run()
    } finally {
      for (const key of HOSTED_KEYS) {
        const value = previous[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  }

  it('REST without acceptance: 422, no administration, no legal_acceptances row', async () => {
    await withHostedEnv(async () => {
      const { userId, cookie } = await signUp()
      const entityId = uuidv7()
      const context = await resolveSetupContext({ database, request: request({ cookie }) })

      // Same call shape as routes/api/v1/entities.$entityId.ts — no options.
      await expect(handleCreateEntity(context, entityId, body())).rejects.toMatchObject({
        code: 'validation_failed',
        violations: [
          {
            code: 'legal_acceptance_required',
            messageKey: 'legal_acceptance_required',
            path: 'acceptedLegal',
          },
        ],
      })

      expect(await membershipsFor(database, userId)).toEqual([])
      expect(await withSetup(database, (setup) => setup.findEntity(entityId))).toBeNull()
      expect(await new LegalAcceptancesRepository(database).listForUser(userId)).toEqual([])
    })
  })

  it('REST with acceptance: 201 and exactly one terms_dpa row with server versions', async () => {
    await withHostedEnv(async () => {
      const { userId, cookie } = await signUp()
      const entityId = uuidv7()
      const context = await resolveSetupContext({ database, request: request({ cookie }) })

      const created = await handleCreateEntity(context, entityId, body({ acceptedLegal: true }))
      expect(created.status).toBe(201)

      const rows = await new LegalAcceptancesRepository(database).listForUser(userId)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        kind: 'terms_dpa',
        termsVersion: hostedEnv.KLOPT_TERMS_VERSION,
        dpaVersion: hostedEnv.KLOPT_DPA_VERSION,
        privacyVersion: null,
      })

      // Idempotent retry must not append a second acceptance row.
      const again = await handleCreateEntity(context, entityId, body({ acceptedLegal: true }))
      expect(again.status).toBe(200)
      expect(await new LegalAcceptancesRepository(database).listForUser(userId)).toHaveLength(1)
    })
  })

  it('server-function path: request-aware legal still creates with one acceptance row', async () => {
    // Mimics server/setup.ts passing readLegalLinksForRequest(...) while the
    // process env stays self-hosted (unset).
    const { userId, cookie } = await signUp()
    const entityId = uuidv7()
    const context = await resolveSetupContext({ database, request: request({ cookie }) })

    const created = await handleCreateEntity(context, entityId, body({ acceptedLegal: true }), {
      legal: hostedLegal,
    })
    expect(created.status).toBe(201)

    const rows = await new LegalAcceptancesRepository(database).listForUser(userId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.termsVersion).toBe(hostedLegal.termsVersion)
    expect(rows[0]?.dpaVersion).toBe(hostedLegal.dpaVersion)
  })

  it('self-hosted stays unaffected: no acceptance required or recorded', async () => {
    const { userId, cookie } = await signUp()
    const entityId = uuidv7()
    const context = await resolveSetupContext({ database, request: request({ cookie }) })

    const created = await handleCreateEntity(context, entityId, body())
    expect(created.status).toBe(201)
    expect(await new LegalAcceptancesRepository(database).listForUser(userId)).toEqual([])
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

  it('refuses book years outside the sane range', async () => {
    const { cookie } = await signUp()
    const entityId = uuidv7()
    await handleCreateEntity(
      await resolveSetupContext({ database, request: request({ cookie }) }),
      entityId,
      body(),
    )
    const context = await resolveRequestContext({ database, request: request({ cookie }) })
    await expect(handleCreateFiscalYear(context, { code: '1925' })).rejects.toThrow()
    await expect(handleCreateFiscalYear(context, { code: '2205' })).rejects.toThrow()
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
