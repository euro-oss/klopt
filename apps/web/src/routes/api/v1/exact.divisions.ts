import { createFileRoute } from '@tanstack/react-router'
import { handleListExactDivisions } from '~/api/handlers/exact'
import { handle } from '~/api/runtime'

/**
 * Every Exact administration this login can reach.
 *
 * The list is the point: one login reaches the operating BV, the holding, and
 * the practice and test divisions somebody made along the way, and each entry
 * carries whatever makes it unusual.
 */
export const Route = createFileRoute('/api/v1/exact/divisions')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListExactDivisions(context)),
    },
  },
})
