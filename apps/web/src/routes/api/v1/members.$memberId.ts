import { createFileRoute } from '@tanstack/react-router'
import { handleRemoveMember, handleSetMemberRole } from '~/api/handlers/members'
import { setMemberRoleBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * One member, or one invitation nobody used. `memberId` is whichever id the
 * list gave you; the handler works out which kind it is.
 */
export const Route = createFileRoute('/api/v1/members/$memberId')({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        handle(request, async (context) =>
          handleSetMemberRole(
            context,
            params.memberId,
            parse(setMemberRoleBody, await readJson(request), 'The request body'),
          ),
        ),
      DELETE: ({ request, params }) =>
        handle(request, (context) => handleRemoveMember(context, params.memberId)),
    },
  },
})
