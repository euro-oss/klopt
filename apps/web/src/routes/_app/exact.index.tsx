import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { formatDate } from '~/lib/format'
import {
  chooseExactDivision,
  connectExact,
  disconnectExact,
  getExactConnection,
  listExactDivisions,
  previewExactImport,
} from '~/server/ledger'

/**
 * Overzetten uit Exact Online (spec 13).
 *
 * Drie stappen, in deze volgorde, en de middelste is de belangrijkste: één
 * Exact-login bereikt élke administratie waar iemand rechten op heeft — de
 * werkmaatschappij, de holding, de oefenadministratie van een cursus, de
 * testadministratie die iemand ooit heeft aangemaakt. In een lijst zien ze er
 * hetzelfde uit, en achteraf is niet meer te zien welke het was.
 *
 * Daarom staat bij elke administratie wat er ongewoon aan is, staan de gewone
 * administraties bovenaan, en noemt de bevestiging de naam en het nummer in
 * plaats van "administratie 2 van 6".
 *
 * De proefimport is een leesactie: hij verandert hier niets en levert de
 * aansluiting op de proefbalans van Exact zelf. Dat is wat de spec vraagt
 * vóórdat er iets wordt overgezet.
 */
export const Route = createFileRoute('/_app/exact/')({
  loader: async () => ({ connection: await getExactConnection() }),
  component: Exact,
})

interface DivisionOption {
  readonly code: number
  readonly description: string
  readonly label: string
  readonly currency: string | null
  readonly vatNumber: string | null
  readonly cautions: readonly string[]
  readonly ordinary: boolean
}

const CAUTION_TEXT: Record<string, string> = {
  practice: 'oefenadministratie',
  dossier: 'dossieradministratie',
  archived: 'gearchiveerd',
  inactive: 'inactief',
  blocked: 'geblokkeerd',
}

