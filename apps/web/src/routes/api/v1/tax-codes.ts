import { createFileRoute } from '@tanstack/react-router'
import { handleListTaxCodes } from '~/api/handlers/sales'
import { handle } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/tax-codes')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListTaxCodes(context)),
    },
  },
})
