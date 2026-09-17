import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { findingMessage, vatPeriodLabel, violationMessage } from '~/i18n/labels'
import { useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
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

  /** Anything the tables do not know is shown raw rather than as a blank. */
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

  if (!icp.ok) {
    return (
      <>
        <PageHeader title={t('icp.title')} />
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

  return (
    <>
      <PageHeader
        title={t('icp.titleFor', {
          period: vatPeriodLabel(t, tag, data.period.kind, data.period.code),
        })}
        description={t('vatReturn.intro', {
          from: formatDate(data.period.from),
          to: formatDate(data.period.to),
          deadline: formatDate(data.period.deadline),
        })}
        actions={
          <Link
            to="/vat/$period"
            params={{ period: data.period.code }}
            className="text-sm underline"
          >
            {t('icp.toVatReturn')}
          </Link>
        }
      />

      <div className="mb-8 flex flex-wrap gap-8">
        <Stat label={t('icp.goods')} value={<Money amount={data.goods} />} />
        <Stat label={t('icp.services')} value={<Money amount={data.services} />} />
        <Stat label={t('icp.totalDeclared')} value={<Money amount={data.total} />} />
        <Stat
          label={t('icp.rubriek3b')}
          value={<Money amount={data.rubriek3b} />}
          hint={data.difference === '0' ? t('icp.reconciles') : t('icp.doesNotReconcile')}
          tone={data.difference === '0' ? 'good' : 'warn'}
        />
      </div>

      <p className="text-muted-foreground mb-6 max-w-2xl text-sm">{t('icp.intro')}</p>

      <table className="border-border mb-8 w-full max-w-4xl border-collapse text-sm">
        <caption className="sr-only">{t('icp.caption')}</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="py-2 pr-2 font-medium">
              {t('icp.vatNumber')}
            </th>
            <th scope="col" className="py-2 pr-2 font-medium">
              {t('icp.customer')}
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              {t('icp.goods')}
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              {t('icp.services')}
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
                {t('icp.empty')}
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
                  <span className="text-destructive">{t('icp.neverChecked')}</span>
                ) : (
                  <span
                    className={entry.proof.outcome === 'valid' ? undefined : 'text-destructive'}
                  >
                    {outcomeOf(entry.proof.outcome)}
                    {t('icp.checkedOn')}
                    <span className="tabular">
                      {formatDate(entry.proof.checkedAt.slice(0, 10))}
                    </span>
                    {entry.proof.requestIdentifier === null ? (
                      <span className="text-muted-foreground">{t('icp.noConsultationNumber')}</span>
                    ) : (
                      <span className="text-muted-foreground">
                        {t('icp.consultationNumber', {
                          number: entry.proof.requestIdentifier,
                        })}
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
            ? t('common.busy')
            : unchecked.length === 0
              ? t('icp.allConfirmed')
              : plural('icp.checkCount', unchecked.length)}
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
            {t('icp.recheckAll')}
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
          <h2 className="mb-3 text-sm font-semibold">{t('icp.findings')}</h2>
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
