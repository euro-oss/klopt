import { createMoneybirdClient, readAdministration, resolveDocumentStore } from '@klopt/adapters'
import {
  closeDatabase,
  createDatabase,
  executeMoneybirdImport,
  MoneybirdPlanRefused,
  secretsAvailable,
  withMoneybirdConnection,
  withMoneybirdImport,
  type Database,
} from '@klopt/db'
import type { Actor } from '@klopt/core'

function storeFor() {
  return resolveDocumentStore(process.env)
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
    })
    await withMoneybirdImport(database, (repository) =>
      repository.finish({
        id: run.id,
        state: 'done',
        report: {
          dryRun: false,
          commit: report.commit,
          attachmentsStored: report.attachmentsStored,
          attachmentsSkipped: report.attachmentsSkipped,
          reconciliation: report.reconciliation,
          counts: {
            accounts: report.plan.accounts.length,
            contacts: report.plan.contacts.length,
            entries: report.plan.entries.length,
          },
          warnings: report.plan.warnings,
          problems: report.plan.problems,
          notImported: report.plan.notImported,
        },
        lastError: null,
      }),
    )
    await withMoneybirdConnection(database, (repository) => repository.recordImport(run.entityId))
    return { entityId: run.entityId, state: 'done', failure: null }
  } catch (error: unknown) {
    if (error instanceof MoneybirdPlanRefused) {
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
    const message = error instanceof Error ? error.message : String(error)
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
