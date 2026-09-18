import { Link, createFileRoute } from '@tanstack/react-router'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { formatDate } from '~/lib/format'
import { fiscalYearSearch } from '~/lib/fiscal-year'
import { getCreditorAgeing } from '~/server/purchase'

/**
 * Aged creditors.
 *
 * Bucketed by how *overdue* each invoice is, not by how old it is: an invoice on
 * sixty-day terms sent last month is not late, and an ageing report that says it
 * is teaches its reader to ignore it.
 *
 * The reconciliation at the top is the part an accountant looks for. Spec 9.2
 * wants the subledger checked against its control account as a scheduled job
 * with an alert on drift, and it is on the report as well because a bookkeeper
 * who cannot see the number will not trust the alert when it fires.
 */
export const Route = createFileRoute('/_app/reports/creditor-ageing')({
  validateSearch: (search: Record<string, unknown>): { asOf?: string; fiscalYear?: number } => ({
    ...(typeof search['asOf'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search['asOf'])
      ? { asOf: search['asOf'] }
      : {}),
    ...fiscalYearSearch(search),
  }),
  loaderDeps: ({ search }) => ({ asOf: search.asOf, fiscalYear: search.fiscalYear }),
  // With no date in the URL, the date the book year implies: today while that
  // year is running, its last day once it is over. Ageing a closed year as of
  // today would bucket every invoice in it as a year late.
  loader: async ({ deps }) =>
    getCreditorAgeing({
      data: {
        ...(deps.asOf === undefined ? {} : { asOf: deps.asOf }),
        ...(deps.fiscalYear === undefined ? {} : { fiscalYear: String(deps.fiscalYear) }),
      },
    }),
  component: CreditorAgeing,
})

const BUCKETS = [
  ['current', 'ageing.bucket.current'],
  ['upTo30', 'ageing.bucket.upTo30'],
  ['upTo60', 'ageing.bucket.upTo60'],
  ['upTo90', 'ageing.bucket.upTo90'],
  ['over90', 'ageing.bucket.over90'],
] as const satisfies readonly (readonly [string, MessageKey])[]

function CreditorAgeing() {
  const ageing = Route.useLoaderData()
  const { t } = useT()

  if (!ageing.ok) {
    return (
      <>
        <PageHeader title={t('ageing.title')} />
        <p role="alert" className="text-destructive text-sm">
          {ageing.problem.detail}
        </p>
      </>
    )
  }

  const data = ageing.data
  const asOf = data.asOf
  const columnTotal = (key: (typeof BUCKETS)[number][0]): bigint =>
    data.buckets.reduce((sum, bucket) => sum + BigInt(bucket[key]), 0n)

  return (
    <>
      <PageHeader
        title={t('ageing.title')}
        description={t('ageing.intro', { date: formatDate(asOf) })}
        actions={
          <Link to="/purchases" className="text-sm underline">
            {t('nav.purchases')}
          </Link>
        }
      />

      <div className="mb-8 flex flex-wrap gap-8">
        <Stat label={t('ageing.totalOutstanding')} value={<Money amount={data.total} />} />
        <Stat
          label={t('ageing.overdue')}
          value={
            <Money
              amount={(
                columnTotal('upTo30') +
                columnTotal('upTo60') +
                columnTotal('upTo90') +
                columnTotal('over90')
              ).toString()}
            />
          }
        />
        <Stat
          label={t('ageing.controlAccount', { account: data.payableAccountNumber })}
          value={<Money amount={data.reconciliation.controlAccount} />}
          hint={
            data.reconciliation.reconciles ? t('ageing.reconciles') : t('ageing.doesNotReconcile')
          }
          tone={data.reconciliation.reconciles ? 'good' : 'warn'}
        />
      </div>

      {!data.reconciliation.reconciles && (
        <p role="alert" className="text-destructive mb-6 max-w-3xl text-sm">
          {t('ageing.driftBefore')} <Money amount={data.reconciliation.subledger} />{' '}
          {t('ageing.driftMiddle')} <Money amount={data.reconciliation.controlAccount} />.{' '}
          {t('ageing.difference')} <Money amount={data.reconciliation.difference} />{' '}
          {t('ageing.driftAfter')}
        </p>
      )}

      <table className="border-border w-full max-w-5xl border-collapse text-sm">
        <caption className="sr-only">{t('ageing.caption')}</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="py-2 pr-2 font-medium">
              {t('ageing.supplier')}
            </th>
            {BUCKETS.map(([key, label]) => (
              <th key={key} scope="col" className="py-2 pr-2 text-right font-medium">
                {t(label)}
              </th>
            ))}
            <th scope="col" className="py-2 text-right font-medium">
              {t('report.total')}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.buckets.length === 0 && (
            <tr>
              <td colSpan={7} className="text-muted-foreground py-3">
                {t('ageing.empty')}
              </td>
            </tr>
          )}
          {data.buckets.map((bucket) => (
            <tr key={bucket.contactNumber} className="border-border/50 border-t">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                {bucket.contactName}
                <span className="text-muted-foreground tabular text-xs">
                  {' '}
                  {bucket.contactNumber}
                </span>
              </th>
              {BUCKETS.map(([key]) => (
                <td key={key} className="py-1.5 pr-2 text-right">
                  <Money amount={bucket[key]} />
                </td>
              ))}
              <td className="py-1.5 text-right font-medium">
                <Money amount={bucket.total} />
              </td>
            </tr>
          ))}
        </tbody>
        {data.buckets.length > 0 && (
          <tfoot>
            <tr className="border-border border-t font-medium">
              <th scope="row" className="py-2 pr-2 text-left">
                {t('report.total')}
              </th>
              {BUCKETS.map(([key]) => (
                <td key={key} className="py-2 pr-2 text-right">
                  <Money amount={columnTotal(key).toString()} />
                </td>
              ))}
              <td className="py-2 text-right">
                <Money amount={data.total} />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </>
  )
}
