import { createFileRoute } from '@tanstack/react-router'
import { handleCreateTaxCodes, handleListTaxCodes } from '~/api/handlers/sales'
import { createTaxCodesBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/tax-codes')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListTaxCodes(context)),
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleCreateTaxCodes(
            context,
            parse(createTaxCodesBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
