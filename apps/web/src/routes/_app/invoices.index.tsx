import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { PageHeader } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import { listInvoices } from '~/server/sales'

/**
 * Verkoopfacturen.
 *
 * Status is in the URL rather than in component state so that "show me the
 * drafts" is a link somebody can bookmark and a back button can return to.
 */
type InvoiceStatus = 'draft' | 'issued' | 'cancelled'
const STATUSES: readonly InvoiceStatus[] = ['draft', 'issued', 'cancelled']

export const Route = createFileRoute('/_app/invoices/')({
  validateSearch: (search: Record<string, unknown>): { status: InvoiceStatus | undefined } => {
    const value = search['status']
    return {
      status: STATUSES.includes(value as InvoiceStatus) ? (value as InvoiceStatus) : undefined,
    }
  },
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ deps }) => listInvoices({ data: { status: deps.status ?? null, limit: 200 } }),
  component: Invoices,
})

interface Row {
  id: string
  kind: 'invoice' | 'credit_note'
  status: 'draft' | 'issued' | 'cancelled'
  number: string | null
  issueDate: string
  dueDate: string
  total: string
  currency: string
  contactNumber: string
  contactName: string
}

const FILTERS: readonly { value: InvoiceStatus | undefined; label: string }[] = [
  { value: undefined, label: 'Alles' },
  { value: 'draft', label: 'Concept' },
  { value: 'issued', label: 'Verstuurd' },
  { value: 'cancelled', label: 'Vervallen' },
]

const STATUS_LABEL: Record<Row['status'], string> = {
  draft: 'concept',
  issued: 'verstuurd',
  cancelled: 'vervallen',
}

function Invoices() {
  const result = Route.useLoaderData()
  const { status } = Route.useSearch()
  const navigate = useNavigate()

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Verkoopfacturen" />
        <p role="alert" className="text-destructive text-sm">
          {result.problem.detail}
        </p>
      </>
    )
  }

  const columns: readonly Column<Row>[] = [
    {
      key: 'number',
      header: 'Nummer',
      width: '9rem',
      cell: (row) => (
        <span className="tabular">
          {row.number ?? <span className="text-muted-foreground">concept</span>}
        </span>
      ),
    },
    {
      key: 'date',
      header: 'Datum',
      width: '7rem',
      cell: (row) => <span className="tabular">{formatDate(row.issueDate)}</span>,
    },
    { key: 'contact', header: 'Relatie', cell: (row) => row.contactName },
    {
      key: 'kind',
      header: 'Soort',
      width: '7rem',
      cell: (row) => (row.kind === 'credit_note' ? 'creditnota' : 'factuur'),
    },
    {
      key: 'status',
      header: 'Status',
      width: '7rem',
      cell: (row) => (
        <span className={row.status === 'draft' ? 'text-muted-foreground' : undefined}>
          {STATUS_LABEL[row.status]}
        </span>
      ),
    },
    {
      key: 'due',
      header: 'Vervalt',
      width: '7rem',
      cell: (row) => <span className="tabular">{formatDate(row.dueDate)}</span>,
    },
    {
      key: 'total',
      header: 'Totaal',
      width: '9rem',
      align: 'right',
      cell: (row) => <Money amount={row.total} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Verkoopfacturen"
        description="Een verstuurde factuur is definitief. Corrigeren gaat met een creditnota."
        actions={
          <Link
            to="/invoices/new"
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
          >
            Nieuwe factuur
          </Link>
        }
      />

      <nav aria-label="Filter" className="mb-4 flex gap-1">
        {FILTERS.map((filter) => (
          <Link
            key={filter.label}
            to="/invoices"
            search={{ status: filter.value }}
            className={
              status === filter.value
                ? 'bg-accent text-accent-foreground rounded-md px-3 py-1.5 text-sm font-medium'
                : 'hover:bg-accent/60 rounded-md px-3 py-1.5 text-sm'
            }
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      <LedgerTable
        columns={columns}
        rows={result.data.invoices}
        rowKey={(row) => row.id}
        onRowActivate={(row) => {
          void navigate({ to: '/invoices/$invoiceId', params: { invoiceId: row.id } })
        }}
        caption="Verkoopfacturen"
        empty="Nog geen facturen."
      />
    </>
  )
}
