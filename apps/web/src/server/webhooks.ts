import { createServerFn } from '@tanstack/react-start'
import {
  handleCreateWebhook,
  handleDeleteWebhook,
  handleListWebhooks,
  handleReplayWebhook,
} from '~/api/handlers/webhooks'
import { createWebhookBody, replayWebhookBody } from '~/api/schemas'
import { contextFromRequest, run, runWith } from './internal'

/** The idempotency key the caller sent, if it sent one. As in the siblings. */
function keyOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const key = (input as { idempotencyKey?: unknown }).idempotencyKey
  return typeof key === 'string' ? key : undefined
}

/**
 * Webhook subscriptions, for the screen (spec 10.2).
 *
 * The same handlers `/api/v1/webhooks` uses. The screen is a client like any
 * other — spec 10.1's "none of them has a privileged path into the domain".
 */

export const listWebhooks = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListWebhooks(await contextFromRequest())).body),
)

export const createWebhook = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      createWebhookBody,
      data,
      async (body) =>
        (await handleCreateWebhook(await contextFromRequest({ idempotencyKey: keyOf(data) }), body))
          .body,
    ),
  )

export const deleteWebhook = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleDeleteWebhook(
            await contextFromRequest({ idempotencyKey: keyOf(data) }),
            (data as { endpointId: string }).endpointId,
          )
        ).body,
    ),
  )

export const replayWebhook = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      replayWebhookBody,
      data,
      async (body) =>
        (
          await handleReplayWebhook(
            await contextFromRequest({ idempotencyKey: keyOf(data) }),
            (data as { endpointId: string }).endpointId,
            body,
          )
        ).body,
    ),
  )
