import { createFileRoute } from '@tanstack/react-router'
import { handlePostJournalEntries } from '~/api/handlers/ledger'
import { postJournalEntriesBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Import-shaped posting (spec 10.2).
 *
 * `/journal-entries/batch` rather than a flag on `/journal-entries`, because
 * the two answer differently: one entry answers 201 and the entry, a batch
 * answers 200 and a result per item. A single endpoint whose response shape
 * depends on the request body is one a generated client cannot type.
 */
export const Route = createFileRoute('/api/v1/journal-entries/batch')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(request, async (context) =>
          handlePostJournalEntries(
            context,
            parse(postJournalEntriesBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
