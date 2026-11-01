import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { violationMessage } from '~/i18n/labels'
import { useEffect, useId, useRef, useState } from 'react'
import { BankTabs } from '~/components/bank-tabs'
import { AccountPicker } from '~/components/finance/account-picker'
import { Button } from '~/components/ui/button'
import { MatchChoiceOption } from '~/components/ui/choice-option'
import { Keycap } from '~/components/ui/keycap'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useAdvancedMode } from '~/lib/advanced-mode-context'
import {
  buildMatchChoices,
  matchProgressPercent,
  type MatchChoice,
  type MatchChoiceId,
} from '~/lib/bank-match-choices'
import {
  MATCH_QUEUE_CAP,
  absoluteMinor,
  formatBankDay,
  formatBankDayWithYear,
  formatEuro,
  ibanTail,
  isBookingBlocked,
  isOutgoing,
  isPeriodLockViolation,
  periodLockForDate,
  periodLockFromViolation,
  remainingLabel,
  type FiscalYearWithPeriods,
  type PeriodLock,
} from '~/lib/bank-match'
import { periodLabel, sentencePeriodLabel } from '~/lib/period-label'
import { useHydrated } from '~/lib/hydration'
import { may, MAY_POST_CLOSED } from '~/lib/roles'
import { cn } from '~/lib/utils'
import {
  confirmMatch,
  ignoreTransaction,
  listBankAccounts,
  listBankTransactions,
  suggestMatches,
} from '~/server/bank'
import { listAccounts } from '~/server/ledger'
import { listFiscalYears } from '~/server/setup'

/**
 * Bank · To match — v2 Match board (#107 Phase 7 / #129).
 *
 * One line at a time, ChoiceOption 1–4 (at most one Suggested), S skip, U
 * attach receipt (inbox), Z undo notice (no unmatch API), option 4 opens the
 * existing account form. Closed-period lines keep their treatment. Split (#76)
 * and the Uitgave sheet (#77) stay separate.
 */

export const Route = createFileRoute('/_app/bank/match')({
  loader: async ({ context }) => {
    const role =
      context.session.memberships.find((m) => m.entityId === context.session.activeEntityId)
        ?.role ??
      context.session.memberships[0]?.role ??
      ''
    const [transactions, accounts, bankAccounts, years] = await Promise.all([
      listBankTransactions({ data: { status: 'unmatched', limit: MATCH_QUEUE_CAP + 1 } }),
      listAccounts(),
      listBankAccounts(),
      listFiscalYears(),
    ])
    return { transactions, accounts, bankAccounts, years, role }
  },
  component: MatchQueue,
})

interface Line {
  id: string
  amount: string
  currency: string
  bookingDate: string
  counterpartyName: string | null
  counterpartyIban: string | null
  description: string
}

interface Suggestion {
  strategy: string
  confidence: number
  reason: string
  accountNumber: string | null
  chargesAmount: string
  chargesAccountNumber: string | null
  ruleId: string | null
  allocations: { invoiceId: string; number: string; amount: string }[]
}

const STRATEGY_KEY: Record<string, MessageKey> = {
  reference: 'match.strategy.reference',
  iban_amount: 'match.strategy.iban_amount',
  learned_rule: 'match.strategy.learned_rule',
  fuzzy_name: 'match.strategy.fuzzy_name',
  oldest_first: 'match.strategy.oldest_first',
}

const CHOICE_TITLE: Record<MatchChoiceId, MessageKey> = {
  cost: 'match.choice.cost',
  invoice: 'match.choice.invoice',
  transfer: 'match.choice.transfer',
  other: 'match.choice.other',
}

function periodName(
  lock: PeriodLock,
  years: readonly FiscalYearWithPeriods[],
  locale: string,
): string {
  return periodLabel(
    years,
    {
      fiscalYear: lock.fiscalYear,
      period: lock.period > 0 ? String(lock.period) : '',
      startsOn: lock.startsOn,
      endsOn: lock.endsOn,
      yearStatus: lock.status === 'year_closed' ? 'closed' : 'open',
    },
    locale,
  )
}

function lineTitle(
  line: Pick<Line, 'counterpartyName' | 'description'>,
  t: (key: MessageKey, values?: Record<string, string>) => string,
): string {
  if (line.counterpartyName !== null && line.counterpartyName !== '') {
    return line.counterpartyName
  }
  if (line.description !== '') return line.description
  return t('match.noCounterpartyTitle')
}

