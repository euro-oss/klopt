import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { violationMessage } from '~/i18n/labels'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import {
  confirmMatch,
  ignoreTransaction,
  listBankTransactions,
  suggestMatches,
} from '~/server/bank'
import { listAccounts } from '~/server/ledger'

/**
 * The koppelwachtrij — the queue (spec 7.4).
 *
 * "Everything else goes to a suggestion queue with a confidence score and a
 * one-keystroke confirm."
 *
 * Built as a queue rather than a table with dropdowns, because the work is
 * repetitive and the whole value is rhythm: the arrow keys move, `Enter` takes
 * the top suggestion, `1`–`9` take a specific one, `x` skips. After a
 * confirmation the line disappears and the selection lands on the next one, so
 * a hundred lines is a hundred keystrokes rather than a hundred round trips
 * through a mouse.
 *
 * Suggestions are fetched for the selected line only. Fetching them for all of
 * them up front would mean a query per line before the screen could paint,
 * which for a month of transactions is the difference between instant and not.
 */
export const Route = createFileRoute('/_app/bank/match')({
  loader: async () => ({
    transactions: await listBankTransactions({ data: { status: 'unmatched', limit: 500 } }),
    accounts: await listAccounts(),
  }),
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

function confidenceClass(confidence: number): string {
  if (confidence >= 90) return 'bg-accent text-accent-foreground'
  if (confidence >= 70) return 'border-input border'
  return 'text-muted-foreground border-input border border-dashed'
}

function MatchQueue() {
  const { transactions, accounts } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t } = useT()

  /** An unrecognised strategy is shown raw rather than as a blank. */
  const strategyOf = (strategy: string) => {
    const key = STRATEGY_KEY[strategy]
    return key === undefined ? strategy : t(key)
  }

  const queue: Line[] = transactions.ok ? transactions.data.transactions : []
  const postable = accounts.ok ? accounts.data.accounts.filter((account) => !account.isBlocked) : []

  const [selected, setSelected] = useState(0)
  /**
   * Suggestions are keyed by the line they belong to, and derived rather than
   * cleared.
   *
   * Setting them to null when the selection moves would be a `setState` inside
   * an effect, which React 19 rightly objects to — and it would also flash the
   * previous line's suggestions for a frame. Keying them means a stale answer
   * simply does not match, and "still loading" is the absence of an answer for
   * the current line rather than a second piece of state to keep in step.
   */
  const [answered, setAnswered] = useState<{ id: string; items: Suggestion[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [manualAccount, setManualAccount] = useState('')
  const keys = useRef<Map<string, string>>(new Map())

  const line = queue[Math.min(selected, Math.max(0, queue.length - 1))]
  const lineId = line?.id
  const suggestions = answered !== null && answered.id === lineId ? answered.items : null
  const loading = lineId !== undefined && suggestions === null

  /** One key per line, so a double confirm books once. */
  const keyFor = useCallback((transactionId: string): string => {
    const existing = keys.current.get(transactionId)
    if (existing !== undefined) return existing
    const fresh = crypto.randomUUID()
    keys.current.set(transactionId, fresh)
    return fresh
  }, [])

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
        /**
         * A rejected fetch, as opposed to a request that arrived and said no.
         *
         * This used to have no catch, so a transport failure became an
         * unhandled rejection and the root error boundary replaced the whole
         * screen — a bookkeeper working the queue lost the queue. It showed up
         * as a browser test that failed about one run in four, because holding
         * ArrowDown fires a request per selection and a superseded one can die
         * in flight.
         *
         * A superseded request failing is not news: `cancelled` means the
         * answer is already irrelevant. A current one failing is worth saying
         * out loud, and the suggestions are emptied rather than left showing
         * the previous transaction's.
         */
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

  const book = useCallback(
    async (suggestion: Suggestion | null, accountNumber: string | null) => {
      if (line === undefined || busy) return

      setBusy(true)
      setError(null)
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
        setError(
          result.problem.violations.length > 0
            ? result.problem.violations.map((item) => violationMessage(t, item)).join(' ')
            : result.problem.detail,
        )
        return
      }

      keys.current.delete(line.id)
      const body = result.data
      setNotice(
        t('match.posted', { number: String(body.entryNumber) }) +
          (body.learned ? t('match.postedLearned') : '.'),
      )
      setManualAccount('')
      // The row goes; the selection stays put, which lands it on the next line.
      await router.invalidate()
    },
    [line, busy, keyFor, router, t],
  )

  const skip = useCallback(async () => {
    if (line === undefined || busy) return

    setBusy(true)
    setError(null)

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
    await router.invalidate()
  }, [line, busy, keyFor, router, t])

  /**
   * The keyboard is the point.
   *
   * Bound on the window rather than a focused element: the hands never leave
   * the keys, so there is nothing to focus first. `Enter` takes the best
   * suggestion because that is what it is for; a number takes a specific one,
   * which matters when the top two are close.
   */
  useEffect(() => {
    if (!hydrated) return

    const onKeyDown = (event: KeyboardEvent) => {
      // Somebody already took it — a global shortcut, usually. Without this,
      // pressing `g` and then a digit would arm the navigation prefix and book
      // suggestion one at the same time.
      if (event.defaultPrevented) return

      const target = event.target as HTMLElement | null
      // Never steal a key from something being typed into.
      if (target !== null && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault()
        setSelected((current) => Math.min(current + 1, queue.length - 1))
        return
      }
      if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault()
        setSelected((current) => Math.max(current - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const best = suggestions?.[0]
        if (best !== undefined) void book(best, null)
        return
      }
      if (event.key === 'x') {
        event.preventDefault()
        void skip()
        return
      }
      if (/^[1-9]$/.test(event.key)) {
        const chosen = suggestions?.[Number(event.key) - 1]
        if (chosen !== undefined) {
          event.preventDefault()
          void book(chosen, null)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [hydrated, queue.length, suggestions, book, skip])

  if (!transactions.ok) {
    return (
      <>
        <PageHeader title={t('match.title')} />
        <p role="alert" className="text-destructive text-sm">
          {transactions.problem.detail}
        </p>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={t('match.title')}
        description={t('match.intro')}
        actions={
          <Link to="/bank" className="border-input rounded-md border px-4 py-2 text-sm">
            {t('match.backToBank')}
          </Link>
        }
      />

      {notice !== null && (
        <p className="border-border text-muted-foreground mb-4 rounded-md border p-3 text-sm">
          {notice}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      {queue.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-md border border-dashed p-6 text-sm">
          {t('match.nothingToDo')}
        </p>
      ) : (
        <div className="grid grid-cols-[22rem_1fr] gap-6">
          <ol
            aria-label={t('match.queue')}
            className="border-border max-h-[36rem] overflow-y-auto rounded-md border"
          >
            {queue.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={index === selected}
                  onClick={() => {
                    setSelected(index)
                  }}
                  className={`border-border w-full border-b px-3 py-2 text-left text-sm last:border-b-0 ${
                    index === selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                  }`}
                >
                  <span className="flex justify-between gap-2">
                    <span className="tabular text-xs">{formatDate(item.bookingDate)}</span>
                    <Money amount={item.amount} className="text-xs" />
                  </span>
                  <span className="mt-0.5 block truncate">
                    {item.counterpartyName ??
                      (item.description === '' ? t('match.noCounterparty') : item.description)}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div>
            {line !== undefined && (
              <div className="border-border mb-4 rounded-md border p-4">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <p className="font-medium">
                      {line.counterpartyName ?? t('match.noCounterpartyTitle')}
                    </p>
                    <p className="text-muted-foreground tabular text-xs">
                      {formatDate(line.bookingDate)}
                      {line.counterpartyIban === null ? '' : ` · ${line.counterpartyIban}`}
                    </p>
                  </div>
                  <Money amount={line.amount} className="text-xl font-semibold" />
                </div>
                {line.description !== '' && (
                  <p className="text-muted-foreground mt-2 text-sm">{line.description}</p>
                )}
              </div>
            )}

            {loading && <p className="text-muted-foreground text-sm">{t('match.searching')}</p>}

            {suggestions !== null && suggestions.length === 0 && (
              <p className="text-muted-foreground border-border mb-4 rounded-md border border-dashed p-4 text-sm">
                {t('match.noSuggestion')}
              </p>
            )}

            <ol className="mb-6 space-y-2">
              {(suggestions ?? []).map((suggestion, index) => (
                <li
                  key={`${suggestion.strategy}-${String(index)}`}
                  className="border-border flex items-start gap-3 rounded-md border p-3"
                >
                  <span
                    className={`tabular rounded px-2 py-1 text-xs font-medium ${confidenceClass(suggestion.confidence)}`}
                  >
                    {suggestion.confidence}%
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-muted-foreground block text-xs">
                      {index < 9 && (
                        <kbd className="border-input mr-1 rounded border px-1">{index + 1}</kbd>
                      )}
                      {strategyOf(suggestion.strategy)}
                    </span>
                    <span className="block text-sm">{suggestion.reason}</span>
                    {suggestion.allocations.length > 0 && (
                      <span className="text-muted-foreground mt-1 block text-xs">
                        {suggestion.allocations.map((allocation) => allocation.number).join(', ')}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={busy || !hydrated}
                    onClick={() => {
                      void book(suggestion, null)
                    }}
                    className="bg-primary text-primary-foreground shrink-0 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  >
                    {t('match.book')}
                  </button>
                </li>
              ))}
            </ol>

            <div className="border-border flex items-end gap-3 rounded-md border p-4">
              <SelectField
                label={t('match.chooseYourself')}
                value={manualAccount}
                onValueChange={setManualAccount}
                disabled={!hydrated}
                className="flex-1"
              >
                <SelectOption value="">{t('match.choosePlaceholder')}</SelectOption>
                {postable.map((account) => (
                  <SelectOption key={account.number} value={account.number}>
                    {account.number} {account.name}
                  </SelectOption>
                ))}
              </SelectField>
              <button
                type="button"
                disabled={busy || !hydrated || manualAccount === ''}
                onClick={() => {
                  void book(null, manualAccount)
                }}
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {t('match.book')}
              </button>
              <button
                type="button"
                disabled={busy || !hydrated}
                onClick={() => {
                  void skip()
                }}
                className="border-input rounded-md border px-4 py-2 text-sm disabled:opacity-50"
              >
                {t('match.skip')}{' '}
                <kbd className="border-input ml-1 rounded border px-1 text-xs">x</kbd>
              </button>
            </div>

            <p className="text-muted-foreground mt-4 max-w-2xl text-xs">{t('match.learnNote')}</p>
          </div>
        </div>
      )}
    </>
  )
}
