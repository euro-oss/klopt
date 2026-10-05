import {
  MoneybirdReadError,
  findAdministration,
  planMoneybirdImport,
  selectableAdministrations,
  type MoneybirdImportPlan,
  type MoneybirdRequestLog,
  type YearTrialBalance,
} from '@klopt/core'
import { MoneybirdApiError, createMoneybirdClient, readAdministration } from '@klopt/adapters'
import {
  MoneybirdImportRepository,
  ReportingRepository,
  SecretKeyMissingError,
  SecretKeyTooShortError,
  SetupRepository,
  secretsAvailable,
  withMoneybirdConnection,
  withMoneybirdConnectionRead,
  withMoneybirdImport,
  type MoneybirdConnectionCredentials,
  type MoneybirdImportRunRow,
} from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import { recordAudit } from '../audit.js'
import type {
  ChooseMoneybirdAdministrationBody,
  ConnectMoneybirdBody,
  SaveMoneybirdMappingsBody,
} from '../schemas.js'

function requireIdempotencyKey(context: RequestContext): string {
  if (context.idempotencyKey === null || context.idempotencyKey === '') {
    throw new ApiError('idempotency_key_required', 'Every write needs an Idempotency-Key header.')
  }
  return context.idempotencyKey
}

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

function serialiseConnection(row: {
  baseUrl: string
  administrationId: string | null
  administrationName: string | null
  administrationCurrency: string | null
  accountMappings: Readonly<Record<string, string>>
  taxMappings: Readonly<Record<string, string>>
  connected: boolean
  lastImportAt: string | null
  lastError: string | null
}) {
  return {
    baseUrl: row.baseUrl,
    administrationId: row.administrationId,
    administrationName: row.administrationName,
    administrationCurrency: row.administrationCurrency,
    accountMappings: row.accountMappings,
    taxMappings: row.taxMappings,
    connected: row.connected,
    ready: row.connected && row.administrationId !== null,
    lastImportAt: row.lastImportAt,
    lastError: row.lastError,
  }
}

export async function handleGetMoneybirdConnection(context: RequestContext) {
  requirePermission(context, 'ledger:read')
  const row = await withMoneybirdConnectionRead(context.database, (repository) =>
    repository.find(context.entityId),
  )
  return {
    status: 200,
    body: {
      connection: row === null ? null : serialiseConnection(row),
      canStoreSecrets: secretsAvailable(),
    },
  }
}

export async function handleConnectMoneybird(context: RequestContext, body: ConnectMoneybirdBody) {
  requirePermission(context, 'ledger:configure')
  requireIdempotencyKey(context)

  try {
    await withMoneybirdConnection(context.database, (repository) =>
      repository.upsertToken({
        entityId: context.entityId,
        baseUrl: body.baseUrl,
        apiToken: body.apiToken,
      }),
    )
  } catch (error: unknown) {
    if (error instanceof SecretKeyMissingError || error instanceof SecretKeyTooShortError) {
      throw new ApiError('validation_failed', error.message, [
        { code: 'no_secret_key', path: 'apiToken', message: error.message },
      ])
    }
    throw error
  }

  await recordAudit(context, {
    action: 'moneybird.connect',
    resourceType: 'moneybird_connection',
    resourceId: context.entityId,
    after: { baseUrl: body.baseUrl },
  })

  return { status: 201, body: { connected: true } }
}

async function clientFor(context: RequestContext): Promise<{
  readonly client: ReturnType<typeof createMoneybirdClient>
  readonly connection: MoneybirdConnectionCredentials
}> {
  const connection = await withMoneybirdConnection(context.database, (repository) =>
    repository.withCredentials(context.entityId),
  )
  if (connection === null) {
    throw new ApiError('not_found', 'These books are not connected to Moneybird.')
  }
  if (connection.apiToken === '') {
    throw new ApiError(
      'conflict',
      'The stored Moneybird token could not be decrypted. Set KLOPT_ENCRYPTION_KEY and connect again.',
    )
  }
  const client = createMoneybirdClient({ token: connection.apiToken, base: connection.baseUrl })
  return { client, connection }
}

async function refuse(
  context: RequestContext,
  error: unknown,
  log: readonly MoneybirdRequestLog[] = [],
): Promise<never> {
  const message = error instanceof Error ? error.message : String(error)
  const progress =
    log.length === 0
      ? ''
      : ` Read ${String(log.length)} request(s) before this, last of them ${log[log.length - 1]?.path ?? '?'}.`

  await withMoneybirdConnection(context.database, (repository) =>
    repository.recordFailure(context.entityId, message),
  )

  if (error instanceof MoneybirdApiError) {
    throw new ApiError('conflict', `Moneybird could not be read: ${message}${progress}`)
  }
  if (error instanceof MoneybirdReadError) {
    throw new ApiError(
      'conflict',
      `Moneybird returned a row this importer could not read: ${message}${progress}`,
      [{ code: 'unreadable_row', path: error.field, message }],
    )
  }
  throw error
}

