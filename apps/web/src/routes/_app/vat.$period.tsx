import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Fragment, useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { fileVatReturn, getVatReturn, listFilingSubmissions, pollFilingStatus } from '~/server/vat'

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
  loader: async ({ params }) => {
    const aangifte = await getVatReturn({ data: { period: params.period } })
    // The delivery history, once there is something to have a history. Two
    // sequential calls rather than one: the filing's id is not knowable before
    // the return has been read.
    const filingId = aangifte.ok ? aangifte.data.filing?.id : undefined
    return {
      period: params.period,
      aangifte,
      submissions:
        filingId === undefined ? null : await listFilingSubmissions({ data: { filingId } }),
    }
  },
  component: VatReturnScreen,
})

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
  rate_mismatch: 'vatReturn.finding.rate_mismatch',
  control_account_difference: 'vatReturn.finding.control_account_difference',
}

function VatReturnScreen() {
  const { aangifte, submissions } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t, plural } = useT()

  /** Anything the tables do not know is shown raw rather than as a blank. */
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string[] | null>(null)
  const [accept, setAccept] = useState(false)
  const key = useRef<string>(crypto.randomUUID())
  const pollKey = useRef<string>(crypto.randomUUID())

  if (!aangifte.ok) {
    return (
      <>
        <PageHeader title={t('vatReturn.title')} />
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
  const canFile =
    !data.blocked &&
    data.taxonomy.problem === null &&
    data.identity.ready &&
    (filing === null || needsSuppletie)
  const usable = data.transports.filter((transport) => transport.available)
  const history = submissions !== null && submissions.ok ? submissions.data.submissions : []
  const lastInstance = [...history].reverse().find((entry) => entry.hasInstance) ?? null

  async function poll() {
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
        title={t('vatReturn.titleFor', { period: data.period.label })}
        description={t('vatReturn.intro', {
          from: formatDate(data.period.from),
          to: formatDate(data.period.to),
          deadline: formatDate(data.period.deadline),
        })}
        actions={
          <div className="flex items-center gap-4">
            <Link
              to="/vat/icp/$period"
              params={{ period: data.period.code }}
              className="text-sm underline"
            >
              {t('vatReturn.icp')}
            </Link>
            <Link to="/vat" className="text-sm underline">
              {t('vatReturn.allPeriods')}
            </Link>
          </div>
        }
      />

      <div className="mb-8 flex flex-wrap gap-8">
        <Stat label={t('vatReturn.owed')} value={<Money amount={data.owed} />} />
        <Stat label={t('vatReturn.deductible')} value={<Money amount={data.deductible} />} />
        <Stat
          label={BigInt(data.payable) < 0n ? t('vatReturn.refund') : t('vatReturn.toPay')}
          value={<Money amount={data.payable} />}
          tone={data.blocked ? 'warn' : 'neutral'}
        />
      </div>

      {filing !== null && (
        <div className="border-border mb-8 rounded-md border p-4 text-sm">
          <p>
            {t('vatReturn.filed')}
            {filing.filedAt !== null &&
              t('vatReturn.filedOn', { date: formatDate(filing.filedAt.slice(0, 10)) })}
            {filing.sequence > 1 &&
              t('vatReturn.asSupplement', { number: String(filing.sequence - 1) })}
            {filing.transport !== null && ` — ${transportOf(filing.transport)}`}.
          </p>
          {/* Ontvangen is niet geaccepteerd, en dat gat is waar de problemen
              zitten. Dus staat de bezorgstatus los van "ingediend". */}
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
                  className="underline"
                >
                  {t('vatReturn.downloadInstance')}
                </a>
                <a
                  href={`/api/v1/vat/submissions/${lastInstance.id}/instance?format=summary`}
                  className="underline"
                >
                  {t('vatReturn.downloadSummary')}
                </a>
              </>
            )}
            {filing.transport !== null &&
              filing.transport !== 'manual' &&
              filing.transportReference !== null && (
                <button
                  type="button"
                  disabled={!hydrated || busy}
                  onClick={() => {
                    void poll()
                  }}
                  className="border-input rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {busy ? t('common.busy') : t('vatReturn.pollStatus')}
                </button>
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
                      {t('vatReturn.filedAmount')}
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
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold">{t('vatReturn.theReturn')}</h2>
      <table className="border-border mb-10 w-full max-w-4xl border-collapse text-sm">
        <caption className="sr-only">{t('vatReturn.rubriekenCaption')}</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="py-2 pr-2 font-medium">
              {t('vatReturn.rubriek')}
            </th>
            <th scope="col" className="py-2 pr-2 font-medium">
              {t('entries.description')}
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              {t('vatReturn.base')}
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              {t('vatReturn.vat')}
            </th>
            <th scope="col" className="py-2 font-medium">
              <span className="sr-only">{t('vatReturn.evidenceColumn')}</span>
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
        </tbody>
      </table>

      <h2 className="mb-3 text-sm font-semibold">{t('vatReturn.reconciliation')}</h2>
      <p className="text-muted-foreground mb-3 max-w-2xl text-sm">
        {t('vatReturn.reconciliationIntro')}
      </p>
      <table className="border-border mb-10 w-full max-w-4xl border-collapse text-sm">
        <caption className="sr-only">{t('vatReturn.reconciliationCaption')}</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
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
          ))}
        </tbody>
      </table>

      {data.findings.length > 0 && (
        <>
          <h2 className="mb-3 text-sm font-semibold">
            {t('vatReturn.findings', {
              blocking: String(blocking.length),
              warnings: String(warnings.length),
            })}
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
                  {finding.severity === 'blocking'
                    ? t('vatReturn.blockingPrefix')
                    : t('vatReturn.warningPrefix')}
                  {findingOf(finding.code)}{' '}
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
        {needsSuppletie ? t('vatReturn.fileSupplement') : t('vatReturn.fileReturn')}
      </h2>

      {data.blocked && (
        <p role="alert" className="text-destructive mb-4 max-w-2xl text-sm">
          {t('vatReturn.blocked')}
        </p>
      )}

      {!data.identity.ready && (
        <p role="alert" className="text-destructive mb-4 max-w-2xl text-sm">
          {t('vatReturn.noIdentity')}{' '}
          <Link to="/settings" className="underline">
            {t('nav.settings')}
          </Link>
          .
        </p>
      )}

      {data.taxonomy.problem !== null && (
        <p role="alert" className="text-destructive mb-4 max-w-2xl text-sm">
          {data.taxonomy.problem}
        </p>
      )}

      {data.taxonomy.version !== null && (
        <p className="text-muted-foreground mb-4 max-w-2xl text-sm">
          {t('vatReturn.taxonomy', { version: data.taxonomy.version })}
          {!data.taxonomy.verified && (
            <span className="text-unreconciled">{t('vatReturn.taxonomyUnverified')}</span>
          )}
        </p>
      )}

      {filing !== null && !needsSuppletie && (
        <p className="text-muted-foreground mb-4 max-w-2xl text-sm">
          {t('vatReturn.nothingToCorrect')}
        </p>
      )}

      {canFile && (
        <form
          onSubmit={(event) => {
            void file(event)
          }}
          className="border-border mb-10 max-w-2xl space-y-4 rounded-md border p-4"
        >
          <SelectField
            label={t('vatReturn.how')}
            name="transport"
            defaultValue="manual"
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
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
            </label>
            <p id="transport-reference-hint" className="text-muted-foreground mt-1 text-xs">
              {t('vatReturn.filingReferenceHint')}
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
                      className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
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

          <button
            type="submit"
            disabled={!hydrated || busy || (warnings.length > 0 && !accept)}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy
              ? t('common.busy')
              : needsSuppletie
                ? t('vatReturn.fileSupplement')
                : t('vatReturn.fileAndClose')}
          </button>
          <p className="text-muted-foreground text-xs">{t('vatReturn.fileNote')}</p>
        </form>
      )}
    </>
  )
}
