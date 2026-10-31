import { createFileRoute, Link } from '@tanstack/react-router'
import {
  RiAddLine,
  RiAlertLine,
  RiArrowLeftRightLine,
  RiArrowRightSLine,
  RiCalendarLine,
  RiCheckLine,
  RiFileTextLine,
  RiInbox2Line,
  RiPercentLine,
  RiUploadLine,
} from '@remixicon/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PageHeader } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '~/components/ui/empty'
import { Keycap } from '~/components/ui/keycap'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { formatMinorUnits } from '~/lib/format'
import {
  ATTENTION_TONE,
  bankFigureValueKind,
  calendarParts,
  capitalizeWord,
  glanceBarPercent,
  greetingName,
  homeQueueOverdueManyBody,
  homeQueueOverdueOneBody,
  homeQueueVatBody,
  homeQueueVatDeadlineIso,
  payablesFigureValueKind,
  profitFigureValueKind,
  type AttentionTone,
  type FigureValueKind,
} from '~/lib/dashboard'
import { DEBTOR_AGEING_BUCKETS, type DebtorAgeingBucket } from '~/lib/ageing'
import { fiscalYearSearch } from '~/lib/fiscal-year'
import { useHydrated } from '~/lib/hydration'
import { isTypingInto } from '~/lib/keyboard'
import { localDayPart, localTodayIso } from '~/lib/local-clock'
import { resolveListKey } from '~/lib/list-cursor'
import { cn } from '~/lib/utils'
import type { WorkQueueItem, WorkQueueKind } from '~/lib/work-queue'
import { getDashboard, type DashboardAgeing, type DashboardFigures } from '~/server/dashboard'
import { getEntity } from '~/server/entity'
import { getSession } from '~/server/context'

/**
 * Home — Main / PhoneHome / HomeDark (redesign Phase 1 / #107).
 *
 * To-do list ordered by consequence; only the top action is primary. Four
 * linked stat tiles (honest labels; no invented aggregates per #68). P&L
 * glance, debtor-ageing glance (same buckets/query as the report), audit-file
 * card. Phone shows two tiles + compact to-dos; side cards are desktop-only.
 * No "Haal je boekhouding over" row (decision 2).
 */
