import { createFileRoute } from '@tanstack/react-router'
import { handleAddInstruction } from '~/api/handlers/payments'
import { addInstructionBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/** Add a payment. Refused once the batch has been submitted. */
export const Route = createFileRoute('/api/v1/payment-batches/$batchId/instructions')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, async (context) =>
          handleAddInstruction(
            context,
            params.batchId,
            parse(addInstructionBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
