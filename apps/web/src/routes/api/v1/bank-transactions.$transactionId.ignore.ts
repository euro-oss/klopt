import { createFileRoute } from '@tanstack/react-router'
import { handleIgnoreTransaction } from '~/api/handlers/bank'
import { handle } from '~/api/runtime'

/** Deliberately not booked, which is not the same as not yet looked at. */
export const Route = createFileRoute('/api/v1/bank-transactions/$transactionId/ignore')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, (context) => handleIgnoreTransaction(context, params.transactionId)),
    },
  },
})
