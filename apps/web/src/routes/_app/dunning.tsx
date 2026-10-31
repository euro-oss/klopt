import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { reminderEmailCopy } from '@klopt/core/reminder-email'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { SalesTabs } from '~/components/sales-tabs'
import { EuroAmount } from '~/components/finance/money'
import { Button } from '~/components/ui/button'
import { Empty, EmptyHeader, EmptyTitle } from '~/components/ui/empty'
import { Keycap } from '~/components/ui/keycap'
import { Badge } from '~/components/ui/badge'
import { dunningStageLabel } from '~/i18n/labels'
import { useT } from '~/i18n/provider'
import { formatMinorUnits } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { isApple, isTypingInto } from '~/lib/keyboard'
import { sendableDunningActions } from '~/lib/sales-list'
import { cn } from '~/lib/utils'
import { dunningQueue, sendReminder } from '~/server/sales'

/**
 * Sales → Reminders (#107 Phase 2). Route stays `/dunning`.
 *
 * Schedule and email text are read-only (no Change / Edit text / language pill)
 * until the [API] for customising them lands. Email preview uses the same
 * Dutch template as the transport (`reminderEmailCopy`).
 */

export const Route = createFileRoute('/_app/dunning')({
  loader: async () => ({ queue: await dunningQueue({ data: {} }) }),
  component: Dunning,
})

interface ActionRow {
  readonly invoiceId: string
  readonly number: string
  readonly contactName: string
  readonly contactEmail: string | null
  readonly total: string
  readonly currency: string
  readonly dueDate: string
  readonly daysOverdue: number
  readonly stage: number
  readonly stageLabel: string
  readonly tone: 'reminder' | 'demand' | 'final'
  readonly sendable: boolean
}

