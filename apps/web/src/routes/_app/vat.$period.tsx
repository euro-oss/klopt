import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Check, TriangleAlert } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { findingMessage, vatPeriodLabel, violationMessage } from '~/i18n/labels'
import { VatPeriodRail } from '~/components/vat/period-rail'
import { Money } from '~/components/finance/money'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { CodeChip } from '~/components/ui/code-chip'
import { Keycap } from '~/components/ui/keycap'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { formatDate, normalizeMinorUnits } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { isTypingInto } from '~/lib/keyboard'
import { localTodayIso } from '~/lib/local-clock'
import {
  canSubmitElectronically,
  collapseEmptyRubrieken,
  formatVatHeaderDate,
  groupPeriodsByYear,
  manualFilingSummaryText,
  type VatPeriodRow,
} from '~/lib/vat-screen'
import { cn } from '~/lib/utils'
import {
  fileVatReturn,
  getVatReturn,
  listFilingSubmissions,
  listVatPeriods,
  pollFilingStatus,
} from '~/server/vat'

/**
 * VAT return — Vat board (#132 / #107 Phase 8).
 *
 * Period rail + box-by-box return + reconciliation. Leads with manual filing;
 * electronic submit only when Digipoort/SBR is available on this install.
 * `[` / `]` change period, `D` downloads the plain-text summary, `↵` expands a
 * focused box. Blocking findings still block marking the return.
 */
export const Route = createFileRoute('/_app/vat/$period')({
  loader: async ({ params }) => {
    const year = Number(params.period.slice(0, 4))
    const aangifte = await getVatReturn({ data: { period: params.period } })
    const filingId = aangifte.ok ? aangifte.data.filing?.id : undefined
    const [currentYear, previousYear, submissions] = await Promise.all([
      listVatPeriods({
        data: { year: Number.isFinite(year) ? year : new Date().getUTCFullYear() },
      }),
      listVatPeriods({
        data: { year: (Number.isFinite(year) ? year : new Date().getUTCFullYear()) - 1 },
      }),
      filingId === undefined
        ? Promise.resolve(null)
        : listFilingSubmissions({ data: { filingId } }),
    ])
    const periods: VatPeriodRow[] = [
      ...(previousYear.ok ? previousYear.data.periods : []),
      ...(currentYear.ok ? currentYear.data.periods : []),
    ]
    return {
      period: params.period,
      aangifte,
      periods,
      submissions,
    }
  },
  pendingComponent: VatPending,
  component: VatReturnScreen,
})

function VatPending() {
  const { t } = useT()
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <p className="sr-only">{t('common.busy')}</p>
      <div className="bg-muted h-10 w-48 animate-pulse rounded-[var(--radius-md)]" />
      <div className="bg-muted h-64 animate-pulse rounded-[var(--radius-xl)]" />
    </div>
  )
}

const TRANSPORT_KEY: Record<string, MessageKey> = {
  manual: 'vatReturn.transport.manual',
  digipoort: 'vatReturn.transport.digipoort',
  sbr_provider: 'vatReturn.transport.sbr_provider',
}

const DELIVERY_KEY: Record<string, MessageKey> = {
  prepared: 'vatReturn.delivery.prepared',
  delivered: 'vatReturn.delivery.delivered',
  accepted: 'vatReturn.delivery.accepted',
  rejected: 'vatReturn.delivery.rejected',
  failed: 'vatReturn.delivery.failed',
}

const INTERACTION_KEY: Record<string, MessageKey> = {
  deliver: 'vatReturn.interaction.deliver',
  status: 'vatReturn.interaction.status',
  confirmation: 'vatReturn.interaction.confirmation',
}

const FINDING_KEY: Record<string, MessageKey> = {
  unknown_tax_code: 'vatReturn.finding.unknown_tax_code',
  no_rule_in_force: 'vatReturn.finding.no_rule_in_force',
  code_declares_no_vat: 'vatReturn.finding.code_declares_no_vat',
  code_declares_no_base: 'vatReturn.finding.code_declares_no_base',
  untagged_control_movement: 'vatReturn.finding.untagged_control_movement',
  moneybird_untagged_vat: 'vatReturn.finding.moneybird_untagged_vat',
  moneybird_self_assessed_unsupported: 'vatReturn.finding.moneybird_self_assessed_unsupported',
  rate_mismatch: 'vatReturn.finding.rate_mismatch',
  control_account_difference: 'vatReturn.finding.control_account_difference',
}

