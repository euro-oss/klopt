import {
  buildBalanceSheet,
  buildCoverageReport,
  buildProfitAndLoss,
  assessUpgradeImpact,
  diffRgsSchemes,
  generateXaf,
  planXafImport,
  planYearClose,
  postJournalEntry,
  systemClock,
  validateMapping,
  validateXafDocument,
  type BalanceSheet,
  type ProfitAndLoss,
  type StatementSection,
} from '@klopt/core'
import { withLedger, withReporting, withRgs, withXafExport, withYearClose } from '@klopt/db'
import { hasPermission, mayPostToSoftClosedPeriod, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import { referenceData } from '../reference-data.js'

/**
 * RGS mapping, the statements, the year close and the auditfile.
 *
 * The pattern is the same throughout: resolve permission, load the reference
 * data the entity is mapped against, call `@klopt/core`, serialise. No rule
 * lives here.
 */

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

function requireIdempotencyKey(context: RequestContext): string {
  if (context.idempotencyKey === null || context.idempotencyKey === '') {
    throw new ApiError('idempotency_key_required', 'Every write needs an Idempotency-Key header.')
  }
  return context.idempotencyKey
}

function serialiseSection(section: StatementSection) {
  return {
    key: section.key,
    title: section.title,
    total: section.total.toString(),
    lines: section.lines.map((line) => ({
      accountNumber: line.accountNumber,
      accountName: line.accountName,
      accountType: line.accountType,
      rgsCode: line.rgsCode,
      amount: line.amount.toString(),
      signedBalance: line.signedBalance.toString(),
    })),
  }
}

function serialiseBalanceSheet(sheet: BalanceSheet) {
  return {
    kind: sheet.kind,
    currency: sheet.currency,
    asOf: sheet.asOf,
    assets: serialiseSection(sheet.assets),
    liabilities: serialiseSection(sheet.liabilities),
    equity: serialiseSection(sheet.equity),
    resultForPeriod: sheet.resultForPeriod.toString(),
    totalAssets: sheet.totalAssets.toString(),
    totalLiabilitiesAndEquity: sheet.totalLiabilitiesAndEquity.toString(),
    difference: sheet.difference.toString(),
  }
}

function serialiseProfitAndLoss(statement: ProfitAndLoss) {
  return {
    kind: statement.kind,
    currency: statement.currency,
    fromDate: statement.fromDate,
    toDate: statement.toDate,
    revenue: serialiseSection(statement.revenue),
    expenses: serialiseSection(statement.expenses),
    result: statement.result.toString(),
  }
}

export interface StatementQuery {
  readonly fiscalYear: string
  readonly fromPeriod: number
  readonly toPeriod: number
  readonly currency: string
}

async function balanceRows(context: RequestContext, query: StatementQuery) {
  return withReporting(context.database, (repository) =>
    repository.trialBalanceRows({
      entityId: context.entityId,
      fiscalYearCode: query.fiscalYear,
      fromPeriod: query.fromPeriod,
      toPeriod: query.toPeriod,
      currency: query.currency,
    }),
  )
}

async function periodDates(context: RequestContext, query: StatementQuery) {
  const range = await withReporting(context.database, (repository) =>
    repository.periodRange(context.entityId, query.fiscalYear, query.fromPeriod, query.toPeriod),
  )
  if (range === null) {
    throw new ApiError('not_found', `No periods for fiscal year ${query.fiscalYear}.`)
  }
  return range
}

export async function handleGetBalanceSheet(context: RequestContext, query: StatementQuery) {
  requirePermission(context, 'ledger:read')
  const range = await periodDates(context, query)
  const rows = await balanceRows(context, query)

  return {
    status: 200,
    body: serialiseBalanceSheet(
      buildBalanceSheet(
        { currency: query.currency, fromDate: range.fromDate, toDate: range.toDate },
        rows,
      ),
    ),
  }
}

export async function handleGetProfitAndLoss(context: RequestContext, query: StatementQuery) {
  requirePermission(context, 'ledger:read')
  const range = await periodDates(context, query)
  const rows = await balanceRows(context, query)

  return {
    status: 200,
    body: serialiseProfitAndLoss(
      buildProfitAndLoss(
        { currency: query.currency, fromDate: range.fromDate, toDate: range.toDate },
        rows,
      ),
    ),
  }
}

export async function handleGetRgsCoverage(
  context: RequestContext,
  query: { readonly currency: string; readonly applicableFlag: string | null },
) {
  requirePermission(context, 'ledger:read')

  const entity = await withReporting(context.database, (repository) =>
    repository.entity(context.entityId),
  )
  if (entity === null) throw new ApiError('not_found', 'No such entity.')

  const scheme = referenceData().rgs(`${entity.rgsVersion ?? '3.7'}-${entity.rgsVariant}`)
  const accounts = await withRgs(context.database, (repository) =>
    repository.mappableAccounts(context.entityId, query.currency),
  )

  const report = buildCoverageReport(
    accounts,
    scheme,
    query.applicableFlag === null ? {} : { applicableFlag: query.applicableFlag },
  )

  return {
    status: 200,
    body: {
      ...report,
      // A percentage, for a dashboard that should not have to divide.
      mappedPercentage: Number((report.mappableBalanceBasisPoints / 100).toFixed(2)),
    },
  }
}

export async function handleSetRgsMappings(
  context: RequestContext,
  body: {
    readonly mappings: readonly {
      readonly accountNumber: string
      readonly rgsCode: string | null
    }[]
    readonly dryRun: boolean
  },
) {
  requirePermission(context, 'ledger:configure')

  const entity = await withReporting(context.database, (repository) =>
    repository.entity(context.entityId),
  )
  if (entity === null) throw new ApiError('not_found', 'No such entity.')

  const scheme = referenceData().rgs(`${entity.rgsVersion ?? '3.7'}-${entity.rgsVariant}`)
  const accounts = await withRgs(context.database, (repository) =>
    repository.mappableAccounts(context.entityId, entity.functionalCurrency),
  )
  const byNumber = new Map(accounts.map((account) => [account.number, account]))

  // Validate every mapping before applying any of them: a half-applied mapping
  // change is a chart of accounts nobody can reason about.
  const problems = body.mappings.flatMap((mapping) => {
    const account = byNumber.get(mapping.accountNumber)
    if (account === undefined) {
      return [
        {
          accountNumber: mapping.accountNumber,
          accountName: '',
          rgsCode: mapping.rgsCode,
          code: 'unknown_code' as const,
          severity: 'error' as const,
          message: `No account ${mapping.accountNumber}.`,
        },
      ]
    }
    return validateMapping({ ...account, rgsCode: mapping.rgsCode }, scheme)
  })

  const errors = problems.filter((problem) => problem.severity === 'error')
  if (errors.length > 0) {
    throw new ApiError(
      'validation_failed',
      'One or more mappings are not valid.',
      errors.map((problem) => ({
        code: problem.code,
        path: `mappings.${problem.accountNumber}`,
        message: problem.message,
      })),
    )
  }

  if (body.dryRun) {
    return { status: 200, body: { dryRun: true, changed: 0, warnings: problems } }
  }

  const changed = await withRgs(context.database, (repository) =>
    repository.applyMappings({
      entityId: context.entityId,
      actorId: context.actor.id,
      actorKind: context.actor.kind,
      principalId: context.actor.principalId,
      requestId: context.requestId,
      mappings: body.mappings,
    }),
  )

  return { status: 200, body: { dryRun: false, changed, warnings: problems } }
}

export async function handlePreviewRgsUpgrade(
  context: RequestContext,
  query: { readonly toVersion: string },
) {
  requirePermission(context, 'ledger:read')

  const entity = await withReporting(context.database, (repository) =>
    repository.entity(context.entityId),
  )
  if (entity === null) throw new ApiError('not_found', 'No such entity.')

  const store = referenceData()
  const current = `${entity.rgsVersion ?? '3.7'}-${entity.rgsVariant}`
  if (!store.hasRgs(query.toVersion)) {
    throw new ApiError(
      'not_found',
      `RGS ${query.toVersion} is not loaded. Available: ${store.rgsVersions.join(', ')}.`,
    )
  }

  const diff = diffRgsSchemes(store.rgs(current), store.rgs(query.toVersion))
  const mappings = await withRgs(context.database, (repository) =>
    repository.currentMappings(context.entityId),
  )
  const impacts = assessUpgradeImpact(mappings, diff)

  return {
    status: 200,
    body: {
      fromVersion: diff.fromVersion,
      toVersion: diff.toVersion,
      summary: {
        added: diff.added.length,
        removed: diff.removed.length,
        deactivated: diff.deactivated.length,
        reactivated: diff.reactivated.length,
        changed: diff.changed.length,
      },
      // The whole diff is thousands of rows. What needs a decision is this.
      impacts,
      blocking: impacts.filter((impact) => impact.impact === 'removed').length,
    },
  }
}

export async function handleExportAuditFile(
  context: RequestContext,
  query: {
    readonly fiscalYear: string
    readonly fromPeriod: number | null
    readonly toPeriod: number | null
  },
) {
  requirePermission(context, 'ledger:export')

  const entity = await withReporting(context.database, (repository) =>
    repository.entity(context.entityId),
  )
  if (entity === null) throw new ApiError('not_found', 'No such entity.')

  const store = referenceData()
  const key = `${entity.rgsVersion ?? '3.7'}-${entity.rgsVariant}`
  const scheme = store.hasRgs(key) ? store.rgs(key) : null

  const document = await withXafExport(context.database, (repository) =>
    repository.build(
      {
        entityId: context.entityId,
        fiscalYearCode: query.fiscalYear,
        ...(query.fromPeriod === null ? {} : { fromPeriod: query.fromPeriod }),
        ...(query.toPeriod === null ? {} : { toPeriod: query.toPeriod }),
        softwareDesc: 'Klopt',
        softwareVersion: process.env['KLOPT_VERSION'] ?? '0.0.0',
        generatedOn: new Date().toISOString().slice(0, 10),
      },
      scheme,
    ),
  )

  const validation = validateXafDocument(document)

  // "An invalid XAF is a build-breaking bug, not a warning" (spec 7.3). It is
  // not offered for download.
  if (!validation.valid) {
    throw new ApiError(
      'validation_failed',
      'The generated auditfile did not validate. This is a bug; please report it with the detail below.',
      validation.problems
        .filter((problem) => problem.severity === 'error')
        .map((problem) => ({ code: 'xaf_invalid', path: problem.path, message: problem.message })),
    )
  }

  return {
    xml: generateXaf(document),
    filename: `xaf-${entity.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-${query.fiscalYear}.xml`,
    warnings: validation.problems.filter((problem) => problem.severity === 'warning'),
    lineCount: validation.lineCount,
  }
}

export async function handleImportAuditFile(
  context: RequestContext,
  body: { readonly xml: string; readonly dryRun: boolean },
) {
  requirePermission(context, 'ledger:import')
  const idempotencyKey = requireIdempotencyKey(context)

  const [accounts, journals] = await withReporting(context.database, async (repository) => [
    await repository.listAccounts(context.entityId),
    await repository.listJournals(context.entityId),
  ])

  const plan = planXafImport(body.xml, {
    entityId: context.entityId,
    existingAccountNumbers: accounts.map((account) => account.number),
    existingJournalCodes: journals.map((journal) => journal.code),
    acceptFrom: null,
    acceptTo: null,
  })

  const summary = {
    fiscalYear: plan.fiscalYear,
    companyName: plan.companyName,
    currency: plan.currency,
    reconciliation: {
      declaredLineCount: plan.reconciliation.declaredLineCount,
      declaredTotalDebit: plan.reconciliation.declaredTotalDebit?.toString() ?? null,
      declaredTotalCredit: plan.reconciliation.declaredTotalCredit?.toString() ?? null,
      actualLineCount: plan.reconciliation.actualLineCount,
      actualTotalDebit: plan.reconciliation.actualTotalDebit.toString(),
      actualTotalCredit: plan.reconciliation.actualTotalCredit.toString(),
      matches: plan.reconciliation.matches,
    },
    accounts: {
      total: plan.accounts.length,
      new: plan.accounts.filter((account) => !account.exists).length,
    },
    journals: {
      total: plan.journals.length,
      new: plan.journals.filter((journal) => !journal.exists).length,
    },
    entryCount: plan.entries.length,
    warnings: plan.warnings,
    problems: plan.problems,
  }

  if (plan.problems.length > 0) {
    throw new ApiError(
      'validation_failed',
      'The auditfile cannot be imported as it stands.',
      plan.problems,
    )
  }

  if (body.dryRun) {
    return { status: 200, body: { dryRun: true, posted: 0, ...summary } }
  }

  const missingAccounts = plan.accounts.filter((account) => !account.exists)
  const missingJournals = plan.journals.filter((journal) => !journal.exists)
  if (missingAccounts.length > 0 || missingJournals.length > 0) {
    throw new ApiError(
      'validation_failed',
      'The file references accounts or journals this entity does not have. Create them first, or run the dry run to see the list.',
      [
        ...missingAccounts.map((account) => ({
          code: 'unknown_account',
          path: `accounts.${account.number}`,
          message: `${account.number} (${account.name}) does not exist here.`,
        })),
        ...missingJournals.map((journal) => ({
          code: 'unknown_journal',
          path: `journals.${journal.code}`,
          message: `${journal.code} (${journal.name}) does not exist here.`,
        })),
      ],
    )
  }

  // One transaction for the whole file. A partially imported administration is
  // worse than one that failed to import.
  const posted = await withLedger(context.database, async (repository) => {
    let count = 0
    for (const [index, command] of plan.entries.entries()) {
      await postJournalEntry(
        command,
        context.actor,
        {
          dryRun: false,
          // Derived from the caller's key, so retrying the whole import is safe
          // and each entry keeps its own identity.
          idempotencyKey: `${idempotencyKey}:${String(index)}`,
          requestId: context.requestId,
          ip: context.ip,
          mayPostToSoftClosedPeriod: mayPostToSoftClosedPeriod(context),
        },
        { repository, clock: systemClock },
      )
      count += 1
    }
    return count
  })

  return { status: 201, body: { dryRun: false, posted, ...summary } }
}

export async function handleCloseYear(
  context: RequestContext,
  body: {
    readonly fiscalYear: string
    readonly resultAccountNumber: string
    readonly journalCode: string
    /**
     * Post the opening balance into the next year. False for an entity running
     * a continuous ledger, where balances simply carry.
     */
    readonly carryForward: boolean
    readonly dryRun: boolean
  },
) {
  requirePermission(context, 'ledger:close')
  const idempotencyKey = requireIdempotencyKey(context)

  return withYearClose(context.database, async ({ ledger, reporting, rgs }) => {
    const entity = await reporting.entity(context.entityId)
    if (entity === null) throw new ApiError('not_found', 'No such entity.')

    const year = await reporting.fiscalYear(context.entityId, body.fiscalYear)
    if (year === null) throw new ApiError('not_found', `No fiscal year ${body.fiscalYear}.`)

    const existing = await rgs.findOpenClose(year.id)
    if (existing !== null) {
      throw new ApiError(
        'conflict',
        `Fiscal year ${body.fiscalYear} is already closed. Reverse the close first.`,
      )
    }

    const rows = await reporting.trialBalanceRows({
      entityId: context.entityId,
      fiscalYearCode: body.fiscalYear,
      fromPeriod: 1,
      toPeriod: 13,
      currency: entity.functionalCurrency,
    })

    const nextYearStart = new Date(`${year.endsOn}T00:00:00Z`)
    nextYearStart.setUTCDate(nextYearStart.getUTCDate() + 1)
    const openingDate = nextYearStart.toISOString().slice(0, 10)

    // Checked before anything is posted. Discovering halfway through that the
    // opening balance has nowhere to land would leave a flattened P&L and no
    // balances carried forward — the one state a close must never produce.
    if (body.carryForward && !(await reporting.periodContaining(context.entityId, openingDate))) {
      throw new ApiError(
        'validation_failed',
        `There is no fiscal period containing ${openingDate}. Create the next fiscal year before closing ${body.fiscalYear}, or close with carryForward: false.`,
      )
    }

    const plan = planYearClose(
      {
        entityId: context.entityId,
        resultAccountNumber: body.resultAccountNumber,
        journalCode: body.journalCode,
        closingDate: year.endsOn,
        openingDate,
        fiscalYearCode: body.fiscalYear,
      },
      rows,
    )

    /**
     * One response shape, dry run or not. A caller should be able to read
     * `result` and the two line lists without first branching on `dryRun` —
     * that branch is exactly where a preview gets mistaken for a receipt.
     */
    const lines = (command: typeof plan.appropriation) =>
      command?.lines.map((line) => ({
        accountNumber: line.accountNumber,
        debit: line.debit.toString(),
        credit: line.credit.toString(),
      })) ?? []

    const summary = {
      fiscalYear: body.fiscalYear,
      result: plan.result.toString(),
      currency: entity.functionalCurrency,
      profitAndLossAccounts: plan.profitAndLossAccountCount,
      balanceSheetAccounts: plan.balanceSheetAccountCount,
      appropriationLines: lines(plan.appropriation),
      openingLines: body.carryForward ? lines(plan.openingBalance) : [],
    }

    if (body.dryRun) {
      return {
        status: 200,
        body: {
          dryRun: true,
          closeId: null as string | null,
          appropriationEntryId: null as string | null,
          openingEntryId: null as string | null,
          ...summary,
        },
      }
    }

    const post = async (command: NonNullable<typeof plan.appropriation>, suffix: string) => {
      const result = await postJournalEntry(
        command,
        context.actor,
        {
          dryRun: false,
          idempotencyKey: `${idempotencyKey}:${suffix}`,
          requestId: context.requestId,
          ip: context.ip,
          // A close writes into the year being closed, which is normally the
          // point at which it is soft-closed.
          mayPostToSoftClosedPeriod: true,
        },
        { repository: ledger, clock: systemClock },
      )
      return result.entry.id
    }

    const appropriationEntryId =
      plan.appropriation === null ? null : await post(plan.appropriation, 'appropriation')
    const openingEntryId =
      plan.openingBalance === null || !body.carryForward
        ? null
        : await post(plan.openingBalance, 'opening')

    const closeId = await rgs.recordYearClose({
      entityId: context.entityId,
      fiscalYearId: year.id,
      appropriationEntryId,
      openingEntryId,
      result: plan.result,
      currency: entity.functionalCurrency,
      closedBy: context.actor.id,
    })

    return {
      status: 201,
      body: { dryRun: false, closeId, appropriationEntryId, openingEntryId, ...summary },
    }
  })
}
