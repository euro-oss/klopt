import { Link, createFileRoute } from '@tanstack/react-router'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { formatDate } from '~/lib/format'
import { DEBTOR_AGEING_BUCKETS, debtorAgeing } from '~/lib/ageing'
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
  validateSearch: (search: Record<string, unknown>): { asOf?: string } =>
    typeof search['asOf'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search['asOf'])
      ? { asOf: search['asOf'] }
      : {},
  loaderDeps: ({ search }) => ({ asOf: search.asOf }),
  loader: async ({ deps }) =>
    listOverdueInvoices({ data: deps.asOf === undefined ? {} : { asOf: deps.asOf } }),
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

  return (
    <>
      <PageHeader
        title={t('debtorAgeing.title')}
        description={t('debtorAgeing.intro', { date: formatDate(asOf) })}
        actions={
          <Link to="/dunning" className="border-input rounded-md border px-3 py-1.5 text-sm">
            {t('nav.dunning')}
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap gap-8">
        <Stat label={t('debtorAgeing.overdue')} value={<Money amount={totalOutstanding} />} />
        <Stat label={t('debtorAgeing.invoices')} value={String(invoices.length)} />
        <Stat
          label={t('debtorAgeing.over90')}
          value={<Money amount={ageing.totals.over90} />}
          tone={ageing.totals.over90 === '0' ? 'neutral' : 'warn'}
        />
      </div>

      <p className="text-muted-foreground mb-6 max-w-3xl text-sm">{t('debtorAgeing.note')}</p>

      <table className="border-border w-full max-w-5xl border-collapse text-sm">
        <caption className="sr-only">{t('debtorAgeing.caption')}</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="py-2 pr-2 font-medium">
              {t('debtorAgeing.customer')}
            </th>
            {DEBTOR_AGEING_BUCKETS.map((bucket) => (
              <th key={bucket} scope="col" className="py-2 pr-2 text-right font-medium">
                {t(BUCKET_LABELS[bucket])}
              </th>
            ))}
            <th scope="col" className="py-2 text-right font-medium">
              {t('report.total')}
            </th>
          </tr>
        </thead>
        <tbody>
          {ageing.rows.length === 0 && (
            <tr>
              <td colSpan={6} className="text-muted-foreground py-3">
                {t('debtorAgeing.empty')}
              </td>
            </tr>
          )}
          {ageing.rows.map((row) => (
            <tr key={row.contactName} className="border-border/50 border-t">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                {row.contactName}
                <span className="text-muted-foreground tabular text-xs">
                  {' '}
                  {t('debtorAgeing.oldest', { days: String(row.oldestDays) })}
                </span>
              </th>
              {DEBTOR_AGEING_BUCKETS.map((bucket) => (
                <td key={bucket} className="py-1.5 pr-2 text-right">
                  <Money amount={row[bucket]} muteZero />
                </td>
              ))}
              <td className="py-1.5 text-right font-medium">
                <Money amount={row.total} />
              </td>
            </tr>
          ))}
        </tbody>
        {ageing.rows.length > 0 && (
          <tfoot>
            <tr className="border-border border-t font-medium">
              <th scope="row" className="py-2 pr-2 text-left">
                {t('report.total')}
              </th>
              {DEBTOR_AGEING_BUCKETS.map((bucket) => (
                <td key={bucket} className="py-2 pr-2 text-right">
                  <Money amount={ageing.totals[bucket]} />
                </td>
              ))}
              <td className="py-2 text-right">
                <Money amount={ageing.totals.total} />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </>
  )
}
