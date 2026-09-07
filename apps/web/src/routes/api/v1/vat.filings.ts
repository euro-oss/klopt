import { createFileRoute } from '@tanstack/react-router'
import { handleFileVatReturn, handleListVatFilings } from '~/api/handlers/vat'
import { handle, parse, readJson } from '~/api/runtime'
import { fileVatReturnBody } from '~/api/schemas'

/** Everything filed, and the act of filing. */
export const Route = createFileRoute('/api/v1/vat/filings')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListVatFilings(context)),
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleFileVatReturn(
            context,
            parse(fileVatReturnBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
