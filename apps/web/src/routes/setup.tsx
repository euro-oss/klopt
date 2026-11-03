import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { BookOpen, Download, FileText } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LegalAgreementCheckbox, PrivacyNoticeLink } from '~/components/legal-links'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Keycap } from '~/components/ui/keycap'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import { violationMessage } from '~/i18n/labels'
import { intlTag } from '~/i18n/locale'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { isApple } from '~/lib/keyboard'
import { cn } from '~/lib/utils'
import { getSession } from '~/server/context'
import { getLegalConfig } from '~/server/legal'
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
 * Desktop-light reskin of the #106 Setup board (#138 / #140). The board's
 * History and Bank steps are not shipped yet, so the stepper stays hidden —
 * submit provisions via `PUT /entities/{id}` and lands on Home. Dark and
 * phone follow later boards.
 */
export const Route = createFileRoute('/setup')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (session === null) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
    return { session }
  },
  loader: async ({ context }) => ({
    session: context.session,
    setup: await beginSetup(),
    legal: await getLegalConfig(),
  }),
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

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="bg-brand text-[var(--on-brand)] inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-sm font-bold"
    >
      K
    </span>
  )
}

function ImportHint({
  icon,
  title,
  meta,
}: {
  readonly icon: ReactNode
  readonly title: string
  readonly meta: string
}) {
  return (
    <div className="border-line bg-surface flex items-start gap-3 rounded-[var(--radius-md)] border px-3 py-3">
      <span className="bg-surface-sunken text-ink inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-ink block text-sm font-medium">{title}</span>
        <span className="text-ink-2 block text-[13px]">{meta}</span>
      </span>
    </div>
  )
}

function isLegalAcceptanceRequired(item: {
  readonly code?: string
  readonly messageKey?: string | null
}): boolean {
  return (
    item.code === 'legal_acceptance_required' || item.messageKey === 'legal_acceptance_required'
  )
}

