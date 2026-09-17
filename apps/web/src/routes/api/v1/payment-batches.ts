import { createFileRoute } from '@tanstack/react-router'
import { handleCreateBatch, handleListBatches } from '~/api/handlers/payments'
import { createBatchBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/** Payment batches, and starting one. */
export const Route = createFileRoute('/api/v1/payment-batches')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListBatches(context)),
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleCreateBatch(
            context,
            parse(createBatchBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
