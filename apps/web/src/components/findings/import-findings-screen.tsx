/**
 * Import findings screen composition (redesign slice 4 / #61).
 *
 * Ports the prototype's `#/findings` layout: progress steps, honesty grid,
 * “Na te kijken” list with severity counts, resolved section, and the
 * empty / loading / error states. FindingCard props stay on the #41 contract.
 */

import {
  RiCheckboxBlankCircleLine,
  RiCheckLine,
  RiLoader4Line,
  RiRefreshLine,
} from '@remixicon/react'
import type { ReactNode } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { FindingsList, type FindingsListItem } from '~/components/findings/finding-card'
import { honestyClasses, type FindingHonesty } from '~/lib/finding-card'
import {
  importProgressSteps,
  type HonestySource,
  type ImportProgressStep,
  type ResolvedFindingRow,
} from '~/lib/import-findings'
import { cn } from '~/lib/utils'
import { useT } from '~/i18n/provider'
import type { MessageKey } from '~/i18n/nl'

const STEP_LABEL: Record<ImportProgressStep['id'], MessageKey> = {
  connect: 'importFindings.step.connect',
  read: 'importFindings.step.read',
  review: 'importFindings.step.review',
  import: 'importFindings.step.import',
}

export interface ImportFindingsScreenProps {
  readonly sourceLabel: string
  readonly subtitle?: string
  readonly connected: boolean
  readonly hasPreview: boolean
  readonly importing?: boolean
  readonly loading?: boolean
  readonly error?: string | null
  readonly findings: readonly FindingsListItem[]
  readonly sources: readonly HonestySource[]
  readonly resolved?: readonly ResolvedFindingRow[]
  readonly onReread?: () => void
  readonly onImport?: () => void
  readonly importDisabledReason?: string | null
  readonly emptySummary?: string
  readonly className?: string
  /** Geavanceerd: show technical paths on finding cards. */
  readonly advanced?: boolean
  /** Extra chrome under the findings list (FX/type panels still owned by caller). */
  readonly children?: ReactNode
}

