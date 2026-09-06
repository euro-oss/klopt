import { createServerFn } from '@tanstack/react-start'
import {
  handleInviteMember,
  handleListMembers,
  handleRemoveMember,
  handleSetMemberRole,
} from '~/api/handlers/members'
import { inviteMemberBody, setMemberRoleBody } from '~/api/schemas'
import { contextFromRequest, run } from './internal'

/** The access screen's RPC surface. Same handlers as `/api/v1/members`. */

export const listMembers = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListMembers(await contextFromRequest())).body),
)

export const inviteMember = createServerFn({ method: 'POST' })
  .validator((input: unknown) => inviteMemberBody.parse(input))
  .handler(async ({ data }) =>
    run(async () => (await handleInviteMember(await contextFromRequest(), data)).body),
  )

export const setMemberRole = createServerFn({ method: 'POST' })
  .validator((input: { memberId: string; role: string }) => ({
    memberId: input.memberId,
    body: setMemberRoleBody.parse({ role: input.role }),
  }))
  .handler(async ({ data }) =>
    run(
      async () =>
        (await handleSetMemberRole(await contextFromRequest(), data.memberId, data.body)).body,
    ),
  )

export const removeMember = createServerFn({ method: 'POST' })
  .validator((input: { memberId: string }) => input)
  .handler(async ({ data }) =>
    run(async () => (await handleRemoveMember(await contextFromRequest(), data.memberId)).body),
  )
