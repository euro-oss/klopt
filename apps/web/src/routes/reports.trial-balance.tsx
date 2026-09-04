import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { getTrialBalance } from '~/server/ledger'

const YEAR = String(new Date().getFullYear())

export const Route = createFileRoute('/reports/trial-balance')({
  loader: async () => getTrialBalance({ data: { fiscalYear: YEAR } }),
  component: TrialBalance,
})

interface Row {
  accountNumber: string
  accountName: string
  rgsCode: string | null
  openingBalance: string
  debit: string
  credit: string
  closingBalance: string
}

function TrialBalance() {
  const result = Route.useLoaderData()
  if (!result.ok) return <p className="text-destructive">{result.problem.detail}</p>
  const report = result.data

  const columns: readonly Column<Row>[] = [
    {
      key: 'number',
      header: 'Rek.',
      width: '5rem',
      cell: (row) => <span className="font-mono">{row.accountNumber}</span>,
    },
    { key: 'name', header: 'Omschrijving', cell: (row) => row.accountName },
    {
      key: 'rgs',
      header: 'RGS',
      width: '8rem',
      cell: (row) => <span className="font-mono text-xs">{row.rgsCode ?? '—'}</span>,
    },
    {
      key: 'opening',
      header: 'Beginsaldo',
      align: 'right',
      cell: (row) => <Money amount={row.openingBalance} muteZero />,
    },
    {
      key: 'debit',
      header: 'Debet',
      align: 'right',
      cell: (row) => <Money amount={row.debit} format={{ negative: 'minus', showZero: false }} />,
    },
    {
      key: 'credit',
      header: 'Credit',
      align: 'right',
      cell: (row) => <Money amount={row.credit} format={{ negative: 'minus', showZero: false }} />,
    },
    {
      key: 'closing',
      header: 'Eindsaldo',
      align: 'right',
      cell: (row) => <Money amount={row.closingBalance} muteZero />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Proefbalans"
        description={`Boekjaar ${report.fiscalYear}, periode ${String(report.fromPeriod)} tot en met ${String(report.toPeriod)}.`}
      />
      <LedgerTable
        columns={columns}
        rows={report.lines}
        rowKey={(row) => row.accountNumber}
        caption="Proefbalans"
        empty="Nog geen boekingen in dit boekjaar."
        footer={
          <tr>
            <td colSpan={3} className="px-3 py-2">
              Totaal
            </td>
            <td />
            <td className="px-3 py-2 text-right">
              <Money amount={report.totalDebit} />
            </td>
            <td className="px-3 py-2 text-right">
              <Money amount={report.totalCredit} />
            </td>
            <td className="px-3 py-2 text-right">
              {/* Zero, always. Shown rather than hidden: a non-zero here means
                  the ledger is corrupt and an accountant needs to see it. */}
              <Money amount={report.difference} />
            </td>
          </tr>
        }
      />
    </>
  )
}
