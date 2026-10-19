import { Link, useNavigate } from '@tanstack/react-router'
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiCheckLine,
  RiInformationLine,
  RiSearchLine,
  RiSendPlaneLine,
} from '@remixicon/react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Keycap } from '~/components/ui/keycap'
import { violationMessage } from '~/i18n/labels'
import { useT } from '~/i18n/provider'
import {
  addDaysIso,
  buyerAddressLines,
  canAdvanceFromStep,
  computeGuidedTotals,
  defaultOutputTaxCode,
  filterCustomers,
  flowShouldAdvanceOnEnter,
  formatDateLongNl,
  formatDateShort,
  formatEuro,
  GUIDED_STEP_KEYS,
  isPeriodLockCode,
  nextStep,
  parseDateShort,
  prevStep,
  salesPickerTaxCodes,
  sellerAddressLines,
  sellerIdentifiers,
  taxCodeLabel,
  type GuidedLineDraft,
  type GuidedSendMethod,
  type GuidedStep,
  type GuidedTaxCode,
  type GuidedTotals,
  type VatLabelBag,
} from '~/lib/guided-invoice'
import { periodLabel, type PeriodLabelYear } from '~/lib/period-label'
import { multiplyByDecimal, parseMinorUnits } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { cn } from '~/lib/utils'
import {
  draftInvoice,
  getContact,
  issueInvoice,
  replaceDraftInvoice,
  sendInvoice,
} from '~/server/sales'

function useVatLabels(): VatLabelBag {
  const { t } = useT()
  return {
    rate: (rate) => t('invoiceGuided.vatRate', { rate }),
    byCode: {
      VERL: t('invoiceGuided.vat.VERL'),
      GEEN: t('invoiceGuided.vat.GEEN'),
      NUL: t('invoiceGuided.vat.NUL'),
      ICP: t('invoiceGuided.vat.ICP'),
      ICPD: t('invoiceGuided.vat.ICPD'),
    },
  }
}

export interface GuidedCustomer {
  id: string
  number: string
  name: string
  email: string | null
  city: string | null
  paymentTermsDays: number
  isBlocked: boolean
}

export interface GuidedEntity {
  name: string
  legalName: string
  kvkNumber: string | null
  vatNumber: string | null
  street: string | null
  houseNumber: string | null
  postalCode: string | null
  city: string | null
}

export interface GuidedAccount {
  number: string
  name: string
  type: string
}

type FlowPhase = 'form' | 'loading' | 'error' | 'done'

interface DoneState {
  invoiceId: string
  number: string
  total: bigint
  dueDate: string
  customerName: string
  sent: boolean
}

interface ServerDraft {
  id: string
  net: bigint
  tax: bigint
  total: bigint
  taxByLabel: ReadonlyArray<{ label: string; amount: bigint }>
}

/**
 * Guided new-invoice flow for Eigenaar with Geavanceerd off (#45 / #61 slice 5).
 *
 * Klant → Wat lever je → Controleren → Versturen. Uses draft / issue / send
 * APIs only. Never invents amounts or invoice numbers.
 */