export const Route = createFileRoute('/_app/')({
  validateSearch: fiscalYearSearch,
  loaderDeps: ({ search }) => ({ fiscalYear: search.fiscalYear }),
  loader: async ({ deps }) => {
    const year = deps.fiscalYear === undefined ? {} : { fiscalYear: String(deps.fiscalYear) }
    const [dashboard, entity, session] = await Promise.all([
      getDashboard({ data: year }),
      getEntity(),
      getSession(),
    ])
    return { dashboard, entity, session }
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
    /** Plural base (`queue.salesDraft`) or a plain MessageKey (`queue.vatFiling`). */
    readonly title: string
    readonly titlePlural: boolean
    readonly body: MessageKey
    readonly action: MessageKey
  }
> = {
  // Blocking Moneybird findings. v2 Main does not invent an empty-state
  // “import your books” to-do — Import lives in the footer / Settings hub.
  'import.blocking': {
    to: '/importeren',
    search: { bron: 'moneybird' },
    title: 'queue.importBlocking',
    titlePlural: true,
    body: 'queue.importBlockingBody',
    action: 'queue.importBlockingAction',
  },
  'sales.overdue': {
    to: '/reports/debtor-ageing',
    title: 'queue.salesOverdue',
    titlePlural: true,
    body: 'queue.salesOverdueBody',
    action: 'queue.salesOverdueAction',
  },
  'dunning.waiting': {
    to: '/dunning',
    title: 'queue.dunningWaiting',
    titlePlural: true,
    body: 'queue.dunningWaitingBody',
    action: 'queue.dunningWaitingAction',
  },
  'bank.unmatched': {
    to: '/bank/match',
    title: 'queue.bankUnmatched',
    titlePlural: true,
    body: 'queue.bankUnmatchedBody',
    action: 'queue.bankUnmatchedAction',
  },
  'purchase.approve': {
    to: '/purchases',
    search: { status: 'booked' },
    title: 'queue.purchaseApprove',
    titlePlural: true,
    body: 'queue.purchaseApproveBody',
    action: 'queue.purchaseApproveAction',
  },
  'purchase.book': {
    to: '/purchases',
    search: { status: 'draft' },
    title: 'queue.purchaseBook',
    titlePlural: true,
    body: 'queue.purchaseBookBody',
    action: 'queue.purchaseBookAction',
  },
  'vat.filing': {
    to: '/vat',
    title: 'queue.vatFiling',
    titlePlural: false,
    body: 'queue.vatFilingBody',
    action: 'queue.vatFilingAction',
  },
  'sales.draft': {
    to: '/invoices',
    search: { status: 'draft' },
    title: 'queue.salesDraft',
    titlePlural: true,
    body: 'queue.salesDraftBody',
    action: 'queue.salesDraftAction',
  },
  'inbox.waiting': {
    to: '/inbox',
    title: 'queue.inboxWaiting',
    titlePlural: true,
    body: 'queue.inboxWaitingBody',
    action: 'queue.inboxWaitingAction',
  },
}

const AGE_BUCKET_LABEL: Record<DebtorAgeingBucket, MessageKey> = {
  upTo30: 'ageing.bucket.upTo30',
  upTo60: 'ageing.bucket.upTo60',
  upTo90: 'ageing.bucket.upTo90',
  over90: 'ageing.bucket.over90',
}

/** Export ageing fills — named tokens in tokens.css (warm warning → danger). */
const AGE_BUCKET_COLOR: Record<DebtorAgeingBucket, string> = {
  upTo30: 'bg-ageing-up-to-30',
  upTo60: 'bg-ageing-up-to-60',
  upTo90: 'bg-ageing-up-to-90',
  over90: 'bg-ageing-over-90',
}

function DashboardPending() {
  const { t } = useT()
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <p className="sr-only">{t('dash.loading')}</p>
      <div className="bg-muted h-10 w-64 animate-pulse rounded-[var(--radius-md)]" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="bg-muted h-24 animate-pulse rounded-[var(--radius-xl)]" />
        ))}
      </div>
      <div className="bg-muted h-48 animate-pulse rounded-[var(--radius-xl)]" />
    </div>
  )
}

function Dashboard() {
  const { dashboard, entity, session } = Route.useLoaderData()
  const { t, plural } = useT()
  const hydrated = useHydrated()

  if (session === null) return null

  const isDemo = entity.ok && entity.data.isDemo === true
  const entityName = entity.ok ? entity.data.name : ''
  const name = greetingName(session.user.name)
  const part = localDayPart()
  const greetingKey =
    name === null
      ? part === 'morning'
        ? 'dash.greeting.morningBare'
        : part === 'afternoon'
          ? 'dash.greeting.afternoonBare'
          : 'dash.greeting.eveningBare'
      : part === 'morning'
        ? 'dash.greeting.morning'
        : part === 'afternoon'
          ? 'dash.greeting.afternoon'
          : 'dash.greeting.evening'
  const parts = calendarParts(localTodayIso())
  const weekday = capitalizeWord(t(`dash.weekday.${String(parts.weekday)}` as MessageKey))
  const dateLabel = t('dash.dateDayMonth', {
    day: String(parts.day),
    month: t(`dash.monthFull.${String(parts.month)}` as MessageKey),
  })

  const year = dashboard.ok ? dashboard.data.fiscalYear : null
  const todoCount = dashboard.ok ? dashboard.data.items.length : 0
  const greetingSub =
    year === null
      ? t('dash.introNoYear')
      : todoCount > 0
        ? plural('dash.greetingSubCount', todoCount, { weekday, date: dateLabel })
        : t('dash.greetingSubBare', { weekday, date: dateLabel })

  return (
    <>
      <PageHeader
        title={name === null ? t(greetingKey) : t(greetingKey, { name })}
        description={
          isDemo && entityName !== ''
            ? `${greetingSub} · ${entityName} · ${t('shell.demoBadge')}`
            : greetingSub
        }
        actions={
          // Phone: CTAs leave the header; one secondary Bonnetje sits under Te doen.
          // Bonnetje shows no shortcut chip (PM + Design #112): keymap stays as-is.
          // Empty queue: keep "Nieuwe factuur" only in the empty card (Design #112).
          <div className="hidden w-full flex-col gap-2 md:flex md:w-auto md:flex-row md:justify-end">
            <Button asChild variant="outline" className="min-h-9">
              <Link to="/inbox">
                <RiUploadLine data-icon="inline-start" aria-hidden="true" />
                {t('dash.addReceipt')}
              </Link>
            </Button>
            {/* Home only: New invoice is secondary; the top to-do owns primary (PM #107). */}
            {todoCount > 0 && (
              <Button asChild variant="outline" className="min-h-9">
                <Link to="/invoices/new">
                  <RiAddLine data-icon="inline-start" aria-hidden="true" />
                  {t('dash.newInvoice')}
                  {hydrated && (
                    <span className="ml-1 inline-flex gap-0.5 normal-case">
                      <Keycap>n</Keycap>
                      <Keycap>f</Keycap>
                    </span>
                  )}
                </Link>
              </Button>
            )}
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

          <div className="mt-6 flex flex-wrap items-start gap-6">
            <div className="min-w-0 flex-[2_1_520px]">
              <WorkQueue items={dashboard.data.items} fiscalYear={dashboard.data.fiscalYear.code} />
              <div className="mt-3 md:hidden">
                <Button asChild variant="outline" className="min-h-11 w-full">
                  <Link to="/inbox">
                    <RiUploadLine data-icon="inline-start" aria-hidden="true" />
                    {t('dash.addReceipt')}
                  </Link>
                </Button>
              </div>
            </div>
            <aside className="hidden min-w-0 flex-[1_1_300px] flex-col gap-6 md:flex">
              <ProfitGlance
                yearCode={dashboard.data.fiscalYear.code}
                income={dashboard.data.figures.profit.income}
                expenses={dashboard.data.figures.profit.expenses}
                result={dashboard.data.figures.profit.result}
              />
              <AgeingGlance
                ageing={dashboard.data.ageing}
                yearCode={dashboard.data.fiscalYear.code}
              />
              <AuditCard />
            </aside>
          </div>
        </>
      )}
    </>
  )
}

