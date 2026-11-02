import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { findingMessage, vatPeriodLabel, violationMessage } from '~/i18n/labels'
import { Money } from '~/components/finance/money'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { CodeChip } from '~/components/ui/code-chip'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '~/components/ui/empty'
import { Keycap } from '~/components/ui/keycap'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { formatDate, formatMinorUnits } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { isTypingInto } from '~/lib/keyboard'
import { cn } from '~/lib/utils'
import { checkVatNumbers, getIcp } from '~/server/vat'

/**
 * ICP return — Icp board (#132 / #107 Phase 8).
 *
 * Per-customer list, VIES status, match against box 3b. `V` rechecks VIES.
 * Board example names/numbers must not ship — only real counterparties.
 */
export const Route = createFileRoute('/_app/vat/icp/$period')({
  loader: async ({ params }) => ({
    icp: await getIcp({ data: { period: params.period } }),
  }),
  pendingComponent: IcpPending,
  component: IcpScreen,
})

function IcpPending() {
  const { t } = useT()
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <p className="sr-only">{t('common.busy')}</p>
      <div className="bg-muted h-10 w-64 animate-pulse rounded-[var(--radius-md)]" />
      <div className="bg-muted h-48 animate-pulse rounded-[var(--radius-xl)]" />
    </div>
  )
}

const FINDING_KEY: Record<string, MessageKey> = {
  supply_without_counterparty: 'icp.finding.supply_without_counterparty',
  counterparty_without_vat_number: 'icp.finding.counterparty_without_vat_number',
  vat_number_malformed: 'icp.finding.vat_number_malformed',
  vat_number_not_eu: 'icp.finding.vat_number_not_eu',
  vat_number_invalid: 'icp.finding.vat_number_invalid',
  vat_number_unproven: 'icp.finding.vat_number_unproven',
  proof_predates_period: 'icp.finding.proof_predates_period',
  icp_mismatch: 'icp.finding.icp_mismatch',
}

const OUTCOME_KEY: Record<string, MessageKey> = {
  valid: 'icp.outcome.valid',
  invalid: 'icp.outcome.invalid',
  unavailable: 'icp.outcome.unavailable',
}

