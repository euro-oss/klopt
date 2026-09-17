import { createFileRoute } from '@tanstack/react-router'
import { handlePseudonymiseContact } from '~/api/handlers/retention'
import { pseudonymiseContactBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Answering a right-to-erasure request about a contact.
 *
 * A `POST` to a named action rather than a `DELETE` on the contact, because
 * nothing is deleted: the row stays, the postings stay, the invoices keep the
 * buyer they were issued to. What goes is the address book entry. Calling it
 * `DELETE /contacts/:id` would describe the wrong thing to anybody reading the
 * log — and would invite somebody to implement the wrong thing later.
 */
export const Route = createFileRoute('/api/v1/contacts/$contactId/pseudonymise')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, async (context) =>
          handlePseudonymiseContact(
            context,
            params.contactId,
            parse(pseudonymiseContactBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
