import { createServerFn } from '@tanstack/react-start'
import {
  handleGetDunningQueue,
  handleListInvoices,
  handleListOverdueInvoices,
} from '~/api/handlers/sales'
import { handleListBankAccounts, handleListBankTransactions } from '~/api/handlers/bank'
import { handleGetProfitAndLoss } from '~/api/handlers/compliance'
import { handleListInbox } from '~/api/handlers/inbox'
import { handleMoneybirdImportStatus } from '~/api/handlers/moneybird'
import { handleGetCreditorAgeing, handleListPurchaseInvoices } from '~/api/handlers/purchase'
import { handleListFiscalYears } from '~/api/handlers/setup'
import { handleListVatPeriods } from '~/api/handlers/vat'
import { hasPermission, type RequestContext } from '~/api/context'
import { listPurchaseInvoicesQuery, listVatPeriodsQuery } from '~/api/schemas'
import { buildPeriodRows, chartPeriodsThroughToday, type MonthBar } from '~/lib/dashboard'
import { buildWorkQueue, type WorkQueueItem } from '~/lib/work-queue'
import { isFiscalYearCode, withinFiscalYear, type FiscalYearScope } from '~/lib/fiscal-year'
import { contextFromRequest, reportYear, run } from './internal'

/**
 * What the redesigned dashboard needs, for one book year.
 *
 * One call rather than a dozen round trips. The reads are the same handlers
 * `/api/v1` serves; nothing new is modelled here and nothing is written.
 *
 * Import findings come from the last stored Moneybird dry-run / run report —
 * never from a live preview (that walk is too heavy for every dashboard load).
 * Bank match suggestion counts and Exact finding status have no aggregate API
 * yet — leave those numbers out entirely rather than inventing 0 (#61 follow-up).
 * The bank row shows the unmatched count alone, with no suggestion subtitle.
 */

const SCAN_LIMIT = 1000

export interface DashboardFigures {
  readonly bank: {
    /** `null` when the account has no imported statement yet — render "—". */
    readonly balance: string | null
    readonly name: string
    readonly iban: string
    readonly statementDate: string | null
  } | null
  readonly receivables: {
    /**
     * Overdue outstanding only. Labelled "Te laat bij klanten" until a full
     * open-AR aggregate exists (#61 follow-up). Do not present as "Nog te
     * ontvangen".
     */
    readonly total: string
    readonly count: number
    readonly overdueCount: number
  }
  readonly payables: {
    readonly total: string
    readonly count: number
  }
  readonly profit: {
    /** `null` when the P&L read failed — render "—", not € 0,00. */
    readonly result: string | null
    readonly priorResult: string | null
  }
}

export interface DashboardPayload {
  readonly fiscalYear: FiscalYearScope
  readonly items: readonly WorkQueueItem[]
  readonly figures: DashboardFigures
  readonly months: readonly MonthBar[]
  readonly periods: ReturnType<typeof buildPeriodRows>
}

