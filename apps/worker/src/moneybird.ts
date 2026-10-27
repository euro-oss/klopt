import { createMoneybirdClient, readAdministration, resolveDocumentStore } from '@klopt/adapters'
import {
  closeDatabase,
  createDatabase,
  executeMoneybirdImport,
  MoneybirdPlanRefused,
  MoneybirdPostCommitFailed,
  secretsAvailable,
  withMoneybirdConnection,
  withMoneybirdImport,
  type Database,
  type MoneybirdCommitResult,
  type MoneybirdRunReport,
} from '@klopt/db'
import type { Actor, MoneybirdImportPlan } from '@klopt/core'

function storeFor() {
  return resolveDocumentStore(process.env)
}

/** jsonb shape the UI reads via serialiseStoredReport (`imported` ← dryRun === false). */
function bookedReport(partial: {
  readonly plan: MoneybirdImportPlan
  readonly commit: MoneybirdCommitResult
  readonly attachmentsStored?: number
  readonly attachmentsSkipped?: number
  readonly reconciliation?: MoneybirdRunReport['reconciliation']
  readonly opening?: MoneybirdRunReport['opening']
}) {
  return {
    dryRun: false as const,
    commit: partial.commit,
    attachmentsStored: partial.attachmentsStored ?? 0,
    attachmentsSkipped: partial.attachmentsSkipped ?? 0,
    reconciliation: partial.reconciliation ?? [],
    opening: partial.opening ?? null,
    counts: {
      accounts: partial.plan.accounts.length,
      contacts: partial.plan.contacts.length,
      entries: partial.plan.entries.length,
    },
    warnings: partial.plan.warnings,
    problems: partial.plan.problems,
    notImported: partial.plan.notImported,
    excluded: partial.plan.excluded,
  }
}

export async function importMoneybirdAdministration(
  database: Database,
  store = storeFor(),
  fetchImpl?: typeof globalThis.fetch,
): Promise<{
  readonly entityId: string | null
  readonly state: string
  readonly failure: string | null
}> {
  const run = await withMoneybirdImport(database, (repository) => repository.claim(new Date()))
  if (run === null) return { entityId: null, state: 'idle', failure: null }

  const connection = await withMoneybirdConnection(database, (repository) =>
    repository.withCredentials(run.entityId),
  )
  if (connection === null || connection.apiToken === '') {
    const reason = secretsAvailable()
      ? 'There is no Moneybird connection for this administration.'
      : 'KLOPT_ENCRYPTION_KEY is not set on the worker, so the stored Moneybird token cannot be read.'
    await withMoneybirdImport(database, (repository) =>
      repository.finish({ id: run.id, state: 'failed', report: null, lastError: reason }),
    )
    return { entityId: run.entityId, state: 'failed', failure: reason }
  }

  const client = createMoneybirdClient({
    token: connection.apiToken,
    base: connection.baseUrl,
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  })

  const actor: Actor = { kind: 'script', id: 'worker', principalId: null }

  try {
    const snapshot = await readAdministration({
      client,
      administrationId: run.administrationId,
    })
    const report = await executeMoneybirdImport({
      database,
      client,
      store,
      snapshot,
      entityId: run.entityId,
      actor,
      idempotencyKey: run.id,
      requestId: run.id,
      ip: null,
      mayPostToSoftClosedPeriod: true,
      onCommitted: async ({ plan, commit }) => {
        // Persist booked counts before attachments / reconciliation / opening /
        // recordImport so a crash mid-flight still surfaces failedPartial.
        await withMoneybirdImport(database, (repository) =>
          repository.finish({
            id: run.id,
            state: 'running',
            report: bookedReport({ plan, commit }),
            lastError: null,
          }),
        )
      },
    })
    await withMoneybirdImport(database, (repository) =>
      repository.finish({
        id: run.id,
        state: 'done',
        report: bookedReport({
          plan: report.plan,
          commit: report.commit,
          attachmentsStored: report.attachmentsStored,
          attachmentsSkipped: report.attachmentsSkipped,
          reconciliation: report.reconciliation,
          opening: report.opening,
        }),
        lastError: null,
      }),
    )
    try {
      await withMoneybirdConnection(database, (repository) => repository.recordImport(run.entityId))
    } catch (error: unknown) {
      // Entries are already booked and finished as done; demote to failed with
      // the same commit report so the UI can choose failedPartial.
      const message = error instanceof Error ? error.message : String(error)
      await withMoneybirdImport(database, (repository) =>
        repository.finish({
          id: run.id,
          state: 'failed',
          report: bookedReport({
            plan: report.plan,
            commit: report.commit,
            attachmentsStored: report.attachmentsStored,
            attachmentsSkipped: report.attachmentsSkipped,
            reconciliation: report.reconciliation,
            opening: report.opening,
          }),
          lastError: message,
        }),
      )
      return { entityId: run.entityId, state: 'failed', failure: message }
    }
    return { entityId: run.entityId, state: 'done', failure: null }
  } catch (error: unknown) {
    if (error instanceof MoneybirdPlanRefused) {
      // Pre-commit: nothing booked — report without dryRun:false → imported:false.
      await withMoneybirdImport(database, (repository) =>
        repository.finish({
          id: run.id,
          state: 'failed',
          report: { problems: error.plan.problems, warnings: error.plan.warnings },
          lastError: error.message,
        }),
      )
      return { entityId: run.entityId, state: 'failed', failure: error.message }
    }
    if (error instanceof MoneybirdPostCommitFailed) {
      await withMoneybirdImport(database, (repository) =>
        repository.finish({
          id: run.id,
          state: 'failed',
          report: bookedReport({
            plan: error.plan,
            commit: error.commit,
            attachmentsStored: error.attachmentsStored,
            attachmentsSkipped: error.attachmentsSkipped,
            reconciliation: error.reconciliation,
            opening: error.opening,
          }),
          lastError: error.message,
        }),
      )
      return { entityId: run.entityId, state: 'failed', failure: error.message }
    }
    const message = error instanceof Error ? error.message : String(error)
    // Pre-commit / read failure: no booked counts.
    await withMoneybirdImport(database, (repository) =>
      repository.finish({ id: run.id, state: 'failed', report: null, lastError: message }),
    )
    return { entityId: run.entityId, state: 'failed', failure: message }
  }
}

export async function importMoneybirdJob(databaseUrl: string): Promise<void> {
  const database = createDatabase({ url: databaseUrl, maxConnections: 2 })
  try {
    const summary = await importMoneybirdAdministration(database)
    if (summary.entityId === null) return
    console.info(`[worker] moneybird-import: ${summary.state}`)
    if (summary.failure !== null) {
      console.warn(`[worker] moneybird-import: ${summary.failure}`)
    }
  } finally {
    await closeDatabase(database)
  }
}
