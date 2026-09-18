import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { resolveListKey } from '~/lib/list-cursor'
import type { WorkQueueItem, WorkQueueKind } from '~/lib/work-queue'
import { getWorkQueue } from '~/server/dashboard'
import { getRgsCoverage, getTrialBalance, verifyChain } from '~/server/ledger'

/**
 * The dashboard: what to do next, then whether the books are sound.
 *
 * It used to be only the second half — trial balance, hash chain, RGS
 * coverage. Three true statements, none of which is work. The things actually
 * waiting for a bookkeeper on a Tuesday morning were spread over five screens,
 * and the way you found out a supplier invoice had been sitting in the postvak
 * for a week was by opening the postvak.
 *
 * So the queue is first and the health figures are underneath it, still here
 * because "treat unmapped accounts as a first-class health metric on the
 * dashboard" (spec 7.1) is right — it is just not the first question.
 *
 * Everything on this screen reads the book year chosen in the shell, including
 * the auditfile link. It used to read `new Date().getFullYear()`, which is a
 * different year from the books for any administration whose boekjaar does not
 * start in January — and setup offers exactly that.
 */
export const Route = createFileRoute('/_app/')({
  loader: async () => {
    const [queue, coverage, trial, chain] = await Promise.all([
      getWorkQueue(),
      getRgsCoverage({ data: {} }),
      getTrialBalance({ data: {} }),
      verifyChain(),
    ])
    return { queue, coverage, trial, chain }
  },
  component: Dashboard,
})

/** Where each kind of waiting work is done, and what to call it. */
const DESTINATIONS: Record<
  WorkQueueKind,
  {
    readonly to: string
    readonly search?: Record<string, string>
    readonly title: MessageKey
    readonly body: MessageKey
  }
> = {
  'sales.draft': {
    to: '/invoices',
    search: { status: 'draft' },
    title: 'queue.salesDraft',
    body: 'queue.salesDraftBody',
  },
  'sales.overdue': { to: '/dunning', title: 'queue.salesOverdue', body: 'queue.salesOverdueBody' },
  'bank.unmatched': {
    to: '/bank/match',
    title: 'queue.bankUnmatched',
    body: 'queue.bankUnmatchedBody',
  },
  'inbox.waiting': { to: '/inbox', title: 'queue.inboxWaiting', body: 'queue.inboxWaitingBody' },
  'purchase.book': {
    to: '/purchases',
    search: { status: 'draft' },
    title: 'queue.purchaseBook',
    body: 'queue.purchaseBookBody',
  },
  'purchase.approve': {
    to: '/purchases',
    search: { status: 'booked' },
    title: 'queue.purchaseApprove',
    body: 'queue.purchaseApproveBody',
  },
}

