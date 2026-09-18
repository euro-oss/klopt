import { createFileRoute, Link } from '@tanstack/react-router'
import { PageHeader } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { useT } from '~/i18n/provider'
import { formatDate } from '~/lib/format'
import { getEntry } from '~/server/ledger'

export const Route = createFileRoute('/_app/entries/$entryId')({
  loader: async ({ params }) => getEntry({ data: { entryId: params.entryId } }),
  component: EntryDetail,
})

function EntryDetail() {
  const result = Route.useLoaderData()
  const { t } = useT()
  if (!result.ok) return <p className="text-destructive">{result.problem.detail}</p>
  const entry = result.data.entry

  return (
    <>
      <PageHeader
        title={`${entry.journalCode} ${String(entry.entryNumber)}`}
        description={entry.description}
      />

      <dl className="mb-6 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground text-xs">{t('entry.bookingDate')}</dt>
          <dd className="tabular">{formatDate(entry.bookingDate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">{t('entry.documentDate')}</dt>
          <dd className="tabular">{formatDate(entry.documentDate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">{t('entry.period')}</dt>
          <dd className="tabular">
            {entry.fiscalYear}-{String(entry.period).padStart(2, '0')}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">{t('entry.postedBy')}</dt>
          <dd>
            {entry.actor.id}
            <span className="text-muted-foreground"> ({entry.actor.kind})</span>
          </dd>
        </div>
      </dl>

      <table className="border-border w-full border-collapse rounded-md border text-sm">
        <thead>
          <tr className="border-border bg-muted/50 border-b">
            <th scope="col" className="text-muted-foreground px-3 py-2 text-left font-medium">
              {t('trial.account')}
            </th>
            <th scope="col" className="text-muted-foreground px-3 py-2 text-left font-medium">
              {t('entries.description')}
            </th>
            <th scope="col" className="text-muted-foreground px-3 py-2 text-left font-medium">
              {t('entry.dimensions')}
            </th>
            <th scope="col" className="text-muted-foreground px-3 py-2 text-right font-medium">
              {t('trial.debit')}
            </th>
            <th scope="col" className="text-muted-foreground px-3 py-2 text-right font-medium">
              {t('trial.credit')}
            </th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((line) => (
            <tr key={line.lineNumber} className="border-border/60 border-b last:border-0">
              <td className="px-3 py-1.5 tabular">{line.accountNumber}</td>
              <td className="px-3 py-1.5">{line.description ?? ''}</td>
              <td className="px-3 py-1.5">
                {line.dimensions.map((dimension) => (
                  <span
                    key={dimension.type}
                    className="bg-muted mr-1 rounded px-1.5 py-0.5 text-xs"
                  >
                    {dimension.type}: {dimension.value}
                  </span>
                ))}
              </td>
              <td className="px-3 py-1.5 text-right">
                <Money amount={line.debit} format={{ negative: 'minus', showZero: false }} />
              </td>
              <td className="px-3 py-1.5 text-right">
                <Money amount={line.credit} format={{ negative: 'minus', showZero: false }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* The tamper evidence, on the face of the entry. An inspector can
          recompute this from an export and compare (spec 6.2). */}
      <section className="border-border mt-6 rounded-md border p-4">
        <h2 className="text-sm font-medium">{t('entry.chain')}</h2>
        <dl className="mt-2 space-y-1 tabular text-xs">
          <div className="flex gap-2">
            <dt className="text-muted-foreground w-24 shrink-0 font-sans">
              {t('entry.chainPosition')}
            </dt>
            <dd>{entry.chainSequence}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground w-24 shrink-0 font-sans">
              {t('entry.chainPrevious')}
            </dt>
            <dd className="break-all">{entry.previousHash ?? t('entry.chainFirst')}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground w-24 shrink-0 font-sans">
              {t('entry.chainThis')}
            </dt>
            <dd className="break-all">{entry.hash}</dd>
          </div>
        </dl>
      </section>

      {entry.reversesEntryId !== null && (
        <p className="text-muted-foreground mt-4 text-sm">
          {t('entry.reversalOf')}{' '}
          <Link
            to="/entries/$entryId"
            params={{ entryId: entry.reversesEntryId }}
            className="underline"
          >
            {t('entry.reversalOfLink')}
          </Link>
          .
        </p>
      )}
    </>
  )
}
