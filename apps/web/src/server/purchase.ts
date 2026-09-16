import { createServerFn } from '@tanstack/react-start'
import {
  handleBookPurchaseInvoice,
  handleCapturePurchaseInvoice,
  handleGetCreditorAgeing,
  handleGetPurchaseInvoice,
  handleListPurchaseInvoices,
  handleTransitionPurchaseInvoice,
} from '~/api/handlers/purchase'
import {
  bookPurchaseInvoiceBody,
  capturePurchaseInvoiceBody,
  creditorAgeingQuery,
  listPurchaseInvoicesQuery,
  transitionPurchaseInvoiceBody,
} from '~/api/schemas'
import { contextFromRequest, run, runWith } from './internal'

/** The purchase screens' RPC surface. Same handlers as `/api/v1/purchase-*`. */

export const listPurchaseInvoices = createServerFn({ method: 'GET' })
  // Through the same schema the route parses, rather than a looser shape
  // beside it: the screen and the endpoint should not disagree about what a
  // status is.
  .validator((input: unknown) => listPurchaseInvoicesQuery.parse(input ?? {}))
  .handler(async ({ data }) =>
    run(async () => (await handleListPurchaseInvoices(await contextFromRequest(), data)).body),
  )

export const getPurchaseInvoice = createServerFn({ method: 'GET' })
  .validator((input: { invoiceId: string }) => input)
  .handler(async ({ data }) =>
    run(
      async () => (await handleGetPurchaseInvoice(await contextFromRequest(), data.invoiceId)).body,
    ),
  )

export const capturePurchaseInvoice = createServerFn({ method: 'POST' })
  .validator((input: { idempotencyKey: string; body: unknown }) => input)
  .handler(async ({ data }) =>
    runWith(
      capturePurchaseInvoiceBody,
      data.body,
      async (body) =>
        (
          await handleCapturePurchaseInvoice(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            body,
          )
        ).body,
    ),
  )

export const bookPurchaseInvoice = createServerFn({ method: 'POST' })
  .validator((input: { invoiceId: string; idempotencyKey: string; body: unknown }) => input)
  .handler(async ({ data }) =>
    runWith(
      bookPurchaseInvoiceBody,
      data.body,
      async (body) =>
        (
          await handleBookPurchaseInvoice(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            data.invoiceId,
            body,
          )
        ).body,
    ),
  )

export const transitionPurchaseInvoice = createServerFn({ method: 'POST' })
  .validator((input: { invoiceId: string; idempotencyKey: string; body: unknown }) => input)
  .handler(async ({ data }) =>
    runWith(
      transitionPurchaseInvoiceBody,
      data.body,
      async (body) =>
        (
          await handleTransitionPurchaseInvoice(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            data.invoiceId,
            body,
          )
        ).body,
    ),
  )

export const getCreditorAgeing = createServerFn({ method: 'GET' })
  .validator((input: { asOf: string }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleGetCreditorAgeing(
            await contextFromRequest(),
            creditorAgeingQuery.parse({ asOf: data.asOf }),
          )
        ).body,
    ),
  )
