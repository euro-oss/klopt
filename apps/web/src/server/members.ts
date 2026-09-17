import { createServerFn } from '@tanstack/react-start'
import {
  handleInviteMember,
  handleListMembers,
  handleRemoveMember,
  handleSetMemberRole,
} from '~/api/handlers/members'
import { inviteMemberBody, setMemberRoleBody } from '~/api/schemas'
import { contextFromRequest, run, runWith } from './internal'

/** The access screen's RPC surface. Same handlers as `/api/v1/members`. */

export const listMembers = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListMembers(await contextFromRequest())).body),
)

export const inviteMember = createServerFn({ method: 'POST' })
  // Pass-through: a validator that throws bypasses `run` entirely and the
  // screen sees nothing. See ./internal.
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      inviteMemberBody,
      data,
      async (body) => (await handleInviteMember(await contextFromRequest(), body)).body,
    ),
  )

export const setMemberRole = createServerFn({ method: 'POST' })
  .validator((input: { memberId: string; role: string }) => input)
  .handler(async ({ data }) =>
    runWith(
      setMemberRoleBody,
      { role: data.role },
      async (body) =>
        (await handleSetMemberRole(await contextFromRequest(), data.memberId, body)).body,
    ),
  )

export const removeMember = createServerFn({ method: 'POST' })
  .validator((input: { memberId: string }) => input)
  .handler(async ({ data }) =>
    run(async () => (await handleRemoveMember(await contextFromRequest(), data.memberId)).body),
  )
