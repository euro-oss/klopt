import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { intlTag } from '~/i18n/locale'
import { useT } from '~/i18n/provider'
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

/**
 * Month names in whichever language the page is in.
 *
 * Derived rather than listed: the twelve names are the same twelve facts Intl
 * already holds, and a second copy of them is a second thing to translate.
 * Safe across hydration because the locale is decided on the server, so both
 * renders ask for the same one.
 */
function monthNames(tag: string): readonly string[] {
  const format = new Intl.DateTimeFormat(tag, { month: 'long', timeZone: 'UTC' })
  return Array.from({ length: 12 }, (_, index) => format.format(new Date(Date.UTC(2026, index, 1))))
}

function Setup() {
  const { session, setup } = Route.useLoaderData()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const { t, locale } = useT()
  const months = monthNames(intlTag(locale))

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
      <h1 className="text-2xl font-semibold tracking-tight">{t('setup.title')}</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {t('setup.intro', { email: session.user.email })}
      </p>

      {!setup.ok && (
        <p role="alert" className="text-destructive mt-6 text-sm">
          {t('setup.chartsFailed', { detail: setup.problem.detail })}
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
            {t('setup.name')}
          </span>
          <input
            name="name"
            required
            autoFocus
            placeholder={t('setup.namePlaceholder')}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
          {problem('name')}
        </label>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t('setup.legalName')} <span className="opacity-70">{t('setup.optional')}</span>
          </span>
          <input
            name="legalName"
            placeholder={t('setup.legalNamePlaceholder')}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
          {problem('legalName')}
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t('setup.kvk')} <span className="opacity-70">{t('setup.optional')}</span>
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
              {t('setup.vat')} <span className="opacity-70">{t('setup.optional')}</span>
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
            {t('setup.chart')}
          </span>
          <select
            aria-label={t('setup.chart')}
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
              {t('setup.chartSummary', {
                accounts: String(available[0].accountCount),
                journals: String(available[0].journalCount),
                taxCodes: String(available[0].taxCodeCount),
                rgs: available[0].rgsVersion,
              })}
            </span>
          )}
          {problem('chartCode')}
        </label>

        <div className="grid grid-cols-3 gap-4">
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t('setup.currency')}
            </span>
            <input
              name="functionalCurrency"
              defaultValue="EUR"
              maxLength={3}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm uppercase"
            />
            {problem('functionalCurrency')}
          </label>

          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t('setup.fiscalYear')}
            </span>
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
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t('setup.startsIn')}
            </span>
            <select
              aria-label={t('setup.startsIn')}
              name="fiscalYearStartMonth"
              defaultValue="1"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            >
              {months.map((month, index) => (
                <option key={month} value={String(index + 1)}>
                  {month}
                </option>
              ))}
            </select>
            {problem('fiscalYearStartMonth')}
          </label>
        </div>

        <p className="text-muted-foreground text-xs">{t('setup.fiscalYearNote')}</p>

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
            {busy ? t('common.busy') : t('setup.create')}
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
          {t('shell.signOut')}
        </button>
      </form>
    </main>
  )
}