function KeyFigures({ figures, yearCode }: { figures: DashboardFigures; yearCode: string }) {
  const { t, plural } = useT()
  const bank = figures.bank
  const receivablesLate = figures.receivables.overdueCount > 0
  const profitResult = figures.profit.result
  const profit = profitResult === null ? null : BigInt(profitResult)
  const prior = figures.profit.priorResult === null ? null : BigInt(figures.profit.priorResult)
  const delta = profit === null || prior === null ? null : profit - prior
  const yearSearch = { fiscalYear: Number(yearCode) }

  const bankValueKind = bankFigureValueKind(bank)
  const bankMeta = ((): string => {
    if (bank === null) return t('dash.figure.bankEmpty')
    if (bank.status === 'unavailable') return t('dash.figure.bankUnavailable')
    if (bank.balance === null) return t('dash.figure.bankNoStatement')
    const date = bank.statementDate === null ? null : dayMonthLabel(bank.statementDate, t)
    if (date !== null && bank.unmatchedCount > 0) {
      return plural('dash.figure.bankHintMatch', bank.unmatchedCount, { date })
    }
    if (date !== null) return t('dash.figure.bankHint', { date })
    if (bank.unmatchedCount > 0) {
      return plural('dash.figure.bankHintMatchOnly', bank.unmatchedCount)
    }
    return t('dash.figure.bankHintNoDate', { name: bank.name, iban: bank.iban.slice(-4) })
  })()

  const payablesValueKind = payablesFigureValueKind(figures.payables.total)
  const payablesMeta =
    figures.payables.total === null
      ? t('dash.figure.payablesUnavailable')
      : figures.payables.count === 0
        ? t('dash.figure.payablesEmpty')
        : plural('dash.figure.payablesHint', figures.payables.count)

  const profitValueKind = profitFigureValueKind(profitResult)
  // Failed P&L: Unavailable only — never "Boekjaar {year}" on a failed read (PM #112).
  const profitMeta =
    profitResult === null
      ? t('dash.figure.profitUnavailable')
      : delta === null
        ? t('dash.figure.profitNoPrior', { year: yearCode })
        : delta === 0n
          ? t('dash.figure.profitFlat')
          : delta > 0n
            ? t('dash.figure.profitUp', { amount: formatMinorUnits(delta) })
            : t('dash.figure.profitDown', { amount: formatMinorUnits(-delta) })

  return (
    <section
      aria-label={t('dash.figures')}
      className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4"
    >
      <StatTile
        to="/bank/match"
        label={t('dash.figure.bank')}
        valueKind={bankValueKind}
        value={
          bank !== null && bank.status === 'ok' && bank.balance !== null ? (
            <EuroAmount amount={bank.balance} />
          ) : null
        }
        meta={bankMeta}
      />
      <StatTile
        to="/reports/debtor-ageing"
        search={yearSearch}
        label={t('dash.figure.receivables')}
        valueKind="amount"
        value={<EuroAmount amount={figures.receivables.total} />}
        meta={
          figures.receivables.count === 0
            ? t('dash.figure.receivablesEmpty')
            : plural('dash.figure.receivablesHint', figures.receivables.overdueCount)
        }
        metaDanger={receivablesLate}
      />
      {/* PhoneHome shows only bank + receivables; suppliers/profit are desktop. */}
      <StatTile
        className="hidden md:flex"
        to="/purchases"
        label={t('dash.figure.payables')}
        valueKind={payablesValueKind}
        value={
          figures.payables.total === null ? null : <EuroAmount amount={figures.payables.total} />
        }
        meta={payablesMeta}
      />
      <StatTile
        className="hidden md:flex"
        to="/reports/profit-and-loss"
        search={yearSearch}
        label={
          profit !== null && profit < 0n
            ? t('dash.figure.loss', { year: yearCode })
            : t('dash.figure.profit', { year: yearCode })
        }
        valueKind={profitValueKind}
        value={profitResult === null ? null : <EuroAmount amount={profitResult} />}
        meta={profitMeta}
      />
    </section>
  )
}

