import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020.js'
import { listOperations, uuidv7 } from '@klopt/core'
import {
  createAuth,
  closeDatabase,
  createDatabase,
  issueToken,
  runMigrations,
  withOAuth,
  type Auth,
  type Database,
} from '@klopt/db'
import { cleanupSeededBackgroundWork, seedEntity, seedSalesConfiguration } from '@klopt/db/testing'
import {
  createEmailEInvoiceTransport,
  createFilesystemDocumentStore,
  createMemoryEmailTransport,
} from '@klopt/adapters'
import { resolveRequestContext, resolveSetupContext } from '../src/api/auth.js'
import { setAuthForTest } from '../src/api/auth-instance.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { setDocumentStoreForTest } from '../src/api/document-store.js'
import { setEInvoiceTransportForTest } from '../src/api/e-invoice.js'
import { setEmailTransportForTest } from '../src/api/email.js'
import {
  handleGetJournalEntry,
  handleGetTrialBalance,
  handleListAccounts,
  handleListJournalEntries,
  handlePostJournalEntries,
  handlePostJournalEntry,
  handleReverseJournalEntry,
  handleVerifyChain,
} from '../src/api/handlers/ledger.js'
import {
  handleCreateContact,
  handleDraftInvoice,
  handleIssueInvoice,
  handleListContacts,
  handleListInvoices,
  handleSendDunningReminder,
  handleSendInvoice,
  handleUpdateContact,
} from '../src/api/handlers/sales.js'
import {
  handleIssueToken,
  handleListTokens,
  handleRevokeOAuthClient,
  handleRevokeToken,
} from '../src/api/handlers/tokens.js'
import {
  handleInviteMember,
  handleListMembers,
  handleRemoveMember,
  handleSetMemberRole,
} from '../src/api/handlers/members.js'
import {
  handleChooseExactDivision,
  handleCompleteExactConnection,
  handleConnectExact,
  handleDisconnectExact,
  handleExactDocumentStatus,
  handleGetExactConnection,
  handleImportExactDocuments,
  handleListExactDivisions,
  handlePreviewExactImport,
  handleRunExactImport,
} from '../src/api/handlers/exact.js'
import {
  handleDiscardInboxItem,
  handleDraftFromInbox,
  handleListInbox,
  handleReceiveDocument,
} from '../src/api/handlers/inbox.js'
import {
  handleAddInboundSource,
  handlePollInboundSource,
  handleRemoveInboundSource,
} from '../src/api/handlers/inbound-sources.js'
import {
  handleCheckVatNumbers,
  handleFileVatReturn,
  handlePollFilingStatus,
} from '../src/api/handlers/vat.js'
import {
  handleCloseYear,
  handleExportAuditFile,
  handleImportAuditFile,
  handleSetRgsMappings,
} from '../src/api/handlers/compliance.js'
import { handleSealSnapshot, handleVerifySnapshot } from '../src/api/handlers/snapshots.js'
import {
  handleDeleteDocuments,
  handlePseudonymiseContact,
  handleSetLegalHold,
  handleSetRetentionClass,
} from '../src/api/handlers/retention.js'
import {
  handleCreateWebhook,
  handleDeleteWebhook,
  handleReplayWebhook,
} from '../src/api/handlers/webhooks.js'
import {
  handleConfirmMatch,
  handleCreateBankAccount,
  handleIgnoreTransaction,
  handleImportStatement,
  handleListBankTransactions,
  handleListMatchRules,
  handleSetMatchRuleActive,
} from '../src/api/handlers/bank.js'
import {
  handleBookPurchaseInvoice,
  handleCapturePurchaseInvoice,
  handleTransitionPurchaseInvoice,
} from '../src/api/handlers/purchase.js'
import {
  handleAddApprovedInvoices,
  handleAddInstruction,
  handleCreateBatch,
  handleRemoveInstruction,
  handleTransitionBatch,
} from '../src/api/handlers/payments.js'
import {
  handleCreateEntity,
  handleCreateFiscalYear,
  handleUpdateEntity,
} from '../src/api/handlers/setup.js'
import {
  postJournalEntryBody,
  createContactBody,
  contactsQuery,
  listEntriesQuery,
  invoicesQuery,
  trialBalanceQuery,
} from '../src/api/schemas.js'
import * as schemas from '../src/api/schemas.js'
import { fakeExact } from './support/exact-online.js'
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
/**
 * Which operations have been checked, so the last test in this file can say
 * what has not. Filled by `conforms` rather than by a list somebody maintains.
 */
const checked = new Set<string>()

