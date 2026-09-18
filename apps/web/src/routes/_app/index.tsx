import { createFileRoute, Link } from '@tanstack/react-router'
import { RiArrowRightLine } from '@remixicon/react'
import { useEffect, useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '~/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '~/components/ui/item'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { formatDate } from '~/lib/format'
import { fiscalYearSearch } from '~/lib/fiscal-year'
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
  validateSearch: fiscalYearSearch,
  loaderDeps: ({ search }) => ({ fiscalYear: search.fiscalYear }),
  loader: async ({ deps }) => {
    const year = deps.fiscalYear === undefined ? {} : { fiscalYear: String(deps.fiscalYear) }
    const [queue, coverage, trial, chain] = await Promise.all([
      getWorkQueue({ data: year }),
      getRgsCoverage({ data: {} }),
      getTrialBalance({ data: year }),
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
  // Late and unchased are two different jobs, so they are two rows: what is
  // overdue opens the ageing, what is due a letter opens Aanmaningen.
  'sales.overdue': {
    to: '/reports/debtor-ageing',
    title: 'queue.salesOverdue',
    body: 'queue.salesOverdueBody',
  },
  'dunning.waiting': {
    to: '/dunning',
    title: 'queue.dunningWaiting',
    body: 'queue.dunningWaitingBody',
  },
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
      <Empty className="border">
        <EmptyHeader>
          {/* A heading, said out loud: `EmptyTitle` is a `div`, and "nothing
              is waiting" is the answer to the question this screen exists to
              ask. Announcing it as body text buries it. */}
          <EmptyTitle role="heading" aria-level={2}>
            {t('queue.empty')}
          </EmptyTitle>
          <EmptyDescription>{t('queue.emptyBody')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link to="/invoices/new">{t('queue.emptyAction')}</Link>
          </Button>
        </EmptyContent>
      </Empty>
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

      <ItemGroup
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
            // The wrapper carries the list semantics `ItemGroup`'s `role="list"`
            // asks for. Putting `role="listitem"` on the row itself would take
            // the anchor's own role away, and a work queue whose rows are not
            // announced as links is a queue somebody cannot navigate.
            <div key={item.kind} role="listitem">
              <Item asChild variant="outline">
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
                >
                  <ItemMedia>
                    {/* Tabular, like every other figure in this application
                      (spec 11.3): a column of counts that jumps about as the
                      digits change is a column nobody can scan. */}
                    <Badge className="tabular text-sm">{item.count}</Badge>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{t(destination.title)}</ItemTitle>
                    <ItemDescription>{t(destination.body)}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    {item.amount !== null && <Money amount={item.amount} className="text-sm" />}
                    <RiArrowRightLine aria-hidden="true" className="text-muted-foreground size-4" />
                  </ItemActions>
                </Link>
              </Item>
            </div>
          )
        })}
      </ItemGroup>
    </section>
  )
}
