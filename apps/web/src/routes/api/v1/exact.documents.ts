import { createFileRoute } from '@tanstack/react-router'
import { handleExactDocumentStatus, handleImportExactDocuments } from '~/api/handlers/exact'
import { handle } from '~/api/runtime'

/** The document archive: ask for it, and watch it. */
export const Route = createFileRoute('/api/v1/exact/documents')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleExactDocumentStatus(context)),
      POST: ({ request }) => handle(request, (context) => handleImportExactDocuments(context)),
    },
  },
})