export async function handleListMoneybirdAdministrations(context: RequestContext) {
  requirePermission(context, 'ledger:configure')
  const { client, connection } = await clientFor(context)
  try {
    const administrations = await client.administrations()
    await withMoneybirdConnection(context.database, (repository) =>
      repository.recordSuccess(context.entityId),
    )
    return {
      status: 200,
      body: {
        chosen: connection.administrationId,
        administrations: selectableAdministrations(administrations).map((administration) => ({
          id: administration.id,
          name: administration.name,
          label: administration.label,
          currency: administration.currency,
          country: administration.country,
        })),
      },
    }
  } catch (error: unknown) {
    return refuse(context, error, client.log)
  }
}

export async function handleChooseMoneybirdAdministration(
  context: RequestContext,
  body: ChooseMoneybirdAdministrationBody,
) {
  requirePermission(context, 'ledger:configure')
  requireIdempotencyKey(context)
  const { client } = await clientFor(context)
  let administrations
  try {
    administrations = await client.administrations()
  } catch (error: unknown) {
    return refuse(context, error, client.log)
  }
  const chosen = findAdministration(administrations, body.administrationId)
  if (chosen === null) {
    throw new ApiError(
      'not_found',
      `This Moneybird token cannot reach administration ${body.administrationId}.`,
    )
  }
  await withMoneybirdConnection(context.database, (repository) =>
    repository.chooseAdministration({
      entityId: context.entityId,
      id: chosen.id,
      name: chosen.name,
      currency: chosen.currency,
    }),
  )
  await recordAudit(context, {
    action: 'moneybird.chooseAdministration',
    resourceType: 'moneybird_connection',
    resourceId: context.entityId,
    after: { administrationId: chosen.id, administrationName: chosen.name },
  })
  return {
    status: 200,
    body: {
      administrationId: chosen.id,
      administrationName: chosen.name,
      currency: chosen.currency,
      label: chosen.label,
    },
  }
}

export async function handleSaveMoneybirdMappings(
  context: RequestContext,
  body: SaveMoneybirdMappingsBody,
) {
  requirePermission(context, 'ledger:import')
  requireIdempotencyKey(context)
  await withMoneybirdConnection(context.database, (repository) =>
    repository.saveMappings({
      entityId: context.entityId,
      accountMappings: body.accountMappings,
      taxMappings: body.taxMappings,
    }),
  )
  await recordAudit(context, {
    action: 'moneybird.saveMappings',
    resourceType: 'moneybird_connection',
    resourceId: context.entityId,
    after: {
      accounts: String(Object.keys(body.accountMappings).length),
      taxRates: String(Object.keys(body.taxMappings).length),
    },
  })
  return { status: 200, body: { saved: true } }
}

function amount(value: bigint | null): string | null {
  if (value === null) return null
  const negative = value < 0n
  const digits = (negative ? -value : value).toString().padStart(3, '0')
  const cut = digits.length - 2
  return `${negative ? '-' : ''}${digits.slice(0, cut)}.${digits.slice(cut)}`
}

function serialiseYear(year: YearTrialBalance) {
  return {
    year: year.year,
    source: year.source,
    totalDebit: amount(year.totalDebit),
    totalCredit: amount(year.totalCredit),
    balanced: year.balanced,
    accountCount: year.accountCount,
    lines: year.lines.map((line) => ({
      accountNumber: line.accountNumber,
      debit: amount(line.debit),
      credit: amount(line.credit),
    })),
  }
}

