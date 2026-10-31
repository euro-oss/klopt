import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { violationMessage } from '~/i18n/labels'
import { useEffect, useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { InvoiceStatusPill } from '~/components/sales/invoice-status-pill'
import { EuroAmount } from '~/components/finance/money'
import { Button } from '~/components/ui/button'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { dunningStageLabel } from '~/i18n/labels'
import { useT } from '~/i18n/provider'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { isApple } from '~/lib/keyboard'
import { localTodayIso } from '~/lib/local-clock'
import {
  invoiceHistoryEvents,
  invoicePill,
  sentAsFromDeliveries,
  type DeliveryRecord,
  type HistoryEvent,
} from '~/lib/sales-list'
import { cn } from '~/lib/utils'
import {
  draftInvoice,
  dunningQueue,
  getInvoice,
  issueInvoice,
  listDeliveries,
  listOverdueInvoices,
  sendInvoice,
  sendReminder,
} from '~/server/sales'

/**
 * One invoice — desktop detail + PhoneInvoice (#107 / #118).
 *
 * Phone: number + pill, customer + € total, one full-width primary, PDF /
 * Creditnota secondaries, details card, history card, Sent as, 44px controls.
 */

export const Route = createFileRoute('/_app/invoices/$invoiceId')({
  loader: async ({ params }) => {
    const asOf = localTodayIso()
    const [invoice, deliveries, overdue, queue] = await Promise.all([
      getInvoice({ data: { invoiceId: params.invoiceId } }),
      listDeliveries({ data: { invoiceId: params.invoiceId } }),
      listOverdueInvoices({ data: { asOf } }),
      dunningQueue({ data: { asOf } }),
    ])
    return { invoice, deliveries, overdue, queue, asOf }
  },
  component: Invoice,
})

interface Line {
  lineNumber: number
  description: string
  quantity: string
  unitCode: string
  unitPrice: string
  revenueAccountNumber: string
  taxCode: string
  ratePercent: string
  net: string
  tax: string
}

function Invoice() {
  const { invoice: result, deliveries, overdue, queue, asOf } = Route.useLoaderData()
  const { invoiceId } = Route.useParams()
  const router = useRouter()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const { t } = useT()

  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<{ path: string | null; message: string }[]>([])
  const [asking, setAsking] = useState(false)
  const [confirmRemind, setConfirmRemind] = useState(false)
  const issueKey = useRef<string>(crypto.randomUUID())
  const creditKey = useRef<string>(crypto.randomUUID())
  const sendKey = useRef<string>(crypto.randomUUID())
  const reminderKey = useRef<string>(crypto.randomUUID())

  if (!result.ok) {
    return (
      <>
        <PageHeader title={t('invoice.title')} />
        <p role="alert" className="text-destructive text-sm">
          {result.problem.detail}
        </p>
      </>
    )
  }

  const invoice = result.data.invoice
  const deliveryRows: readonly DeliveryRecord[] = deliveries.ok
    ? (deliveries.data.deliveries as DeliveryRecord[])
    : []

  const overdueIds = new Set(
    overdue.ok ? overdue.data.invoices.map((row: { id: string }) => row.id) : [],
  )
  const overdueDays = new Map<string, number>()
  if (overdue.ok) {
    for (const row of overdue.data.invoices as readonly { id: string; daysOverdue: number }[]) {
      overdueDays.set(row.id, row.daysOverdue)
    }
  }
  const days = overdueDays.get(invoice.id) ?? null
  const dunning =
    queue.ok
      ? (queue.data.actions.find((row) => row.invoiceId === invoice.id) ?? null)
      : null
  const pill = invoicePill(
    {
      id: invoice.id,
      kind: invoice.kind,
      status: invoice.status,
      dueDate: invoice.dueDate,
    },
    overdueIds,
    asOf,
    days,
  )
  const sentAs = sentAsFromDeliveries(deliveryRows)
  const history = invoiceHistoryEvents({
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    status: invoice.status,
    overdue: overdueIds.has(invoice.id),
    daysOverdue: days,
    deliveries: deliveryRows,
    nextReminder:
      dunning === null
        ? null
        : { tone: dunning.tone, stageLabel: dunning.stageLabel },
  })

  function report(problem: {
    violations: readonly { path: string | null; message: string }[]
    detail: string
  }) {
    setProblems(
      problem.violations.length > 0
        ? problem.violations.map((violation) => ({
            path: violation.path,
            message: violationMessage(t, violation),
          }))
        : [{ path: null, message: problem.detail }],
    )
  }

  async function issue() {
    setBusy(true)
    setProblems([])
    const outcome = await issueInvoice({
      data: { invoiceId, idempotencyKey: issueKey.current },
    })
    setBusy(false)
    if (!outcome.ok) {
      report(outcome.problem)
      return
    }
    issueKey.current = crypto.randomUUID()
    await router.invalidate()
  }

  async function send() {
    setBusy(true)
    setProblems([])
    const outcome = await sendInvoice({
      data: { invoiceId, idempotencyKey: sendKey.current },
    })
    setBusy(false)
    if (!outcome.ok) {
      report(outcome.problem)
      return
    }
    sendKey.current = crypto.randomUUID()
    if (outcome.data.failure !== null) {
      setProblems([
        { path: null, message: t('invoice.sendFailed', { reason: outcome.data.failure }) },
      ])
    }
    await router.invalidate()
  }

  async function credit() {
    setBusy(true)
    setProblems([])
    const outcome = await draftInvoice({
      data: {
        idempotencyKey: creditKey.current,
        contactNumber: invoice.contact.number,
        kind: 'credit_note',
        issueDate: new Date().toISOString().slice(0, 10),
        reference: invoice.reference,
        buyerReference: invoice.buyerReference,
        creditsInvoiceId: invoice.id,
        lines: invoice.lines.map((line: Line) => ({
          description: line.description,
          quantity: line.quantity,
          unitCode: line.unitCode,
          unitPrice: line.unitPrice,
          revenueAccountNumber: line.revenueAccountNumber,
          taxCode: line.taxCode,
        })),
      },
    })
    setBusy(false)
    if (!outcome.ok) {
      report(outcome.problem)
      return
    }
    creditKey.current = crypto.randomUUID()
    await navigate({ to: '/invoices/$invoiceId', params: { invoiceId: outcome.data.id } })
  }

  async function remind() {
    if (dunning === null) return
    setBusy(true)
    setProblems([])
    setConfirmRemind(false)
    const outcome = await sendReminder({
      data: {
        invoiceId,
        idempotencyKey: reminderKey.current,
        expectedStage: dunning.stage,
        asOf,
      },
    })
    setBusy(false)
    if (!outcome.ok) {
      setProblems([{ path: null, message: outcome.problem.detail }])
      return
    }
    reminderKey.current = crypto.randomUUID()
    if (outcome.data.failure !== null) {
      setProblems([
        {
          path: null,
          message: t('dunning.sendFailed', {
            name: invoice.contact.name,
            reason: outcome.data.failure,
          }),
        },
      ])
    }
    await router.invalidate()
  }

  const columns: readonly Column<Line>[] = [
    {
      key: 'nr',
      header: '#',
      width: '3rem',
      cell: (line) => <span className="tabular text-muted-foreground">{line.lineNumber}</span>,
    },
    { key: 'description', header: t('entries.description'), cell: (line) => line.description },
    {
      key: 'quantity',
      header: t('invoice.quantity'),
      width: '7rem',
      align: 'right',
      cell: (line) => (
        <span className="tabular-nums">
          {formatQty(line.quantity)} {line.unitCode}
        </span>
      ),
    },
    {
      key: 'price',
      header: t('invoice.price'),
      width: '8rem',
      align: 'right',
      cell: (line) => <EuroAmount amount={line.unitPrice} />,
    },
    {
      key: 'account',
      header: t('invoice.ledgerAccount'),
      width: '7rem',
      cell: (line) => <span className="tabular-nums">{line.revenueAccountNumber}</span>,
    },
    {
      key: 'tax',
      header: t('invoice.vat'),
      width: '7rem',
      cell: (line) => `${line.taxCode} · ${line.ratePercent}%`,
    },
    {
      key: 'net',
      header: t('invoice.net'),
      width: '9rem',
      align: 'right',
      cell: (line) => <EuroAmount amount={line.net} />,
    },
  ]

  const isDraft = invoice.status === 'draft'
  const title = invoice.number ?? t('invoice.draft')
  const alreadySent = deliveryRows.some((item) => item.purpose === 'invoice' && item.delivered)
  const showThird =
    !isDraft && dunning !== null && dunning.tone === 'final' && overdueIds.has(invoice.id)
  const sendLabel = alreadySent ? t('sales.preview.sendAgain') : t('sales.preview.send')

  return (
    <>
      {isDraft && (
        <IssueKeys
          asking={asking}
          onAsk={() => {
            setAsking(true)
          }}
          onCancel={() => {
            setAsking(false)
          }}
          onConfirm={() => {
            setAsking(false)
            void issue()
          }}
        />
      )}

      {/* ——— PhoneInvoice ——— */}
      <div className="flex flex-col gap-4 md:hidden">
        <Link
          to="/invoices"
          search={{ segment: 'open', q: '', id: undefined, status: undefined }}
          className="text-ink inline-flex min-h-11 items-center self-start text-sm font-medium"
        >
          ‹ {t('sales.title')}
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-muted tabular-nums text-sm">
            {invoice.kind === 'credit_note' ? t('invoice.creditNote') : t('invoice.title')}{' '}
            {title}
          </span>
          <InvoiceStatusPill pill={pill} />
        </div>

        <div className="flex flex-col gap-1">
          <h1 className="text-xl leading-7 font-semibold">{invoice.contact.name}</h1>
          <p className="text-[32px] leading-[38px] font-semibold tracking-[-0.02em]">
            <EuroAmount amount={invoice.total} />
          </p>
        </div>

        {problems.length > 0 && (
          <ul role="alert" className="text-destructive space-y-1 text-sm">
            {problems.map((problem, index) => (
              <li key={index}>
                {problem.path === null ? '' : `${problem.path}: `}
                {problem.message}
              </li>
            ))}
          </ul>
        )}

        {confirmRemind && showThird ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('dunning.confirmSend')}
            className="border-border bg-surface flex flex-col gap-3 rounded-[var(--radius-xl)] border p-4"
          >
            <p className="font-medium">{t('dunning.confirmSend')}</p>
            <Button
              type="button"
              className="min-h-11 w-full"
              disabled={busy || !hydrated}
              onClick={() => {
                void remind()
              }}
            >
              {busy ? t('common.busy') : t('sales.preview.sendFinal')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full"
              onClick={() => {
                setConfirmRemind(false)
              }}
            >
              {t('sales.preview.cancel')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {isDraft && (
              <Button
                type="button"
                className="min-h-11 w-full"
                disabled={busy || !hydrated}
                onClick={() => {
                  void issue()
                }}
              >
                {busy ? t('common.busy') : t('invoice.issueAndPost')}
              </Button>
            )}
            {showThird && (
              <Button
                type="button"
                className="min-h-11 w-full"
                disabled={busy || !hydrated}
                onClick={() => {
                  setConfirmRemind(true)
                }}
              >
                {t('sales.preview.sendFinal')}
              </Button>
            )}
            {!isDraft && !showThird && (
              <Button
                type="button"
                className="min-h-11 w-full"
                disabled={busy || !hydrated}
                onClick={() => {
                  void send()
                }}
              >
                {busy ? t('common.busy') : sendLabel}
              </Button>
            )}
            <div className="grid grid-cols-2 gap-2">
              {!isDraft && (
                <Button asChild variant="outline" className="min-h-11">
                  <a href={`/api/v1/sales-invoices/${invoice.id}/pdf?embedUbl=true`}>
                    {t('sales.preview.pdf')}
                  </a>
                </Button>
              )}
              {!isDraft && invoice.kind === 'invoice' && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={busy || !hydrated}
                  onClick={() => {
                    void credit()
                  }}
                >
                  {t('sales.preview.credit')}
                </Button>
              )}
            </div>
          </div>
        )}

        <section className="border-border bg-surface flex flex-col gap-3 rounded-[var(--radius-xl)] border p-4">
          <h2 className="text-sm font-semibold">{t('invoice.lines')}</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-sm">
            <dt className="text-ink-muted">{t('sales.preview.invoiceDate')}</dt>
            <dd className="m-0 text-right tabular-nums">{formatDate(invoice.issueDate)}</dd>
            {!isDraft && (
              <>
                <dt className="text-ink-muted">{t('sales.preview.due')}</dt>
                <dd className="m-0 text-right tabular-nums">{formatDate(invoice.dueDate)}</dd>
              </>
            )}
            {sentAs !== null && (
              <>
                <dt className="text-ink-muted">{t('sales.preview.sentAs')}</dt>
                <dd className="m-0 text-right">
                  {sentAs.kind === 'email_pdf_ubl'
                    ? t('sales.preview.sentAsEmail')
                    : t('sales.preview.sentAsNotDelivered')}
                </dd>
              </>
            )}
          </dl>
          <ul className="flex flex-col gap-2 border-t border-[var(--line-soft)] pt-3 text-sm">
            {invoice.lines.map((line: Line) => (
              <li key={line.lineNumber} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {line.description}
                  <span className="text-ink-muted block text-xs tabular-nums">
                    {formatQty(line.quantity)} {line.unitCode}
                  </span>
                </span>
                <EuroAmount amount={line.net} className="shrink-0 font-medium" />
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-[var(--line-soft)] pt-3 text-sm font-semibold">
            <span>{t('sales.preview.total')}</span>
            <EuroAmount amount={invoice.total} />
          </div>
        </section>

        {history.length > 0 && (
          <section className="border-border bg-surface flex flex-col gap-3 rounded-[var(--radius-xl)] border p-4">
            <h2 className="text-sm font-semibold">{t('sales.preview.history')}</h2>
            {history.map((event, index) => (
              <PhoneHistoryRow key={index} event={event} />
            ))}
          </section>
        )}
      </div>

      {/* ——— Desktop ——— */}
      <div className="hidden md:block">
        <PageHeader
          title={`${invoice.kind === 'credit_note' ? t('invoice.creditNote') : t('invoice.title')} ${title}`}
          description={`${invoice.contact.number} · ${invoice.contact.name} · ${formatDate(invoice.issueDate)}`}
          actions={
            <>
              {isDraft && (
                <Button
                  type="button"
                  disabled={busy || !hydrated}
                  onClick={() => {
                    void issue()
                  }}
                >
                  {busy ? t('common.busy') : t('invoice.issueAndPost')}
                </Button>
              )}
              {!isDraft && (
                <Button
                  type="button"
                  disabled={busy || !hydrated}
                  onClick={() => {
                    void send()
                  }}
                >
                  {busy ? t('common.busy') : sendLabel}
                </Button>
              )}
              {!isDraft && invoice.kind === 'invoice' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !hydrated}
                  onClick={() => {
                    void credit()
                  }}
                >
                  {t('invoice.credit')}
                </Button>
              )}
              {!isDraft && (
                <>
                  <Button asChild variant="outline">
                    <a href={`/api/v1/sales-invoices/${invoice.id}/pdf?embedUbl=true`}>
                      {t('invoice.downloadPdf')}
                    </a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={`/api/v1/sales-invoices/${invoice.id}/ubl`}>
                      {t('invoice.downloadUbl')}
                    </a>
                  </Button>
                </>
              )}
            </>
          }
        />

        {isDraft && asking && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('invoice.confirmIssueTitle')}
            className="border-border mb-6 border p-4"
          >
            <h2 className="font-medium">{t('invoice.confirmIssueTitle')}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('invoice.confirmIssueBody', { customer: invoice.contact.name })}{' '}
              <EuroAmount amount={invoice.total} />
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                autoFocus
                disabled={busy}
                onClick={() => {
                  setAsking(false)
                  void issue()
                }}
              >
                {busy ? t('common.busy') : t('invoice.issueAndPost')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setAsking(false)
                }}
              >
                {t('entryNew.confirmBack')}
              </Button>
            </div>
          </div>
        )}

        {isDraft && (
          <p className="border-border text-muted-foreground mb-6 border border-dashed p-4 text-sm">
            {t('invoice.draftNotice')}
          </p>
        )}

        {problems.length > 0 && (
          <ul role="alert" className="text-destructive mb-6 space-y-1 text-sm">
            {problems.map((problem, index) => (
              <li key={index}>
                {problem.path === null ? '' : `${problem.path}: `}
                {problem.message}
              </li>
            ))}
          </ul>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <InvoiceStatusPill pill={pill} />
          {sentAs !== null && (
            <span className="text-ink-muted text-sm">
              {t('sales.preview.sentAs')}:{' '}
              {sentAs.kind === 'email_pdf_ubl'
                ? t('sales.preview.sentAsEmail')
                : t('sales.preview.sentAsNotDelivered')}
            </span>
          )}
        </div>

        <LedgerTable
          columns={columns}
          rows={invoice.lines}
          rowKey={(line) => String(line.lineNumber)}
          caption={t('invoice.lines')}
          empty={t('invoice.noLines')}
        />

        <div className="border-border mt-6 flex max-w-md justify-between gap-8 border p-4 text-sm">
          <div className="space-y-1">
            <p className="text-muted-foreground">{t('invoice.subtotal')}</p>
            <p className="text-muted-foreground">{t('invoice.vat')}</p>
            <p className="font-medium">{t('report.total')}</p>
            {!isDraft && <p className="text-muted-foreground">{t('invoices.due')}</p>}
          </div>
          <div className="space-y-1 text-right">
            <EuroAmount amount={invoice.net} className="block" />
            <EuroAmount amount={invoice.tax} className="block" />
            <EuroAmount amount={invoice.total} className="block font-medium" />
            {!isDraft && <p className="tabular-nums">{formatDate(invoice.dueDate)}</p>}
          </div>
        </div>

        {history.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-base font-medium">{t('sales.preview.history')}</h2>
            <div className="flex flex-col gap-3">
              {history.map((event, index) => (
                <PhoneHistoryRow key={index} event={event} />
              ))}
            </div>
          </section>
        )}

        {invoice.journalEntryId !== null && (
          <p className="text-muted-foreground mt-6 text-sm">
            {t('invoice.postedAs')}{' '}
            <Link
              to="/entries/$entryId"
              params={{ entryId: invoice.journalEntryId }}
              className="underline"
            >
              {t('invoice.postedAsLink')}
            </Link>
            .
          </p>
        )}
      </div>
    </>
  )
}

