import { createFileRoute } from '@tanstack/react-router'
import { handleCheckVatNumbers } from '~/api/handlers/vat'
import { handle, parse, readJson } from '~/api/runtime'
import { checkVatNumbersBody } from '~/api/schemas'

/**
 * Ask VIES about counterparty VAT numbers and keep what it said. The answer and
 * its timestamp are the evidence for applying the zero rate, so this is a write.
 */
export const Route = createFileRoute('/api/v1/vat/number-checks')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleCheckVatNumbers(
            context,
            parse(checkVatNumbersBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