function serialisePlan(plan: MoneybirdImportPlan) {
  const ofKind = (kind: string) => plan.entries.filter((entry) => entry.kind === kind)
  return {
    administration: {
      id: plan.administration.id,
      name: plan.administration.name,
      currency: plan.administration.currency,
      country: plan.administration.country,
    },
    years: plan.years,
    counts: {
      accounts: plan.accounts.length,
      contacts: plan.contacts.length,
      salesInvoices: ofKind('sales_invoice').length,
      creditNotes: ofKind('credit_note').length,
      purchaseInvoices: ofKind('purchase_invoice').length,
      receipts: ofKind('receipt').length,
      financialAccounts: plan.financialAccounts.length,
      bankMutations: ofKind('bank_mutation').length,
      journalDocuments: ofKind('journal').length,
      taxRates: plan.taxRates.length,
      documents: plan.documents.length,
      attachments: plan.documents.reduce((sum, document) => sum + document.attachments.length, 0),
    },
    accounts: {
      count: plan.accounts.length,
      new: plan.accounts.filter((account) => !account.exists).length,
      sample: plan.accounts.slice(0, 50).map((account) => ({
        moneybirdId: account.moneybirdId,
        number: account.number,
        proposedNumber: account.proposedNumber,
        name: account.name,
        type: account.type,
        exists: account.exists,
        mapped: account.mapped,
        rgsCode: account.rgsCode,
      })),
    },
    taxRates: plan.taxRates.map((rate) => ({
      moneybirdId: rate.moneybirdId,
      name: rate.name,
      percentage: rate.percentage,
      taxRateType: rate.taxRateType,
      proposedCode: rate.proposedCode,
      mappedCode: rate.mappedCode,
      mapped: rate.mapped,
      used: rate.used,
    })),
    contacts: {
      count: plan.contacts.length,
      new: plan.contacts.filter((contact) => !contact.exists).length,
      customers: plan.contacts.filter((contact) => contact.isCustomer).length,
      suppliers: plan.contacts.filter((contact) => contact.isSupplier).length,
    },
    reconciliation: plan.reconciliation.map(serialiseYear),
    notImported: plan.notImported,
    warnings: plan.warnings,
    problems: plan.problems,
  }
}

async function planFor(context: RequestContext, client: ReturnType<typeof createMoneybirdClient>) {
  const connection = await withMoneybirdConnectionRead(context.database, (repository) =>
    repository.find(context.entityId),
  )
  if (connection?.administrationId === null || connection === null) {
    throw new ApiError(
      'conflict',
      'No Moneybird administration has been chosen yet. There is more than one, so this cannot be guessed.',
    )
  }

  const here = await context.database.transaction(async (tx) => {
    const reporting = new ReportingRepository(tx)
    const imported = new MoneybirdImportRepository(tx)
    const setup = new SetupRepository(tx)
    const [entity, resolutions, accounts, years, rules, externalIds] = await Promise.all([
      reporting.entity(context.entityId),
      reporting.importResolutions(context.entityId),
      reporting.listAccounts(context.entityId),
      setup.listFiscalYears(context.entityId),
      reporting.taxRules(context.entityId),
      imported.knownExternalIds(context.entityId),
    ])
    return { entity, resolutions, accounts, years, rules, externalIds }
  })

  if (here.entity === null) throw new ApiError('not_found', 'No such administration.')

  const snapshot = await readAdministration({
    client,
    administrationId: connection.administrationId,
  })

  const plan = planMoneybirdImport(snapshot, {
    entityId: context.entityId,
    currency: here.entity.functionalCurrency,
    existingAccountNumbers: here.accounts.map((account) => account.number),
    existingContactNumbers: [...here.resolutions.contactIdsByNumber.keys()],
    existingTaxRules: here.rules,
    confirmedAccountMappings: connection.accountMappings,
    confirmedTaxMappings: connection.taxMappings,
    existingExternalIds: here.externalIds,
    lockedYears: here.years.filter((year) => year.status === 'closed').map((year) => year.code),
    entityFiscalYearStartMonth: here.entity.fiscalYearStartMonth,
  })

  return { plan, snapshot, connection }
}

export async function handlePreviewMoneybirdImport(context: RequestContext) {
  requirePermission(context, 'ledger:import')
  const { client } = await clientFor(context)
  try {
    const { plan } = await planFor(context, client)
    await withMoneybirdConnection(context.database, (repository) =>
      repository.recordSuccess(context.entityId),
    )
    return {
      status: 200,
      body: { dryRun: true as const, ...serialisePlan(plan), requests: client.log },
    }
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error
    return refuse(context, error, client.log)
  }
}

export async function handleRunMoneybirdImport(context: RequestContext) {
  requirePermission(context, 'ledger:import')
  requireIdempotencyKey(context)
  const { client, connection } = await clientFor(context)
  if (connection.administrationId === null) {
    throw new ApiError(
      'conflict',
      'No Moneybird administration has been chosen yet. There is more than one, so this cannot be guessed.',
    )
  }

  try {
    const { plan } = await planFor(context, client)
    if (plan.problems.length > 0) {
      throw new ApiError(
        'validation_failed',
        'This administration cannot be imported as it stands. Run the dry run to see why.',
        plan.problems.map((problem) => ({
          code: problem.code,
          path: problem.path,
          message: problem.message,
        })),
      )
    }
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error
    return refuse(context, error, client.log)
  }

  const run = await withMoneybirdImport(context.database, (repository) =>
    repository.request({
      entityId: context.entityId,
      administrationId: connection.administrationId!,
      requestedBy: context.actor.id,
    }),
  )

  await recordAudit(context, {
    action: 'moneybird.runImport',
    resourceType: 'moneybird_connection',
    resourceId: context.entityId,
    after: { administrationId: connection.administrationId, runId: run.id, state: run.state },
  })

  return { status: 202, body: serialiseRun(run) }
}