async function loadDashboard(
  context: RequestContext,
  fiscalYear: string | null,
): Promise<DashboardPayload> {
  const { scope } = await reportYear(context, isFiscalYearCode(fiscalYear) ? fiscalYear : null)
  const today = new Date().toISOString().slice(0, 10)
  const priorCode = String(Number(scope.code) - 1)

  const [
    drafts,
    overdue,
    dunning,
    transactions,
    inbox,
    purchases,
    bankAccounts,
    payables,
    profit,
    priorProfit,
    vatPeriods,
    moneybird,
    fiscalYears,
  ] = await Promise.all([
    handleListInvoices(context, { status: 'draft', limit: 500, updatedSince: null }),
    handleListOverdueInvoices(context, { asOf: scope.asOf }),
    handleGetDunningQueue(context, { asOf: scope.asOf }),
    handleListBankTransactions(context, {
      bankAccountId: null,
      status: 'unmatched',
      limit: SCAN_LIMIT,
    }),
    handleListInbox(context, { state: 'new' }),
    handleListPurchaseInvoices(context, listPurchaseInvoicesQuery.parse({})),
    handleListBankAccounts(context),
    handleGetCreditorAgeing(context, { asOf: scope.asOf }).catch(() => null),
    handleGetProfitAndLoss(context, {
      fiscalYear: scope.code,
      fromPeriod: 1,
      toPeriod: 13,
      currency: 'EUR',
    }).catch(() => null),
    handleGetProfitAndLoss(context, {
      fiscalYear: priorCode,
      fromPeriod: 1,
      toPeriod: 13,
      currency: 'EUR',
    }).catch(() => null),
    handleListVatPeriods(context, listVatPeriodsQuery.parse({ year: Number(scope.code) })).catch(
      () => null,
    ),
    handleMoneybirdImportStatus(context).catch(() => null),
    handleListFiscalYears(context),
  ])

  const overdueInYear = overdue.body.invoices.filter((invoice) =>
    withinFiscalYear(scope, invoice.dueDate),
  )
  const purchasesInYear = purchases.body.invoices.filter((invoice) =>
    withinFiscalYear(scope, invoice.invoiceDate),
  )

  const ranked = [...overdueInYear].sort((a, b) => b.daysOverdue - a.daysOverdue)
  const topOverdue = ranked[0]

  const moneybirdBody = moneybird?.body
  const importProblems =
    moneybirdBody !== undefined &&
    moneybirdBody.requested === true &&
    moneybirdBody.report !== null &&
    'problems' in moneybirdBody.report
      ? moneybirdBody.report.problems.length
      : 0

  // Most recent ended, unfiled period in this boekjaar — not Q1 when it is
  // already October. A fresh administration still sees the current aangifte
  // when its period has closed; older open periods stay on /vat.
  const vatReady =
    vatPeriods === null
      ? null
      : ([...vatPeriods.body.periods]
          .filter((period) => !period.filed && period.to < today && period.from >= scope.startsOn)
          .at(-1) ?? null)

  const items = buildWorkQueue(
    {
      importBlocking: importProblems,
      importSource: importProblems > 0 ? 'moneybird' : null,
      salesDrafts: drafts.body.invoices.filter((invoice) =>
        withinFiscalYear(scope, invoice.issueDate),
      ).length,
      salesOverdue: overdueInYear.length,
      salesOverdueTotal: overdueInYear
        .reduce((sum, invoice) => sum + BigInt(invoice.total), 0n)
        .toString(),
      salesOverdueTop:
        topOverdue === undefined
          ? null
          : {
              contactName: topOverdue.contactName,
              number: topOverdue.number,
              daysOverdue: topOverdue.daysOverdue,
              total: topOverdue.total,
            },
      dunningWaiting: dunning.body.actions.filter(
        (action) => action.sendable && withinFiscalYear(scope, action.dueDate),
      ).length,
      bankUnmatched: transactions.body.transactions.filter((transaction) =>
        withinFiscalYear(scope, transaction.bookingDate),
      ).length,
      inboxWaiting: inbox.body.items.filter((item) => withinFiscalYear(scope, item.receivedAt))
        .length,
      purchaseToBook: purchasesInYear.filter((invoice) => invoice.status === 'draft').length,
      purchaseToApprove: purchasesInYear.filter((invoice) => invoice.status === 'booked').length,
      vatFilingCount: vatReady === null ? 0 : 1,
      vatPeriod: vatReady?.label ?? null,
      vatDeadline: vatReady?.deadline ?? null,
      vatPayable: vatReady?.payable ?? null,
    },
    (permission) => hasPermission(context, permission),
  )

  const primaryBank =
    bankAccounts.body.accounts.find(
      (account) => account.reconciliation.statementBalance !== null,
    ) ??
    bankAccounts.body.accounts[0] ??
    null

  const figures: DashboardFigures = {
    bank:
      primaryBank === null
        ? null
        : {
            // No statement yet → no balance. Do not invent € 0,00 (PM #67).
            balance: primaryBank.reconciliation.statementBalance,
            name: primaryBank.name,
            iban: primaryBank.iban,
            statementDate: primaryBank.reconciliation.statementDate,
          },
    receivables: {
      total: overdueInYear.reduce((sum, invoice) => sum + BigInt(invoice.total), 0n).toString(),
      count: overdueInYear.length,
      overdueCount: overdueInYear.length,
    },
    payables: {
      total: payables?.body.total ?? '0',
      count: payables?.body.buckets.length ?? 0,
    },
    profit: {
      // A failed P&L read is not € 0,00 — leave the figure absent (PM #67).
      result: profit?.body.result ?? null,
      priorResult: priorProfit?.body.result ?? null,
    },
  }

  const yearRow = fiscalYears.body.fiscalYears.find((year) => year.code === scope.code)
  // Six periods ending at today — not the last six of the boekjaar (those can
  // include months that have not started yet).
  const chartPeriods = chartPeriodsThroughToday(yearRow?.periods ?? [], today)

  const monthResults = await Promise.all(
    chartPeriods.map(async (period) => {
      try {
        const statement = await handleGetProfitAndLoss(context, {
          fiscalYear: scope.code,
          fromPeriod: period.sequence,
          toPeriod: period.sequence,
          currency: 'EUR',
        })
        return {
          month: Number(period.startsOn.slice(5, 7)),
          sequence: period.sequence,
          income: statement.body.revenue.total,
          expenses: statement.body.expenses.total,
          partial: period.startsOn <= today && today <= period.endsOn,
        } satisfies MonthBar
      } catch {
        return {
          month: Number(period.startsOn.slice(5, 7)),
          sequence: period.sequence,
          income: '0',
          expenses: '0',
          partial: period.startsOn <= today && today <= period.endsOn,
        } satisfies MonthBar
      }
    }),
  )

  return {
    fiscalYear: scope,
    items,
    figures,
    months: monthResults,
    periods: buildPeriodRows({
      years: fiscalYears.body.fiscalYears,
      activeCode: scope.code,
      today,
    }),
  }
}

export const getDashboard = createServerFn({ method: 'GET' })
  .validator((input: { fiscalYear?: string } | undefined) => input ?? {})
  .handler(async ({ data }) =>
    run(async () => {
      const context = await contextFromRequest()
      return loadDashboard(context, data.fiscalYear ?? null)
    }),
  )

/** Queue-only view of `getDashboard`, for callers that do not need figures. */
export const getWorkQueue = createServerFn({ method: 'GET' })
  .validator((input: { fiscalYear?: string } | undefined) => input ?? {})
  .handler(async ({ data }) =>
    run(async () => {
      const context = await contextFromRequest()
      const dashboard = await loadDashboard(context, data.fiscalYear ?? null)
      return { fiscalYear: dashboard.fiscalYear, items: dashboard.items }
    }),
  )