function Exact() {
  const { connection } = Route.useLoaderData()
  const router = useRouter()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [divisions, setDivisions] = useState<readonly DivisionOption[] | null>(null)
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [year, setYear] = useState(String(new Date().getFullYear()))

  const [baseUrl, setBaseUrl] = useState('https://start.exactonline.nl')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [redirectUri, setRedirectUri] = useState(
    typeof window === 'undefined' ? '' : `${window.location.origin}/exact/callback`,
  )

  if (!connection.ok) {
    return (
      <>
        <PageHeader title="Exact Online" />
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
      setError(result.problem?.detail ?? 'Onbekende fout.')
      return
    }
    onDone?.(result.data)
  }

  const connect = () =>
    run(
      () =>
        connectExact({
          data: {
            baseUrl,
            clientId,
            clientSecret,
            redirectUri,
            idempotencyKey: crypto.randomUUID(),
          },
        }),
      (data) => {
        // Exact's own consent screen. Leaving is the only way to get a code,
        // and the state in this URL is what ties the return trip back here.
        const url = (data as { authorizeUrl?: string }).authorizeUrl
        if (url !== undefined) window.location.assign(url)
      },
    )

  const loadDivisions = () =>
    run(listExactDivisions, (data) => {
      setDivisions((data as { divisions: readonly DivisionOption[] }).divisions)
    })

  const choose = (code: number) =>
    run(
      () =>
        chooseExactDivision({ data: { divisionCode: code, idempotencyKey: crypto.randomUUID() } }),
      (data) => {
        const chosen = data as { divisionName: string; cautions: readonly string[] }
        setNote(
          chosen.cautions.length === 0
            ? `${chosen.divisionName} is gekozen.`
            : `${chosen.divisionName} is gekozen — let op: ${chosen.cautions
                .map((caution) => CAUTION_TEXT[caution] ?? caution)
                .join(', ')}.`,
        )
        void router.invalidate()
      },
    )

  const runPreview = () =>
    run(
      () => previewExactImport({ data: { year: Number(year) } }),
      (data) => {
        setPreview(data as Record<string, unknown>)
      },
    )

  return (
    <>
      <PageHeader
        title="Exact Online"
        description="Relaties, openstaande posten, grootboekschema en documenten overzetten."
        actions={
          state?.connected === true ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(disconnectExact, () => void router.invalidate())}
              className="border-border rounded-md border px-3 py-1.5 text-sm"
            >
              Verbinding verbreken
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

      {/* Stap 1 — de OAuth-app. */}
      {state === null || state.connected !== true ? (
        <section className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-lg font-semibold">1. Verbinden</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">
            De OAuth-app is van degene die deze installatie beheert. Registreer hem in het Exact App
            Center met precies deze redirect-URI — Exact vergelijkt hem letterlijk.
          </p>

          {!canStoreSecrets && (
            <p role="alert" className="text-destructive mb-4 text-sm">
              Er is geen KLOPT_ENCRYPTION_KEY ingesteld, dus een client secret kan niet versleuteld
              worden opgeslagen. Zet die eerst; onversleuteld bewaren doet dit systeem niet.
            </p>
          )}

          <div className="grid max-w-2xl gap-3">
            <label className="text-sm">
              Exact-omgeving
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                className="border-border mt-1 w-full rounded-md border px-2 py-1.5"
              />
            </label>
            <label className="text-sm">
              Client ID
              <input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                className="border-border mt-1 w-full rounded-md border px-2 py-1.5 font-mono"
              />
            </label>
            <label className="text-sm">
              Client secret
              <input
                type="password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                className="border-border mt-1 w-full rounded-md border px-2 py-1.5 font-mono"
              />
            </label>
            <label className="text-sm">
              Redirect-URI
              <input
                value={redirectUri}
                onChange={(event) => setRedirectUri(event.target.value)}
                className="border-border mt-1 w-full rounded-md border px-2 py-1.5 font-mono"
              />
            </label>
            <div>
              <button
                type="button"
                disabled={busy || !canStoreSecrets || clientId === '' || clientSecret === ''}
                onClick={() => void connect()}
                className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Aanmelden bij Exact
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-lg font-semibold">1. Verbonden</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {state.userName ?? 'onbekende gebruiker'} — {state.baseUrl}
            {state.lastImportAt !== null && ` · laatst overgezet ${formatDate(state.lastImportAt)}`}
          </p>
          {state.lastError !== null && (
            <p role="alert" className="text-destructive mt-2 text-sm">
              {state.lastError}
            </p>
          )}
        </section>
      )}

      {/* Stap 2 — welke administratie. De hele reden dat dit een eigen stap is. */}
      {state?.connected === true && (
        <section className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-lg font-semibold">2. Welke administratie</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">
            Eén Exact-login bereikt élke administratie waar deze gebruiker rechten op heeft. Kies de
            juiste: achteraf is aan de cijfers niet te zien welke het was.
          </p>

          {state.divisionCode !== null && (
            <p className="mb-4 text-sm">
              Gekozen: <strong>{state.divisionName}</strong> ({state.divisionCode})
              {state.divisionCautions.length > 0 && (
                <span className="text-unreconciled">
                  {' '}
                  —{' '}
                  {state.divisionCautions
                    .map((caution) => CAUTION_TEXT[caution] ?? caution)
                    .join(', ')}
                </span>
              )}
            </p>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => void loadDivisions()}
            className="border-border rounded-md border px-3 py-1.5 text-sm"
          >
            {divisions === null ? 'Administraties ophalen' : 'Opnieuw ophalen'}
          </button>

          {divisions !== null && (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-border border-b text-left">
                  <th className="py-2">Administratie</th>
                  <th className="py-2">Nummer</th>
                  <th className="py-2">BTW-nummer</th>
                  <th className="py-2">Let op</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {divisions.map((division) => (
                  <tr key={division.code} className="border-border border-b">
                    <td className="py-2">{division.description}</td>
                    <td className="py-2 tabular">{division.code}</td>
                    <td className="py-2 font-mono text-xs">{division.vatNumber ?? '—'}</td>
                    <td className="text-unreconciled py-2">
                      {division.cautions.length === 0
                        ? ''
                        : division.cautions
                            .map((caution) => CAUTION_TEXT[caution] ?? caution)
                            .join(', ')}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        disabled={busy || state.divisionCode === division.code}
                        onClick={() => void choose(division.code)}
                        className="border-border rounded-md border px-2 py-1 text-xs disabled:opacity-50"
                      >
                        {state.divisionCode === division.code ? 'gekozen' : 'kies deze'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* Stap 3 — de proefimport. */}
      {state?.ready === true && (
        <section className="border-border rounded-md border p-4">
          <h2 className="text-lg font-semibold">3. Proefimport</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">
            Leest de administratie en sluit aan op de proefbalans van Exact zelf. Er wordt niets
            overgezet.
          </p>

          <div className="mb-4 flex items-end gap-3">
            <label className="text-sm">
              Boekjaar
              <input
                value={year}
                onChange={(event) => setYear(event.target.value)}
                inputMode="numeric"
                className="border-border mt-1 w-24 rounded-md border px-2 py-1.5 tabular"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runPreview()}
              className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? 'Bezig…' : 'Proefimport uitvoeren'}
            </button>
          </div>

          {preview !== null && <PreviewReport report={preview} />}
        </section>
      )}
    </>
  )
}

interface ControlCheck {
  readonly accountCodes: readonly string[]
  readonly ledger: string
  readonly openItems: string
  readonly difference: string
  readonly matches: boolean
  readonly itemCount: number
}

interface Reconciliation {
  readonly year: number
  readonly totalDebit: string
  readonly totalCredit: string
  readonly balanced: boolean
  readonly accountCount: number
  readonly orphanAccountCodes: readonly string[]
  readonly receivable: ControlCheck
  readonly payable: ControlCheck
}

/**
 * Het aansluitverslag.
 *
 * Drie vragen, in deze volgorde, omdat de tweede niets waard is als de eerste
 * niet klopt: sluit de proefbalans van Exact zelf, sluiten de openstaande
 * posten aan op de tussenrekeningen, en bestaat elke rekening met een saldo ook
 * in het schema.
 */
function PreviewReport({ report }: { report: Record<string, unknown> }) {
  const reconciliation = report['reconciliation'] as Reconciliation
  const accounts = report['accounts'] as { count: number; new: number; derived: number }
  const contacts = report['contacts'] as { count: number; new: number }
  const openItems = report['openItems'] as {
    receivable: { count: number; total: string }
    payable: { count: number; total: string }
  }
  const warnings = report['warnings'] as readonly { code: string; message: string }[]
  const problems = report['problems'] as readonly { code: string; message: string }[]

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label={`Proefbalans ${String(reconciliation.year)}`}
          value={reconciliation.balanced ? 'sluit' : 'sluit niet'}
          tone={reconciliation.balanced ? 'good' : 'warn'}
          hint={`${reconciliation.totalDebit} debet / ${reconciliation.totalCredit} credit`}
        />
        <Stat
          label="Grootboekrekeningen"
          value={accounts.count}
          hint={`${String(accounts.new)} nieuw${accounts.derived > 0 ? `, ${String(accounts.derived)} afgeleid` : ''}`}
        />
        <Stat label="Relaties" value={contacts.count} hint={`${String(contacts.new)} nieuw`} />
        <Stat
          label="Openstaand"
          value={`${openItems.receivable.total} / ${openItems.payable.total}`}
          hint={`${String(openItems.receivable.count)} debiteuren, ${String(openItems.payable.count)} crediteuren`}
        />
      </div>

      <h3 className="mb-2 text-sm font-semibold">Aansluiting openstaande posten</h3>
      <table className="mb-6 w-full text-sm">
        <thead>
          <tr className="border-border border-b text-left">
            <th className="py-2">Zijde</th>
            <th className="py-2">Rekening(en)</th>
            <th className="py-2 text-right">Grootboek</th>
            <th className="py-2 text-right">Openstaande posten</th>
            <th className="py-2 text-right">Verschil</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['Debiteuren', reconciliation.receivable],
              ['Crediteuren', reconciliation.payable],
            ] as const
          ).map(([label, check]) => (
            <tr key={label} className="border-border border-b">
              <td className="py-2">{label}</td>
              <td className="py-2 font-mono text-xs">
                {check.accountCodes.length === 0 ? 'geen gevonden' : check.accountCodes.join(', ')}
              </td>
              <td className="py-2 text-right tabular">{check.ledger}</td>
              <td className="py-2 text-right tabular">{check.openItems}</td>
              <td className={`py-2 text-right tabular ${check.matches ? '' : 'text-unreconciled'}`}>
                {check.difference}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {problems.length > 0 && (
        <>
          <h3 className="text-destructive mb-2 text-sm font-semibold">
            Blokkerend ({String(problems.length)})
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
          <h3 className="mb-2 text-sm font-semibold">Let op ({String(warnings.length)})</h3>
          <ul className="text-muted-foreground list-disc pl-5 text-sm">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${String(index)}`}>{warning.message}</li>
            ))}
          </ul>
        </>
      )}

      {problems.length === 0 && warnings.length === 0 && (
        <p className="text-muted-foreground text-sm">Niets om te melden.</p>
      )}
    </div>
  )
}
