import { createFileRoute, Link } from '@tanstack/react-router'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
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

export const Route = createFileRoute('/')({
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

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Boekjaar ${YEAR}. De drie getallen die zeggen of de boeken kloppen.`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Proefbalans"
          value={trial.ok ? <Money amount={trial.data.difference} /> : '—'}
          hint={
            trial.ok && trial.data.difference === '0'
              ? 'Debet en credit zijn gelijk.'
              : 'Verschil tussen debet en credit.'
          }
          tone={trial.ok && trial.data.difference === '0' ? 'good' : 'warn'}
        />

        <Stat
          label="Hash-keten"
          value={chain.ok ? (chain.data.verified ? 'Geverifieerd' : 'Gebroken') : '—'}
          hint={
            chain.ok
              ? `${String(chain.data.entryCount)} posten. Kop: ${chain.data.headHash?.slice(0, 12) ?? '—'}…`
              : undefined
          }
          tone={chain.ok && chain.data.verified ? 'good' : 'warn'}
        />

        <Stat
          label="RGS-dekking"
          value={coverage.ok ? `${String(coverage.data.mappedPercentage)}%` : '—'}
          hint={
            coverage.ok
              ? `${String(coverage.data.mappedCount)} van ${String(coverage.data.accountCount)} rekeningen gekoppeld aan RGS ${coverage.data.version}`
              : undefined
          }
          tone={coverage.ok && coverage.data.unmappedCount === 0 ? 'good' : 'warn'}
        />
      </div>

      {coverage.ok && coverage.data.unmappedCount > 0 && (
        <section className="border-border mt-6 rounded-md border p-4">
          <h2 className="font-medium">Niet-gekoppelde rekeningen</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Deze rekeningen komen niet voor in een RGS-rapportage of in de auditfile.
          </p>
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
            Koppelingen bijwerken
          </Link>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-medium">Je gegevens verlaten Klopt wanneer je wilt</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Een volledige XAF 3.2-auditfile met RGS-codes, gevalideerd tegen het gepubliceerde schema.
        </p>
        <a
          href={`/api/v1/exports/audit-file?fiscalYear=${YEAR}`}
          className="border-input mt-3 inline-block rounded-md border px-3 py-2 text-sm font-medium"
        >
          Auditfile downloaden
        </a>
      </section>
    </>
  )
}