function choiceMeta(
  choice: MatchChoice,
  outgoing: boolean,
  vatHint: string | null,
  accountNameByNumber: ReadonlyMap<string, string>,
  advanced: boolean,
  strategyOf: (strategy: string) => string,
  t: (key: MessageKey, values?: Record<string, string>) => string,
): string {
  const advancedSuffix = (suggestion: {
    readonly strategy: string
    readonly confidence: number
    readonly reason: string
  }): string => {
    if (!advanced) return suggestion.reason
    return `${suggestion.reason} · ${strategyOf(suggestion.strategy)} · ${String(suggestion.confidence)}%`
  }

  if (choice.id === 'cost') {
    if (choice.action.type === 'book_suggestion') {
      const suggestion = choice.action.suggestion
      if (advanced) return advancedSuffix(suggestion)
      const name = accountNameByNumber.get(suggestion.accountNumber ?? '')
      return name !== undefined && name !== ''
        ? t('match.choice.costMetaAccount', { account: name })
        : t('match.choice.costMetaAccount', {
            account: suggestion.accountNumber ?? suggestion.reason,
          })
    }
    return vatHint !== null
      ? t('match.choice.costMetaVat', { vat: vatHint })
      : t('match.choice.costMeta')
  }
  if (choice.id === 'invoice') {
    if (choice.action.type === 'book_suggestion') {
      const suggestion = choice.action.suggestion
      if (advanced) return advancedSuffix(suggestion)
      if (choice.invoiceNumbers.length > 0) {
        return t('match.choice.invoiceMetaKnown', {
          numbers: choice.invoiceNumbers.join(', '),
        })
      }
      return suggestion.reason
    }
    return outgoing ? t('match.choice.invoiceMetaOut') : t('match.choice.invoiceMetaIn')
  }
  if (choice.id === 'transfer') return t('match.choice.transferMeta')
  return t('match.choice.otherMeta')
}

