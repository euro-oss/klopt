import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Clock, FileText, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { CostsTabs } from '~/components/costs-tabs'
import { PurchaseStatusPill } from '~/components/costs/purchase-status-pill'
import { EuroAmount } from '~/components/finance/money'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { Keycap } from '~/components/ui/keycap'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { violationMessage } from '~/i18n/labels'
import {
  costsApprovalKind,
  costsPill,
  countAwaitingApproval,
  countCostsSegments,
  filterCostsInvoices,
  overdueCostsInvoices,
  showCostsAddToBatch,
  showCostsApprove,
  showCostsDispute,
  sumCostsOutstanding,
  sumCostsTotals,
  type CostsInvoiceRow,
  type CostsSegment,
  type CostsTab,
} from '~/lib/costs-list'
import { formatDate, formatMinorUnits } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { isTypingInto } from '~/lib/keyboard'
import { localTodayIso } from '~/lib/local-clock'
import { cn } from '~/lib/utils'
import { listPurchaseInvoices, transitionPurchaseInvoice } from '~/server/purchase'

/**
 * Costs → Bills (#107 Phase 4 / #128).
 *
 * Board: Costs.dc.html (desktop light). Tabs Bills / To approve / Payment
 * batches / Suppliers; segments All / To pay / Paid from `outstanding`;
 * desktop preview with approve / dispute / add-to-batch on existing
 * transitions. Dark and phone follow tokens until Batch 2 / 3 boards.
 */

const SEGMENTS: readonly CostsSegment[] = ['all', 'open', 'paid']

function parseSegment(value: unknown): CostsSegment {
  return SEGMENTS.includes(value as CostsSegment) ? (value as CostsSegment) : 'all'
}

function parseTab(value: unknown): CostsTab {
  return value === 'approve' ? 'approve' : 'bills'
}

function tabFromSearch(search: Record<string, unknown>): CostsTab {
  if (typeof search['tab'] === 'string') return parseTab(search['tab'])
  // Legacy `?status=booked` from Home / bookmarks before Phase 4.
  if (search['status'] === 'booked') return 'approve'
  return 'bills'
}

function segmentFromSearch(search: Record<string, unknown>): CostsSegment {
  if (typeof search['segment'] === 'string') return parseSegment(search['segment'])
  if (search['open'] === true || search['open'] === 'true') return 'open'
  return 'all'
}

export const Route = createFileRoute('/_app/purchases/')({
  // Fields stay optional on the Link type so Home / shell / detail back-links
  // can omit `search`; defaults are applied here on every navigation.
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    tab?: CostsTab
    segment?: CostsSegment
    q?: string
    id?: string
    /** @deprecated Phase 4 uses `segment` / `tab`; kept so old links type-check. */
    status?: string
    /** @deprecated Phase 4 uses `segment=open`. */
    open?: boolean
  } => ({
    tab: tabFromSearch(search),
    segment: segmentFromSearch(search),
    q: typeof search['q'] === 'string' ? search['q'] : '',
    ...(typeof search['id'] === 'string' && search['id'] !== '' ? { id: search['id'] } : {}),
    ...(typeof search['status'] === 'string' ? { status: search['status'] } : {}),
    ...(search['open'] === true || search['open'] === 'true' ? { open: true } : {}),
  }),
  loaderDeps: ({ search }) => ({ tab: search.tab, segment: search.segment }),
  loader: async () => {
    const asOf = localTodayIso()
    const invoices = await listPurchaseInvoices({ data: {} })
    return { invoices, asOf }
  },
  pendingComponent: CostsPending,
  component: Costs,
})

function CostsPending() {
  const { t } = useT()
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <p className="sr-only">{t('common.busy')}</p>
      <div className="bg-muted h-10 w-48 animate-pulse rounded-[var(--radius-md)]" />
      <div className="bg-muted h-64 animate-pulse rounded-[var(--radius-xl)]" />
    </div>
  )
}

