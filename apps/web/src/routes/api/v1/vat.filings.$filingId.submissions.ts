import { createFileRoute } from '@tanstack/react-router'
import { handleGetFilingSubmissions } from '~/api/handlers/vat'
import { handle } from '~/api/runtime'

/** A filing's delivery history: spec 7.2's evidence chain. */
export const Route = createFileRoute('/api/v1/vat/filings/$filingId/submissions')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handle(request, (context) => handleGetFilingSubmissions(context, params.filingId)),
    },
  },
})
