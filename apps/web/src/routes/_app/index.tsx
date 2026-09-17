import { createFileRoute, Link } from '@tanstack/react-router'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { useT } from '~/i18n/provider'
import { getRgsCoverage, getTrialBalance, verifyChain } from '~/server/ledger'

/**
 * The dashboard.
 *
 * "Treat unmapped accounts as a first-class health metric on the dashboard, not
 * a settings screen nobody visits" (spec 7.1). So RGS coverage is here, next to
 * the two other numbers that say whether the books are sound: does the trial
 * balance net to zero, and does the hash chain verify.
 */

const YEAR = String(new Date().getFullYear())

export const Route = createFileRoute('/_app/')({
  loader: async () => {
    const [coverage, trial, chain] = await Promise.all([
      getRgsCoverage({ data: {} }),
      getTrialBalance({ data: { fiscalYear: YEAR } }),
      verifyChain(),
    ])
    return { coverage, trial, chain }
  },
  component: Dashboard,
})

function Dashboard() {
  const { coverage, trial, chain } = Route.useLoaderData()
  const { t } = useT()

  return (
    <>
      <PageHeader title={t('dash.title')} description={t('dash.intro', { year: YEAR })} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label={t('dash.trialBalance')}
          value={trial.ok ? <Money amount={trial.data.difference} /> : '—'}
          hint={
            trial.ok && trial.data.difference === '0'
              ? t('dash.trialBalanceEqual')
              : t('dash.trialBalanceDifference')
          }
          tone={trial.ok && trial.data.difference === '0' ? 'good' : 'warn'}
        />

        <Stat
          label={t('dash.chain')}
          value={
            chain.ok ? (chain.data.verified ? t('dash.chainVerified') : t('dash.chainBroken')) : '—'
          }
          hint={
            chain.ok
              ? t('dash.chainHint', {
                  count: String(chain.data.entryCount),
                  head: chain.data.headHash?.slice(0, 12) ?? '—',
                })
              : undefined
          }
          tone={chain.ok && chain.data.verified ? 'good' : 'warn'}
        />

        <Stat
          label={t('dash.rgsCoverage')}
          value={coverage.ok ? `${String(coverage.data.mappedPercentage)}%` : '—'}
          hint={
            coverage.ok
              ? t('dash.rgsCoverageHint', {
                  mapped: String(coverage.data.mappedCount),
                  total: String(coverage.data.accountCount),
                  version: coverage.data.version,
                })
              : undefined
          }
          tone={coverage.ok && coverage.data.unmappedCount === 0 ? 'good' : 'warn'}
        />
      </div>

      {coverage.ok && coverage.data.unmappedCount > 0 && (
        <section className="border-border mt-6 rounded-md border p-4">
          <h2 className="font-medium">{t('dash.unmapped')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('dash.unmappedBody')}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {coverage.data.unmappedAccounts.map((accountNumber) => (
              <li
                key={accountNumber}
                className="bg-unreconciled/15 rounded px-2 py-1 font-mono text-xs"
              >
                {accountNumber}
              </li>
            ))}
          </ul>
          <Link to="/accounts" className="mt-3 inline-block text-sm underline">
            {t('dash.unmappedFix')}
          </Link>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-medium">{t('dash.exportTitle')}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('dash.exportBody')}</p>
        <a
          href={`/api/v1/exports/audit-file?fiscalYear=${YEAR}`}
          className="border-input mt-3 inline-block rounded-md border px-3 py-2 text-sm font-medium"
        >
          {t('dash.exportAction')}
        </a>
      </section>
    </>
  )
}
