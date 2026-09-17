import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import {
  addMember,
  closeDatabase,
  createAuth,
  createDatabase,
  issueToken,
  runMigrations,
  type Auth,
  type Database,
} from '@klopt/db'
import { seedEntity, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { createMemoryEmailTransport } from '@klopt/adapters'
import { resolveRequestContext } from '../src/api/auth.js'
import { setAuthForTest } from '../src/api/auth-instance.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { handleCreateBankAccount } from '../src/api/handlers/bank.js'
import {
  handleAddInstruction,
  handleCreateBatch,
  handleGetBatch,
  handleGetBatchPain001,
  handleListBatches,
  handleRemoveInstruction,
  handleTransitionBatch,
} from '../src/api/handlers/payments.js'
import {
  addInstructionBody,
  createBankAccountBody,
  createBatchBody,
  transitionBatchBody,
} from '../src/api/schemas.js'

/**
 * Outbound payments, against a real database and real sessions.
 *
 * The load-bearing test is the two-person one, and it needs two actual people —
 * two better-auth users with two sessions — because the rule is about identity
 * and a stubbed actor id would prove nothing.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let auth: Auth
let entityId: string
let bankAccountId: string

const mailbox = createMemoryEmailTransport()

/** A signed-in person with a role in the entity. */
async function aPerson(role: 'owner' | 'bookkeeper' | 'accountant' | 'auditor'): Promise<{
  userId: string
  cookie: string
}> {
  const email = `pay-${randomUUID()}@example.test`
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })

  const delivered = mailbox.sent.at(-1)
  const otp = /\b(\d{6})\b/.exec(delivered?.text ?? '')?.[1]
  if (otp === undefined) throw new Error('No sign-in code was sent.')

  const response = await auth.api.signInEmailOTP({ body: { email, otp }, asResponse: true })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie === null) throw new Error('No session cookie was issued.')
  const body = (await response.json()) as { user: { id: string } }

  await addMember(database, { entityId, userId: body.user.id, role })
  return { userId: body.user.id, cookie: setCookie.split(';')[0]! }
}

const request = (cookie: string, idempotencyKey?: string): Request => {
  const headers = new Headers({ cookie })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/api/v1/payment-batches', { headers })
}

const contextFor = async (cookie: string, key = uuidv7()) =>
  resolveRequestContext({ database, request: request(cookie, key) })

async function aBatch(cookie: string, reference = `BATCH-${randomUUID().slice(0, 8)}`) {
  const created = await handleCreateBatch(
    await contextFor(cookie),
    createBatchBody.parse({
      reference,
      bankAccountId,
      requestedExecutionDate: '2026-05-01',
    }),
  )
  return (created.body as { id: string }).id
}

async function withPayment(cookie: string, batchId: string, overrides = {}) {
  return handleAddInstruction(
    await contextFor(cookie),
    batchId,
    addInstructionBody.parse({
      endToEndId: `INK-${randomUUID().slice(0, 8)}`,
      creditorName: 'Telecom B.V.',
      creditorIban: 'NL20INGB0001234567',
      amount: '4550',
      remittanceInformation: 'Factuur INK-2026-0007',
      ...overrides,
    }),
  )
}

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

  entityId = await seedEntity(database)

  const owner = await aPerson('owner')
  const account = await handleCreateBankAccount(
    await contextFor(owner.cookie),
    createBankAccountBody.parse({
      iban: 'NL02ABNA0123456789',
      name: 'Rekening-courant',
      ledgerAccountNumber: '1100',
    }),
  )
  bankAccountId = (account.body as { id: string }).id
}, 60_000)