function StatTile({
  to,
  search,
  label,
  valueKind,
  value,
  meta,
  metaDanger = false,
  className,
}: {
  to: string
  search?: Record<string, string | number>
  label: string
  valueKind: FigureValueKind
  value: ReactNode
  meta: string
  metaDanger?: boolean
  className?: string
}) {
  return (
    <Link
      to={to}
      {...(search === undefined ? {} : { search })}
      className={cn(
        'bg-card text-card-foreground border-border flex flex-col gap-1.5 rounded-[var(--radius-xl)] border px-4 py-[18px] no-underline transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:px-5',
        className,
      )}
    >
      <span className="text-muted-foreground text-[13px]">{label}</span>
      {valueKind !== 'omit' && (
        <span className="text-[20px] leading-[26px] font-semibold tracking-tight tabular md:text-[26px] md:leading-8">
          {valueKind === 'empty' ? null : value}
        </span>
      )}
      <span
        className={cn(
          'text-[13px]',
          metaDanger ? 'text-destructive font-medium' : 'text-muted-foreground',
        )}
      >
        {meta}
      </span>
    </Link>
  )
}

function dayMonthLabel(
  iso: string,
  t: (key: MessageKey, vars?: Record<string, string>) => string,
): string {
  const parts = calendarParts(iso)
  return t('dash.dateDayMonth', {
    day: String(parts.day),
    month: t(`dash.monthFull.${String(parts.month)}` as MessageKey),
  })
}

function EuroAmount({ amount }: { amount: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold">{'€\u00a0'}</span>
      <Money amount={amount} />
    </span>
  )
}

function ProfitGlance({
  yearCode,
  income,
  expenses,
  result,
}: {
  yearCode: string
  income: string | null
  expenses: string | null
  result: string | null
}) {
  const { t } = useT()
  // No P&L data → omit the card rather than invent € 0,00 (PM #107).
  if (income === null || expenses === null || result === null) return null

  const max = BigInt(income) > BigInt(expenses) ? BigInt(income) : BigInt(expenses)
  const yearSearch = { fiscalYear: Number(yearCode) }

  return (
    <section
      aria-labelledby="dash-pl-h"
      className="bg-card border-border flex flex-col gap-3.5 rounded-[var(--radius-xl)] border p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="dash-pl-h" className="text-base font-semibold">
          {t('dash.glance.plTitle', { year: yearCode })}
        </h2>
        <Link
          to="/reports/profit-and-loss"
          search={yearSearch}
          className="text-link text-[13px] underline underline-offset-4"
        >
          {t('dash.glance.plLink')}
        </Link>
      </div>
      <GlanceBar
        label={t('dash.glance.income')}
        amount={income}
        width={glanceBarPercent(income, max)}
        tone="income"
      />
      <GlanceBar
        label={t('dash.glance.expenses')}
        amount={expenses}
        width={glanceBarPercent(expenses, max)}
        tone="expense"
      />
      <div className="border-border flex justify-between border-t pt-3">
        <span className="font-semibold">{t('dash.glance.result')}</span>
        <span className="font-bold tabular">
          <EuroAmount amount={result} />
        </span>
      </div>
    </section>
  )
}