function VatReturnScreen() {
  const { aangifte, periods, submissions, period: periodCode } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const { t, plural, tag, locale } = useT()

  const transportOf = (kind: string, fallback = kind) => {
    const key = TRANSPORT_KEY[kind]
    return key === undefined ? fallback : t(key)
  }
  const deliveryOf = (status: string) => {
    const key = DELIVERY_KEY[status]
    return key === undefined ? status : t(key)
  }
  const interactionOf = (interaction: string) => {
    const key = INTERACTION_KEY[interaction]
    return key === undefined ? interaction : t(key)
  }
  const findingOf = (code: string) => {
    const key = FINDING_KEY[code]
    return key === undefined ? code : t(key)
  }

  const [open, setOpen] = useState<string | null>(null)
  const [showEmpty, setShowEmpty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string[] | null>(null)
  const [accept, setAccept] = useState(false)
  const key = useRef<string>(crypto.randomUUID())
  const pollKey = useRef<string>(crypto.randomUUID())
  const boxRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  const downloadRef = useRef<() => void>(() => {})

  const data = aangifte.ok ? aangifte.data : null
  const warnings = data?.findings.filter((finding) => finding.severity === 'warning') ?? []
  const blocking = data?.findings.filter((finding) => finding.severity === 'blocking') ?? []
  const filing = data?.filing ?? null
  const needsSuppletie = (filing?.suppletieNeeded ?? []).length > 0
  const canMark =
    data !== null &&
    !data.blocked &&
    data.taxonomy.problem === null &&
    data.identity.ready &&
    (filing === null || needsSuppletie)
  const electronic = data !== null && canSubmitElectronically(data.transports)
  const usable =
    data?.transports.filter((transport) => {
      if (!transport.available) return false
      if (transport.kind === 'manual') return true
      return electronic && (transport.kind === 'digipoort' || transport.kind === 'sbr_provider')
    }) ?? []
  const history = submissions !== null && submissions.ok ? submissions.data.submissions : []
  const lastInstance = [...history].reverse().find((entry) => entry.hasInstance) ?? null
  const collapsed = data === null ? null : collapseEmptyRubrieken(data.rubrieken, showEmpty)
  const periodLabel =
    data === null ? periodCode : vatPeriodLabel(t, tag, data.period.kind, data.period.code)
  const today = localTodayIso()
  const icpEmpty = data?.rubrieken.find((row) => row.id === '3b')?.base === '0'

  function downloadSummary(): void {
    if (data === null) return
    if (lastInstance !== null) {
      window.location.assign(`/api/v1/vat/submissions/${lastInstance.id}/instance?format=summary`)
      return
    }
    const text = manualFilingSummaryText({
      periodLabel,
      from: data.period.from,
      to: data.period.to,
      deadline: data.period.deadline,
      payable: data.payable,
      rubrieken: data.rubrieken,
    })
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `btw-${data.period.code}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    downloadRef.current = downloadSummary
  })

  useEffect(() => {
    if (!hydrated) return

    const onKey = (event: KeyboardEvent): void => {
      if (isTypingInto(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === '[' || event.key === ']') {
        event.preventDefault()
        // Same order as the rail: newest year first, newest period first.
        const codes = groupPeriodsByYear(periods).flatMap((group) =>
          group.periods.map((row) => row.code),
        )
        const index = codes.indexOf(periodCode)
        if (index < 0 || codes.length === 0) return
        // `[` = older (down the rail), `]` = newer (up the rail).
        const next =
          event.key === '['
            ? codes[Math.min(index + 1, codes.length - 1)]
            : codes[Math.max(index - 1, 0)]
        if (next === undefined || next === periodCode) return
        void navigate({ to: '/vat/$period', params: { period: next } })
        return
      }

      if (event.key === 'd' || event.key === 'D') {
        event.preventDefault()
        downloadRef.current()
        return
      }

      if (event.key === 'Enter' && open === null) {
        const focused = document.activeElement
        if (focused instanceof HTMLElement) {
          const rubriek = focused.getAttribute('data-rubriek')
          if (rubriek !== null && rubriek !== '') {
            event.preventDefault()
            setOpen(rubriek)
          }
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [hydrated, periods, periodCode, navigate, open])

  if (!aangifte.ok || data === null || collapsed === null) {
    return (
      <div className="flex flex-col gap-5 md:flex-row md:gap-6">
        <VatPeriodRail periods={periods} activeCode={periodCode} icpEmpty icpPeriod={periodCode} />
        <p role="alert" className="text-destructive text-sm">
          {aangifte.ok ? t('common.busy') : aangifte.problem.detail}
        </p>
      </div>
    )
  }

  async function poll(): Promise<void> {
    if (filing === null) return
    setBusy(true)
    setError(null)
    const result = await pollFilingStatus({
      data: { filingId: filing.id, idempotencyKey: pollKey.current },
    })
    setBusy(false)
    pollKey.current = crypto.randomUUID()
    if (!result.ok) {
      setError([result.problem.detail])
      return
    }
    await router.invalidate()
  }

  const detailFor = (rubriek: string) =>
    data.detail.find((entry) => entry.rubriek === rubriek)?.lines ?? []

  async function mark(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const element = event.currentTarget
    const form = new FormData(element)
    const text = (name: string): string => {
      const value = form.get(name)
      return typeof value === 'string' ? value.trim() : ''
    }

    setBusy(true)
    setError(null)

    if (data === null) return
    const result = await fileVatReturn({
      data: {
        idempotencyKey: key.current,
        body: {
          period: data.period.code,
          transport: text('transport') || 'manual',
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
          ? result.problem.violations.map((item) => violationMessage(t, item))
          : [result.problem.detail],
      )
      return
    }

    key.current = crypto.randomUUID()
    setAccept(false)
    await router.invalidate()
  }

  const reconOk =
    !data.blocked &&
    data.reconciliation.length > 0 &&
    data.reconciliation.every((account) => account.difference === '0')

  return (
    <div className="flex flex-col items-stretch gap-5 md:flex-row md:items-start md:gap-6 lg:gap-8">
      <VatPeriodRail
        periods={periods}
        activeCode={periodCode}
        icpEmpty={icpEmpty ?? true}
        icpPeriod={periodCode}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-5">
        {/*
          <640: title → subline → full-width actions (44px), so the period title
          is not squeezed beside Download. ≥640: title + actions on one row.
        */}
        <header className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <h2 className="text-foreground col-start-1 row-start-1 m-0 text-xl leading-[26px] font-semibold">
            {t('vatReturn.titleFor', { period: periodLabel })}
          </h2>
          <p className="text-muted-foreground col-start-1 row-start-2 m-0 max-w-prose text-sm sm:col-span-2">
            {t('vatReturn.intro', {
              from: formatVatHeaderDate(data.period.from, locale),
              to: formatVatHeaderDate(data.period.to, locale),
              deadline: formatVatHeaderDate(data.period.deadline, locale),
            })}
          </p>
          <div className="col-start-1 row-start-3 flex w-full flex-col gap-2 sm:col-start-2 sm:row-start-1 sm:w-auto sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full sm:h-10 sm:w-auto"
              disabled={!hydrated}
              onClick={() => downloadSummary()}
            >
              {t('vatReturn.downloadManual')}
              <span className="sr-only">.</span>
              <Keycap className="ml-2 hidden md:inline-flex">D</Keycap>
            </Button>
            {/* Phone only: hint under Download when electronic filing is hidden (desktop has the yellow notice). */}
            {!electronic && (
              <p className="text-muted-foreground m-0 text-sm sm:hidden">
                {t('vatReturn.fileElectronicUnavailable')}
              </p>
            )}
            {/* Per product decision: never show a disabled electronic CTA — only when Digipoort/SBR can submit. */}
            {electronic && (
              <Button
                type="submit"
                form="vat-mark-form"
                className="h-11 w-full sm:h-10 sm:w-auto"
                disabled={!hydrated || !canMark || busy}
              >
                {t('vatReturn.fileElectronic')}
                <span className="ml-2 hidden items-center gap-0.5 md:inline-flex">
                  <Keycap className="border-primary-foreground/40 bg-primary text-primary-foreground">
                    ⌘
                  </Keycap>
                  <Keycap className="border-primary-foreground/40 bg-primary text-primary-foreground">
                    ↵
                  </Keycap>
                </span>
              </Button>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label={t('vatReturn.statCharged')}
            value={<Money amount={data.owed} />}
            meta={t('vatReturn.statChargedMeta')}
          />
          <StatCard
            label={t('vatReturn.statClaim')}
            value={<Money amount={-normalizeMinorUnits(data.deductible)} />}
            meta={t('vatReturn.statClaimMeta')}
          />
          <StatCard
            label={BigInt(data.payable) < 0n ? t('vatReturn.statRefund') : t('vatReturn.statPay')}
            value={<Money amount={data.payable} />}
            meta={t('vatReturn.statPayMeta', { date: formatDate(data.period.deadline) })}
            emphasis
          />
        </div>

        {(data.taxonomy.problem !== null ||
          (!data.taxonomy.verified && data.taxonomy.version !== null)) && (
          <Alert variant="attention" aria-label={t('vatReturn.blockedCallout')}>
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>{t('vatReturn.taxonomyBlockedTitle')}</AlertTitle>
            <AlertDescription>
              {data.taxonomy.problem !== null
                ? data.taxonomy.problem
                : t('vatReturn.taxonomyBlockedBody')}
            </AlertDescription>
          </Alert>
        )}

        {filing !== null && (
          <section className="bg-card border-border rounded-[var(--radius-xl)] border p-4 text-sm shadow-[var(--shadow-raised)]">
            <p>
              {t('vatReturn.marked')}
              {filing.filedAt !== null &&
                t('vatReturn.markedOn', { date: formatDate(filing.filedAt.slice(0, 10)) })}
              {filing.sequence > 1 &&
                t('vatReturn.asSupplement', { number: String(filing.sequence - 1) })}
              {filing.transport !== null && ` — ${transportOf(filing.transport)}`}.
            </p>
            {filing.deliveryStatus !== null && (
              <p className="mt-2">
                {t('vatReturn.deliveryStatus')}{' '}
                <span
                  className={
                    filing.deliveryStatus === 'rejected' || filing.deliveryStatus === 'failed'
                      ? 'text-destructive'
                      : filing.deliveryStatus === 'accepted'
                        ? undefined
                        : 'text-unreconciled'
                  }
                >
                  {deliveryOf(filing.deliveryStatus)}
                </span>
                {filing.transportReference !== null && (
                  <span className="text-muted-foreground">
                    {t('vatReturn.reference', { reference: filing.transportReference })}
                  </span>
                )}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-4">
              {lastInstance !== null && (
                <>
                  <a
                    href={`/api/v1/vat/submissions/${lastInstance.id}/instance`}
                    className="text-link text-sm underline underline-offset-2"
                  >
                    {t('vatReturn.downloadInstance')}
                  </a>
                  <a
                    href={`/api/v1/vat/submissions/${lastInstance.id}/instance?format=summary`}
                    className="text-link text-sm underline underline-offset-2"
                  >
                    {t('vatReturn.downloadSummary')}
                  </a>
                </>
              )}
              {filing.transport !== null &&
                filing.transport !== 'manual' &&
                filing.transportReference !== null && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!hydrated || busy}
                    onClick={() => {
                      void poll()
                    }}
                  >
                    {busy ? t('common.busy') : t('vatReturn.pollStatus')}
                  </Button>
                )}
            </div>
            {history.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs underline">
                  {plural('vatReturn.evidence', history.length)}
                </summary>
                <table className="mt-2 w-full max-w-3xl text-xs">
                  <caption className="sr-only">{t('vatReturn.evidenceCaption')}</caption>
                  <thead>
                    <tr className="text-muted-foreground text-left">
                      <th scope="col">{t('vatReturn.when')}</th>
                      <th scope="col">{t('vatReturn.what')}</th>
                      <th scope="col">{t('invoices.status')}</th>
                      <th scope="col">{t('vatReturn.referenceColumn')}</th>
                      <th scope="col">{t('vatReturn.explanation')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <tr key={entry.id}>
                        <td className="tabular py-1">{entry.at.slice(0, 19).replace('T', ' ')}</td>
                        <td className="py-1">{interactionOf(entry.interaction)}</td>
                        <td className="py-1">{deliveryOf(entry.status)}</td>
                        <td className="py-1">{entry.reference ?? '—'}</td>
                        <td className="py-1">{entry.error ?? entry.instructions ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
            {needsSuppletie && (
              <div className="mt-3">
                <p className="text-unreconciled font-medium">{t('vatReturn.suppletieNeeded')}</p>
                <table className="mt-2 w-full max-w-2xl text-sm">
                  <caption className="sr-only">{t('vatReturn.suppletieCaption')}</caption>
                  <thead>
                    <tr className="text-muted-foreground text-left text-xs">
                      <th scope="col">{t('vatReturn.rubriek')}</th>
                      <th scope="col" className="text-right">
                        {t('vatReturn.markedAmount')}
                      </th>
                      <th scope="col" className="text-right">
                        {t('vatReturn.nowAmount')}
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
          </section>
        )}

        <section
          className="bg-card border-border overflow-hidden rounded-[var(--radius-xl)] border shadow-[var(--shadow-raised)]"
          aria-labelledby="boxes-h"
        >
          <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h3 id="boxes-h" className="text-foreground m-0 text-base font-semibold">
              {t('vatReturn.boxesTitle')}
            </h3>
            {reconOk && (
              <span className="text-success flex items-center gap-1.5 text-[13px] font-medium">
                <Check aria-hidden="true" className="size-4" strokeWidth={2.4} />
                {t('vatReturn.matchesBooks')}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <caption className="sr-only">{t('vatReturn.rubriekenCaption')}</caption>
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left text-xs">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t('vatReturn.rubriek')}
                  </th>
                  <th scope="col" className="py-2.5 pr-3 font-medium">
                    {t('entries.description')}
                  </th>
                  <th scope="col" className="py-2.5 pr-3 text-right font-medium">
                    {t('vatReturn.base')}
                  </th>
                  <th scope="col" className="py-2.5 pr-3 text-right font-medium">
                    {t('vatReturn.vat')}
                  </th>
                  <th scope="col" className="py-2.5 pr-4 text-right font-medium">
                    {t('vatReturn.evidenceColumn')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {collapsed.visible.map((row) => {
                  const lines = detailFor(row.id)
                  const expanded = open === row.id
                  return (
                    <Fragment key={row.id}>
                      <tr
                        ref={(node) => {
                          if (node === null) boxRefs.current.delete(row.id)
                          else boxRefs.current.set(row.id, node)
                        }}
                        data-rubriek={row.id}
                        tabIndex={lines.length > 0 ? 0 : undefined}
                        className={cn(
                          'border-border/50 border-t',
                          row.computed && 'bg-surface-hover font-semibold',
                          row.id === '5c' && 'font-bold',
                        )}
                      >
                        <th scope="row" className="px-4 py-2.5 text-left font-normal">
                          <CodeChip>{row.id}</CodeChip>
                        </th>
                        <td className="py-2.5 pr-3">{row.label}</td>
                        <td className="tabular py-2.5 pr-3 text-right">
                          {row.carries === 'vat' ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <Money amount={row.base} />
                          )}
                        </td>
                        <td className="tabular py-2.5 pr-3 text-right">
                          {row.carries === 'base' ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <Money amount={row.vat} />
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-right">
                          {lines.length > 0 && (
                            <button
                              type="button"
                              disabled={!hydrated}
                              aria-expanded={expanded}
                              data-rubriek={row.id}
                              onClick={() => {
                                setOpen(expanded ? null : row.id)
                              }}
                              className="text-link text-[13px] underline-offset-2 hover:underline disabled:opacity-50"
                            >
                              {expanded
                                ? t('vatReturn.hideLines')
                                : plural('vatReturn.showLines', lines.length)}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-muted/30">
                          <td colSpan={5} className="p-3">
                            <table className="w-full text-xs">
                              <caption className="sr-only">
                                {t('vatReturn.linesBehind', { rubriek: row.id })}
                              </caption>
                              <thead>
                                <tr className="text-muted-foreground text-left">
                                  <th scope="col">{t('bank.map.bookingDate')}</th>
                                  <th scope="col">{t('vatReturn.posting')}</th>
                                  <th scope="col">{t('entryNew.account')}</th>
                                  <th scope="col">{t('entries.description')}</th>
                                  <th scope="col">{t('vatReturn.code')}</th>
                                  <th scope="col" className="text-right">
                                    {t('bank.amount')}
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
                                        className="text-link underline underline-offset-2"
                                      >
                                        {line.journalCode} {line.entryNumber}
                                      </Link>
                                    </td>
                                    <td className="tabular py-1">{line.accountNumber}</td>
                                    <td className="py-1">{line.description}</td>
                                    <td className="py-1">
                                      {line.taxCode}
                                      <span className="text-muted-foreground">
                                        {line.taxRole === 'base'
                                          ? t('vatReturn.roleBase')
                                          : t('vatReturn.roleVat')}
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
                {!showEmpty && collapsed.emptyCount > 0 && (
                  <tr className="text-muted-foreground border-border/50 border-t">
                    <td className="px-4 py-2.5" />
                    <td className="py-2.5 pr-3">
                      {t('vatReturn.emptyBoxes', { count: String(collapsed.emptyCount) })}
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <Money amount="0" />
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <Money amount="0" />
                    </td>
                    <td className="py-2.5 pr-4 text-right">
                      <button
                        type="button"
                        className="text-link text-[13px] underline-offset-2 hover:underline"
                        onClick={() => {
                          setShowEmpty(true)
                        }}
                      >
                        {t('vatReturn.showEmpty')}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section
          className="bg-card border-border flex flex-col gap-2.5 rounded-[var(--radius-xl)] border p-4 shadow-[var(--shadow-raised)]"
          aria-labelledby="rec-h"
        >
          <h3 id="rec-h" className="text-foreground m-0 text-base font-semibold">
            {t('vatReturn.trustTitle')}
          </h3>
          <p className="text-ink-2 m-0 text-sm leading-relaxed">{t('vatReturn.trustBody')}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.reconciliation.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('vatReturn.noMovements')}</p>
            ) : (
              data.reconciliation.map((account) => {
                const ok = account.difference === '0' && !data.blocked
                return (
                  <div
                    key={account.accountNumber}
                    className={cn(
                      'flex items-center justify-between rounded-[var(--radius-md)] px-3 py-2.5 text-sm',
                      ok ? 'bg-success/10' : 'bg-surface-sunken',
                    )}
                  >
                    <span>
                      <span className="tabular">{account.accountNumber}</span> {account.accountName}
                    </span>
                    <span
                      className={cn(
                        'tabular font-semibold',
                        ok
                          ? 'text-success'
                          : data.blocked
                            ? 'text-muted-foreground'
                            : 'text-destructive',
                      )}
                    >
                      <Money amount={account.declared} />
                      {ok ? ' ✓' : ''}
                    </span>
                  </div>
                )
              })
            )}
          </div>
          <table className="mt-2 w-full border-collapse text-sm">
            <caption className="sr-only">{t('vatReturn.reconciliationCaption')}</caption>
            <thead>
              <tr className="text-muted-foreground border-border border-b text-left text-xs">
                <th scope="col" className="py-2 pr-2 font-medium">
                  {t('entryNew.account')}
                </th>
                <th scope="col" className="py-2 pr-2 text-right font-medium">
                  {t('vatReturn.taggedMovement')}
                </th>
                <th scope="col" className="py-2 pr-2 text-right font-medium">
                  {t('vatReturn.declared')}
                </th>
                <th scope="col" className="py-2 pr-2 text-right font-medium">
                  {t('vatReturn.difference')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('vatReturn.untagged')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.reconciliation.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted-foreground py-3">
                    {t('vatReturn.noMovements')}
                  </td>
                </tr>
              )}
              {data.reconciliation.map((account) => {
                const moneybirdAffected = blocking.some(
                  (finding) =>
                    (finding.code === 'moneybird_untagged_vat' ||
                      finding.code === 'moneybird_self_assessed_unsupported') &&
                    finding.lines.some((line) => line.accountNumber === account.accountNumber),
                )
                return (
                  <tr key={`recon-${account.accountNumber}`} className="border-border/50 border-t">
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
                      {account.difference === '0' && moneybirdAffected ? (
                        <span className="text-destructive">{t('vatReturn.doesNotCount')}</span>
                      ) : account.difference === '0' && data.blocked ? (
                        <span className="text-muted-foreground">
                          <Money amount="0" />
                        </span>
                      ) : account.difference === '0' ? (
                        <span className="text-muted-foreground">{t('vatReturn.reconciles')}</span>
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
                )
              })}
            </tbody>
          </table>
        </section>

        {data.findings.length > 0 && (
          <section aria-labelledby="findings-h">
            <h3 id="findings-h" className="mb-3 text-base font-semibold">
              {t('vatReturn.findings', {
                blocking: String(blocking.length),
                warnings: String(warnings.length),
              })}
            </h3>
            <ul className="space-y-3">
              {data.findings.map((finding) => (
                <li
                  key={finding.code}
                  className={
                    finding.severity === 'blocking'
                      ? 'border-destructive rounded-[var(--radius-md)] border p-3 text-sm'
                      : 'border-border rounded-[var(--radius-md)] border p-3 text-sm'
                  }
                >
                  <p className="font-medium">
                    {finding.severity === 'blocking'
                      ? t('vatReturn.blockingPrefix')
                      : t('vatReturn.warningPrefix')}
                    {findingOf(finding.code)}{' '}
                    <span className="text-muted-foreground font-normal">
                      (<Money amount={finding.amount} />)
                    </span>
                  </p>
                  <p className="text-muted-foreground mt-1">{findingMessage(t, finding)}</p>
                  {finding.lines.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {finding.lines.map((line) => (
                        <li key={`${line.entryId}-${String(line.lineNumber)}`}>
                          <Link
                            to="/entries/$entryId"
                            params={{ entryId: line.entryId }}
                            className="text-link underline underline-offset-2"
                          >
                            {line.journalCode} {line.entryNumber}
                          </Link>{' '}
                          <span className="tabular">{formatDate(line.bookingDate)}</span> ·{' '}
                          <span className="tabular">{line.accountNumber}</span> · {line.description}{' '}
                          · <Money amount={line.amount} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.blocked && (
          <p role="alert" className="text-destructive max-w-2xl text-sm">
            {t('vatReturn.blocked')}
          </p>
        )}

        {!data.identity.ready && (
          <p role="alert" className="text-destructive max-w-2xl text-sm">
            {t('vatReturn.noIdentity')}{' '}
            <Link to="/settings" className="text-link underline underline-offset-2">
              {t('nav.settings')}
            </Link>
            .
          </p>
        )}

        {data.taxonomy.version !== null && (
          <p className="text-muted-foreground max-w-2xl text-sm">
            {data.taxonomy.verified
              ? t('vatReturn.taxonomy', { version: data.taxonomy.version })
              : t('vatReturn.taxonomyUnverified', { version: data.taxonomy.version })}
          </p>
        )}

        {filing !== null && !needsSuppletie && (
          <p className="text-muted-foreground max-w-2xl text-sm">
            {t('vatReturn.nothingToCorrect')}
          </p>
        )}

        {canMark && (
          <form
            id="vat-mark-form"
            onSubmit={(event) => {
              void mark(event)
            }}
            className="border-border bg-card max-w-2xl space-y-4 rounded-[var(--radius-xl)] border p-4 shadow-[var(--shadow-raised)]"
          >
            <h3 className="text-base font-semibold">
              {needsSuppletie ? t('vatReturn.markSupplement') : t('vatReturn.markReturn')}
            </h3>
            <p className="text-muted-foreground text-sm">{t('vatReturn.markIntro')}</p>
            <SelectField
              label={t('vatReturn.how')}
              name="transport"
              defaultValue={
                usable.find(
                  (transport) =>
                    transport.kind === 'digipoort' || transport.kind === 'sbr_provider',
                )?.kind ?? 'manual'
              }
              disabled={!hydrated}
            >
              {usable.map((transport) => (
                <SelectOption key={transport.kind} value={transport.kind}>
                  {transportOf(transport.kind, transport.name)}
                </SelectOption>
              ))}
            </SelectField>
            {data.transports.some((transport) => !transport.available) && (
              <ul className="text-muted-foreground -mt-2 space-y-1 text-xs">
                {data.transports
                  .filter((transport) => !transport.available)
                  .map((transport) => (
                    <li key={transport.kind}>
                      <strong className="font-medium">
                        {transportOf(transport.kind, transport.name)}
                      </strong>
                      {t('vatReturn.transportUnavailable', { reason: transport.reason ?? '' })}
                    </li>
                  ))}
              </ul>
            )}

            <div>
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs font-medium">
                  {t('vatReturn.filingReference')}
                </span>
                <input
                  name="transportReference"
                  aria-describedby="transport-reference-hint"
                  className="border-input bg-background field-control h-11 w-full rounded-[var(--radius-md)] border px-3 text-sm md:h-10"
                />
              </label>
              <p id="transport-reference-hint" className="text-muted-foreground mt-1 text-xs">
                {t('vatReturn.filingReferenceHint')}
              </p>
            </div>

            {warnings.length > 0 && (
              <div className="border-border rounded-[var(--radius-md)] border border-dashed p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={accept}
                    disabled={!hydrated}
                    onChange={(event) => {
                      setAccept(event.target.checked)
                    }}
                    className="mt-0.5"
                  />
                  <span>{plural('vatReturn.accept', warnings.length)}</span>
                </label>
                {accept && (
                  <div className="mt-3">
                    <label className="block">
                      <span className="text-muted-foreground mb-1 block text-xs font-medium">
                        {t('vatReturn.why')}
                      </span>
                      <textarea
                        name="acceptedReason"
                        required
                        rows={2}
                        aria-describedby="accepted-reason-hint"
                        className="border-input bg-background field-control w-full rounded-[var(--radius-md)] border px-3 py-2 text-sm"
                      />
                    </label>
                    <p id="accepted-reason-hint" className="text-muted-foreground mt-1 text-xs">
                      {t('vatReturn.whyHint')}
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

            <Button type="submit" disabled={!hydrated || busy || (warnings.length > 0 && !accept)}>
              {busy
                ? t('common.busy')
                : needsSuppletie
                  ? t('vatReturn.markSupplement')
                  : t('vatReturn.markAndClose')}
            </Button>
            <p className="text-muted-foreground text-xs">{t('vatReturn.markNote')}</p>
          </form>
        )}

        <footer className="text-muted-foreground hidden flex-wrap gap-4 text-xs md:flex">
          <span>
            <Keycap>[</Keycap> <Keycap>]</Keycap> {t('vatReturn.hintPeriods')}
          </span>
          <span>
            <Keycap>↵</Keycap> {t('vatReturn.hintLines')}
          </span>
          <span>
            <Keycap>D</Keycap> {t('vatReturn.hintDownload')}
          </span>
        </footer>
        {/* Keep today referenced so empty-rail year logic stays honest in tests. */}
        <span className="sr-only">{today}</span>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  meta,
  emphasis = false,
}: {
  readonly label: string
  readonly value: ReactNode
  readonly meta: string
  readonly emphasis?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-[var(--radius-xl)] border px-4 py-[18px]',
        emphasis
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card text-card-foreground border-border shadow-[var(--shadow-raised)]',
      )}
    >
      <span
        className={cn(
          'text-xs font-medium',
          emphasis ? 'text-primary-foreground/80' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      <span className="tabular text-2xl font-semibold tracking-tight">{value}</span>
      <span
        className={cn('text-xs', emphasis ? 'text-primary-foreground/80' : 'text-muted-foreground')}
      >
        {meta}
      </span>
    </div>
  )
}
