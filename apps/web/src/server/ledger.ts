import { createServerFn } from '@tanstack/react-start'
import { setActiveEntity } from '@klopt/db'
import { getRequest } from '@tanstack/react-start/server'
import {
  handleGetJournalEntry,
  handleGetTrialBalance,
  handleListAccounts,
  handleListJournalEntries,
  handleListJournals,
  handlePostJournalEntry,
  handleReverseJournalEntry,
  handleVerifyChain,
} from '~/api/handlers/ledger'
import {
  handleIssueToken,
  handleListTokens,
  handleRevokeOAuthClient,
  handleRevokeToken,
} from '~/api/handlers/tokens'
import {
  handleCloseYear,
  handleGetBalanceSheet,
  handleGetProfitAndLoss,
  handleGetRgsCoverage,
  handleSetRgsMappings,
} from '~/api/handlers/compliance'
import { handleListAuditLog } from '~/api/handlers/audit'
import {
  handleDeleteDocuments,
  handleGetRetention,
  handleSetLegalHold,
  handleSetRetentionClass,
} from '~/api/handlers/retention'
import {
  handleChooseExactDivision,
  handleCompleteExactConnection,
  handleConnectExact,
  handleDisconnectExact,
  handleGetExactConnection,
  handleListExactDivisions,
  handlePreviewExactImport,
  handleRunExactImport,
} from '~/api/handlers/exact'
import {
  handleListSnapshots,
  handleSealSnapshot,
  handleVerifySnapshot,
} from '~/api/handlers/snapshots'
import {
  auditLogQuery,
  chooseExactDivisionBody,
  completeExactBody,
  connectExactBody,
  deleteDocumentsBody,
  exactPreviewQuery,
  issueTokenBody,
  retentionQuery,
  runExactImportBody,
  sealSnapshotBody,
  setLegalHoldBody,
  setRetentionClassBody,
  closeYearBody,
  listEntriesQuery,
  postJournalEntryBody,
  reverseJournalEntryBody,
  rgsMappingsBody,
  statementQuery,
  trialBalanceQuery,
} from '~/api/schemas'
import { getDatabase } from '~/api/database'
import { resolveMemberships } from '~/api/auth'
import { contextFromRequest, run, runWith } from './internal'

/**
 * The UI's RPC surface. Every one of these is three lines: resolve context,
 * parse, call the handler that `/api/v1` calls.
 *
 * **Writes carry an idempotency key in the payload**, not in a header. A
 * browser cannot set `Idempotency-Key` on a server-function call, and spec 10.2
 * makes one mandatory on every write — so the screen generates a key per
 * attempt, reuses it across retries, and it arrives here. Without this a double
 * click posts twice, which in a ledger is not a cosmetic problem.
 */

/** Pull the key out of a payload, leaving the body for the schema to parse. */
function keyOf(input: unknown): string | undefined {
  const value = (input as { idempotencyKey?: unknown } | null)?.idempotencyKey
  return typeof value === 'string' && value !== '' ? value : undefined
}

export const listAccounts = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListAccounts(await contextFromRequest())).body),
)

export const listJournals = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListJournals(await contextFromRequest())).body),
)

export const listTokens = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListTokens(await contextFromRequest())).body),
)

export const issueApiToken = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      issueTokenBody,
      data,
      async (body) =>
        (await handleIssueToken(await contextFromRequest({ idempotencyKey: keyOf(data) }), body))
          .body,
    ),
  )

export const revokeApiToken = createServerFn({ method: 'POST' })
  .validator((input: { tokenId: string }) => input)
  .handler(async ({ data }) =>
    run(async () => (await handleRevokeToken(await contextFromRequest(), data.tokenId)).body),
  )

export const revokeAuthorisedApp = createServerFn({ method: 'POST' })
  .validator((input: { clientId: string }) => input)
  .handler(async ({ data }) =>
    run(
      async () => (await handleRevokeOAuthClient(await contextFromRequest(), data.clientId)).body,
    ),
  )

export const getRgsCoverage = createServerFn({ method: 'GET' })
  .validator((input: { currency?: string; applicableFlag?: string | null }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleGetRgsCoverage(await contextFromRequest(), {
            currency: data.currency ?? 'EUR',
            applicableFlag: data.applicableFlag ?? null,
          })
        ).body,
    ),
  )

export const setRgsMappings = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      rgsMappingsBody,
      data,
      async (body) => (await handleSetRgsMappings(await contextFromRequest(), body)).body,
    ),
  )

export const getTrialBalance = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      trialBalanceQuery,
      data,
      async (body) => (await handleGetTrialBalance(await contextFromRequest(), body)).body,
    ),
  )

export const getBalanceSheet = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      statementQuery,
      data,
      async (body) => (await handleGetBalanceSheet(await contextFromRequest(), body)).body,
    ),
  )

export const getProfitAndLoss = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      statementQuery,
      data,
      async (body) => (await handleGetProfitAndLoss(await contextFromRequest(), body)).body,
    ),
  )

export const listEntries = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      listEntriesQuery,
      data,
      async (body) => (await handleListJournalEntries(await contextFromRequest(), body)).body,
    ),
  )

export const getEntry = createServerFn({ method: 'GET' })
  .validator((input: { entryId: string }) => input)
  .handler(async ({ data }) =>
    run(async () => (await handleGetJournalEntry(await contextFromRequest(), data.entryId)).body),
  )

export const verifyChain = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleVerifyChain(await contextFromRequest())).body),
)

export const postEntry = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      postJournalEntryBody,
      data,
      async (body) =>
        (
          await handlePostJournalEntry(
            await contextFromRequest({ idempotencyKey: keyOf(data) }),
            body,
          )
        ).body,
    ),
  )

