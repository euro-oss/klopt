import { createFileRoute } from '@tanstack/react-router'
import { handleCreateBankAccount, handleListBankAccounts } from '~/api/handlers/bank'
import { createBankAccountBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/** Bank accounts, with their consent state and reconciliation position. */
export const Route = createFileRoute('/api/v1/bank-accounts')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListBankAccounts(context)),
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleCreateBankAccount(
            context,
            parse(createBankAccountBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