function conforms(operationId: string, body: unknown, strictly = true): void {
  checked.add(operationId)
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
let auth: Auth
let entityId: string
let token: string
let documentDirectory: string

/**
 * The transports and stores the writes below reach for.
 *
 * Memory and filesystem backends rather than mocks, because a mock proves a
 * function was called and these exist so that a handler's *response* is real:
 * a delivery record with a hash in it, a document with a sha256.
 */
const mailbox = createMemoryEmailTransport()

function contextFor(idempotencyKey?: string) {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return resolveRequestContext({
    database,
    request: new Request('https://klopt.test/api/v1/journal-entries', { headers }),
  })
}

/**
 * A signed-in person, for the handful of operations a bearer token cannot do.
 *
 * Provisioning an administration and managing its members both read
 * `context.user`: an invitation is issued *by* somebody, and a token is not a
 * somebody. Those operations are driven through a real better-auth session
 * rather than excused.
 */
function sessionContext(cookie: string, idempotencyKey?: string) {
  const headers = new Headers({ cookie })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return resolveRequestContext({
    database,
    request: new Request('https://klopt.test/api/v1/members', { headers }),
  })
}

async function signIn(
  address?: string,
): Promise<{ userId: string; email: string; cookie: string }> {
  const email = address ?? `shapes-${crypto.randomUUID()}@example.test`
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })
  const delivered = mailbox.sent.at(-1)
  const otp = /\b(\d{6})\b/.exec(delivered?.text ?? '')?.[1]
  if (otp === undefined) throw new Error('No sign-in code was sent.')

  const response = await auth.api.signInEmailOTP({ body: { email, otp }, asResponse: true })
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (cookie === undefined) throw new Error('No session cookie was issued.')
  const body = (await response.json()) as { user: { id: string } }
  return { userId: body.user.id, email, cookie }
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
  documentDirectory = mkdtempSync(join(tmpdir(), 'klopt-shapes-'))
  setDocumentStoreForTest(createFilesystemDocumentStore({ directory: documentDirectory }))
  setEInvoiceTransportForTest(createEmailEInvoiceTransport({ email: mailbox }))
  setEmailTransportForTest(mailbox)
  auth = createAuth({
    database,
    secret: 'test-secret-not-for-production-0123456789',
    baseUrl: 'https://klopt.test',
    email: mailbox,
  })
  setAuthForTest(auth)

  entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)

  token = (
    await issueToken(database, {
      entityId,
      name: 'response-shape-test',
      // Everything: this suite drives every operation the API has, and a
      // missing permission would be indistinguishable from a shape that does
      // not conform. What a token may do is tested in auth-security.test.ts.
      permissions: ['*'],
      // A human with a token, not a script: approving a cost is deliberately
      // something only a person may do, and this suite has to reach that
      // operation like any other.
      actorKind: 'human',
      actorId: 'response-shape-test',
    })
  ).token

  // The seller details a Dutch BIS invoice cannot go without. Without them
  // `sales.sendInvoice` refuses before it can answer with anything.
  await handleUpdateEntity(await contextFor(uuidv7()), {
    legalName: 'Vormcontrole Beheer B.V.',
    street: 'Keizersgracht',
    houseNumber: '123-B',
    postalCode: '1015 CJ',
    city: 'Amsterdam',
    countryCode: 'NL',
    kvkNumber: '12345678',
    vatNumber: 'NL123456789B01',
    iban: 'NL02ABNA0123456789',
  })
}, 120_000)

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  setAuthForTest(null)
  setEmailTransportForTest(null)
  setEInvoiceTransportForTest(null)
  setDocumentStoreForTest(null)
  setDatabaseForTest(null)
  rmSync(documentDirectory, { recursive: true, force: true })
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
    // Both need an Exact connection, which the loop's empty administration
    // does not have. They are checked in the Exact scenario further down,
    // against the same fake Exact the behaviour suite uses.
    'exact.listDivisions': 'Checked against a connected administration instead.',
    'exact.previewImport': 'Checked against a connected administration instead.',
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

/**
 * The other two thirds (spec 10.2, ADR 0057).
 *
 * The loop above reaches every collection read, because an empty
 * administration can answer all of them with no setup at all. The rest — the
 * by-id reads and the writes — need something to exist first, so they are one
 * scenario rather than one loop: a contact, an invoice, a statement, a batch,
 * a filing, a snapshot, in the order somebody would really make them.
 *
 * The order is load-bearing. `it` blocks run in sequence and each leaves its
 * ids in `made` for the next, which is why this is a sequence of named steps
 * rather than independent cases. A failure names the step, and everything
 * after it fails too — which is right: an invoice cannot be issued if
 * drafting it broke.
 *
 * Nothing here asserts behaviour. Every area already has a suite that does,
 * and a second copy of those assertions would be two places to update when a
 * rule changes. The only claim made here is that the published schema
 * describes what actually came back.
 */

const made: Record<string, string> = {}

/** Every write needs an idempotency key, and they have to differ. */
const key = () => uuidv7()

const idOf = (body: unknown): string => (body as { id: string }).id

