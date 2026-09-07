import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { PageHeader, Stat } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { listPurchaseInvoices } from '~/server/purchase'

/**
 * Inkoopfacturen — what suppliers have sent us.
 *
 * The list leads with what is waiting for somebody: drafts nobody has booked
 * and booked invoices nobody has approved. An accounts-payable screen that
 * sorts by date and says nothing about who is holding things up is a list, not
 * a worklist.
 */
export const Route = createFileRoute('/_app/purchases/')({
  validateSearch: (search: Record<string, unknown>): { status?: string; open?: boolean } => ({
    ...(typeof search['status'] === 'string' ? { status: search['status'] } : {}),
    ...(search['open'] === true || search['open'] === 'true' ? { open: true } : {}),
  }),
  loaderDeps: ({ search }) => ({ status: search.status, open: search.open }),
  loader: async ({ deps }) => ({
    filter: { status: deps.status, open: deps.open === true },
    invoices: await listPurchaseInvoices({
      data: {
        ...(deps.status === undefined ? {} : { status: deps.status }),
        ...(deps.open === true ? { openOnly: true } : {}),
      },
    }),
  }),
  component: PurchaseInvoices,
})

interface Row {
  id: string
  status: 'draft' | 'booked' | 'approved' | 'disputed' | 'cancelled'
  statusLabel: string
  kind: 'invoice' | 'credit_note'
  supplierInvoiceNumber: string
  contactNumber: string
  contactName: string
  invoiceDate: string
  dueDate: string
  total: string
  outstanding: string
  scheduled: string
  payable: boolean
  disputedReason: string | null
}

const FILTERS = [
  { label: 'Alles', status: undefined, open: false },
  { label: 'Concepten', status: 'draft', open: false },
  { label: 'Wacht op fiat', status: 'booked', open: false },
  { label: 'Openstaand', status: undefined, open: true },
  { label: 'In geschil', status: 'disputed', open: false },
] as const

function PurchaseInvoices() {
  const { invoices, filter } = Route.useLoaderData()
  const navigate = useNavigate()
  const hydrated = useHydrated()

  if (!invoices.ok) {
    return (
      <>
        <PageHeader title="Inkoopfacturen" />
        <p role="alert" className="text-destructive text-sm">
          {invoices.problem.detail}
        </p>
      </>
    )
  }

  const rows = invoices.data.invoices
  const today = new Date().toISOString().slice(0, 10)
  const overdue = rows.filter(
    (row) => row.outstanding !== '0' && row.dueDate < today && row.status !== 'cancelled',
  )

  const columns: readonly Column<Row>[] = [
    {
      key: 'number',
      header: 'Factuurnr.',
      width: '11rem',
      cell: (row) => (
        <Link
          to="/purchases/$invoiceId"
          params={{ invoiceId: row.id }}
          className="tabular underline-offset-2 hover:underline"
        >
          {row.supplierInvoiceNumber}
        </Link>
      ),
    },
    {
      key: 'supplier',
      header: 'Leverancier',
      cell: (row) => (
        <span>
          {row.contactName}
          <span className="text-muted-foreground tabular text-xs"> {row.contactNumber}</span>
        </span>
      ),
    },
    {
      key: 'date',
      header: 'Factuurdatum',
      width: '9rem',
      cell: (row) => <span className="tabular">{formatDate(row.invoiceDate)}</span>,
    },
    {
      key: 'due',
      header: 'Vervaldatum',
      width: '9rem',
      cell: (row) => (
        <span
          className={
            row.outstanding !== '0' && row.dueDate < today ? 'text-destructive tabular' : 'tabular'
          }
        >
          {formatDate(row.dueDate)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '11rem',
      cell: (row) => (
        <span
          className={
            row.status === 'disputed'
              ? 'text-destructive'
              : row.status === 'booked'
                ? 'text-unreconciled'
                : undefined
          }
          title={row.disputedReason ?? undefined}
        >
          {row.kind === 'credit_note' ? `creditnota · ${row.statusLabel}` : row.statusLabel}
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Totaal',
      width: '9rem',
      align: 'right',
      cell: (row) => <Money amount={row.total} />,
    },
    {
      key: 'outstanding',
      header: 'Openstaand',
      width: '11rem',
      align: 'right',
      // Still openstaand, and already in a batch: the money has not moved, so
      // the ageing is right to keep counting it, but nobody should wonder why
      // it stopped turning up in the betaalrun.
      cell: (row) => (
        <>
          <Money amount={row.outstanding} />
          {row.scheduled !== '0' && (
            <span className="text-muted-foreground block text-xs">ingepland</span>
          )}
        </>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Inkoopfacturen"
        description="Wat leveranciers hebben gestuurd. De bedragen zijn die van hun document — wij rekenen ze na, we rekenen ze niet uit."
        actions={
          <Link
            to="/purchases/new"
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
          >
            Factuur invoeren
          </Link>
        }
      />

      <div className="mb-8 flex flex-wrap gap-8">
        <Stat label="Concepten" value={String(invoices.data.drafts)} />
        <Stat
          label="Wacht op fiat"
          value={String(invoices.data.awaitingApproval)}
          tone={invoices.data.awaitingApproval > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Te laat"
          value={String(overdue.length)}
          tone={overdue.length > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Nog te betalen"
          value={
            <Money
              amount={rows
                .filter((row) => row.status !== 'cancelled' && row.status !== 'draft')
                .reduce((sum, row) => sum + BigInt(row.outstanding), 0n)
                .toString()}
            />
          }
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((option) => {
          const active =
            (option.status ?? undefined) === filter.status && option.open === filter.open
          return (
            <button
              key={option.label}
              type="button"
              disabled={!hydrated}
              onClick={() => {
                void navigate({
                  to: '/purchases',
                  search: {
                    ...(option.status === undefined ? {} : { status: option.status }),
                    ...(option.open ? { open: true } : {}),
                  },
                })
              }}
              className={
                active
                  ? 'bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm'
                  : 'border-input rounded-md border px-3 py-1.5 text-sm disabled:opacity-50'
              }
            >
              {option.label}
            </button>
          )
        })}
        <Link
          to="/reports/creditor-ageing"
          className="border-input ml-auto rounded-md border px-3 py-1.5 text-sm"
        >
          Ouderdomsanalyse
        </Link>
      </div>

      <LedgerTable
        caption="Inkoopfacturen"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty="Geen inkoopfacturen."
      />
    </>
  )
}
