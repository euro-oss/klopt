import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020.js'
import { listOperations } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import {
  handleGetJournalEntry,
  handleGetTrialBalance,
  handleListAccounts,
  handleListJournalEntries,
  handlePostJournalEntry,
  handleVerifyChain,
} from '../src/api/handlers/ledger.js'
import {
  handleListContacts,
  handleCreateContact,
  handleListInvoices,
} from '../src/api/handlers/sales.js'
import { handleListTokens } from '../src/api/handlers/tokens.js'
import { handleListMembers } from '../src/api/handlers/members.js'
import {
  postJournalEntryBody,
  createContactBody,
  contactsQuery,
  listEntriesQuery,
  invoicesQuery,
  trialBalanceQuery,
} from '../src/api/schemas.js'
import * as schemas from '../src/api/schemas.js'
import { routeManifest } from '../src/api/manifest.js'
import { pathParameters } from '../src/api/openapi.js'
import { BINARY_RESPONSES, handlersIn } from '../scripts/build-response-schemas.js'
import responseSchemas from '../src/api/response-schemas.generated.json' with { type: 'json' }

/**
 * The one thing deriving schemas from types cannot prove on its own.
 *
 * `response-schemas.generated.json` is every handler's inferred return type,
 * so the document cannot disagree with what the code *says* it returns. It can
 * still disagree with what the code actually returns, because a TypeScript type
 * is a claim and an `as` cast is a claim made louder — there are eighty-five of
 * them in the handlers.
 *
 * So: run real handlers against a real database and validate what comes back
 * against the schema published for that operation. Not every operation; the
 * ones below are the shapes the rest are made of — a posted entry, a list with
 * a cursor, a report, a chain verification, a contact, an empty collection —
 * and each is a different way for the claim to be wrong.
 *
 * A failure here means the document is lying about a real endpoint, which is
 * the only kind of failure in this area that reaches an integrator.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

const artefact = responseSchemas as {
  operations: Record<string, { schema?: unknown; media?: string }>
  components: Record<string, unknown>
}

const ajv = new Ajv2020({ strict: false, allErrors: true })

/** The year `seedEntity` opens, which is the only one these reads can answer for. */
const FISCAL_YEAR = '2026'

/**
 * Checks a body against the published schema for one operation.
 *
 * `strictly` turns on `additionalProperties: false` at the top level, so a
 * field the handler returns and the schema does not know about fails. Without
 * it JSON Schema is happy with extra keys, and "the document is missing a
 * field the API sends" would pass silently — which is exactly the drift this
 * whole mechanism exists to catch.
 */
function conforms(operationId: string, body: unknown, strictly = true): void {
  const described = artefact.operations[operationId]
  expect(described, `${operationId} has no published response schema`).toBeDefined()
  expect(described?.schema, `${operationId} publishes a media type, not a schema`).toBeDefined()

  const schema = {
    ...strictly_(described!.schema as Record<string, unknown>, strictly),
    components: { schemas: artefact.components },
  }

  const valid = ajv.validate(schema, body)
  // The errors, not just the boolean: `false` on a forty-field response tells
  // you nothing about which field.
  expect(valid ? [] : ajv.errors, operationId).toEqual([])
}

/**
 * The same schema, refusing fields it does not know about.
 *
 * Applied per branch rather than at the top, because a handler that can return
 * two shapes publishes an `anyOf` — and `additionalProperties: false` beside an
 * `anyOf` has no sibling `properties` to work from, so it rejects *every*
 * field and the test fails on a response that is perfectly fine. That is how
 * this was discovered, and it was the test being wrong rather than the code.
 */
function strictly_(schema: Record<string, unknown>, strictly: boolean): Record<string, unknown> {
  if (!strictly) return schema
  const branches: unknown = schema['anyOf']
  if (Array.isArray(branches)) {
    const tightened = (branches as unknown[]).map((branch) =>
      typeof branch === 'object' && branch !== null && 'properties' in branch
        ? { ...(branch as Record<string, unknown>), additionalProperties: false }
        : branch,
    )
    return { ...schema, anyOf: tightened }
  }
  return 'properties' in schema ? { ...schema, additionalProperties: false } : schema
}

type AnyHandler = (context: unknown, query?: unknown) => Promise<{ body: unknown }>

