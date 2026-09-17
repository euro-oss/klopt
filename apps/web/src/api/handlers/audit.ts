import { withAuditRead, type AuditRow } from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import type { AuditLogExportQuery, AuditLogQuery } from '../schemas.js'

/**
 * The audit log, read and handed over (spec 7.6).
 *
 * "Append-only, exportable, and covering API calls as well as UI actions." The
 * append-only part is a database trigger and the covering part is `recordAudit`
 * at every consequential handler. This is the exportable part, which is the one
 * an inspector interacts with — and the reason the whole thing exists, because
 * a log nobody can get out of the system is a log that proves nothing.
 *
 * Permissioned on `ledger:export` rather than `ledger:read`: what the books say
 * and what everybody did are different questions, and the second one is an
 * audit.
 */

/**
 * What comes back out of a `jsonb` column.
 *
 * Spelled out rather than left as `unknown` because a server function will not
 * serialise `unknown` — and rightly: "may not be serializable" is exactly the
 * question, and this is the answer for a column that only ever held JSON.
 */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

function serialise(row: AuditRow) {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    actor: {
      kind: row.actorKind,
      id: row.actorId,
      // Present when an agent acted. Spec 10.3: "an agent action records both
      // the agent and the human principal behind its token".
      principalId: row.actorPrincipalId,
    },
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    // Our own writing, read back out of `jsonb`. The cast at that boundary is
    // the honest one — and a concrete type is what lets this cross a server
    // function, which refuses to serialise `unknown`.
    before: row.before as JsonValue,
    after: row.after as JsonValue,
    requestId: row.requestId,
    ip: row.ip,
  }
}

export async function handleListAuditLog(context: RequestContext, query: AuditLogQuery) {
  requirePermission(context, 'ledger:export')

  return withAuditRead(context.database, async (repository) => {
    const rows = await repository.list({ entityId: context.entityId, ...query })
    return { status: 200, body: { entries: rows.map(serialise), count: rows.length } }
  })
}

/** CSV needs every cell escaped, and a JSON blob inside one needs it most. */
function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : JSON.stringify(value)

  return `"${text.replace(/"/g, '""')}"`
}

const CSV_HEADER = [
  'occurred_at',
  'actor_kind',
  'actor_id',
  'actor_principal_id',
  'action',
  'resource_type',
  'resource_id',
  'before',
  'after',
  'request_id',
  'ip',
]

/**
 * The log for a period, as a file.
 *
 * Streamed rather than assembled: seven years of an active administration is
 * the case this exists for, and building it in memory first is how an export
 * becomes something you cannot run on the day somebody asks for it. The
 * generator yields rows as the cursor walks them and the response body is a
 * `ReadableStream`, so memory is one page regardless of the range.
 *
 * Nothing here is awaited, and that is the point: this hands back a stream that
 * has not started. It stays `async` so it reads like every other handler and so
 * a caller cannot tell the difference — the alternative is one route that has
 * to remember not to await.
 */
/* eslint-disable @typescript-eslint/require-await -- see the note below. */
export async function handleExportAuditLog(
  context: RequestContext,
  query: AuditLogExportQuery,
): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string; filename: string }> {
  requirePermission(context, 'ledger:export')

  const { database, entityId } = context
  const encoder = new TextEncoder()
  const csv = query.format === 'csv'

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (csv) controller.enqueue(encoder.encode(`${CSV_HEADER.join(',')}\n`))

        await withAuditRead(database, async (repository) => {
          for await (const row of repository.stream({ entityId, ...query })) {
            const line = csv
              ? [
                  row.occurredAt,
                  row.actorKind,
                  row.actorId,
                  row.actorPrincipalId,
                  row.action,
                  row.resourceType,
                  row.resourceId,
                  row.before,
                  row.after,
                  row.requestId,
                  row.ip,
                ]
                  .map(csvCell)
                  .join(',')
              : JSON.stringify(serialise(row))

            controller.enqueue(encoder.encode(`${line}\n`))
          }
        })

        controller.close()
      } catch (error: unknown) {
        // A stream that has already sent its first byte cannot become a problem
        // document — the status is long gone. Erroring the stream truncates the
        // download, which is at least visibly wrong rather than silently short.
        controller.error(error)
      }
    },
  })

  const period = `${query.from ?? 'begin'}_${query.until ?? 'nu'}`
  return {
    stream,
    contentType: csv ? 'text/csv; charset=utf-8' : 'application/x-ndjson',
    filename: `auditlog-${period}.${csv ? 'csv' : 'jsonl'}`,
  }
}