function MatchQueue() {
  const { transactions, accounts, bankAccounts, years, role } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const { advanced } = useAdvancedMode()
  const { t, plural, tag } = useT()
  const panelTitleId = useId()

  const canPostClosed = may(MAY_POST_CLOSED, role)

  const strategyOf = (strategy: string) => {
    const key = STRATEGY_KEY[strategy]
    return key === undefined ? strategy : t(key)
  }

  const fetched: Line[] = transactions.ok ? transactions.data.transactions : []
  const remainingText = remainingLabel(fetched.length, t('match.remainingCapped'), (count) =>
    plural('match.remaining', count),
  )
  const queue = fetched.length > MATCH_QUEUE_CAP ? fetched.slice(0, MATCH_QUEUE_CAP) : fetched
  const postable = accounts.ok ? accounts.data.accounts.filter((account) => !account.isBlocked) : []
  const fiscalYears: FiscalYearWithPeriods[] = years.ok
    ? (years.data.fiscalYears as FiscalYearWithPeriods[])
    : []
  const primaryAccount = bankAccounts.ok ? (bankAccounts.data.accounts[0] ?? null) : null
  const toMatchCount = bankAccounts.ok
    ? bankAccounts.data.accounts.reduce(
        (total, account) => total + account.reconciliation.unmatchedCount,
        0,
      )
    : fetched.length

  // Snapshot the queue length on first mount so the progress bar counts down
  // as lines are booked, without reading a ref during render.
  const [sessionBaseline] = useState(() => fetched.length)
  const totalForBar = sessionBaseline
  const doneCount = Math.max(0, totalForBar - fetched.length)
  const progress = matchProgressPercent(doneCount, totalForBar)

  const [selected, setSelected] = useState(0)
  const [answered, setAnswered] = useState<{ id: string; items: Suggestion[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [periodError, setPeriodError] = useState<PeriodLock | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [manualAccount, setManualAccount] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [formFor, setFormFor] = useState<MatchChoiceId | null>(null)
  const [phoneOpen, setPhoneOpen] = useState(false)
  const keys = useRef<Map<string, string>>(new Map())
  const rows = useRef<(HTMLButtonElement | null)[]>([])
  const panel = useRef<HTMLElement | null>(null)
  const accountPickerHost = useRef<HTMLDivElement | null>(null)

  const selectLine = (index: number): void => {
    setSelected(index)
    setFormOpen(false)
    setFormFor(null)
    setManualAccount('')
    setPeriodError(null)
  }

  const line = queue[Math.min(selected, Math.max(0, queue.length - 1))]
  const lineId = line?.id
  const suggestions = answered !== null && answered.id === lineId ? answered.items : null
  const loadingSuggestions = lineId !== undefined && suggestions === null
  const lock = line === undefined ? null : periodLockForDate(fiscalYears, line.bookingDate)
  const accountNameByNumber = new Map(postable.map((account) => [account.number, account.name]))
  // Show the four options while suggestions load (none suggested yet); the
  // fetch only decides which one gets the Suggested tag / book-now action.
  const choices = buildMatchChoices(loadingSuggestions ? [] : suggestions)
  const outgoing = line !== undefined && isOutgoing(line.amount)

  const keyFor = (transactionId: string): string => {
    const existing = keys.current.get(transactionId)
    if (existing !== undefined) return existing
    const fresh = crypto.randomUUID()
    keys.current.set(transactionId, fresh)
    return fresh
  }

  useEffect(() => {
    if (lineId === undefined) return

    let cancelled = false
    void suggestMatches({ data: { transactionId: lineId } })
      .then((result) => {
        if (cancelled) return
        setAnswered({ id: lineId, items: result.ok ? result.data.suggestions : [] })
        if (!result.ok) setError(result.problem.detail)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setAnswered({ id: lineId, items: [] })
        setError(
          cause instanceof Error
            ? t('match.suggestionsFailedWhy', { reason: cause.message })
            : t('match.suggestionsFailed'),
        )
      })

    return () => {
      cancelled = true
    }
  }, [lineId, t])

  const closePhone = (): void => {
    setPhoneOpen(false)
  }

  const focusPicker = (): void => {
    queueMicrotask(() => {
      accountPickerHost.current
        ?.querySelector<HTMLElement>('input[role="combobox"]:not([disabled])')
        ?.focus()
    })
  }

  const book = async (
    suggestion: Suggestion | null,
    accountNumber: string | null,
  ): Promise<void> => {
    if (line === undefined || busy) return
    if (isBookingBlocked(lock, canPostClosed)) return

    setBusy(true)
    setError(null)
    setPeriodError(null)
    setNotice(null)

    const result = await confirmMatch({
      data: {
        transactionId: line.id,
        idempotencyKey: keyFor(line.id),
        body: {
          allocations: (suggestion?.allocations ?? []).map((allocation) => ({
            invoiceId: allocation.invoiceId,
            amount: allocation.amount,
          })),
          accountNumber: accountNumber ?? suggestion?.accountNumber ?? null,
          chargesAmount: suggestion?.chargesAmount ?? '0',
          chargesAccountNumber: suggestion?.chargesAccountNumber ?? null,
          ruleId: suggestion?.ruleId ?? null,
        },
      },
    })

    setBusy(false)

    if (!result.ok) {
      const locked = result.problem.violations.find((item) => isPeriodLockViolation(item.code))
      if (locked !== undefined) {
        setPeriodError(periodLockFromViolation(fiscalYears, locked.code, locked.detail))
        return
      }
      setError(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => violationMessage(t, item)).join(' ')
          : result.problem.detail,
      )
      return
    }

    const counterparty = lineTitle(line, t)
    keys.current.delete(line.id)
    closePhone()
    setNotice(
      t('match.posted', { name: counterparty }) +
        (result.data.learned ? t('match.postedLearned') : '.') +
        ' ' +
        t('match.postedEntry', { number: String(result.data.entryNumber) }),
    )
    setManualAccount('')
    setFormOpen(false)
    setFormFor(null)
    await router.invalidate()
  }

  const skip = async (): Promise<void> => {
    if (line === undefined || busy) return

    setBusy(true)
    setError(null)
    setPeriodError(null)

    const result = await ignoreTransaction({
      data: { transactionId: line.id, idempotencyKey: keyFor(line.id) },
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.problem.detail)
      return
    }

    keys.current.delete(line.id)
    setNotice(t('match.skipped'))
    closePhone()
    setFormOpen(false)
    setFormFor(null)
    await router.invalidate()
  }

  const openForm = (choiceId: MatchChoiceId): void => {
    setFormOpen(true)
    setFormFor(choiceId)
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      setPhoneOpen(true)
    }
    focusPicker()
  }

  const applyChoice = (choice: MatchChoice): void => {
    if (line === undefined || busy) return
    if (isBookingBlocked(lock, canPostClosed)) {
      if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
        setPhoneOpen(true)
      }
      return
    }
    // Book-suggestion needs the fetch; opening the form does not.
    if (choice.action.type === 'book_suggestion') {
      if (loadingSuggestions) return
      const suggestion = choice.action.suggestion
      void book(
        {
          ...suggestion,
          allocations: suggestion.allocations.map((row) => ({ ...row })),
        },
        null,
      )
      return
    }
    openForm(choice.id)
  }

  useEffect(() => {
    if (!hydrated) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return

      const target = event.target as HTMLElement | null
      if (
        target !== null &&
        /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) &&
        event.key !== 'Escape'
      ) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const onControl = target !== null && /^(BUTTON|A)$/.test(target.tagName)
      if (onControl && (event.key === 'Enter' || event.key === ' ')) return

      const inPanel = phoneOpen || (target !== null && (panel.current?.contains(target) ?? false))

      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault()
        selectLine(Math.min(selected + 1, Math.max(queue.length - 1, 0)))
        return
      }
      if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault()
        selectLine(Math.max(selected - 1, 0))
        return
      }
      if (event.key === '1' || event.key === '2' || event.key === '3' || event.key === '4') {
        event.preventDefault()
        const choice = choices.find((item) => item.key === event.key)
        if (choice !== undefined) applyChoice(choice)
        return
      }
      if (event.key === 's' || event.key === 'S') {
        event.preventDefault()
        void skip()
        return
      }
      if (event.key === 'u' || event.key === 'U') {
        event.preventDefault()
        // Attach receipt: inbox is where uploads land; no match-attach API yet.
        void router.navigate({ to: '/inbox' })
        return
      }
      if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault()
        setNotice(t('match.undoUnavailable'))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (!inPanel && formOpen === false) {
          if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
            setPhoneOpen(true)
          }
          const suggested = choices.find((item) => item.suggested)
          if (suggested !== undefined) applyChoice(suggested)
          else openForm('other')
          return
        }
        if (isBookingBlocked(lock, canPostClosed)) return
        if (manualAccount !== '') void book(null, manualAccount)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setManualAccount('')
        setFormOpen(false)
        setFormFor(null)
        setNotice(null)
        setError(null)
        setPeriodError(null)
        if (phoneOpen) closePhone()
        const rowIndex = selected
        queueMicrotask(() => {
          rows.current[rowIndex]?.focus()
        })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  })

  const accountSummary =
    primaryAccount === null
      ? t('match.subtitleBare')
      : primaryAccount.reconciliation.statementBalance === null
        ? t('match.accountSummaryBare', {
            name: primaryAccount.name,
            iban: ibanTail(primaryAccount.iban),
          })
        : t('match.accountSummary', {
            name: primaryAccount.name,
            iban: ibanTail(primaryAccount.iban),
            balance: formatEuro(primaryAccount.reconciliation.statementBalance),
          })

  if (!transactions.ok) {
    return (
      <>
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">{t('bank.title')}</h1>
        </header>
        <p role="alert" className="text-destructive text-sm">
          {transactions.problem.detail || t('match.loadError')}
        </p>
      </>
    )
  }

  const vatHint =
    line === undefined ? null : formatEuro(((absoluteMinor(line.amount) * 21n) / 121n).toString())

  const panelBody =
    line === undefined ? null : (
      <MatchPanel
        panelRef={panel}
        titleId={panelTitleId}
        line={line}
        lock={lock}
        years={fiscalYears}
        choices={choices}
        loading={loadingSuggestions}
        busy={busy}
        hydrated={hydrated}
        advanced={advanced}
        postable={postable}
        accountNameByNumber={accountNameByNumber}
        manualAccount={manualAccount}
        onManualAccount={setManualAccount}
        accountPickerHost={accountPickerHost}
        formOpen={formOpen}
        formFor={formFor}
        canPostClosed={canPostClosed}
        periodError={periodError}
        locale={tag}
        outgoing={outgoing}
        vatHint={vatHint}
        strategyOf={strategyOf}
        onChoose={applyChoice}
        onBookManual={() => {
          void book(null, manualAccount)
        }}
        onSkip={() => {
          void skip()
        }}
        onClosePhone={phoneOpen ? closePhone : undefined}
        t={t}
      />
    )

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 px-0 pt-1 pb-0">
        <h1 className="min-w-0 flex-1 text-2xl leading-[30px] font-semibold tracking-[-0.01em]">
          {t('bank.title')}
        </h1>
        <span className="text-ink-2 font-mono text-sm tabular-nums">{accountSummary}</span>
        <span className="text-ink-2 text-sm tabular-nums">{remainingText}</span>
        <Button asChild variant="outline" className="min-h-11 md:min-h-9">
          <Link to="/bank">{t('bank.importStatement')}</Link>
        </Button>
        <BankTabs active="match" toMatchCount={toMatchCount > 0 ? toMatchCount : undefined} />
      </header>

      {notice !== null && (
        <p role="status" className="border-border text-ink-2 mt-4 border p-3 text-sm">
          {notice}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {error}
        </p>
      )}

      {queue.length === 0 ? (
        <div className="bg-card border-border mt-5 flex flex-col items-center gap-2.5 rounded-[var(--radius-xl)] border px-8 py-12 text-center shadow-[var(--shadow-raised)]">
          <p className="text-xl leading-[26px] font-semibold">{t('match.nothingToDo')}</p>
          <p className="text-ink-2 text-sm">{t('match.nothingToDoBody')}</p>
          <p className="text-ink-muted mt-2 text-sm">{remainingText}</p>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-start gap-5">
          <section
            aria-label={t('match.queue')}
            className="bg-card border-border max-w-[360px] min-w-0 flex-1 overflow-hidden rounded-[var(--radius-xl)] border shadow-[var(--shadow-raised)]"
          >
            <div className="flex flex-col gap-2 px-4 py-3.5">
              <div className="flex justify-between text-[13px]">
                <span className="font-semibold">
                  {t('match.progress', {
                    done: String(doneCount),
                    total: String(totalForBar),
                  })}
                </span>
                <span className="text-ink-muted">{t('match.newestFirst')}</span>
              </div>
              <div className="bg-line-soft h-1.5 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-1.5 rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${String(progress)}%` }}
                />
              </div>
            </div>
            <div className="max-h-[640px] overflow-y-auto" data-slot="match-queue">
              {queue.map((item, index) => {
                const sel = index === selected
                const itemLock = periodLockForDate(fiscalYears, item.bookingDate)
                const itemBlocked = isBookingBlocked(itemLock, canPostClosed)
                return (
                  <button
                    key={item.id}
                    type="button"
                    ref={(element) => {
                      rows.current[index] = element
                    }}
                    tabIndex={sel ? 0 : -1}
                    aria-selected={sel}
                    data-row={item.id}
                    onClick={() => {
                      selectLine(index)
                      if (
                        typeof window !== 'undefined' &&
                        window.matchMedia('(max-width: 1023px)').matches
                      ) {
                        setPhoneOpen(true)
                      }
                    }}
                    onFocus={() => {
                      selectLine(index)
                    }}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-3 border-b px-4 py-2.5 text-left last:border-b-0',
                      'border-border focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                      sel
                        ? 'bg-selection shadow-[inset_3px_0_0_var(--selection-edge)]'
                        : 'hover:bg-surface-hover',
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate font-medium">{lineTitle(item, t)}</span>
                      <span className="text-ink-muted text-xs">
                        {itemBlocked && itemLock !== null ? (
                          <span className="inline-flex items-center gap-1">
                            <Lock className="size-3 shrink-0" aria-hidden />
                            {periodName(itemLock, fiscalYears, tag)}
                          </span>
                        ) : (
                          formatBankDay(item.bookingDate, tag)
                        )}
                      </span>
                    </span>
                    <span className="font-mono text-sm font-medium tabular-nums">
                      {isOutgoing(item.amount) ? '−' : '+'}
                      {formatEuro(item.amount)}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section
            aria-label={t('match.panelLabel')}
            className="hidden min-w-0 flex-[999_1_460px] flex-col gap-4 lg:flex"
          >
            {panelBody}
          </section>
        </div>
      )}

      {phoneOpen && line !== undefined && panelBody !== null && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            data-slot="match-overlay"
            onClick={closePhone}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={panelTitleId}
            className="bg-background absolute inset-y-0 right-0 flex w-full flex-col overflow-y-auto border-l p-4"
          >
            {panelBody}
          </div>
        </div>
      )}
    </>
  )
}

function lockCopy(
  lock: PeriodLock,
  years: readonly FiscalYearWithPeriods[],
  lineDate: string,
  locale: string,
  canPostClosed: boolean,
  t: (key: MessageKey, values?: Record<string, string>) => string,
): { readonly title: string; readonly body: string; readonly showFiscalYearsLink: boolean } {
  const detail = {
    fiscalYear: lock.fiscalYear,
    period: lock.period > 0 ? String(lock.period) : '',
    startsOn: lock.startsOn,
    endsOn: lock.endsOn,
    yearStatus: lock.status === 'year_closed' ? 'closed' : 'open',
  }
  const period = periodName(lock, years, locale)
  const Period = sentencePeriodLabel(years, detail, locale)
  const date = formatBankDayWithYear(lineDate, locale)
  const fallsIn = t('match.period.fallsIn', { date, period })

  if (lock.status === 'hard_closed' || lock.status === 'year_closed') {
    return {
      title: Period,
      body: `${fallsIn} ${t('match.period.hardClosed', { period: Period })}`,
      showFiscalYearsLink: false,
    }
  }

  if (canPostClosed) {
    return {
      title: Period,
      body: t('match.period.softClosedNotice', { period: Period }),
      showFiscalYearsLink: true,
    }
  }

  return {
    title: Period,
    body: `${fallsIn} ${t('match.period.softClosedBookkeeper', { period: Period })}`,
    showFiscalYearsLink: false,
  }
}

function MatchPanel({
  panelRef,
  titleId,
  line,
  lock,
  years,
  choices,
  loading,
  busy,
  hydrated,
  advanced,
  postable,
  accountNameByNumber,
  manualAccount,
  onManualAccount,
  accountPickerHost,
  formOpen,
  formFor,
  canPostClosed,
  periodError,
  locale,
  outgoing,
  vatHint,
  strategyOf,
  onChoose,
  onBookManual,
  onSkip,
  onClosePhone,
  t,
}: {
  panelRef: React.RefObject<HTMLElement | null>
  titleId: string
  line: Line
  lock: PeriodLock | null
  years: readonly FiscalYearWithPeriods[]
  choices: readonly MatchChoice[]
  loading: boolean
  busy: boolean
  hydrated: boolean
  advanced: boolean
  postable: readonly { number: string; name: string; isBlocked: boolean }[]
  accountNameByNumber: ReadonlyMap<string, string>
  manualAccount: string
  onManualAccount: (value: string) => void
  accountPickerHost: React.RefObject<HTMLDivElement | null>
  formOpen: boolean
  formFor: MatchChoiceId | null
  canPostClosed: boolean
  periodError: PeriodLock | null
  locale: string
  outgoing: boolean
  vatHint: string | null
  strategyOf: (strategy: string) => string
  onChoose: (choice: MatchChoice) => void
  onBookManual: () => void
  onSkip: () => void
  onClosePhone: (() => void) | undefined
  t: (key: MessageKey, values?: Record<string, string>) => string
}) {
  void strategyOf
  const blocked = isBookingBlocked(lock, canPostClosed)
  const softNotice = lock !== null && lock.status === 'soft_closed' && canPostClosed && !blocked
  const shownLock = periodError ?? (blocked || softNotice ? lock : null)
  const copy =
    shownLock === null
      ? null
      : lockCopy(shownLock, years, line.bookingDate, locale, canPostClosed, t)

  return (
    <div
      ref={(element) => {
        panelRef.current = element
      }}
      className="flex flex-col gap-4"
    >
      <div className="bg-card border-border flex flex-wrap items-start gap-5 rounded-[var(--radius-xl)] border p-6 shadow-[var(--shadow-raised)]">
        <div className="flex min-w-[260px] flex-1 flex-col gap-1">
          <span className="text-ink-muted font-mono text-[13px] tabular-nums">
            {formatBankDayWithYear(line.bookingDate, locale)}
            {' · '}
            {outgoing ? t('match.direction.debit') : t('match.direction.credit')}
          </span>
          <h2 id={titleId} className="text-[22px] leading-7 font-semibold">
            {lineTitle(line, t)}
          </h2>
          {line.description !== '' && (
            <span className="text-ink-2">
              {'\u201C'}
              {line.description}
              {'\u201D'}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="font-mono text-[30px] leading-9 font-semibold tracking-[-0.02em] tabular-nums">
            {outgoing ? '− ' : '+ '}
            {formatEuro(line.amount)}
          </span>
          <span className="text-ink-muted text-[13px]">
            {outgoing ? t('match.moneyOut') : t('match.moneyIn')}
          </span>
        </div>
        {onClosePhone !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 w-full md:min-h-8"
            onClick={onClosePhone}
          >
            {t('match.panelClose')} <Keycap className="ml-1.5 hidden md:inline-flex">Esc</Keycap>
          </Button>
        )}
      </div>

      {copy !== null && (
        <div className="border-border flex gap-3 rounded-[var(--radius-xl)] border border-dashed p-4 text-sm">
          <Lock className="text-ink-muted mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{copy.title}</p>
            <p className="text-ink-2 mt-1">{copy.body}</p>
            {copy.showFiscalYearsLink && (
              <Link
                to="/fiscal-years"
                className="text-link mt-2 inline-flex min-h-11 items-center text-sm underline underline-offset-4 md:min-h-8"
              >
                {t('match.period.toFiscalYears')}
              </Link>
            )}
          </div>
        </div>
      )}

      {!blocked && (
        <div className="flex flex-col gap-2.5">
          <h3 className="text-ink-2 m-0 text-sm font-semibold">{t('match.whatWasThis')}</h3>
          {loading && <p className="text-ink-muted text-sm">{t('match.searching')}</p>}
          {choices.map((choice) => (
            <MatchChoiceOption
              key={choice.id}
              choiceKey={choice.key}
              title={t(CHOICE_TITLE[choice.id])}
              meta={choiceMeta(
                choice,
                outgoing,
                vatHint,
                accountNameByNumber,
                advanced,
                strategyOf,
                t,
              )}
              suggested={choice.suggested}
              suggestedLabel={t('match.suggested')}
              disabled={busy || !hydrated}
              onClick={() => {
                onChoose(choice)
              }}
            />
          ))}

          {formOpen && (
            <div
              ref={accountPickerHost}
              className="bg-card border-border mt-2 rounded-[var(--radius-xl)] border p-4 shadow-[var(--shadow-raised)]"
            >
              <p className="mb-2 text-sm font-medium">
                {formFor === 'transfer'
                  ? t('match.form.transfer')
                  : formFor === 'invoice'
                    ? t('match.form.invoice')
                    : formFor === 'cost'
                      ? t('match.form.cost')
                      : t('match.form.other')}
              </p>
              <AccountPicker
                label={advanced ? t('match.chooseAdvanced') : t('match.chooseYourself')}
                accounts={postable}
                value={manualAccount}
                onValueChange={onManualAccount}
                emptyOption={
                  advanced ? t('match.chooseAdvancedPlaceholder') : t('match.choosePlaceholder')
                }
                disabled={!hydrated || busy}
                showAccountNumbers={advanced}
              />
              {(line.counterpartyName !== null || advanced) && (
                <p className="text-ink-muted mt-2 text-xs">
                  {line.counterpartyName !== null
                    ? t('match.learnNote', { name: line.counterpartyName })
                    : t('match.learnNoteGeneric')}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={busy || !hydrated || manualAccount === ''}
                  className="min-h-11 md:min-h-9"
                  onClick={onBookManual}
                >
                  {t('match.book')}
                  <Keycap className="ml-1.5 hidden md:inline-flex">↵</Keycap>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !hydrated}
                  className="min-h-11 md:min-h-9"
                  onClick={onSkip}
                >
                  {t('match.skip')}
                  <Keycap className="ml-1.5 hidden md:inline-flex">S</Keycap>
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="text-ink-muted hidden flex-wrap gap-4 pt-1 text-[13px] md:flex">
        <span>
          <Keycap>1</Keycap>–<Keycap>4</Keycap> {t('match.hint.choose')}
        </span>
        <span>
          <Keycap>S</Keycap> {t('match.hint.skip')}
        </span>
        <span>
          <Keycap>U</Keycap> {t('match.hint.receipt')}
        </span>
        <span>
          <Keycap>Z</Keycap> {t('match.hint.undo')}
        </span>
      </div>
    </div>
  )
}
