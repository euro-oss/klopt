import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { draftInvoice, getInvoice, issueInvoice } from '~/server/sales'

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
  loader: async ({ params }) => getInvoice({ data: { invoiceId: params.invoiceId } }),
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
  const result = Route.useLoaderData()
  const { invoiceId } = Route.useParams()
  const router = useRouter()
  const navigate = useNavigate()
  const hydrated = useHydrated()

  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<{ path: string | null; message: string }[]>([])
  const issueKey = useRef<string>(crypto.randomUUID())
  const creditKey = useRef<string>(crypto.randomUUID())

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Factuur" />
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
    { key: 'description', header: 'Omschrijving', cell: (line) => line.description },
    {
      key: 'quantity',
      header: 'Aantal',
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
      header: 'Prijs',
      width: '8rem',
      align: 'right',
      cell: (line) => <Money amount={line.unitPrice} />,
    },
    {
      key: 'account',
      header: 'Grootboek',
      width: '7rem',
      cell: (line) => <span className="tabular">{line.revenueAccountNumber}</span>,
    },
    {
      key: 'tax',
      header: 'Btw',
      width: '7rem',
      cell: (line) => `${line.taxCode} · ${line.ratePercent}%`,
    },
    {
      key: 'net',
      header: 'Netto',
      width: '9rem',
      align: 'right',
      cell: (line) => <Money amount={line.net} />,
    },
  ]

  const isDraft = invoice.status === 'draft'
  const title = invoice.number ?? 'Concept'

  return (
    <>
      <PageHeader
        title={`${invoice.kind === 'credit_note' ? 'Creditnota' : 'Factuur'} ${title}`}
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
                {busy ? 'Bezig…' : 'Versturen en boeken'}
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
                Crediteren
              </button>
            )}
            {!isDraft && (
              <a
                href={`/api/v1/sales-invoices/${invoice.id}/ubl`}
                className="border-input rounded-md border px-4 py-2 text-sm"
              >
                UBL downloaden
              </a>
            )}
          </>
        }
      />

      {isDraft && (
        <p className="border-border text-muted-foreground mb-6 rounded-md border border-dashed p-4 text-sm">
          Dit is een concept. Er is nog geen nummer uitgegeven en er is niets geboekt. Versturen is
          definitief: corrigeren gaat daarna met een creditnota.
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
        caption="Factuurregels"
        empty="Geen regels."
      />

      <div className="border-border mt-6 flex max-w-md justify-between gap-8 rounded-md border p-4 text-sm">
        <div className="space-y-1">
          <p className="text-muted-foreground">Subtotaal</p>
          <p className="text-muted-foreground">Btw</p>
          <p className="font-medium">Totaal</p>
          {!isDraft && <p className="text-muted-foreground">Vervalt</p>}
        </div>
        <div className="space-y-1 text-right">
          <Money amount={invoice.net} className="block" />
          <Money amount={invoice.tax} className="block" />
          <Money amount={invoice.total} className="block font-medium" />
          {!isDraft && <p className="tabular">{formatDate(invoice.dueDate)}</p>}
        </div>
      </div>

      {invoice.journalEntryId !== null && (
        <p className="text-muted-foreground mt-6 text-sm">
          Geboekt als{' '}
          <Link
            to="/entries/$entryId"
            params={{ entryId: invoice.journalEntryId }}
            className="underline"
          >
            journaalpost
          </Link>
          .
        </p>
      )}
    </>
  )
}
