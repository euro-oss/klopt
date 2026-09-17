import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { purchaseStatusLabel } from '~/i18n/labels'
import type { PurchaseInvoiceStatus } from '@klopt/core'
import { PageHeader, Stat } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
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
  status: PurchaseInvoiceStatus
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
  { key: 'purchases.filter.all', status: undefined, open: false },
  { key: 'purchases.drafts', status: 'draft', open: false },
  { key: 'purchases.awaitingApproval', status: 'booked', open: false },
  { key: 'purchases.filter.open', status: undefined, open: true },
  { key: 'purchases.filter.disputed', status: 'disputed', open: false },
] as const satisfies readonly {
  key: MessageKey
  status: string | undefined
  open: boolean
}[]

function PurchaseInvoices() {
  const { invoices, filter } = Route.useLoaderData()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const { t } = useT()

  if (!invoices.ok) {
    return (
      <>
        <PageHeader title={t('purchases.title')} />
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
      header: t('purchases.invoiceNumber'),
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
      header: t('ageing.supplier'),
      cell: (row) => (
        <span>
          {row.contactName}
          <span className="text-muted-foreground tabular text-xs"> {row.contactNumber}</span>
        </span>
      ),
    },
    {
      key: 'date',
      header: t('purchases.invoiceDate'),
      width: '9rem',
      cell: (row) => <span className="tabular">{formatDate(row.invoiceDate)}</span>,
    },
    {
      key: 'due',
      header: t('purchases.dueDate'),
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
      header: t('invoices.status'),
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
          {row.kind === 'credit_note'
            ? `${t('invoices.kind.creditNote')} · ${purchaseStatusLabel(t, row.status)}`
            : purchaseStatusLabel(t, row.status)}
        </span>
      ),
    },
    {
      key: 'total',
      header: t('report.total'),
      width: '9rem',
      align: 'right',
      cell: (row) => <Money amount={row.total} />,
    },
    {
      key: 'outstanding',
      header: t('purchases.outstanding'),
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
        title={t('purchases.title')}
        description={t('purchases.intro')}
        actions={
          <Link
            to="/purchases/new"
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
          >
            {t('purchases.enter')}
          </Link>
        }
      />

      <div className="mb-8 flex flex-wrap gap-8">
        <Stat label={t('purchases.drafts')} value={String(invoices.data.drafts)} />
        <Stat
          label={t('purchases.awaitingApproval')}
          value={String(invoices.data.awaitingApproval)}
          tone={invoices.data.awaitingApproval > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label={t('purchases.overdue')}
          value={String(overdue.length)}
          tone={overdue.length > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label={t('purchases.stillToPay')}
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
              key={option.key}
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
              {t(option.key)}
            </button>
          )
        })}
        <Link
          to="/reports/creditor-ageing"
          className="border-input ml-auto rounded-md border px-3 py-1.5 text-sm"
        >
          {t('purchases.ageing')}
        </Link>
      </div>

      <LedgerTable
        caption={t('purchases.title')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty={t('purchases.empty')}
      />
    </>
  )
}
