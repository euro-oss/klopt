import { createServerFn } from '@tanstack/react-start'
import {
  handleDiscardInboxItem,
  handleDraftFromInbox,
  handleListInbox,
  handleReceiveDocument,
} from '~/api/handlers/inbox'
import {
  handleAddInboundSource,
  handleListInboundSources,
  handlePollInboundSource,
  handleRemoveInboundSource,
} from '~/api/handlers/inbound-sources'
import { addInboundSourceBody, discardInboxItemBody, draftFromInboxBody } from '~/api/schemas'
import { contextFromRequest, run, runWith } from './internal'

/** The inbox screen's RPC surface. Same handlers as `/api/v1/inbox`. */

export const listInbox = createServerFn({ method: 'GET' })
  .validator((input: { state?: 'new' | 'drafted' | 'discarded' }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleListInbox(await contextFromRequest(), {
            ...(data.state === undefined ? {} : { state: data.state }),
          })
        ).body,
    ),
  )

/**
 * Uploading from the browser.
 *
 * The bytes arrive base64-encoded because a server function's payload is JSON.
 * The REST route takes `multipart/form-data` and is what a mail gateway or an
 * access point should use — inflating every invoice by a third is a price worth
 * paying once for a file input, not on every machine-to-machine delivery.
 */
export const receiveDocument = createServerFn({ method: 'POST' })
  .validator(
    (input: { idempotencyKey: string; filename: string; contentType: string; base64: string }) =>
      input,
  )
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleReceiveDocument(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            {
              bytes: new Uint8Array(Buffer.from(data.base64, 'base64')),
              filename: data.filename === '' ? null : data.filename,
              contentType: data.contentType === '' ? null : data.contentType,
              source: 'upload',
              receivedFrom: null,
              subject: null,
            },
          )
        ).body,
    ),
  )

export const draftFromInbox = createServerFn({ method: 'POST' })
  .validator((input: { itemId: string; idempotencyKey: string; body: unknown }) => input)
  .handler(async ({ data }) =>
    runWith(
      draftFromInboxBody,
      data.body,
      async (body) =>
        (
          await handleDraftFromInbox(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            data.itemId,
            body,
          )
        ).body,
    ),
  )

export const discardInboxItem = createServerFn({ method: 'POST' })
  .validator((input: { itemId: string; idempotencyKey: string; body: unknown }) => input)
  .handler(async ({ data }) =>
    runWith(
      discardInboxItemBody,
      data.body,
      async (body) =>
        (
          await handleDiscardInboxItem(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            data.itemId,
            body,
          )
        ).body,
    ),
  )

/**
 * The mailboxes this administration receives on, and adding one.
 *
 * `pollInboundSource` runs the same code the worker's schedule runs, which is
 * the point of the button: it proves the schedule works rather than proving
 * something else does.
 */
export const listInboundSources = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListInboundSources(await contextFromRequest())).body),
)

export const addInboundSource = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      addInboundSourceBody,
      data,
      async (body) => (await handleAddInboundSource(await contextFromRequest(), body)).body,
    ),
  )

export const removeInboundSource = createServerFn({ method: 'POST' })
  .validator((input: { sourceId: string }) => input)
  .handler(async ({ data }) =>
    run(
      async () => (await handleRemoveInboundSource(await contextFromRequest(), data.sourceId)).body,
    ),
  )

export const pollInboundSource = createServerFn({ method: 'POST' })
  .validator((input: { sourceId: string }) => input)
  .handler(async ({ data }) =>
    run(
      async () => (await handlePollInboundSource(await contextFromRequest(), data.sourceId)).body,
    ),
  )
