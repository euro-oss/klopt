import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { RiAddLine, RiExternalLinkLine, RiMoreLine } from '@remixicon/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { SalesTabs } from '~/components/sales-tabs'
import { InvoiceStatusPill } from '~/components/sales/invoice-status-pill'
import { EuroAmount } from '~/components/finance/money'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { Keycap } from '~/components/ui/keycap'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { dunningStageLabel } from '~/i18n/labels'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { formatDate, formatMinorUnits } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { isTypingInto } from '~/lib/keyboard'
import { localTodayIso } from '~/lib/local-clock'
import {
  countSalesSegments,
  filterSalesInvoices,
  formatSalesSegmentCount,
  invoiceHistoryEvents,
  invoicePill,
  salesSendLabelKey,
  sendableDunningActions,
  sentAsFromDeliveries,
  showSalesSend,
  SALES_LIST_FETCH_LIMIT,
  sumInvoiceTotals,
  type DeliveryRecord,
  type HistoryEvent,
  type SalesInvoiceRow,
  type SalesSegment,
} from '~/lib/sales-list'
import { cn } from '~/lib/utils'
import {
  draftInvoice,
  dunningQueue,
  getInvoice,
  listDeliveries,
  listInvoices,
  listOverdueInvoices,
  sendInvoice,
  sendReminder,
} from '~/server/sales'

/**
 * Sales → Invoices (#107 Phase 2).
 *
 * Boards: Invoices / InvoicesDark / PhoneSales. Segments Drafts / Issued /
 * Overdue with counts from the list + overdue report (Issued cannot yet
 * exclude paid invoices — no `outstanding`/`paidOn` on the list [API]). Preview pane
 * on desktop; phone is the list. "Nieuwe factuur" is secondary (PM).
 */

const SEGMENTS: readonly SalesSegment[] = ['draft', 'open', 'overdue']

function parseSegment(value: unknown): SalesSegment {
  return SEGMENTS.includes(value as SalesSegment) ? (value as SalesSegment) : 'open'
}

function segmentFromSearch(search: Record<string, unknown>): SalesSegment {
  if (typeof search['segment'] === 'string') return parseSegment(search['segment'])
  // Legacy `?status=` from Home / bookmarks before Phase 2.
  if (search['status'] === 'draft') return 'draft'
  if (search['status'] === 'issued') return 'open'
  return 'open'
}

export const Route = createFileRoute('/_app/invoices/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    segment: SalesSegment
    q: string
    id: string | undefined
    /** @deprecated Phase 2 uses `segment`; kept so old links type-check. */
    status: 'draft' | 'issued' | 'cancelled' | undefined
  } => ({
    segment: segmentFromSearch(search),
    q: typeof search['q'] === 'string' ? search['q'] : '',
    id: typeof search['id'] === 'string' && search['id'] !== '' ? search['id'] : undefined,
    status:
      search['status'] === 'draft' ||
      search['status'] === 'issued' ||
      search['status'] === 'cancelled'
        ? search['status']
        : undefined,
  }),
  loaderDeps: ({ search }) => ({ segment: search.segment }),
  loader: async () => {
    const asOf = localTodayIso()
    const [invoices, overdue, queue] = await Promise.all([
      listInvoices({ data: { status: null, limit: SALES_LIST_FETCH_LIMIT } }),
      listOverdueInvoices({ data: { asOf } }),
      dunningQueue({ data: { asOf } }),
    ])
    return { invoices, overdue, queue, asOf }
  },
  pendingComponent: InvoicesPending,
  component: Invoices,
})

function InvoicesPending() {
  const { t } = useT()
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <p className="sr-only">{t('common.busy')}</p>
      <div className="bg-muted h-10 w-48 animate-pulse rounded-[var(--radius-md)]" />
      <div className="bg-muted h-64 animate-pulse rounded-[var(--radius-xl)]" />
    </div>
  )
}