export const reverseEntry = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      entryId: string
      bookingDate: string
      description?: string | null
      idempotencyKey: string
    }) => input,
  )
  .handler(async ({ data }) =>
    runWith(
      reverseJournalEntryBody,
      { bookingDate: data.bookingDate, description: data.description ?? null },
      async (body) =>
        (
          await handleReverseJournalEntry(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            data.entryId,
            body,
          )
        ).body,
    ),
  )

export const closeYear = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      closeYearBody,
      data,
      async (body) =>
        (await handleCloseYear(await contextFromRequest({ idempotencyKey: keyOf(data) }), body))
          .body,
    ),
  )

/** Switch which entity's books this session is looking at. */
export const switchEntity = createServerFn({ method: 'POST' })
  .validator((input: { entityId: string }) => input)
  .handler(async ({ data }) =>
    run(async () => {
      const database = getDatabase()
      const session = await resolveMemberships(database, getRequest())
      if (session === null) throw new Error('Not signed in.')

      const allowed = session.memberships.some(
        (membership) => membership.entityId === data.entityId,
      )
      // The membership check matters: without it the entity id in a request
      // body would be enough to read another company's books.
      if (!allowed) throw new Error('No such entity.')

      await setActiveEntity(database, session.sessionToken, data.entityId)
      return { entityId: data.entityId }
    }),
  )

/**
 * The audit log, for the screen that shows it.
 *
 * The export is deliberately *not* here: it is a stream and a filename, which
 * is a download rather than an RPC. `/api/v1/audit-log/export` is the doorway,
 * and a link is the right control for it.
 */
export const listAuditLog = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      auditLogQuery,
      data ?? {},
      async (query) => (await handleListAuditLog(await contextFromRequest(), query)).body,
    ),
  )

/**
 * The bewaarplicht (spec 7.6).
 *
 * The preview is a read; the three writes each carry a reason, because the one
 * that deletes cannot be undone and the ones that hold outlive the term.
 */
export const getRetention = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      retentionQuery,
      data ?? {},
      async (query) => (await handleGetRetention(await contextFromRequest(), query)).body,
    ),
  )

export const setLegalHold = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      setLegalHoldBody,
      data,
      async (body) =>
        (await handleSetLegalHold(await contextFromRequest({ idempotencyKey: keyOf(data) }), body))
          .body,
    ),
  )

export const setRetentionClass = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      setRetentionClassBody,
      data,
      async (body) =>
        (
          await handleSetRetentionClass(
            await contextFromRequest({ idempotencyKey: keyOf(data) }),
            body,
          )
        ).body,
    ),
  )

export const deleteDocuments = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      deleteDocumentsBody,
      data,
      async (body) =>
        (
          await handleDeleteDocuments(
            await contextFromRequest({ idempotencyKey: keyOf(data) }),
            body,
          )
        ).body,
    ),
  )

/**
 * Sealed snapshots (spec 7.6).
 *
 * The manifest download is not here: it is a file, and
 * `/api/v1/snapshots/{id}/manifest` serves it as plain text so a reader with
 * `sha256sum` can check the seal without a parser in between.
 */
export const listSnapshots = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListSnapshots(await contextFromRequest())).body),
)

export const sealSnapshot = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      sealSnapshotBody,
      data,
      async (body) =>
        (await handleSealSnapshot(await contextFromRequest({ idempotencyKey: keyOf(data) }), body))
          .body,
    ),
  )

export const verifySnapshot = createServerFn({ method: 'POST' })
  .validator((input: { snapshotId: string; recomputeAuditFile?: boolean }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleVerifySnapshot(await contextFromRequest(), data.snapshotId, {
            recomputeAuditFile: data.recomputeAuditFile ?? false,
          })
        ).body,
    ),
  )

/**
 * Exact Online (spec 13).
 *
 * Five calls, and the shape of them is the design: connecting and choosing an
 * administration are separate acts, because one Exact login reaches every
 * administration the user has rights to — including the practice and test ones
 * — and importing the wrong one is not obvious afterwards.
 */
export const getExactConnection = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleGetExactConnection(await contextFromRequest())).body),
)

export const connectExact = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      connectExactBody,
      data,
      async (body) =>
        (await handleConnectExact(await contextFromRequest({ idempotencyKey: keyOf(data) }), body))
          .body,
    ),
  )

export const completeExactConnection = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      completeExactBody,
      data,
      async (body) =>
        (
          await handleCompleteExactConnection(
            await contextFromRequest({ idempotencyKey: keyOf(data) }),
            body,
          )
        ).body,
    ),
  )

export const listExactDivisions = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListExactDivisions(await contextFromRequest())).body),
)

export const chooseExactDivision = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      chooseExactDivisionBody,
      data,
      async (body) =>
        (
          await handleChooseExactDivision(
            await contextFromRequest({ idempotencyKey: keyOf(data) }),
            body,
          )
        ).body,
    ),
  )

export const previewExactImport = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      exactPreviewQuery,
      data ?? {},
      async (query) => (await handlePreviewExactImport(await contextFromRequest(), query)).body,
    ),
  )

export const runExactImport = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      runExactImportBody,
      data,
      async (body) =>
        (
          await handleRunExactImport(
            await contextFromRequest({ idempotencyKey: keyOf(data) }),
            body,
          )
        ).body,
    ),
  )

export const disconnectExact = createServerFn({ method: 'POST' }).handler(async () =>
  run(async () => (await handleDisconnectExact(await contextFromRequest())).body),
)
