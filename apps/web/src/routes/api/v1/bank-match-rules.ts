import { createFileRoute } from '@tanstack/react-router'
import { handleListMatchRules } from '~/api/handlers/bank'
import { handle } from '~/api/runtime'

/**
 * The rules the matcher has learned. "Visible and editable, never a black box"
 * (spec 7.4) starts with being listable.
 */
export const Route = createFileRoute('/api/v1/bank-match-rules')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListMatchRules(context)),
    },
  },
})
