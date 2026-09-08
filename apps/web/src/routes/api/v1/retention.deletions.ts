import { createFileRoute } from '@tanstack/react-router'
import { handleDeleteDocuments } from '~/api/handlers/retention'
import { deleteDocumentsBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Deleting documents whose bewaarplicht has run out.
 *
 * `POST` rather than `DELETE`, and a resource called `deletions` rather than a
 * verb: this is a batch with a reason attached, and the record that it happened
 * is as much the point as the deletion. A `DELETE` with a body is also a thing
 * intermediaries feel free to strip.
 */
export const Route = createFileRoute('/api/v1/retention/deletions')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleDeleteDocuments(
            context,
            parse(deleteDocumentsBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