export function GuidedInvoiceFlow({
  customers,
  taxCodes,
  accounts,
  entity,
  fiscalYears = [],
  contactsError,
  initialPhase = 'form',
}: {
  customers: readonly GuidedCustomer[]
  taxCodes: readonly GuidedTaxCode[]
  accounts: readonly GuidedAccount[]
  entity: GuidedEntity | null
  /** Book years with periods — for shared `periodLabel` copy on period locks. */
  fiscalYears?: readonly PeriodLabelYear[]
  contactsError?: string | null
  /** Lab / screenshot hook for empty / loading / error chrome. */
  initialPhase?: FlowPhase
}) {
  const { t, tag } = useT()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const titleId = useId()
  const confirmTitleId = useId()
  const confirmDescId = useId()

  const openCustomers = customers.filter((row) => !row.isBlocked)
  const codes = salesPickerTaxCodes(taxCodes)
  const revenueAccounts = accounts.filter((account) => account.type === 'revenue')
  const defaultRevenue = revenueAccounts[0]?.number ?? ''
  const defaultTax = defaultOutputTaxCode(taxCodes)

  const today = (): string => new Date().toISOString().slice(0, 10)

  const [step, setStep] = useState<GuidedStep>(1)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [contactNumber, setContactNumber] = useState('')
  const [contactDetail, setContactDetail] = useState<{
    email: string | null
    paymentTermsDays: number
    address: {
      street: string | null
      houseNumber: string | null
      postalCode: string | null
      city: string | null
    } | null
  } | null>(null)
  const [issueDate, setIssueDate] = useState(today)
  const [lines, setLines] = useState<GuidedLineDraft[]>([
    {
      description: '',
      quantity: '1',
      unitPrice: '',
      taxCode: defaultTax,
      revenueAccountNumber: defaultRevenue,
    },
  ])
  const [sendMethod, setSendMethod] = useState<GuidedSendMethod>('email')
  const [confirming, setConfirming] = useState(false)
  const [phase, setPhase] = useState<FlowPhase>(
    contactsError
      ? 'error'
      : openCustomers.length === 0 && initialPhase === 'form'
        ? 'form'
        : initialPhase,
  )
  const [problems, setProblems] = useState<{ path: string | null; message: string }[]>([])
  const [done, setDone] = useState<DoneState | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [serverDraft, setServerDraft] = useState<ServerDraft | null>(null)

  const draftKey = useRef(crypto.randomUUID())
  /** Kept across Terug / period-lock so Controleren replaces instead of orphaning. */
  const knownDraftId = useRef<string | null>(null)
  const issueKey = useRef(crypto.randomUUID())
  const sendKey = useRef(crypto.randomUUID())
  const confirmRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const stickyActionsRef = useRef<HTMLDivElement>(null)
  /** Phone: padding so Totaal/Indicatief clear the sticky Terug/Verder bar. */
  const [stickyClearancePx, setStickyClearancePx] = useState(0)

  useLayoutEffect(() => {
    const el = stickyActionsRef.current
    if (el === null) return

    const mq = window.matchMedia('(min-width: 768px)')
    const BREATHING_ROOM_PX = 16

    function update(): void {
      const bar = stickyActionsRef.current
      if (bar === null) return
      if (mq.matches) {
        setStickyClearancePx(0)
        return
      }
      // Real sticky height (includes safe-area padding on the bar) + breathing room.
      setStickyClearancePx(Math.ceil(bar.getBoundingClientRect().height) + BREATHING_ROOM_PX)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    mq.addEventListener('change', update)
    return () => {
      observer.disconnect()
      mq.removeEventListener('change', update)
    }
  }, [step, hydrated])

  const vatLabels = useVatLabels()
  const selected = openCustomers.find((c) => c.number === contactNumber) ?? null
  const filtered = useMemo(() => filterCustomers(openCustomers, query), [openCustomers, query])
  const clientTotals = useMemo(
    () => computeGuidedTotals(lines, codes, vatLabels),
    [lines, codes, vatLabels],
  )
  const reviewTotals: GuidedTotals = serverDraft
    ? {
        net: serverDraft.net,
        tax: serverDraft.tax,
        total: serverDraft.total,
        taxByLabel: serverDraft.taxByLabel,
      }
    : clientTotals
  const dueDate = addDaysIso(
    issueDate,
    contactDetail?.paymentTermsDays ?? selected?.paymentTermsDays ?? 30,
  )
  const termsDays = contactDetail?.paymentTermsDays ?? selected?.paymentTermsDays ?? 30
  const customerEmail = contactDetail?.email ?? selected?.email ?? null
  // No e-mail → PDF only. Keep the user's choice once an address exists.
  const effectiveSendMethod: GuidedSendMethod =
    customerEmail === null || customerEmail === '' ? 'pdf' : sendMethod

  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
  }, [confirming])

  useEffect(() => {
    if (contactNumber === '') return
    const row = openCustomers.find((c) => c.number === contactNumber)
    if (row === undefined) return
    let cancelled = false
    void getContact({ data: { contactId: row.id } }).then((result) => {
      if (cancelled || !result.ok) return
      const contact = result.data.contact
      setContactDetail({
        email: contact.email,
        paymentTermsDays: contact.paymentTermsDays,
        address: contact.address,
      })
    })
    return () => {
      cancelled = true
    }
  }, [contactNumber, openCustomers])

  function report(problem: {
    violations: readonly { path: string | null; message: string; code?: string }[]
    detail: string
  }) {
    setProblems(
      problem.violations.length > 0
        ? problem.violations.map((violation) => ({
            path: violation.path,
            message: violationMessage(t, violation),
          }))
        : [{ path: null, message: problem.detail }],
    )
  }

  /**
   * Drop review totals for step-2 editing without rotating the draft id.
   * `knownDraftId` stays so the next Controleren replaces in place.
   */
  function clearReviewDraft() {
    setServerDraft(null)
  }

  function forgetDraft() {
    knownDraftId.current = null
    setServerDraft(null)
    draftKey.current = crypto.randomUUID()
  }

  function chooseCustomer(number: string, advance = false) {
    setContactNumber(number)
    if (number === '') setContactDetail(null)
    const index = filtered.findIndex((c) => c.number === number)
    setActiveIndex(index < 0 ? 0 : index)
    if (advance) {
      setProblems([])
      setStep(2)
    }
  }

  function updateLine(index: number, patch: Partial<GuidedLineDraft>) {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    )
  }

  function addLine() {
    setLines((current) => [
      ...current,
      {
        description: '',
        quantity: '1',
        unitPrice: '',
        taxCode: defaultTax,
        revenueAccountNumber: defaultRevenue,
      },
    ])
  }

  function chooseSendMethod(method: GuidedSendMethod) {
    setSendMethod(method)
  }

  function draftLinesPayload() {
    return lines
      .filter((line) => line.description.trim() !== '')
      .map((line) => ({
        description: line.description.trim(),
        quantity: line.quantity === '' ? '1' : line.quantity,
        unitCode: 'EA',
        unitPrice: (parseMinorUnits(line.unitPrice) ?? 0n).toString(),
        revenueAccountNumber: line.revenueAccountNumber || defaultRevenue,
        taxCode: line.taxCode || defaultTax,
      }))
  }

  function mapServerDraft(data: {
    id: string
    net: string
    tax: string
    total: string
    taxGroups: readonly {
      code: string
      ratePercent: string
      amount: string
      description?: string
    }[]
  }): ServerDraft {
    return {
      id: data.id,
      net: BigInt(data.net),
      tax: BigInt(data.tax),
      total: BigInt(data.total),
      taxByLabel: data.taxGroups
        .map((group) => {
          const known = codes.find((item) => item.code === group.code)
          const fallback: GuidedTaxCode = {
            code: group.code,
            ratePercent: group.ratePercent,
            rateBasisPoints: Math.round(Number(group.ratePercent) * 100) || 0,
            direction: 'output',
            ...(group.description !== undefined ? { description: group.description } : {}),
          }
          return {
            label: taxCodeLabel(known ?? fallback, vatLabels),
            amount: BigInt(group.amount),
          }
        })
        .filter((row) => row.amount !== 0n),
    }
  }

  async function draftForReview(): Promise<boolean> {
    setPhase('loading')
    setProblems([])
    const payload = {
      contactNumber,
      kind: 'invoice' as const,
      issueDate,
      reference: null,
      // PEPPOL-EN16931-R003: BT-10 or order reference required for UBL/send.
      // Guided mode has no buyer-reference field; use the debtor number.
      buyerReference: contactNumber,
      lines: draftLinesPayload(),
    }
    const existingId = knownDraftId.current
    const result =
      existingId === null
        ? await draftInvoice({
            data: { idempotencyKey: draftKey.current, ...payload },
          })
        : await replaceDraftInvoice({
            data: {
              invoiceId: existingId,
              // Fresh key per replace: content may have changed since last write.
              idempotencyKey: crypto.randomUUID(),
              ...payload,
            },
          })
    if (!result.ok) {
      setPhase('form')
      report(result.problem)
      return false
    }
    knownDraftId.current = result.data.id
    setServerDraft(mapServerDraft(result.data))
    setPhase('form')
    return true
  }

  async function goNext() {
    let effectiveContact = contactNumber
    if (step === 1 && effectiveContact === '') {
      const pick = filtered[activeIndex] ?? filtered[0]
      if (pick) {
        effectiveContact = pick.number
        setContactNumber(pick.number)
      }
    }
    if (
      !canAdvanceFromStep(step, {
        contactNumber: effectiveContact,
        lines,
        sendMethod: effectiveSendMethod,
      })
    ) {
      if (step === 1) {
        setProblems([{ path: null, message: t('invoiceGuided.needCustomer') }])
      } else if (step === 2) {
        setProblems([{ path: null, message: t('invoiceGuided.needLines') }])
      }
      return
    }
    setProblems([])
    if (step === 4) {
      setConfirming(true)
      return
    }
    if (step === 2) {
      const ok = await draftForReview()
      if (!ok) return
      setStep(3)
      return
    }
    const next = nextStep(step)
    if (next !== null) setStep(next)
  }

  function goBack() {
    setProblems([])
    setConfirming(false)
    const prev = prevStep(step)
    if (prev !== null) {
      if (step === 3) clearReviewDraft()
      setStep(prev)
      return
    }
    void navigate({ to: '/invoices', search: { status: undefined } })
  }

  async function saveDraftOnly() {
    if (serverDraft !== null) {
      await navigate({ to: '/invoices/$invoiceId', params: { invoiceId: serverDraft.id } })
      return
    }
    if (!canAdvanceFromStep(2, { contactNumber, lines, sendMethod: effectiveSendMethod })) {
      setProblems([{ path: null, message: t('invoiceGuided.needLines') }])
      return
    }
    setPhase('loading')
    setProblems([])
    const result = await draftInvoice({
      data: {
        idempotencyKey: draftKey.current,
        contactNumber,
        kind: 'invoice',
        issueDate,
        reference: null,
        // PEPPOL-EN16931-R003 — see draftForReview.
        buyerReference: contactNumber,
        lines: draftLinesPayload(),
      },
    })
    if (!result.ok) {
      setPhase('error')
      report(result.problem)
      return
    }
    draftKey.current = crypto.randomUUID()
    await navigate({ to: '/invoices/$invoiceId', params: { invoiceId: result.data.id } })
  }

  async function confirmSend() {
    setConfirming(false)
    if (serverDraft === null) {
      setProblems([{ path: null, message: t('invoiceGuided.needLines') }])
      return
    }
    setPhase('loading')
    setProblems([])

    const invoiceId = serverDraft.id

    const issueResult = await issueInvoice({
      data: { invoiceId, idempotencyKey: issueKey.current },
    })

    if (!issueResult.ok) {
      const periodViolation = issueResult.problem.violations.find(
        (violation) => typeof violation.code === 'string' && isPeriodLockCode(violation.code),
      )
      if (periodViolation !== undefined) {
        const periodName = periodLabel(fiscalYears, periodViolation.detail, tag)
        clearReviewDraft()
        setPhase('form')
        setStep(2)
        setProblems([
          {
            path: null,
            message:
              periodViolation.code === 'period_hard_closed'
                ? t('invoiceGuided.periodHardClosed', { period: periodName })
                : t('invoiceGuided.periodSoftClosed', { period: periodName }),
          },
        ])
        return
      }
      setPhase('error')
      report(issueResult.problem)
      return
    }

    issueKey.current = crypto.randomUUID()
    let sent = false

    const sendProblems: { path: string | null; message: string }[] = []
    if (effectiveSendMethod === 'email' && customerEmail) {
      const sendResult = await sendInvoice({
        data: { invoiceId, idempotencyKey: sendKey.current },
      })
      sendKey.current = crypto.randomUUID()
      if (!sendResult.ok) {
        report(sendResult.problem)
        sendProblems.push(
          ...(sendResult.problem.violations.length > 0
            ? sendResult.problem.violations.map((violation) => ({
                path: violation.path,
                message: violationMessage(t, violation),
              }))
            : [{ path: null, message: sendResult.problem.detail }]),
        )
      } else if (sendResult.data.failure !== null) {
        sendProblems.push({
          path: null,
          message: t('invoice.sendFailed', { reason: sendResult.data.failure }),
        })
      } else {
        sent = true
      }
    }

    const shortName = (selected?.name ?? '').replace(/\s+B\.V\.$/i, '')
    if (sendProblems.length > 0) setProblems(sendProblems)
    setDone({
      invoiceId,
      number: issueResult.data.number,
      total: BigInt(issueResult.data.total),
      dueDate,
      customerName: shortName || (selected?.name ?? ''),
      sent,
    })
    setPhase('done')
  }

  // Empty customers — real empty state (not invented data).
  if (openCustomers.length === 0 && phase !== 'loading' && phase !== 'error' && !contactsError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
        <PageHeader title={t('invoices.new')} description={t('invoiceGuided.intro')} />
        <div className="border-border mt-6 border p-6" role="status">
          <p className="font-medium">{t('invoiceGuided.emptyTitle')}</p>
          <p className="text-muted-foreground mt-1 text-sm">{t('invoiceNew.noCustomers')}</p>
          <Button asChild className="mt-4" variant="outline">
            <Link to="/contacts">{t('invoiceGuided.emptyCta')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (phase === 'loading') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8" aria-busy="true">
        <PageHeader title={t('invoices.new')} />
        <p className="text-muted-foreground mt-6 text-sm" role="status">
          {t('invoiceGuided.loading')}
        </p>
      </div>
    )
  }

  if (phase === 'error' && problems.length > 0 && done === null && step === 4 && !confirming) {
    // Fall through to form with alert — keep context. contactsError alone:
  }

  if (contactsError && openCustomers.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
        <PageHeader title={t('invoices.new')} />
        <p role="alert" className="text-destructive mt-6 text-sm">
          {contactsError}
        </p>
      </div>
    )
  }

  if (phase === 'done' && done !== null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 md:px-8 md:py-16">
        <div className="border-border animate-in fade-in-0 zoom-in-98 border p-8 text-center duration-[160ms] motion-reduce:animate-none">
          <span className="border-success text-success mx-auto flex size-14 items-center justify-center border">
            <RiCheckLine className="size-8" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl">
            {done.sent
              ? t('invoiceGuided.doneTitle', { name: done.customerName })
              : t('invoiceGuided.doneTitlePdf', { name: done.customerName })}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm tabular">
            {t('invoiceGuided.doneBody', {
              number: done.number,
              amount: formatEuro(done.total),
              due: formatDateLongNl(done.dueDate, { includeYear: false }),
            })}
          </p>
          {problems.length > 0 && (
            <ul role="alert" className="text-destructive mt-4 space-y-1 text-left text-sm">
              {problems.map((problem, index) => (
                <li key={index}>
                  {problem.path === null ? '' : `${problem.path}: `}
                  {problem.message}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                forgetDraft()
                issueKey.current = crypto.randomUUID()
                sendKey.current = crypto.randomUUID()
                setDone(null)
                setPhase('form')
                setStep(1)
                setLines([
                  {
                    description: '',
                    quantity: '1',
                    unitPrice: '',
                    taxCode: defaultTax,
                    revenueAccountNumber: defaultRevenue,
                  },
                ])
                setQuery('')
                setContactNumber('')
                setProblems([])
                setSendMethod('email')
              }}
            >
              {t('invoiceGuided.another')}
            </Button>
            <Button asChild>
              <Link to="/">{t('invoiceGuided.toDashboard')}</Link>
            </Button>
          </div>
          <p className="mt-4">
            <Link
              to="/invoices/$invoiceId"
              params={{ invoiceId: done.invoiceId }}
              className="text-sm underline underline-offset-4"
            >
              {t('invoiceGuided.openInvoice')}
            </Link>
          </p>
        </div>
      </div>
    )
  }

  const vatHint = taxCodeLabel(
    codes.find((c) => c.code === (lines[0]?.taxCode ?? defaultTax)),
    vatLabels,
  )

  return (
    <div
      className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8"
      onKeyDown={(event) => {
        if (confirming) {
          if (event.key === 'Escape') {
            event.preventDefault()
            setConfirming(false)
          }
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          if (leaving) {
            void navigate({ to: '/invoices', search: { status: undefined } })
            return
          }
          if (step > 1) {
            goBack()
            return
          }
          setLeaving(true)
          return
        }
        setLeaving(false)

        // Arrow keys for the customer listbox live only on `#cust-q` — handling
        // them here as well moved the highlight by two per press.
        // Enter on Terug / Concept / listbox options / inputs stays with that
        // control (native activation or its own handler). Only advance when
        // nothing else claimed the key — see `flowShouldAdvanceOnEnter`.
        if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
          if (!flowShouldAdvanceOnEnter(event)) return
          event.preventDefault()
          void goNext()
        }
      }}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 id={titleId} className="text-2xl tracking-tight md:text-[28px]">
            {t('invoices.new')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('invoiceGuided.stepOf', {
              step: String(step),
              total: String(4),
              label: t(GUIDED_STEP_KEYS[step - 1]!),
            })}
          </p>
        </div>
      </div>

      <ol
        className="border-border mb-6 grid grid-cols-4 border"
        aria-label={t('invoiceGuided.steps')}
      >
        {GUIDED_STEP_KEYS.map((key, index) => {
          const n = index + 1
          const state = n < step ? 'done' : n === step ? 'current' : 'todo'
          return (
            <li
              key={key}
              className={cn(
                'flex min-h-11 items-center gap-2 px-2 text-xs md:px-3 md:text-sm',
                index > 0 && 'border-border border-l',
                state === 'current'
                  ? 'border-b-accent border-b-[3px] font-medium'
                  : 'border-b-[3px] border-b-transparent',
                state === 'todo' && 'text-muted-foreground',
              )}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center text-[11px] tabular',
                  state === 'done' ? 'bg-foreground text-background' : 'border-border border',
                )}
              >
                {state === 'done' ? <RiCheckLine className="size-3" aria-hidden="true" /> : n}
              </span>
              <span className="hidden truncate sm:inline">{t(key)}</span>
            </li>
          )
        })}
      </ol>

      <div
        className="animate-in fade-in-0 duration-150 motion-reduce:animate-none"
        data-step={step}
        style={
          stickyClearancePx > 0
            ? {
                // Measured sticky height already includes safe-area padding on the bar.
                paddingBottom: `${String(stickyClearancePx)}px`,
              }
            : undefined
        }
      >
        {step === 1 && (
          <CustomerStep
            query={query}
            onQueryChange={(value) => {
              setQuery(value)
              setActiveIndex(0)
              const next = filterCustomers(openCustomers, value)
              // Clear when the search has no match (also avoids a stale pick after
              // the field is emptied mid-type).
              setContactNumber(next[0]?.number ?? '')
              if (next[0] === undefined) setContactDetail(null)
            }}
            filtered={filtered}
            activeIndex={activeIndex}
            selectedNumber={contactNumber}
            onChoose={(number) => chooseCustomer(number)}
            onCommit={() => {
              const pick = filtered[activeIndex]
              if (pick) chooseCustomer(pick.number, true)
              else void goNext()
            }}
            onArrowDown={() =>
              setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)))
            }
            onArrowUp={() => setActiveIndex((i) => Math.max(i - 1, 0))}
            listRef={listRef}
            selected={selected}
            termsDays={termsDays}
            vatHint={vatHint}
            email={customerEmail}
            address={contactDetail?.address ?? null}
          />
        )}

        {step === 2 && (
          <LinesStep
            issueDate={issueDate}
            dueDate={dueDate}
            termsDays={termsDays}
            lines={lines}
            codes={codes}
            totals={clientTotals}
            vatLabels={vatLabels}
            hydrated={hydrated}
            onIssueDate={setIssueDate}
            onUpdate={updateLine}
            onAdd={addLine}
          />
        )}

        {step === 3 && selected && (
          <ReviewStep
            entity={entity}
            customerName={selected.name}
            customerAddress={contactDetail?.address ?? null}
            issueDate={issueDate}
            dueDate={dueDate}
            lines={lines}
            totals={reviewTotals}
          />
        )}

        {step === 4 && selected && (
          <SendStep
            email={customerEmail}
            sendMethod={effectiveSendMethod}
            onSendMethod={chooseSendMethod}
          />
        )}

        {problems.length > 0 && (
          <ul role="alert" className="text-destructive mt-4 space-y-1 text-sm">
            {problems.map((problem, index) => (
              <li key={index}>
                {problem.path === null ? '' : `${problem.path}: `}
                {problem.message}
              </li>
            ))}
          </ul>
        )}

        {leaving && step === 1 && (
          <p role="status" className="text-unreconciled mt-4 text-sm">
            {t('invoiceNew.escapeAgain')}
          </p>
        )}
      </div>

      <div
        ref={stickyActionsRef}
        data-guided-sticky-actions
        className="border-border sticky bottom-0 z-10 -mx-4 mt-6 flex items-center gap-2 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:mx-0 md:border-t-0 md:px-0 md:pb-3"
      >
        {step > 1 ? (
          <Button type="button" variant="outline" onClick={goBack}>
            <RiArrowLeftSLine className="size-4" aria-hidden="true" />
            {t('invoiceGuided.back')}
            <span className="ml-1 hidden normal-case md:inline-flex">
              <Keycap>Esc</Keycap>
            </span>
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            onClick={() => void navigate({ to: '/invoices', search: { status: undefined } })}
          >
            {t('common.cancel')}
            <span className="ml-1 hidden normal-case md:inline-flex">
              <Keycap>Esc</Keycap>
            </span>
          </Button>
        )}
        <span className="flex-1" />
        {step === 4 && (
          <Button
            type="button"
            variant="outline"
            disabled={!hydrated}
            onClick={() => void saveDraftOnly()}
          >
            {t('invoiceNew.saveDraft')}
          </Button>
        )}
        <Button
          type="button"
          data-guided-primary
          disabled={!hydrated}
          onClick={() => void goNext()}
        >
          {step === 4 ? (
            <>
              <RiSendPlaneLine className="size-4" aria-hidden="true" />
              {t('invoiceGuided.send')}
            </>
          ) : (
            t('invoiceGuided.next')
          )}
          <span className="ml-1 hidden normal-case md:inline-flex">
            <Keycap>↵</Keycap>
          </span>
        </Button>
      </div>

      {hydrated && (
        <div className="border-accent text-muted-foreground mt-3 hidden flex-wrap items-center gap-x-3 gap-y-1.5 border px-2 py-1.5 text-[0.6875rem] md:flex">
          {step === 1 && (
            <span className="flex items-center gap-1.5">
              <Keycap>↑</Keycap>
              <Keycap>↓</Keycap>
              <span>{t('invoiceGuided.keys.customers')}</span>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Keycap>↵</Keycap>
            <span>{step === 4 ? t('invoiceGuided.send') : t('invoiceGuided.next')}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Keycap>Esc</Keycap>
            <span>{step > 1 ? t('invoiceGuided.back') : t('common.cancel')}</span>
          </span>
        </div>
      )}

      {confirming && selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label={t('common.cancel')}
            onClick={() => setConfirming(false)}
          />
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={confirmTitleId}
            aria-describedby={confirmDescId}
            className="border-border animate-in fade-in-0 zoom-in-98 relative w-full border bg-background p-6 duration-[160ms] motion-reduce:animate-none sm:max-w-md"
          >
            <h2 id={confirmTitleId} className="text-lg">
              {t('invoiceGuided.confirmTitle')}
            </h2>
            <p id={confirmDescId} className="text-muted-foreground mt-2 text-sm">
              {effectiveSendMethod === 'email' && customerEmail
                ? t('invoiceGuided.confirmBodyEmail', { email: customerEmail })
                : t('invoiceGuided.confirmBodyPdf')}
            </p>
            <dl className="mt-4 space-y-1 border-y py-3 text-sm tabular">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('invoiceNew.customer')}</dt>
                <dd>{selected.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('report.total')}</dt>
                <dd className="font-medium">{formatEuro(reviewTotals.total)}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
                <span className="ml-1 hidden normal-case md:inline-flex">
                  <Keycap>Esc</Keycap>
                </span>
              </Button>
              <Button
                type="button"
                ref={confirmRef}
                data-guided-primary
                onClick={() => void confirmSend()}
              >
                <RiSendPlaneLine className="size-4" aria-hidden="true" />
                {t('invoiceGuided.send')}
                <span className="ml-1 hidden normal-case md:inline-flex">
                  <Keycap>↵</Keycap>
                </span>
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function CustomerStep({
  query,
  onQueryChange,
  filtered,
  activeIndex,
  selectedNumber,
  onChoose,
  onCommit,
  onArrowDown,
  onArrowUp,
  listRef,
  selected,
  termsDays,
  vatHint,
  email,
  address,
}: {
  query: string
  onQueryChange: (value: string) => void
  filtered: readonly GuidedCustomer[]
  activeIndex: number
  selectedNumber: string
  onChoose: (number: string) => void
  onCommit: () => void
  onArrowDown: () => void
  onArrowUp: () => void
  listRef: React.RefObject<HTMLUListElement | null>
  selected: GuidedCustomer | null
  termsDays: number
  vatHint: string
  email: string | null
  address: {
    street: string | null
    houseNumber: string | null
    postalCode: string | null
    city: string | null
  } | null
}) {
  const { t } = useT()
  const addressLines = buyerAddressLines(address)

  return (
    <>
      <label htmlFor="cust-q" className="text-sm font-medium">
        {t('invoiceGuided.who')}
      </label>
      <div className="relative mt-2">
        <RiSearchLine
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          id="cust-q"
          role="combobox"
          aria-expanded="true"
          aria-controls="cust-list"
          autoComplete="off"
          className="pl-9"
          placeholder={t('invoiceGuided.searchPlaceholder')}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            // Combobox owns ArrowUp/Down/Enter; stopPropagation so the flow
            // container never double-handles them.
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              event.stopPropagation()
              onArrowDown()
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              event.stopPropagation()
              onArrowUp()
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              onCommit()
            }
          }}
        />
      </div>
      <ul
        id="cust-list"
        role="listbox"
        aria-label={t('invoiceGuided.customers')}
        ref={listRef}
        className="border-border mt-1 divide-y border"
      >
        {filtered.map((customer, index) => {
          const active = index === activeIndex
          const isSelected = customer.number === selectedNumber
          return (
            <li key={customer.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onChoose(customer.number)}
                onKeyDown={(event) => {
                  // Standard combobox: Enter on a focused/highlighted option selects it.
                  // Stop propagation so nothing else sees the key; the flow-level
                  // handler also ignores buttons, but this is the option's job.
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  event.stopPropagation()
                  onChoose(customer.number)
                }}
                className={cn(
                  'flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm',
                  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring',
                  active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                )}
              >
                <span className="flex size-4 items-center">
                  {isSelected ? <RiCheckLine className="size-4" aria-hidden="true" /> : null}
                </span>
                <span className="flex-1 font-medium">{customer.name}</span>
                <span
                  className={cn(
                    active ? 'text-accent-foreground/75' : 'text-muted-foreground',
                    'tabular',
                  )}
                >
                  {customer.city ?? ''}
                </span>
              </button>
            </li>
          )
        })}
        <li>
          <Link
            to="/contacts"
            className="text-muted-foreground hover:bg-muted flex min-h-11 items-center gap-3 px-3 py-2 text-sm"
          >
            <RiAddLine className="size-4" aria-hidden="true" />
            {t('invoiceGuided.newCustomer')}
          </Link>
        </li>
      </ul>

      {selected && (
        <div className="border-accent bg-muted mt-5 border-l-[3px] px-4 py-3 text-sm">
          <p className="font-medium">{selected.name}</p>
          <p className="text-muted-foreground">
            {[addressLines[0], addressLines[1], email].filter(Boolean).join(' · ') ||
              t('invoiceGuided.noAddressYet')}
          </p>
          <p className="mt-2">
            {t('invoiceGuided.defaultsHint', {
              days: String(termsDays),
              vat: vatHint,
            })}
          </p>
        </div>
      )}
    </>
  )
}

