import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Fragment, useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { fileVatReturn, getVatReturn } from '~/server/vat'

/**
 * The BTW-aangifte for one period.
 *
 * Laid out as the form itself, because that is what the operator is going to
 * type into Mijn Belastingdienst or hand to their accountant, and a table with
 * different headings than the real one costs them a translation step every
 * quarter.
 *
 * Underneath it, the reconciliation — which is the part that makes this
 * trustworthy rather than merely convenient. Every rubriek can be opened to
 * the journal lines that produced it, and the VAT control accounts are shown
 * against what the return declares for them. A difference blocks filing, and
 * the findings name the lines it consists of.
 */
export const Route = createFileRoute('/_app/vat/$period')({
  loader: async ({ params }) => ({
    period: params.period,
    aangifte: await getVatReturn({ data: { period: params.period } }),
  }),
  component: VatReturnScreen,
})

const TRANSPORT_LABEL: Record<string, string> = {
  manual: 'Zelf indienen via Mijn Belastingdienst Zakelijk',
  digipoort: 'Digipoort (eigen certificaat)',
  sbr_provider: 'Via een SBR-dienstverlener',
}

const FINDING_LABEL: Record<string, string> = {
  unknown_tax_code: 'Onbekende BTW-code',
  no_rule_in_force: 'BTW-code niet geldig op de boekdatum',
  code_declares_no_vat: 'BTW geboekt op een 0%-code',
  code_declares_no_base: 'Grondslag zonder rubriek',
  untagged_control_movement: 'Mutatie op een BTW-rekening zonder code',
  rate_mismatch: 'BTW wijkt af van grondslag maal tarief',
  control_account_difference: 'BTW-rekening sluit niet aan',
}

