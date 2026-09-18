import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { useT } from '~/i18n/provider'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { fiscalYearSearch } from '~/lib/fiscal-year'
import { getTrialBalance } from '~/server/ledger'

/** The book year comes from the URL, or from the shell. See `reports.balance-sheet`. */
export const Route = createFileRoute('/_app/reports/trial-balance')({
  validateSearch: fiscalYearSearch,
  loaderDeps: ({ search }) => ({ fiscalYear: search.fiscalYear }),
  loader: async ({ deps }) =>
    getTrialBalance({
      data: deps.fiscalYear === undefined ? {} : { fiscalYear: String(deps.fiscalYear) },
    }),
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
  const { t } = useT()
  if (!result.ok) return <p className="text-destructive">{result.problem.detail}</p>
  const report = result.data

  const columns: readonly Column<Row>[] = [
    {
      key: 'number',
      header: t('trial.account'),
      width: '5rem',
      cell: (row) => <span className="font-mono">{row.accountNumber}</span>,
    },
    { key: 'name', header: t('accounts.description'), cell: (row) => row.accountName },
    {
      key: 'rgs',
      header: 'RGS',
      width: '8rem',
      cell: (row) => <span className="font-mono text-xs">{row.rgsCode ?? '—'}</span>,
    },
    {
      key: 'opening',
      header: t('trial.opening'),
      align: 'right',
      cell: (row) => <Money amount={row.openingBalance} muteZero />,
    },
    {
      key: 'debit',
      header: t('trial.debit'),
      align: 'right',
      cell: (row) => <Money amount={row.debit} format={{ negative: 'minus', showZero: false }} />,
    },
    {
      key: 'credit',
      header: t('trial.credit'),
      align: 'right',
      cell: (row) => <Money amount={row.credit} format={{ negative: 'minus', showZero: false }} />,
    },
    {
      key: 'closing',
      header: t('trial.closing'),
      align: 'right',
      cell: (row) => <Money amount={row.closingBalance} muteZero />,
    },
  ]

  return (
    <>
      <PageHeader
        title={t('trial.title')}
        description={t('trial.intro', {
          year: report.fiscalYear,
          from: String(report.fromPeriod),
          to: String(report.toPeriod),
        })}
      />
      <LedgerTable
        columns={columns}
        rows={report.lines}
        rowKey={(row) => row.accountNumber}
        caption={t('trial.title')}
        empty={t('trial.empty')}
        footer={
          <tr>
            <td colSpan={3} className="px-3 py-2">
              {t('report.total')}
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
