import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { PageHeader } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { ShortcutFooter, ShortcutPanel, StepBadge } from '~/components/ui/keycap'
import { Money } from '~/components/finance/money'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
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

const FILTERS: readonly { value: InvoiceStatus | undefined; key: MessageKey }[] = [
  { value: undefined, key: 'invoices.filter.all' },
  { value: 'draft', key: 'invoices.filter.draft' },
  { value: 'issued', key: 'invoices.filter.issued' },
  { value: 'cancelled', key: 'invoices.filter.cancelled' },
]

const STATUS_KEY: Record<Row['status'], MessageKey> = {
  draft: 'invoices.status.draft',
  issued: 'invoices.status.issued',
  cancelled: 'invoices.status.cancelled',
}

function Invoices() {
  const result = Route.useLoaderData()
  const { status } = Route.useSearch()
  const navigate = useNavigate()
  const { t } = useT()

  if (!result.ok) {
    return (
      <>
        <PageHeader title={t('invoices.title')} />
        <p role="alert" className="text-destructive text-sm">
          {result.problem.detail}
        </p>
      </>
    )
  }

  const columns: readonly Column<Row>[] = [
    {
      key: 'number',
      header: t('invoices.number'),
      width: '9rem',
      cell: (row) => (
        <span className="tabular">
          {row.number ?? (
            <span className="text-muted-foreground">{t('invoices.status.draft')}</span>
          )}
        </span>
      ),
    },
    {
      key: 'date',
      header: t('invoices.date'),
      width: '7rem',
      cell: (row) => <span className="tabular">{formatDate(row.issueDate)}</span>,
    },
    { key: 'contact', header: t('invoices.contact'), cell: (row) => row.contactName },
    {
      key: 'kind',
      header: t('invoices.kind'),
      width: '7rem',
      cell: (row) =>
        row.kind === 'credit_note' ? t('invoices.kind.creditNote') : t('invoices.kind.invoice'),
    },
    {
      key: 'status',
      header: t('invoices.status'),
      width: '7rem',
      cell: (row) => (
        <span className={row.status === 'draft' ? 'text-muted-foreground' : undefined}>
          {t(STATUS_KEY[row.status])}
        </span>
      ),
    },
    {
      key: 'due',
      header: t('invoices.due'),
      width: '7rem',
      cell: (row) => <span className="tabular">{formatDate(row.dueDate)}</span>,
    },
    {
      key: 'total',
      header: t('report.total'),
      width: '9rem',
      align: 'right',
      cell: (row) => <Money amount={row.total} />,
    },
  ]

  return (
    <>
      <PageHeader
        title={t('invoices.title')}
        description={t('invoices.intro')}
        actions={
          <Link
            to="/invoices/new"
            className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
          >
            {t('invoices.new')}
          </Link>
        }
      />

      <nav aria-label={t('invoices.filter')} className="mb-4 flex gap-1">
        {FILTERS.map((filter) => (
          <Link
            key={filter.key}
            to="/invoices"
            search={{ status: filter.value }}
            className={
              status === filter.value
                ? 'bg-accent text-accent-foreground px-3 py-1.5 text-sm font-medium'
                : 'hover:bg-accent/60 px-3 py-1.5 text-sm'
            }
          >
            {t(filter.key)}
          </Link>
        ))}
      </nav>

      <div className="mb-2">
        <StepBadge step={1}>{t('invoices.stepList')}</StepBadge>
      </div>

      <LedgerTable
        columns={columns}
        rows={result.data.invoices}
        rowKey={(row) => row.id}
        onRowActivate={(row) => {
          void navigate({ to: '/invoices/$invoiceId', params: { invoiceId: row.id } })
        }}
        caption={t('invoices.title')}
        empty={t('invoices.empty')}
      />

      {/* The list keys, and the one that starts a new invoice. `n` is a prefix
          in this application — `n` then `f` — so that is what is printed: a
          screen that promised a bare `n` would be promising a key the global
          handler takes first. */}
      <ShortcutFooter ids={['list.next', 'list.previous', 'list.open', 'new.invoice']} />

      <ShortcutPanel
        ids={[
          'list.next',
          'list.previous',
          'list.open',
          'new.invoice',
          'list.selectAll',
          'list.copy',
        ]}
      />
    </>
  )
}
