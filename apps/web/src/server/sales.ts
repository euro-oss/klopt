import { createServerFn } from '@tanstack/react-start'
import {
  handleCreateContact,
  handleDraftInvoice,
  handleGetDunningQueue,
  handleGetInvoice,
  handleIssueInvoice,
  handleListContacts,
  handleListDeliveries,
  handleListInvoices,
  handleListOverdueInvoices,
  handleListTaxCodes,
  handleSendDunningReminder,
  handleSendInvoice,
} from '~/api/handlers/sales'
import {
  createContactBody,
  draftInvoiceBody,
  issueInvoiceBody,
  sendInvoiceBody,
  sendReminderBody,
} from '~/api/schemas'
import { contextFromRequest, run, runWith } from './internal'

/**
 * The sales screens' RPC surface. Same handlers as `/api/v1/sales-invoices`.
 *
 * Writes carry an idempotency key in the payload: a browser cannot set the
 * header, and issuing an invoice twice allocates two numbers out of a series
 * that is legally required to be gapless.
 */

function keyOf(input: unknown): string | undefined {
  const value = (input as { idempotencyKey?: unknown } | null)?.idempotencyKey
  return typeof value === 'string' && value !== '' ? value : undefined
}

export const listContacts = createServerFn({ method: 'GET' })
  .validator((input: { customersOnly?: boolean }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleListContacts(await contextFromRequest(), {
            customersOnly: data.customersOnly ?? false,
          })
        ).body,
    ),
  )

export const createContact = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      createContactBody,
      data,
      async (body) =>
        (await handleCreateContact(await contextFromRequest({ idempotencyKey: keyOf(data) }), body))
          .body,
    ),
  )

export const listTaxCodes = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListTaxCodes(await contextFromRequest())).body),
)

export const listInvoices = createServerFn({ method: 'GET' })
  .validator((input: { status?: 'draft' | 'issued' | 'cancelled' | null; limit?: number }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleListInvoices(await contextFromRequest(), {
            status: data.status ?? null,
            limit: data.limit ?? 100,
          })
        ).body,
    ),
  )

export const getInvoice = createServerFn({ method: 'GET' })
  .validator((input: { invoiceId: string }) => input)
  .handler(async ({ data }) =>
    run(async () => (await handleGetInvoice(await contextFromRequest(), data.invoiceId)).body),
  )

export const draftInvoice = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      draftInvoiceBody,
      data,
      async (body) =>
        (await handleDraftInvoice(await contextFromRequest({ idempotencyKey: keyOf(data) }), body))
          .body,
    ),
  )

export const issueInvoice = createServerFn({ method: 'POST' })
  .validator((input: { invoiceId: string; idempotencyKey: string }) => input)
  .handler(async ({ data }) =>
    runWith(
      issueInvoiceBody,
      {},
      async (body) =>
        (
          await handleIssueInvoice(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            data.invoiceId,
            body,
          )
        ).body,
    ),
  )

export const listOverdueInvoices = createServerFn({ method: 'GET' })
  .validator((input: { asOf?: string }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleListOverdueInvoices(await contextFromRequest(), {
            asOf: data.asOf ?? new Date().toISOString().slice(0, 10),
          })
        ).body,
    ),
  )

export const sendInvoice = createServerFn({ method: 'POST' })
  .validator((input: { invoiceId: string; idempotencyKey: string; to?: string | null }) => input)
  .handler(async ({ data }) =>
    runWith(
      sendInvoiceBody,
      { to: data.to ?? null, embedUbl: true },
      async (body) =>
        (
          await handleSendInvoice(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            data.invoiceId,
            body,
          )
        ).body,
    ),
  )

export const listDeliveries = createServerFn({ method: 'GET' })
  .validator((input: { invoiceId: string }) => input)
  .handler(async ({ data }) =>
    run(async () => (await handleListDeliveries(await contextFromRequest(), data.invoiceId)).body),
  )

export const dunningQueue = createServerFn({ method: 'GET' })
  .validator((input: { asOf?: string }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleGetDunningQueue(await contextFromRequest(), {
            asOf: data.asOf ?? new Date().toISOString().slice(0, 10),
          })
        ).body,
    ),
  )

export const sendReminder = createServerFn({ method: 'POST' })
  .validator(
    (input: { invoiceId: string; idempotencyKey: string; expectedStage: number; asOf?: string }) =>
      input,
  )
  .handler(async ({ data }) =>
    runWith(
      sendReminderBody,
      {
        expectedStage: data.expectedStage,
        asOf: data.asOf ?? new Date().toISOString().slice(0, 10),
      },
      async (body) =>
        (
          await handleSendDunningReminder(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            data.invoiceId,
            body,
          )
        ).body,
    ),
  )
