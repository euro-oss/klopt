import { createFileRoute } from '@tanstack/react-router'
import { handleSuggestMatches } from '~/api/handlers/bank'
import { handle } from '~/api/runtime'

/** What this line might be, with a confidence and a reason. Never a decision. */
export const Route = createFileRoute('/api/v1/bank-transactions/$transactionId/suggestions')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handle(request, (context) => handleSuggestMatches(context, params.transactionId)),
    },
  },
})
