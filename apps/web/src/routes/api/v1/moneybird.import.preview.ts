import { createFileRoute } from '@tanstack/react-router'
import { handlePreviewMoneybirdImport } from '~/api/handlers/moneybird'
import { handle } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/moneybird/import/preview')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handlePreviewMoneybirdImport(context)),
    },
  },
})
