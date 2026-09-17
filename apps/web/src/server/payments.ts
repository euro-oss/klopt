import { createServerFn } from '@tanstack/react-start'
import {
  handleAddApprovedInvoices,
  handleAddInstruction,
  handleCreateBatch,
  handleGetBatch,
  handleListBatches,
  handlePreviewPaymentRun,
  handleRemoveInstruction,
  handleTransitionBatch,
} from '~/api/handlers/payments'
import { addInstructionBody, createBatchBody, transitionBatchBody } from '~/api/schemas'
import { contextFromRequest, run, runWith } from './internal'

/** The payment screens' RPC surface. Same handlers as `/api/v1/payment-batches`. */

function keyOf(input: unknown): string | undefined {
  const value = (input as { idempotencyKey?: unknown } | null)?.idempotencyKey
  return typeof value === 'string' && value !== '' ? value : undefined
}

export const listPaymentBatches = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListBatches(await contextFromRequest())).body),
)

export const getPaymentBatch = createServerFn({ method: 'GET' })
  .validator((input: { batchId: string }) => input)
  .handler(async ({ data }) =>
    run(async () => (await handleGetBatch(await contextFromRequest(), data.batchId)).body),
  )

export const createPaymentBatch = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      createBatchBody,
      data,
      async (body) =>
        (await handleCreateBatch(await contextFromRequest({ idempotencyKey: keyOf(data) }), body))
          .body,
    ),
  )

export const addPaymentInstruction = createServerFn({ method: 'POST' })
  .validator((input: { batchId: string; idempotencyKey: string; body: unknown }) => input)
  .handler(async ({ data }) =>
    runWith(
      addInstructionBody,
      data.body,
      async (body) =>
        (
          await handleAddInstruction(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            data.batchId,
            body,
          )
        ).body,
    ),
  )

export const removePaymentInstruction = createServerFn({ method: 'POST' })
  .validator((input: { batchId: string; instructionId: string; idempotencyKey: string }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleRemoveInstruction(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            data.batchId,
            data.instructionId,
          )
        ).body,
    ),
  )

export const transitionPaymentBatch = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      batchId: string
      idempotencyKey: string
      action: 'submit' | 'approve' | 'reject' | 'reopen' | 'export'
      reason?: string | null
    }) => input,
  )
  .handler(async ({ data }) =>
    runWith(
      transitionBatchBody,
      { action: data.action, reason: data.reason ?? null },
      async (body) =>
        (
          await handleTransitionBatch(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            data.batchId,
            body,
          )
        ).body,
    ),
  )

export const previewPaymentRun = createServerFn({ method: 'GET' })
  .validator((input: { batchId: string }) => input)
  .handler(async ({ data }) =>
    run(async () => (await handlePreviewPaymentRun(await contextFromRequest(), data.batchId)).body),
  )

export const addApprovedInvoices = createServerFn({ method: 'POST' })
  .validator((input: { batchId: string; idempotencyKey: string }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleAddApprovedInvoices(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            data.batchId,
          )
        ).body,
    ),
  )