describe('every write, against the schema it publishes', () => {
  it('provisioning and the book years', async () => {
    const owner = await signIn()
    made['ownerCookie'] = owner.cookie
    const theirEntity = uuidv7()

    conforms(
      'setup.createEntity',
      (
        await handleCreateEntity(
          await resolveSetupContext({
            database,
            request: new Request('https://klopt.test/api/v1/entities', {
              headers: new Headers({ cookie: owner.cookie }),
            }),
          }),
          theirEntity,
          schemas.createEntityBody.parse({ name: 'Vormcontrole BV', firstFiscalYear: '2026' }),
        )
      ).body,
    )

    conforms(
      'ledger.updateEntity',
      (
        await handleUpdateEntity(
          await contextFor(key()),
          schemas.updateEntityBody.parse({ vatRounding: 'per_line' }),
        )
      ).body,
    )
    conforms(
      'ledger.createFiscalYear',
      (
        await handleCreateFiscalYear(
          await contextFor(key()),
          schemas.createFiscalYearBody.parse({ code: '2027' }),
        )
      ).body,
    )
  })

  it('access: a token, an invitation, a role', async () => {
    const issued = await handleIssueToken(
      await contextFor(key()),
      schemas.issueTokenBody.parse({ name: 'vormcontrole', permissions: ['ledger:read'] }),
    )
    conforms('tokens.issue', issued.body)
    conforms(
      'tokens.revoke',
      (await handleRevokeToken(await contextFor(key()), idOf(issued.body))).body,
    )

    /**
     * Revoking an app's access, which means revoking the tokens an OAuth
     * exchange issued in its name.
     *
     * There is no endpoint that mints one — that is the OAuth token exchange —
     * so the token is issued here with the client id the exchange would have
     * put on it. The state is the same; only the route in is different.
     */
    const client = await withOAuth(database, (repository) =>
      repository.registerClient({
        clientName: 'Vormcontrole App',
        redirectUris: ['https://app.vormcontrole.test/callback'],
        registeredBy: null,
      }),
    )
    const clientId = client.clientId
    await issueToken(database, {
      entityId,
      name: 'an-app',
      permissions: ['ledger:read'],
      actorKind: 'agent',
      actorId: clientId,
      oauthClientId: clientId,
    })
    conforms(
      'tokens.revokeClient',
      (await handleRevokeOAuthClient(await contextFor(key()), clientId)).body,
    )

    // Members are managed by a person, not by a token: an invitation is issued
    // *by* somebody, and the handler reads `context.user`.
    const cookie = made['ownerCookie']!
    const address = `vorm-${uuidv7()}@klopt.test`
    conforms(
      'members.invite',
      (
        await handleInviteMember(
          await sessionContext(cookie, key()),
          schemas.inviteMemberBody.parse({ email: address, role: 'bookkeeper' }),
        )
      ).body,
    )

    // The invitation becomes a membership when that address signs in, and
    // `setRole` addresses a member by their user id — there is nobody to
    // re-role until then.
    const invitee = await signIn(address)
    conforms(
      'members.setRole',
      (
        await handleSetMemberRole(
          await sessionContext(cookie, key()),
          invitee.userId,
          schemas.setMemberRoleBody.parse({ role: 'accountant' }),
        )
      ).body,
    )
    conforms(
      'members.remove',
      (await handleRemoveMember(await sessionContext(cookie, key()), invitee.userId)).body,
    )
  })

  it('the ledger: a batch and a reversal', async () => {
    const batch = await handlePostJournalEntries(
      await contextFor(key()),
      schemas.postJournalEntriesBody.parse({
        entries: [
          {
            journalCode: 'MEM',
            bookingDate: '2026-03-16',
            documentDate: '2026-03-16',
            description: 'Vormcontrole batch',
            lines: [
              { accountNumber: '1300', debit: '1000' },
              { accountNumber: '8000', credit: '1000' },
            ],
          },
        ],
      }),
    )
    conforms('ledger.postJournalEntries', batch.body)

    const entryId = (batch.body as { results: { entry: { id: string } | null }[] }).results[0]!
      .entry!.id
    made['entryId'] = entryId
    conforms(
      'ledger.reverseJournalEntry',
      (
        await handleReverseJournalEntry(
          await contextFor(key()),
          entryId,
          schemas.reverseJournalEntryBody.parse({
            bookingDate: '2026-03-17',
            description: 'Vormcontrole terugboeking',
          }),
        )
      ).body,
    )
  })

  it('sales: a contact, an invoice, and what happens to it afterwards', async () => {
    const contact = await handleCreateContact(
      await contextFor(key()),
      schemas.createContactBody.parse({
        number: 'DEB-9001',
        name: 'Vormcontrole Klant B.V.',
        email: 'klant@vormcontrole.test',
        kvkNumber: '87654321',
        vatNumber: 'NL987654321B01',
        // A Dutch BIS invoice cannot be built without the buyer's address, and
        // `sales.sendInvoice` refuses rather than sending one that is short.
        address: {
          street: 'Coolsingel',
          houseNumber: '42',
          postalCode: '3011 AD',
          city: 'Rotterdam',
          countryCode: 'NL',
        },
      }),
    )
    made['contactId'] = idOf(contact.body)

    conforms(
      'sales.updateContact',
      (
        await handleUpdateContact(
          await contextFor(key()),
          made['contactId'],
          schemas.updateContactBody.parse({ iban: 'NL02ABNA0123456789' }),
        )
      ).body,
    )

    const drafted = await handleDraftInvoice(
      await contextFor(key()),
      schemas.draftInvoiceBody.parse({
        contactNumber: 'DEB-9001',
        issueDate: '2026-01-20',
        // PEPPOL-EN16931-R003. Without it the invoice is unsendable, and
        // `sales.sendInvoice` refuses before it answers with anything.
        buyerReference: 'PO-9001',
        lines: [
          {
            description: 'Advies',
            quantity: '1',
            unitPrice: '100000',
            revenueAccountNumber: '8000',
            taxCode: 'H21',
          },
        ],
      }),
    )
    conforms('sales.draftInvoice', drafted.body)
    made['invoiceId'] = idOf(drafted.body)

    conforms(
      'sales.issueInvoice',
      (
        await handleIssueInvoice(
          await contextFor(key()),
          made['invoiceId'],
          schemas.issueInvoiceBody.parse({}),
        )
      ).body,
    )
    conforms(
      'sales.sendInvoice',
      (
        await handleSendInvoice(
          await contextFor(key()),
          made['invoiceId'],
          schemas.sendInvoiceBody.parse({}),
        )
      ).body,
    )
    conforms(
      'sales.sendDunningReminder',
      (
        await handleSendDunningReminder(
          await contextFor(key()),
          made['invoiceId'],
          schemas.sendReminderBody.parse({ asOf: '2026-04-07' }),
        )
      ).body,
    )
  })
})

