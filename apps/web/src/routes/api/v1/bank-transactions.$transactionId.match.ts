import { createFileRoute } from '@tanstack/react-router'
import { handleConfirmMatch } from '~/api/handlers/bank'
import { confirmMatchBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Book it. Posts the entry, allocates to invoices and learns the rule, all in
 * one transaction — see the handler for why that has to be true.
 */
export const Route = createFileRoute('/api/v1/bank-transactions/$transactionId/match')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, async (context) =>
          handleConfirmMatch(
            context,
            params.transactionId,
            parse(confirmMatchBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