function Invoices() {
  const { invoices: result, overdue, queue, asOf } = Route.useLoaderData()
  const { segment, q, id: selectedId } = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const { t, plural } = useT()
  const hydrated = useHydrated()
  const filterRef = useRef<HTMLInputElement | null>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sendKey = useRef(crypto.randomUUID())
  const creditKey = useRef(crypto.randomUUID())
  const reminderKey = useRef(crypto.randomUUID())

  const overdueIds = useMemo((): Set<string> => {
    if (!overdue.ok) return new Set<string>()
    return new Set(overdue.data.invoices.map((row: { id: string }) => row.id))
  }, [overdue])

  const overdueDays = useMemo((): Map<string, number> => {
    const map = new Map<string, number>()
    if (!overdue.ok) return map
    for (const row of overdue.data.invoices as readonly { id: string; daysOverdue: number }[]) {
      map.set(row.id, row.daysOverdue)
    }
    return map
  }, [overdue])

  const dunningByInvoice = useMemo(() => {
    const map = new Map<
      string,
      { stage: number; tone: 'reminder' | 'demand' | 'final'; stageLabel: string }
    >()
    if (!queue.ok) return map
    for (const action of queue.data.actions) {
      map.set(action.invoiceId, {
        stage: action.stage,
        tone: action.tone,
        stageLabel: action.stageLabel,
      })
    }
    return map
  }, [queue])

  const rows = result.ok ? (result.data.invoices as SalesInvoiceRow[]) : []
  const counts = countSalesSegments(rows, overdueIds)
  const shown = filterSalesInvoices(rows, overdueIds, segment, q)
  // Same sendable predicate as Reminders / Send all — skip rows without email.
  const reminderCount = queue.ok ? sendableDunningActions(queue.data.actions).length : 0

  // Preview only when `id` is in the URL — Escape clears it and hides the pane.
  const activeId =
    selectedId !== undefined && shown.some((row) => row.id === selectedId) ? selectedId : undefined

  useEffect(() => {
    if (!hydrated || !result.ok) return

    const moveSelection = (delta: 1 | -1): void => {
      if (shown.length === 0) return
      const index = activeId === undefined ? -1 : shown.findIndex((row) => row.id === activeId)
      const nextIndex =
        activeId === undefined
          ? delta > 0
            ? 0
            : shown.length - 1
          : Math.min(Math.max(index + delta, 0), shown.length - 1)
      const next = shown[nextIndex]
      if (next === undefined) return
      void navigate({
        to: '/invoices',
        search: { segment, q, id: next.id, status: undefined },
      })
    }

    const closePreview = (): void => {
      if (selectedId === undefined) return
      void navigate({
        to: '/invoices',
        search: { segment, q, id: undefined, status: undefined },
      })
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat) return
      if (isTypingInto(event.target)) {
        if (event.key === 'Escape') {
          ;(event.target as HTMLElement).blur()
          // After blurring the filter, drop the preview selection too.
          event.preventDefault()
          closePreview()
        }
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === '/') {
        event.preventDefault()
        filterRef.current?.focus()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        closePreview()
        return
      }

      const digit = Number(event.key)
      if (digit >= 1 && digit <= 3) {
        const next = SEGMENTS[digit - 1]
        if (next === undefined) return
        event.preventDefault()
        void navigate({
          to: '/invoices',
          search: { segment: next, q, id: selectedId, status: undefined },
        })
        return
      }

      if (event.key === 'j' || event.key === 'J' || event.key === 'ArrowDown') {
        event.preventDefault()
        moveSelection(1)
        return
      }
      if (event.key === 'k' || event.key === 'K' || event.key === 'ArrowUp') {
        event.preventDefault()
        moveSelection(-1)
        return
      }

      if (activeId === undefined) return

      if (event.key === 'Enter') {
        event.preventDefault()
        void navigate({
          to: '/invoices/$invoiceId',
          params: { invoiceId: activeId },
          search: { segment },
        })
        return
      }
      if (event.key === 'x' || event.key === 'X') {
        event.preventDefault()
        setSelected((prev) => {
          const next = new Set(prev)
          if (next.has(activeId)) next.delete(activeId)
          else next.add(activeId)
          return next
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeId, hydrated, navigate, q, result.ok, segment, selectedId, shown])

  const activeRow = shown.find((row) => row.id === activeId) ?? null

  if (!result.ok) {
    return (
      <>
        <PageHeader title={t('sales.title')} />
        <SalesTabs active="invoices" />
        <p role="alert" className="text-destructive text-sm">
          {result.problem.detail}
        </p>
      </>
    )
  }

  async function onSend(invoiceId: string) {
    setBusy(true)
    setError(null)
    const outcome = await sendInvoice({
      data: { invoiceId, idempotencyKey: sendKey.current },
    })
    setBusy(false)
    if (!outcome.ok) {
      setError(outcome.problem.detail)
      return
    }
    sendKey.current = crypto.randomUUID()
    if (outcome.data.failure !== null) {
      setError(t('invoice.sendFailed', { reason: outcome.data.failure }))
    }
    await router.invalidate()
  }

  async function onCredit(invoice: SalesInvoiceRow) {
    setBusy(true)
    setError(null)
    const detail = await getInvoice({ data: { invoiceId: invoice.id } })
    if (!detail.ok) {
      setBusy(false)
      setError(detail.problem.detail)
      return
    }
    const source = detail.data.invoice
    const outcome = await draftInvoice({
      data: {
        idempotencyKey: creditKey.current,
        contactNumber: source.contact.number,
        kind: 'credit_note',
        issueDate: localTodayIso(),
        reference: source.reference,
        buyerReference: source.buyerReference,
        creditsInvoiceId: source.id,
        lines: source.lines.map(
          (line: {
            description: string
            quantity: string
            unitCode: string
            unitPrice: string
            revenueAccountNumber: string
            taxCode: string
          }) => ({
            description: line.description,
            quantity: line.quantity,
            unitCode: line.unitCode,
            unitPrice: line.unitPrice,
            revenueAccountNumber: line.revenueAccountNumber,
            taxCode: line.taxCode,
          }),
        ),
      },
    })
    setBusy(false)
    if (!outcome.ok) {
      setError(outcome.problem.detail)
      return
    }
    creditKey.current = crypto.randomUUID()
    await navigate({ to: '/invoices/$invoiceId', params: { invoiceId: outcome.data.id } })
  }

  async function onRemind(invoiceId: string, stage: number) {
    setBusy(true)
    setError(null)
    const outcome = await sendReminder({
      data: {
        invoiceId,
        idempotencyKey: reminderKey.current,
        expectedStage: stage,
        asOf,
      },
    })
    setBusy(false)
    if (!outcome.ok) {
      setError(outcome.problem.detail)
      return
    }
    reminderKey.current = crypto.randomUUID()
    if (outcome.data.failure !== null) {
      setError(t('dunning.sendFailed', { name: '', reason: outcome.data.failure }))
    }
    await router.invalidate()
  }

  const sum = sumInvoiceTotals(shown)
  const segmentTotal = counts[segment]
  const showingLabel =
    q.trim() === ''
      ? plural('sales.showing', shown.length, {
          shown: String(shown.length),
          total: formatSalesSegmentCount(segmentTotal, rows.length),
        })
      : plural('sales.showingFiltered', shown.length, { shown: String(shown.length) })

  return (
    <>
      <PageHeader
        title={t('sales.title')}
        actions={
          <Button asChild variant="outline" className="min-h-11 md:min-h-9">
            <Link to="/invoices/new">
              <RiAddLine data-icon="inline-start" aria-hidden="true" />
              <span className="md:inline">{t('invoices.new')}</span>
              {hydrated && (
                <span className="ml-1 hidden gap-0.5 normal-case md:inline-flex">
                  <Keycap>n</Keycap>
                  <Keycap>f</Keycap>
                </span>
              )}
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <label className="border-input bg-background focus-within:outline-ring relative flex min-h-11 flex-1 items-center gap-2 rounded-[var(--radius-md)] border px-3 md:max-w-xs md:min-h-10">
          <span className="sr-only">{t('sales.filterAria')}</span>
          <Input
            ref={filterRef}
            data-list-filter=""
            value={q}
            onChange={(event) => {
              const value = event.target.value
              void navigate({
                to: '/invoices',
                search: { segment, q: value, id: selectedId, status: undefined },
                replace: true,
              })
            }}
            placeholder={t('sales.filterPlaceholder')}
            aria-label={t('sales.filterAria')}
            className="border-0 bg-transparent px-0 shadow-none focus-visible:outline-none"
            // Playwright's screenshot caret-hide can leave an empty/inline style on
            // the node; suppress so hydration does not console.error on mismatch.
            suppressHydrationWarning
          />
          {hydrated && (
            <span className="text-ink-muted absolute top-1/2 right-3 hidden -translate-y-1/2 md:inline">
              <Keycap>/</Keycap>
            </span>
          )}
        </label>
      </div>

      <SalesTabs active="invoices" remindersCount={reminderCount} />

      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-label={t('sales.list')}
          className="flex min-w-0 flex-[999_1_560px] flex-col gap-3"
        >
          <Tabs
            value={segment}
            onValueChange={(value) => {
              void navigate({
                to: '/invoices',
                search: { segment: parseSegment(value), q, id: undefined, status: undefined },
              })
            }}
          >
            <TabsList
              variant="segmented"
              aria-label={t('sales.segment')}
              className="w-full md:w-auto [&_[data-slot=tabs-trigger]]:min-h-11 md:[&_[data-slot=tabs-trigger]]:min-h-9"
            >
              {SEGMENTS.map((key) => (
                <TabsTrigger key={key} value={key} className="flex-1 gap-1.5 md:flex-none">
                  {t(`sales.segment.${key}` as MessageKey)}
                  <span className="text-ink-muted tabular-nums">
                    {formatSalesSegmentCount(counts[key], rows.length)}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {shown.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {rows.length === 0 ? t('invoices.empty') : t('sales.emptySegment')}
                </EmptyTitle>
                {rows.length === 0 && <EmptyDescription>{t('invoices.intro')}</EmptyDescription>}
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              {/* Desktop table */}
              <div className="border-border bg-surface hidden overflow-hidden rounded-[var(--radius-xl)] border md:block">
                <div className="overflow-x-auto">
                  <div className="min-w-[680px]">
                    <div
                      className="text-ink-muted grid grid-cols-[20px_118px_minmax(140px,1fr)_88px_140px_120px] gap-3 border-b border-[var(--line-soft)] px-5 py-2.5 text-xs font-medium"
                      role="row"
                    >
                      {/* Keep the leading cell in flow — sr-only would collapse the column. */}
                      <span aria-hidden="true" />
                      <span>{t('invoices.number')}</span>
                      <span>{t('invoices.contact')}</span>
                      <span>{t('invoices.date')}</span>
                      <span>{t('invoices.status')}</span>
                      <span className="text-right">{t('report.total')}</span>
                    </div>
                    {shown.map((row) => {
                      const pill = invoicePill(
                        row,
                        overdueIds,
                        asOf,
                        overdueDays.get(row.id) ?? null,
                      )
                      const isActive = row.id === activeId
                      return (
                        <button
                          key={row.id}
                          type="button"
                          aria-selected={isActive}
                          onClick={() => {
                            void navigate({
                              to: '/invoices',
                              search: { segment, q, id: row.id, status: undefined },
                            })
                          }}
                          className={cn(
                            'hover:bg-surface-hover grid w-full grid-cols-[20px_118px_minmax(140px,1fr)_88px_140px_120px] gap-3 border-b border-[var(--line-soft)] px-5 py-3 text-left text-sm last:border-b-0',
                            'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                            isActive &&
                              'bg-[var(--selection)] shadow-[inset_3px_0_0_0_var(--selection-edge)]',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              'mt-0.5 size-4 rounded-[var(--radius-xs)] border-[1.5px] border-input box-border',
                              selected.has(row.id) && 'bg-primary border-primary',
                            )}
                          />
                          <span className="whitespace-nowrap font-medium tabular-nums">
                            {row.number ?? t('sales.pill.draft')}
                          </span>
                          <span className="truncate">{row.contactName}</span>
                          <span className="text-ink-2 whitespace-nowrap tabular-nums">
                            {shortDate(row.issueDate, t)}
                          </span>
                          <span>
                            <InvoiceStatusPill pill={pill} />
                          </span>
                          <span className="text-right font-medium">
                            <EuroAmount amount={row.total} />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="text-ink-muted flex items-center justify-between border-t border-[var(--line-soft)] px-5 py-3 text-sm">
                  <span>{showingLabel}</span>
                  <span className="tabular-nums">
                    {t('sales.listTotal', {
                      amount: `€\u00a0${formatMinorUnits(sum)}`,
                    })}
                  </span>
                </div>
              </div>

              {/* Phone list (PhoneSales) */}
              <div className="border-border bg-surface overflow-hidden rounded-[var(--radius-xl)] border md:hidden">
                {shown.map((row) => {
                  const pill = invoicePill(row, overdueIds, asOf, overdueDays.get(row.id) ?? null)
                  return (
                    <Link
                      key={row.id}
                      to="/invoices/$invoiceId"
                      params={{ invoiceId: row.id }}
                      search={{ segment }}
                      className="flex min-h-14 items-center gap-3 border-t border-[var(--line-soft)] px-4 py-3.5 first:border-t-0"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <strong className="truncate text-[15px] font-semibold">
                          {row.contactName}
                        </strong>
                        <span className="text-ink-muted whitespace-nowrap tabular-nums text-[13px]">
                          {row.number ?? t('sales.pill.draft')}
                          {' · '}
                          {shortDate(row.issueDate, t)}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <span className="font-semibold">
                          <EuroAmount amount={row.total} />
                        </span>
                        <InvoiceStatusPill pill={pill} />
                      </span>
                    </Link>
                  )
                })}
              </div>

              {reminderCount > 0 && (
                <Button asChild variant="outline" className="min-h-12 justify-center md:hidden">
                  <Link to="/dunning">
                    {plural('sales.phone.sendReminders', reminderCount, {
                      count: String(reminderCount),
                    })}
                  </Link>
                </Button>
              )}
            </>
          )}
        </section>

        {activeRow !== null && (
          <InvoicePreview
            row={activeRow}
            segment={segment}
            asOf={asOf}
            overdueIds={overdueIds}
            overdueDays={overdueDays}
            dunning={dunningByInvoice.get(activeRow.id) ?? null}
            busy={busy || !hydrated}
            onSend={() => {
              void onSend(activeRow.id)
            }}
            onCredit={() => {
              void onCredit(activeRow)
            }}
            onRemind={(stage) => {
              void onRemind(activeRow.id, stage)
            }}
          />
        )}
      </div>

      {hydrated && (
        <p className="text-muted-foreground mt-6 hidden flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] md:flex">
          <span className="inline-flex items-center gap-1">
            <Keycap>j</Keycap>
            <Keycap>k</Keycap>
            <span>{t('sales.hints.nextPrev')}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Keycap>↵</Keycap>
            <span>{t('sales.hints.open')}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Keycap>x</Keycap>
            <span>{t('sales.hints.select')}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Keycap>/</Keycap>
            <span>{t('sales.hints.filter')}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Keycap>1</Keycap>
            <Keycap>2</Keycap>
            <Keycap>3</Keycap>
            <span>{t('sales.footer.segments')}</span>
          </span>
        </p>
      )}
    </>
  )
}

function shortDate(iso: string, t: (key: MessageKey) => string): string {
  const day = String(Number(iso.slice(8, 10)))
  const month = Number(iso.slice(5, 7))
  const monthKey = `dash.month.${String(month)}` as MessageKey
  return `${day} ${t(monthKey)}`
}

function InvoicePreview({
  row,
  segment,
  asOf,
  overdueIds,
  overdueDays,
  dunning,
  busy,
  onSend,
  onCredit,
  onRemind,
}: {
  readonly row: SalesInvoiceRow
  readonly segment: SalesSegment
  readonly asOf: string
  readonly overdueIds: ReadonlySet<string>
  readonly overdueDays: ReadonlyMap<string, number>
  readonly dunning: {
    stage: number
    tone: 'reminder' | 'demand' | 'final'
    stageLabel: string
  } | null
  readonly busy: boolean
  readonly onSend: () => void
  readonly onCredit: () => void
  readonly onRemind: (stage: number) => void
}) {
  const { t } = useT()
  const [detail, setDetail] = useState<{
    lines: readonly {
      description: string
      net: string
      tax: string
      ratePercent: string
    }[]
    net: string
    tax: string
    total: string
  } | null>(null)
  const [deliveries, setDeliveries] = useState<readonly DeliveryRecord[]>([])
  /** Id whose detail/deliveries are currently loaded — ignore stale rows. */
  const [loadedForId, setLoadedForId] = useState<string | null>(null)
  /** Invoice id for which the third-reminder confirm is open; null = closed. */
  const [confirmRemindFor, setConfirmRemindFor] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const requestId = row.id
    void (async () => {
      const [invoice, deliveryList] = await Promise.all([
        getInvoice({ data: { invoiceId: requestId } }),
        listDeliveries({ data: { invoiceId: requestId } }),
      ])
      if (cancelled) return
      if (invoice.ok) {
        setDetail({
          lines: invoice.data.invoice.lines,
          net: invoice.data.invoice.net,
          tax: invoice.data.invoice.tax,
          total: invoice.data.invoice.total,
        })
      } else {
        setDetail(null)
      }
      setDeliveries(deliveryList.ok ? (deliveryList.data.deliveries as DeliveryRecord[]) : [])
      setLoadedForId(requestId)
    })()
    return () => {
      cancelled = true
    }
  }, [row.id])

  // Header comes from `row`; lines/history only when loaded for this id — so a
  // fast selection change never shows another invoice's rows under the number.
  const activeDetail = loadedForId === row.id ? detail : null
  const activeDeliveries = loadedForId === row.id ? deliveries : []

  const days = overdueDays.get(row.id) ?? null
  const pill = invoicePill(row, overdueIds, asOf, days)
  const isOverdue = overdueIds.has(row.id)
  const sentAs = sentAsFromDeliveries(activeDeliveries)
  const history = invoiceHistoryEvents({
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    status: row.status,
    overdue: isOverdue,
    daysOverdue: days,
    deliveries: activeDeliveries,
    nextReminder: dunning === null ? null : { tone: dunning.tone, stageLabel: dunning.stageLabel },
  })

  const vatGroups = groupVat(activeDetail?.lines ?? [])
  const showFinal = isOverdue && dunning !== null && dunning.tone === 'final'
  const alreadySent = activeDeliveries.some((item) => item.purpose === 'invoice' && item.delivered)
  const showSend = showSalesSend(row)
  const sendLabelMessageKey = salesSendLabelKey(row, alreadySent)
  const sendLabel = sendLabelMessageKey === null ? '' : t(sendLabelMessageKey)
  const confirmRemind = confirmRemindFor === row.id
  return (
    <aside
      aria-label={t('sales.preview')}
      className="border-border bg-surface hidden max-w-[460px] min-w-0 flex-[1_1_380px] flex-col overflow-hidden rounded-[var(--radius-xl)] border md:flex"
    >
      <div className="flex flex-col gap-3 border-b border-[var(--line-soft)] px-6 py-5">
        <div className="flex items-center gap-2.5">
          <span className="text-ink-muted tabular-nums text-[13px]">
            {row.number === null
              ? t('sales.preview.draft')
              : t('sales.preview.invoice', { number: row.number })}
          </span>
          <InvoiceStatusPill pill={pill} />
          <span className="flex-1" />
          <Button asChild variant="ghost" size="icon" aria-label={t('sales.preview.openFull')}>
            <Link to="/invoices/$invoiceId" params={{ invoiceId: row.id }} search={{ segment }}>
              <RiExternalLinkLine aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xl leading-[26px] font-semibold">{row.contactName}</span>
          <span className="text-[32px] leading-[38px] font-semibold tracking-[-0.02em]">
            <EuroAmount amount={row.total} />
          </span>
        </div>
        {confirmRemind && showFinal && dunning !== null ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('dunning.confirmSend')}
            className="border-border flex flex-col gap-3 rounded-[var(--radius-md)] border p-3"
          >
            <p className="text-sm font-medium">{t('dunning.confirmSend')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setConfirmRemindFor(null)
                  onRemind(dunning.stage)
                }}
              >
                {t('sales.preview.sendFinal')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setConfirmRemindFor(null)
                }}
              >
                {t('sales.preview.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {showFinal && (
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setConfirmRemindFor(row.id)
                }}
              >
                {t('sales.preview.sendFinal')}
              </Button>
            )}
            {showSend && !showFinal && (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onSend}>
                {sendLabel}
              </Button>
            )}
            {row.status === 'issued' && row.kind === 'invoice' && (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCredit}>
                {t('sales.preview.credit')}
              </Button>
            )}
            {row.status !== 'draft' && (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/v1/sales-invoices/${row.id}/pdf?embedUbl=true`}>
                  {t('sales.preview.pdf')}
                </a>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={t('sales.preview.more')}
                >
                  <RiMoreLine aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {showSend && (
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => {
                      onSend()
                    }}
                  >
                    {sendLabel}
                  </DropdownMenuItem>
                )}
                {row.status !== 'draft' && (
                  <DropdownMenuItem asChild>
                    <a href={`/api/v1/sales-invoices/${row.id}/ubl`}>{t('sales.preview.ubl')}</a>
                  </DropdownMenuItem>
                )}
                {row.status === 'issued' && row.kind === 'invoice' && (
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => {
                      onCredit()
                    }}
                  >
                    {t('sales.preview.credit')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <dl className="grid grid-cols-[110px_1fr] gap-y-2.5 border-b border-[var(--line-soft)] px-6 py-4 text-sm">
        <dt className="text-ink-muted">{t('sales.preview.invoiceDate')}</dt>
        <dd className="m-0 tabular-nums">{formatDate(row.issueDate)}</dd>
        <dt className="text-ink-muted">{t('sales.preview.due')}</dt>
        <dd className="m-0 tabular-nums">{formatDate(row.dueDate)}</dd>
        {sentAs !== null && (
          <>
            <dt className="text-ink-muted">{t('sales.preview.sentAs')}</dt>
            <dd className="m-0">
              {sentAs.kind === 'email_pdf_ubl'
                ? t('sales.preview.sentAsEmail')
                : t('sales.preview.sentAsNotDelivered')}
            </dd>
          </>
        )}
      </dl>

      {activeDetail !== null && (
        <div className="flex flex-col gap-2 border-b border-[var(--line-soft)] px-6 py-4 text-sm">
          {activeDetail.lines.map((line, index) => (
            <div key={index} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{line.description}</span>
              <EuroAmount amount={line.net} />
            </div>
          ))}
          {vatGroups.map((group) => (
            <div key={group.rate} className="text-ink-muted flex justify-between">
              <span>{t('sales.preview.vatRate', { rate: group.rate })}</span>
              <EuroAmount amount={group.tax} />
            </div>
          ))}
          <div className="flex justify-between border-t border-[var(--line-soft)] pt-2 font-semibold">
            <span>{t('sales.preview.total')}</span>
            <EuroAmount amount={activeDetail.total} />
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="flex flex-col gap-3.5 px-6 py-4 pb-5">
          <h2 className="text-ink-muted m-0 text-xs font-semibold tracking-[0.04em] uppercase">
            {t('sales.preview.history')}
          </h2>
          {history.map((event, index) => (
            <HistoryRow key={index} event={event} />
          ))}
        </div>
      )}
    </aside>
  )
}

function HistoryRow({ event }: { readonly event: HistoryEvent }) {
  const { t } = useT()
  let label: string
  switch (event.kind) {
    case 'issued':
      label = t('sales.history.issued')
      break
    case 'sent':
      label = t('sales.history.sent')
      break
    case 'send_failed':
      label = t('sales.history.sendFailed')
      break
    case 'reminder':
      label = t('sales.history.reminder', {
        stage: event.tone !== null ? dunningStageLabel(t, event.tone) : (event.stageLabel ?? ''),
      })
      break
    case 'due_unpaid':
      label = t('sales.history.dueUnpaid')
      break
    case 'next_reminder':
      label = t('sales.history.nextReminder', {
        stage: event.tone !== null ? dunningStageLabel(t, event.tone) : (event.stageLabel ?? ''),
      })
      break
  }

  const when =
    event.kind === 'next_reminder'
      ? t('sales.history.nextReminderReady')
      : event.when !== null
        ? formatDate(event.when)
        : null

  const dotClass =
    event.kind === 'due_unpaid' || event.kind === 'send_failed'
      ? 'bg-danger'
      : event.kind === 'next_reminder'
        ? 'bg-surface shadow-[inset_0_0_0_2px_var(--danger)]'
        : event.kind === 'sent' || event.kind === 'issued' || event.kind === 'reminder'
          ? 'bg-[var(--chart-2)]'
          : 'bg-success'

  return (
    <div className="flex gap-3">
      <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', dotClass)} aria-hidden="true" />
      <span className="flex flex-1 flex-col gap-px">
        <span className="font-medium">{label}</span>
        {when !== null && <span className="text-ink-muted tabular-nums text-[13px]">{when}</span>}
      </span>
    </div>
  )
}

function groupVat(
  lines: readonly { ratePercent: string; tax: string }[],
): readonly { rate: string; tax: string }[] {
  const map = new Map<string, bigint>()
  for (const line of lines) {
    const rate = line.ratePercent.replace(/\.?0+$/, '') || line.ratePercent
    map.set(rate, (map.get(rate) ?? 0n) + BigInt(line.tax))
  }
  return [...map.entries()].map(([rate, tax]) => ({ rate, tax: tax.toString() }))
}