export async function handleMoneybirdImportStatus(context: RequestContext) {
  requirePermission(context, 'ledger:read')
  const run = await withMoneybirdImport(context.database, (repository) =>
    repository.find(context.entityId),
  )
  return { status: 200, body: run === null ? ({ requested: false } as const) : serialiseRun(run) }
}

export async function handleDisconnectMoneybird(context: RequestContext) {
  requirePermission(context, 'ledger:configure')
  await withMoneybirdConnection(context.database, (repository) =>
    repository.remove(context.entityId),
  )
  await recordAudit(context, {
    action: 'moneybird.disconnect',
    resourceType: 'moneybird_connection',
    resourceId: context.entityId,
    after: { connected: false },
  })
  return { status: 200, body: { disconnected: true } }
}

const WORKER_SILENCE_MS = 5 * 60_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asFindings(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((row) => ({
    code: asString(row['code']),
    path: asStringOrNull(row['path']),
    message: asString(row['message']),
  }))
}

function asAccountBalances(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((row) => ({
    accountNumber: asString(row['accountNumber']),
    planned: asString(row['planned'] ?? row['moneybird']),
    klopt: asString(row['klopt']),
    difference: asString(row['difference']),
  }))
}

function asBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function asReconciliation(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((row) => ({
    year: asNumber(row['year']),
    source: asString(row['source']),
    plannedDebit: asStringOrNull(row['plannedDebit'] ?? row['moneybirdDebit']),
    plannedCredit: asStringOrNull(row['plannedCredit'] ?? row['moneybirdCredit']),
    kloptDebit: asStringOrNull(row['kloptDebit']),
    kloptCredit: asStringOrNull(row['kloptCredit']),
    balanced: asBooleanOrNull(row['balanced']),
    accounts: asAccountBalances(row['accounts']),
    differences: asAccountBalances(row['differences']),
  }))
}

function asOpening(value: unknown) {
  if (!isRecord(value)) return null
  return {
    year: asNumber(value['year']),
    accounts: asAccountBalances(value['accounts']),
  }
}

/** jsonb from the worker, reduced to what JSON Schema can name. */
function serialiseStoredReport(report: unknown) {
  if (!isRecord(report)) return null
  const commit = isRecord(report['commit']) ? report['commit'] : {}
  const counts = isRecord(report['counts']) ? report['counts'] : {}
  if (report['dryRun'] !== false) {
    return {
      imported: false as const,
      problems: asFindings(report['problems']),
      warnings: asFindings(report['warnings']),
    }
  }
  return {
    imported: true as const,
    dryRun: false as const,
    accountsCreated: asNumber(commit['accountsCreated']),
    contactsCreated: asNumber(commit['contactsCreated']),
    entriesPosted: asNumber(commit['entriesPosted']),
    entriesReplayed: asNumber(commit['entriesReplayed']),
    entriesSkipped: asNumber(commit['entriesSkipped']),
    bankAccountsCreated: asNumber(commit['bankAccountsCreated']),
    bankTransactionsCreated: asNumber(commit['bankTransactionsCreated']),
    invoicesImported: asNumber(commit['invoicesImported']),
    attachmentsStored: asNumber(report['attachmentsStored']),
    attachmentsSkipped: asNumber(report['attachmentsSkipped']),
    skipped: Array.isArray(commit['skipped']) ? commit['skipped'].map(asString) : [],
    counts: {
      accounts: asNumber(counts['accounts']),
      contacts: asNumber(counts['contacts']),
      entries: asNumber(counts['entries']),
    },
    reconciliation: asReconciliation(report['reconciliation']),
    opening: asOpening(report['opening']),
    notImported: Array.isArray(report['notImported']) ? report['notImported'].map(asString) : [],
    problems: asFindings(report['problems']),
    warnings: asFindings(report['warnings']),
  }
}

function serialiseRun(run: MoneybirdImportRunRow) {
  const waiting =
    run.state === 'pending' &&
    run.startedAt === null &&
    Date.now() - Date.parse(run.requestedAt) > WORKER_SILENCE_MS
  return {
    requested: true as const,
    state: run.state,
    workerSilent: waiting,
    administrationId: run.administrationId,
    report: serialiseStoredReport(run.report),
    lastError: run.lastError,
    requestedAt: run.requestedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  }
}