function Costs() {
  const { invoices: result, asOf } = Route.useLoaderData()
  const search = Route.useSearch()
  const tab: CostsTab = search.tab ?? 'bills'
  const segment: CostsSegment = search.segment ?? 'all'
  const q = search.q ?? ''
  const selectedId = search.id
  const navigate = useNavigate()
  const router = useRouter()
  const { t, plural } = useT()
  const hydrated = useHydrated()
  const filterRef = useRef<HTMLInputElement | null>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [disputing, setDisputing] = useState(false)
  const transitionKey = useRef(crypto.randomUUID())

  const rows = result.ok ? (result.data.invoices as CostsInvoiceRow[]) : []
  const counts = countCostsSegments(rows)
  const approveCount = countAwaitingApproval(rows)
  const shown = filterCostsInvoices(rows, tab, segment, q)
  const overdue = overdueCostsInvoices(rows, asOf)
  const overdueSum = sumCostsOutstanding(overdue)

  const activeId =
    selectedId !== undefined && shown.some((row) => row.id === selectedId) ? selectedId : undefined

  const searchOf = (overrides: {
    tab?: CostsTab
    segment?: CostsSegment
    q?: string
    id?: string | undefined
  }) => {
    const nextId = 'id' in overrides ? overrides.id : selectedId
    return {
      tab: overrides.tab ?? tab,
      segment: overrides.segment ?? segment,
      q: overrides.q ?? q,
      ...(nextId !== undefined ? { id: nextId } : {}),
    }
  }

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
      void navigate({ to: '/purchases', search: searchOf({ id: next.id }) })
    }

    const closePreview = (): void => {
      if (selectedId === undefined) return
      setDisputing(false)
      void navigate({ to: '/purchases', search: searchOf({ id: undefined }) })
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat) return
      if (isTypingInto(event.target)) {
        if (event.key === 'Escape') {
          ;(event.target as HTMLElement).blur()
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
        if (disputing) {
          setDisputing(false)
          return
        }
        closePreview()
        return
      }

      if (tab === 'bills') {
        const digit = Number(event.key)
        if (digit >= 1 && digit <= 3) {
          const next = SEGMENTS[digit - 1]
          if (next === undefined) return
          event.preventDefault()
          void navigate({
            to: '/purchases',
            search: searchOf({ segment: next, id: undefined }),
          })
          return
        }
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

      if (event.key === 'b' || event.key === 'B') {
        event.preventDefault()
        void navigate({ to: '/payments' })
        return
      }

      if (activeId === undefined) return
      const active = shown.find((row) => row.id === activeId)
      if (active === undefined) return

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        void navigate({
          to: '/purchases/$invoiceId',
          params: { invoiceId: activeId },
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
        return
      }
      if ((event.key === 'a' || event.key === 'A') && showCostsApprove(active)) {
        event.preventDefault()
        void onTransition(activeId, 'approve')
        return
      }
      if ((event.key === 'd' || event.key === 'D') && showCostsDispute(active)) {
        event.preventDefault()
        setDisputing(true)
        return
      }
      if ((event.key === 'p' || event.key === 'P') && showCostsAddToBatch(active)) {
        event.preventDefault()
        void navigate({ to: '/payments' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
    // searchOf closes over tab/segment/q/selectedId; list those deps explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate/searchOf stable enough for this screen
  }, [activeId, disputing, hydrated, navigate, q, result.ok, segment, selectedId, shown, tab])

  const activeRow = shown.find((row) => row.id === activeId) ?? null

  async function onTransition(
    invoiceId: string,
    action: 'approve' | 'dispute' | 'resolve' | 'cancel',
    reason?: string,
  ): Promise<void> {
    setBusy(true)
    setError(null)
    const outcome = await transitionPurchaseInvoice({
      data: {
        invoiceId,
        idempotencyKey: transitionKey.current,
        body: { action, reason: reason ?? null },
      },
    })
    setBusy(false)
    transitionKey.current = crypto.randomUUID()
    if (!outcome.ok) {
      setError(
        outcome.problem.violations.length > 0
          ? outcome.problem.violations.map((item) => violationMessage(t, item)).join(' ')
          : outcome.problem.detail,
      )
      return
    }
    setDisputing(false)
    await router.invalidate()
  }

  if (!result.ok) {
    return (
      <>
        <PageHeader title={t('costs.title')} />
        <CostsTabs active="bills" />
        <p role="alert" className="text-destructive text-sm">
          {result.problem.detail}
        </p>
      </>
    )
  }

  const sum = sumCostsTotals(shown)
  const segmentTotal = tab === 'approve' ? approveCount : counts[segment]
  const showingLabel =
    q.trim() === ''
      ? plural('costs.showing', shown.length, {
          shown: String(shown.length),
          total: String(segmentTotal),
        })
      : plural('costs.showingFiltered', shown.length, { shown: String(shown.length) })

  return (
    <>
      <PageHeader
        title={t('costs.title')}
        actions={
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <label className="border-input bg-background focus-within:outline-ring relative flex min-h-11 w-full flex-1 items-center gap-2 rounded-[var(--radius-md)] border px-3 pr-10 sm:max-w-[18rem] md:min-h-10">
              <span className="sr-only">{t('costs.filterAria')}</span>
              <Input
                ref={filterRef}
                data-list-filter=""
                value={q}
                onChange={(event) => {
                  void navigate({
                    to: '/purchases',
                    search: searchOf({ q: event.target.value }),
                    replace: true,
                  })
                }}
                placeholder={t('costs.filterPlaceholder')}
                aria-label={t('costs.filterAria')}
                className="border-0 bg-transparent px-0 shadow-none focus-visible:outline-none"
                suppressHydrationWarning
              />
              {hydrated && (
                <span className="text-ink-muted absolute top-1/2 right-3 hidden -translate-y-1/2 md:inline">
                  <Keycap>/</Keycap>
                </span>
              )}
            </label>
            <Button asChild className="min-h-11 md:min-h-9">
              <Link to="/purchases/new">
                <Upload data-icon="inline-start" aria-hidden="true" />
                <span>{t('costs.addBill')}</span>
                {hydrated && (
                  <span className="ml-1 hidden gap-0.5 normal-case md:inline-flex">
                    <Keycap className="border-primary-foreground/40 bg-primary-foreground/10 text-primary-foreground">
                      n
                    </Keycap>
                    <Keycap className="border-primary-foreground/40 bg-primary-foreground/10 text-primary-foreground">
                      r
                    </Keycap>
                  </span>
                )}
              </Link>
            </Button>
          </div>
        }
      />

      <CostsTabs active={tab === 'approve' ? 'approve' : 'bills'} approveCount={approveCount} />

      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      {overdue.length > 0 && tab === 'bills' && (
        <div className="mb-4">
          <Alert
            variant="destructive"
            aria-label={t('purchases.overdue')}
            className="rounded-[var(--radius-lg)] max-md:has-data-[slot=alert-action]:pr-4"
          >
            <Clock aria-hidden="true" className="mt-0.5 size-5" />
            <AlertTitle data-costs-overdue-title="">
              {plural('costs.callout.overdue', overdue.length, {
                count: String(overdue.length),
                amount: `€\u00a0${formatMinorUnits(overdueSum)}`,
              })}
            </AlertTitle>
            <AlertDescription>{t('costs.callout.overdueBody')}</AlertDescription>
            {/*
              Desktop keeps the absolute corner action (AlertAction pattern).
              Below md, put the button in normal flow under the title/body so it
              cannot cover the banner title (alert.tsx Absolute + pr-18 only).
            */}
            <div
              data-slot="alert-action"
              className="max-md:col-span-full max-md:col-start-1 max-md:mt-2 max-md:w-full md:absolute md:top-2.5 md:right-3"
            >
              <Button
                asChild
                size="sm"
                variant="outline"
                className="bg-surface max-md:min-h-11 max-md:w-full"
                data-costs-overdue-prepare=""
              >
                <Link to="/payments">
                  {t('costs.callout.prepare')}
                  {hydrated && <Keycap className="ml-1.5">b</Keycap>}
                </Link>
              </Button>
            </div>
          </Alert>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-label={t('costs.list')}
          className="flex min-w-0 flex-[999_1_560px] flex-col gap-3"
        >
          {tab === 'bills' && (
            <Tabs
              value={segment}
              onValueChange={(value) => {
                void navigate({
                  to: '/purchases',
                  search: searchOf({ segment: parseSegment(value), id: undefined }),
                })
              }}
            >
              <TabsList
                variant="segmented"
                aria-label={t('costs.segment')}
                className="w-full md:w-auto [&_[data-slot=tabs-trigger]]:min-h-11 md:[&_[data-slot=tabs-trigger]]:min-h-9"
              >
                {SEGMENTS.map((key) => (
                  <TabsTrigger key={key} value={key} className="flex-1 gap-1.5 md:flex-none">
                    {t(`costs.segment.${key}` as MessageKey)}
                    <span className="text-ink-muted tabular-nums">{String(counts[key])}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          {shown.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {tab === 'approve'
                    ? t('costs.emptyApprove')
                    : rows.length === 0
                      ? t('costs.empty')
                      : t('costs.emptySegment')}
                </EmptyTitle>
                {rows.length === 0 && tab === 'bills' && (
                  <EmptyDescription>{t('purchases.intro')}</EmptyDescription>
                )}
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              {/* Desktop table */}
              <div className="border-border bg-surface hidden overflow-hidden rounded-[var(--radius-xl)] border shadow-[var(--shadow-raised)] md:block">
                <div className="overflow-x-auto">
                  {/*
                    Status needs ≥148px so “234 dagen te laat” is never clipped at
                    1440 with the preview pane open (export used 120px; CoS: no
                    cut-off cells). Supplier stays the flexible column.
                  */}
                  <div className="min-w-[720px]">
                    <div
                      className="text-ink-muted grid grid-cols-[20px_minmax(140px,1fr)_minmax(140px,auto)_72px_minmax(148px,auto)_96px] gap-3 border-b border-[var(--line-soft)] px-5 py-2.5 text-xs font-medium"
                      role="row"
                    >
                      <span aria-hidden="true" />
                      <span>{t('costs.col.supplier')}</span>
                      <span>{t('costs.col.theirNumber')}</span>
                      <span>{t('costs.col.date')}</span>
                      <span>{t('costs.col.status')}</span>
                      <span className="text-right">{t('costs.col.amount')}</span>
                    </div>
                    {shown.map((row) => {
                      const pill = costsPill(row, asOf)
                      const isActive = row.id === activeId
                      return (
                        <button
                          key={row.id}
                          type="button"
                          aria-selected={isActive}
                          onClick={() => {
                            setDisputing(false)
                            void navigate({
                              to: '/purchases',
                              search: searchOf({ id: row.id }),
                            })
                          }}
                          className={cn(
                            'hover:bg-surface-hover grid w-full grid-cols-[20px_minmax(140px,1fr)_minmax(140px,auto)_72px_minmax(148px,auto)_96px] gap-3 border-b border-[var(--line-soft)] px-5 py-3 text-left text-sm last:border-b-0',
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
                          <span className="truncate font-medium">{row.contactName}</span>
                          <span className="text-ink-muted whitespace-nowrap tabular-nums text-[13px]">
                            {row.supplierInvoiceNumber}
                          </span>
                          <span className="text-ink-2 whitespace-nowrap tabular-nums">
                            {shortDate(row.invoiceDate, t)}
                          </span>
                          <span className="min-w-0 whitespace-nowrap">
                            <PurchaseStatusPill pill={pill} />
                          </span>
                          <span className="text-right font-medium whitespace-nowrap tabular-nums">
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
                    {t('costs.listTotal', {
                      amount: `€\u00a0${formatMinorUnits(sum)}`,
                    })}
                  </span>
                </div>
              </div>

              {/* Phone list — tokens until Batch 3 phone board */}
              <div className="border-border bg-surface overflow-hidden rounded-[var(--radius-xl)] border md:hidden">
                {shown.map((row) => {
                  const pill = costsPill(row, asOf)
                  return (
                    <Link
                      key={row.id}
                      to="/purchases/$invoiceId"
                      params={{ invoiceId: row.id }}
                      className="flex min-h-14 items-center gap-3 border-t border-[var(--line-soft)] px-4 py-3.5 first:border-t-0"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <strong className="truncate text-[15px] font-semibold">
                          {row.contactName}
                        </strong>
                        <span className="text-ink-muted whitespace-nowrap tabular-nums text-[13px]">
                          {row.supplierInvoiceNumber}
                          {' · '}
                          {shortDate(row.invoiceDate, t)}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <span className="font-semibold">
                          <EuroAmount amount={row.total} />
                        </span>
                        <PurchaseStatusPill pill={pill} />
                      </span>
                    </Link>
                  )
                })}
              </div>
            </>
          )}
        </section>

        {activeRow !== null && (
          <BillPreview
            row={activeRow}
            asOf={asOf}
            busy={busy || !hydrated}
            disputing={disputing}
            onDisputingChange={setDisputing}
            onApprove={() => {
              void onTransition(activeRow.id, 'approve')
            }}
            onDispute={(reason) => {
              void onTransition(activeRow.id, 'dispute', reason)
            }}
            onAddToBatch={() => {
              void navigate({ to: '/payments' })
            }}
          />
        )}
      </div>

      {hydrated && (
        <p className="text-muted-foreground mt-6 hidden flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] md:flex">
          <span className="inline-flex items-center gap-1">
            <Keycap>j</Keycap>
            <Keycap>k</Keycap>
            <span>{t('costs.hints.nextPrev')}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Keycap>a</Keycap>
            <span>{t('costs.hints.approve')}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Keycap>p</Keycap>
            <span>{t('costs.hints.addToBatch')}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Keycap>x</Keycap>
            <span>{t('costs.hints.select')}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Keycap>1</Keycap>
            <span>–</span>
            <Keycap>3</Keycap>
            <span>{t('costs.hints.segments')}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Keycap>/</Keycap>
            <span>{t('costs.hints.filter')}</span>
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

function BillPreview({
  row,
  asOf,
  busy,
  disputing,
  onDisputingChange,
  onApprove,
  onDispute,
  onAddToBatch,
}: {
  readonly row: CostsInvoiceRow
  readonly asOf: string
  readonly busy: boolean
  readonly disputing: boolean
  readonly onDisputingChange: (value: boolean) => void
  readonly onApprove: () => void
  readonly onDispute: (reason: string) => void
  readonly onAddToBatch: () => void
}) {
  const { t } = useT()
  const pill = costsPill(row, asOf)
  const approval = costsApprovalKind(row.status)
  const approvalKey =
    approval === 'none' ? null : (`costs.preview.approval.${approval}` as MessageKey)

  return (
    <aside
      aria-label={t('costs.preview')}
      className="border-border bg-surface hidden max-w-[440px] min-w-0 flex-[1_1_360px] flex-col overflow-hidden rounded-[var(--radius-xl)] border shadow-[var(--shadow-raised)] md:flex"
    >
      <div className="flex flex-col gap-3 border-b border-[var(--line-soft)] px-6 py-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-ink-muted min-w-0 truncate whitespace-nowrap tabular-nums text-[13px]">
            {row.supplierInvoiceNumber}
          </span>
          <PurchaseStatusPill pill={pill} overdueTone="preview" />
          <span className="flex-1" />
          <Button asChild variant="ghost" size="icon" aria-label={t('costs.preview.openFull')}>
            <Link to="/purchases/$invoiceId" params={{ invoiceId: row.id }}>
              <FileText aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xl leading-[26px] font-semibold">{row.contactName}</span>
          <span className="text-[32px] leading-[38px] font-semibold tracking-[-0.02em]">
            <EuroAmount amount={row.total} />
          </span>
        </div>

        {disputing ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              const reason = form.get('reason')
              onDispute(typeof reason === 'string' ? reason.trim() : '')
            }}
          >
            <label className="block">
              <span className="text-ink-muted mb-1 block text-xs font-medium">
                {t('costs.preview.disputeWhy')}
              </span>
              <textarea
                name="reason"
                required
                rows={2}
                className="border-input bg-background min-h-11 w-full rounded-[var(--radius-md)] border px-3 py-2 text-sm"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                {t('costs.preview.disputeConfirm')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onDisputingChange(false)
                }}
              >
                {t('costs.preview.disputeCancel')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            {showCostsAddToBatch(row) && (
              <Button type="button" size="sm" disabled={busy} onClick={onAddToBatch}>
                {t('costs.preview.addToBatch')}
                <Keycap className="border-primary-foreground/40 bg-primary-foreground/10 text-primary-foreground ml-1.5">
                  p
                </Keycap>
              </Button>
            )}
            {showCostsApprove(row) && (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onApprove}>
                {t('costs.preview.approve')}
                <Keycap className="ml-1.5">a</Keycap>
              </Button>
            )}
            {showCostsDispute(row) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  onDisputingChange(true)
                }}
              >
                {t('costs.preview.dispute')}
                <Keycap className="ml-1.5">d</Keycap>
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="bg-surface-sunken text-ink-muted mx-6 mt-4 flex h-40 flex-col items-center justify-center gap-1.5 rounded-[var(--radius-md)] text-[13px]">
        <FileText aria-hidden="true" className="size-[22px]" />
        <span>{t('costs.preview.document')}</span>
      </div>

      <dl className="grid grid-cols-[110px_1fr] gap-y-2.5 px-6 pt-4 pb-5 text-sm">
        <dt className="text-ink-muted">{t('costs.preview.billDate')}</dt>
        <dd className="m-0 tabular-nums">{formatDate(row.invoiceDate)}</dd>
        <dt className="text-ink-muted">{t('costs.preview.due')}</dt>
        <dd className="m-0 tabular-nums">{formatDate(row.dueDate)}</dd>
        <dt className="text-ink-muted">{t('costs.preview.stillToPay')}</dt>
        <dd className="m-0 font-semibold">
          <EuroAmount amount={row.outstanding} />
        </dd>
        <dt className="text-ink-muted">{t('costs.preview.approval')}</dt>
        <dd className="m-0">{approvalKey === null ? '—' : t(approvalKey)}</dd>
      </dl>
    </aside>
  )
}
