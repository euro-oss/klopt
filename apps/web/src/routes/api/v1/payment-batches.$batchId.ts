import { createFileRoute } from '@tanstack/react-router'
import { handleGetBatch } from '~/api/handlers/payments'
import { handle } from '~/api/runtime'

/**
 * One batch, with everything wrong with it. The problems are recomputed on
 * every read, because a batch goes bad without being touched — a corrected
 * IBAN, an execution date that has passed.
 */
export const Route = createFileRoute('/api/v1/payment-batches/$batchId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handle(request, (context) => handleGetBatch(context, params.batchId)),
    },
  },
})
