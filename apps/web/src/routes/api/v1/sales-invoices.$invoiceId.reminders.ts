import { createFileRoute } from '@tanstack/react-router'
import { handleSendDunningReminder } from '~/api/handlers/sales'
import { sendReminderBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Send the reminder this invoice is due. Which one that is comes from the
 * invoice's age and its delivery history, never from the caller — see the
 * handler.
 */
export const Route = createFileRoute('/api/v1/sales-invoices/$invoiceId/reminders')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, async (context) =>
          handleSendDunningReminder(
            context,
            params.invoiceId,
            parse(sendReminderBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