function LinesStep({
  issueDate,
  dueDate,
  termsDays,
  lines,
  codes,
  totals,
  vatLabels,
  hydrated,
  onIssueDate,
  onUpdate,
  onAdd,
}: {
  issueDate: string
  dueDate: string
  termsDays: number
  lines: GuidedLineDraft[]
  codes: GuidedTaxCode[]
  totals: GuidedTotals
  vatLabels: VatLabelBag
  hydrated: boolean
  onIssueDate: (value: string) => void
  onUpdate: (index: number, patch: Partial<GuidedLineDraft>) => void
  onAdd: () => void
}) {
  const { t } = useT()
  // Local draft while typing an incomplete date; falls back to the ISO prop.
  const [issueDraft, setIssueDraft] = useState<string | null>(null)
  const issueDisplay = issueDraft ?? formatDateShort(issueDate)

  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="inv-date">
            {t('invoiceNew.issueDate')}
          </label>
          <Input
            id="inv-date"
            type="text"
            inputMode="numeric"
            placeholder="DD-MM-YYYY"
            className="mt-1.5 tabular"
            value={issueDisplay}
            onChange={(event) => {
              const next = event.target.value
              setIssueDraft(next)
              const parsed = parseDateShort(next)
              if (parsed !== null) {
                onIssueDate(parsed)
                setIssueDraft(null)
              }
            }}
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="inv-due">
            {t('invoiceGuided.dueDate')}
          </label>
          <Input
            id="inv-due"
            type="text"
            className="mt-1.5 tabular"
            value={formatDateShort(dueDate)}
            readOnly
            aria-readonly="true"
          />
          <p className="text-muted-foreground mt-1 text-xs">
            {t('invoiceGuided.dueHint', { days: String(termsDays) })}
          </p>
        </div>
      </div>

      <p className="mb-2 text-sm font-medium">{t('invoiceGuided.what')}</p>
      <div className="border-border overflow-x-auto border">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="bg-muted text-muted-foreground text-left text-xs">
            <tr>
              <th className="bg-muted sticky left-0 px-3 py-2 font-medium">
                {t('entries.description')}
              </th>
              <th className="w-20 px-3 py-2 text-right font-medium">{t('invoice.quantity')}</th>
              <th className="w-28 px-3 py-2 text-right font-medium">{t('invoice.price')}</th>
              <th className="w-32 px-3 py-2 font-medium">{t('invoiceGuided.vat')}</th>
              <th className="w-28 px-3 py-2 text-right font-medium">{t('invoiceGuided.amount')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((line, index) => {
              const lineNet = multiplyByDecimal(
                parseMinorUnits(line.unitPrice) ?? 0n,
                line.quantity === '' ? '0' : line.quantity,
              )
              return (
                <tr key={index}>
                  <td className="bg-background sticky left-0 p-1">
                    <Input
                      aria-label={t('entryNew.descriptionLine', { line: String(index + 1) })}
                      className="min-w-48 border-transparent hover:border-input"
                      value={line.description}
                      disabled={!hydrated}
                      onChange={(event) => {
                        onUpdate(index, { description: event.target.value })
                        if (index === lines.length - 1 && event.target.value !== '') onAdd()
                      }}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      aria-label={t('invoiceNew.quantityLine', { line: String(index + 1) })}
                      className="border-transparent text-right tabular hover:border-input"
                      value={line.quantity}
                      disabled={!hydrated}
                      onChange={(event) => onUpdate(index, { quantity: event.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      aria-label={t('invoiceNew.priceLine', { line: String(index + 1) })}
                      className="border-transparent text-right tabular hover:border-input"
                      value={line.unitPrice}
                      disabled={!hydrated}
                      onChange={(event) => onUpdate(index, { unitPrice: event.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <select
                      aria-label={t('invoiceNew.vatLine', { line: String(index + 1) })}
                      className="field-control border-transparent hover:border-input"
                      value={line.taxCode}
                      disabled={!hydrated}
                      onChange={(event) => onUpdate(index, { taxCode: event.target.value })}
                    >
                      {codes.map((code) => (
                        <option key={code.code} value={code.code}>
                          {taxCodeLabel(code, vatLabels)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular">
                    {formatEuro(lineNet)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium md:min-h-8"
      >
        <RiAddLine className="size-4" aria-hidden="true" />
        {t('invoiceGuided.addLine')}
      </button>

      <dl className="mt-4 ml-auto max-w-xs space-y-1 text-sm tabular">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t('invoiceGuided.exVat')}</dt>
          <dd>{formatEuro(totals.net)}</dd>
        </div>
        {totals.taxByLabel.map((row) => (
          <div key={row.label} className="flex justify-between">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd>{formatEuro(row.amount)}</dd>
          </div>
        ))}
        {totals.taxByLabel.length === 0 && totals.tax === 0n && (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('invoice.vat')}</dt>
            <dd>{formatEuro(0n)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t pt-1 text-base font-semibold">
          <dt>{t('report.total')}</dt>
          <dd>{formatEuro(totals.total)}</dd>
        </div>
      </dl>
      <p className="text-muted-foreground mt-2 max-w-md text-xs">{t('invoiceNew.vatNote')}</p>
    </>
  )
}

function ReviewStep({
  entity,
  customerName,
  customerAddress,
  issueDate,
  dueDate,
  lines,
  totals,
}: {
  entity: GuidedEntity | null
  customerName: string
  customerAddress: {
    street: string | null
    houseNumber: string | null
    postalCode: string | null
    city: string | null
  } | null
  issueDate: string
  dueDate: string
  lines: GuidedLineDraft[]
  totals: GuidedTotals
}) {
  const { t } = useT()
  const sellerName = entity?.legalName || entity?.name || ''
  const sellerLines = entity ? sellerAddressLines(entity) : []
  const sellerIds = entity ? sellerIdentifiers(entity) : ''
  const buyerLines = buyerAddressLines(customerAddress)
  const shortName = customerName.replace(/\s+B\.V\.$/i, '')
  const filled = lines.filter((line) => line.description.trim() !== '')

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
      <div
        className="border-border border bg-white p-4 text-black md:p-6 dark:bg-white"
        aria-label={t('invoiceGuided.preview')}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-semibold">{sellerName || t('invoiceGuided.sellerFallback')}</p>
            {sellerLines.length > 0 && (
              <p className="text-xs text-black/60">
                {sellerLines.map((line, i) => (
                  <span key={i}>
                    {i > 0 && <br />}
                    {line}
                  </span>
                ))}
              </p>
            )}
            {sellerIds !== '' && <p className="text-xs text-black/60">{sellerIds}</p>}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-semibold">{t('invoice.title')}</p>
            <p className="text-xs text-black/60">{t('invoiceGuided.numberLater')}</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 sm:gap-4">
          <div className="min-w-0">
            <p className="text-black/60">{t('invoiceGuided.to')}</p>
            <p className="font-medium">{customerName}</p>
            {buyerLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <div className="tabular sm:text-right">
            <p className="whitespace-nowrap">
              <span className="text-black/60">{t('invoices.date')} </span>
              {formatDateShort(issueDate)}
            </p>
            <p className="whitespace-nowrap">
              <span className="text-black/60">{t('invoiceGuided.dueDate')} </span>
              {formatDateShort(dueDate)}
            </p>
          </div>
        </div>
        {/* Phone: description full width; qty × price and amount on the next row
            so Omschrijving is not squeezed into mid-word breaks. sm+ keeps the
            four-column table (1440 unchanged). */}
        <ul className="mt-6 space-y-3 text-xs tabular sm:hidden">
          {filled.map((line, index) => {
            const price = parseMinorUnits(line.unitPrice) ?? 0n
            const lineNet = multiplyByDecimal(price, line.quantity === '' ? '0' : line.quantity)
            return (
              <li key={index} className="border-b border-black/10 pb-2">
                <p className="break-normal hyphens-auto" lang="nl">
                  {line.description}
                </p>
                <div className="mt-0.5 flex justify-between gap-3">
                  <span className="whitespace-nowrap tabular-nums">
                    {line.quantity}
                    {' × '}
                    {formatEuro(price)}
                  </span>
                  <span className="whitespace-nowrap tabular-nums">{formatEuro(lineNet)}</span>
                </div>
              </li>
            )
          })}
        </ul>
        <table className="mt-6 hidden w-full table-fixed text-xs tabular sm:table">
          <colgroup>
            <col />
            <col className="w-12" />
            <col className="w-[4.75rem]" />
            <col className="w-[5.25rem]" />
          </colgroup>
          <thead className="border-b border-black/20 text-left text-black/60">
            <tr>
              <th className="py-1 pr-2 font-medium">{t('entries.description')}</th>
              <th className="py-1 pl-3 text-right font-medium whitespace-nowrap">
                {t('invoice.quantity')}
              </th>
              <th className="py-1 pl-4 text-right font-medium whitespace-nowrap">
                {t('invoice.price')}
              </th>
              <th className="py-1 pl-4 text-right font-medium whitespace-nowrap">
                {t('invoiceGuided.amount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filled.map((line, index) => {
              const price = parseMinorUnits(line.unitPrice) ?? 0n
              const lineNet = multiplyByDecimal(price, line.quantity === '' ? '0' : line.quantity)
              return (
                <tr key={index} className="border-b border-black/10">
                  <td className="py-1.5 pr-2 break-normal hyphens-auto" lang="nl">
                    {line.description}
                  </td>
                  <td className="pl-3 text-right whitespace-nowrap tabular-nums">
                    {line.quantity}
                  </td>
                  <td className="pl-4 text-right whitespace-nowrap tabular-nums">
                    {formatEuro(price)}
                  </td>
                  <td className="pl-4 text-right whitespace-nowrap tabular-nums">
                    {formatEuro(lineNet)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <dl className="mt-3 ml-auto w-48 space-y-0.5 text-xs tabular">
          <div className="flex justify-between gap-3">
            <dt className="text-black/60">{t('invoiceGuided.exVat')}</dt>
            <dd className="whitespace-nowrap">{formatEuro(totals.net)}</dd>
          </div>
          {totals.taxByLabel.map((row) => (
            <div key={row.label} className="flex justify-between gap-3">
              <dt className="text-black/60">{row.label}</dt>
              <dd className="whitespace-nowrap">{formatEuro(row.amount)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 border-t border-black/20 pt-1 text-sm font-semibold">
            <dt>{t('report.total')}</dt>
            <dd className="whitespace-nowrap">{formatEuro(totals.total)}</dd>
          </div>
        </dl>
      </div>

      <div>
        <h2 className="text-base">{t('invoiceGuided.whatHappens')}</h2>
        <ul className="mt-2 space-y-3 text-sm">
          <li className="border-border border-l-2 pl-3">
            {t('invoiceGuided.happensPay', {
              name: shortName,
              amount: formatEuro(totals.total),
              due: formatDateLongNl(dueDate, { includeYear: false }),
            })}
          </li>
          {totals.tax > 0n && (
            <li className="border-border border-l-2 pl-3">
              {t('invoiceGuided.happensVat', { amount: formatEuro(totals.tax) })}
            </li>
          )}
          <li className="border-border border-l-2 pl-3">
            {t('invoiceGuided.happensRevenue', { amount: formatEuro(totals.net) })}
          </li>
        </ul>
        <p className="text-muted-foreground mt-4 text-xs">{t('invoiceGuided.advancedHint')}</p>
      </div>
    </div>
  )
}

function SendStep({
  email,
  sendMethod,
  onSendMethod,
}: {
  email: string | null
  sendMethod: GuidedSendMethod
  onSendMethod: (method: GuidedSendMethod) => void
}) {
  const { t } = useT()

  const options: { id: GuidedSendMethod; title: string; sub: string; disabled?: boolean }[] = [
    {
      id: 'email',
      title:
        email !== null && email !== ''
          ? t('invoiceGuided.sendEmail', { email })
          : t('invoiceGuided.sendEmailMissing'),
      sub: t('invoiceGuided.sendEmailSub'),
      disabled: email === null || email === '',
    },
    {
      id: 'pdf',
      title: t('invoiceGuided.sendPdf'),
      sub: t('invoiceGuided.sendPdfSub'),
    },
  ]

  return (
    <>
      <p className="mb-2 text-sm font-medium">{t('invoiceGuided.howSend')}</p>
      <div role="radiogroup" aria-label={t('invoiceGuided.howSend')} className="space-y-2">
        {options.map((opt) => {
          const checked = sendMethod === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={opt.disabled}
              onClick={() => onSendMethod(opt.id)}
              className={cn(
                'flex min-h-16 w-full items-start gap-3 border p-4 text-left',
                'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                checked ? 'border-foreground' : 'border-border hover:bg-muted',
                opt.disabled && 'opacity-50',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-4 items-center justify-center border',
                  checked ? 'border-foreground' : 'border-border',
                )}
              >
                {checked ? <span className="bg-foreground size-2" /> : null}
              </span>
              <span>
                <span className="block text-sm font-medium">{opt.title}</span>
                <span className="text-muted-foreground block text-sm">{opt.sub}</span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="text-muted-foreground mt-4 flex items-start gap-2 text-sm">
        <RiInformationLine className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {t('invoiceGuided.sendNote')}
      </p>
    </>
  )
}
