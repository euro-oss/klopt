import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  closeDatabase,
  createDatabase,
  issueToken,
  runMigrations,
  type Database,
} from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { ApiError } from '../src/api/errors.js'
import { setDatabaseForTest } from '../src/api/database.js'
import {
  handleChooseMoneybirdAdministration,
  handleConnectMoneybird,
  handleDisconnectMoneybird,
  handleGetMoneybirdConnection,
  handleListMoneybirdAdministrations,
  handleMoneybirdImportStatus,
  handlePreviewMoneybirdImport,
  handleRunMoneybirdImport,
  handleSaveMoneybirdMappings,
} from '../src/api/handlers/moneybird.js'
import { handleListAuditLog } from '../src/api/handlers/audit.js'
import {
  auditLogQuery,
  chooseMoneybirdAdministrationBody,
  connectMoneybirdBody,
  saveMoneybirdMappingsBody,
} from '../src/api/schemas.js'
import { fakeMoneybird } from './support/moneybird.js'

/**
 * Connecting to Moneybird and previewing an import, against a real database
 * and a fake Moneybird (issue #32).
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
    name: 'moneybird-test',
    permissions: ['*'],
    actorKind: 'human',
    actorId: `human-${entityId.slice(0, 8)}`,
  })
  return { entityId, token }
}

async function connect(token: string) {
  await handleConnectMoneybird(
    await context(token, `connect-${crypto.randomUUID()}`),
    connectMoneybirdBody.parse({
      apiToken: 'mb-test-token',
      baseUrl: 'https://moneybird.com/api/v2',
    }),
  )
}

async function choose(token: string, administrationId = '123456') {
  await handleChooseMoneybirdAdministration(
    await context(token, `choose-${crypto.randomUUID()}`),
    chooseMoneybirdAdministrationBody.parse({ administrationId }),
  )
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
  await cleanupSeededBackgroundWork(database)
  await closeDatabase(database)
})

describe('connecting', () => {
  it('stores the token encrypted and does not call Moneybird yet', async () => {
    const { token } = await newEntity()
    const moneybird = fakeMoneybird()
    await connect(token)
    expect(moneybird.asked).toEqual([])
    const body = (await handleGetMoneybirdConnection(await context(token))).body
    expect(body.connection).toMatchObject({ connected: true, ready: false, administrationId: null })
    expect(JSON.stringify(body)).not.toContain('mb-test-token')
  })

  it('refuses to store a token without an encryption key', async () => {
    const { token } = await newEntity()
    const key = process.env['KLOPT_ENCRYPTION_KEY']
    delete process.env['KLOPT_ENCRYPTION_KEY']
    try {
      await expect(
        handleConnectMoneybird(
          await context(token, crypto.randomUUID()),
          connectMoneybirdBody.parse({ apiToken: 'mb-test-token' }),
        ),
      ).rejects.toBeInstanceOf(ApiError)
    } finally {
      process.env['KLOPT_ENCRYPTION_KEY'] = key
    }
  })
})

describe('choosing an administration', () => {
  it('records the name in the audit log', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    const listed = await handleListMoneybirdAdministrations(await context(token))
    expect(listed.body.administrations.map((row: { id: string }) => row.id).sort()).toEqual([
      '123456',
      '654321',
    ])

    await choose(token)
    const log = (
      await handleListAuditLog(await context(token), auditLogQuery.parse({}))
    ).body.entries.find((row: { action: string }) => row.action === 'moneybird.chooseAdministration')
    expect(log?.after).toMatchObject({ administrationName: 'Voorbeeld BV' })
  })

  it('refuses an administration the token cannot reach', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await expect(
      handleChooseMoneybirdAdministration(
        await context(token, crypto.randomUUID()),
        chooseMoneybirdAdministrationBody.parse({ administrationId: '999' }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('the dry run', () => {
  it('reconciles booked history and writes nothing', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)
    const preview = (await handlePreviewMoneybirdImport(await context(token))).body
    expect(preview.dryRun).toBe(true)
    expect(preview.problems).toEqual([])
    expect(preview.counts.salesInvoices).toBe(1)
    expect(preview.notImported).toContain('oauth')
    expect(preview.reconciliation[0]).toMatchObject({ source: 'read', balanced: true })
  })

  it('refuses a foreign-currency administration', async () => {
    const { token } = await newEntity()
    const moneybird = fakeMoneybird()
    moneybird.otherCurrency = true
    await connect(token)
    await choose(token)
    const preview = (await handlePreviewMoneybirdImport(await context(token))).body
    expect(preview.problems.map((problem: { code: string }) => problem.code)).toContain(
      'unknown_currency',
    )
  })

  it('does not call an unreadable resource reconciled', async () => {
    const { token } = await newEntity()
    const moneybird = fakeMoneybird()
    moneybird.forbidden.add('sales_invoices.json')
    await connect(token)
    await choose(token)
    const preview = (await handlePreviewMoneybirdImport(await context(token))).body
    expect(preview.warnings.map((warning: { code: string }) => warning.code)).toContain(
      'resource_unreadable',
    )
    expect(
      preview.reconciliation.every(
        (year: { source: string; balanced: boolean | null }) =>
          year.source === 'unreadable' && year.balanced === null,
      ),
    ).toBe(true)
  })
})

describe('the import job', () => {
  it('queues work rather than posting in the request, and the worker posts through the ledger', async () => {
    const { entityId, token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)
    await handleSaveMoneybirdMappings(
      await context(token, crypto.randomUUID()),
      saveMoneybirdMappingsBody.parse({
        accountMappings: {
          '1': '1100',
          '2': '1300',
          '3': '1500',
          '4': '1510',
          '5': '1600',
          '6': '4000',
          '7': '8000',
          '8': '0500',
        },
        taxMappings: { '21': 'H21', '22': 'VH21' },
      }),
    )

    const queued = await handleRunMoneybirdImport(await context(token, crypto.randomUUID()))
    expect(queued.status).toBe(202)
    expect(queued.body.state).toBe('pending')

    const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
    const { createFilesystemDocumentStore } = await import('@klopt/adapters')
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const directory = mkdtempSync(join(tmpdir(), 'mb-docs-'))
    const outcome = await importMoneybirdAdministration(
      database,
      createFilesystemDocumentStore({ directory }),
    )
    expect(outcome.state).toBe('done')

    const status = (await handleMoneybirdImportStatus(await context(token))).body
    expect(status.state).toBe('done')
    expect(status.report).toMatchObject({ dryRun: false })

    const again = await importMoneybirdAdministration(
      database,
      createFilesystemDocumentStore({ directory }),
    )
    expect(again.state).toBe('idle')

    const replay = await handleRunMoneybirdImport(await context(token, crypto.randomUUID()))
    expect(replay.status).toBe(202)
    const second = await importMoneybirdAdministration(
      database,
      createFilesystemDocumentStore({ directory }),
    )
    expect(second.state).toBe('done')
    expect(entityId).toBeTruthy()
  })

  it('refuses to start when the dry run has blocking problems', async () => {
    const { token } = await newEntity()
    const moneybird = fakeMoneybird()
    moneybird.otherCurrency = true
    await connect(token)
    await choose(token)
    await expect(
      handleRunMoneybirdImport(await context(token, crypto.randomUUID())),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })
})

describe('disconnecting', () => {
  it('forgets the connection', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await handleDisconnectMoneybird(await context(token, crypto.randomUUID()))
    const body = (await handleGetMoneybirdConnection(await context(token))).body
    expect(body.connection).toBeNull()
  })
})
