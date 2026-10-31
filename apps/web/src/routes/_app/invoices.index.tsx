import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { RiAddLine, RiExternalLinkLine, RiMoreLine } from '@remixicon/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { SalesTabs } from '~/components/sales-tabs'
import { InvoiceStatusPill } from '~/components/sales/invoice-status-pill'
import { Money } from '~/components/finance/money'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { Keycap, ShortcutFooter } from '~/components/ui/keycap'
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
  invoiceHistoryEvents,
  invoicePill,
  sentAsFromDeliveries,
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
 * Boards: Invoices / InvoicesDark / PhoneSales. Segments Drafts / Open /
 * Overdue with real counts from the list + overdue report. Preview pane on
 * desktop; phone is the list. "Nieuwe factuur" is secondary (PM).
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
      listInvoices({ data: { status: null, limit: 200 } }),
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
  const reminderCount = queue.ok ? queue.data.actions.length : 0

  const activeId =
    selectedId !== undefined && shown.some((row) => row.id === selectedId)
      ? selectedId
      : (shown[0]?.id ?? undefined)

  useEffect(() => {
    if (!hydrated || !result.ok) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat) return
      if (isTypingInto(event.target)) {
        if (event.key === 'Escape') (event.target as HTMLElement).blur()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === '/') {
        event.preventDefault()
        filterRef.current?.focus()
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

      if (activeId === undefined) return
      const index = shown.findIndex((row) => row.id === activeId)

      if (event.key === 'j' || event.key === 'J') {
        const next = shown[Math.min(index + 1, shown.length - 1)]
        if (next === undefined) return
        event.preventDefault()
        void navigate({
          to: '/invoices',
          search: { segment, q, id: next.id, status: undefined },
        })
        return
      }
      if (event.key === 'k' || event.key === 'K') {
        const next = shown[Math.max(index - 1, 0)]
        if (next === undefined) return
        event.preventDefault()
        void navigate({
          to: '/invoices',
          search: { segment, q, id: next.id, status: undefined },
        })
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        void navigate({ to: '/invoices/$invoiceId', params: { invoiceId: activeId } })
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
          total: String(segmentTotal),
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
              {SEGMENTS.map((key, index) => (
                <TabsTrigger key={key} value={key} className="flex-1 gap-1.5 md:flex-none">
                  {t(`sales.segment.${key}` as MessageKey)}
                  <span className="text-ink-muted tabular-nums">{String(counts[key])}</span>
                  {hydrated && (
                    <span className="text-ink-muted ml-1 hidden font-mono text-[11px] md:inline">
                      {String(index + 1)}
                    </span>
                  )}
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
                  <div className="min-w-[640px]">
                    <div
                      className="text-ink-muted grid grid-cols-[20px_92px_minmax(140px,1fr)_80px_120px_110px] gap-3 border-b border-[var(--line-soft)] px-5 py-2.5 text-xs font-medium"
                      role="row"
                    >
                      <span className="sr-only">{t('sales.hints.select')}</span>
                      <span>{t('invoices.number')}</span>
                      <span>{t('invoices.contact')}</span>
                      <span>{t('invoices.date')}</span>
                      <span>{t('invoices.status')}</span>
                      <span className="text-right">{t('report.total')}</span>
                    </div>
                    {shown.map((row) => {
                      const pill = invoicePill(row, overdueIds, asOf)
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
                            'hover:bg-surface-hover grid w-full grid-cols-[20px_92px_minmax(140px,1fr)_80px_120px_110px] gap-3 border-b border-[var(--line-soft)] px-5 py-3 text-left text-sm last:border-b-0',
                            'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                            isActive && 'bg-surface-sunken',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              'mt-0.5 size-4 rounded-[var(--radius-xs)] border-[1.5px] border-input box-border',
                              selected.has(row.id) && 'bg-primary border-primary',
                            )}
                          />
                          <span className="tabular-nums font-medium">
                            {row.number ?? t('sales.pill.draft')}
                          </span>
                          <span className="truncate">{row.contactName}</span>
                          <span className="text-ink-2 tabular-nums">
                            {formatDate(row.issueDate)}
                          </span>
                          <span>
                            <InvoiceStatusPill pill={pill} />
                          </span>
                          <span className="text-right font-medium tabular-nums">
                            <Money amount={row.total} />
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
                      amount: `€ ${formatMinorUnits(sum)}`,
                    })}
                  </span>
                </div>
              </div>

              {/* Phone list (PhoneSales) */}
              <div className="border-border bg-surface overflow-hidden rounded-[var(--radius-xl)] border md:hidden">
                {shown.map((row) => {
                  const pill = invoicePill(row, overdueIds, asOf)
                  return (
                    <Link
                      key={row.id}
                      to="/invoices/$invoiceId"
                      params={{ invoiceId: row.id }}
                      className="flex min-h-14 items-center gap-3 border-t border-[var(--line-soft)] px-4 py-3.5 first:border-t-0"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <strong className="truncate text-[15px] font-semibold">
                          {row.contactName}
                        </strong>
                        <span className="text-ink-muted tabular-nums text-[13px]">
                          {row.number ?? t('sales.pill.draft')}
                          {' · '}
                          {shortDate(row.issueDate, t)}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <span className="font-semibold tabular-nums">
                          <Money amount={row.total} />
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

      <ShortcutFooter
        ids={[
          'list.next',
          'list.previous',
          'list.open',
          'list.selectX',
          'list.filter',
          'new.invoice',
        ]}
        className="mt-6 hidden md:flex"
      />
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

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [invoice, deliveryList] = await Promise.all([
        getInvoice({ data: { invoiceId: row.id } }),
        listDeliveries({ data: { invoiceId: row.id } }),
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
    })()
    return () => {
      cancelled = true
    }
  }, [row.id])

  const pill = invoicePill(row, overdueIds, asOf)
  const isOverdue = overdueIds.has(row.id)
  const days = overdueDays.get(row.id) ?? null
  const sentAs = sentAsFromDeliveries(deliveries)
  const history = invoiceHistoryEvents({
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    status: row.status,
    overdue: isOverdue,
    daysOverdue: days,
    deliveries,
    nextReminder: dunning === null ? null : { tone: dunning.tone, stageLabel: dunning.stageLabel },
  })

  const vatGroups = groupVat(detail?.lines ?? [])
  const showFinal = isOverdue && dunning !== null && dunning.tone === 'final'
  const showSend = row.status === 'issued'
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
            <Link to="/invoices/$invoiceId" params={{ invoiceId: row.id }}>
              <RiExternalLinkLine aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xl leading-[26px] font-semibold">{row.contactName}</span>
          <span className="text-[32px] leading-[38px] font-semibold tracking-[-0.02em] tabular-nums">
            <Money amount={row.total} />
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {showFinal && (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                onRemind(dunning.stage)
              }}
            >
              {t('sales.preview.sendFinal')}
              <Keycap className="ml-1">R</Keycap>
            </Button>
          )}
          {showSend && !showFinal && (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onSend}>
              {t('sales.preview.sendAgain')}
              <Keycap className="ml-1">E</Keycap>
            </Button>
          )}
          {row.status === 'issued' && row.kind === 'invoice' && (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCredit}>
              {t('sales.preview.credit')}
              <Keycap className="ml-1">C</Keycap>
            </Button>
          )}
          {row.status !== 'draft' && (
            <Button asChild variant="outline" size="sm">
              <a href={`/api/v1/sales-invoices/${row.id}/pdf?embedUbl=true`}>
                {t('sales.preview.pdf')}
                <Keycap className="ml-1">P</Keycap>
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
                  {t('sales.preview.sendAgain')}
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

      {detail !== null && (
        <div className="flex flex-col gap-2 border-b border-[var(--line-soft)] px-6 py-4 text-sm">
          {detail.lines.map((line, index) => (
            <div key={index} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{line.description}</span>
              <span className="tabular-nums">
                <Money amount={line.net} />
              </span>
            </div>
          ))}
          {vatGroups.map((group) => (
            <div key={group.rate} className="text-ink-muted flex justify-between">
              <span>{t('sales.preview.vatRate', { rate: group.rate })}</span>
              <span className="tabular-nums">
                <Money amount={group.tax} />
              </span>
            </div>
          ))}
          <div className="flex justify-between border-t border-[var(--line-soft)] pt-2 font-semibold">
            <span>{t('sales.preview.total')}</span>
            <span className="tabular-nums">
              <Money amount={detail.total} />
            </span>
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
