import { createFileRoute, Link } from '@tanstack/react-router'
import {
  RiAddLine,
  RiAlertLine,
  RiArrowRightLine,
  RiCalendarLine,
  RiInformationLine,
  RiLockLine,
  RiUploadLine,
} from '@remixicon/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from '~/components/ui/empty'
import { Keycap, ShortcutFooter } from '~/components/ui/keycap'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { formatDate, formatMinorUnits } from '~/lib/format'
import {
  ATTENTION_TONE,
  barHeightPercent,
  dayPartAt,
  greetingName,
  ibanTail,
  maxMonthAmount,
  type AttentionTone,
  type MonthBar,
} from '~/lib/dashboard'
import { fiscalYearSearch } from '~/lib/fiscal-year'
import { useAdvancedMode } from '~/lib/advanced-mode-context'
import { useHydrated } from '~/lib/hydration'
import { resolveListKey } from '~/lib/list-cursor'
import { cn } from '~/lib/utils'
import type { WorkQueueItem, WorkQueueKind } from '~/lib/work-queue'
import { getDashboard, type DashboardFigures } from '~/server/dashboard'
import { getEntity } from '~/server/entity'
import { getSession } from '~/server/context'
import { getRgsCoverage, getTrialBalance } from '~/server/ledger'

/**
 * The dashboard: greeting, kerncijfers, werklijst, chart and periods.
 *
 * Ports the #57 prototype screen (#61 slice 3). The queue still answers
 * "what do I do today?"; the figures and periods sit around it the way the
 * approved HTML does. Health (proefbalans / RGS) stays below — Proefbalans
 * only when Geavanceerd is on (#65).
 *
 * Import findings UI itself is owned by slice 4; this screen only links to
 * Moneybird when a stored dry-run already reported blocking problems.
 */
export const Route = createFileRoute('/_app/')({
  validateSearch: fiscalYearSearch,
  loaderDeps: ({ search }) => ({ fiscalYear: search.fiscalYear }),
  loader: async ({ deps }) => {
    const year = deps.fiscalYear === undefined ? {} : { fiscalYear: String(deps.fiscalYear) }
    const [dashboard, coverage, trial, entity, session] = await Promise.all([
      getDashboard({ data: year }),
      getRgsCoverage({ data: {} }),
      getTrialBalance({ data: year }),
      getEntity(),
      getSession(),
    ])
    return { dashboard, coverage, trial, entity, session }
  },
  pendingComponent: DashboardPending,
  component: Dashboard,
})

/** Where each kind of waiting work is done, and what to call it. */
const DESTINATIONS: Record<
  WorkQueueKind,
  {
    readonly to: string
    readonly search?: Record<string, string>
    readonly title: MessageKey
    readonly body: MessageKey
    readonly action: MessageKey
  }
> = {
  'import.blocking': {
    to: '/moneybird',
    title: 'queue.importBlocking',
    body: 'queue.importBlockingBody',
    action: 'queue.importBlockingAction',
  },
  'sales.draft': {
    to: '/invoices',
    search: { status: 'draft' },
    title: 'queue.salesDraft',
    body: 'queue.salesDraftBody',
    action: 'queue.salesDraftAction',
  },
  'sales.overdue': {
    to: '/reports/debtor-ageing',
    title: 'queue.salesOverdue',
    body: 'queue.salesOverdueBody',
    action: 'queue.salesOverdueAction',
  },
  'dunning.waiting': {
    to: '/dunning',
    title: 'queue.dunningWaiting',
    body: 'queue.dunningWaitingBody',
    action: 'queue.dunningWaitingAction',
  },
  'bank.unmatched': {
    to: '/bank/match',
    title: 'queue.bankUnmatched',
    body: 'queue.bankUnmatchedBody',
    action: 'queue.bankUnmatchedAction',
  },
  'inbox.waiting': {
    to: '/inbox',
    title: 'queue.inboxWaiting',
    body: 'queue.inboxWaitingBody',
    action: 'queue.inboxWaitingAction',
  },
  'purchase.book': {
    to: '/purchases',
    search: { status: 'draft' },
    title: 'queue.purchaseBook',
    body: 'queue.purchaseBookBody',
    action: 'queue.purchaseBookAction',
  },
  'purchase.approve': {
    to: '/purchases',
    search: { status: 'booked' },
    title: 'queue.purchaseApprove',
    body: 'queue.purchaseApproveBody',
    action: 'queue.purchaseApproveAction',
  },
  'vat.filing': {
    to: '/vat',
    title: 'queue.vatFiling',
    body: 'queue.vatFilingBody',
    action: 'queue.vatFilingAction',
  },
}

