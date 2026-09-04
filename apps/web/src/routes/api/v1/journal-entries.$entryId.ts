import { createFileRoute } from '@tanstack/react-router'
import { handleGetJournalEntry } from '~/api/handlers/ledger'
import { handle } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/journal-entries/$entryId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handle(request, (context) => handleGetJournalEntry(context, params.entryId)),
    },
  },
})
