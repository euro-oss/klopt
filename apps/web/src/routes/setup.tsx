import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useHydrated } from '~/lib/hydration'
import { getSession } from '~/server/context'
import { beginSetup, createAdministration } from '~/server/setup'

/**
 * Setting up the first administration.
 *
 * This screen exists because principle 4 says self-hosted is complete, not
 * crippled, and until it did the only way to get a first set of books was to
 * run a test fixture. Signing in and finding nothing you can do is the most
 * complete kind of crippled there is.
 *
 * Outside the `_app` layout on purpose: that layout is about being inside an
 * administration, and this is how one comes to exist.
 *
 * One screen, one submit, and every field but the name has a defensible
 * default — a Dutch MKB chart, euros, a calendar book year starting this year.
 * The alternative is a wizard, and a wizard for eight fields is a way of
 * making a five-minute job feel like a migration.
 */
export const Route = createFileRoute('/setup')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (session === null) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
    return { session }
  },
  loader: async ({ context }) => ({ session: context.session, setup: await beginSetup() }),
  component: Setup,
})

interface ChartSummary {
  readonly code: string
  readonly name: string
  readonly description: string
  readonly currency: string
  readonly rgsVersion: string
  readonly accountCount: number
  readonly journalCount: number
  readonly taxCodeCount: number
}

const MONTHS = [
  'januari',
  'februari',
  'maart',
  'april',
  'mei',
  'juni',
  'juli',
  'augustus',
  'september',
  'oktober',
  'november',
  'december',
]

function Setup() {
  const { session, setup } = Route.useLoaderData()
  const navigate = useNavigate()
  const hydrated = useHydrated()

  const available: readonly ChartSummary[] = setup.ok ? setup.data.charts : []

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  /**
   * One id per visit, held across re-renders so that submitting twice submits
   * the same id — which is the whole of this form's idempotency. See the note
   * on `beginSetup`.
   */
  const entityId = useRef<string>(setup.ok ? setup.data.entityId : '')

  const thisYear = String(new Date().getUTCFullYear())

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    // FormData values are `string | File`; only the string branch is ours.
    const text = (key: string): string => {
      const value = form.get(key)
      return typeof value === 'string' ? value.trim() : ''
    }

    setBusy(true)
    setError(null)
    setFieldErrors({})

    const result = await createAdministration({
      data: {
        entityId: entityId.current,
        name: text('name'),
        legalName: text('legalName') === '' ? null : text('legalName'),
        kvkNumber: text('kvkNumber') === '' ? null : text('kvkNumber'),
        vatNumber: text('vatNumber') === '' ? null : text('vatNumber'),
        chartCode: text('chartCode'),
        functionalCurrency: text('functionalCurrency'),
        fiscalYearStartMonth: text('fiscalYearStartMonth'),
        firstFiscalYear: text('firstFiscalYear'),
      },
    })

    if (!result.ok) {
      setBusy(false)
      const byField: Record<string, string> = {}
      for (const item of result.problem.violations) {
        if (item.path !== null) byField[item.path] = item.message
      }
      setFieldErrors(byField)
      // Only summarise when there is nothing to put next to a field. A message
      // shown twice — once on the input and once at the bottom — reads as two
      // problems, and the summary carries the machine-readable code with it.
      setError(
        Object.keys(byField).length > 0 && byField['name'] === undefined
          ? null
          : result.problem.detail,
      )
      return
    }

    // A document navigation, so the layout's guard re-reads the memberships
    // this just created rather than a loader result cached before it existed.
    await navigate({ to: '/', reloadDocument: true })
  }

  const problem = (field: string) =>
    fieldErrors[field] === undefined ? null : (
      <p role="alert" className="text-destructive mt-1 text-xs">
        {fieldErrors[field]}
      </p>
    )

  return (
    <main className="bg-background text-foreground mx-auto min-h-screen max-w-xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Nieuwe administratie</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Je bent aangemeld als {session.user.email}. Vul een naam in — de rest kun je later nog
        wijzigen.
      </p>

      {!setup.ok && (
        <p role="alert" className="text-destructive mt-6 text-sm">
          De rekeningschema&apos;s konden niet worden geladen: {setup.problem.detail}
        </p>
      )}

      <form
        onSubmit={(event) => {
          void submit(event)
        }}
        className="mt-8 space-y-5"
      >
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            Naam van de administratie
          </span>
          <input
            name="name"
            required
            autoFocus
            placeholder="Mijn Bedrijf"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
          {problem('name')}
        </label>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            Statutaire naam <span className="opacity-70">(optioneel)</span>
          </span>
          <input
            name="legalName"
            placeholder="Mijn Bedrijf B.V."
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
          {problem('legalName')}
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              KvK-nummer <span className="opacity-70">(optioneel)</span>
            </span>
            <input
              name="kvkNumber"
              inputMode="numeric"
              placeholder="12345678"
              className="border-input bg-background tabular w-full rounded-md border px-3 py-2 text-sm"
            />
            {problem('kvkNumber')}
          </label>

          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              Btw-nummer <span className="opacity-70">(optioneel)</span>
            </span>
            <input
              name="vatNumber"
              placeholder="NL123456789B01"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            {problem('vatNumber')}
          </label>
        </div>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            Rekeningschema
          </span>
          <select
            name="chartCode"
            defaultValue={available[0]?.code ?? 'nl-mkb'}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            {available.map((chart) => (
              <option key={chart.code} value={chart.code}>
                {chart.name}
              </option>
            ))}
          </select>
          {available[0] !== undefined && (
            <span className="text-muted-foreground mt-1 block text-xs">
              {available[0].accountCount} grootboekrekeningen, {available[0].journalCount} dagboeken
              en {available[0].taxCodeCount} btw-codes, gekoppeld aan RGS {available[0].rgsVersion}.
            </span>
          )}
          {problem('chartCode')}
        </label>

        <div className="grid grid-cols-3 gap-4">
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">Valuta</span>
            <input
              name="functionalCurrency"
              defaultValue="EUR"
              maxLength={3}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm uppercase"
            />
            {problem('functionalCurrency')}
          </label>

          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">Boekjaar</span>
            <input
              name="firstFiscalYear"
              defaultValue={thisYear}
              inputMode="numeric"
              maxLength={4}
              className="border-input bg-background tabular w-full rounded-md border px-3 py-2 text-sm"
            />
            {problem('firstFiscalYear')}
          </label>

          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">Begint in</span>
            <select
              name="fiscalYearStartMonth"
              defaultValue="1"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={String(index + 1)}>
                  {month}
                </option>
              ))}
            </select>
            {problem('fiscalYearStartMonth')}
          </label>
        </div>

        <p className="text-muted-foreground text-xs">
          Een boekjaar hoeft geen kalenderjaar te zijn. Het jaar heet naar de maand waarin het
          begint, dus een boekjaar dat in juli 2026 opent, heet 2026.
        </p>

        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={busy || !hydrated}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Bezig…' : 'Administratie aanmaken'}
          </button>
        </div>
      </form>

      {/* Outside the form above: a form inside a form is not valid HTML, and
          the browser drops the inner one silently. */}
      <form method="post" action="/sign-out" className="mt-8">
        <button
          type="submit"
          className="text-muted-foreground hover:text-foreground text-sm underline"
        >
          Afmelden
        </button>
      </form>
    </main>
  )
}
