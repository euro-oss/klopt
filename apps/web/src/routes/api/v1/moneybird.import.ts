import { createFileRoute } from '@tanstack/react-router'
import { handleMoneybirdImportStatus, handleRunMoneybirdImport } from '~/api/handlers/moneybird'
import { handle } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/moneybird/import')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleMoneybirdImportStatus(context)),
      POST: ({ request }) => handle(request, (context) => handleRunMoneybirdImport(context)),
    },
  },
})