function Setup() {
  const { session, setup, legal: loadedLegal } = Route.useLoaderData()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const { t, locale } = useT()
  const months = monthNames(intlTag(locale))

  const available: readonly ChartSummary[] = setup.ok ? setup.data.charts : []
  const primaryChart = available[0]

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [acceptedLegal, setAcceptedLegal] = useState(false)
  // After a hosted 422 on a stale (self-hosted) tab, hold the re-fetched
  // config so the checkbox appears without a full reload.
  const [legalOverride, setLegalOverride] = useState<typeof loadedLegal | null>(null)
  const legal = legalOverride ?? loadedLegal
  const modKey = isApple() ? '⌘' : 'Ctrl'

  /**
   * One id per visit, held across re-renders so that submitting twice submits
   * the same id — which is the whole of this form's idempotency. See the note
   * on `beginSetup`.
   */
  const entityId = useRef<string>(setup.ok ? setup.data.entityId : '')
  const nameRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const focusLegalCheckbox = useRef(false)

  // Focus after hydration — `autoFocus` on SSR marks a style mismatch in React 19.
  useEffect(() => {
    if (hydrated) nameRef.current?.focus()
  }, [hydrated])

  useEffect(() => {
    if (!focusLegalCheckbox.current || !legal.agreementRequired) return
    focusLegalCheckbox.current = false
    requestAnimationFrame(() => {
      document.getElementById('legal-agreement')?.focus()
    })
  }, [legal.agreementRequired, fieldErrors])

  useEffect(() => {
    if (!hydrated) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter') return
      const wantsMod = isApple() ? event.metaKey : event.ctrlKey
      if (!wantsMod || event.shiftKey || event.altKey) return
      if (formRef.current === null || busy) return
      event.preventDefault()
      formRef.current.requestSubmit()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [hydrated, busy])

  const thisYear = String(new Date().getUTCFullYear())

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (legal.agreementRequired && !acceptedLegal) {
      setFieldErrors({ acceptedLegal: t('legal.required') })
      setError(null)
      // Focus the checkbox so the aria-invalid message is not orphaned.
      requestAnimationFrame(() => {
        document.getElementById('legal-agreement')?.focus()
      })
      return
    }

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
        acceptedLegal,
      },
    })

    if (!result.ok) {
      setBusy(false)
      const needsLegal = result.problem.violations.some(isLegalAcceptanceRequired)
      if (needsLegal) {
        // Stale tab / mixed deploy: page loaded self-hosted, server is now
        // hosted. Never show the API English — re-fetch so the checkbox
        // appears, then the same copy as the unticked client guard.
        const fresh = await getLegalConfig()
        focusLegalCheckbox.current = true
        setLegalOverride(fresh)
        setFieldErrors({ acceptedLegal: t('legal.required') })
        setError(null)
        return
      }

      const byField: Record<string, string> = {}
      for (const item of result.problem.violations) {
        if (item.path !== null) byField[item.path] = violationMessage(t, item)
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

  // Closed signup without instance-admin rights: clear Dutch copy, no form.
  // Charts failure on an open instance still shows the form's error path below.
  const createRefused = !setup.ok && setup.problem.status === 403

  if (createRefused) {
    return (
      <main className="bg-ground text-ink mx-auto min-h-screen max-w-xl p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('setup.closedTitle')}</h1>
        <p className="text-ink-2 mt-2 text-sm">{t('setup.closedBody')}</p>
        <form method="post" action="/sign-out" className="mt-8">
          <button
            type="submit"
            className="text-ink-muted hover:text-ink min-h-11 text-sm underline underline-offset-4"
          >
            {t('shell.signOut')}
          </button>
        </form>
      </main>
    )
  }

  return (
    <div className="bg-ground text-ink flex min-h-screen flex-col">
      <header className="border-line flex items-center gap-3 border-b px-6 py-5 md:px-10">
        <BrandMark />
        <strong className="text-base font-semibold">Klopt</strong>
        <span className="flex-1" />
        <span className="text-ink-muted hidden text-[13px] sm:inline">
          {t('setup.signedInAs', { email: session.user.email })}
        </span>
        <form method="post" action="/sign-out">
          <Button type="submit" variant="ghost" size="sm" className="min-h-11">
            {t('shell.signOut')}
          </Button>
        </form>
      </header>

      <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-wrap items-start gap-10 p-6 md:p-10">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-[28px] leading-[34px] font-semibold tracking-[-0.02em]">
              {t('setup.title')}
            </h1>
            <p className="text-ink-2 m-0 text-sm">{t('setup.intro')}</p>
          </div>

          {!setup.ok && (
            <p role="alert" className="text-destructive text-sm">
              {t('setup.chartsFailed', { detail: setup.problem.detail })}
            </p>
          )}

          <form
            ref={formRef}
            onSubmit={(event) => {
              void submit(event)
            }}
            className="border-line bg-surface flex flex-col gap-[18px] rounded-[var(--radius-lg)] border p-6 shadow-[var(--shadow-raised)]"
          >
            <div className="block">
              <label className="block">
                <span className="text-ink-2 mb-1.5 block text-xs font-medium">
                  {t('setup.name')}
                </span>
                <Input
                  ref={nameRef}
                  name="name"
                  required
                  placeholder={t('setup.namePlaceholder')}
                  className="border-ink-muted min-h-11"
                />
              </label>
              <span className="text-ink-muted mt-1.5 block text-[13px]">{t('setup.nameHelp')}</span>
              {problem('name')}
            </div>

            <label className="block">
              <span className="text-ink-2 mb-1.5 block text-xs font-medium">
                {t('setup.legalName')}{' '}
                <small className="text-ink-muted font-normal">{t('setup.optional')}</small>
              </span>
              <Input
                name="legalName"
                placeholder={t('setup.legalNamePlaceholder')}
                className="border-ink-muted min-h-11"
              />
              {problem('legalName')}
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="block">
                <label className="block">
                  <span className="text-ink-2 mb-1.5 block text-xs font-medium">
                    {t('setup.kvk')}{' '}
                    <small className="text-ink-muted font-normal">{t('setup.optional')}</small>
                  </span>
                  <Input
                    name="kvkNumber"
                    inputMode="numeric"
                    placeholder={t('setup.kvkPlaceholder')}
                    className="border-ink-muted min-h-11 tabular-nums"
                  />
                </label>
                <span className="text-ink-muted mt-1.5 block text-[13px]">
                  {t('setup.kvkHelp')}
                </span>
                {problem('kvkNumber')}
              </div>

              <label className="block">
                <span className="text-ink-2 mb-1.5 block text-xs font-medium">
                  {t('setup.vat')}{' '}
                  <small className="text-ink-muted font-normal">{t('setup.optional')}</small>
                </span>
                <Input
                  name="vatNumber"
                  placeholder={t('setup.vatPlaceholder')}
                  className="border-ink-muted min-h-11"
                />
                {problem('vatNumber')}
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-ink-2 mb-1.5 block text-xs font-medium">
                  {t('setup.fiscalYear')}
                </span>
                <Input
                  name="firstFiscalYear"
                  type="number"
                  inputMode="numeric"
                  required
                  defaultValue={thisYear}
                  min={1900}
                  max={2100}
                  className="border-ink-muted min-h-11 tabular-nums"
                />
                {problem('firstFiscalYear')}
              </label>

              <div>
                <SelectField
                  label={t('setup.startsIn')}
                  name="fiscalYearStartMonth"
                  defaultValue="1"
                  disabled={!hydrated}
                  triggerClassName="border-ink-muted min-h-11"
                >
                  {months.map((month, index) => (
                    <SelectOption key={month} value={String(index + 1)}>
                      {month}
                    </SelectOption>
                  ))}
                </SelectField>
                <span className="text-ink-muted mt-1.5 block text-[13px]">
                  {t('setup.fiscalYearNote')}
                </span>
                {problem('fiscalYearStartMonth')}
              </div>
            </div>

            <label className="block">
              <span className="text-ink-2 mb-1.5 block text-xs font-medium">
                {t('setup.currency')}
              </span>
              <Input
                name="functionalCurrency"
                defaultValue="EUR"
                maxLength={3}
                className="border-ink-muted min-h-11 uppercase"
                aria-label={t('setup.currency')}
              />
              {problem('functionalCurrency')}
            </label>

            <input type="hidden" name="chartCode" value={primaryChart?.code ?? 'nl-mkb'} />

            {primaryChart !== undefined && (
              <div className="bg-surface-sunken flex items-start gap-3.5 rounded-[var(--radius-md)] px-4 py-3.5">
                <span className="bg-surface text-ink inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)]">
                  <BookOpen className="size-[18px]" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong className="text-sm font-semibold">{t('setup.chartTitle')}</strong>
                  <span className="text-ink-2 text-[13px]">
                    {t('setup.chartSummary', {
                      accounts: String(primaryChart.accountCount),
                      journals: String(primaryChart.journalCount),
                      taxCodes: String(primaryChart.taxCodeCount),
                      rgs: primaryChart.rgsVersion,
                    })}
                  </span>
                </span>
                {available.length > 1 && (
                  <span className="text-ink-muted whitespace-nowrap text-[13px]">
                    {t('setup.chartOther')}
                  </span>
                )}
              </div>
            )}
            {problem('chartCode')}

            <LegalAgreementCheckbox
              legal={legal}
              checked={acceptedLegal}
              onCheckedChange={(value) => {
                setAcceptedLegal(value)
                if (value) {
                  setFieldErrors((current) => {
                    if (current['acceptedLegal'] === undefined) return current
                    const { acceptedLegal: _removed, ...rest } = current
                    return rest
                  })
                }
              }}
              disabled={busy || !hydrated}
              invalid={fieldErrors['acceptedLegal'] !== undefined}
            />
            {problem('acceptedLegal')}

            <PrivacyNoticeLink privacyUrl={legal.privacyUrl} />

            {error !== null && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button type="submit" disabled={busy || !hydrated} className="min-h-11 gap-2">
                {busy ? t('common.busy') : t('setup.create')}
                {!busy && hydrated && (
                  <span className="hidden items-center gap-0.5 sm:inline-flex">
                    <Keycap className="border-primary-foreground/30 bg-primary text-primary-foreground">
                      {modKey}
                    </Keycap>
                    <Keycap className="border-primary-foreground/30 bg-primary text-primary-foreground">
                      ↵
                    </Keycap>
                  </span>
                )}
              </Button>
              <span className="text-ink-muted text-[13px]">{t('setup.createNext')}</span>
            </div>
          </form>
        </div>

        <aside className="flex max-w-[380px] flex-[1_1_320px] flex-col gap-4">
          <h2 className="text-ink m-0 text-sm font-semibold tracking-wide uppercase">
            {t('setup.importAsideTitle')}
          </h2>
          <ImportHint
            icon={<Download className="size-[18px]" aria-hidden="true" />}
            title={t('setup.importMoneybird')}
            meta={t('setup.importMoneybirdMeta')}
          />
          <ImportHint
            icon={<Download className="size-[18px]" aria-hidden="true" />}
            title={t('setup.importExact')}
            meta={t('setup.importExactMeta')}
          />
          <ImportHint
            icon={<FileText className="size-[18px]" aria-hidden="true" />}
            title={t('setup.importAny')}
            meta={t('setup.importAnyMeta')}
          />
          <p className={cn('text-ink-muted m-0 text-[13px] leading-relaxed')}>
            {t('setup.importLater')}
          </p>
        </aside>
      </main>
    </div>
  )
}
