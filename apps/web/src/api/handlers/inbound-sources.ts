import { createInboundSource } from '@klopt/adapters'
import { assertSafeHostname, PrivateOutboundError } from '@klopt/core'
import {
  decryptSecret,
  encryptSecret,
  runInboundPoll,
  secretsAvailable,
  SecretKeyMissingError,
  SecretKeyTooShortError,
  withInboundSources,
  withInboundSourcesRead,
} from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import { recordAudit } from '../audit.js'
import { documentStore } from '../document-store.js'
import type { AddInboundSourceBody } from '../schemas.js'

/**
 * The mailboxes an administration receives documents on (spec 6).
 *
 * The queue is one queue; this is the list of doorways into it. A drop
 * directory needs no credential and is the default; a mailbox needs a password
 * and therefore needs somewhere safe to keep it; a Peppol access point is
 * configuration for a doorway that pushes rather than one that is asked.
 */

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

/** The shape a screen reads. No secret, ever — that is what `withSecret` is for. */
function serialise(row: {
  id: string
  kind: 'maildir' | 'imap' | 'peppol'
  name: string
  enabled: boolean
  config: Record<string, unknown>
  lastPolledAt: string | null
  lastError: string | null
  lastMessageCount: number
}) {
  // Whitelisted rather than spread: `config` is jsonb, so a future field with a
  // secret in it should not reach a screen because nobody remembered.
  const text = (key: string): string => {
    const value = row.config[key]
    return typeof value === 'string' ? value : ''
  }

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    enabled: row.enabled,
    where:
      row.kind === 'maildir'
        ? text('directory')
        : row.kind === 'imap'
          ? `${text('user')}@${text('host')}`
          : text('participantId'),
    lastPolledAt: row.lastPolledAt,
    lastError: row.lastError,
    lastMessageCount: row.lastMessageCount,
  }
}

export async function handleListInboundSources(context: RequestContext) {
  requirePermission(context, 'ledger:read')

  return withInboundSourcesRead(context.database, async (repository) => {
    const rows = await repository.list(context.entityId)
    return {
      status: 200,
      body: {
        sources: rows.map(serialise),
        // So the screen can say why the password field is refused *before*
        // somebody types one in.
        canStoreSecrets: secretsAvailable(),
      },
    }
  })
}

export async function handleAddInboundSource(context: RequestContext, body: AddInboundSourceBody) {
  requirePermission(context, 'ledger:configure')

  if (body.kind === 'imap' && (body.host ?? '') !== '') {
    try {
      await assertSafeHostname(body.host!)
    } catch (error: unknown) {
      if (error instanceof PrivateOutboundError) {
        throw new ApiError('validation_failed', error.message, [
          { code: 'private_host', path: 'host', message: error.message },
        ])
      }
      throw error
    }
  }

  const config: Record<string, unknown> =
    body.kind === 'maildir'
      ? { directory: body.directory }
      : body.kind === 'imap'
        ? {
            host: body.host,
            port: body.port ?? null,
            secure: body.secure ?? true,
            user: body.user,
            mailbox: body.mailbox ?? 'INBOX',
            processedMailbox: body.processedMailbox ?? null,
          }
        : {}

  let secret: string | null = null
  if ((body.password ?? '') !== '') {
    try {
      secret = encryptSecret(body.password!)
    } catch (error: unknown) {
      // Refused rather than stored as typed. A password in a database dump is
      // discovered by somebody else, later.
      if (error instanceof SecretKeyMissingError || error instanceof SecretKeyTooShortError) {
        throw new ApiError('validation_failed', error.message, [
          { code: 'no_secret_key', path: 'password', message: error.message },
        ])
      }
      throw error
    }
  }

  const id = await withInboundSources(context.database, (repository) =>
    repository.create({
      entityId: context.entityId,
      kind: body.kind,
      name: body.name,
      config,
      secret,
    }),
  )

  // The configuration, never the credential. `config` is whitelisted on the way
  // in and the secret lives in its own column for exactly this reason.
  await recordAudit(context, {
    action: 'inbox.addSource',
    resourceType: 'inbound_source',
    resourceId: id,
    after: { kind: body.kind, name: body.name, config },
  })

  return { status: 201, body: { id, name: body.name, kind: body.kind } }
}

export async function handleRemoveInboundSource(context: RequestContext, sourceId: string) {
  requirePermission(context, 'ledger:configure')

  await withInboundSources(context.database, (repository) =>
    repository.remove(context.entityId, sourceId),
  )

  // What already arrived is untouched: the documents are the administration's,
  // not the mailbox's.
  await recordAudit(context, {
    action: 'inbox.removeSource',
    resourceType: 'inbound_source',
    resourceId: sourceId,
    before: { removed: false },
    after: { removed: true },
  })

  return { status: 200, body: { id: sourceId, removed: true } }
}

/**
 * Take what is waiting now, rather than at the next scheduled run.
 *
 * The same code path the worker runs — not a second implementation of it — so
 * that pressing the button proves the schedule works rather than proving
 * something else does.
 */
export async function handlePollInboundSource(context: RequestContext, sourceId: string) {
  requirePermission(context, 'ledger:post')

  const row = await withInboundSourcesRead(context.database, (repository) =>
    repository.withSecret(context.entityId, sourceId),
  )
  if (row === null) throw new ApiError('not_found', 'No such source.')

  const adapter = createInboundSource({
    kind: row.kind,
    name: row.name,
    config: row.config,
    secret: decryptSecret(row.secret),
  })

  if (adapter === null) {
    throw new ApiError(
      'conflict',
      'A Peppol access point delivers rather than being asked. Its documents arrive on their own.',
    )
  }

  const result = await runInboundPoll({
    database: context.database,
    store: documentStore(),
    entityId: context.entityId,
    sourceId: row.id,
    source: adapter,
    cursor: row.cursor,
  })

  return {
    status: 200,
    body: {
      source: result.source,
      ok: result.ok,
      failure: result.failure,
      filed: result.filed,
      documents: result.documents,
      skipped: result.messages.flatMap((message) => message.skipped),
    },
  }
}
