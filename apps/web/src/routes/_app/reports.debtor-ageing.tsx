import { Link, createFileRoute } from '@tanstack/react-router'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { Button } from '~/components/ui/button'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { formatDate } from '~/lib/format'
import { DEBTOR_AGEING_BUCKETS, debtorAgeing, type DebtorAgeingRow } from '~/lib/ageing'
import { fiscalYearSearch } from '~/lib/fiscal-year'
import { listOverdueInvoices } from '~/server/sales'

/**
 * Aged debtors — who owes us, and for how long.
 *
 * Crediteuren have had this screen since M4. Debiteuren had Aanmaningen,
 * which answers a different question: who to write to next, not what the
 * receivables position looks like. An accountant asks for both sides and this
 * was the missing one.
 *
 * Built on `GET /api/v1/reports/overdue-invoices`, which is the debtors
 * subledger already netted against what the bank has allocated. That report
 * only speaks about invoices that are *due*, so this one does too, and says
 * so rather than showing an empty "not yet due" column that would read as
 * "nobody owes us anything yet".
 *
 * The date is the one the shell's book year implies: today while that year is
 * running, its last day once it is over.
 */
export const Route = createFileRoute('/_app/reports/debtor-ageing')({
  validateSearch: (search: Record<string, unknown>): { asOf?: string; fiscalYear?: number } => ({
    ...(typeof search['asOf'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search['asOf'])
      ? { asOf: search['asOf'] }
      : {}),
    ...fiscalYearSearch(search),
  }),
  loaderDeps: ({ search }) => ({ asOf: search.asOf, fiscalYear: search.fiscalYear }),
  loader: async ({ deps }) =>
    listOverdueInvoices({
      data: {
        ...(deps.asOf === undefined ? {} : { asOf: deps.asOf }),
        ...(deps.fiscalYear === undefined ? {} : { fiscalYear: String(deps.fiscalYear) }),
      },
    }),
  component: DebtorAgeing,
})

const BUCKET_LABELS = {
  upTo30: 'ageing.bucket.upTo30',
  upTo60: 'ageing.bucket.upTo60',
  upTo90: 'ageing.bucket.upTo90',
  over90: 'ageing.bucket.over90',
} as const satisfies Record<(typeof DEBTOR_AGEING_BUCKETS)[number], MessageKey>

function DebtorAgeing() {
  const result = Route.useLoaderData()
  const { t } = useT()

  if (!result.ok) {
    return (
      <>
        <PageHeader title={t('debtorAgeing.title')} />
        <p role="alert" className="text-destructive text-sm">
          {result.problem.detail}
        </p>
      </>
    )
  }

  const { asOf, invoices, totalOutstanding } = result.data
  const ageing = debtorAgeing(invoices)

  const columns: readonly Column<DebtorAgeingRow>[] = [
    {
      key: 'customer',
      header: t('debtorAgeing.customer'),
      cell: (row) => (
        <>
          {row.contactName}
          <span className="text-muted-foreground tabular ml-2 text-xs">
            {t('debtorAgeing.oldest', { days: String(row.oldestDays) })}
          </span>
        </>
      ),
    },
    ...DEBTOR_AGEING_BUCKETS.map((bucket) => ({
      key: bucket,
      header: t(BUCKET_LABELS[bucket]),
      align: 'right' as const,
      width: '9rem',
      cell: (row: DebtorAgeingRow) => <Money amount={row[bucket]} muteZero />,
    })),
    {
      key: 'total',
      header: t('report.total'),
      align: 'right',
      width: '9rem',
      cell: (row) => <Money amount={row.total} />,
    },
  ]

  return (
    <>
      <PageHeader
        title={t('debtorAgeing.title')}
        description={t('debtorAgeing.intro', { date: formatDate(asOf) })}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/dunning">{t('nav.dunning')}</Link>
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap gap-8">
        <Stat label={t('debtorAgeing.overdue')} value={<Money amount={totalOutstanding} />} />
        <Stat label={t('debtorAgeing.invoices')} value={String(invoices.length)} />
        {/* Red rather than the attention colour: money more than ninety days
            late is not something to look at, it is something that has gone
            wrong. */}
        <Stat
          label={t('debtorAgeing.over90')}
          value={<Money amount={ageing.totals.over90} />}
          tone={ageing.totals.over90 === '0' ? 'neutral' : 'bad'}
        />
      </div>

      <p className="text-muted-foreground mb-6 max-w-3xl text-sm">{t('debtorAgeing.note')}</p>

      {/* The house table, not a second one written by hand: rows that are
          focusable, a caption a screen reader reads, and `Cmd`+`C` into a
          spreadsheet all come with it. */}
      <LedgerTable
        columns={columns}
        rows={ageing.rows}
        rowKey={(row) => row.contactName}
        caption={t('debtorAgeing.caption')}
        empty={t('debtorAgeing.empty')}
        footer={
          <tr>
            <td className="px-3 py-2">{t('report.total')}</td>
            {DEBTOR_AGEING_BUCKETS.map((bucket) => (
              <td key={bucket} className="px-3 py-2 text-right">
                <Money amount={ageing.totals[bucket]} />
              </td>
            ))}
            <td className="px-3 py-2 text-right">
              <Money amount={ageing.totals.total} />
            </td>
          </tr>
        }
      />
    </>
  )
}
