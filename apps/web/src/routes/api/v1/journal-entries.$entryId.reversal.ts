import { createFileRoute } from '@tanstack/react-router'
import { handleReverseJournalEntry } from '~/api/handlers/ledger'
import { reverseJournalEntryBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Corrections are reversals (spec 6.2), so reversing is its own endpoint rather
 * than a DELETE. There is no DELETE on a journal entry, and there never will be.
 */
export const Route = createFileRoute('/api/v1/journal-entries/$entryId/reversal')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, async (context) =>
          handleReverseJournalEntry(
            context,
            params.entryId,
            parse(reverseJournalEntryBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
