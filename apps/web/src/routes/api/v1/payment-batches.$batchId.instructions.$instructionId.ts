import { createFileRoute } from '@tanstack/react-router'
import { handleRemoveInstruction } from '~/api/handlers/payments'
import { handle } from '~/api/runtime'

/** Take a payment out of a draft batch. */
export const Route = createFileRoute(
  '/api/v1/payment-batches/$batchId/instructions/$instructionId',
)({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        handle(request, (context) =>
          handleRemoveInstruction(context, params.batchId, params.instructionId),
        ),
    },
  },
})
