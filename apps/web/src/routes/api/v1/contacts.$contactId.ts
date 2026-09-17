import { createFileRoute } from '@tanstack/react-router'
import { handleGetContact, handleUpdateContact } from '~/api/handlers/sales'
import { updateContactBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * One contact, and correcting it.
 *
 * `PATCH` rather than `PUT`: a screen that had to send all fifteen fields back
 * would overwrite whatever somebody else fixed in the meantime, and most
 * corrections are one field.
 */
export const Route = createFileRoute('/api/v1/contacts/$contactId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handle(request, (context) => handleGetContact(context, params.contactId)),
      PATCH: ({ request, params }) =>
        handle(request, async (context) =>
          handleUpdateContact(
            context,
            params.contactId,
            parse(updateContactBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