afterAll(async () => {
  // Take away the fixtures that would otherwise keep the worker busy.
  await cleanupSeededBackgroundWork(database)
  setAuthForTest(null)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('preparing a batch', () => {
  it('is a draft you can add to and take from', async () => {
    const preparer = await aPerson('bookkeeper')
    const batchId = await aBatch(preparer.cookie)

    const added = await withPayment(preparer.cookie, batchId)
    const instructionId = (added.body as { id: string }).id

    let batch = await handleGetBatch(await contextFor(preparer.cookie), batchId)
    expect(batch.body.batch.instructions).toHaveLength(1)
    expect(batch.body.batch.total).toBe('4550')
    expect(batch.body.payable).toBe(true)
    expect(batch.body.batch.editable).toBe(true)

    await handleRemoveInstruction(await contextFor(preparer.cookie), batchId, instructionId)
    batch = await handleGetBatch(await contextFor(preparer.cookie), batchId)
    expect(batch.body.batch.instructions).toEqual([])
    // Empty is not payable: a batch that pays nobody is a mistake.
    expect(batch.body.payable).toBe(false)
  })

  it('reports a bad IBAN before anybody is asked to approve it', async () => {
    const preparer = await aPerson('bookkeeper')
    const batchId = await aBatch(preparer.cookie)
    // A transposed check digit, which the bank would reject the whole batch for.
    await withPayment(preparer.cookie, batchId, { creditorIban: 'NL91ABNA0417164301' })

    const batch = await handleGetBatch(await contextFor(preparer.cookie), batchId)
    expect(batch.body.payable).toBe(false)
    expect(batch.body.problems[0]).toMatchObject({
      code: 'invalid_iban',
      path: 'instructions.0.creditorIban',
    })
  })

  it('refuses to submit an unpayable batch, rather than wasting the approver', async () => {
    const preparer = await aPerson('bookkeeper')
    const batchId = await aBatch(preparer.cookie)
    await withPayment(preparer.cookie, batchId, { creditorIban: 'NL91ABNA0417164301' })

    await expect(
      handleTransitionBatch(
        await contextFor(preparer.cookie),
        batchId,
        transitionBatchBody.parse({ action: 'submit' }),
      ),
    ).rejects.toThrow(/not payable/)
  })

  it('refuses a duplicate end-to-end id, which a bank may read as a double payment', async () => {
    const preparer = await aPerson('bookkeeper')
    const batchId = await aBatch(preparer.cookie)
    await withPayment(preparer.cookie, batchId, { endToEndId: 'SAME' })

    await expect(withPayment(preparer.cookie, batchId, { endToEndId: 'SAME' })).rejects.toThrow()
  })
})

describe('the two-person rule', () => {
  it('refuses an approval by whoever submitted it', async () => {
    // The whole point, and the only thing between a compromised account and
    // the bank.
    const owner = await aPerson('owner')
    const batchId = await aBatch(owner.cookie)
    await withPayment(owner.cookie, batchId)

    await handleTransitionBatch(
      await contextFor(owner.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'submit' }),
    )

    await expect(
      handleTransitionBatch(
        await contextFor(owner.cookie),
        batchId,
        transitionBatchBody.parse({ action: 'approve' }),
      ),
    ).rejects.toThrow(/somebody other than the person who submitted/)
  })

  it('accepts an approval by somebody else', async () => {
    const preparer = await aPerson('bookkeeper')
    const approver = await aPerson('accountant')
    const batchId = await aBatch(preparer.cookie)
    await withPayment(preparer.cookie, batchId)

    await handleTransitionBatch(
      await contextFor(preparer.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'submit' }),
    )
    const approved = await handleTransitionBatch(
      await contextFor(approver.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'approve' }),
    )

    expect(approved.body).toMatchObject({ state: 'approved' })

    const batch = await handleGetBatch(await contextFor(preparer.cookie), batchId)
    // Both names are on the record, which is the point of a two-person flow.
    expect(batch.body.batch.submittedBy).toBe(preparer.userId)
    expect(batch.body.batch.approvedBy).toBe(approver.userId)
  })

  it('refuses a bookkeeper the approval at all, whoever submitted', async () => {
    const preparer = await aPerson('bookkeeper')
    const other = await aPerson('bookkeeper')
    const batchId = await aBatch(preparer.cookie)
    await withPayment(preparer.cookie, batchId)
    await handleTransitionBatch(
      await contextFor(preparer.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'submit' }),
    )

    // A bookkeeper prepares and cannot release. That is the first half of the
    // flow; the approver-is-not-submitter rule is the second.
    await expect(
      handleTransitionBatch(
        await contextFor(other.cookie),
        batchId,
        transitionBatchBody.parse({ action: 'approve' }),
      ),
    ).rejects.toThrow(/payments:approve/)
  })

  it('lets the submitter reject their own batch', async () => {
    // Spotting your own mistake should never need a second person.
    const preparer = await aPerson('bookkeeper')
    const batchId = await aBatch(preparer.cookie)
    await withPayment(preparer.cookie, batchId)
    await handleTransitionBatch(
      await contextFor(preparer.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'submit' }),
    )

    const rejected = await handleTransitionBatch(
      await contextFor(preparer.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'reject', reason: 'verkeerde datum' }),
    )
    expect(rejected.body).toMatchObject({ state: 'rejected' })

    const batches = await handleListBatches(await contextFor(preparer.cookie))
    expect(batches.body.batches.find((item) => item.id === batchId)?.rejectionReason).toBe(
      'verkeerde datum',
    )
  })

  it('forgets who submitted when a rejected batch is reopened', async () => {
    // Otherwise a second submit-approve cycle inherits the first's approver,
    // and the same person could submit and approve across the two.
    const preparer = await aPerson('bookkeeper')
    const batchId = await aBatch(preparer.cookie)
    await withPayment(preparer.cookie, batchId)
    await handleTransitionBatch(
      await contextFor(preparer.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'submit' }),
    )
    await handleTransitionBatch(
      await contextFor(preparer.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'reject' }),
    )
    await handleTransitionBatch(
      await contextFor(preparer.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'reopen' }),
    )

    const batch = await handleGetBatch(await contextFor(preparer.cookie), batchId)
    expect(batch.body.batch.state).toBe('draft')
    expect(batch.body.batch.submittedBy).toBeNull()
    expect(batch.body.batch.editable).toBe(true)
  })
})

