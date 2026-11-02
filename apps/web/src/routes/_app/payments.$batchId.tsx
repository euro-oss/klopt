import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { findingMessage, violationMessage } from '~/i18n/labels'
import { useEffect, useRef, useState } from 'react'
import { CostsTabs } from '~/components/costs-tabs'
import { EuroAmount, Money } from '~/components/finance/money'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { CodeChip } from '~/components/ui/code-chip'
import { Input } from '~/components/ui/input'
import { Keycap } from '~/components/ui/keycap'
import { Stepper } from '~/components/ui/stepper'
import { useT } from '~/i18n/provider'
import { formatDate, parseMinorUnits } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { batchFourEyesLine } from '~/lib/batch-four-eyes'
import { formatIbanGroups, ibanTail } from '~/lib/iban-display'
import { isApple, isTypingInto } from '~/lib/keyboard'
import { getSession } from '~/server/context'
import {
  addApprovedInvoices,
  addPaymentInstruction,
  getPaymentBatch,
  previewPaymentRun,
  removePaymentInstruction,
  transitionPaymentBatch,
} from '~/server/payments'
import { STATE_KEY } from './payments.index'

/**
 * PaymentBatch — prepare, four-eyes, download pain.001 (#107 Phase 4 / #128).
 *
 * Board: PaymentBatch.dc.html at fa4093b. A batch is a file the user uploads to
 * their bank — Klopt never pays or sends it. Hide actions that are not
 * available (no disabled CTAs). Four-eyes on existing transitions.
 */

export const Route = createFileRoute('/_app/payments/$batchId')({
  loader: async ({ params }) => ({
    batch: await getPaymentBatch({ data: { batchId: params.batchId } }),
    session: await getSession(),
    run: await previewPaymentRun({ data: { batchId: params.batchId } }),
  }),
  component: PaymentBatch,
})

interface Instruction {
  id: string
  endToEndId: string
  creditorName: string
  creditorIban: string
  creditorBic: string | null
  amount: string
  currency: string
  remittanceInformation: string
  remittanceReference: string | null
}

type BatchState = 'draft' | 'submitted' | 'approved' | 'exported' | 'rejected'

function stepIndex(state: BatchState): number {
  switch (state) {
    case 'draft':
    case 'rejected':
      return 0
    case 'submitted':
      return 1
    case 'approved':
      return 2
    case 'exported':
      // Past the last step so "Bestand gedownload" is marked done, not current.
      return 4
  }
}