function Dashboard() {
  const { queue, coverage, trial, chain } = Route.useLoaderData()
  const { t } = useT()

  const year = queue.ok ? queue.data.fiscalYear : null

  return (
    <>
      <PageHeader
        title={t('dash.title')}
        description={
          year === null
            ? t('dash.introNoYear')
            : t('dash.intro', {
                year: year.code,
                from: formatDate(year.startsOn),
                to: formatDate(year.endsOn),
              })
        }
      />

      {!queue.ok ? (
        <p role="alert" className="text-destructive text-sm">
          {queue.problem.detail}
        </p>
      ) : (
        <WorkQueue items={queue.data.items} />
      )}

      <section className="mt-10">
        <h2 className="font-medium">{t('dash.healthTitle')}</h2>
        <p className="text-muted-foreground mt-1 mb-3 text-sm">{t('dash.healthBody')}</p>

        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label={t('dash.trialBalance')}
            value={trial.ok ? <Money amount={trial.data.difference} /> : '—'}
            hint={
              trial.ok && trial.data.difference === '0'
                ? t('dash.trialBalanceEqual')
                : t('dash.trialBalanceDifference')
            }
            tone={trial.ok && trial.data.difference === '0' ? 'good' : 'warn'}
          />

          <Stat
            label={t('dash.chain')}
            value={
              chain.ok
                ? chain.data.verified
                  ? t('dash.chainVerified')
                  : t('dash.chainBroken')
                : '—'
            }
            hint={
              chain.ok
                ? t('dash.chainHint', {
                    count: String(chain.data.entryCount),
                    head: chain.data.headHash?.slice(0, 12) ?? '—',
                  })
                : undefined
            }
            tone={chain.ok && chain.data.verified ? 'good' : 'warn'}
          />

          <Stat
            label={t('dash.rgsCoverage')}
            value={coverage.ok ? `${String(coverage.data.mappedPercentage)}%` : '—'}
            hint={
              coverage.ok
                ? t('dash.rgsCoverageHint', {
                    mapped: String(coverage.data.mappedCount),
                    total: String(coverage.data.accountCount),
                    version: coverage.data.version,
                  })
                : undefined
            }
            tone={coverage.ok && coverage.data.unmappedCount === 0 ? 'good' : 'warn'}
          />
        </div>
      </section>

      {coverage.ok && coverage.data.unmappedCount > 0 && (
        <section className="border-border mt-6 rounded-md border p-4">
          <h2 className="font-medium">{t('dash.unmapped')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('dash.unmappedBody')}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {coverage.data.unmappedAccounts.map((accountNumber) => (
              <li
                key={accountNumber}
                className="bg-unreconciled/15 rounded px-2 py-1 font-mono text-xs"
              >
                {accountNumber}
              </li>
            ))}
          </ul>
          <Link to="/accounts" className="mt-3 inline-block text-sm underline">
            {t('dash.unmappedFix')}
          </Link>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-medium">{t('dash.exportTitle')}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('dash.exportBody')}</p>
        <a
          href={`/api/v1/exports/audit-file?fiscalYear=${year?.code ?? ''}`}
          className="border-input mt-3 inline-block rounded-md border px-3 py-2 text-sm font-medium"
        >
          {t('dash.exportAction')}
        </a>
      </section>
    </>
  )
}

/**
 * The queue itself, and the keyboard that works it.
 *
 * Focus lands on the first row when the screen is ready, so the application
 * opens with the hands already on the work: `j`/`k` or the arrows move,
 * `Enter` opens, `Escape` steps out of the list and gives the global keys back.
 *
 * `Enter` is not intercepted. These are links, and a focused link already
 * opens on `Enter` — handling it here as well would navigate twice for one
 * keystroke. Which key means what is decided in `~/lib/list-cursor`, so the
 * rule is tested by naming keys rather than by driving a browser.
 */
function WorkQueue({ items }: { items: readonly WorkQueueItem[] }) {
  const { t } = useT()
  const hydrated = useHydrated()
  const [cursor, setCursor] = useState(0)
  const rows = useRef<(HTMLAnchorElement | null)[]>([])

  useEffect(() => {
    if (!hydrated) return
    rows.current[0]?.focus()
    // Once, when the keyboard starts working. Re-running it on every change
    // would drag focus back to the top the moment a row disappeared under
    // somebody who had moved past it.
  }, [hydrated])

  if (items.length === 0) {
    return (
      <section
        aria-labelledby="queue-empty"
        className="border-border rounded-md border border-dashed p-6"
      >
        <h2 id="queue-empty" className="font-medium">
          {t('queue.empty')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('queue.emptyBody')}</p>
        <Link
          to="/invoices/new"
          className="bg-primary text-primary-foreground mt-4 inline-block rounded-md px-4 py-2 text-sm font-medium"
        >
          {t('queue.emptyAction')}
        </Link>
      </section>
    )
  }

  const focusRow = (index: number): void => {
    setCursor(index)
    rows.current[index]?.focus()
  }

  return (
    <section aria-labelledby="queue-title">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 id="queue-title" className="font-medium">
          {t('queue.title')}
        </h2>
        {hydrated && <p className="text-muted-foreground text-xs">{t('queue.keyboardHint')}</p>}
      </div>

      <ol
        className="border-border divide-border divide-y rounded-md border"
        onKeyDown={(event) => {
          const resolution = resolveListKey(
            event.key,
            { index: cursor, count: items.length },
            event.metaKey || event.ctrlKey || event.altKey,
          )

          if (resolution.action === 'move') {
            event.preventDefault()
            focusRow(resolution.index)
          }
          if (resolution.action === 'leave') {
            event.preventDefault()
            // Out of the list rather than to somewhere else: Escape abandons
            // the thing you are in (docs/keyboard-map.md), and the global keys
            // are what is waiting on the other side of it.
            rows.current[cursor]?.blur()
          }
        }}
      >
        {items.map((item, index) => {
          const destination = DESTINATIONS[item.kind]
          return (
            <li key={item.kind}>
              <Link
                to={destination.to}
                // Spread rather than passed: with exactOptionalPropertyTypes a
                // `search` that might be undefined is not the same as no
                // `search`, and the rows that filter a list are the minority.
                {...(destination.search === undefined ? {} : { search: destination.search })}
                ref={(element: HTMLAnchorElement | null) => {
                  rows.current[index] = element
                }}
                tabIndex={index === cursor ? 0 : -1}
                onFocus={() => {
                  setCursor(index)
                }}
                className="hover:bg-accent/60 focus:bg-accent flex items-center gap-4 px-4 py-3 outline-none focus:outline-2"
              >
                <span className="bg-accent text-accent-foreground tabular flex min-w-9 shrink-0 justify-center rounded px-2 py-1 text-sm font-semibold">
                  {item.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t(destination.title)}</span>
                  <span className="text-muted-foreground block text-xs">{t(destination.body)}</span>
                </span>
                {item.amount !== null && (
                  <Money amount={item.amount} className="shrink-0 text-sm" />
                )}
                <span aria-hidden="true" className="text-muted-foreground shrink-0 text-sm">
                  →
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
