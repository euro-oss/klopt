import { createFileRoute } from '@tanstack/react-router'
import { handleTransitionBatch } from '~/api/handlers/payments'
import { transitionBatchBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Submit, approve, reject, reopen or export. `approve` needs
 * `payments:approve` and the approver must not be the submitter — two people,
 * or nobody (spec 7.4).
 */
export const Route = createFileRoute('/api/v1/payment-batches/$batchId/transitions')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, async (context) =>
          handleTransitionBatch(
            context,
            params.batchId,
            parse(transitionBatchBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