export function ImportFindingsScreen({
  sourceLabel,
  subtitle,
  connected,
  hasPreview,
  importing = false,
  loading = false,
  error = null,
  findings,
  sources,
  resolved = [],
  onReread,
  onImport,
  importDisabledReason = null,
  emptySummary,
  className,
  advanced = false,
  children,
}: ImportFindingsScreenProps) {
  const { t } = useT()
  const blocking = findings.filter((f) => f.severity === 'blocking').length
  const warnings = findings.length - blocking
  const steps = importProgressSteps({
    connected,
    hasPreview,
    blockingCount: blocking,
    importing,
  })
  const canImport = hasPreview && blocking === 0 && onImport !== undefined && !loading
  const allClear = hasPreview && findings.length === 0 && !loading && error === null

  return (
    <div data-slot="import-findings" className={cn('mx-auto w-full max-w-4xl', className)}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">{t('importFindings.eyebrow')}</p>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight">{sourceLabel}</h2>
          {subtitle !== undefined && subtitle !== '' && (
            <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {onReread !== undefined && (
            <Button
              type="button"
              variant="outline"
              size="default"
              disabled={loading}
              onClick={onReread}
              className="min-h-11 gap-2 md:min-h-9"
            >
              <RiRefreshLine className="size-4" aria-hidden />
              {t('importFindings.reread')}
            </Button>
          )}
          {onImport !== undefined && (
            <Button
              type="button"
              size="default"
              disabled={!canImport}
              onClick={onImport}
              aria-describedby={
                !canImport && importDisabledReason !== null ? 'import-findings-why' : undefined
              }
              className="min-h-11 md:min-h-9"
            >
              {t('importFindings.import')}
            </Button>
          )}
        </div>
      </header>

      {!canImport && blocking > 0 && (
        <p id="import-findings-why" className="text-muted-foreground -mt-4 mb-6 text-right text-xs">
          {blocking === 1
            ? t('importFindings.blockingOne')
            : t('importFindings.blockingMany', { count: String(blocking) })}
        </p>
      )}
      {importDisabledReason !== null && blocking === 0 && !canImport && (
        <p className="text-muted-foreground -mt-4 mb-6 text-right text-xs">
          {importDisabledReason}
        </p>
      )}

      <ImportProgressStrip steps={steps} />

      {error !== null && error !== '' && (
        <p
          role="alert"
          data-slot="import-findings-error"
          className="border-destructive text-destructive mb-6 border px-4 py-3 text-sm"
        >
          {error}
        </p>
      )}

      {loading && (
        <div
          role="status"
          data-slot="import-findings-loading"
          className="animate-in-fade mb-6 flex items-center gap-3 border px-4 py-6 text-sm"
        >
          <RiLoader4Line className="size-5 animate-spin" aria-hidden />
          {t('importFindings.loading')}
        </div>
      )}

      {!loading && sources.length > 0 && (
        <section aria-labelledby="import-findings-sources" className="mb-8">
          <h3 id="import-findings-sources" className="mb-2 text-base font-medium">
            {t('importFindings.sourcesHeading')}
          </h3>
          <HonestyGrid sources={sources} />
        </section>
      )}

      {children}

      {!loading && hasPreview && (
        <section aria-labelledby="import-findings-open">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="import-findings-open" className="text-base font-medium">
              {t('importFindings.openHeading')}
            </h3>
            {findings.length > 0 && (
              <p className="text-muted-foreground text-sm tabular-nums">
                <span className="text-destructive">
                  {t('importFindings.blockingCount', { count: String(blocking) })}
                </span>
                {' · '}
                {t('importFindings.warningCount', { count: String(warnings) })}
              </p>
            )}
          </div>

          {allClear ? (
            <div
              data-slot="import-findings-empty"
              className="animate-in-fade flex flex-col items-center border px-6 py-12 text-center"
            >
              <span className="border-success text-success flex size-12 items-center justify-center border">
                <RiCheckLine className="check-draw size-7" aria-hidden />
              </span>
              <h4 className="mt-4 text-lg font-medium">{t('importFindings.allClearTitle')}</h4>
              <p className="text-muted-foreground mt-1 max-w-md text-sm">
                {emptySummary ?? t('importFindings.allClearBody')}
              </p>
              {canImport && (
                <Button type="button" className="mt-5 min-h-11 md:min-h-9" onClick={onImport}>
                  {t('importFindings.import')}
                </Button>
              )}
            </div>
          ) : (
            <FindingsList
              findings={findings}
              aria-label={t('importFindings.openHeading')}
              showShortcuts
              showPath={advanced}
            />
          )}
        </section>
      )}

      {!loading && resolved.length > 0 && (
        <section aria-labelledby="import-findings-resolved" className="mt-8">
          <h3 id="import-findings-resolved" className="mb-2 text-base font-medium">
            {t('importFindings.resolvedHeading')}{' '}
            <span className="text-muted-foreground tabular-nums">{resolved.length}</span>
          </h3>
          <ul role="list" className="divide-y border">
            {resolved.map((row) => (
              <li key={row.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className="text-success mt-0.5">
                  <RiCheckLine className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block">{row.title}</span>
                  <span className="text-muted-foreground block">{row.result}</span>
                </span>
                <code className="text-muted-foreground hidden font-mono text-[11px] sm:block">
                  {row.code}
                </code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ImportProgressStrip({ steps }: { readonly steps: readonly ImportProgressStep[] }) {
  const { t } = useT()
  return (
    <ol
      className="mb-6 flex items-center gap-2 overflow-x-auto text-sm"
      aria-label={t('importFindings.progressLabel')}
    >
      {steps.map((step, index) => (
        <li
          key={step.id}
          className="flex shrink-0 items-center gap-2"
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          {index > 0 && <span className="bg-border h-px w-6 md:w-10" aria-hidden />}
          <span
            className={cn(
              'flex size-6 items-center justify-center border text-xs tabular-nums',
              step.state === 'done' && 'border-foreground bg-foreground text-background',
              step.state === 'current' &&
                'border-foreground border-b-accent border-b-[3px] font-semibold',
              step.state === 'todo' && 'text-muted-foreground',
            )}
          >
            {step.state === 'done' ? <RiCheckLine className="size-3.5" aria-hidden /> : index + 1}
          </span>
          <span
            className={cn(
              step.state === 'todo' && 'text-muted-foreground',
              step.state === 'current' && 'font-medium',
            )}
          >
            {t(STEP_LABEL[step.id])}
          </span>
        </li>
      ))}
    </ol>
  )
}

function HonestyGrid({ sources }: { readonly sources: readonly HonestySource[] }) {
  return (
    <div
      data-slot="honesty-grid"
      className="bg-border grid grid-cols-2 gap-px border md:grid-cols-4"
    >
      {sources.map((source) => (
        <HonestyCell key={source.id} source={source} />
      ))}
    </div>
  )
}

function HonestyCell({ source }: { readonly source: HonestySource }) {
  const { t } = useT()
  const honesty = source.honesty
  const classes = honesty !== null ? honestyClasses(honesty) : null
  const label =
    honesty === 'unread'
      ? t('findingCard.honesty.unread')
      : honesty === 'empty'
        ? t('findingCard.honesty.empty')
        : honesty === 'reconciled'
          ? t('findingCard.honesty.reconciled')
          : null
  const hint =
    honesty === 'unread'
      ? t('findingCard.honesty.unreadHint')
      : honesty === 'empty'
        ? t('findingCard.honesty.emptyHint')
        : honesty === 'reconciled'
          ? t('findingCard.honesty.reconciledHint')
          : null
  return (
    <div
      data-honesty={honesty ?? 'count-only'}
      className={cn(
        'bg-background p-4',
        honesty === 'unread' &&
          '-outline-offset-4 outline outline-1 outline-dashed outline-[var(--line-strong)]',
      )}
    >
      <p className="text-sm font-medium">{source.label}</p>
      <p className="text-muted-foreground text-xs tabular-nums">{source.count}</p>
      {label !== null && honesty !== null && (
        <Badge
          variant={honesty === 'reconciled' ? 'success' : 'outline'}
          className={cn(
            'mt-2 normal-case tracking-normal',
            honesty === 'unread' && 'border-dashed',
            honesty === 'reconciled' && classes?.text,
          )}
        >
          {honesty === 'reconciled' ? (
            <RiCheckLine className="size-3" aria-hidden />
          ) : honesty === 'empty' ? (
            <RiCheckboxBlankCircleLine className="size-3" aria-hidden />
          ) : (
            <span
              className="inline-block size-2.5 rounded-full border border-dashed border-current"
              aria-hidden
            />
          )}
          {label}
        </Badge>
      )}
      {hint !== null && <p className="text-muted-foreground mt-1.5 text-xs">{hint}</p>}
      {honesty === 'unread' && source.onReread !== undefined && (
        <button
          type="button"
          onClick={source.onReread}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-4 md:min-h-0"
        >
          <RiRefreshLine className="size-3.5" aria-hidden />
          {t('importFindings.reread')}
        </button>
      )}
    </div>
  )
}

export type { FindingHonesty }