function DashboardPending() {
  const { t } = useT()
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <p className="sr-only">{t('dash.loading')}</p>
      <div className="bg-muted h-10 w-64 animate-pulse" />
      <div className="bg-border grid grid-cols-2 gap-px lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="bg-background h-24 animate-pulse p-4" />
        ))}
      </div>
      <div className="bg-muted h-48 animate-pulse" />
    </div>
  )
}

function Dashboard() {
  const { dashboard, coverage, trial, entity, session } = Route.useLoaderData()
  const { t } = useT()
  const { advanced } = useAdvancedMode()
  const hydrated = useHydrated()

  if (session === null) return null

  const isDemo = entity.ok && entity.data.isDemo === true
  const entityName = entity.ok ? entity.data.name : ''
  const name = greetingName(session.user.name, session.user.email)
  const now = new Date()
  const part = dayPartAt(now.getHours())
  const greetingKey =
    part === 'morning'
      ? 'dash.greeting.morning'
      : part === 'afternoon'
        ? 'dash.greeting.afternoon'
        : 'dash.greeting.evening'
  const weekdayKey = `dash.weekday.${String(now.getDay())}` as MessageKey
  const dateLabel = formatDate(
    `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  )

  const year = dashboard.ok ? dashboard.data.fiscalYear : null

  return (
    <>
      <PageHeader
        title={t(greetingKey, { name })}
        description={
          year === null
            ? t('dash.introNoYear')
            : t('dash.greetingSub', {
                weekday: t(weekdayKey),
                date: dateLabel,
                entity: isDemo ? `${entityName} · ${t('shell.demoBadge')}` : entityName,
              })
        }
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <Button asChild className="min-h-11 md:min-h-9">
              <Link to="/invoices/new">
                <RiAddLine data-icon="inline-start" aria-hidden="true" />
                {t('dash.newInvoice')}
                {hydrated && (
                  <span className="ml-1 inline-flex gap-0.5">
                    <Keycap className="border-primary-foreground/30 bg-transparent text-primary-foreground/80">
                      n
                    </Keycap>
                    <Keycap className="border-primary-foreground/30 bg-transparent text-primary-foreground/80">
                      f
                    </Keycap>
                  </span>
                )}
              </Link>
            </Button>
            <Button asChild variant="outline" className="min-h-11 md:min-h-9">
              <Link to="/inbox">
                <RiUploadLine data-icon="inline-start" aria-hidden="true" />
                {t('dash.addReceipt')}
              </Link>
            </Button>
          </div>
        }
      />

      {!dashboard.ok ? (
        <p role="alert" className="text-destructive text-sm">
          {dashboard.problem.detail}
        </p>
      ) : (
        <>
          <KeyFigures figures={dashboard.data.figures} yearCode={dashboard.data.fiscalYear.code} />

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <WorkQueue items={dashboard.data.items} />
            <aside className="space-y-6">
              <IncomeChart months={dashboard.data.months} />
              <PeriodsPanel
                rows={dashboard.data.periods}
                yearCode={dashboard.data.fiscalYear.code}
              />
            </aside>
          </div>
        </>
      )}

      <section className="mt-8">
        <h2 className="mb-3 font-medium">{t('dash.healthTitle')}</h2>
        <div className={cn('grid gap-4', advanced ? 'sm:grid-cols-2' : 'sm:grid-cols-1')}>
          {advanced && (
            <Stat
              label={t('dash.trialBalance')}
              value={trial.ok ? <Money amount={trial.data.difference} /> : '—'}
              hint={
                trial.ok && trial.data.difference === '0'
                  ? t('dash.trialBalanceEqual')
                  : t('dash.trialBalanceDifference')
              }
              tone={trial.ok && trial.data.difference === '0' ? 'good' : 'warn'}
            />
          )}
          <Stat
            label={t('dash.rgsCoverage')}
            value={coverage.ok ? `${String(coverage.data.mappedPercentage)}%` : '—'}
            hint={
              coverage.ok
                ? t('dash.rgsCoverageHint', {
                    mapped: String(coverage.data.mappedCount),
                    total: String(coverage.data.accountCount),
                    version: coverage.data.version,
                  })
                : undefined
            }
            tone={coverage.ok && coverage.data.unmappedCount === 0 ? 'good' : 'warn'}
          />
        </div>
      </section>

      {coverage.ok && coverage.data.unmappedCount > 0 && (
        <section className="border-border mt-4 border p-4">
          <h2 className="font-medium">{t('dash.unmapped')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('dash.unmappedBody')}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {coverage.data.unmappedAccounts.map((accountNumber) => (
              <li key={accountNumber} className="bg-unreconciled/15 px-2 py-1 tabular text-xs">
                {accountNumber}
              </li>
            ))}
          </ul>
          <Link to="/accounts" className="mt-3 inline-block text-sm underline">
            {t('dash.unmappedFix')}
          </Link>
        </section>
      )}

      <section className="mt-4">
        <h2 className="font-medium">{t('dash.exportTitle')}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('dash.exportBody')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/api/v1/exports/audit-file?fiscalYear=${year?.code ?? ''}`}
            className="border-input inline-flex min-h-11 items-center border px-3 py-2 text-sm font-medium md:min-h-9"
          >
            {t('dash.exportAction')}
          </a>
          <Link
            to="/audit-file"
            className="border-input inline-flex min-h-11 items-center border px-3 py-2 text-sm font-medium md:min-h-9"
          >
            {t('dash.importAction')}
          </Link>
        </div>
      </section>
    </>
  )
}

