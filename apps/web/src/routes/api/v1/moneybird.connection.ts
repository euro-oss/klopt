import { createFileRoute } from '@tanstack/react-router'
import {
  handleConnectMoneybird,
  handleDisconnectMoneybird,
  handleGetMoneybirdConnection,
} from '~/api/handlers/moneybird'
import { connectMoneybirdBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/moneybird/connection')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleGetMoneybirdConnection(context)),
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleConnectMoneybird(
            context,
            parse(connectMoneybirdBody, await readJson(request), 'The request body'),
          ),
        ),
      DELETE: ({ request }) => handle(request, (context) => handleDisconnectMoneybird(context)),
    },
  },
})
