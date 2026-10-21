import { createFileRoute } from '@tanstack/react-router'
import { handleDeactivateTaxCode } from '~/api/handlers/sales'
import { deactivateTaxCodeBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Close an unused tax-code window (`valid_to` only).
 *
 * Rate and rubriek changes are never PATCH fields: a rate change is a new row
 * with a new valid_from (migration 0012), which this PR does not offer.
 */
export const Route = createFileRoute('/api/v1/tax-codes/$taxCodeId')({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        handle(request, async (context) =>
          handleDeactivateTaxCode(
            context,
            params.taxCodeId,
            parse(deactivateTaxCodeBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
