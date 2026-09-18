import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { PageHeader } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { useT } from '~/i18n/provider'
import { formatDate } from '~/lib/format'
import { listEntries } from '~/server/ledger'

export const Route = createFileRoute('/_app/entries/')({
  loader: async () => listEntries({ data: { limit: 100 } }),
  component: Entries,
})

interface Row {
  id: string
  chainSequence: string
  entryNumber: number
  bookingDate: string
  description: string
  hash: string
}

function Entries() {
  const result = Route.useLoaderData()
  const navigate = useNavigate()
  const { t } = useT()
  if (!result.ok) return <p className="text-destructive">{result.problem.detail}</p>

  const columns: readonly Column<Row>[] = [
    {
      key: 'seq',
      header: '#',
      width: '4rem',
      cell: (row) => <span className="tabular text-muted-foreground">{row.chainSequence}</span>,
    },
    {
      key: 'number',
      header: t('entries.number'),
      width: '5rem',
      cell: (row) => <span className="tabular">{String(row.entryNumber)}</span>,
    },
    {
      key: 'date',
      header: t('entries.bookingDate'),
      width: '8rem',
      cell: (row) => <span className="tabular">{formatDate(row.bookingDate)}</span>,
    },
    { key: 'desc', header: t('entries.description'), cell: (row) => row.description },
    {
      key: 'hash',
      header: t('entries.hash'),
      width: '9rem',
      // Shown on the list on purpose: the chain is the product's tamper
      // evidence, and evidence you have to go looking for is evidence nobody
      // checks.
      cell: (row) => (
        <span className="text-muted-foreground tabular text-xs">{row.hash.slice(0, 12)}…</span>
      ),
    },
  ]

  return (
    <>
      <PageHeader title={t('entries.title')} description={t('entries.intro')} />
      <LedgerTable
        columns={columns}
        rows={result.data.entries}
        rowKey={(row) => row.id}
        onRowActivate={(row) => {
          void navigate({ to: '/entries/$entryId', params: { entryId: row.id } })
        }}
        caption={t('entries.title')}
        empty={t('entries.empty')}
      />
    </>
  )
}
