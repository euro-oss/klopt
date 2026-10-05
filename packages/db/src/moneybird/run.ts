import {
  buildTrialBalance,
  planMoneybirdImport,
  sha256Hex,
  contentTypeFor,
  yearOf,
  type Actor,
  type DocumentStore,
  type MoneybirdClient,
  type MoneybirdImportPlan,
  type MoneybirdSnapshot,
} from '@klopt/core'
import { eq } from 'drizzle-orm'
import type { Database } from '../client.js'
import { commitMoneybirdImport, type MoneybirdCommitResult } from './import.js'
import { InboxRepository } from '../repositories/inbox.js'
import { MoneybirdConnectionRepository } from '../repositories/moneybird.js'
import { MoneybirdImportRepository } from '../repositories/moneybird-import.js'
import { ReportingRepository } from '../repositories/reporting.js'
import { SetupRepository } from '../repositories/setup.js'
import {
  journalEntries,
  journalLines,
  accounts,
  purchaseInvoices,
  salesInvoices,
} from '../schema/index.js'
import { withSetup } from '../unit-of-work.js'

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

export interface MoneybirdAccountBalance {
  readonly accountNumber: string
  /** Planned from Moneybird history — not Moneybird's own trial balance. */
  readonly planned: string
  readonly klopt: string
  readonly difference: string
}

export interface MoneybirdYearReconciliation {
  readonly year: number
  readonly source: string
  readonly plannedDebit: string | null
  readonly plannedCredit: string | null
  readonly kloptDebit: string | null
  readonly kloptCredit: string | null
  /** Null when the Moneybird source was unreadable — that is not reconciled. */
  readonly balanced: boolean | null
  readonly accounts: readonly MoneybirdAccountBalance[]
  readonly differences: readonly MoneybirdAccountBalance[]
}

export interface MoneybirdOpeningBalance {
  readonly year: number
  readonly accounts: readonly MoneybirdAccountBalance[]
}

export interface MoneybirdRunReport {
  readonly dryRun: false
  readonly plan: MoneybirdImportPlan
  readonly commit: MoneybirdCommitResult
  readonly attachmentsStored: number
  readonly attachmentsSkipped: number
  readonly reconciliation: readonly MoneybirdYearReconciliation[]
  readonly opening: MoneybirdOpeningBalance | null
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
    const setup = new SetupRepository(tx)
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
    entityFiscalYearStartMonth: here.entity.fiscalYearStartMonth,
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
    await database.transaction(async (tx) => {
      const inbox = new InboxRepository(tx)
      const imported = new MoneybirdImportRepository(tx)
      const recorded = await inbox.recordDocument({
        entityId,
        sha256: stored.sha256 ?? sha256Hex(bytes),
        sizeBytes: bytes.byteLength,
        contentType,
        filename: attachment.filename,
      })
      await imported.rememberAttachment({
        entityId,
        moneybirdAttachmentId: attachment.id,
        moneybirdDocumentId: document.moneybirdId,
        documentId: recorded.id,
      })
      const journalEntryId = await imported.journalEntryId(
        entityId,
        `${document.kind}:${document.moneybirdId}`,
      )
      if (journalEntryId !== null) {
        await inbox.link({
          entityId,
          documentId: recorded.id,
          subjectKind: 'journal_entry',
          subjectId: journalEntryId,
          role: 'attachment',
        })
        const [purchase] = await tx
          .select({ id: purchaseInvoices.id })
          .from(purchaseInvoices)
          .where(eq(purchaseInvoices.journalEntryId, journalEntryId))
          .limit(1)
        if (purchase !== undefined) {
          await inbox.link({
            entityId,
            documentId: recorded.id,
            subjectKind: 'purchase_invoice',
            subjectId: purchase.id,
            role: 'attachment',
          })
        }
        const [sale] = await tx
          .select({ id: salesInvoices.id })
          .from(salesInvoices)
          .where(eq(salesInvoices.journalEntryId, journalEntryId))
          .limit(1)
        if (sale !== undefined) {
          await inbox.link({
            entityId,
            documentId: recorded.id,
            subjectKind: 'sales_invoice',
            subjectId: sale.id,
            role: 'attachment',
          })
        }
      }
    })
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
    const plannedByAccount = new Map(
      year.lines.map((line) => [line.accountNumber, line.debit - line.credit]),
    )
    const kloptByAccount = new Map(
      klopt.lines.map((line) => [line.accountNumber, line.debit - line.credit]),
    )
    const numbers = [...new Set([...plannedByAccount.keys(), ...kloptByAccount.keys()])].sort()
    const accounts = numbers.map((accountNumber) => {
      const planned = plannedByAccount.get(accountNumber) ?? 0n
      const ours = kloptByAccount.get(accountNumber) ?? 0n
      return {
        accountNumber,
        planned: amount(planned) ?? '0.00',
        klopt: amount(ours) ?? '0.00',
        difference: amount(ours - planned) ?? '0.00',
      }
    })