/** One MT940 statement carrying one line, so a transaction exists to match. */
function statement(iban: string, sequence: number, amount: string, information: string): string {
  const magnitude = amount.replace('-', '')
  const mark = amount.startsWith('-') ? 'D' : 'C'
  return [
    `:20:STMT-${String(sequence)}`,
    `:25:${iban}`,
    `:28C:${String(sequence)}/1`,
    ':60F:C260401EUR0,00',
    `:61:2604020402${mark}${magnitude}NTRFNONREF//REF-${String(sequence)}-${uuidv7().slice(0, 8)}`,
    `:86:${information}`,
    `:62F:${mark}260402EUR${magnitude}`,
    '-',
  ].join('\n')
}

describe('every write, continued', () => {
  it('bank: an account, a statement, a match, a rule', async () => {
    // A real IBAN, check digits and all: submitting a batch validates the
    // debtor's, and a made-up string fails there rather than here.
    const iban = 'NL02ABNA0123456789'
    const account = await handleCreateBankAccount(
      await contextFor(key()),
      schemas.createBankAccountBody.parse({
        iban,
        name: 'Rekening-courant',
        ledgerAccountNumber: '1100',
      }),
    )
    conforms('bank.createAccount', account.body)
    made['bankAccountId'] = idOf(account.body)

    conforms(
      'bank.importStatement',
      (
        await handleImportStatement(
          await contextFor(key()),
          schemas.importStatementBody.parse({
            bankAccountId: made['bankAccountId'],
            content: statement(
              iban,
              1,
              '1210,00',
              '/IBAN/NL02ABNA0123456789/NAME/Vormcontrole Klant B.V./REMI/2026-0001',
            ),
          }),
        )
      ).body,
    )
    for (const [sequence, information] of [
      [2, '/IBAN/NL20INGB0001234567/NAME/Telecom B.V./REMI/Abonnement maart'],
      [3, 'Onbekende bijschrijving'],
    ] as const) {
      await handleImportStatement(
        await contextFor(key()),
        schemas.importStatementBody.parse({
          bankAccountId: made['bankAccountId'],
          content: statement(iban, sequence, '-45,50', information),
        }),
      )
    }

    const transactions = (
      await handleListBankTransactions(
        await contextFor(),
        schemas.transactionsQuery.parse({ bankAccountId: made['bankAccountId'], limit: 100 }),
      )
    ).body.transactions
    made['transactionId'] = transactions[0]!.id

    conforms(
      'bank.confirmMatch',
      (
        await handleConfirmMatch(
          await contextFor(key()),
          made['transactionId'],
          schemas.confirmMatchBody.parse({
            allocations: [{ invoiceId: made['invoiceId']!, amount: '121000' }],
          }),
        )
      ).body,
    )
    // A line coded to an account, with nothing allocated, is the one that
    // teaches a rule — a payment quoting an invoice number has nothing to
    // teach, because the next one will quote its own.
    await handleConfirmMatch(
      await contextFor(key()),
      transactions[1]!.id,
      schemas.confirmMatchBody.parse({ accountNumber: '4000', learn: true }),
    )
    conforms(
      'bank.ignoreTransaction',
      (await handleIgnoreTransaction(await contextFor(key()), transactions[2]!.id)).body,
    )

    const rules = (await handleListMatchRules(await contextFor())).body.rules
    expect(rules.length, 'coding a line should have learned a rule').toBeGreaterThan(0)
    conforms(
      'bank.setMatchRuleActive',
      (
        await handleSetMatchRuleActive(
          await contextFor(key()),
          rules[0]!.id,
          schemas.setRuleActiveBody.parse({ isActive: false }),
        )
      ).body,
    )
  })

  it('purchase: captured, booked, approved', async () => {
    await handleCreateContact(
      await contextFor(key()),
      schemas.createContactBody.parse({
        number: 'CRE-9001',
        name: 'Vormcontrole Leverancier B.V.',
        isCustomer: false,
        isSupplier: true,
        vatNumber: 'NL987654321B01',
        // Without it `payments.addApprovedInvoices` refuses, which is right:
        // an approved cost with nowhere to send the money is not payable.
        iban: 'NL20INGB0001234567',
      }),
    )

    const captured = await handleCapturePurchaseInvoice(
      await contextFor(key()),
      schemas.capturePurchaseInvoiceBody.parse({
        contactNumber: 'CRE-9001',
        supplierInvoiceNumber: 'VF-2026-0001',
        invoiceDate: '2026-02-10',
        dueDate: '2026-03-12',
        net: '100000',
        tax: '21000',
        total: '121000',
        lines: [
          {
            description: 'Kantoorartikelen',
            accountNumber: '4000',
            taxCode: 'VH21',
            net: '100000',
            tax: '21000',
          },
        ],
      }),
    )
    conforms('purchase.captureInvoice', captured.body)
    made['purchaseInvoiceId'] = idOf(captured.body)

    conforms(
      'purchase.bookInvoice',
      (
        await handleBookPurchaseInvoice(
          await contextFor(key()),
          made['purchaseInvoiceId'],
          schemas.bookPurchaseInvoiceBody.parse({}),
        )
      ).body,
    )
    conforms(
      'purchase.transitionInvoice',
      (
        await handleTransitionPurchaseInvoice(
          await contextFor(key()),
          made['purchaseInvoiceId'],
          schemas.transitionPurchaseInvoiceBody.parse({ action: 'approve' }),
        )
      ).body,
    )
  })

  it('payments: a batch, an instruction, a submission', async () => {
    const batch = await handleCreateBatch(
      await contextFor(key()),
      schemas.createBatchBody.parse({
        reference: `VORM-${uuidv7().slice(0, 8)}`,
        bankAccountId: made['bankAccountId']!,
        requestedExecutionDate: '2026-05-01',
      }),
    )
    conforms('payments.createBatch', batch.body)
    made['batchId'] = idOf(batch.body)

    conforms(
      'payments.addApprovedInvoices',
      (await handleAddApprovedInvoices(await contextFor(key()), made['batchId'])).body,
    )

    const instruction = await handleAddInstruction(
      await contextFor(key()),
      made['batchId'],
      schemas.addInstructionBody.parse({
        endToEndId: `INK-${uuidv7().slice(0, 8)}`,
        creditorName: 'Telecom B.V.',
        creditorIban: 'NL20INGB0001234567',
        amount: '4550',
        remittanceInformation: 'Factuur INK-2026-0007',
      }),
    )
    conforms('payments.addInstruction', instruction.body)

    conforms(
      'payments.removeInstruction',
      (
        await handleRemoveInstruction(
          await contextFor(key()),
          made['batchId'],
          idOf(instruction.body),
        )
      ).body,
    )

    // Submitted rather than approved: approval is deliberately somebody else's
    // to give, and that rule is tested in payments.test.ts rather than here.
    conforms(
      'payments.transitionBatch',
      (
        await handleTransitionBatch(
          await contextFor(key()),
          made['batchId'],
          schemas.transitionBatchBody.parse({ action: 'submit' }),
        )
      ).body,
    )
  })
})

