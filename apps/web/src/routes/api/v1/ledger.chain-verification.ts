import { createFileRoute } from '@tanstack/react-router'
import { handleVerifyChain } from '~/api/handlers/ledger'
import { handle } from '~/api/runtime'

/**
 * Recompute the entity's hash chain and publish its head. This is the endpoint
 * that turns "trust us" into "verify us": an inspector records the head hash
 * now and checks it later (spec 6.2).
 */
export const Route = createFileRoute('/api/v1/ledger/chain-verification')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleVerifyChain(context)),
    },
  },
})
