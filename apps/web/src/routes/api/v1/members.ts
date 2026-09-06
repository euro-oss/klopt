import { createFileRoute } from '@tanstack/react-router'
import { handleInviteMember, handleListMembers } from '~/api/handlers/members'
import { inviteMemberBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/** Who can see these books, and letting somebody else in. Owner only. */
export const Route = createFileRoute('/api/v1/members')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListMembers(context)),
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleInviteMember(
            context,
            parse(inviteMemberBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
