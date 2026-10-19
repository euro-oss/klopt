import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { RiLockLine, RiSearchLine } from '@remixicon/react'
import { violationMessage } from '~/i18n/labels'
import { useEffect, useId, useRef, useState } from 'react'
import { AccountPicker } from '~/components/finance/account-picker'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Keycap, ShortcutFooter } from '~/components/ui/keycap'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useAdvancedMode } from '~/lib/advanced-mode-context'
import {
  MATCH_QUEUE_CAP,
  confidenceTone,
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
  suggestionBookedAmount,
  suggestionLabel,
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
 * Koppelen — bank statement lines matched to invoices and bookings (#61 slice 6).
 *
 * Ports the #57 prototype: Af/Bij table, suggestion panel (520px desktop /
 * full-width phone sheet), confirm / ignore, locked closed-period rows, and
 * the matched-today list. Suggestions stay per-selected-line (#68: no invented
 * aggregate counts). Keyboard: j/k, Enter opens then books, u clears, Esc back.
 */
export const Route = createFileRoute('/_app/bank/match')({
  loader: async ({ context }) => {
    const role =
      context.session.memberships.find((m) => m.entityId === context.session.activeEntityId)
        ?.role ??
      context.session.memberships[0]?.role ??
      ''
    const [transactions, accounts, bankAccounts, years] = await Promise.all([
      // Fetch one past the display cap so exactly MATCH_QUEUE_CAP lines do not
      // look like "500+" — remainingLabel only caps when fetchedCount > cap.
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

interface MatchedRow {
  readonly id: string
  readonly counterparty: string
  readonly amount: string
  readonly outgoing: boolean
  readonly result: string
}

const STRATEGY_KEY: Record<string, MessageKey> = {
  reference: 'match.strategy.reference',
  iban_amount: 'match.strategy.iban_amount',
  learned_rule: 'match.strategy.learned_rule',
  fuzzy_name: 'match.strategy.fuzzy_name',
  oldest_first: 'match.strategy.oldest_first',
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
    },
    locale,
  )
}

/** Prefer counterparty; fall back to description so the panel H2 matches the table. */
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

  const [selected, setSelected] = useState(0)
  const [answered, setAnswered] = useState<{ id: string; items: Suggestion[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [periodError, setPeriodError] = useState<PeriodLock | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [manualAccount, setManualAccount] = useState('')
  const [candidate, setCandidate] = useState(0)
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [matchedToday, setMatchedToday] = useState<MatchedRow[]>([])
  const keys = useRef<Map<string, string>>(new Map())
  const rows = useRef<(HTMLTableRowElement | null)[]>([])
  const panel = useRef<HTMLElement | null>(null)
  const candidates = useRef<(HTMLLIElement | null)[]>([])
  const accountPickerHost = useRef<HTMLDivElement | null>(null)

  const moveCandidate = (to: number): void => {
    setCandidate(to)
    candidates.current[to]?.focus()
  }

  const line = queue[Math.min(selected, Math.max(0, queue.length - 1))]
  const lineId = line?.id
  const suggestions = answered !== null && answered.id === lineId ? answered.items : null
  const loadingSuggestions = lineId !== undefined && suggestions === null
  const lock = line === undefined ? null : periodLockForDate(fiscalYears, line.bookingDate)
  const accountNameByNumber = new Map(postable.map((account) => [account.number, account.name]))

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
    setCandidate(0)
    setManualAccount('')
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
        // Shared #73/#74 helper: never-blank label (incl. "deze periode").
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
    const bookedAccount = accountNumber ?? suggestion?.accountNumber ?? null
    const resultLabel =
      suggestion === null
        ? advanced
          ? (bookedAccount ?? '')
          : (accountNameByNumber.get(bookedAccount ?? '') ?? bookedAccount ?? '')
        : suggestionLabel(suggestion, {
            preferAccountName: !advanced,
            accountName:
              suggestion.accountNumber === null
                ? null
                : (accountNameByNumber.get(suggestion.accountNumber) ?? null),
          })

    keys.current.delete(line.id)
    setFlashId(line.id)
    const reduceMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, reduceMotion ? 0 : ms)
      })
    await wait(420)
    setMatchedToday((current) => [
      {
        id: line.id,
        counterparty,
        amount: line.amount,
        outgoing: isOutgoing(line.amount),
        result: resultLabel,
      },
      ...current,
    ])
    setFlashId(null)
    closePhone()
    setNotice(
      t('match.posted', { name: counterparty }) +
        (result.data.learned ? t('match.postedLearned') : '.') +
        ' ' +
        t('match.postedEntry', { number: String(result.data.entryNumber) }),
    )
    setManualAccount('')
    setCandidate(0)
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
    await router.invalidate()
  }

  const openPanel = (): void => {
    const offered = suggestions ?? []
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      setPhoneOpen(true)
    }
    if (offered.length > 0) {
      moveCandidate(Math.min(candidate, offered.length - 1))
    } else {
      // Prefer the Categorie combobox, not the "search other" button above it.
      accountPickerHost.current
        ?.querySelector<HTMLElement>('input[role="combobox"]:not([disabled])')
        ?.focus()
    }
  }

  useEffect(() => {
    if (!hydrated) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return

      const target = event.target as HTMLElement | null
      // Esc still leaves the panel from the Categorie field; other chords stay
      // out of the way while somebody is typing an account number.
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

      const offered = suggestions ?? []
      const inPanel = phoneOpen || (target !== null && (panel.current?.contains(target) ?? false))
      const here = Math.min(candidate, Math.max(offered.length - 1, 0))

      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault()
        if (inPanel) moveCandidate(Math.min(here + 1, Math.max(offered.length - 1, 0)))
        else setSelected((current) => Math.min(current + 1, queue.length - 1))
        return
      }
      if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault()
        if (inPanel) moveCandidate(Math.max(here - 1, 0))
        else setSelected((current) => Math.max(current - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (!inPanel) {
          // Open even when locked so the named period notice is readable on phone.
          openPanel()
          return
        }
        if (isBookingBlocked(lock, canPostClosed)) return
        const chosen = offered[here]
        if (chosen !== undefined) void book(chosen, null)
        else if (manualAccount !== '') void book(null, manualAccount)
        return
      }
      if (event.key === 'u') {
        event.preventDefault()
        setManualAccount('')
        setCandidate(0)
        setNotice(null)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setCandidate(0)
        setManualAccount('')
        setNotice(null)
        setError(null)
        setPeriodError(null)
        if (phoneOpen) {
          closePhone()
          rows.current[selected]?.focus()
          return
        }
        rows.current[selected]?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  })

  const subtitle =
    primaryAccount === null
      ? t('match.subtitleBare')
      : t('match.subtitle', {
          name: primaryAccount.name,
          iban: ibanTail(primaryAccount.iban),
          when: t('match.updatedUnknown'),
        })

  if (!transactions.ok) {
    return (
      <>
        <header className="mb-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t('match.eyebrow')}
          </p>
          <h1 className="text-xl font-semibold tracking-tight">{t('match.title')}</h1>
        </header>
        <p role="alert" className="text-destructive text-sm">
          {transactions.problem.detail || t('match.loadError')}
        </p>
      </>
    )
  }

  const panelBody = (
    <MatchPanel
      panelRef={panel}
      titleId={panelTitleId}
      line={line}
      lock={lock}
      years={fiscalYears}
      suggestions={suggestions}
      loading={loadingSuggestions}
      candidate={candidate}
      candidatesRef={candidates}
      busy={busy}
      hydrated={hydrated}
      advanced={advanced}
      postable={postable}
      accountNameByNumber={accountNameByNumber}
      manualAccount={manualAccount}
      onManualAccount={setManualAccount}
      accountPickerHost={accountPickerHost}
      canPostClosed={canPostClosed}
      periodError={periodError}
      locale={tag}
      strategyOf={strategyOf}
      onSelectCandidate={setCandidate}
      onBook={(suggestion) => {
        void book(suggestion, null)
      }}
      onBookManual={() => {
        void book(null, manualAccount)
      }}
      onSkip={() => {
        void skip()
      }}
      onClear={() => {
        setManualAccount('')
        setCandidate(0)
      }}
      onClosePhone={phoneOpen ? closePhone : undefined}
      t={t}
    />
  )

  return (
    <>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t('match.eyebrow')}
          </p>
          <h1 className="text-xl font-semibold tracking-tight">{t('match.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm tabular">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground text-sm tabular">
            <span className="text-foreground text-lg font-semibold">{remainingText}</span>
          </p>
          <Link
            to="/bank"
            className="border-input inline-flex min-h-11 items-center border px-4 text-sm md:min-h-9"
          >
            {t('match.backToBank')}
          </Link>
        </div>
      </header>

      {notice !== null && queue.length > 0 && (
        <p role="status" className="border-border text-muted-foreground mb-4 border p-3 text-sm">
          {notice}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      {queue.length === 0 ? (
        <div className="border-border border p-6">
          <p className="font-medium">{t('match.nothingToDo')}</p>
          <p className="text-muted-foreground mt-1 text-sm">{t('match.nothingToDoBody')}</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_520px]">
          <div className="min-w-0">
            <div
              className="border-border overflow-x-auto border"
              tabIndex={-1}
              data-slot="scroll-table"
            >
              <table className="w-full min-w-[560px] text-sm" aria-label={t('match.queue')}>
                <thead className="bg-muted text-muted-foreground text-left text-xs">
                  <tr>
                    <th className="bg-muted sticky left-0 z-10 px-3 py-2 font-medium">
                      {t('match.col.counterparty')}
                    </th>
                    <th className="px-3 py-2 font-medium">{t('match.col.date')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('match.col.out')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('match.col.in')}</th>
                    <th className="px-3 py-2 font-medium">{t('match.col.suggestion')}</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {queue.map((item, index) => {
                    const sel = index === selected
                    const itemLock = periodLockForDate(fiscalYears, item.bookingDate)
                    const itemBlocked = isBookingBlocked(itemLock, canPostClosed)
                    const flashing = flashId === item.id
                    const out = isOutgoing(item.amount)
                    return (
                      <tr
                        key={item.id}
                        ref={(element) => {
                          rows.current[index] = element
                        }}
                        tabIndex={sel ? 0 : -1}
                        aria-selected={sel}
                        data-row={item.id}
                        onClick={() => {
                          setSelected(index)
                          setCandidate(0)
                          setPeriodError(null)
                          // Phone: tap opens the sheet (including locked rows — lock copy lives there).
                          if (
                            typeof window !== 'undefined' &&
                            window.matchMedia('(max-width: 1023px)').matches
                          ) {
                            setPhoneOpen(true)
                          }
                        }}
                        onFocus={() => {
                          setSelected(index)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                            event.preventDefault()
                            setSelected(index)
                            openPanel()
                          }
                        }}
                        className={cn(
                          'cursor-pointer transition-opacity duration-200 focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring',
                          sel && 'bg-muted',
                          !sel && 'hover:bg-muted/60',
                          flashing && 'bg-success/15',
                        )}
                      >
                        <td
                          className={cn(
                            'sticky left-0 z-10 border-l-[3px] px-3 py-3 font-medium md:whitespace-nowrap',
                            sel ? 'border-l-accent bg-muted' : 'border-l-transparent bg-background',
                            sel && 'bg-muted',
                          )}
                        >
                          {lineTitle(item, t)}
                          {item.counterpartyName !== null &&
                            item.counterpartyName !== '' &&
                            item.description !== '' && (
                              <span className="text-muted-foreground block max-w-48 truncate text-xs font-normal">
                                {item.description}
                              </span>
                            )}
                        </td>
                        <td className="text-muted-foreground px-3 py-3 whitespace-nowrap tabular">
                          {formatBankDay(item.bookingDate, tag)}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap tabular">
                          {out ? formatEuro(item.amount) : ''}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap tabular">
                          {!out ? formatEuro(item.amount) : ''}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap" data-cell="sug">
                          {flashing ? (
                            <span className="text-success inline-flex items-center gap-1.5 font-medium">
                              <svg
                                viewBox="0 0 24 24"
                                className="size-4"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.25"
                                aria-hidden
                              >
                                <path d="M5 12.5l4.5 4.5L19 7.5" />
                              </svg>
                              {t('match.matchedLabel')}
                            </span>
                          ) : itemBlocked && itemLock !== null ? (
                            <span className="text-muted-foreground flex max-w-48 items-center gap-1">
                              <RiLockLine className="size-3.5 shrink-0" aria-hidden />
                              <span className="truncate">
                                {periodName(itemLock, fiscalYears, tag)}
                              </span>
                            </span>
                          ) : sel && loadingSuggestions ? (
                            <span className="text-muted-foreground">{t('match.searching')}</span>
                          ) : sel && suggestions !== null && suggestions.length > 0 ? (
                            <span className="block max-w-48 truncate">
                              <span
                                className={cn(
                                  'mr-1.5 inline-block size-1.5 align-middle',
                                  confidenceTone(suggestions[0]!.confidence) === 'certain'
                                    ? 'bg-success'
                                    : 'bg-muted-foreground',
                                )}
                              />
                              {suggestionLabel(suggestions[0]!, {
                                preferAccountName: !advanced,
                                accountName:
                                  suggestions[0]!.accountNumber === null
                                    ? null
                                    : (accountNameByNumber.get(suggestions[0]!.accountNumber) ??
                                      null),
                              })}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{t('match.dash')}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-muted-foreground mt-2 text-xs md:hidden">{t('match.swipeHint')}</p>

            <ShortcutFooter
              ids={['match.next', 'match.previous', 'match.confirm', 'match.clear', 'match.leave']}
              className="border-accent mt-3 hidden md:flex"
            />

            {matchedToday.length > 0 && (
              <section className="mt-6" aria-labelledby="matched-today">
                <h2 id="matched-today" className="text-base font-medium">
                  {t('match.matchedToday')}
                </h2>
                <ul className="border-border mt-2 divide-y border text-sm">
                  {matchedToday.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{row.counterparty}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {row.result}
                        </span>
                      </span>
                      <span className="tabular shrink-0">
                        {row.outgoing ? '− ' : '+ '}
                        {formatEuro(row.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div className="hidden lg:sticky lg:top-20 lg:block">{panelBody}</div>
        </div>
      )}

      {phoneOpen && line !== undefined && (
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
            className="bg-background absolute inset-y-0 right-0 flex w-full flex-col border-l"
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

  // soft_closed
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
  suggestions,
  loading,
  candidate,
  candidatesRef,
  busy,
  hydrated,
  advanced,
  postable,
  accountNameByNumber,
  manualAccount,
  onManualAccount,
  accountPickerHost,
  canPostClosed,
  periodError,
  locale,
  strategyOf,
  onSelectCandidate,
  onBook,
  onBookManual,
  onSkip,
  onClear,
  onClosePhone,
  t,
}: {
  panelRef: React.RefObject<HTMLElement | null>
  titleId: string
  line: Line | undefined
  lock: PeriodLock | null
  years: readonly FiscalYearWithPeriods[]
  suggestions: Suggestion[] | null
  loading: boolean
  candidate: number
  candidatesRef: React.MutableRefObject<(HTMLLIElement | null)[]>
  busy: boolean
  hydrated: boolean
  advanced: boolean
  postable: readonly { number: string; name: string; isBlocked: boolean }[]
  accountNameByNumber: ReadonlyMap<string, string>
  manualAccount: string
  onManualAccount: (value: string) => void
  accountPickerHost: React.RefObject<HTMLDivElement | null>
  canPostClosed: boolean
  periodError: PeriodLock | null
  locale: string
  strategyOf: (strategy: string) => string
  onSelectCandidate: (index: number) => void
  onBook: (suggestion: Suggestion) => void
  onBookManual: () => void
  onSkip: () => void
  onClear: () => void
  onClosePhone: (() => void) | undefined
  t: (key: MessageKey, values?: Record<string, string>) => string
}) {
  if (line === undefined) {
    return (
      <div className="border-border text-muted-foreground border p-6 text-sm">
        {t('match.nothingToDo')}
      </div>
    )
  }

  const outgoing = isOutgoing(line.amount)
  const blocked = isBookingBlocked(lock, canPostClosed)
  const softNotice = lock !== null && lock.status === 'soft_closed' && canPostClosed && !blocked
  const offered = suggestions ?? []
  const shownLock = periodError ?? (blocked || softNotice ? lock : null)
  const copy =
    shownLock === null
      ? null
      : lockCopy(shownLock, years, line.bookingDate, locale, canPostClosed, t)

  return (
    <section
      ref={(element) => {
        panelRef.current = element
      }}
      aria-label={t('match.panelLabel')}
      className="border-border bg-background flex h-full flex-col border"
    >
      <div className="border-border border-b p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs tabular">
              {formatBankDay(line.bookingDate, locale)}
              {line.counterpartyIban === null ? '' : ` · ${line.counterpartyIban}`}
            </p>
            <h2 id={titleId} className="mt-0.5 text-base font-semibold">
              {lineTitle(line, t)}
            </h2>
            {line.counterpartyName !== null &&
              line.counterpartyName !== '' &&
              line.description !== '' && (
                <p className="text-muted-foreground text-sm">{line.description}</p>
              )}
          </div>
          <div className="text-right">
            <Badge variant="outline">
              {outgoing ? t('match.direction.out') : t('match.direction.in')}
            </Badge>
            <p className="mt-1 text-xl font-semibold tabular">
              {outgoing ? '− ' : '+ '}
              {formatEuro(line.amount)}
            </p>
          </div>
        </div>
        {onClosePhone !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 min-h-11 md:min-h-8"
            onClick={onClosePhone}
          >
            {t('match.panelClose')} <Keycap className="ml-1.5 hidden md:inline-flex">Esc</Keycap>
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {copy !== null && (
          <div className="p-4">
            <div className="border-border flex gap-3 border border-dashed p-4 text-sm">
              <RiLockLine className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">{copy.title}</p>
                <p className="text-muted-foreground mt-1">{copy.body}</p>
                {copy.showFiscalYearsLink && (
                  <Link
                    to="/fiscal-years"
                    className="text-muted-foreground mt-2 inline-flex min-h-11 items-center text-sm underline underline-offset-4 md:min-h-8"
                  >
                    {t('match.period.toFiscalYears')}
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}

        {!blocked && (
          <div className="p-4">
            {loading && <p className="text-muted-foreground text-sm">{t('match.searching')}</p>}

            {!loading && offered.length === 0 && (
              <p className="text-muted-foreground mb-4 text-sm">{t('match.noSuggestion')}</p>
            )}

            {!loading && offered.length > 0 && (
              <>
                <p className="mb-2 text-sm font-medium">
                  {offered.length > 1 ? t('match.whichBelongs') : t('match.belongsHere')}
                </p>
                <ul role="listbox" aria-label={t('match.col.suggestion')} className="space-y-2">
                  {offered.map((suggestion, index) => {
                    const active = index === candidate
                    const tone = confidenceTone(suggestion.confidence)
                    return (
                      <li
                        key={`${suggestion.strategy}-${String(index)}`}
                        ref={(element) => {
                          candidatesRef.current[index] = element
                        }}
                        role="option"
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        onFocus={() => {
                          onSelectCandidate(index)
                        }}
                        onClick={() => {
                          onSelectCandidate(index)
                        }}
                        className={cn(
                          'flex min-h-11 cursor-pointer items-start gap-3 border p-3',
                          active
                            ? 'border-foreground border-l-accent border-l-[3px] focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring'
                            : 'border-border hover:bg-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex size-4 items-center justify-center border',
                            active ? 'border-foreground' : 'border-border',
                          )}
                          aria-hidden
                        >
                          {active && <span className="bg-foreground size-2" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">
                              {suggestionLabel(suggestion, {
                                preferAccountName: !advanced,
                                accountName:
                                  suggestion.accountNumber === null
                                    ? null
                                    : (accountNameByNumber.get(suggestion.accountNumber) ?? null),
                              })}
                            </span>
                            <span className="text-sm tabular">
                              {suggestionBookedAmount(suggestion, line.amount)}
                            </span>
                          </span>
                          <span className="text-muted-foreground mt-0.5 flex items-center justify-between gap-2 text-xs">
                            <span>
                              {suggestion.reason}
                              {advanced && (
                                <>
                                  {' · '}
                                  {strategyOf(suggestion.strategy)}
                                  {' · '}
                                  {String(suggestion.confidence)}%
                                </>
                              )}
                            </span>
                            <Badge
                              variant={tone === 'certain' ? 'success' : 'outline'}
                              className="shrink-0"
                            >
                              {t(`match.confidence.${tone}`)}
                            </Badge>
                          </span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}

            <div ref={accountPickerHost} className="mt-4">
              <button
                type="button"
                className="text-muted-foreground inline-flex min-h-11 items-center gap-1.5 text-sm md:min-h-8"
                onClick={() => {
                  accountPickerHost.current
                    ?.querySelector<HTMLElement>('input:not([disabled])')
                    ?.focus()
                }}
              >
                <RiSearchLine className="size-3.5" aria-hidden />
                {t('match.searchOther')}
              </button>
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
                className="mt-2"
              />
              {(line.counterpartyName !== null || advanced) && (
                <p className="text-muted-foreground mt-2 text-xs">
                  {line.counterpartyName !== null
                    ? t('match.learnNote', { name: line.counterpartyName })
                    : t('match.learnNoteGeneric')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-border mt-auto flex flex-wrap items-center justify-end gap-2 border-t p-3">
        <Button
          type="button"
          variant="outline"
          disabled={busy || !hydrated}
          className="min-h-11 md:min-h-9"
          onClick={onSkip}
        >
          {t('match.skip')}
        </Button>
        {!blocked && offered.length > 0 && (
          <Button
            type="button"
            disabled={busy || !hydrated}
            className="min-h-11 md:min-h-9"
            onClick={() => {
              const chosen = offered[candidate]
              if (chosen !== undefined) onBook(chosen)
            }}
          >
            {t('match.confirm')}
            <Keycap className="ml-1.5 hidden md:inline-flex">↵</Keycap>
          </Button>
        )}
        {!blocked && offered.length === 0 && (
          <Button
            type="button"
            disabled={busy || !hydrated || manualAccount === ''}
            className="min-h-11 md:min-h-9"
            onClick={onBookManual}
          >
            {t('match.book')}
            <Keycap className="ml-1.5 hidden md:inline-flex">↵</Keycap>
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={busy || !hydrated}
          className="min-h-11 md:min-h-9"
          onClick={onClear}
        >
          {t('match.clearChoice')} <Keycap className="ml-1.5 hidden md:inline-flex">u</Keycap>
        </Button>
      </div>

      <div className="hidden px-3 pb-3 lg:block">
        <ShortcutFooter
          ids={['match.next', 'match.confirm', 'match.clear', 'match.leave']}
          className="border-accent mt-0 hidden md:flex"
        />
      </div>
    </section>
  )
}