describe('a submitted batch is frozen', () => {
  it('cannot be added to', async () => {
    // An approver who approves a batch that then changes has approved nothing.
    const preparer = await aPerson('bookkeeper')
    const batchId = await aBatch(preparer.cookie)
    await withPayment(preparer.cookie, batchId)
    await handleTransitionBatch(
      await contextFor(preparer.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'submit' }),
    )

    await expect(withPayment(preparer.cookie, batchId)).rejects.toThrow(/cannot be changed/)
  })
})

describe('the payment file', () => {
  it('is refused until the batch is approved', async () => {
    const preparer = await aPerson('bookkeeper')
    const batchId = await aBatch(preparer.cookie)
    await withPayment(preparer.cookie, batchId)

    await expect(handleGetBatchPain001(await contextFor(preparer.cookie), batchId)).rejects.toThrow(
      /has to be approved first/,
    )
  })

  it('comes out as pain.001 once two people have signed off', async () => {
    const preparer = await aPerson('bookkeeper')
    const approver = await aPerson('accountant')
    const reference = `BATCH-${randomUUID().slice(0, 8)}`
    const batchId = await aBatch(preparer.cookie, reference)
    await withPayment(preparer.cookie, batchId, { amount: '121000', endToEndId: 'INK-0042' })

    await handleTransitionBatch(
      await contextFor(preparer.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'submit' }),
    )
    await handleTransitionBatch(
      await contextFor(approver.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'approve' }),
    )

    const file = await handleGetBatchPain001(await contextFor(preparer.cookie), batchId)

    expect(file.filename).toBe(`${reference}.pain001.xml`)
    expect(file.xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.001.001.03')
    expect(file.xml).toContain('<CtrlSum>1210.00</CtrlSum>')
    expect(file.xml).toContain('<EndToEndId>INK-0042</EndToEndId>')
    expect(file.xml).toContain('<IBAN>NL02ABNA0123456789</IBAN>')
    expect(file.hash).toMatch(/^[0-9a-f]{64}$/)

    // The hash of the exact bytes is on the batch, so what the bank got and
    // what we can reproduce can be compared later (spec 8, rule 3).
    const batch = await handleGetBatch(await contextFor(preparer.cookie), batchId)
    expect(batch.body.batch.exportedHash).toBe(file.hash)
  })

  it('can be downloaded twice, and exporting is a separate act', async () => {
    const preparer = await aPerson('bookkeeper')
    const approver = await aPerson('accountant')
    const batchId = await aBatch(preparer.cookie)
    await withPayment(preparer.cookie, batchId)
    await handleTransitionBatch(
      await contextFor(preparer.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'submit' }),
    )
    await handleTransitionBatch(
      await contextFor(approver.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'approve' }),
    )

    // Twice is fine: a download that failed halfway is a download.
    const first = await handleGetBatchPain001(await contextFor(preparer.cookie), batchId)
    const second = await handleGetBatchPain001(await contextFor(preparer.cookie), batchId)
    expect(second.hash).toBe(first.hash)

    // Still approved, not exported, because "did we send it?" is a separate
    // question with a separate answer.
    let batch = await handleGetBatch(await contextFor(preparer.cookie), batchId)
    expect(batch.body.batch.state).toBe('approved')

    await handleTransitionBatch(
      await contextFor(preparer.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'export' }),
    )
    batch = await handleGetBatch(await contextFor(preparer.cookie), batchId)
    expect(batch.body.batch.state).toBe('exported')

    // And an exported batch still produces its file, for a bank that lost it.
    expect((await handleGetBatchPain001(await contextFor(preparer.cookie), batchId)).hash).toBe(
      first.hash,
    )
  })

  it('is refused when the batch has gone bad since approval', async () => {
    const preparer = await aPerson('bookkeeper')
    const approver = await aPerson('accountant')
    const batchId = await aBatch(preparer.cookie)
    await withPayment(preparer.cookie, batchId)
    await handleTransitionBatch(
      await contextFor(preparer.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'submit' }),
    )
    await handleTransitionBatch(
      await contextFor(approver.cookie),
      batchId,
      transitionBatchBody.parse({ action: 'approve' }),
    )

    // Corrupt the stored IBAN behind the API's back, as a bad migration or a
    // direct edit would. The file must not come out anyway.
    await database.execute(
      `update klopt.payment_instructions set creditor_iban = 'NL91ABNA0417164301'
       where batch_id = '${batchId}'`,
    )

    await expect(handleGetBatchPain001(await contextFor(preparer.cookie), batchId)).rejects.toThrow(
      /no longer payable/,
    )
  })
})

