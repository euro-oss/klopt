import { createFileRoute } from '@tanstack/react-router'
import { handlePollFilingStatus } from '~/api/handlers/vat'
import { handle } from '~/api/runtime'

/**
 * Ask the transport where a filing has got to. Received is not accepted, and
 * the gap between them is where every real problem lives.
 */
export const Route = createFileRoute('/api/v1/vat/filings/$filingId/status')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, (context) => handlePollFilingStatus(context, params.filingId)),
    },
  },
})
