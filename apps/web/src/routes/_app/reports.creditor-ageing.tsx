import { Link, createFileRoute } from '@tanstack/react-router'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
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
  validateSearch: (search: Record<string, unknown>): { asOf?: string } =>
    typeof search['asOf'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search['asOf'])
      ? { asOf: search['asOf'] }
      : {},
  loaderDeps: ({ search }) => ({ asOf: search.asOf }),
  loader: async ({ deps }) => {
    const asOf = deps.asOf ?? new Date().toISOString().slice(0, 10)
    return { asOf, ageing: await getCreditorAgeing({ data: { asOf } }) }
  },
  component: CreditorAgeing,
})

const BUCKETS = [
  ['current', 'Niet vervallen'],
  ['upTo30', '1–30 dagen'],
  ['upTo60', '31–60 dagen'],
  ['upTo90', '61–90 dagen'],
  ['over90', 'Meer dan 90'],
] as const

function CreditorAgeing() {
  const { ageing, asOf } = Route.useLoaderData()

  if (!ageing.ok) {
    return (
      <>
        <PageHeader title="Ouderdomsanalyse crediteuren" />
        <p role="alert" className="text-destructive text-sm">
          {ageing.problem.detail}
        </p>
      </>
    )
  }

  const data = ageing.data
  const columnTotal = (key: (typeof BUCKETS)[number][0]): bigint =>
    data.buckets.reduce((sum, bucket) => sum + BigInt(bucket[key]), 0n)

  return (
    <>
      <PageHeader
        title="Ouderdomsanalyse crediteuren"
        description={`Openstaande inkoopfacturen per ${formatDate(asOf)}, ingedeeld naar hoe lang ze te laat zijn.`}
        actions={
          <Link to="/purchases" className="text-sm underline">
            Inkoopfacturen
          </Link>
        }
      />

      <div className="mb-8 flex flex-wrap gap-8">
        <Stat label="Totaal openstaand" value={<Money amount={data.total} />} />
        <Stat
          label="Te laat"
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
          label={`Grootboek ${data.payableAccountNumber}`}
          value={<Money amount={data.reconciliation.controlAccount} />}
          hint={data.reconciliation.reconciles ? 'sluit aan' : 'wijkt af'}
          tone={data.reconciliation.reconciles ? 'good' : 'warn'}
        />
      </div>

      {!data.reconciliation.reconciles && (
        <p role="alert" className="text-destructive mb-6 max-w-3xl text-sm">
          De subadministratie telt op tot <Money amount={data.reconciliation.subledger} /> en de
          grootboekrekening staat op <Money amount={data.reconciliation.controlAccount} />. Het
          verschil van <Money amount={data.reconciliation.difference} /> betekent dat er op de
          crediteurenrekening is geboekt buiten een inkoopfactuur om, of dat een factuur is geboekt
          zonder de koppeling vast te leggen. Zoek het verschil voordat je op deze lijst afgaat.
        </p>
      )}

      <table className="border-border w-full max-w-5xl border-collapse text-sm">
        <caption className="sr-only">Openstaande bedragen per leverancier en ouderdom</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="py-2 pr-2 font-medium">
              Leverancier
            </th>
            {BUCKETS.map(([key, label]) => (
              <th key={key} scope="col" className="py-2 pr-2 text-right font-medium">
                {label}
              </th>
            ))}
            <th scope="col" className="py-2 text-right font-medium">
              Totaal
            </th>
          </tr>
        </thead>
        <tbody>
          {data.buckets.length === 0 && (
            <tr>
              <td colSpan={7} className="text-muted-foreground py-3">
                Geen openstaande inkoopfacturen.
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
                Totaal
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