    const differences = accounts.filter(
      (row) => row.difference !== '0.00' && row.difference !== '-0.00',
    )
    reconciliation.push({
      year: year.year,
      source: year.source,
      plannedDebit: amount(year.totalDebit),
      plannedCredit: amount(year.totalCredit),
      kloptDebit: amount(klopt.totalDebit),
      kloptCredit: amount(klopt.totalCredit),
      balanced: year.source === 'unreadable' ? null : differences.length === 0,
      accounts,
      differences,
    })
  }

  const opening = await openingBalance(database, entityId, snapshot, plan)

  return {
    dryRun: false,
    plan,
    commit,
    attachmentsStored,
    attachmentsSkipped,
    reconciliation,
    opening,
  }
}

async function openingBalance(
  database: Database,
  entityId: string,
  snapshot: MoneybirdSnapshot,
  plan: MoneybirdImportPlan,
): Promise<MoneybirdOpeningBalance | null> {
  const openings = snapshot.journalDocuments.filter(
    (document) => (document.origin ?? '').toLowerCase() === 'opening',
  )
  if (openings.length === 0) return null

  const year = Math.min(...openings.map((document) => yearOf(document.date)))
  const numberById = new Map(plan.accounts.map((account) => [account.moneybirdId, account.number]))
  const plannedByAccount = new Map<string, bigint>()
  for (const document of openings) {
    for (const line of document.details) {
      const number =
        line.ledgerAccountId === null ? null : (numberById.get(line.ledgerAccountId) ?? null)
      if (number === null) continue
      plannedByAccount.set(number, (plannedByAccount.get(number) ?? 0n) + line.debit - line.credit)
    }
  }

  const refs = new Set(openings.map((document) => `journal:${document.id}`))
  const kloptByAccount = new Map<string, bigint>()
  const entryRefs = await database
    .select({
      sourceDocumentRef: journalEntries.sourceDocumentRef,
      number: accounts.number,
      debit: journalLines.functionalDebitMinorUnits,
      credit: journalLines.functionalCreditMinorUnits,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalEntries.entityId, entityId))

  for (const row of entryRefs) {
    const ref = row.sourceDocumentRef ?? ''
    if (![...refs].some((external) => ref.endsWith(`:${external}`))) continue
    kloptByAccount.set(row.number, (kloptByAccount.get(row.number) ?? 0n) + row.debit - row.credit)
  }

  const numbers = [...new Set([...plannedByAccount.keys(), ...kloptByAccount.keys()])].sort()
  return {
    year,
    accounts: numbers.map((accountNumber) => {
      const planned = plannedByAccount.get(accountNumber) ?? 0n
      const ours = kloptByAccount.get(accountNumber) ?? 0n
      return {
        accountNumber,
        planned: amount(planned) ?? '0.00',
        klopt: amount(ours) ?? '0.00',
        difference: amount(ours - planned) ?? '0.00',
      }
    }),
  }
}

export class MoneybirdPlanRefused extends Error {
  constructor(readonly plan: MoneybirdImportPlan) {
    super('This Moneybird administration cannot be imported as it stands.')
    this.name = 'MoneybirdPlanRefused'
  }
}
