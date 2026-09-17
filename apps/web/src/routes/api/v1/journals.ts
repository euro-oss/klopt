import { createFileRoute } from '@tanstack/react-router'
import { handleListJournals } from '~/api/handlers/ledger'
import { handle } from '~/api/runtime'

/** The dagboeken this administration posts through. */
export const Route = createFileRoute('/api/v1/journals')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListJournals(context)),
    },
  },
})
