import { createFileRoute } from '@tanstack/react-router'
import { handleListJournalEntries, handlePostJournalEntry } from '~/api/handlers/ledger'
import { listEntriesQuery, postJournalEntryBody } from '~/api/schemas'
import { handle, parse, readJson, searchParams } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/journal-entries')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleListJournalEntries(
            context,
            parse(listEntriesQuery, searchParams(request), 'The query string'),
          ),
        ),

      POST: ({ request }) =>
        handle(request, async (context) =>
          handlePostJournalEntry(
            context,
            parse(postJournalEntryBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
