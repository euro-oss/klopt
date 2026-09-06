import { createServerFn } from '@tanstack/react-start'
import { handleGetEntity, handleUpdateEntity } from '~/api/handlers/setup'
import { updateEntityBody } from '~/api/schemas'
import { contextFromRequest, run, runWith } from './internal'

/** The settings screen's RPC surface. Same handlers as `/api/v1/entity`. */

export const getEntity = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleGetEntity(await contextFromRequest())).body),
)

export const updateEntity = createServerFn({ method: 'POST' })
  // Pass-through, so that a bad field is reported by `runWith` rather than
  // escaping the server function as an unhandled rejection. See ./internal.
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      updateEntityBody,
      data,
      async (body) => (await handleUpdateEntity(await contextFromRequest(), body)).body,
    ),
  )
