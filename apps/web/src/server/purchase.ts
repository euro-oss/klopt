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
  transitionPurchaseInvoiceBody,
} from '~/api/schemas'
import { contextFromRequest, run, runWith } from './internal'

/** The purchase screens' RPC surface. Same handlers as `/api/v1/purchase-*`. */

export const listPurchaseInvoices = createServerFn({ method: 'GET' })
  .validator((input: { status?: string; openOnly?: boolean }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleListPurchaseInvoices(await contextFromRequest(), {
            ...(data.status === undefined ? {} : { status: data.status }),
            ...(data.openOnly === undefined ? {} : { openOnly: data.openOnly }),
          })
        ).body,
    ),
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