function GlanceBar({
  label,
  amount,
  width,
  tone,
}: {
  label: string
  amount: string
  width: number
  tone: 'income' | 'expense'
}) {
  // Hide € 0,00 bars (Design #112) — keep the label/amount row only when non-zero.
  if (BigInt(amount) === 0n) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-[13px]">
        <span>{label}</span>
        <span className="font-semibold tabular">
          <EuroAmount amount={amount} />
        </span>
      </div>
      <div className="bg-[var(--line-soft)] h-2.5 overflow-hidden rounded-[5px]">
        <div
          className={cn('h-2.5 rounded-[5px]', tone === 'income' ? 'bg-chart-1' : 'bg-chart-2')}
          style={{ width: `${String(width)}%` }}
        />
      </div>
    </div>
  )
}

function AgeingGlance({ ageing, yearCode }: { ageing: DashboardAgeing; yearCode: string }) {
  const { t } = useT()
  const present = DEBTOR_AGEING_BUCKETS.filter((bucket) => BigInt(ageing[bucket]) > 0n)
  // Nothing overdue → omit the card (never show € 0,00 placeholders).
  if (present.length === 0) return null

  const total = present.reduce((sum, bucket) => sum + BigInt(ageing[bucket]), 0n)
  const yearSearch = { fiscalYear: Number(yearCode) }

  return (
    <section
      aria-labelledby="dash-age-h"
      className="bg-card border-border flex flex-col gap-3.5 rounded-[var(--radius-xl)] border p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="dash-age-h" className="text-base font-semibold">
          {t('dash.glance.ageTitle')}
        </h2>
        <Link
          to="/reports/debtor-ageing"
          search={yearSearch}
          className="text-link text-[13px] underline underline-offset-4"
        >
          {t('dash.glance.ageLink')}
        </Link>
      </div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-md">
        {present.map((bucket) => {
          const amount = BigInt(ageing[bucket])
          const pct = total <= 0n ? 0 : Number((amount * 1000n) / total) / 10
          return (
            <div
              key={bucket}
              className={cn('h-full min-w-1', AGE_BUCKET_COLOR[bucket])}
              style={{ width: `${String(Math.max(2, pct))}%` }}
            />
          )
        })}
      </div>
      <ul className="flex flex-col gap-2 text-[13px]">
        {present.map((bucket) => (
          <li key={bucket}>
            <Link
              to="/reports/debtor-ageing"
              search={{ ...yearSearch, bucket }}
              className="text-foreground hover:bg-muted -mx-1 flex items-center gap-2 rounded-[var(--radius-sm)] px-1 py-0.5 no-underline"
            >
              <span
                className={cn('size-2.5 shrink-0 rounded-[2px]', AGE_BUCKET_COLOR[bucket])}
                aria-hidden="true"
              />
              <span className="flex-1">{t(AGE_BUCKET_LABEL[bucket])}</span>
              <span className="tabular">
                <EuroAmount amount={ageing[bucket]} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AuditCard() {
  const { t } = useT()
  return (
    <section
      className="bg-primary text-primary-foreground border-primary flex flex-col gap-2 rounded-[var(--radius-xl)] border p-5"
      aria-label={t('dash.exportTitle')}
    >
      <span className="text-[15px] font-semibold">{t('dash.exportTitle')}</span>
      <span className="text-[13px] leading-normal opacity-80">{t('dash.exportBody')}</span>
      {/* Underlined link in the card's text colour — never yellow on the ink card (PM #107). */}
      <Link
        to="/audit-file"
        className="text-primary-foreground w-fit text-[13px] font-semibold underline underline-offset-4"
      >
        {t('dash.exportAction')}
      </Link>
    </section>
  )
}

function kindIcon(kind: WorkQueueKind, tone: AttentionTone): ReactNode {
  // Each kind keeps its own glyph — drafts and inbox no longer reuse VAT % (Design #112).
  if (kind === 'sales.draft') {
    return <RiFileTextLine aria-hidden="true" className="size-[18px]" />
  }
  if (kind === 'inbox.waiting') {
    return <RiInbox2Line aria-hidden="true" className="size-[18px]" />
  }
  if (kind === 'vat.filing') {
    return <RiPercentLine aria-hidden="true" className="size-[18px]" />
  }
  if (tone === 'error') {
    return <RiAlertLine aria-hidden="true" className="size-[18px]" />
  }
  if (tone === 'attention') {
    return <RiCalendarLine aria-hidden="true" className="size-[18px]" />
  }
  if (tone === 'brand') {
    return <RiArrowLeftRightLine aria-hidden="true" className="size-[18px]" />
  }
  if (tone === 'info') {
    return <RiCheckLine aria-hidden="true" className="size-[18px]" />
  }
  return <RiFileTextLine aria-hidden="true" className="size-[18px]" />
}

function tileClass(tone: AttentionTone): string {
  if (tone === 'error') return 'bg-[var(--danger-bg)] text-destructive'
  if (tone === 'attention') return 'bg-unreconciled/15 text-unreconciled'
  if (tone === 'brand') return 'bg-[var(--brand-tint)] text-[var(--brand-ink)]'
  if (tone === 'info') return 'bg-[var(--info-bg)] text-info'
  return 'bg-[var(--neutral-bg)] text-[var(--ink-2)]'
}

function rowCopy(
  item: WorkQueueItem,
  t: (key: MessageKey, vars?: Record<string, string>) => string,
  plural: (key: string, count: number, values?: Record<string, string | number>) => string,
): { title: string; body: string; action: string } {
  const destination = DESTINATIONS[item.kind]
  const detail = item.detail

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
      body: homeQueueOverdueOneBody(detail, t, plural),
      action: t(destination.action),
    }
  }

  // Multi overdue: title matches the tile ("N facturen te laat"); body is the
  // oldest days-late — never the generic line that repeats the title.
  if (item.kind === 'sales.overdue' && item.count > 1) {
    return {
      title: plural(destination.title, item.count),
      body: homeQueueOverdueManyBody(detail, plural),
      action: t(destination.action),
    }
  }

  if (item.kind === 'vat.filing' && detail?.vatPeriod !== undefined) {
    const deadlineIso = homeQueueVatDeadlineIso(detail)
    const deadlineLabel = deadlineIso === null ? null : dayMonthLabel(deadlineIso, t)
    return {
      title: t(destination.title as MessageKey, { period: detail.vatPeriod }),
      body: homeQueueVatBody(detail, deadlineLabel, t),
      action: t(destination.action),
    }
  }

  if (destination.titlePlural) {
    return {
      title: plural(destination.title, item.count),
      body: t(destination.body),
      action: t(destination.action),
    }
  }

  return {
    title: t(destination.title as MessageKey),
    body: t(destination.body),
    action: t(destination.action),
  }
}

/**
 * The to-do list, and the keyboard that works it.
 *
 * Focus stays on the page on load — `j`/`k` start the cursor at row 0.
 * Only the top item's action is primary. `Enter` opens (native link),
 * `Escape` leaves the list. Empty → "Nothing waiting" / "Niets te doen".
 */
function WorkQueue({ items, fiscalYear }: { items: readonly WorkQueueItem[]; fiscalYear: string }) {
  const { t, plural } = useT()
  const hydrated = useHydrated()
  const [cursor, setCursor] = useState(0)
  const rows = useRef<(HTMLAnchorElement | null)[]>([])
  const cursorRef = useRef(0)

  useEffect(() => {
    cursorRef.current = cursor
  }, [cursor])

  useEffect(() => {
    if (items.length === 0) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (isTypingInto(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const active = document.activeElement
      const inList = rows.current.some((row) => row !== null && row === active)
      if (inList) {
        const resolution = resolveListKey(
          event.key,
          { index: cursorRef.current, count: items.length },
          false,
        )
        if (resolution.action === 'move') {
          event.preventDefault()
          const next = resolution.index
          setCursor(next)
          cursorRef.current = next
          rows.current[next]?.focus()
        }
        if (resolution.action === 'leave') {
          event.preventDefault()
          rows.current[cursorRef.current]?.blur()
        }
        return
      }
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault()
        setCursor(0)
        cursorRef.current = 0
        rows.current[0]?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [items.length])

  if (items.length === 0) {
    return (
      <Empty className="bg-card rounded-[var(--radius-xl)] border">
        <EmptyHeader>
          <EmptyTitle role="heading" aria-level={2}>
            {t('queue.empty')}
          </EmptyTitle>
          <EmptyDescription>{t('queue.emptyBody')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link to="/invoices/new">{t('queue.emptyAction')}</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <section
      aria-labelledby="queue-title"
      className="bg-card border-border overflow-hidden rounded-[var(--radius-xl)] border"
    >
      <div className="flex items-center justify-between gap-4 px-4 py-4 md:px-5">
        <h2 id="queue-title" className="text-base font-semibold">
          {t('queue.title')}
        </h2>
        {hydrated && (
          <span className="text-muted-foreground hidden items-center gap-1.5 text-[13px] md:inline-flex">
            <Keycap>j</Keycap>
            <Keycap>k</Keycap>
            <span>{t('queue.keysMove')}</span>
            <Keycap>↵</Keycap>
            <span>{t('queue.keysDo')}</span>
          </span>
        )}
      </div>

      <ul role="list">
        {items.map((item, index) => {
          const destination = DESTINATIONS[item.kind]
          const tone = ATTENTION_TONE[item.kind]
          const copy = rowCopy(item, t, plural)
          const selected = index === cursor
          const isTop = index === 0
          const search = {
            ...(destination.search ?? {}),
            // Ageing / overdue open the same boekjaar the Home is showing (PM #112).
            ...(item.kind === 'sales.overdue' ? { fiscalYear: Number(fiscalYear) } : {}),
          }
          return (
            <li key={item.kind}>
              <Link
                to={destination.to}
                {...(Object.keys(search).length === 0 ? {} : { search })}
                ref={(element: HTMLAnchorElement | null) => {
                  rows.current[index] = element
                }}
                tabIndex={index === cursor ? 0 : -1}
                onFocus={() => {
                  setCursor(index)
                }}
                className={cn(
                  'group border-line-soft focus-visible:outline-solid hover:bg-[var(--surface-hover)] flex min-h-11 items-center gap-3 border-t px-4 py-3.5 no-underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:min-h-16 md:gap-3.5 md:px-5',
                  selected && 'bg-[var(--selection)] shadow-[inset_3px_0_0_var(--selection-edge)]',
                )}
              >
                <span
                  className={cn(
                    'inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-lg)] md:size-9',
                    tileClass(tone),
                  )}
                >
                  {kindIcon(item.kind, tone)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-5 font-semibold">{copy.title}</span>
                  {copy.body !== '' && (
                    <span className="text-muted-foreground block text-[13px]">{copy.body}</span>
                  )}
                </span>
                {item.amount !== null &&
                  (item.kind !== 'sales.overdue' || item.count > 1) &&
                  item.kind !== 'vat.filing' && (
                    <span className="hidden text-[15px] font-semibold tabular md:inline">
                      <EuroAmount amount={item.amount} />
                    </span>
                  )}
                {/* Action chrome: whole row is the link; only the top button is primary. */}
                <span
                  aria-hidden="true"
                  data-todo-action={isTop ? 'primary' : 'secondary'}
                  className={cn(
                    'pointer-events-none hidden shrink-0 items-center justify-center rounded-[var(--radius-md)] px-3 text-sm font-medium md:inline-flex',
                    isTop
                      ? 'bg-primary text-primary-foreground h-9 font-semibold'
                      : 'border-input bg-background h-9 border',
                  )}
                >
                  {copy.action}
                </span>
                <RiArrowRightSLine
                  aria-hidden="true"
                  className="text-muted-foreground size-5 shrink-0 md:hidden"
                />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