function IcpScreen() {
  const { icp } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t, plural, tag } = useT()

  const findingOf = (code: string) => {
    const key = FINDING_KEY[code]
    return key === undefined ? code : t(key)
  }
  const outcomeOf = (outcome: string) => {
    const key = OUTCOME_KEY[outcome]
    return key === undefined ? outcome : t(key)
  }

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const key = useRef<string>(crypto.randomUUID())
  const checkRef = useRef<(numbers: readonly string[]) => void>(() => {})

  const data = icp.ok ? icp.data : null
  const unchecked = useMemo(
    () =>
      data?.entries.filter((entry) => entry.proof === null || entry.proof.outcome !== 'valid') ??
      [],
    [data],
  )

  async function check(vatNumbers: readonly string[]): Promise<void> {
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
          ? result.problem.violations.map((item) => violationMessage(t, item)).join(' ')
          : result.problem.detail,
      )
      return
    }

    if (result.data.source === 'offline') {
      setNote(t('icp.offline'))
    } else if (!result.data.provenByConsultationNumber) {
      setNote(t('icp.noConsultation'))
    }

    await router.invalidate()
  }

  useEffect(() => {
    checkRef.current = (numbers) => {
      void check(numbers)
    }
  })

  useEffect(() => {
    if (!hydrated || data === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (isTypingInto(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key !== 'v' && event.key !== 'V') return
      event.preventDefault()
      const numbers = unchecked
        .map((entry) => entry.vatNumber)
        .filter((value): value is string => value !== null && value !== '')
      checkRef.current(numbers)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [hydrated, data, unchecked])

  if (!icp.ok || data === null) {
    return (
      <>
        <h1 className="text-foreground mb-4 text-2xl font-semibold">{t('icp.title')}</h1>
        <p role="alert" className="text-destructive text-sm">
          {icp.ok ? t('common.busy') : icp.problem.detail}
        </p>
      </>
    )
  }

  const periodLabel = vatPeriodLabel(t, tag, data.period.kind, data.period.code)
  const matches = data.difference === '0'
  const empty = data.entries.length === 0

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
          <Link
            to="/vat/$period"
            params={{ period: data.period.code }}
            className="text-ink-2 text-[13px] no-underline hover:underline"
          >
            {t('icp.backToVat', { period: periodLabel })}
          </Link>
          <h1 className="text-foreground m-0 text-2xl leading-[30px] font-semibold tracking-[-0.01em]">
            {t('icp.title')}
          </h1>
          <p className="text-muted-foreground m-0 text-sm">
            {t('icp.subtitle', { deadline: formatDate(data.period.deadline) })}
          </p>
        </div>
        {/* Download and electronic filing stay hidden until they work / Digipoort-SBR is available. */}
      </header>

      {empty && (
        <Alert>
          <AlertTitle>{t('icp.emptyTitle')}</AlertTitle>
          <AlertDescription>{t('icp.emptyBody')}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          label={t('icp.goods')}
          value={<Money amount={data.goods} />}
          meta={t('icp.box3bMeta')}
        />
        <Stat
          label={t('icp.services')}
          value={<Money amount={data.services} />}
          meta={t('icp.box3bMeta')}
        />
        <Stat
          label={t('icp.matchesVat')}
          value={
            <span className={matches ? 'text-success' : 'text-destructive'}>
              {matches ? t('icp.matchesYes') : t('icp.matchesNo')}
            </span>
          }
          meta={
            matches
              ? t('icp.matchesMeta', { amount: formatMinorUnits(BigInt(data.total)) })
              : t('icp.doesNotReconcile')
          }
        />
      </div>

      <section
        className="bg-card border-border overflow-hidden rounded-[var(--radius-xl)] border shadow-[var(--shadow-raised)]"
        aria-labelledby="icp-customers-h"
      >
        <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h2 id="icp-customers-h" className="text-foreground m-0 text-base font-semibold">
            {t('icp.perCustomer')}
          </h2>
          <span className="text-muted-foreground text-[13px]">{t('icp.viesHint')}</span>
        </div>

        {empty ? (
          <Empty className="rounded-none border-0">
            <EmptyHeader>
              <EmptyTitle>{t('icp.empty')}</EmptyTitle>
              <EmptyDescription>{t('icp.emptyBody')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">{t('icp.caption')}</caption>
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left text-xs">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t('icp.customer')}
                  </th>
                  <th scope="col" className="py-2.5 pr-3 font-medium">
                    {t('icp.country')}
                  </th>
                  <th scope="col" className="py-2.5 pr-3 font-medium">
                    {t('icp.vatNumber')}
                  </th>
                  <th scope="col" className="py-2.5 pr-3 text-right font-medium">
                    {t('icp.goods')}
                  </th>
                  <th scope="col" className="py-2.5 pr-4 text-right font-medium">
                    {t('icp.services')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => {
                  const proof = entry.proof
                  return (
                    <tr
                      key={`${entry.vatNumber ?? ''}-${entry.contactNumber}`}
                      className="border-border/50 border-t"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {entry.contactName ?? entry.contactNumber ?? t('icp.customer')}
                          </span>
                          <span
                            className={cn(
                              'text-xs',
                              proof?.outcome === 'valid'
                                ? 'text-success'
                                : proof?.outcome === 'invalid'
                                  ? 'text-destructive'
                                  : 'text-muted-foreground',
                            )}
                          >
                            {proof === null
                              ? t('icp.neverChecked')
                              : proof.outcome === 'valid'
                                ? t('icp.viesValid')
                                : proof.outcome === 'unavailable'
                                  ? t('icp.viesOffline', {
                                      date: formatDate(proof.checkedAt.slice(0, 10)),
                                    })
                                  : outcomeOf(proof.outcome)}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <CodeChip>{entry.countryCode || '—'}</CodeChip>
                      </td>
                      <td className="py-2.5 pr-3">
                        <CodeChip>{entry.vatNumber ?? '—'}</CodeChip>
                      </td>
                      <td className="tabular py-2.5 pr-3 text-right">
                        <Money amount={entry.goods} />
                      </td>
                      <td className="tabular py-2.5 pr-4 text-right">
                        <Money amount={entry.services} />
                      </td>
                    </tr>
                  )
                })}
                <tr className="bg-surface-hover border-border/50 border-t font-semibold">
                  <td className="px-4 py-2.5">{t('report.total')}</td>
                  <td />
                  <td />
                  <td className="tabular py-2.5 pr-3 text-right">
                    <Money amount={data.goods} />
                  </td>
                  <td className="tabular py-2.5 pr-4 text-right">
                    <Money amount={data.services} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hydrated || busy || unchecked.length === 0}
          onClick={() => {
            void check(
              unchecked
                .map((entry) => entry.vatNumber)
                .filter((value): value is string => value !== null && value !== ''),
            )
          }}
        >
          {busy ? t('common.busy') : plural('icp.checkCount', Math.max(unchecked.length, 1))}
          <Keycap className="ml-2 hidden md:inline-flex">V</Keycap>
        </Button>
        <span className="text-muted-foreground text-[13px]">{t('icp.invalidHint')}</span>
      </div>

      {note !== null && <p className="text-muted-foreground text-sm">{note}</p>}
      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {data.findings.length > 0 && (
        <ul className="max-w-3xl space-y-3">
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
                {findingOf(finding.code)}
              </p>
              <p className="text-muted-foreground mt-1">{findingMessage(t, finding)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  meta,
}: {
  readonly label: string
  readonly value: ReactNode
  readonly meta: string
}) {
  return (
    <div className="bg-card text-card-foreground border-border flex flex-col gap-1 rounded-[var(--radius-xl)] border px-4 py-[18px] shadow-[var(--shadow-raised)]">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <span className="tabular text-2xl font-semibold tracking-tight">{value}</span>
      <span className="text-muted-foreground text-xs">{meta}</span>
    </div>
  )
}