function KeyFigures({ figures, yearCode }: { figures: DashboardFigures; yearCode: string }) {
  const { t } = useT()
  const bank = figures.bank
  const receivablesLate = figures.receivables.overdueCount > 0
  const profit = BigInt(figures.profit.result)
  const prior = figures.profit.priorResult === null ? null : BigInt(figures.profit.priorResult)
  const delta = prior === null ? null : profit - prior

  return (
    <section
      aria-label={t('dash.figures')}
      className="bg-border grid grid-cols-2 gap-px border lg:grid-cols-4"
    >
      <FigureTile
        label={t('dash.figure.bank')}
        value={bank === null ? '—' : <EuroAmount amount={bank.balance} />}
        hint={
          bank === null
            ? t('dash.figure.bankEmpty')
            : bank.statementDate === null
              ? t('dash.figure.bankHintNoDate', {
                  name: bank.name,
                  iban: ibanTail(bank.iban),
                })
              : t('dash.figure.bankHint', {
                  name: bank.name,
                  iban: ibanTail(bank.iban),
                  date: formatDate(bank.statementDate),
                })
        }
      />
      <FigureTile
        label={t('dash.figure.receivables')}
        value={<EuroAmount amount={figures.receivables.total} />}
        hint={
          figures.receivables.count === 0
            ? t('dash.figure.receivablesEmpty')
            : t('dash.figure.receivablesHint', {
                count: String(figures.receivables.overdueCount),
              })
        }
        hintTone={receivablesLate ? 'attention' : 'muted'}
      />
      <FigureTile
        label={t('dash.figure.payables')}
        value={<EuroAmount amount={figures.payables.total} />}
        hint={
          figures.payables.count === 0
            ? t('dash.figure.payablesEmpty')
            : t('dash.figure.payablesHint', { count: String(figures.payables.count) })
        }
      />
      <FigureTile
        label={profit < 0n ? t('dash.figure.loss') : t('dash.figure.profit')}
        value={<EuroAmount amount={figures.profit.result} />}
        hint={
          delta === null
            ? t('dash.figure.profitNoPrior', { year: yearCode })
            : delta === 0n
              ? t('dash.figure.profitFlat')
              : delta > 0n
                ? t('dash.figure.profitUp', { amount: formatMinorUnits(delta) })
                : t('dash.figure.profitDown', { amount: formatMinorUnits(-delta) })
        }
      />
    </section>
  )
}

function EuroAmount({ amount }: { amount: string }) {
  return (
    <>
      <span className="mr-1 font-semibold">€</span>
      <Money amount={amount} />
    </>
  )
}

function FigureTile({
  label,
  value,
  hint,
  hintTone = 'muted',
}: {
  label: string
  value: ReactNode
  hint: string
  hintTone?: 'muted' | 'attention'
}) {
  return (
    <div className="bg-background p-4 md:p-5">
      <p className="text-muted-foreground text-xs md:text-sm">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight tabular md:text-[26px]">{value}</p>
      <p
        className={cn(
          'mt-1 text-xs',
          hintTone === 'attention' ? 'text-warning' : 'text-muted-foreground',
        )}
      >
        {hint}
      </p>
    </div>
  )
}

