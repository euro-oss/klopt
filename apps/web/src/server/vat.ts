import { createServerFn } from '@tanstack/react-start'
import {
  handleFileVatReturn,
  handleGetVatReturn,
  handleListVatFilings,
  handleListVatPeriods,
} from '~/api/handlers/vat'
import { fileVatReturnBody, listVatPeriodsQuery } from '~/api/schemas'
import { contextFromRequest, run, runWith } from './internal'

/** The BTW screens' RPC surface. Same handlers as `/api/v1/vat/*`. */

export const listVatPeriods = createServerFn({ method: 'GET' })
  .validator((input: { year: number }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleListVatPeriods(
            await contextFromRequest(),
            listVatPeriodsQuery.parse({ year: data.year }),
          )
        ).body,
    ),
  )

export const getVatReturn = createServerFn({ method: 'GET' })
  .validator((input: { period: string }) => input)
  .handler(async ({ data }) =>
    run(async () => (await handleGetVatReturn(await contextFromRequest(), data.period)).body),
  )

export const listVatFilings = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListVatFilings(await contextFromRequest())).body),
)

export const fileVatReturn = createServerFn({ method: 'POST' })
  .validator((input: { idempotencyKey: string; body: unknown }) => input)
  .handler(async ({ data }) =>
    runWith(
      fileVatReturnBody,
      data.body,
      async (body) =>
        (
          await handleFileVatReturn(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            body,
          )
        ).body,
    ),
  )
