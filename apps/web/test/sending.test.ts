import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { createEmailEInvoiceTransport, createMemoryEmailTransport } from '@klopt/adapters'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { setEInvoiceTransportForTest } from '../src/api/e-invoice.js'
import { ApiError } from '../src/api/errors.js'
import {
  handleCreateContact,
  handleDraftInvoice,
  handleGetDunningQueue,
  handleIssueInvoice,
  handleListDeliveries,
  handleSendDunningReminder,
  handleSendInvoice,
} from '../src/api/handlers/sales.js'
import { handleUpdateEntity } from '../src/api/handlers/setup.js'
import {
  createContactBody,
  draftInvoiceBody,
  issueInvoiceBody,
  sendInvoiceBody,
  sendReminderBody,
} from '../src/api/schemas.js'

/**
 * Sending an invoice, and chasing it.
 *
 * Against a real database and the real email transport, with a memory backend
 * standing in for SMTP. What the memory transport buys is that the assertions
 * are about the message that would have gone out — its subject, its
 * attachments, the words in it — rather than about a mock having been called.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let entityId: string
let token: string

const mailbox = createMemoryEmailTransport()

const request = (idempotencyKey?: string): Request => {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/api/v1/sales-invoices', { headers })
}

const contextFor = async (idempotencyKey?: string) =>
  resolveRequestContext({ database, request: request(idempotencyKey) })

async function aCustomer(options: { email?: string | null } = {}): Promise<string> {
  const number = `DEB-${randomUUID().slice(0, 8)}`
  await handleCreateContact(
    await contextFor(uuidv7()),
    createContactBody.parse({
      number,
      name: 'Grote Klant N.V.',
      isCustomer: true,
      kvkNumber: '87654321',
      vatNumber: 'NL987654321B01',
      email: options.email === undefined ? 'inkoop@groteklant.nl' : options.email,
      address: {
        street: 'Coolsingel',
        houseNumber: '42',
        postalCode: '3011 AD',
        city: 'Rotterdam',
        countryCode: 'NL',
      },
    }),
  )
  return number
}

async function anIssuedInvoice(contactNumber: string, issueDate = '2026-03-15'): Promise<string> {
  const draft = await handleDraftInvoice(
    await contextFor(uuidv7()),
    draftInvoiceBody.parse({
      contactNumber,
      issueDate,
      buyerReference: 'KOSTENPLAATS-42',
      lines: [
        {
          description: 'Advieswerk',
          quantity: '10',
          unitCode: 'HUR',
          unitPrice: '10000',
          revenueAccountNumber: '8000',
          taxCode: 'H21',
        },
      ],
    }),
  )
  const invoiceId = (draft.body as { id: string }).id
  await handleIssueInvoice(await contextFor(uuidv7()), invoiceId, issueInvoiceBody.parse({}))
  return invoiceId
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
  setEInvoiceTransportForTest(createEmailEInvoiceTransport({ email: mailbox }))

  entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)

  const issued = await issueToken(database, {
    entityId,
    name: 'sending-test',
    permissions: ['*'],
    actorKind: 'script',
    actorId: 'test',
  })
  token = issued.token

  // The seller details a Dutch BIS invoice cannot go without.
  await handleUpdateEntity(await contextFor(), {
    legalName: 'Test Beheer B.V.',
    street: 'Keizersgracht',
    houseNumber: '123-B',
    postalCode: '1015 CJ',
    city: 'Amsterdam',
    countryCode: 'NL',
    kvkNumber: '12345678',
    vatNumber: 'NL123456789B01',
    iban: 'NL02ABNA0123456789',
  })
}, 60_000)

afterEach(() => {
  mailbox.sent.length = 0
})

afterAll(async () => {
  // Take away the fixtures that would otherwise keep the worker busy.
  await cleanupSeededBackgroundWork(database)
  setEInvoiceTransportForTest(null)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('sending an invoice', () => {
  it('sends both documents and records what went out', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer())
    const result = await handleSendInvoice(
      await contextFor(uuidv7()),
      invoiceId,
      sendInvoiceBody.parse({}),
    )

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ delivered: true, channel: 'email' })

    const message = mailbox.sent.at(-1)
    expect(message?.to).toBe('inkoop@groteklant.nl')
    expect(message?.subject).toContain('Factuur')
    // The XML is what a machine reads and the PDF what a person does. Both.
    const attachments = message?.attachments ?? []
    expect(attachments.map((item) => item.contentType).sort()).toEqual([
      'application/pdf',
      'application/xml',
    ])
    expect(attachments.find((item) => item.contentType === 'application/xml')?.filename).toMatch(
      /\.ubl\.xml$/,
    )

    // And the evidence chain has it, with the hash of the exact document.
    const deliveries = await handleListDeliveries(await contextFor(), invoiceId)
    expect(deliveries.body.deliveries).toHaveLength(1)
    expect(deliveries.body.deliveries[0]).toMatchObject({
      channel: 'email',
      purpose: 'invoice',
      delivered: true,
      recipient: 'inkoop@groteklant.nl',
    })
    expect(deliveries.body.deliveries[0]?.documentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('sends the same document it would have handed you to download', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer())
    await handleSendInvoice(await contextFor(uuidv7()), invoiceId, sendInvoiceBody.parse({}))

    const xml = mailbox.sent
      .at(-1)
      ?.attachments?.find((item) => item.contentType === 'application/xml')?.content
    expect(String(xml)).toContain('urn:cen.eu:en16931:2017#compliant')
    expect(String(xml)).toContain('<cbc:PayableAmount currencyID="EUR">1210.00<')
  })

  it('refuses a customer with no address rather than sending nowhere', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer({ email: null }))

    await expect(
      handleSendInvoice(await contextFor(uuidv7()), invoiceId, sendInvoiceBody.parse({})),
    ).rejects.toThrow(/no email address/)
    expect(mailbox.sent).toHaveLength(0)
  })

  it('accepts a one-off address without changing the contact', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer({ email: null }))
    const result = await handleSendInvoice(
      await contextFor(uuidv7()),
      invoiceId,
      sendInvoiceBody.parse({ to: 'iemand@elders.nl' }),
    )

    expect(result.status).toBe(200)
    expect(mailbox.sent.at(-1)?.to).toBe('iemand@elders.nl')
  })

  it('will not send an invoice the schematron rejects', async () => {
    const number = `DEB-${randomUUID().slice(0, 8)}`
    await handleCreateContact(
      await contextFor(uuidv7()),
      createContactBody.parse({
        number,
        name: 'Klant Zonder Adres B.V.',
        isCustomer: true,
        email: 'zonder@adres.nl',
        countryCode: 'NL',
      }),
    )
    const invoiceId = await anIssuedInvoice(number)

    // Nothing leaves that has not passed the published rules — the guarantee
    // is on the send path, not only on the download.
    await expect(
      handleSendInvoice(await contextFor(uuidv7()), invoiceId, sendInvoiceBody.parse({})),
    ).rejects.toThrow(ApiError)
    expect(mailbox.sent).toHaveLength(0)
  })

  it('refuses a draft', async () => {
    const draft = await handleDraftInvoice(
      await contextFor(uuidv7()),
      draftInvoiceBody.parse({
        contactNumber: await aCustomer(),
        issueDate: '2026-03-15',
        buyerReference: 'X',
        lines: [
          {
            description: 'Concept',
            quantity: '1',
            unitPrice: '10000',
            revenueAccountNumber: '8000',
            taxCode: 'H21',
          },
        ],
      }),
    )

    await expect(
      handleSendInvoice(
        await contextFor(uuidv7()),
        (draft.body as { id: string }).id,
        sendInvoiceBody.parse({}),
      ),
    ).rejects.toThrow(/draft cannot be sent/)
  })

  it('records a failure and leaves the invoice alone', async () => {
    // Spec 8, rule 4: an adapter failing never blocks bookkeeping. A bounced
    // message must leave a row, not an exception.
    setEInvoiceTransportForTest({
      channel: 'email',
      name: 'broken',
      reachable: () => Promise.resolve(true),
      send: () =>
        Promise.resolve({
          channel: 'email' as const,
          transport: 'broken',
          delivered: false,
          messageId: null,
          recipient: 'inkoop@groteklant.nl',
          failure: 'Connection refused',
        }),
    })

    try {
      const invoiceId = await anIssuedInvoice(await aCustomer())
      const result = await handleSendInvoice(
        await contextFor(uuidv7()),
        invoiceId,
        sendInvoiceBody.parse({}),
      )

      // 502, not a throw: it was attempted, and the attempt is the record.
      expect(result.status).toBe(502)
      expect(result.body).toMatchObject({ delivered: false, failure: 'Connection refused' })

      const deliveries = await handleListDeliveries(await contextFor(), invoiceId)
      expect(deliveries.body.deliveries[0]).toMatchObject({
        delivered: false,
        failure: 'Connection refused',
      })
    } finally {
      setEInvoiceTransportForTest(createEmailEInvoiceTransport({ email: mailbox }))
    }
  })
})

describe('chasing an unpaid invoice', () => {
  it('appears in the queue once it is a week late, with the right letter', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer(), '2026-03-01')
    // Terms are 30 days, so due 2026-03-31. Seven days later is 2026-04-07.
    const queue = await handleGetDunningQueue(await contextFor(), { asOf: '2026-04-07' })

    const action = queue.body.actions.find((item) => item.invoiceId === invoiceId)
    expect(action).toMatchObject({
      stage: 1,
      stageLabel: 'Betalingsherinnering',
      daysOverdue: 7,
      sendable: true,
    })
  })

  it('sends the reminder, and then stops offering it', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer(), '2026-03-01')

    const sent = await handleSendDunningReminder(
      await contextFor(uuidv7()),
      invoiceId,
      sendReminderBody.parse({ asOf: '2026-04-07' }),
    )

    expect(sent.status).toBe(200)
    expect(sent.body).toMatchObject({ stage: 1, delivered: true })

    const message = mailbox.sent.at(-1)
    expect(message?.subject).toContain('Betalingsherinnering')
    // A first reminder is a courtesy, not a threat.
    expect(message?.text).toContain('aan uw aandacht ontsnapt')
    expect(message?.text).not.toContain('incassokosten')

    // Gone from the queue on the same day, because the stage is closed.
    const queue = await handleGetDunningQueue(await contextFor(), { asOf: '2026-04-07' })
    expect(queue.body.actions.map((item) => item.invoiceId)).not.toContain(invoiceId)

    // And asking again is a conflict rather than a second letter.
    await expect(
      handleSendDunningReminder(
        await contextFor(uuidv7()),
        invoiceId,
        sendReminderBody.parse({ asOf: '2026-04-07' }),
      ),
    ).rejects.toThrow(/no reminder due/)
  })

  it('escalates when the next stage comes due, and the tone hardens', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer(), '2026-03-01')
    await handleSendDunningReminder(
      await contextFor(uuidv7()),
      invoiceId,
      sendReminderBody.parse({ asOf: '2026-04-07' }),
    )

    const second = await handleSendDunningReminder(
      await contextFor(uuidv7()),
      invoiceId,
      sendReminderBody.parse({ asOf: '2026-04-21' }),
    )
    expect(second.body).toMatchObject({ stage: 2 })

    const final = await handleSendDunningReminder(
      await contextFor(uuidv7()),
      invoiceId,
      sendReminderBody.parse({ asOf: '2026-05-12' }),
    )
    expect(final.body).toMatchObject({ stage: 3 })
    expect(mailbox.sent.at(-1)?.text).toContain('incassokosten')

    // Three reminders and the invoice, all on the record with their stages.
    const deliveries = await handleListDeliveries(await contextFor(), invoiceId)
    expect(
      deliveries.body.deliveries
        .filter((item) => item.purpose === 'reminder')
        .map((item) => item.dunningStage),
    ).toEqual([1, 2, 3])
  })

  it('refuses a stage the caller did not expect, rather than sending the wrong letter', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer(), '2026-01-01')

    // A screen that has been open a while thinks this is stage 1; by now the
    // invoice is due a final demand.
    await expect(
      handleSendDunningReminder(
        await contextFor(uuidv7()),
        invoiceId,
        sendReminderBody.parse({ asOf: '2026-05-01', expectedStage: 1 }),
      ),
    ).rejects.toThrow(/not stage 1/)
    expect(mailbox.sent).toHaveLength(0)
  })

  it('does not chase an invoice that is not yet due', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer(), '2026-03-15')
    const queue = await handleGetDunningQueue(await contextFor(), { asOf: '2026-04-01' })
    expect(queue.body.actions.map((item) => item.invoiceId)).not.toContain(invoiceId)
  })

  it('reports the total overdue, which is the number somebody actually wants', async () => {
    const queue = await handleGetDunningQueue(await contextFor(), { asOf: '2027-01-01' })
    expect(BigInt(queue.body.totalOverdue)).toBeGreaterThan(0n)
    expect(queue.body.schedule).toHaveLength(3)
  })
})