describe('who may do which half', () => {
  it('gives a bookkeeper prepare and withholds approve', async () => {
    // The asymmetry *is* the flow: the heaviest user of the system prepares
    // payments and is not the one who releases the money.
    const bookkeeper = await aPerson('bookkeeper')
    const context = await contextFor(bookkeeper.cookie)

    expect(context.permissions.has('payments:prepare')).toBe(true)
    expect(context.permissions.has('payments:approve')).toBe(false)
  })

  it('gives an accountant both, because somebody has to be able to approve', async () => {
    const accountant = await aPerson('accountant')
    const context = await contextFor(accountant.cookie)

    expect(context.permissions.has('payments:prepare')).toBe(true)
    expect(context.permissions.has('payments:approve')).toBe(true)
  })

  it('gives an auditor neither', async () => {
    const auditor = await aPerson('auditor')
    const context = await contextFor(auditor.cookie)

    expect(context.permissions.has('payments:prepare')).toBe(false)
    expect(context.permissions.has('payments:approve')).toBe(false)

    await expect(
      handleCreateBatch(
        context,
        createBatchBody.parse({
          reference: `X-${randomUUID().slice(0, 8)}`,
          bankAccountId,
          requestedExecutionDate: '2026-05-01',
        }),
      ),
    ).rejects.toThrow(/payments:prepare/)
  })
})

describe('through a scoped token rather than a session', () => {
  /** A token's actor id is not a `users` row, which is the point. */
  async function aToken(actorKind: 'human' | 'script', actorId: string) {
    const issued = await issueToken(database, {
      entityId,
      name: actorId,
      permissions: [
        'ledger:read',
        'ledger:export',
        'ledger:configure',
        'payments:prepare',
        'payments:approve',
      ],
      actorKind,
      actorId,
    })

    return async (key = uuidv7()) =>
      resolveRequestContext({
        database,
        request: new Request('https://klopt.test/api/v1/payment-batches', {
          headers: new Headers({
            authorization: `Bearer ${issued.token}`,
            'idempotency-key': key,
          }),
        }),
      })
  }

  it('submits and approves, because an actor is not always a user row', async () => {
    // `submitted_by` used to be a foreign key to `users.id`, so submitting with
    // a token was a 500. An actor id is free text for the same reason
    // `audit_log.actor_id` is.
    const alice = await aToken('human', `alice-${randomUUID().slice(0, 8)}`)
    const bob = await aToken('human', `bob-${randomUUID().slice(0, 8)}`)

    const created = await handleCreateBatch(
      await alice(),
      createBatchBody.parse({
        reference: `TOK-${randomUUID().slice(0, 8)}`,
        bankAccountId,
        requestedExecutionDate: '2026-05-01',
      }),
    )
    const batchId = (created.body as { id: string }).id

    await handleAddInstruction(
      await alice(),
      batchId,
      addInstructionBody.parse({
        endToEndId: 'TOK-1',
        creditorName: 'Telecom B.V.',
        creditorIban: 'NL20INGB0001234567',
        amount: '4550',
      }),
    )

    await handleTransitionBatch(
      await alice(),
      batchId,
      transitionBatchBody.parse({ action: 'submit' }),
    )
    const approved = await handleTransitionBatch(
      await bob(),
      batchId,
      transitionBatchBody.parse({ action: 'approve' }),
    )

    expect(approved.body).toMatchObject({ state: 'approved' })
  })

  it('refuses a script the approval, whoever submitted', async () => {
    // A scheduled job that approves whatever was submitted is one person with
    // a cron entry.
    const alice = await aToken('human', `alice-${randomUUID().slice(0, 8)}`)
    const robot = await aToken('script', `ci-${randomUUID().slice(0, 8)}`)

    const created = await handleCreateBatch(
      await alice(),
      createBatchBody.parse({
        reference: `TOK-${randomUUID().slice(0, 8)}`,
        bankAccountId,
        requestedExecutionDate: '2026-05-01',
      }),
    )
    const batchId = (created.body as { id: string }).id
    await handleAddInstruction(
      await alice(),
      batchId,
      addInstructionBody.parse({
        endToEndId: 'TOK-2',
        creditorName: 'Telecom B.V.',
        creditorIban: 'NL20INGB0001234567',
        amount: '4550',
      }),
    )
    await handleTransitionBatch(
      await alice(),
      batchId,
      transitionBatchBody.parse({ action: 'submit' }),
    )

    await expect(
      handleTransitionBatch(
        await robot(),
        batchId,
        transitionBatchBody.parse({ action: 'approve' }),
      ),
    ).rejects.toThrow(/has to be approved by a person/)
  })
})