function IncomeChart({ months }: { months: readonly MonthBar[] }) {
  const { t } = useT()
  const max = maxMonthAmount(months)
  const partial = months.find((month) => month.partial)

  return (
    <section aria-labelledby="dash-chart-h" className="border p-4">
      <div className="flex items-baseline justify-between">
        <h2 id="dash-chart-h" className="text-base">
          {t('dash.chartTitle')}
        </h2>
        <span className="text-muted-foreground text-xs">{t('dash.chartScale')}</span>
      </div>
      {months.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">{t('dash.chartEmpty')}</p>
      ) : (
        <>
          <div
            className="mt-4 flex h-32 items-end gap-3"
            role="img"
            aria-label={t('dash.chartLabel')}
          >
            {months.map((month) => {
              const key = `dash.month.${String(month.month)}` as MessageKey
              return (
                <div key={month.sequence} className="flex h-full flex-1 flex-col justify-end gap-1">
                  <div className="flex flex-1 items-end gap-0.5">
                    <div
                      className={cn('bg-chart-2 flex-1', month.partial && 'opacity-40')}
                      style={{ height: `${String(barHeightPercent(month.income, max))}%` }}
                    />
                    <div
                      className={cn('bg-chart-4 flex-1', month.partial && 'opacity-40')}
                      style={{ height: `${String(barHeightPercent(month.expenses, max))}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      'text-muted-foreground text-center text-[11px]',
                      month.partial && 'border-accent text-foreground border-b-2 font-medium',
                    )}
                  >
                    {t(key)}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="text-muted-foreground mt-3 flex gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="bg-chart-2 size-2.5" />
              {t('dash.chartIncome')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="bg-chart-4 size-2.5" />
              {t('dash.chartExpenses')}
            </span>
            {partial !== undefined && (
              <span className="ml-auto">
                {t('dash.chartPartial', {
                  month: t(`dash.month.${String(partial.month)}` as MessageKey),
                })}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function PeriodsPanel({
  rows,
  yearCode,
}: {
  rows: ReturnType<typeof import('~/lib/dashboard').buildPeriodRows>
  yearCode: string
}) {
  const { t } = useT()
  if (rows.length === 0) return null

  return (
    <section aria-labelledby="dash-per-h" className="border p-4">
      <h2 id="dash-per-h" className="text-base">
        {t('dash.periodsTitle')}
      </h2>
      <ul role="list" className="mt-2 divide-y text-sm">
        {rows.map((row) => {
          const label =
            row.kind === 'month'
              ? t('dash.period.month', {
                  month: t(`dash.month.${row.labelRef}` as MessageKey),
                  year: yearCode,
                })
              : row.kind === 'quarter'
                ? t('dash.period.quarter', { n: row.labelRef, year: yearCode })
                : row.labelRef

          const closedCopy =
            row.kind === 'quarter'
              ? t('dash.period.closedQuarter')
              : row.kind === 'year'
                ? t('dash.period.closedYear')
                : t('dash.period.closedMonth')

          return (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2">
              <span>{label}</span>
              {row.status === 'open' ? (
                <Badge variant="outline">{t('dash.period.open')}</Badge>
              ) : (
                <span className="text-muted-foreground inline-flex items-center gap-1">
                  <RiLockLine aria-hidden="true" className="size-3.5" />
                  {closedCopy}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function toneIcon(tone: AttentionTone): ReactNode {
  if (tone === 'error') {
    return <RiAlertLine aria-hidden="true" className="text-destructive size-[18px]" />
  }
  if (tone === 'attention') {
    return <RiCalendarLine aria-hidden="true" className="text-warning size-[18px]" />
  }
  if (tone === 'info') {
    return <RiInformationLine aria-hidden="true" className="text-info size-[18px]" />
  }
  return (
    <span
      aria-hidden="true"
      className="border-muted-foreground mt-0.5 size-[18px] rounded-full border"
    />
  )
}

function rowCopy(
  item: WorkQueueItem,
  t: (key: MessageKey, vars?: Record<string, string>) => string,
): { title: string; body: string; action: string } {
  const destination = DESTINATIONS[item.kind]
  const detail = item.detail

  if (item.kind === 'import.blocking') {
    return {
      title: t(destination.title, { count: String(item.count) }),
      body: t(destination.body),
      action: t(destination.action),
    }
  }

  if (item.kind === 'bank.unmatched' || item.kind === 'inbox.waiting') {
    return {
      title: t(destination.title, { count: String(item.count) }),
      body: t(destination.body),
      action: t(destination.action),
    }
  }

  if (
    item.kind === 'sales.overdue' &&
    item.count === 1 &&
    detail?.contactName !== undefined &&
    item.amount !== null
  ) {
    return {
      title: t('queue.salesOverdueOne', {
        name: detail.contactName,
        amount: formatMinorUnits(BigInt(item.amount)),
      }),
      body: t('queue.salesOverdueOneBody', {
        number: detail.invoiceNumber ?? '—',
        days: String(detail.daysOverdue ?? 0),
      }),
      action: t(destination.action),
    }
  }

  if (item.kind === 'vat.filing' && detail?.vatPeriod !== undefined) {
    const deadline = detail.vatDeadline === undefined ? '—' : formatDate(detail.vatDeadline)
    return {
      title: t(destination.title, { period: detail.vatPeriod }),
      body:
        detail.vatPayable !== undefined && detail.vatPayable !== null
          ? t('queue.vatFilingBodyPayable', {
              deadline,
              amount: formatMinorUnits(BigInt(detail.vatPayable)),
            })
          : t('queue.vatFilingBody', { deadline }),
      action: t(destination.action),
    }
  }

  return {
    title: t(destination.title),
    body: t(destination.body),
    action: t(destination.action),
  }
}

/**
 * The queue itself, and the keyboard that works it.
 *
 * Focus lands on the first row when the screen is ready. `j`/`k` move,
 * `Enter` opens (native link), `Escape` leaves the list.
 */
function WorkQueue({ items }: { items: readonly WorkQueueItem[] }) {
  const { t, plural } = useT()
  const hydrated = useHydrated()
  const [cursor, setCursor] = useState(0)
  const rows = useRef<(HTMLAnchorElement | null)[]>([])

  useEffect(() => {
    if (!hydrated) return
    rows.current[0]?.focus()
  }, [hydrated])

  if (items.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle role="heading" aria-level={2}>
            {t('queue.empty')}
          </EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link to="/invoices/new">{t('queue.emptyAction')}</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const focusRow = (index: number): void => {
    setCursor(index)
    rows.current[index]?.focus()
  }

  return (
    <section aria-labelledby="queue-title">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 id="queue-title" className="text-base">
          {t('queue.title')}
        </h2>
        <span className="text-muted-foreground text-sm tabular">
          {plural('queue.count', items.length)}
        </span>
      </div>

      <ul
        role="list"
        className="divide-y border"
        onKeyDown={(event) => {
          const resolution = resolveListKey(
            event.key,
            { index: cursor, count: items.length },
            event.metaKey || event.ctrlKey || event.altKey,
          )

          if (resolution.action === 'move') {
            event.preventDefault()
            focusRow(resolution.index)
          }
          if (resolution.action === 'leave') {
            event.preventDefault()
            rows.current[cursor]?.blur()
          }
        }}
      >
        {items.map((item, index) => {
          const destination = DESTINATIONS[item.kind]
          const tone = ATTENTION_TONE[item.kind]
          const copy = rowCopy(item, t)
          return (
            <li key={item.kind}>
              <Link
                to={destination.to}
                {...(destination.search === undefined ? {} : { search: destination.search })}
                ref={(element: HTMLAnchorElement | null) => {
                  rows.current[index] = element
                }}
                tabIndex={index === cursor ? 0 : -1}
                onFocus={() => {
                  setCursor(index)
                }}
                className={cn(
                  'group focus-visible:outline-solid hover:bg-muted flex min-h-11 items-center gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:min-h-16',
                  tone === 'error'
                    ? 'border-l-destructive border-l-[3px]'
                    : 'border-l-[3px] border-l-transparent',
                )}
              >
                <span className="shrink-0">{toneIcon(tone)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{copy.title}</span>
                  <span className="text-muted-foreground block text-sm">{copy.body}</span>
                </span>
                {item.amount !== null && item.kind !== 'sales.overdue' && (
                  <Money amount={item.amount} className="text-sm" />
                )}
                <span className="text-muted-foreground group-hover:text-foreground hidden text-sm sm:inline">
                  {copy.action}
                </span>
                <RiArrowRightLine aria-hidden="true" className="text-muted-foreground size-4" />
              </Link>
            </li>
          )
        })}
      </ul>

      <ShortcutFooter ids={['queue.next', 'queue.previous', 'queue.open', 'queue.leave']} />
    </section>
  )
}
