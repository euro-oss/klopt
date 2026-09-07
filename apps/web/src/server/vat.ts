import { createServerFn } from '@tanstack/react-start'
import {
  handleCheckVatNumbers,
  handleFileVatReturn,
  handleGetIcp,
  handleGetVatReturn,
  handleListVatFilings,
  handleListVatPeriods,
} from '~/api/handlers/vat'
import { checkVatNumbersBody, fileVatReturnBody, listVatPeriodsQuery } from '~/api/schemas'
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

export const getIcp = createServerFn({ method: 'GET' })
  .validator((input: { period: string }) => input)
  .handler(async ({ data }) =>
    run(async () => (await handleGetIcp(await contextFromRequest(), data.period)).body),
  )

export const checkVatNumbers = createServerFn({ method: 'POST' })
  .validator((input: { idempotencyKey: string; body: unknown }) => input)
  .handler(async ({ data }) =>
    runWith(
      checkVatNumbersBody,
      data.body,
      async (body) =>
        (
          await handleCheckVatNumbers(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            body,
          )
        ).body,
    ),
  )
