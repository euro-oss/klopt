import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { checkVatNumbers, getIcp } from '~/server/vat'

/**
 * The ICP opgaaf for a period.
 *
 * Two things share the screen because they are the same question. The opgaaf
 * itself is a list of counterparties and amounts — trivial. What makes it
 * fileable is that every VAT number on it has been checked against VIES and the
 * answer is on record, and that the total equals rubriek 3b. So the proof
 * column sits next to the amount, and the cross-check is above both.
 */
export const Route = createFileRoute('/_app/vat/icp/$period')({
  loader: async ({ params }) => ({
    icp: await getIcp({ data: { period: params.period } }),
  }),
  component: IcpScreen,
})

const FINDING_LABEL: Record<string, string> = {
  supply_without_counterparty: 'Levering zonder afnemer',
  counterparty_without_vat_number: 'Afnemer zonder btw-nummer',
  vat_number_malformed: 'Btw-nummer heeft niet de juiste vorm',
  vat_number_not_eu: 'Btw-nummer is niet van een EU-lidstaat',
  vat_number_invalid: 'VIES kent dit btw-nummer niet',
  vat_number_unproven: 'Btw-nummer niet bij VIES gecontroleerd',
  proof_predates_period: 'VIES-controle is ouder dan de periode',
  icp_mismatch: 'Opgaaf en rubriek 3b lopen uiteen',
}

const OUTCOME_LABEL: Record<string, string> = {
  valid: 'geldig',
  invalid: 'ongeldig',
  unavailable: 'niet bevestigd',
}