/** A supplier's invoice as it arrives: the smallest UBL the parser accepts. */
const SUPPLIER_UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>VF-2026-0002</cbc:ID>
  <cbc:IssueDate>2026-02-11</cbc:IssueDate>
  <cbc:DueDate>2026-03-13</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>Vormcontrole Leverancier B.V.</cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme><cbc:CompanyID>NL987654321B01</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">210.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1210.00</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Kantoorartikelen</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
  </cac:InvoiceLine>
</Invoice>`

/**
 * An administration whose books are from 2015, with one expired document in it.
 *
 * Only `retention.deleteDocuments` needs this, and it needs it for a real
 * reason rather than for convenience: nothing in a 2026 administration is past
 * its bewaartermijn, and nothing will be until 2034.
 */
async function anOldAdministration(): Promise<{
  documentId: string
  context: (idempotencyKey: string) => Promise<Awaited<ReturnType<typeof resolveRequestContext>>>
}> {
  const oldEntity = await seedEntity(database, { fiscalYearCode: '2015' })
  await seedSalesConfiguration(database, oldEntity)
  const issued = await issueToken(database, {
    entityId: oldEntity,
    name: 'response-shape-test-2015',
    permissions: ['*'],
    actorKind: 'human',
    actorId: 'response-shape-test',
  })

  const context = (idempotencyKey: string) =>
    resolveRequestContext({
      database,
      request: new Request('https://klopt.test/api/v1/retention/deletions', {
        headers: new Headers({
          authorization: `Bearer ${issued.token}`,
          'idempotency-key': idempotencyKey,
        }),
      }),
    })

  await handleCreateContact(
    await context(key()),
    schemas.createContactBody.parse({
      number: 'CRE-2015',
      name: 'Oude Leverancier B.V.',
      isCustomer: false,
      isSupplier: true,
      vatNumber: 'NL987654321B01',
    }),
  )

  const received = await handleReceiveDocument(await context(key()), {
    bytes: new TextEncoder().encode(
      SUPPLIER_UBL.replace('VF-2026-0002', 'VF-2015-0001')
        .replace('2026-02-11', '2015-02-11')
        .replace('2026-03-13', '2015-03-13'),
    ),
    filename: 'oude-factuur.xml',
    contentType: 'application/xml',
    source: 'upload',
    receivedFrom: null,
    subject: null,
  })
  const documentId = (received.body as { documentId: string }).documentId

  // Linked to something with a date on it, which is what gives it a term at
  // all. An unlinked document is `undated` and is kept rather than deleted.
  const item = (await handleListInbox(await context(key()), {})).body.items.find(
    (row) => row.documentId === documentId,
  )
  await handleDraftFromInbox(
    await context(key()),
    item!.id,
    schemas.draftFromInboxBody.parse({ lines: [{ accountNumber: '4000', taxCode: 'VH21' }] }),
  )

  return { documentId, context }
}

describe('every write, to the end of the list', () => {
  it('the inbox: a document in, a draft out, and one thrown away', async () => {
    const received = await handleReceiveDocument(await contextFor(key()), {
      bytes: new TextEncoder().encode(SUPPLIER_UBL),
      filename: 'factuur.xml',
      contentType: 'application/xml',
      source: 'upload',
      receivedFrom: 'facturen@leverancier.test',
      subject: 'Factuur VF-2026-0002',
    })
    conforms('inbox.receiveDocument', received.body)
    made['documentId'] = (received.body as { documentId: string }).documentId

    const items = (await handleListInbox(await contextFor(), {})).body.items
    conforms(
      'inbox.draftFromItem',
      (
        await handleDraftFromInbox(
          await contextFor(key()),
          items[0]!.id,
          schemas.draftFromInboxBody.parse({
            lines: [{ accountNumber: '4000', taxCode: 'VH21' }],
          }),
        )
      ).body,
    )

    const second = await handleReceiveDocument(await contextFor(key()), {
      bytes: new TextEncoder().encode('Reclamefolder'),
      filename: 'folder.txt',
      contentType: 'text/plain',
      source: 'upload',
      receivedFrom: null,
      subject: null,
    })
    const discardable = (await handleListInbox(await contextFor(), {})).body.items.find(
      (item) => item.documentId === (second.body as { documentId: string }).documentId,
    )
    conforms(
      'inbox.discardItem',
      (
        await handleDiscardInboxItem(
          await contextFor(key()),
          discardable!.id,
          schemas.discardInboxItemBody.parse({ reason: 'Reclamefolder, geen factuur.' }),
        )
      ).body,
    )
  })

  it('the inbox: where documents arrive from', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'klopt-maildir-'))
    const source = await handleAddInboundSource(
      await contextFor(key()),
      schemas.addInboundSourceBody.parse({ kind: 'maildir', name: 'Postvak', directory }),
    )
    conforms('inbox.addSource', source.body)

    conforms(
      'inbox.pollSource',
      (await handlePollInboundSource(await contextFor(key()), idOf(source.body))).body,
    )
    conforms(
      'inbox.removeSource',
      (await handleRemoveInboundSource(await contextFor(key()), idOf(source.body))).body,
    )
    rmSync(directory, { recursive: true, force: true })
  })

  it('VAT: a number checked, a return filed, a status polled', async () => {
    conforms(
      'vat.checkVatNumber',
      (
        await handleCheckVatNumbers(
          await contextFor(key()),
          schemas.checkVatNumbersBody.parse({ vatNumbers: ['DE123456789'] }),
        )
      ).body,
    )

    const filed = await handleFileVatReturn(
      await contextFor(key()),
      schemas.fileVatReturnBody.parse({
        // By hand: Digipoort needs a PKIoverheid certificate, and the
        // transport being stubbed is recorded in the todo list, not hidden.
        period: '2026-Q1',
        transport: 'manual',
        // The reference somebody copies off Mijn Belastingdienst. Without one
        // there is nothing to poll a status about, and `vat.pollStatus`
        // refuses rather than inventing an answer.
        transportReference: 'MBD-2026-Q1-0001',
        acceptWarnings: true,
        acceptedReason: 'Vormcontrole',
      }),
    )
    conforms('vat.fileReturn', filed.body)
    made['filingId'] = idOf(filed.body)

    conforms(
      'vat.pollStatus',
      (await handlePollFilingStatus(await contextFor(key()), made['filingId'])).body,
    )
  })

  it('compliance: the auditfile in, the mappings set, the year closed', async () => {
    const exported = await handleExportAuditFile(
      await contextFor(),
      schemas.auditFileQuery.parse({ fiscalYear: '2026' }),
    )
    conforms(
      'import.auditFile',
      (
        await handleImportAuditFile(
          await contextFor(key()),
          // A dry run: this administration is the one the file came from, and
          // importing it into itself would double every entry in it.
          schemas.auditFileImportBody.parse({ xml: exported.xml, dryRun: true }),
        )
      ).body,
    )

    conforms(
      'rgs.setMappings',
      (
        await handleSetRgsMappings(
          await contextFor(key()),
          schemas.rgsMappingsBody.parse({
            mappings: [{ accountNumber: '1300', rgsCode: 'BVorDebHad' }],
            dryRun: true,
          }),
        )
      ).body,
    )

    conforms(
      'ledger.closeYear',
      (
        await handleCloseYear(
          await contextFor(key()),
          // Dry run: closing 2026 would lock the period every read above
          // depends on, and this suite is about shapes rather than sequence.
          schemas.closeYearBody.parse({
            fiscalYear: '2026',
            resultAccountNumber: '0500',
            dryRun: true,
          }),
        )
      ).body,
    )
  })

  it('evidence: a snapshot sealed and checked', async () => {
    const sealed = await handleSealSnapshot(
      await contextFor(key()),
      schemas.sealSnapshotBody.parse({ fiscalYear: '2026' }),
    )
    conforms('snapshot.seal', sealed.body)
    made['snapshotId'] = idOf(sealed.body)

    conforms(
      'snapshot.verify',
      (
        await handleVerifySnapshot(
          await contextFor(key()),
          made['snapshotId'],
          schemas.verifySnapshotQuery.parse({}),
        )
      ).body,
    )
  })

  it('retention: a class, a hold, an erasure, a deletion', async () => {
    conforms(
      'retention.setClass',
      (
        await handleSetRetentionClass(
          await contextFor(key()),
          schemas.setRetentionClassBody.parse({
            documentIds: [made['documentId']!],
            retentionClass: 'immovable_property',
          }),
        )
      ).body,
    )
    conforms(
      'retention.setLegalHold',
      (
        await handleSetLegalHold(
          await contextFor(key()),
          schemas.setLegalHoldBody.parse({
            scope: 'documents',
            held: true,
            documentIds: [made['documentId']!],
            reason: 'Geschil met de leverancier.',
          }),
        )
      ).body,
    )

    /**
     * A deletion in a different administration, because it needs a document
     * whose term has run out.
     *
     * The term is derived — the handler recomputes it from the book year of
     * whatever the document is evidence for, so backdating the column does
     * nothing, and a 2026 invoice is kept until 2033. The only honest way to
     * reach this operation is an administration whose books are old enough,
     * so there is one, with one document in it.
     */
    const old = await anOldAdministration()
    conforms(
      'retention.deleteDocuments',
      (
        await handleDeleteDocuments(
          await old.context(key()),
          schemas.deleteDocumentsBody.parse({
            documentIds: [old.documentId],
            reason: 'Bewaartermijn verstreken.',
          }),
        )
      ).body,
    )

    // Last, because it renames the contact every earlier step read.
    conforms(
      'retention.pseudonymiseContact',
      (
        await handlePseudonymiseContact(
          await contextFor(key()),
          made['contactId']!,
          schemas.pseudonymiseContactBody.parse({ reason: 'Verzoek tot verwijdering' }),
        )
      ).body,
    )
  })

  it('webhooks: created, replayed, removed', async () => {
    const created = await handleCreateWebhook(
      await contextFor(key()),
      schemas.createWebhookBody.parse({
        url: 'https://example.test/klopt',
        eventTypes: ['ledger.entry.posted'],
      }),
    )
    conforms('webhooks.create', created.body)

    conforms(
      'webhooks.replay',
      (
        await handleReplayWebhook(
          await contextFor(key()),
          idOf(created.body),
          schemas.replayWebhookBody.parse({ after: null }),
        )
      ).body,
    )
    conforms(
      'webhooks.delete',
      (await handleDeleteWebhook(await contextFor(key()), idOf(created.body))).body,
    )
  })
})

/**
 * Exact, against the same fake the behaviour suite uses.
 *
 * These eight were the last operations in the API whose published response
 * nobody checked, and the reason given was that a connection needs OAuth.
 * It does — and `apps/web/test/support/exact-online.ts` answers it, which is
 * how exact.test.ts has been driving the same handlers all along. Sharing the
 * fake was the whole of the work.
 */
describe('Exact, from connecting to disconnecting', () => {
  const realFetch = globalThis.fetch

  afterAll(() => {
    globalThis.fetch = realFetch
  })

  it('every operation the integration has', async () => {
    // `fakeExact` installs itself on `globalThis.fetch`, the way the handlers
    // reach Exact in production.
    fakeExact()

    const connected = await handleConnectExact(
      await contextFor(key()),
      schemas.connectExactBody.parse({
        baseUrl: 'https://start.exactonline.nl',
        clientId: 'the-client-id',
        clientSecret: 'the-client-secret',
        redirectUri: 'https://klopt.test/exact/callback',
      }),
    )
    conforms('exact.connect', connected.body)

    const state = new URL(connected.body.authorizeUrl).searchParams.get('state')
    conforms(
      'exact.completeConnection',
      (
        await handleCompleteExactConnection(
          await contextFor(key()),
          schemas.completeExactBody.parse({ code: 'the-code', state: state ?? '' }),
        )
      ).body,
    )

    conforms('exact.getConnection', (await handleGetExactConnection(await contextFor())).body)
    conforms('exact.listDivisions', (await handleListExactDivisions(await contextFor())).body)

    conforms(
      'exact.chooseDivision',
      (
        await handleChooseExactDivision(
          await contextFor(key()),
          schemas.chooseExactDivisionBody.parse({ divisionCode: 2000 }),
        )
      ).body,
    )

    conforms(
      'exact.previewImport',
      (
        await handlePreviewExactImport(
          await contextFor(),
          schemas.exactPreviewQuery.parse({ year: '2026' }),
        )
      ).body,
    )

    conforms(
      'exact.runImport',
      (
        await handleRunExactImport(
          await contextFor(key()),
          schemas.runExactImportBody.parse({
            // A dry run: this administration already has its own books, and
            // importing somebody else's into them would make every earlier
            // step in this file a lie.
            year: 2026,
            dryRun: true,
            openingDate: '2026-01-01',
            journalCode: 'MEM',
            receivableAccount: '1300',
            payableAccount: '1600',
            openingBalanceAccount: '0500',
          }),
        )
      ).body,
    )

    conforms(
      'exact.importDocuments',
      (await handleImportExactDocuments(await contextFor(key()))).body,
    )
    conforms(
      'exact.documentImportStatus',
      (await handleExactDocumentStatus(await contextFor())).body,
    )
    conforms('exact.disconnect', (await handleDisconnectExact(await contextFor(key()))).body)
  }, 60_000)
})

/**
 * Every by-id read, driven from the manifest.
 *
 * The scenario above left one of each thing in `made`; this matches them to
 * the path parameters the manifest declares. Driven rather than listed for the
 * same reason as the collection loop: a new by-id read fails this the day it
 * appears, rather than quietly joining the set of shapes nobody checks.
 */
describe('every by-id read matches its published schema', () => {
  /** The value each path parameter takes, by name. */
  const PARAMETERS: Readonly<Record<string, () => string>> = {
    entryId: () => made['entryId']!,
    batchId: () => made['batchId']!,
    transactionId: () => made['transactionId']!,
    invoiceId: () => made['invoiceId']!,
    contactId: () => made['contactId']!,
    filingId: () => made['filingId']!,
    snapshotId: () => made['snapshotId']!,
    // Not an id: the BTW period is its own name, and `2026-Q1` is the one the
    // scenario filed.
    period: () => '2026-Q1',
  }

  /**
   * Where a route's parameter names a different resource than its name
   * suggests. `purchase-invoices/{invoiceId}` and `sales-invoices/{invoiceId}`
   * share a parameter name and do not share an id.
   */
  const BY_OPERATION: Readonly<Record<string, string>> = {
    'purchase.getInvoice': 'purchaseInvoiceId',
  }

  it('reaches every one of them', async () => {
    const operations = new Map(listOperations().map((operation) => [operation.id, operation]))
    const candidates = routeManifest.filter((binding) => {
      const operation = operations.get(binding.operationId)
      return (
        operation?.kind === 'read' &&
        binding.method === 'GET' &&
        pathParameters(binding.path).length > 0 &&
        !(binding.operationId in BINARY_RESPONSES)
      )
    })
    expect(candidates.length).toBeGreaterThan(8)

    const handlers = everyHandler()
    const failures: string[] = []

    for (const binding of candidates) {
      const name = handlersIn(binding.module)[binding.method]
      const handler = name === undefined ? undefined : handlers.get(name)
      if (handler === undefined) {
        failures.push(`${binding.operationId}: cannot find ${name ?? 'a handler'}`)
        continue
      }

      const parameters = pathParameters(binding.path)
      const key = BY_OPERATION[binding.operationId] ?? parameters[0]!
      const resolve = PARAMETERS[key] ?? (() => made[key])
      const value = resolve()
      if (value === undefined) {
        failures.push(`${binding.operationId}: nothing in the scenario made a ${key}`)
        continue
      }

      try {
        conforms(binding.operationId, (await handler(await contextFor(), value)).body)
      } catch (error: unknown) {
        failures.push(
          `${binding.operationId}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    expect(failures).toEqual([])
  }, 120_000)
})

/**
 * The count, said out loud.
 *
 * Every operation in the manifest is either checked above, answers with
 * something other than JSON, or is named here with the reason it cannot be
 * reached. The point is that the third list is short and explicit: "forty-five
 * of a hundred and seventeen" was true for a year and nobody could say which
 * seventy-two, which is how a gap becomes permanent.
 */
describe('nothing is left unchecked without saying why', () => {
  const OUT_OF_REACH: Readonly<Record<string, string>> = {}

  it('accounts for every operation the manifest has', () => {
    const missing = routeManifest
      .map((binding) => binding.operationId)
      .filter((id) => !checked.has(id) && !(id in BINARY_RESPONSES) && !(id in OUT_OF_REACH))
      .sort()

    expect(missing).toEqual([])

    // The number, so a regression that quietly stops driving half the suite
    // fails here rather than passing an empty difference of two empty sets.
    expect(checked.size).toBe(routeManifest.length - Object.keys(BINARY_RESPONSES).length)
  })

  it('does not excuse an operation that is in fact reachable', () => {
    // An excuse that stops being true is worse than no excuse: it is a gap
    // nobody will look at again.
    const excused = Object.keys(OUT_OF_REACH).filter((id) => checked.has(id))
    expect(excused).toEqual([])
  })
})
