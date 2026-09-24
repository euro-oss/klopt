import { randomBytes } from 'node:crypto'
import {
  assertSafeHttpsUrl,
  EVENT_TYPES,
  PERMISSIONS,
  PrivateOutboundError,
  type EventType,
} from '@klopt/core'
import { encryptSecret, secretsAvailable, withWebhooks, withWebhooksRead } from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import { recordAudit } from '../audit.js'
import type { CreateWebhookBody, ReplayWebhookBody } from '../schemas.js'

/**
 * Webhook subscriptions (spec 10.2).
 *
 * Under `tokens:manage` rather than a permission of its own. A webhook is a
 * standing grant of information to a third party, which is the same kind of
 * decision as issuing a token, and the person who should make one is the
 * person who makes the other.
 */

function requireTokenAdmin(context: RequestContext): void {
  if (!hasPermission(context, PERMISSIONS.manageTokens)) {
    throw new ApiError('forbidden', `This token does not have ${PERMISSIONS.manageTokens}.`)
  }
}

export async function handleListWebhooks(context: RequestContext) {
  requireTokenAdmin(context)

  return withWebhooksRead(context.database, async (repository) => {
    const endpoints = await repository.list(context.entityId)

    const rows = await Promise.all(
      endpoints.map(async (endpoint) => ({
        id: endpoint.id,
        url: endpoint.url,
        eventTypes: endpoint.eventTypes,
        enabled: endpoint.enabled,
        disabledReason: endpoint.disabledReason,
        consecutiveFailures: endpoint.consecutiveFailures,
        lastAttemptAt: endpoint.lastAttemptAt,
        lastSuccessAt: endpoint.lastSuccessAt,
        createdAt: endpoint.createdAt,
        /** How far behind. The number an operator actually wants. */
        backlog: await repository.backlogFor(endpoint),
        attempts: await repository.attemptsFor(context.entityId, endpoint.id, 10),
      })),
    )

    return {
      status: 200,
      body: {
        endpoints: rows,
        /** So a screen can offer the list rather than asking for free text. */
        available: Object.entries(EVENT_TYPES).map(([type, meta]) => ({
          type,
          version: meta.version,
          summary: meta.summary,
        })),
      },
    }
  })
}

export async function handleCreateWebhook(context: RequestContext, body: CreateWebhookBody) {
  requireTokenAdmin(context)

  if (!secretsAvailable()) {
    throw new ApiError(
      'validation_failed',
      'There is no KLOPT_ENCRYPTION_KEY, so a signing secret cannot be stored encrypted. Set one first; this system does not keep credentials in the clear.',
    )
  }

  try {
    await assertSafeHttpsUrl(body.url)
  } catch (error: unknown) {
    if (error instanceof PrivateOutboundError) {
      throw new ApiError('validation_failed', error.message, [
        { code: 'private_url', path: 'url', message: error.message },
      ])
    }
    throw error
  }

  const unknown = body.eventTypes.filter((type) => !(type in EVENT_TYPES))
  if (unknown.length > 0) {
    throw new ApiError(
      'validation_failed',
      `No such event type: ${unknown.join(', ')}. Leave the list empty to receive all of them.`,
      unknown.map((type) => ({
        code: 'unknown_event_type',
        path: 'eventTypes',
        message: `${type} is not in the catalogue.`,
      })),
    )
  }

  // Shown once, here, and never again — the same bargain as an API token, and
  // for the same reason: only the encrypted copy is kept.
  const secret = `whsec_${randomBytes(24).toString('base64url')}`

  const id = await withWebhooks(context.database, (repository) =>
    repository.create({
      entityId: context.entityId,
      url: body.url,
      secret: encryptSecret(secret),
      eventTypes: body.eventTypes,
    }),
  )

  await recordAudit(context, {
    action: 'webhooks.create',
    resourceType: 'webhook_endpoint',
    resourceId: id,
    // The URL, not the secret. An audit row that leaks the credential it is
    // recording the creation of would be a poor sort of control.
    after: { url: body.url, eventTypes: body.eventTypes },
  })

  return { status: 201, body: { id, url: body.url, secret } }
}

export async function handleDeleteWebhook(context: RequestContext, endpointId: string) {
  requireTokenAdmin(context)

  await withWebhooks(context.database, (repository) =>
    repository.remove(context.entityId, endpointId),
  )

  await recordAudit(context, {
    action: 'webhooks.delete',
    resourceType: 'webhook_endpoint',
    resourceId: endpointId,
  })

  return { status: 200, body: { id: endpointId, deleted: true } }
}

/**
 * Replay, and un-disable (spec 10.2).
 *
 * One endpoint for both because they are the same act from the operator's
 * side: something went wrong, it has been dealt with, carry on from here. A
 * disabled endpoint that could be re-enabled but not rewound would strand
 * whatever it missed.
 */
export async function handleReplayWebhook(
  context: RequestContext,
  endpointId: string,
  body: ReplayWebhookBody,
) {
  requireTokenAdmin(context)

  const found = await withWebhooksRead(context.database, async (repository) =>
    (await repository.list(context.entityId)).find((row) => row.id === endpointId),
  )
  if (found === undefined) throw new ApiError('not_found', 'No such webhook endpoint.')

  await withWebhooks(context.database, async (repository) => {
    await repository.rewind(context.entityId, endpointId, body.after ?? null)
    await repository.enable(context.entityId, endpointId)
  })

  await recordAudit(context, {
    action: 'webhooks.replay',
    resourceType: 'webhook_endpoint',
    resourceId: endpointId,
    before: { cursor: found.cursor, enabled: found.enabled },
    after: { cursor: body.after ?? null, enabled: true },
  })

  return { status: 200, body: { id: endpointId, replayingFrom: body.after ?? null } }
}

export type { EventType }
