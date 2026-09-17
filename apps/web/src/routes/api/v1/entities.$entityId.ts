import { createFileRoute } from '@tanstack/react-router'
import { handleCreateEntity } from '~/api/handlers/setup'
import { createEntityBody } from '~/api/schemas'
import { handleUnscoped, parse, readJson } from '~/api/runtime'

/**
 * PUT, not POST, and the id is the caller's.
 *
 * Creating an administration is the one write with nowhere to record an
 * idempotency key — that table is keyed by entity, and there is no entity yet.
 * A client-chosen id makes the operation idempotent by construction instead: a
 * retry, or a double-submitted form, lands on the administration the first
 * request created.
 */
export const Route = createFileRoute('/api/v1/entities/$entityId')({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        handleUnscoped(request, async (context) =>
          handleCreateEntity(
            context,
            params.entityId,
            parse(createEntityBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
