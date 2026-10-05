import {
  buildTrialBalance,
  planMoneybirdImport,
  sha256Hex,
  contentTypeFor,
  type Actor,
  type DocumentStore,
  type MoneybirdClient,
  type MoneybirdImportPlan,
  type MoneybirdSnapshot,
} from '@klopt/core'
import type { Database } from '../client.js'
import { commitMoneybirdImport, type MoneybirdCommitResult } from './import.js'
import { MoneybirdConnectionRepository } from '../repositories/moneybird.js'
import { MoneybirdImportRepository } from '../repositories/moneybird-import.js'
import { ReportingRepository } from '../repositories/reporting.js'
import { SetupRepository } from '../repositories/setup.js'
import { withInbox, withSetup } from '../unit-of-work.js'

export interface MoneybirdRunRequest {
  readonly database: Database
  readonly client: MoneybirdClient
  readonly store: DocumentStore
  readonly snapshot: MoneybirdSnapshot
  readonly entityId: string
  readonly actor: Actor
  readonly idempotencyKey: string
  readonly requestId: string | null
  readonly ip: string | null
  readonly mayPostToSoftClosedPeriod: boolean
}

export interface MoneybirdYearReconciliation {
  readonly year: number
  readonly source: string
  readonly moneybirdDebit: string | null
  readonly moneybirdCredit: string | null
  readonly kloptDebit: string | null
  readonly kloptCredit: string | null
  readonly differences: readonly {
    readonly accountNumber: string
    readonly moneybird: string
    readonly klopt: string
    readonly difference: string
  }[]
}

export interface MoneybirdRunReport {
  readonly dryRun: false
  readonly plan: MoneybirdImportPlan
  readonly commit: MoneybirdCommitResult
  readonly attachmentsStored: number
  readonly attachmentsSkipped: number
  readonly reconciliation: readonly MoneybirdYearReconciliation[]
}

function amount(value: bigint | null): string | null {
  if (value === null) return null
  const negative = value < 0n
  const digits = (negative ? -value : value).toString().padStart(3, '0')
  const cut = digits.length - 2
  return `${negative ? '-' : ''}${digits.slice(0, cut)}.${digits.slice(cut)}`
}

