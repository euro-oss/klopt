import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { formatDate } from '~/lib/format'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import {
  chooseMoneybirdAdministration,
  connectMoneybird,
  disconnectMoneybird,
  getMoneybirdConnection,
  listMoneybirdAdministrations,
  moneybirdImportStatus,
  previewMoneybirdImport,
  runMoneybirdImport,
  saveMoneybirdMappings,
} from '~/server/ledger'

/**
 * Overzetten uit Moneybird (issue #32).
 *
 * Same three steps as Exact, for the same reason: one personal API token
 * reaches every administration the user belongs to. Booked history is in the
 * dry-run report rather than a later XAF step — see ADR 0060.
 */
export const Route = createFileRoute('/_app/moneybird/')({
  loader: async () => ({
    connection: await getMoneybirdConnection(),
    run: await moneybirdImportStatus(),
  }),
  component: Moneybird,
})

interface AdministrationOption {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly currency: string | null
  readonly country: string | null
}

function Moneybird() {
  const { connection, run: runResult } = Route.useLoaderData()
  const { t } = useT()
  const router = useRouter()
  const hydrated = useHydrated()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [administrations, setAdministrations] = useState<readonly AdministrationOption[] | null>(
    null,
  )
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [imported, setImported] = useState<Record<string, unknown> | null>(null)
  const [apiToken, setApiToken] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://moneybird.com/api/v2')
  const [accountMappings, setAccountMappings] = useState<Record<string, string>>({})
  const [taxMappings, setTaxMappings] = useState<Record<string, string>>({})

  if (!connection.ok) {
    return (
      <>
        <PageHeader title={t('moneybird.title')} />
        <p role="alert" className="text-destructive text-sm">
          {connection.problem.detail}
        </p>
      </>
    )
  }

  const state = connection.data.connection
  const canStoreSecrets = connection.data.canStoreSecrets

  async function run(
    work: () => Promise<{ ok: boolean; problem?: { detail: string }; data?: unknown }>,
    onDone?: (data: unknown) => void,
  ) {
    setBusy(true)
    setError(null)
    setNote(null)
    const result = await work()
    setBusy(false)

    if (!result.ok) {
      setError(result.problem?.detail ?? t('common.unknownError'))
      return
    }
    onDone?.(result.data)
  }

  const connect = () =>
    run(
      () =>
        connectMoneybird({
          data: { baseUrl, apiToken, idempotencyKey: crypto.randomUUID() },
        }),
      () => void router.invalidate(),
    )

  const loadAdministrations = () =>
    run(listMoneybirdAdministrations, (data) => {
      setAdministrations(
        (data as { administrations: readonly AdministrationOption[] }).administrations,
      )
    })

  const choose = (id: string) =>
    run(
      () =>
        chooseMoneybirdAdministration({
          data: { administrationId: id, idempotencyKey: crypto.randomUUID() },
        }),
      (data) => {
        const chosen = data as { administrationName: string }
        setNote(t('moneybird.administrationChosen', { name: chosen.administrationName }))
        void router.invalidate()
      },
    )

  const runPreview = () =>
    run(previewMoneybirdImport, (data) => {
      const report = data as Record<string, unknown>
      setPreview(report)
      setImported(null)
      const accounts = (
        report['accounts'] as { sample: { moneybirdId: string; proposedNumber: string }[] }
      ).sample
      const nextAccounts: Record<string, string> = {}
      for (const account of accounts) {
        nextAccounts[account.moneybirdId] = account.proposedNumber
      }
      setAccountMappings(nextAccounts)
      const rates = report['taxRates'] as {
        moneybirdId: string
        proposedCode: string | null
        mappedCode: string | null
      }[]
      const nextTax: Record<string, string> = {}
      for (const rate of rates) {
        const code = rate.mappedCode ?? rate.proposedCode
        if (code !== null && code !== '') nextTax[rate.moneybirdId] = code
      }
      setTaxMappings(nextTax)
    })

  const saveMappings = () =>
    run(
      () =>
        saveMoneybirdMappings({
          data: {
            accountMappings,
            taxMappings,
            idempotencyKey: crypto.randomUUID(),
          },
        }),
      () => void runPreview(),
    )

  const commit = () =>
    run(
      () => runMoneybirdImport({ data: { idempotencyKey: crypto.randomUUID() } }),
      (data) => {
        setImported(data as Record<string, unknown>)
        void router.invalidate()
      },
    )

  return (
    <>
      <PageHeader
        title={t('moneybird.title')}
        description={t('moneybird.intro')}
        actions={
          state?.connected === true ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(disconnectMoneybird, () => void router.invalidate())}
              className="border-border rounded-md border px-3 py-1.5 text-sm"
            >
              {t('moneybird.disconnect')}
            </button>
          ) : undefined
        }
      />

      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}
      {note !== null && (
        <p role="status" className="mb-4 text-sm">
          {note}
        </p>
      )}

      {state === null || state.connected !== true ? (
        <section className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('moneybird.step1Connect')}</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">{t('moneybird.step1Intro')}</p>

          {!canStoreSecrets && (
            <p role="alert" className="text-destructive mb-4 text-sm">
              {t('moneybird.noEncryptionKey')}
            </p>
          )}

          <div className="grid max-w-2xl gap-3">
            <label className="text-sm">
              {t('moneybird.baseUrl')}
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                disabled={!hydrated}
                className="border-border mt-1 w-full rounded-md border px-2 py-1.5"
              />
            </label>
            <label className="text-sm">
              {t('moneybird.apiToken')}
              <input
                type="password"
                value={apiToken}
                onChange={(event) => setApiToken(event.target.value)}
                disabled={!hydrated}
                className="border-border mt-1 w-full rounded-md border px-2 py-1.5 tabular"
              />
            </label>
            <div>
              <button
                type="button"
                disabled={busy || !hydrated || !canStoreSecrets || apiToken === ''}
                onClick={() => void connect()}
                className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {t('moneybird.connect')}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('moneybird.step1Connected')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {state.administrationName ?? t('moneybird.unknownUser')} — {state.baseUrl}
            {state.lastImportAt !== null &&
              t('moneybird.lastImported', { date: formatDate(state.lastImportAt) })}
          </p>
          {state.lastError !== null && (
            <p role="alert" className="text-destructive mt-2 text-sm">
              {state.lastError}
            </p>
          )}
        </section>
      )}

      {state?.connected === true && (
        <section className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('moneybird.step2')}</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">{t('moneybird.step2Intro')}</p>

          {state.administrationId !== null && (
            <p className="mb-4 text-sm">
              {t('moneybird.chosen')} <strong>{state.administrationName}</strong> (
              {state.administrationId})
            </p>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => void loadAdministrations()}
            className="border-border rounded-md border px-3 py-1.5 text-sm"
          >
            {administrations === null
              ? t('moneybird.fetchAdministrations')
              : t('moneybird.fetchAgain')}
          </button>

          {administrations !== null && (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-border border-b text-left">
                  <th className="py-2">{t('moneybird.administration')}</th>
                  <th className="py-2">{t('moneybird.currency')}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {administrations.map((administration) => (
                  <tr key={administration.id} className="border-border border-b">
                    <td className="py-2">{administration.label}</td>
                    <td className="py-2 tabular">{administration.currency ?? '—'}</td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        disabled={busy || state.administrationId === administration.id}
                        onClick={() => void choose(administration.id)}
                        className="border-border rounded-md border px-2 py-1 text-xs disabled:opacity-50"
                      >
                        {state.administrationId === administration.id
                          ? t('moneybird.isChosen')
                          : t('moneybird.chooseThis')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {state?.ready === true && (
        <section className="border-border rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('moneybird.step3')}</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">{t('moneybird.step3Intro')}</p>

          <button
            type="button"
            disabled={busy}
            onClick={() => void runPreview()}
            className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? t('common.busy') : t('moneybird.runPreview')}
          </button>

          {preview !== null && (
            <>
              <PreviewReport report={preview} />
              <MappingReview
                report={preview}
                accountMappings={accountMappings}
                taxMappings={taxMappings}
                onAccountChange={(id, value) =>
                  setAccountMappings((current) => ({ ...current, [id]: value }))
                }
                onTaxChange={(id, value) =>
                  setTaxMappings((current) => ({ ...current, [id]: value }))
                }
                onSave={() => void saveMappings()}
                busy={busy}
                hydrated={hydrated}
              />
            </>
          )}
        </section>
      )}

      {state?.ready === true && preview !== null && (
        <section className="border-border mt-6 rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('moneybird.step4')}</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">{t('moneybird.step4Intro')}</p>
          {imported === null ? (
            <button
              type="button"
              disabled={busy || !hydrated}
              onClick={() => void commit()}
              className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? t('common.busy') : t('moneybird.commit')}
            </button>
          ) : (
            <ImportProgress result={imported} status={runResult} />
          )}
        </section>
      )}
    </>
  )
}

function MappingReview({
  report,
  accountMappings,
  taxMappings,
  onAccountChange,
  onTaxChange,
  onSave,
  busy,
  hydrated,
}: {
  report: Record<string, unknown>
  accountMappings: Record<string, string>
  taxMappings: Record<string, string>
  onAccountChange: (id: string, value: string) => void
  onTaxChange: (id: string, value: string) => void
  onSave: () => void
  busy: boolean
  hydrated: boolean
}) {
  const { t } = useT()
  const accounts = (report['accounts'] as { sample: AccountSample[] }).sample
  const taxRates = report['taxRates'] as TaxSample[]
  const unmapped =
    accounts.filter((account) => (accountMappings[account.moneybirdId] ?? '').trim() === '')
      .length +
    taxRates.filter((rate) => rate.used && (taxMappings[rate.moneybirdId] ?? '').trim() === '')
      .length

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-semibold">{t('moneybird.mapping')}</h3>
      <p className="text-muted-foreground mb-4 text-sm">
        {t('moneybird.mappingIntro')}
        {unmapped > 0 ? ` ${t('moneybird.unmappedCount', { count: String(unmapped) })}` : ''}
      </p>
      <table className="mb-4 w-full text-sm">
        <thead>
          <tr className="border-border border-b text-left">
            <th className="py-2">{t('moneybird.ledgerAccounts')}</th>
            <th className="py-2">{t('moneybird.kloptAccount')}</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.moneybirdId} className="border-border border-b">
              <td className="py-2">
                {account.number} — {account.name}
              </td>
              <td className="py-2">
                <input
                  value={accountMappings[account.moneybirdId] ?? account.proposedNumber}
                  onChange={(event) => onAccountChange(account.moneybirdId, event.target.value)}
                  disabled={!hydrated}
                  className="border-border w-32 rounded-md border px-2 py-1 tabular"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="mb-4 w-full text-sm">
        <thead>
          <tr className="border-border border-b text-left">
            <th className="py-2">{t('moneybird.taxRates')}</th>
            <th className="py-2">{t('moneybird.kloptTax')}</th>
          </tr>
        </thead>
        <tbody>
          {taxRates.map((rate) => (
            <tr key={rate.moneybirdId} className="border-border border-b">
              <td className="py-2">
                {rate.name} ({rate.percentage}%)
              </td>
              <td className="py-2">
                <input
                  value={
                    taxMappings[rate.moneybirdId] ?? rate.mappedCode ?? rate.proposedCode ?? ''
                  }
                  onChange={(event) => onTaxChange(rate.moneybirdId, event.target.value)}
                  disabled={!hydrated}
                  className="border-border w-32 rounded-md border px-2 py-1 tabular"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        disabled={busy || !hydrated}
        onClick={onSave}
        className="border-border rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {t('moneybird.saveMappings')}
      </button>
    </div>
  )
}

interface AccountSample {
  readonly moneybirdId: string
  readonly number: string
  readonly proposedNumber: string
  readonly name: string
}

interface TaxSample {
  readonly moneybirdId: string
  readonly name: string
  readonly percentage: string
  readonly proposedCode: string | null
  readonly mappedCode: string | null
  readonly used: boolean
}

function PreviewReport({ report }: { report: Record<string, unknown> }) {
  const { t } = useT()
  const counts = report['counts'] as Record<string, number>
  const years = (report['years'] as number[]) ?? []
  const reconciliation = (report['reconciliation'] as ReconciliationYear[]) ?? []
  const warnings = (report['warnings'] as { code: string; message: string }[]) ?? []
  const problems = (report['problems'] as { code: string; message: string }[]) ?? []
  const notImported = (report['notImported'] as string[]) ?? []
  const requests = (report['requests'] ?? []) as {
    path: string
    status: number
    rows: number
    durationMs: number
  }[]
  const first = reconciliation[0]

  return (
    <div className="mt-6">
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label={
            first === undefined
              ? t('moneybird.years')
              : t('moneybird.trialBalanceLabel', { year: String(first.year) })
          }
          value={
            first === undefined
              ? years.join(', ') || '—'
              : first.source === 'unreadable'
                ? t('moneybird.notRead')
                : first.source === 'empty'
                  ? t('moneybird.noBalances')
                  : first.balanced
                    ? t('moneybird.balances')
                    : t('moneybird.doesNotBalance')
          }
          tone={
            first === undefined || first.source !== 'read'
              ? 'muted'
              : first.balanced
                ? 'good'
                : 'warn'
          }
          hint={
            first?.source === 'read'
              ? t('moneybird.debitCredit', {
                  debit: first.totalDebit ?? '—',
                  credit: first.totalCredit ?? '—',
                })
              : t('moneybird.years') + ': ' + (years.join(', ') || '—')
          }
        />
        <Stat
          label={t('moneybird.ledgerAccounts')}
          value={counts['accounts'] ?? 0}
          hint={t('moneybird.contacts') + ': ' + String(counts['contacts'] ?? 0)}
        />
        <Stat
          label={t('moneybird.salesInvoices')}
          value={counts['salesInvoices'] ?? 0}
          hint={t('moneybird.purchaseInvoices') + ': ' + String(counts['purchaseInvoices'] ?? 0)}
        />
        <Stat
          label={t('moneybird.bankMutations')}
          value={counts['bankMutations'] ?? 0}
          hint={t('moneybird.documents') + ': ' + String(counts['documents'] ?? 0)}
        />
      </div>

      {problems.length > 0 && (
        <>
          <h3 className="text-destructive mb-2 text-sm font-semibold">
            {t('moneybird.blocking', { count: String(problems.length) })}
          </h3>
          <ul className="text-destructive mb-6 list-disc pl-5 text-sm">
            {problems.map((problem, index) => (
              <li key={`${problem.code}-${String(index)}`}>{problem.message}</li>
            ))}
          </ul>
        </>
      )}

      {warnings.length > 0 && (
        <>
          <h3 className="mb-2 text-sm font-semibold">
            {t('moneybird.warnings', { count: String(warnings.length) })}
          </h3>
          <ul className="text-muted-foreground mb-6 list-disc pl-5 text-sm">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${String(index)}`}>{warning.message}</li>
            ))}
          </ul>
        </>
      )}

      {notImported.length > 0 && (
        <>
          <h3 className="mb-2 text-sm font-semibold">{t('moneybird.notImported')}</h3>
          <ul className="text-muted-foreground mb-6 list-disc pl-5 text-sm">
            {notImported.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}

      {requests.length > 0 && (
        <details className="mb-6">
          <summary className="cursor-pointer text-sm font-semibold">
            {t('moneybird.requests', {
              count: String(requests.length),
              rows: String(requests.reduce((sum, entry) => sum + entry.rows, 0)),
              seconds: String(
                Math.round(requests.reduce((sum, entry) => sum + entry.durationMs, 0) / 100) / 10,
              ),
            })}
          </summary>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-border border-b text-left">
                <th className="py-2">{t('moneybird.resource')}</th>
                <th className="py-2 text-right">{t('moneybird.statusColumn')}</th>
                <th className="py-2 text-right">{t('moneybird.rowsColumn')}</th>
                <th className="py-2 text-right">{t('moneybird.durationColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((entry, index) => (
                <tr key={`${entry.path}-${String(index)}`} className="border-border border-b">
                  <td className="py-1 tabular text-xs">{entry.path}</td>
                  <td className="py-1 text-right tabular">{String(entry.status)}</td>
                  <td className="py-1 text-right tabular">{String(entry.rows)}</td>
                  <td className="py-1 text-right tabular">{String(entry.durationMs)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {problems.length === 0 && warnings.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('moneybird.nothingToReport')}</p>
      )}
    </div>
  )
}

interface ReconciliationYear {
  readonly year: number
  readonly source: 'read' | 'empty' | 'unreadable'
  readonly totalDebit: string | null
  readonly totalCredit: string | null
  readonly balanced: boolean | null
}

const RUN_KEY: Record<string, MessageKey> = {
  pending: 'docs.run.pending',
  running: 'docs.run.running',
  paused: 'docs.run.paused',
  done: 'docs.run.done',
  failed: 'docs.run.failed',
}

function ImportProgress({
  result,
  status,
}: {
  result: Record<string, unknown>
  status: { ok: boolean; data?: unknown }
}) {
  const { t } = useT()
  const run = status.ok ? (status.data as Record<string, unknown>) : result
  const state = typeof run['state'] === 'string' ? run['state'] : 'pending'
  const key = RUN_KEY[state]
  const report =
    run['report'] !== null && typeof run['report'] === 'object'
      ? (run['report'] as Record<string, unknown>)
      : null
  const years =
    report !== null && Array.isArray(report['reconciliation'])
      ? (report['reconciliation'] as CommitYear[])
      : []
  const opening =
    report !== null && report['opening'] !== null && typeof report['opening'] === 'object'
      ? (report['opening'] as { year: number; accounts: CommitAccount[] })
      : null

  return (
    <div>
      {run['workerSilent'] === true && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {t('moneybird.workerSilent')} <code>pnpm run dev</code>.
        </p>
      )}
      <p role="status" className="mb-4 text-sm">
        {t('moneybird.status')} <strong>{key === undefined ? state : t(key)}</strong>
      </p>
      {years.length > 0 && (
        <div className="mt-4">
          <p className="text-muted-foreground mb-3 text-sm">{t('moneybird.reconciliationIntro')}</p>
          {years.map((year) => (
            <div key={year.year} className="mb-4">
              <h3 className="mb-2 text-sm font-semibold">
                {t('moneybird.trialBalanceLabel', { year: String(year.year) })}
                {year.source === 'unreadable'
                  ? ` — ${t('moneybird.notRead')}`
                  : year.balanced === true
                    ? ` — ${t('moneybird.balances')}`
                    : year.balanced === false
                      ? ` — ${t('moneybird.doesNotBalance')}`
                      : ''}
              </h3>
              {year.accounts.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-border text-muted-foreground border-b text-left">
                      <th className="py-2">{t('moneybird.accountColumn')}</th>
                      <th className="py-2 text-right">{t('moneybird.plannedColumn')}</th>
                      <th className="py-2 text-right">{t('moneybird.kloptColumn')}</th>
                      <th className="py-2 text-right">{t('moneybird.differenceColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {year.accounts.map((row) => (
                      <tr key={row.accountNumber} className="border-border border-b">
                        <td className="py-1.5 tabular-nums">{row.accountNumber}</td>
                        <td className="py-1.5 text-right tabular-nums">{row.planned}</td>
                        <td className="py-1.5 text-right tabular-nums">{row.klopt}</td>
                        <td className="py-1.5 text-right tabular-nums">{row.difference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          {opening !== null && opening.accounts.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold">
                {t('moneybird.openingLabel', { year: String(opening.year) })}
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border text-muted-foreground border-b text-left">
                    <th className="py-2">{t('moneybird.accountColumn')}</th>
                    <th className="py-2 text-right">{t('moneybird.plannedColumn')}</th>
                    <th className="py-2 text-right">{t('moneybird.kloptColumn')}</th>
                    <th className="py-2 text-right">{t('moneybird.differenceColumn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {opening.accounts.map((row) => (
                    <tr key={row.accountNumber} className="border-border border-b">
                      <td className="py-1.5 tabular-nums">{row.accountNumber}</td>
                      <td className="py-1.5 text-right tabular-nums">{row.planned}</td>
                      <td className="py-1.5 text-right tabular-nums">{row.klopt}</td>
                      <td className="py-1.5 text-right tabular-nums">{row.difference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface CommitAccount {
  readonly accountNumber: string
  readonly planned: string
  readonly klopt: string
  readonly difference: string
}

interface CommitYear {
  readonly year: number
  readonly source: string
  readonly balanced: boolean | null
  readonly accounts: readonly CommitAccount[]
}
