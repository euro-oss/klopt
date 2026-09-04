import { createFileRoute } from '@tanstack/react-router'
import { handleCreateContact, handleListContacts } from '~/api/handlers/sales'
import { contactsQuery, createContactBody } from '~/api/schemas'
import { handle, parse, readJson, searchParams } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/contacts')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleListContacts(
            context,
            parse(contactsQuery, searchParams(request), 'The query string'),
          ),
        ),

      POST: ({ request }) =>
        handle(request, async (context) =>
          handleCreateContact(
            context,
            parse(createContactBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
