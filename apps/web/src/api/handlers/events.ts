import { PERMISSIONS, type EventType } from '@klopt/core'
import { withEventsRead } from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import type { EventsQuery } from '../schemas.js'

/**
 * The pollable event stream (spec 10.2).
 *
 * > Webhooks from the transactional outbox … plus a pollable `/events` cursor
 * > endpoint, because self-hosters behind NAT cannot receive webhooks.
 *
 * A consumer holds the id of the last event it handled and asks for what came
 * after. That id is also the dedup id, so a consumer that crashes between
 * handling an event and storing its cursor sees it again and can recognise it
 * — which is what at-least-once means in practice.
 *
 * The events are thin on purpose: a type and a reference. Fetching the
 * resource is a separate call with the same token, so the permission is
 * checked against the resource rather than inherited from having been told
 * about it. See `EVENT_TYPES` for the rest of the reasoning.
 */
export async function handleListEvents(context: RequestContext, query: EventsQuery) {
  if (!hasPermission(context, PERMISSIONS.read)) {
    throw new ApiError('forbidden', `This token does not have ${PERMISSIONS.read}.`)
  }

  return withEventsRead(context.database, async (repository) => {
    const rows = await repository.list({
      entityId: context.entityId,
      after: query.after,
      types: query.type,
      limit: query.limit,
    })

    return {
      status: 200,
      body: {
        events: rows.map((row) => ({
          id: row.id,
          occurredAt: row.occurredAt,
          type: row.type as EventType,
          version: row.version,
          entityId: row.entityId,
          resource: resourceRef(row.payload),
        })),
        /**
         * Where to resume. Null when the page came back empty, so that a
         * caller who polls an idle stream keeps sending the cursor it already
         * has rather than resetting to the beginning — which is the bug this
         * field exists to make impossible to write.
         */
        nextCursor: rows.at(-1)?.id ?? null,
      },
    }
  })
}

/**
 * The reference out of a stored payload.
 *
 * Defensive because the column is `jsonb` and the oldest rows predate the
 * catalogue: a row that does not look like a reference yields nulls rather
 * than throwing and taking the whole page down with it.
 */
function resourceRef(payload: unknown): { type: string | null; id: string | null } {
  if (typeof payload !== 'object' || payload === null) return { type: null, id: null }
  const record = payload as Record<string, unknown>
  return {
    type: typeof record['resourceType'] === 'string' ? record['resourceType'] : null,
    id: typeof record['resourceId'] === 'string' ? record['resourceId'] : null,
  }
}