function VatReturnScreen() {
  const { aangifte } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()

  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string[] | null>(null)
  const [accept, setAccept] = useState(false)
  const key = useRef<string>(crypto.randomUUID())

  if (!aangifte.ok) {
    return (
      <>
        <PageHeader title="BTW-aangifte" />
        <p role="alert" className="text-destructive text-sm">
          {aangifte.problem.detail}
        </p>
      </>
    )
  }

  const data = aangifte.data
  const warnings = data.findings.filter((finding) => finding.severity === 'warning')
  const blocking = data.findings.filter((finding) => finding.severity === 'blocking')
  const filing = data.filing
  const needsSuppletie = (filing?.suppletieNeeded ?? []).length > 0
  const canFile = !data.blocked && (filing === null || needsSuppletie)

  const detailFor = (rubriek: string) =>
    data.detail.find((entry) => entry.rubriek === rubriek)?.lines ?? []

  async function file(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Captured before the first await: React nulls a synthetic event's
    // currentTarget once the handler returns.
    const element = event.currentTarget
    const form = new FormData(element)
    const text = (name: string): string => {
      const value = form.get(name)
      return typeof value === 'string' ? value.trim() : ''
    }

    setBusy(true)
    setError(null)

    const result = await fileVatReturn({
      data: {
        idempotencyKey: key.current,
        body: {
          period: data.period.code,
          transport: text('transport'),
          transportReference: text('transportReference') || null,
          acceptWarnings: accept,
          acceptedReason: accept ? text('acceptedReason') : null,
        },
      },
    })
    setBusy(false)

    if (!result.ok) {
      setError(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => item.message)
          : [result.problem.detail],
      )
      return
    }

    key.current = crypto.randomUUID()
    setAccept(false)
    await router.invalidate()
  }

  return (
    <>
      <PageHeader
        title={`BTW-aangifte ${data.period.label}`}
        description={`${formatDate(data.period.from)} tot en met ${formatDate(data.period.to)}. Uiterlijk indienen op ${formatDate(data.period.deadline)}.`}
        actions={
          <Link to="/vat" className="text-sm underline">
            Alle periodes
          </Link>
        }
      />

      <div className="mb-8 flex flex-wrap gap-8">
        <Stat label="5a Verschuldigd" value={<Money amount={data.owed} />} />
        <Stat label="5b Voorbelasting" value={<Money amount={data.deductible} />} />
        <Stat
          label={BigInt(data.payable) < 0n ? '5c Terug te vragen' : '5c Te betalen'}
          value={<Money amount={data.payable} />}
          tone={data.blocked ? 'warn' : 'neutral'}
        />
      </div>

      {filing !== null && (
        <div className="border-border mb-8 rounded-md border p-4 text-sm">
          <p>
            Ingediend
            {filing.filedAt !== null && ` op ${formatDate(filing.filedAt.slice(0, 10))}`}
            {filing.sequence > 1 && ` als suppletie ${String(filing.sequence - 1)}`}
            {filing.transport !== null &&
              ` — ${TRANSPORT_LABEL[filing.transport] ?? filing.transport}`}
            .
          </p>
          {needsSuppletie && (
            <div className="mt-3">
              <p className="text-unreconciled font-medium">
                Er is na de aangifte nog geboekt in deze periode. Dit vraagt een suppletie.
              </p>
              <table className="mt-2 w-full max-w-2xl text-sm">
                <caption className="sr-only">Verschil met de ingediende aangifte</caption>
                <thead>
                  <tr className="text-muted-foreground text-left text-xs">
                    <th scope="col">Rubriek</th>
                    <th scope="col" className="text-right">
                      Ingediend
                    </th>
                    <th scope="col" className="text-right">
                      Nu
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filing.suppletieNeeded.map((difference) => (
                    <tr key={difference.label}>
                      <td>{difference.label}</td>
                      <td className="text-right">
                        <Money amount={difference.filed} />
                      </td>
                      <td className="text-right">
                        <Money amount={difference.now} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold">De aangifte</h2>
      <table className="border-border mb-10 w-full max-w-4xl border-collapse text-sm">
        <caption className="sr-only">Rubrieken van de BTW-aangifte</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="py-2 pr-2 font-medium">
              Rubriek
            </th>
            <th scope="col" className="py-2 pr-2 font-medium">
              Omschrijving
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              Grondslag
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              BTW
            </th>
            <th scope="col" className="py-2 font-medium">
              <span className="sr-only">Onderbouwing</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rubrieken.map((row) => {
            const lines = detailFor(row.id)
            const expanded = open === row.id
            return (
              <Fragment key={row.id}>
                <tr
                  className={
                    row.computed
                      ? 'border-border border-t font-medium'
                      : 'border-border/50 border-t'
                  }
                >
                  <th scope="row" className="tabular py-1.5 pr-2 text-left font-normal">
                    {row.id}
                  </th>
                  <td className="py-1.5 pr-2">{row.label}</td>
                  <td className="py-1.5 pr-2 text-right">
                    {row.carries === 'vat' ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Money amount={row.base} />
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    {row.carries === 'base' ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Money amount={row.vat} />
                    )}
                  </td>
                  <td className="py-1.5">
                    {lines.length > 0 && (
                      <button
                        type="button"
                        disabled={!hydrated}
                        aria-expanded={expanded}
                        onClick={() => {
                          setOpen(expanded ? null : row.id)
                        }}
                        className="text-xs underline disabled:opacity-50"
                      >
                        {expanded
                          ? 'verberg regels'
                          : `${String(lines.length)} ${lines.length === 1 ? 'regel' : 'regels'}`}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-muted/30">
                    <td colSpan={5} className="p-3">
                      <table className="w-full text-xs">
                        <caption className="sr-only">{`Grootboekregels achter rubriek ${row.id}`}</caption>
                        <thead>
                          <tr className="text-muted-foreground text-left">
                            <th scope="col">Datum</th>
                            <th scope="col">Boeking</th>
                            <th scope="col">Rekening</th>
                            <th scope="col">Omschrijving</th>
                            <th scope="col">Code</th>
                            <th scope="col" className="text-right">
                              Bedrag
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((line) => (
                            <tr key={`${line.entryId}-${String(line.lineNumber)}`}>
                              <td className="tabular py-1">{formatDate(line.bookingDate)}</td>
                              <td className="py-1">
                                <Link
                                  to="/entries/$entryId"
                                  params={{ entryId: line.entryId }}
                                  className="underline"
                                >
                                  {line.journalCode} {line.entryNumber}
                                </Link>
                              </td>
                              <td className="tabular py-1">{line.accountNumber}</td>
                              <td className="py-1">{line.description}</td>
                              <td className="py-1">
                                {line.taxCode}
                                <span className="text-muted-foreground">
                                  {line.taxRole === 'base' ? ' (grondslag)' : ' (btw)'}
                                </span>
                              </td>
                              <td className="py-1 text-right">
                                <Money amount={line.amount} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      <h2 className="mb-3 text-sm font-semibold">Aansluiting met de BTW-rekeningen</h2>
      <p className="text-muted-foreground mb-3 max-w-2xl text-sm">
        De mutatie op elke BTW-rekening moet gelijk zijn aan wat de aangifte daarvoor opgeeft. Een
        verschil is het bedrag dat wel in de boeken staat maar niet in een rubriek terechtkomt, en
        dat blokkeert de aangifte.
      </p>
      <table className="border-border mb-10 w-full max-w-4xl border-collapse text-sm">
        <caption className="sr-only">Aansluiting van de BTW-rekeningen</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="py-2 pr-2 font-medium">
              Rekening
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              Mutatie met code
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              Opgegeven
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              Verschil
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Zonder code
            </th>
          </tr>
        </thead>
        <tbody>
          {data.reconciliation.length === 0 && (
            <tr>
              <td colSpan={5} className="text-muted-foreground py-3">
                Geen mutaties op een BTW-rekening in deze periode.
              </td>
            </tr>
          )}
          {data.reconciliation.map((account) => (
            <tr key={account.accountNumber} className="border-border/50 border-t">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                <span className="tabular">{account.accountNumber}</span> {account.accountName}
              </th>
              <td className="py-1.5 pr-2 text-right">
                <Money amount={account.taggedMovement} />
              </td>
              <td className="py-1.5 pr-2 text-right">
                <Money amount={account.declared} />
              </td>
              <td className="py-1.5 pr-2 text-right">
                {account.difference === '0' ? (
                  <span className="text-muted-foreground">sluit aan</span>
                ) : (
                  <span className="text-destructive">
                    <Money amount={account.difference} />
                  </span>
                )}
              </td>
              <td className="py-1.5 text-right">
                <Money amount={account.untaggedMovement} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.findings.length > 0 && (
        <>
          <h2 className="mb-3 text-sm font-semibold">
            Bevindingen ({blocking.length} blokkerend, {warnings.length} ter beoordeling)
          </h2>
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
                        <span className="tabular">{line.accountNumber}</span> · {line.description} ·{' '}
                        <Money amount={line.amount} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mb-3 text-sm font-semibold">
        {needsSuppletie ? 'Suppletie indienen' : 'Aangifte indienen'}
      </h2>

      {data.blocked && (
        <p role="alert" className="text-destructive mb-4 max-w-2xl text-sm">
          Deze aangifte kan niet worden ingediend zolang de aansluiting niet klopt. Los de
          blokkerende bevindingen hierboven op.
        </p>
      )}

      {filing !== null && !needsSuppletie && (
        <p className="text-muted-foreground mb-4 max-w-2xl text-sm">
          Deze periode is ingediend en er is daarna niets meer gewijzigd. Er is dus niets te
          corrigeren.
        </p>
      )}

      {canFile && (
        <form
          onSubmit={(event) => {
            void file(event)
          }}
          className="border-border mb-10 max-w-2xl space-y-4 rounded-md border p-4"
        >
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">Hoe</span>
            <select
              aria-label="Hoe"
              name="transport"
              defaultValue="manual"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            >
              {Object.entries(TRANSPORT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <div>
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                Kenmerk van de indiening
              </span>
              <input
                name="transportReference"
                aria-describedby="transport-reference-hint"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
            </label>
            <p id="transport-reference-hint" className="text-muted-foreground mt-1 text-xs">
              Het berichtnummer van Digipoort of het kenmerk uit Mijn Belastingdienst. Optioneel,
              maar het is het enige waarmee je deze aangifte later kunt terugvinden bij de
              Belastingdienst.
            </p>
          </div>

          {warnings.length > 0 && (
            <div className="border-border rounded-md border border-dashed p-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={accept}
                  onChange={(event) => {
                    setAccept(event.target.checked)
                  }}
                  className="mt-0.5"
                />
                <span>
                  Ik heb de {warnings.length} {warnings.length === 1 ? 'bevinding' : 'bevindingen'}{' '}
                  hierboven bekeken en dien toch in
                </span>
              </label>
              {accept && (
                <div className="mt-3">
                  <label className="block">
                    <span className="text-muted-foreground mb-1 block text-xs font-medium">
                      Waarom
                    </span>
                    <textarea
                      name="acceptedReason"
                      required
                      rows={2}
                      aria-describedby="accepted-reason-hint"
                      className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                    />
                  </label>
                  <p id="accepted-reason-hint" className="text-muted-foreground mt-1 text-xs">
                    Deze toelichting wordt bij de aangifte bewaard en hoort bij het dossier van deze
                    periode.
                  </p>
                </div>
              )}
            </div>
          )}

          {error !== null && (
            <ul role="alert" className="text-destructive space-y-1 text-sm">
              {error.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}

          <button
            type="submit"
            disabled={!hydrated || busy || (warnings.length > 0 && !accept)}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy
              ? 'Bezig…'
              : needsSuppletie
                ? 'Suppletie indienen'
                : 'Aangifte indienen en periode vastzetten'}
          </button>
          <p className="text-muted-foreground text-xs">
            Indienen zet de perioden in deze aangifte op zacht afgesloten. Alleen de accountant kan
            er daarna nog in boeken, en zo'n correctie vraagt een suppletie.
          </p>
        </form>
      )}
    </>
  )
}
