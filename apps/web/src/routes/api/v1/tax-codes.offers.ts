import { createFileRoute } from '@tanstack/react-router'
import { handleListTaxCodeOffers } from '~/api/handlers/sales'
import { handle } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/tax-codes/offers')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListTaxCodeOffers(context)),
    },
  },
})