export async function executeMoneybirdImport(
  request: MoneybirdRunRequest,
): Promise<MoneybirdRunReport> {
  const { database, entityId, snapshot } = request

  const here = await database.transaction(async (tx) => {
    const reporting = new ReportingRepository(tx)
    const imported = new MoneybirdImportRepository(tx)
    const connection = new MoneybirdConnectionRepository(tx)
    const setup = new SetupRepository(tx as never)
    const [entity, resolutions, accounts, connectionRow, externalIds, years, rules] =
      await Promise.all([
        reporting.entity(entityId),
        reporting.importResolutions(entityId),
        reporting.listAccounts(entityId),
        connection.find(entityId),
        imported.knownExternalIds(entityId),
        setup.listFiscalYears(entityId),
        reporting.taxRules(entityId),
      ])
    return { entity, resolutions, accounts, connectionRow, externalIds, years, rules }
  })

  if (here.entity === null) throw new Error('No such administration.')

  const plan = planMoneybirdImport(snapshot, {
    entityId,
    currency: here.entity.functionalCurrency,
    existingAccountNumbers: here.accounts.map((account) => account.number),
    existingContactNumbers: [...here.resolutions.contactIdsByNumber.keys()],
    existingTaxRules: here.rules,
    confirmedAccountMappings: here.connectionRow?.accountMappings ?? {},
    confirmedTaxMappings: here.connectionRow?.taxMappings ?? {},
    existingExternalIds: here.externalIds,
    lockedYears: here.years.filter((year) => year.status === 'closed').map((year) => year.code),
  })

  if (plan.problems.length > 0) {
    throw new MoneybirdPlanRefused(plan)
  }

  for (const year of plan.years) {
    await withSetup(database, (repository) => repository.createFiscalYear(entityId, String(year)))
  }

  const commit = await commitMoneybirdImport(database, {
    entityId,
    plan,
    actor: request.actor,
    idempotencyKey: request.idempotencyKey,
    requestId: request.requestId,
    ip: request.ip,
    mayPostToSoftClosedPeriod: request.mayPostToSoftClosedPeriod,
  })

  let attachmentsStored = 0
  let attachmentsSkipped = 0
  const wanted = plan.documents.flatMap((document) =>
    document.attachments.map((attachment) => ({ document, attachment })),
  )
  const known = await database.transaction(async (tx) =>
    new MoneybirdImportRepository(tx).knownAttachments(
      entityId,
      wanted.map((item) => item.attachment.id),
    ),
  )

  for (const { document, attachment } of wanted) {
    if (attachment.downloadUrl === null) continue
    if (known.has(attachment.id)) {
      attachmentsSkipped += 1
      continue
    }
    const bytes = await request.client.download(attachment.downloadUrl)
    const contentType = attachment.contentType ?? contentTypeFor(attachment.filename)
    const stored = await request.store.put(bytes, { contentType })
    const recorded = await withInbox(database, ({ inbox }) =>
      inbox.recordDocument({
        entityId,
        sha256: stored.sha256 ?? sha256Hex(bytes),
        sizeBytes: bytes.byteLength,
        contentType,
        filename: attachment.filename,
      }),
    )
    await database.transaction(async (tx) =>
      new MoneybirdImportRepository(tx).rememberAttachment({
        entityId,
        moneybirdAttachmentId: attachment.id,
        moneybirdDocumentId: document.moneybirdId,
        documentId: recorded.id,
      }),
    )
    attachmentsStored += 1
  }

  const reconciliation: MoneybirdYearReconciliation[] = []
  for (const year of plan.reconciliation) {
    const rows = await database.transaction(async (tx) =>
      new ReportingRepository(tx).trialBalanceRows({
        entityId,
        fiscalYearCode: String(year.year),
        fromPeriod: 1,
        toPeriod: 12,
        currency: here.entity!.functionalCurrency,
      }),
    )
    const klopt = buildTrialBalance(
      {
        entityId,
        currency: here.entity.functionalCurrency,
        fiscalYearCode: String(year.year),
        fromPeriod: 1,
        toPeriod: 12,
        includeZeroRows: false,
      },
      rows,
    )
    const moneybirdByAccount = new Map(
      year.lines.map((line) => [line.accountNumber, line.debit - line.credit]),
    )
    const kloptByAccount = new Map(
      klopt.lines.map((line) => [line.accountNumber, line.debit - line.credit]),
    )
    const numbers = new Set([...moneybirdByAccount.keys(), ...kloptByAccount.keys()])
    const differences = [...numbers]
      .map((accountNumber) => {
        const moneybird = moneybirdByAccount.get(accountNumber) ?? 0n
        const ours = kloptByAccount.get(accountNumber) ?? 0n
        return {
          accountNumber,
          moneybird: amount(moneybird) ?? '0.00',
          klopt: amount(ours) ?? '0.00',
          difference: amount(ours - moneybird) ?? '0.00',
        }
      })
      .filter((row) => row.difference !== '0.00' && row.difference !== '-0.00')

    reconciliation.push({
      year: year.year,
      source: year.source,
      moneybirdDebit: amount(year.totalDebit),
      moneybirdCredit: amount(year.totalCredit),
      kloptDebit: amount(klopt.totalDebit),
      kloptCredit: amount(klopt.totalCredit),
      differences,
    })
  }

  return {
    dryRun: false,
    plan,
    commit,
    attachmentsStored,
    attachmentsSkipped,
    reconciliation,
  }
}

export class MoneybirdPlanRefused extends Error {
  constructor(readonly plan: MoneybirdImportPlan) {
    super('This Moneybird administration cannot be imported as it stands.')
    this.name = 'MoneybirdPlanRefused'
  }
}