function IcpScreen() {
  const { icp } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const key = useRef<string>(crypto.randomUUID())

  if (!icp.ok) {
    return (
      <>
        <PageHeader title="ICP-opgaaf" />
        <p role="alert" className="text-destructive text-sm">
          {icp.problem.detail}
        </p>
      </>
    )
  }

  const data = icp.data
  const unchecked = data.entries.filter(
    (entry) => entry.proof === null || entry.proof.outcome !== 'valid',
  )

  async function check(vatNumbers: readonly string[]) {
    if (vatNumbers.length === 0) return
    setBusy(true)
    setError(null)
    setNote(null)

    const result = await checkVatNumbers({
      data: { idempotencyKey: key.current, body: { vatNumbers: [...vatNumbers] } },
    })
    setBusy(false)
    key.current = crypto.randomUUID()

    if (!result.ok) {
      setError(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => item.message).join(' ')
          : result.problem.detail,
      )
      return
    }

    if (result.data.source === 'offline') {
      setNote(
        'Er is geen VIES-verbinding geconfigureerd, dus er is alleen op vorm gecontroleerd. Zet KLOPT_VIES_ENDPOINT, of controleer de nummers zelf bij de Europese Commissie en leg het raadplegingsnummer vast.',
      )
    } else if (!result.data.provenByConsultationNumber) {
      setNote(
        'VIES gaf geen raadplegingsnummer terug. Dat gebeurt als het eigen btw-nummer van deze administratie niet is ingevuld — en zonder raadplegingsnummer is er geen bewijs dat je kunt laten zien.',
      )
    }

    await router.invalidate()
  }

  return (
    <>
      <PageHeader
        title={`ICP-opgaaf ${data.period.label}`}
        description={`${formatDate(data.period.from)} tot en met ${formatDate(data.period.to)}. Uiterlijk indienen op ${formatDate(data.period.deadline)}.`}
        actions={
          <Link
            to="/vat/$period"
            params={{ period: data.period.code }}
            className="text-sm underline"
          >
            Naar de BTW-aangifte
          </Link>
        }
      />

      <div className="mb-8 flex flex-wrap gap-8">
        <Stat label="Goederen" value={<Money amount={data.goods} />} />
        <Stat label="Diensten" value={<Money amount={data.services} />} />
        <Stat label="Totaal opgaaf" value={<Money amount={data.total} />} />
        <Stat
          label="Rubriek 3b"
          value={<Money amount={data.rubriek3b} />}
          hint={data.difference === '0' ? 'sluit aan' : 'wijkt af'}
          tone={data.difference === '0' ? 'good' : 'warn'}
        />
      </div>

      <p className="text-muted-foreground mb-6 max-w-2xl text-sm">
        De opgaaf en rubriek 3b beschrijven dezelfde leveringen — de een per afnemer, de ander per
        tarief — en de Belastingdienst legt ze naast elkaar. Een verschil tussen je eigen twee
        aangiftes is de makkelijkste bevinding die er is, dus die wordt hier geblokkeerd.
      </p>

      <table className="border-border mb-8 w-full max-w-4xl border-collapse text-sm">
        <caption className="sr-only">Afnemers in de ICP-opgaaf</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="py-2 pr-2 font-medium">
              Btw-nummer
            </th>
            <th scope="col" className="py-2 pr-2 font-medium">
              Afnemer
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              Goederen
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              Diensten
            </th>
            <th scope="col" className="py-2 font-medium">
              VIES
            </th>
          </tr>
        </thead>
        <tbody>
          {data.entries.length === 0 && (
            <tr>
              <td colSpan={5} className="text-muted-foreground py-3">
                Geen intracommunautaire leveringen in deze periode.
              </td>
            </tr>
          )}
          {data.entries.map((entry) => (
            <tr key={entry.vatNumber} className="border-border/50 border-t">
              <th scope="row" className="tabular py-1.5 pr-2 text-left font-normal">
                {entry.vatNumber}
              </th>
              <td className="py-1.5 pr-2">
                {entry.contactName ?? <span className="text-muted-foreground">—</span>}
                {entry.contactNumber !== null && (
                  <span className="text-muted-foreground tabular text-xs">
                    {' '}
                    {entry.contactNumber}
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-2 text-right">
                <Money amount={entry.goods} />
              </td>
              <td className="py-1.5 pr-2 text-right">
                <Money amount={entry.services} />
              </td>
              <td className="py-1.5 text-xs">
                {entry.proof === null ? (
                  <span className="text-destructive">nooit gecontroleerd</span>
                ) : (
                  <span
                    className={entry.proof.outcome === 'valid' ? undefined : 'text-destructive'}
                  >
                    {OUTCOME_LABEL[entry.proof.outcome] ?? entry.proof.outcome} op{' '}
                    <span className="tabular">
                      {formatDate(entry.proof.checkedAt.slice(0, 10))}
                    </span>
                    {entry.proof.requestIdentifier === null ? (
                      <span className="text-muted-foreground"> · geen raadplegingsnummer</span>
                    ) : (
                      <span className="text-muted-foreground">
                        {' '}
                        · nr. {entry.proof.requestIdentifier}
                      </span>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!hydrated || busy || unchecked.length === 0}
          onClick={() => {
            void check(unchecked.map((entry) => entry.vatNumber))
          }}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy
            ? 'Bezig…'
            : unchecked.length === 0
              ? 'Alle nummers zijn bevestigd'
              : `${String(unchecked.length)} ${unchecked.length === 1 ? 'nummer' : 'nummers'} bij VIES controleren`}
        </button>
        {data.entries.length > 0 && (
          <button
            type="button"
            disabled={!hydrated || busy}
            onClick={() => {
              void check(data.entries.map((entry) => entry.vatNumber))
            }}
            className="border-input rounded-md border px-4 py-2 text-sm disabled:opacity-50"
          >
            Alles opnieuw controleren
          </button>
        )}
      </div>

      {error !== null && (
        <p role="alert" className="text-destructive mb-6 max-w-2xl text-sm">
          {error}
        </p>
      )}
      {note !== null && (
        <p className="border-border mb-6 max-w-2xl rounded-md border border-dashed p-3 text-sm">
          {note}
        </p>
      )}

      {data.findings.length > 0 && (
        <>
          <h2 className="mb-3 text-sm font-semibold">Bevindingen</h2>
          <ul className="mb-10 max-w-3xl space-y-3">
            {data.findings.map((finding) => (
              <li
                key={finding.code}
                className={
                  finding.severity === 'blocking'
                    ? 'border-destructive rounded-md border p-3 text-sm'
                    : 'border-border rounded-md border p-3 text-sm'
                }
              >
                <p className="font-medium">
                  {finding.severity === 'blocking' ? 'Blokkerend: ' : 'Ter beoordeling: '}
                  {FINDING_LABEL[finding.code] ?? finding.code}{' '}
                  <span className="text-muted-foreground font-normal">
                    (<Money amount={finding.amount} />)
                  </span>
                </p>
                <p className="text-muted-foreground mt-1">{finding.message}</p>
                {finding.lines.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs">
                    {finding.lines.map((line) => (
                      <li key={`${line.entryId}-${String(line.lineNumber)}`}>
                        <Link
                          to="/entries/$entryId"
                          params={{ entryId: line.entryId }}
                          className="underline"
                        >
                          {line.journalCode} {line.entryNumber}
                        </Link>{' '}
                        <span className="tabular">{formatDate(line.bookingDate)}</span> ·{' '}
                        {line.description} · <Money amount={line.amount} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