/**
 * Every exported handler, by name.
 *
 * The manifest says which handler a route calls but not which file it lives
 * in — the route's own import is the only thing that knows. Rather than parse
 * that too, all twenty modules are pulled in at once and indexed by name.
 *
 * `import.meta.glob` rather than a dynamic `import()`: this suite runs through
 * Vite, which resolves imports at build time and refuses a path it cannot see.
 */
function everyHandler(): Map<string, AnyHandler> {
  const modules = import.meta.glob<Record<string, unknown>>('../src/api/handlers/*.ts', {
    eager: true,
  })
  const found = new Map<string, AnyHandler>()

  for (const module of Object.values(modules)) {
    for (const [exported, value] of Object.entries(module)) {
      if (!exported.startsWith('handle') || typeof value !== 'function') continue
      expect(found.has(exported), `${exported} is exported by two handler modules`).toBe(false)
      found.set(exported, value as AnyHandler)
    }
  }
  return found
}

let database: Database
let entityId: string
let token: string

function contextFor(idempotencyKey?: string) {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return resolveRequestContext({
    database,
    request: new Request('https://klopt.test/api/v1/journal-entries', { headers }),
  })
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)

  token = (
    await issueToken(database, {
      entityId,
      name: 'response-shape-test',
      permissions: [
        // Every read this suite drives, so a missing permission is never
        // mistaken for a shape that does not conform.
        'entity:create',
        'ledger:export',
        'ledger:import',
        'ledger:read',
        'ledger:post',
        'sales:read',
        'sales:write',
        'ledger:configure',
        'tokens:manage',
        'members:manage',
      ],
      actorKind: 'script',
      actorId: 'response-shape-test',
    })
  ).token
}, 60_000)

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  await closeDatabase(database)
})

describe('what the handlers really return matches what the document publishes', () => {
  it('a posted journal entry, and then the same entry read back', async () => {
    const posted = await handlePostJournalEntry(
      await contextFor('response-shape-post'),
      postJournalEntryBody.parse({
        journalCode: 'MEM',
        bookingDate: '2026-03-15',
        documentDate: '2026-03-15',
        description: 'Vormcontrole',
        lines: [
          { accountNumber: '1300', debit: '12100' },
          { accountNumber: '8000', credit: '10000' },
          { accountNumber: '1500', credit: '2100' },
        ],
      }),
    )
    conforms('ledger.postJournalEntry', posted.body)

    // Two operations, two schemas, one entity: a serialiser shared between
    // them that drifted would show up on one and not the other.
    const entryId = (posted.body as { entry: { id: string } }).entry.id
    const read = await handleGetJournalEntry(await contextFor(), entryId)
    conforms('ledger.getJournalEntry', read.body)
  })

  it('a list with its cursor', async () => {
    const listed = await handleListJournalEntries(
      await contextFor(),
      listEntriesQuery.parse({ limit: '5' }),
    )
    conforms('ledger.listJournalEntries', listed.body)
    expect((listed.body as { entries: unknown[] }).entries.length).toBeGreaterThan(0)
  })

  it('a report, where every amount is a decimal string', async () => {
    const balance = await handleGetTrialBalance(
      await contextFor(),
      trialBalanceQuery.parse({ fiscalYear: '2026' }),
    )
    conforms('ledger.getTrialBalance', balance.body)
  })

  it('a chain verification', async () => {
    conforms('ledger.verifyChain', (await handleVerifyChain(await contextFor())).body)
  })

  it('the chart of accounts, which is the largest plain list', async () => {
    conforms('ledger.listAccounts', (await handleListAccounts(await contextFor())).body)
  })

  it('a created contact and the list it then appears in', async () => {
    const created = await handleCreateContact(
      await contextFor('response-shape-contact'),
      createContactBody.parse({
        number: 'VORM-001',
        name: 'Vormcontrole BV',
        email: 'facturen@vormcontrole.test',
      }),
    )
    conforms('sales.createContact', created.body)
    conforms(
      'sales.listContacts',
      (await handleListContacts(await contextFor(), contactsQuery.parse({}))).body,
    )
  })

  it('an empty collection, which is where an optional field hides', async () => {
    // Nothing has been invoiced, so every nullable and every empty array in
    // this shape is exercised at once — the case a hand-written schema gets
    // wrong because the author only ever looked at a populated response.
    conforms(
      'sales.listInvoices',
      (await handleListInvoices(await contextFor(), invoicesQuery.parse({}))).body,
    )
  })

  it('the access surfaces, which serialise dates and states', async () => {
    conforms('tokens.list', (await handleListTokens(await contextFor())).body)
    conforms('members.list', (await handleListMembers(await contextFor())).body)
  })
})