function PaymentBatch() {
  const { batch: loaded, session, run } = Route.useLoaderData()
  const { batchId } = Route.useParams()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t, plural } = useT()
  const modLabel = hydrated && isApple() ? '⌘' : 'Ctrl'

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const addKey = useRef<string>(crypto.randomUUID())

  const batchOk = loaded.ok ? loaded.data : null
  const batch = batchOk?.batch ?? null
  const problems = batchOk?.problems ?? []
  const payable = batchOk?.payable ?? false
  const me = session?.user.id ?? null
  const myEmail = session?.user.email ?? null
  const iSubmitted = batch !== null && batch.submittedBy !== null && batch.submittedBy === me
  const step = batch !== null ? stepIndex(batch.state) : 0
  const billCount = batch?.instructions.length ?? 0
  const canSubmit =
    batch !== null && batch.state === 'draft' && payable && billCount > 0 && hydrated && !busy
  const canApprove =
    batch !== null && batch.state === 'submitted' && !iSubmitted && hydrated && !busy
  const canDownloadPain =
    batch !== null &&
    (batch.state === 'approved' || batch.state === 'exported') &&
    hydrated &&
    !busy
  const painHref = `/api/v1/payment-batches/${batchId}/pain001`

  async function act(
    action: 'submit' | 'approve' | 'reject' | 'reopen' | 'export',
    reason: string | null = null,
  ) {
    setBusy(true)
    setError(null)
    setNotice(null)

    const result = await transitionPaymentBatch({
      data: { batchId, idempotencyKey: crypto.randomUUID(), action, reason },
    })
    setBusy(false)

    if (!result.ok) {
      setError(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => violationMessage(t, item)).join(' ')
          : result.problem.detail,
      )
      return
    }

    setNotice(t('batch.stateNow', { state: t(STATE_KEY[result.data.state]) }))
    await router.invalidate()
  }

  function downloadPain(): void {
    const anchor = document.createElement('a')
    anchor.href = painHref
    anchor.download = ''
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  }

  useEffect(() => {
    if (!hydrated || batch === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || isTypingInto(event.target)) return
      const mod = isApple() ? event.metaKey : event.ctrlKey
      if (!mod || event.key !== 'Enter') return
      event.preventDefault()
      if (canSubmit) void act('submit')
      else if (canApprove) void act('approve')
      else if (canDownloadPain && batch.state === 'approved') downloadPain()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- act closes over batchId
  }, [hydrated, canSubmit, canApprove, canDownloadPain, batch])

  if (!loaded.ok || batch === null) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">{t('costs.title')}</h1>
        <CostsTabs active="batches" />
        <p role="alert" className="text-destructive text-sm">
          {loaded.ok ? t('common.busy') : loaded.problem.detail}
        </p>
      </>
    )
  }

  const missingIban =
    batch.instructions.some((row) => row.creditorIban.trim() === '') ||
    problems.some((problem) => problem.code === 'invalid_iban') ||
    (run.ok && run.data.findings.some((finding) => finding.code === 'no_iban'))

  const accountLabel =
    batch.debtorName !== ''
      ? `${batch.debtorName} ··· ${ibanTail(batch.debtorIban)}`
      : `··· ${ibanTail(batch.debtorIban)}`

  const heading =
    billCount > 0
      ? plural('batch.heading', billCount, {
          date: formatDate(batch.requestedExecutionDate),
          count: String(billCount),
        })
      : t('batch.headingEmpty', { reference: batch.reference })

  async function addApproved(): Promise<void> {
    setBusy(true)
    setError(null)

    const result = await addApprovedInvoices({
      data: { batchId, idempotencyKey: addKey.current },
    })
    setBusy(false)
    addKey.current = crypto.randomUUID()

    if (!result.ok) {
      setError(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => violationMessage(t, item)).join(' ')
          : result.problem.detail,
      )
      return
    }

    setNotice(
      plural('batch.paymentsAdded', result.data.added, { count: String(result.data.added) }),
    )
    await router.invalidate()
  }

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const element = event.currentTarget
    const form = new FormData(element)
    const text = (name: string): string => {
      const value = form.get(name)
      return typeof value === 'string' ? value.trim() : ''
    }

    setBusy(true)
    setError(null)

    const result = await addPaymentInstruction({
      data: {
        batchId,
        idempotencyKey: addKey.current,
        body: {
          endToEndId: text('endToEndId'),
          creditorName: text('creditorName'),
          creditorIban: text('creditorIban'),
          creditorBic: text('creditorBic') === '' ? null : text('creditorBic'),
          amount: (parseMinorUnits(text('amount')) ?? 0n).toString(),
          remittanceInformation: text('remittanceInformation'),
          remittanceReference:
            text('remittanceReference') === '' ? null : text('remittanceReference'),
        },
      },
    })
    setBusy(false)

    if (!result.ok) {
      setError(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => violationMessage(t, item)).join(' ')
          : result.problem.detail,
      )
      return
    }

    addKey.current = crypto.randomUUID()
    element.reset()
    setOpen(false)
    await router.invalidate()
  }

  async function remove(instructionId: string) {
    setBusy(true)
    setError(null)
    const result = await removePaymentInstruction({
      data: { batchId, instructionId, idempotencyKey: crypto.randomUUID() },
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.problem.detail)
      return
    }
    await router.invalidate()
  }

  const canReject = batch.state === 'submitted' && hydrated && !busy
  const canReopen = batch.state === 'rejected' && hydrated && !busy
  const canDownload = batch.state === 'approved' || batch.state === 'exported'
  const canMarkSent = batch.state === 'approved' && hydrated && !busy

  const nextCard = (() => {
    if (batch.state === 'rejected') {
      return {
        title: t('batch.next.rejectedTitle'),
        text: t('batch.next.rejectedBody'),
        cta: canReopen ? (
          <Button
            type="button"
            onClick={() => {
              void act('reopen')
            }}
          >
            {t('batch.next.reopenCta')}
          </Button>
        ) : null,
      }
    }
    if (step === 0) {
      return {
        title: t('batch.next.askTitle'),
        text: t('batch.next.askBody'),
        cta: canSubmit ? (
          <Button
            type="button"
            onClick={() => {
              void act('submit')
            }}
          >
            {t('batch.next.askCta')}
            <span className="ml-1.5 hidden gap-0.5 normal-case md:inline-flex">
              <Keycap className="border-primary-foreground/40 bg-primary text-primary-foreground">
                {modLabel}
              </Keycap>
              <Keycap className="border-primary-foreground/40 bg-primary text-primary-foreground">
                ↵
              </Keycap>
            </span>
          </Button>
        ) : null,
      }
    }
    if (step === 1) {
      return {
        title: t('batch.next.approveTitle'),
        text: t('batch.next.approveBody'),
        cta: canApprove ? (
          <Button
            type="button"
            onClick={() => {
              void act('approve')
            }}
          >
            {t('batch.next.approveCta')}
            <span className="ml-1.5 hidden gap-0.5 normal-case md:inline-flex">
              <Keycap className="border-primary-foreground/40 bg-primary text-primary-foreground">
                {modLabel}
              </Keycap>
              <Keycap className="border-primary-foreground/40 bg-primary text-primary-foreground">
                ↵
              </Keycap>
            </span>
          </Button>
        ) : null,
      }
    }
    if (step === 2) {
      return {
        title: t('batch.next.downloadTitle'),
        text: t('batch.next.downloadBody', { account: accountLabel }),
        cta: canDownload ? (
          <Button
            type="button"
            onClick={() => {
              downloadPain()
            }}
          >
            {t('batch.next.downloadCta')}
            {batch.state === 'approved' ? (
              <span className="ml-1.5 hidden gap-0.5 normal-case md:inline-flex">
                <Keycap className="border-primary-foreground/40 bg-primary text-primary-foreground">
                  {modLabel}
                </Keycap>
                <Keycap className="border-primary-foreground/40 bg-primary text-primary-foreground">
                  ↵
                </Keycap>
              </span>
            ) : null}
          </Button>
        ) : null,
      }
    }
    return {
      title: t('batch.next.waitingTitle'),
      text: t('batch.next.waitingBody'),
      cta: (
        <Button type="button" asChild>
          <Link to="/bank/match">{t('batch.next.waitingCta')}</Link>
        </Button>
      ),
    }
  })()

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('costs.title')}</h1>
        <CostsTabs active="batches" />
      </header>

      <div className="flex max-w-[1120px] flex-col gap-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
            <h2 className="text-xl font-semibold">{heading}</h2>
            <EuroAmount amount={batch.total} className="text-[28px] font-semibold tracking-tight" />
          </div>
          <Stepper
            aria-label={t('batch.steps')}
            current={step}
            steps={[
              { id: 'prepare', label: t('batch.step.prepare') },
              { id: 'approve', label: t('batch.step.approve') },
              { id: 'download', label: t('batch.step.download') },
              { id: 'downloaded', label: t('batch.step.downloaded') },
            ]}
          />
        </div>

        {step === 0 && missingIban && (
          <Alert
            variant="attention"
            className="items-start max-sm:has-data-[slot=alert-action]:pr-4"
          >
            <AlertTitle>{t('batch.missingIbanTitle')}</AlertTitle>
            <AlertDescription>{t('batch.missingIbanBody')}</AlertDescription>
            {/* Phone: flow under the body so the link never overlaps the title. */}
            <AlertAction className="static top-auto right-auto mt-2 justify-self-start sm:absolute sm:top-2.5 sm:right-3 sm:mt-0">
              <Link
                to="/contacts"
                className="text-sm font-semibold underline-offset-2 hover:underline"
              >
                {t('batch.openSuppliers')}
              </Link>
            </AlertAction>
          </Alert>
        )}

        {batch.state === 'submitted' && iSubmitted && (
          <p className="border-border text-ink-2 rounded-[var(--radius-md)] border p-3 text-sm">
            {t('batch.iSubmitted')}
          </p>
        )}

        {notice !== null && (
          <p className="border-border text-ink-2 rounded-[var(--radius-md)] border p-3 text-sm">
            {notice}
          </p>
        )}
        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        {/* Translated message only — never a raw path like "instructions:".
            When the missing-IBAN callout is up, drop empty_batch only (shot 05);
            keep invalid_iban and other findings visible. */}
        {(() => {
          const visibleProblems =
            step === 0 && missingIban
              ? problems.filter((problem) => problem.code !== 'empty_batch')
              : problems
          if (visibleProblems.length === 0) return null
          return (
            <ul role="alert" className="text-destructive space-y-1 text-sm">
              {visibleProblems.map((problem, index) => (
                <li key={index}>{findingMessage(t, problem)}</li>
              ))}
            </ul>
          )
        })()}

        <section className="border-border bg-surface overflow-hidden rounded-[var(--radius-xl)] border">
          {/* Phone: two-line rows so Bedrag / Weg are never clipped (#175). */}
          <div className="sm:hidden" data-testid="batch-lines-phone" aria-label={t('batch.lines')}>
            {batch.instructions.length === 0 ? (
              <p className="text-ink-muted px-4 py-6 text-sm">{t('batch.linesEmpty')}</p>
            ) : (
              batch.instructions.map((row: Instruction) => {
                const noIban = row.creditorIban.trim() === ''
                const billRef = row.remittanceReference ?? row.endToEndId
                const payTo = noIban ? t('batch.noIbanYet') : formatIbanGroups(row.creditorIban)
                return (
                  <div
                    key={row.id}
                    className="border-line-soft flex flex-col gap-1 border-t px-4 py-3 first:border-t-0"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-sans text-sm font-medium">
                        {row.creditorName}
                      </span>
                      <span className="shrink-0 font-mono text-sm font-medium whitespace-nowrap">
                        <EuroAmount amount={row.amount} />
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-ink-muted min-w-0 truncate font-mono text-[13px]">
                        {billRef}
                        {' · '}
                        {payTo}
                      </span>
                      {batch.editable && (
                        <button
                          type="button"
                          disabled={busy || !hydrated}
                          onClick={() => {
                            void remove(row.id)
                          }}
                          className="text-ink-muted hover:text-destructive inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-xs underline disabled:opacity-50"
                        >
                          {t('batch.remove')}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
            <div className="bg-surface-hover flex items-baseline justify-between gap-3 border-t px-4 py-3 text-sm font-semibold">
              <span className="min-w-0 truncate font-sans">
                {t('batch.totalFrom', { account: accountLabel })}
              </span>
              <span className="shrink-0 font-mono whitespace-nowrap">
                <EuroAmount amount={batch.total} />
              </span>
            </div>
          </div>

          <div className="hidden overflow-x-auto sm:block" data-testid="batch-lines-desktop">
            <table className="w-full min-w-0 text-sm" aria-label={t('batch.lines')}>
              <thead>
                <tr className="text-ink-muted border-b text-left text-xs font-semibold tracking-wide uppercase">
                  <th scope="col" className="px-4 py-2 font-semibold">
                    {t('batch.col.supplier')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-semibold">
                    {t('batch.col.bill')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-semibold">
                    {t('batch.col.payTo')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    {t('batch.col.amount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {batch.instructions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-ink-muted px-4 py-6">
                      {t('batch.linesEmpty')}
                    </td>
                  </tr>
                ) : (
                  batch.instructions.map((row: Instruction) => {
                    const noIban = row.creditorIban.trim() === ''
                    return (
                      <tr key={row.id} className="border-line-soft border-t font-mono">
                        <td className="px-4 py-3 font-sans font-medium">{row.creditorName}</td>
                        <td className="text-ink-muted px-4 py-3 font-sans text-[13px]">
                          {row.remittanceReference ?? row.endToEndId}
                        </td>
                        <td className="px-4 py-3">
                          {noIban ? (
                            <Badge variant="destructive">{t('batch.noIbanYet')}</Badge>
                          ) : (
                            <CodeChip>{formatIbanGroups(row.creditorIban)}</CodeChip>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-sans font-medium">
                          <span className="inline-flex items-center justify-end gap-2">
                            <EuroAmount amount={row.amount} />
                            {batch.editable && (
                              <button
                                type="button"
                                disabled={busy || !hydrated}
                                onClick={() => {
                                  void remove(row.id)
                                }}
                                className="text-ink-muted hover:text-destructive inline-flex min-h-11 min-w-11 items-center justify-center text-xs underline disabled:opacity-50 md:min-h-0 md:min-w-0"
                              >
                                {t('batch.remove')}
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
              <tfoot>
                <tr className="bg-surface-hover border-t font-semibold">
                  <td className="px-4 py-3 font-sans" colSpan={3}>
                    {t('batch.totalFrom', { account: accountLabel })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <EuroAmount amount={batch.total} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <div className="flex flex-wrap gap-5">
          <section className="border-border bg-surface flex min-w-[280px] flex-1 flex-col gap-3 rounded-[var(--radius-xl)] border p-5">
            <h3 className="text-[15px] font-semibold">{t('batch.fourEyes')}</h3>
            <div className="flex items-center gap-3">
              {batch.submittedBy !== null ? (
                <span className="bg-surface-sunken text-ink-2 inline-flex size-8 items-center justify-center rounded-full text-xs font-semibold">
                  {(iSubmitted && myEmail !== null ? myEmail : '·').slice(0, 1).toUpperCase()}
                </span>
              ) : null}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm">
                  {batchFourEyesLine({
                    done: batch.submittedBy !== null,
                    who: iSubmitted ? myEmail : null,
                    notYet: t('batch.notSubmitted'),
                    withWho: t('batch.submittedBy', {
                      who: iSubmitted && myEmail !== null ? myEmail : '',
                    }),
                    withoutWho: t('batch.submitted'),
                  })}
                </span>
              </span>
              {batch.submittedBy !== null ? (
                <Badge variant="success">{t('batch.donePill')}</Badge>
              ) : (
                <Badge variant="secondary">{t('batch.waitingPill')}</Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              {batch.approvedBy !== null ? (
                <span className="bg-surface-sunken text-ink-2 inline-flex size-8 items-center justify-center rounded-full text-xs font-semibold">
                  2
                </span>
              ) : null}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm">
                  {batchFourEyesLine({
                    done: batch.approvedBy !== null,
                    // API returns user IDs only — no display name in this PR.
                    who: null,
                    notYet: t('batch.notApproved'),
                    withWho: t('batch.approvedBy', { who: '' }),
                    withoutWho: t('batch.approved'),
                  })}
                </span>
              </span>
              {batch.approvedBy !== null ? (
                <Badge variant="success">{t('batch.donePill')}</Badge>
              ) : (
                <Badge variant="info">{t('batch.waitingPill')}</Badge>
              )}
            </div>
            <p className="text-ink-muted m-0 text-xs">{t('batch.fourEyesRule')}</p>
          </section>

          <section className="border-border bg-surface flex min-w-[280px] flex-1 flex-col gap-3 rounded-[var(--radius-xl)] border p-5">
            <h3 className="text-[15px] font-semibold">{nextCard.title}</h3>
            <p className="text-ink-2 m-0 text-sm leading-relaxed">{nextCard.text}</p>
            <div className="flex flex-wrap gap-2">
              {nextCard.cta}
              {canReject && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void act('reject', t('batch.rejectedReason'))
                  }}
                >
                  {t('batch.reject')}
                </Button>
              )}
              {canMarkSent && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void act('export')
                  }}
                >
                  {t('batch.markSent')}
                </Button>
              )}
              {canDownload && batch.state === 'exported' && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    downloadPain()
                  }}
                >
                  {t('batch.download')}
                </Button>
              )}
            </div>
          </section>
        </div>

        {batch.editable && (
          <>
            {run.ok && run.data.instructions.length + run.data.findings.length > 0 && (
              <section className="border-border bg-surface max-w-4xl rounded-[var(--radius-xl)] border p-5">
                <h2 className="mb-1 text-sm font-semibold">
                  {plural('batch.approvedInvoices', run.data.instructions.length)}
                </h2>
                <p className="text-ink-muted mb-3 text-sm">{t('batch.runIntro')}</p>

                {run.data.instructions.length > 0 && (
                  <table className="mb-3 w-full text-sm">
                    <caption className="sr-only">{t('batch.runCaption')}</caption>
                    <thead>
                      <tr className="text-ink-muted text-left text-xs">
                        <th scope="col">{t('ageing.supplier')}</th>
                        <th scope="col">{t('batch.settles')}</th>
                        <th scope="col" className="text-right">
                          {t('batch.amount')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.data.instructions.map((instruction) => (
                        <tr key={instruction.contactNumber} className="border-border/50 border-t">
                          <td className="py-1.5 pr-2">
                            {instruction.creditorName}
                            <span className="text-ink-muted font-mono text-xs">
                              {' '}
                              {instruction.contactNumber}
                            </span>
                          </td>
                          <td className="text-ink-muted py-1.5 pr-2 text-xs">
                            {instruction.settles.map((settled, index) => (
                              <span key={settled.invoiceId}>
                                {index > 0 && ', '}
                                {settled.supplierInvoiceNumber}
                                {settled.kind === 'credit_note' && (
                                  <span className="text-ink-muted">{t('batch.creditSuffix')}</span>
                                )}
                              </span>
                            ))}
                          </td>
                          <td className="py-1.5 text-right">
                            <Money amount={instruction.amount} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {run.data.findings.length > 0 && (
                  <ul className="mb-3 space-y-1 text-sm">
                    {run.data.findings.map((finding) => (
                      <li
                        key={`${finding.code}-${finding.contactNumber}`}
                        className={
                          finding.severity === 'blocking' ? 'text-destructive' : 'text-ink-muted'
                        }
                      >
                        {findingMessage(t, finding)}
                      </li>
                    ))}
                  </ul>
                )}

                {run.data.instructions.length > 0 &&
                  !run.data.findings.some((finding) => finding.severity === 'blocking') && (
                    <Button
                      type="button"
                      disabled={!hydrated || busy}
                      onClick={() => {
                        void addApproved()
                      }}
                    >
                      {busy ? t('common.busy') : t('batch.takeOver')}
                    </Button>
                  )}
              </section>
            )}

            {!open ? (
              <Button
                type="button"
                variant="outline"
                disabled={!hydrated}
                onClick={() => {
                  setOpen(true)
                }}
              >
                {t('batch.addPayment')}
              </Button>
            ) : (
              <form
                onSubmit={(event) => {
                  void add(event)
                }}
                className="border-border bg-surface max-w-4xl space-y-4 rounded-[var(--radius-xl)] border p-5"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-ink-muted mb-1 block text-xs font-medium">
                      {t('batch.beneficiary')}
                    </span>
                    <Input name="creditorName" required maxLength={70} />
                  </label>
                  <label className="block">
                    <span className="text-ink-muted mb-1 block text-xs font-medium">IBAN</span>
                    <Input
                      name="creditorIban"
                      required
                      placeholder={t('batch.ibanPlaceholder')}
                      className="font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="text-ink-muted mb-1 block text-xs font-medium">
                      BIC <span className="opacity-70">{t('batch.optional')}</span>
                    </span>
                    <Input name="creditorBic" className="font-mono" />
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <label className="block">
                    <span className="text-ink-muted mb-1 block text-xs font-medium">
                      {t('batch.amount')}
                    </span>
                    <Input
                      name="amount"
                      required
                      inputMode="decimal"
                      placeholder="45,50"
                      className="text-right font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="text-ink-muted mb-1 block text-xs font-medium">
                      {t('batch.ownReference')}
                    </span>
                    <Input name="endToEndId" required maxLength={35} placeholder="INK-2026-0007" />
                  </label>
                  <label className="block">
                    <span className="text-ink-muted mb-1 block text-xs font-medium">
                      {t('entries.description')}
                    </span>
                    <Input name="remittanceInformation" maxLength={140} />
                  </label>
                  <label className="block">
                    <span className="text-ink-muted mb-1 block text-xs font-medium">
                      {t('batch.paymentReference')}
                    </span>
                    <Input name="remittanceReference" maxLength={35} />
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={busy || !hydrated}>
                    {t('batch.add')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setOpen(false)
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </form>
            )}
          </>
        )}

        {batch.exportedHash !== null && (
          <p className="text-ink-muted text-xs">
            {t('batch.exportedHashBefore')}{' '}
            <span className="font-mono">{batch.exportedHash.slice(0, 16)}…</span>{' '}
            {t('batch.exportedHashAfter')}
          </p>
        )}
      </div>
    </div>
  )
}