function Dunning() {
  const { queue } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t, plural } = useT()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** null = follow the first row; set when the user moves J/K or clicks. */
  const [activeId, setActiveId] = useState<string | null>(null)
  /** null = all rows selected (default); a Set once the user toggles. */
  const [selectedOverride, setSelectedOverride] = useState<ReadonlySet<string> | null>(null)
  const keys = useRef<Map<string, string>>(new Map())
  const busyRef = useRef(false)

  const actions = useMemo((): readonly ActionRow[] => (queue.ok ? queue.data.actions : []), [queue])
  const schedule = queue.ok ? queue.data.schedule : []
  const asOf = queue.ok ? queue.data.asOf : ''

  const resolvedActiveId =
    activeId !== null && actions.some((row) => row.invoiceId === activeId)
      ? activeId
      : (actions[0]?.invoiceId ?? null)

  const selected = useMemo((): ReadonlySet<string> => {
    if (selectedOverride === null) {
      return new Set(actions.map((row) => row.invoiceId))
    }
    const next = new Set(
      [...selectedOverride].filter((id) => actions.some((row) => row.invoiceId === id)),
    )
    return next.size > 0 ? next : new Set(actions.map((row) => row.invoiceId))
  }, [actions, selectedOverride])

  const active = useMemo(
    () => actions.find((row) => row.invoiceId === resolvedActiveId) ?? null,
    [actions, resolvedActiveId],
  )

  async function chase(action: ActionRow): Promise<boolean> {
    if (!keys.current.has(action.invoiceId)) {
      keys.current.set(action.invoiceId, crypto.randomUUID())
    }
    const result = await sendReminder({
      data: {
        invoiceId: action.invoiceId,
        idempotencyKey: keys.current.get(action.invoiceId) ?? crypto.randomUUID(),
        expectedStage: action.stage,
        asOf,
      },
    })
    if (!result.ok) {
      setError(result.problem.status === 409 ? t('dunning.expectedStage') : result.problem.detail)
      return false
    }
    keys.current.delete(action.invoiceId)
    if (result.data.failure !== null) {
      setError(t('dunning.sendFailed', { name: action.contactName, reason: result.data.failure }))
      return false
    }
    setNotice(
      t('dunning.sent', {
        stage: dunningStageLabel(t, result.data.tone),
        name: action.contactName,
      }),
    )
    return true
  }

  async function sendSelected(targets: readonly ActionRow[]) {
    if (busyRef.current) return
    if (targets.length === 0) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    for (const action of targets) {
      const ok = await chase(action)
      if (!ok) break
    }
    busyRef.current = false
    setBusy(false)
    await router.invalidate()
  }

  useEffect(() => {
    if (!hydrated || !queue.ok) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || isTypingInto(event.target)) return
      const mod = isApple() ? event.metaKey : event.ctrlKey

      if (mod && event.key === 'Enter') {
        event.preventDefault()
        const targets = sendableDunningActions(actions.filter((row) => selected.has(row.invoiceId)))
        void sendSelected(targets)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (resolvedActiveId === null) return
      const index = actions.findIndex((row) => row.invoiceId === resolvedActiveId)
      if (event.key === 'j' || event.key === 'J') {
        const next = actions[Math.min(index + 1, actions.length - 1)]
        if (next !== undefined) {
          event.preventDefault()
          setActiveId(next.invoiceId)
        }
        return
      }
      if (event.key === 'k' || event.key === 'K') {
        const next = actions[Math.max(index - 1, 0)]
        if (next !== undefined) {
          event.preventDefault()
          setActiveId(next.invoiceId)
        }
        return
      }
      if (event.key === 'x' || event.key === 'X') {
        event.preventDefault()
        setSelectedOverride((prev) => {
          const base = prev ?? new Set(actions.map((row) => row.invoiceId))
          const next = new Set(base)
          if (next.has(resolvedActiveId)) next.delete(resolvedActiveId)
          else next.add(resolvedActiveId)
          return next
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
    // sendSelected is recreated each render; deps below cover its closed values.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyboard handler
  }, [actions, asOf, hydrated, queue.ok, resolvedActiveId, selected, t])

  if (!queue.ok) {
    return (
      <>
        <PageHeader title={t('sales.title')} />
        <SalesTabs active="reminders" />
        <p role="alert" className="text-destructive text-sm">
          {queue.problem.detail}
        </p>
      </>
    )
  }

  const preview =
    active === null
      ? null
      : reminderEmailCopy({
          invoiceNumber: active.number,
          total: formatMinorUnits(BigInt(active.total)),
          currency: active.currency,
          dueDate: active.dueDate,
          stage: active.stage,
          daysOverdue: active.daysOverdue,
        })

  const selectedRows = actions.filter((row) => selected.has(row.invoiceId))
  const sendableSelected = sendableDunningActions(selectedRows)
  const skippedNoEmail = selectedRows.length - sendableSelected.length
  const sendableCount = sendableSelected.length
  const selectedSum = sendableSelected.reduce((sum, row) => sum + BigInt(row.total), 0n)

  return (
    <>
      <PageHeader
        title={t('sales.title')}
        actions={
          actions.length > 0 ? (
            <Button
              type="button"
              disabled={busy || !hydrated || sendableCount === 0}
              onClick={() => {
                void sendSelected(sendableSelected)
              }}
              className="min-h-11 md:min-h-9"
            >
              {busy
                ? t('common.busy')
                : plural('dunning.sendAll', sendableCount, { count: String(sendableCount) })}
              {hydrated && (
                <span className="ml-1 inline-flex gap-0.5 normal-case">
                  <Keycap>{isApple() ? '⌘' : 'Ctrl'}</Keycap>
                  <Keycap>↵</Keycap>
                </span>
              )}
            </Button>
          ) : undefined
        }
      />

      <SalesTabs active="reminders" remindersCount={actions.length} />

      {notice !== null && (
        <p className="border-border text-muted-foreground mb-4 rounded-[var(--radius-md)] border p-3 text-sm">
          {notice}
        </p>
      )}
      {skippedNoEmail > 0 && actions.length > 0 && (
        <p className="text-ink-muted mb-4 text-sm">
          {plural('dunning.skipNoEmail', skippedNoEmail, { count: String(skippedNoEmail) })}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-label={t('dunning.list')}
          className="flex min-w-0 flex-[999_1_540px] flex-col gap-4"
        >
          <div className="border-border bg-surface flex flex-wrap items-center gap-3 rounded-[var(--radius-xl)] border p-4 md:p-5">
            <span className="flex min-w-[200px] flex-1 flex-col">
              <strong>{t('dunning.scheduleTitle')}</strong>
              <span className="text-ink-muted text-[13px]">{t('dunning.scheduleHint')}</span>
            </span>
            {schedule.map((stage) => (
              <span
                key={stage.stage}
                className="bg-surface-sunken flex flex-1 flex-col gap-0.5 rounded-[var(--radius-md)] px-3 py-2.5"
              >
                <span className="text-ink-muted text-xs">
                  {t('dunning.scheduleAfter', { days: String(stage.afterDays) })}
                </span>
                <strong className="text-[13px]">{dunningStageLabel(t, stage.tone)}</strong>
              </span>
            ))}
            {/* Change control hidden — schedule is read-only until [API] (#107). */}
          </div>

          {actions.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('dunning.empty')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="border-border bg-surface overflow-hidden rounded-[var(--radius-xl)] border">
              <div className="overflow-x-auto">
                <div className="min-w-[600px]">
                  <div className="text-ink-muted grid grid-cols-[20px_minmax(160px,1fr)_92px_110px_120px] gap-3 border-b border-[var(--line-soft)] px-5 py-2.5 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={selectedRows.length === actions.length && actions.length > 0}
                      aria-label={t('dunning.selected_other', { count: String(actions.length) })}
                      onChange={(event) => {
                        setSelectedOverride(
                          event.target.checked
                            ? new Set(actions.map((row) => row.invoiceId))
                            : new Set(),
                        )
                      }}
                      className="m-0"
                    />
                    <span>{t('invoices.contact')}</span>
                    <span>{t('dunning.invoice')}</span>
                    <span className="text-right">{t('dunning.amount')}</span>
                    <span>{t('dunning.nextStep')}</span>
                  </div>
                  {actions.map((action) => {
                    const isActive = action.invoiceId === resolvedActiveId
                    const isChecked = selected.has(action.invoiceId)
                    return (
                      <button
                        key={action.invoiceId}
                        type="button"
                        aria-selected={isActive}
                        onClick={() => {
                          setActiveId(action.invoiceId)
                        }}
                        className={cn(
                          'hover:bg-surface-hover grid w-full grid-cols-[20px_minmax(160px,1fr)_92px_110px_120px] gap-3 border-b border-[var(--line-soft)] px-5 py-3 text-left text-sm last:border-b-0',
                          'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                          isActive && 'bg-surface-sunken',
                        )}
                      >
                        <span
                          role="checkbox"
                          aria-checked={isChecked}
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedOverride((prev) => {
                              const base = prev ?? new Set(actions.map((row) => row.invoiceId))
                              const next = new Set(base)
                              if (next.has(action.invoiceId)) next.delete(action.invoiceId)
                              else next.add(action.invoiceId)
                              return next
                            })
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== ' ' && event.key !== 'Enter') return
                            event.preventDefault()
                            event.stopPropagation()
                            setSelectedOverride((prev) => {
                              const base = prev ?? new Set(actions.map((row) => row.invoiceId))
                              const next = new Set(base)
                              if (next.has(action.invoiceId)) next.delete(action.invoiceId)
                              else next.add(action.invoiceId)
                              return next
                            })
                          }}
                          className={cn(
                            'mt-0.5 flex size-4 items-center justify-center rounded-[var(--radius-xs)] border-[1.5px] border-input text-[11px]',
                            isChecked && 'bg-primary text-primary-foreground border-primary',
                          )}
                        >
                          {isChecked ? '✓' : ''}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{action.contactName}</span>
                          <span className="text-danger text-xs">
                            {plural('dunning.daysLate', action.daysOverdue, {
                              days: String(action.daysOverdue),
                            })}
                          </span>
                          {!action.sendable && (
                            <span className="text-unreconciled text-xs">
                              {t('dunning.noEmail')}
                            </span>
                          )}
                        </span>
                        <span className="text-ink-2 tabular-nums">{action.number}</span>
                        <span className="text-right font-medium">
                          <EuroAmount amount={action.total} />
                        </span>
                        <span>
                          <Badge variant={action.tone === 'final' ? 'destructive' : 'default'}>
                            {dunningStageLabel(t, action.tone)}
                          </Badge>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="text-ink-muted flex justify-between border-t border-[var(--line-soft)] px-5 py-3 text-[13px]">
                <span>
                  {plural('dunning.selected', sendableCount, { count: String(sendableCount) })}
                </span>
                <span className="tabular-nums">
                  {t('dunning.outstandingSum', {
                    amount: `€\u00a0${formatMinorUnits(selectedSum)}`,
                  })}
                </span>
              </div>
            </div>
          )}

          <section className="border-border bg-surface flex flex-wrap items-start gap-3 rounded-[var(--radius-xl)] border p-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-semibold">{t('dunning.matchCalloutTitle')}</span>
              <span className="text-ink-muted text-sm">{t('dunning.matchCalloutBody')}</span>
            </div>
            <Link
              to="/bank/match"
              className="text-ink shrink-0 font-semibold underline underline-offset-2"
            >
              {t('dunning.openMatch')}
            </Link>
          </section>
        </section>

        {active !== null && preview !== null && (
          <aside
            aria-label={t('dunning.preview')}
            className="border-border bg-surface hidden max-w-[460px] min-w-0 flex-[1_1_380px] flex-col overflow-hidden rounded-[var(--radius-xl)] border md:flex"
          >
            <div className="flex items-center gap-2 border-b border-[var(--line-soft)] px-6 py-4">
              <strong className="flex-1">{t('dunning.emailPreview')}</strong>
              {/* Language pill and Edit text hidden — read-only until [API]. */}
            </div>
            <dl className="grid grid-cols-[88px_1fr] gap-y-2 border-b border-[var(--line-soft)] px-6 py-4 text-[13px]">
              <dt className="text-ink-muted">{t('dunning.emailTo')}</dt>
              <dd className="m-0">{active.contactEmail ?? t('dunning.noEmail')}</dd>
              <dt className="text-ink-muted">{t('dunning.emailSubject')}</dt>
              <dd className="m-0 font-semibold">{preview.subject}</dd>
              <dt className="text-ink-muted">{t('dunning.emailAttached')}</dt>
              <dd className="m-0">{t('dunning.emailAttachedFiles', { number: active.number })}</dd>
            </dl>
            <div className="text-ink-2 flex flex-col gap-3 px-6 py-5 leading-relaxed whitespace-pre-wrap">
              {preview.text}
            </div>
            <div className="text-ink-muted flex flex-wrap gap-4 px-6 pb-5 text-xs">
              <span>
                <Keycap>J</Keycap> <Keycap>K</Keycap>
              </span>
              <span>
                <Keycap>X</Keycap>
              </span>
            </div>
          </aside>
        )}
      </div>

      {hydrated && actions.length > 0 && (
        <p className="text-muted-foreground mt-6 hidden flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] md:flex">
          <span className="inline-flex items-center gap-1">
            <Keycap>j</Keycap>
            <Keycap>k</Keycap>
            <span>{t('sales.hints.nextPrev')}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Keycap>x</Keycap>
            <span>{t('sales.hints.select')}</span>
          </span>
        </p>
      )}
    </>
  )
}