/**
 * Every collection read, driven from the manifest rather than listed here.
 *
 * The hand-written cases above cover the shapes that need setting up — a
 * posted entry, a created contact. These are the thirty-eight reads that take
 * no path parameter, so an empty administration can answer all of them, and
 * the list comes from `routeManifest` rather than from a person: an endpoint
 * added without a conformance case fails this the day it appears.
 *
 * The handler is resolved the same way `build-response-schemas.ts` resolves
 * it, from the route source. If that lookup and this one ever disagree, the
 * schema being checked is not the schema being published, and the assertion
 * that every candidate was reached is what catches it.
 */
describe('every collection read matches its published schema', () => {
  /**
   * Reads an empty administration genuinely cannot answer, and why.
   *
   * An allowlist rather than a `catch`: a handler that starts throwing is a
   * regression, and swallowing it here would make this suite quietly stop
   * testing whatever broke.
   */
  const NEEDS_MORE_THAN_AN_EMPTY_ADMINISTRATION: Readonly<Record<string, string>> = {
    'exact.listDivisions':
      'There is no Exact connection until somebody makes one, and making one needs OAuth.',
    'exact.previewImport': 'Reads an Exact administration, so it needs that connection too.',
  }

  /**
   * Query values for the reads that need one, because a default would be a
   * lie: there is no sensible default fiscal year for a trial balance.
   */
  const QUERIES: Readonly<Record<string, Record<string, string>>> = {
    'ledger.getTrialBalance': { fiscalYear: FISCAL_YEAR },
    'ledger.getBalanceSheet': { fiscalYear: FISCAL_YEAR },
    'ledger.getProfitAndLoss': { fiscalYear: FISCAL_YEAR },
    'rgs.previewUpgrade': { toVersion: '3.7' },
    'exact.previewImport': { year: FISCAL_YEAR },
    'purchase.getCreditorAgeing': { asOf: `${FISCAL_YEAR}-12-31` },
    // Both cross-cutting reads start from something the caller names: a word
    // to look for, and a figure to account for. Neither has a default.
    'discovery.search': { q: 'zz' },
    'discovery.explainNumber': {
      figure: 'account',
      accountNumber: '1300',
      fiscalYear: FISCAL_YEAR,
    },
  }

  it('reaches every one of them', async () => {
    const operations = new Map(listOperations().map((operation) => [operation.id, operation]))
    const candidates = routeManifest.filter((binding) => {
      const operation = operations.get(binding.operationId)
      return (
        operation?.kind === 'read' &&
        binding.method === 'GET' &&
        pathParameters(binding.path).length === 0 &&
        !(binding.operationId in BINARY_RESPONSES)
      )
    })
    expect(candidates.length).toBeGreaterThan(30)

    const handlers = everyHandler()
    const failures: string[] = []
    let checked = 0

    for (const binding of candidates) {
      if (binding.operationId in NEEDS_MORE_THAN_AN_EMPTY_ADMINISTRATION) continue

      const name = handlersIn(binding.module)[binding.method]
      const handler = name === undefined ? undefined : handlers.get(name)
      if (handler === undefined) {
        failures.push(`${binding.operationId}: cannot find ${name ?? 'a handler'}`)
        continue
      }

      const schema =
        binding.request?.query === undefined
          ? undefined
          : (schemas as Record<string, { parse: (value: unknown) => unknown } | undefined>)[
              binding.request.query
            ]

      try {
        const result = await handler(
          await contextFor(),
          schema?.parse(QUERIES[binding.operationId] ?? {}),
        )
        conforms(binding.operationId, result.body)
        checked += 1
      } catch (error: unknown) {
        failures.push(
          `${binding.operationId}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    expect(failures).toEqual([])
    expect(checked).toBeGreaterThan(30)
  }, 120_000)
})

describe('the check itself would notice', () => {
  it('rejects a body missing a field the schema requires', () => {
    expect(() => {
      conforms('ledger.verifyChain', {})
    }).toThrow()
  })

  it('rejects a body carrying a field the schema does not know about', () => {
    // The direction that matters: a handler quietly gaining a field means the
    // document is now incomplete, and an integrator reading it does not know
    // the field is there.
    expect(() => {
      conforms('ledger.verifyChain', { intact: true, headHash: null, breaks: [], extra: 1 })
    }).toThrow()
  })
})
