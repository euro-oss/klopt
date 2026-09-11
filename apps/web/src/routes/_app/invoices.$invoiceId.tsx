import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { Money } from '~/components/finance/money'
import { useT } from '~/i18n/provider'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { draftInvoice, getInvoice, issueInvoice, listDeliveries, sendInvoice } from '~/server/sales'

/**
 * One invoice.
 *
 * Issuing is here rather than on the drafting screen, and it is a separate
 * click, because it is the irreversible half: it takes a number out of a series
 * that is legally required to be gapless and posts an entry into the hash
 * chain. After that the only correction is a credit note — there is no edit and
 * no delete, for the same reason the journal has none.
 */
export const Route = createFileRoute('/_app/invoices/$invoiceId')({
  loader: async ({ params }) => ({
    invoice: await getInvoice({ data: { invoiceId: params.invoiceId } }),
    deliveries: await listDeliveries({ data: { invoiceId: params.invoiceId } }),
  }),
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
  const { invoice: result, deliveries } = Route.useLoaderData()
  const { invoiceId } = Route.useParams()
  const router = useRouter()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const { t } = useT()

  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<{ path: string | null; message: string }[]>([])
  const issueKey = useRef<string>(crypto.randomUUID())
  const creditKey = useRef<string>(crypto.randomUUID())
  const sendKey = useRef<string>(crypto.randomUUID())

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

  function report(problem: {
    violations: readonly { path: string | null; message: string }[]
    detail: string
  }) {
    setProblems(
      problem.violations.length > 0
        ? problem.violations.map((violation) => ({
            path: violation.path,
            message: violation.message,
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

  /**
   * Send it.
   *
   * A failure is reported and the invoice is left exactly as it was (spec 8,
   * rule 4) — and the delivery list below gains a row saying what happened,
   * which is the answer to a customer who says they never got it.
   */
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

  /** A credit note is a new draft that references this invoice, never an edit. */
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
        <span className="tabular">
          {line.quantity} {line.unitCode}
        </span>
      ),
    },
    {
      key: 'price',
      header: t('invoice.price'),
      width: '8rem',
      align: 'right',
      cell: (line) => <Money amount={line.unitPrice} />,
    },
    {
      key: 'account',
      header: t('invoice.ledgerAccount'),
      width: '7rem',
      cell: (line) => <span className="tabular">{line.revenueAccountNumber}</span>,
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
      cell: (line) => <Money amount={line.net} />,
    },
  ]

  const isDraft = invoice.status === 'draft'
  const title = invoice.number ?? t('invoice.draft')
  const sentDocuments = deliveries.ok ? deliveries.data.deliveries : []
  const sentAlready = sentDocuments.some((item) => item.purpose === 'invoice' && item.delivered)

  return (
    <>
      <PageHeader
        title={`${invoice.kind === 'credit_note' ? t('invoice.creditNote') : t('invoice.title')} ${title}`}
        description={`${invoice.contact.number} · ${invoice.contact.name} · ${formatDate(invoice.issueDate)}`}
        actions={
          <>
            {isDraft && (
              <button
                type="button"
                disabled={busy || !hydrated}
                onClick={() => {
                  void issue()
                }}
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {busy ? t('common.busy') : t('invoice.issueAndPost')}
              </button>
            )}
            {!isDraft && (
              <button
                type="button"
                disabled={busy || !hydrated}
                onClick={() => {
                  void send()
                }}
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {busy ? t('common.busy') : sentAlready ? t('invoice.sendAgain') : t('invoice.send')}
              </button>
            )}
            {!isDraft && invoice.kind === 'invoice' && (
              <button
                type="button"
                disabled={busy || !hydrated}
                onClick={() => {
                  void credit()
                }}
                className="border-input rounded-md border px-4 py-2 text-sm disabled:opacity-50"
              >
                {t('invoice.credit')}
              </button>
            )}
            {!isDraft && (
              <>
                {/* The rendering first: it is what most people want. The XML
                    is the legal document and the one a machine reads. */}
                <a
                  href={`/api/v1/sales-invoices/${invoice.id}/pdf?embedUbl=true`}
                  className="border-input rounded-md border px-4 py-2 text-sm"
                >
                  {t('invoice.downloadPdf')}
                </a>
                <a
                  href={`/api/v1/sales-invoices/${invoice.id}/ubl`}
                  className="border-input rounded-md border px-4 py-2 text-sm"
                >
                  {t('invoice.downloadUbl')}
                </a>
              </>
            )}
          </>
        }
      />

      {isDraft && (
        <p className="border-border text-muted-foreground mb-6 rounded-md border border-dashed p-4 text-sm">
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

      <LedgerTable
        columns={columns}
        rows={invoice.lines}
        rowKey={(line) => String(line.lineNumber)}
        caption={t('invoice.lines')}
        empty={t('invoice.noLines')}
      />

      <div className="border-border mt-6 flex max-w-md justify-between gap-8 rounded-md border p-4 text-sm">
        <div className="space-y-1">
          <p className="text-muted-foreground">{t('invoice.subtotal')}</p>
          <p className="text-muted-foreground">{t('invoice.vat')}</p>
          <p className="font-medium">{t('report.total')}</p>
          {!isDraft && <p className="text-muted-foreground">{t('invoices.due')}</p>}
        </div>
        <div className="space-y-1 text-right">
          <Money amount={invoice.net} className="block" />
          <Money amount={invoice.tax} className="block" />
          <Money amount={invoice.total} className="block font-medium" />
          {!isDraft && <p className="tabular">{formatDate(invoice.dueDate)}</p>}
        </div>
      </div>

      {sentDocuments.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-medium">{t('invoice.sent')}</h2>
          {/* The evidence chain, on the screen. "Store the exact bytes sent"
              (spec 7.5) — the hash is how a reproduction is checked against
              what actually went out. */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th className="py-2 font-medium">{t('invoice.sentWhen')}</th>
                <th className="py-2 font-medium">{t('invoice.sentWhat')}</th>
                <th className="py-2 font-medium">{t('invoice.sentTo')}</th>
                <th className="py-2 font-medium">{t('invoice.sentVia')}</th>
                <th className="py-2 font-medium">{t('invoice.sentResult')}</th>
                <th className="py-2 font-medium">{t('invoice.sentDocument')}</th>
              </tr>
            </thead>
            <tbody>
              {sentDocuments.map((item) => (
                <tr key={item.id} className="border-border border-b">
                  <td className="tabular py-2">{item.sentAt.slice(0, 16).replace('T', ' ')}</td>
                  <td className="py-2">{item.stageLabel ?? t('invoice.title')}</td>
                  <td className="py-2">{item.recipient}</td>
                  <td className="text-muted-foreground py-2">{item.transport}</td>
                  <td className="py-2">
                    {item.delivered ? (
                      t('invoice.delivered')
                    ) : (
                      <span className="text-unreconciled">
                        {item.failure ?? t('invoice.notDelivered')}
                      </span>
                    )}
                  </td>
                  <td className="text-muted-foreground py-2 font-mono text-xs">
                    {item.documentHash === null ? '' : `${item.documentHash.slice(0, 12)}…`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    </>
  )
}