function formatQty(quantity: string): string {
  const n = Number(quantity)
  if (!Number.isFinite(n)) return quantity
  return String(n)
}

function PhoneHistoryRow({ event }: { readonly event: HistoryEvent }) {
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

  return (
    <div className="flex gap-3 text-sm">
      <span
        className={cn(
          'mt-1.5 size-2.5 shrink-0 rounded-full',
          event.kind === 'due_unpaid' || event.kind === 'send_failed'
            ? 'bg-danger'
            : event.kind === 'next_reminder'
              ? 'bg-surface shadow-[inset_0_0_0_2px_var(--danger)]'
              : 'bg-[var(--chart-2)]',
        )}
        aria-hidden="true"
      />
      <span className="flex flex-1 flex-col gap-px">
        <span className="font-medium">{label}</span>
        {when !== null && <span className="text-ink-muted tabular-nums text-[13px]">{when}</span>}
      </span>
    </div>
  )
}

function IssueKeys({
  asking,
  onAsk,
  onCancel,
  onConfirm,
}: {
  readonly asking: boolean
  readonly onAsk: () => void
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const hydrated = useHydrated()

  useEffect(() => {
    if (!hydrated) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return

      const mod = isApple() ? event.metaKey : event.ctrlKey
      if (mod && event.key === 'Enter') {
        event.preventDefault()
        if (asking) onConfirm()
        else onAsk()
        return
      }

      if (event.key === 'Escape' && asking) {
        const target = event.target as HTMLElement | null
        if (target !== null && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
        event.preventDefault()
        onCancel()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [asking, hydrated, onAsk, onCancel, onConfirm])

  return null
}
