/**
 * Shared chrome for the import wizard: six-step rail + Volgende/Terug footer.
 *
 * Moneybird and XAF use the v2 six-step stepper (#134). Exact Phase 2 uses the
 * same stepper with its five steps only (#161), so later work is not shown as
 * a disabled stub.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Circle, LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Keycap } from '~/components/ui/keycap'
import { Stepper } from '~/components/ui/stepper'
import { useT } from '~/i18n/provider'
import type { MessageKey } from '~/i18n/nl'
import { useHydrated } from '~/lib/hydration'
import { isApple } from '~/lib/keyboard'
import {
  IMPORT_RAIL_IDS,
  IMPORT_RAIL_STEP_COUNT,
  railEntryStep,
  railIndex,
  wizardStepKeysForSource,
  wizardStepsForSource,
  type ImportRailId,
  type ImportWizardSource,
  type ImportWizardStep,
} from '~/lib/import-wizard'
import { cn } from '~/lib/utils'

const RAIL_KEY: Record<ImportRailId, MessageKey> = {
  source: 'wizard.rail.source',
  connect: 'wizard.rail.connect',
  years: 'wizard.rail.years',
  preview: 'wizard.rail.preview',
  problems: 'wizard.rail.problems',
  import: 'wizard.rail.import',
}

/** Card surface from the export: warm surface, radius, paper shadow. */
export const wizardCardClass =
  'min-w-0 rounded-[var(--radius-xl)] border border-[var(--line)] bg-surface shadow-[var(--shadow-paper)]'

export function WizardStat({
  label,
  value,
  meta,
  valueClassName,
}: {
  readonly label: string
  readonly value: string
  readonly meta?: string
  readonly valueClassName?: string
}) {
  return (
    <div className={cn(wizardCardClass, 'flex flex-col gap-1 p-4')}>
      <span className="text-ink-muted text-xs font-medium">{label}</span>
      <span className={cn('text-ink text-2xl font-semibold tabular-nums', valueClassName)}>
        {value}
      </span>
      {meta !== undefined && meta !== '' ? (
        <span className="text-ink-2 text-xs leading-snug">{meta}</span>
      ) : null}
    </div>
  )
}

function stepOfLabel(
  t: ReturnType<typeof useT>['t'],
  step: ImportWizardStep,
  source: ImportWizardSource | null,
): string {
  if (source === 'exact') {
    const steps = wizardStepsForSource('exact')
    const keys = wizardStepKeysForSource('exact')
    const found = steps.indexOf(step)
    const index = found >= 0 ? found : Math.max(0, steps.length - 1)
    return t('wizard.stepOf', {
      step: String(index + 1),
      total: String(steps.length),
      label: t(keys[index]!),
    })
  }
  const index = railIndex(step)
  const railId: ImportRailId = IMPORT_RAIL_IDS[index] ?? 'source'
  return t('wizard.stepOf', {
    step: String(index + 1),
    total: String(IMPORT_RAIL_STEP_COUNT),
    label: t(RAIL_KEY[railId]),
  })
}

/** Shared "Stap N van M: label" for shell mobile line and step headers (#134 / #180). */
export function wizardStepOfLabel(
  t: ReturnType<typeof useT>['t'],
  step: ImportWizardStep,
  source: ImportWizardSource | null,
): string {
  return stepOfLabel(t, step, source)
}

export function WizardProgressRail({
  step,
  source = null,
  onJump,
}: {
  readonly step: ImportWizardStep
  /** Exact Phase 2 omits later steps from the rail (#161). */
  readonly source?: ImportWizardSource | null
  readonly onJump?: (step: ImportWizardStep) => void
}) {
  const { t } = useT()
  if (source === 'exact') {
    const steps = wizardStepsForSource('exact')
    const keys = wizardStepKeysForSource('exact')
    const found = steps.indexOf(step)
    const current = found >= 0 ? found : Math.max(0, steps.length - 1)
    return (
      <nav aria-label={t('wizard.steps')}>
        <Stepper
          current={current}
          className="max-w-full"
          steps={steps.map((id, index) => ({ id, label: t(keys[index]!) }))}
          {...(onJump === undefined
            ? {}
            : {
                onJump: (index: number) => {
                  const target = steps[index]
                  if (target !== undefined) onJump(target)
                },
              })}
        />
      </nav>
    )
  }
  const current = railIndex(step)
  return (
    <nav aria-label={t('wizard.steps')}>
      <Stepper
        current={current}
        className="max-w-full"
        steps={IMPORT_RAIL_IDS.map((id) => ({ id, label: t(RAIL_KEY[id]) }))}
        {...(onJump === undefined
          ? {}
          : {
              onJump: (index: number) => {
                const target = railEntryStep(index)
                if (target !== null) onJump(target)
              },
            })}
      />
    </nav>
  )
}

export function WizardStepHeader({
  titleId,
  title,
  intro,
  step,
  source = null,
}: {
  readonly titleId: string
  readonly title: string
  readonly intro?: string
  readonly step: ImportWizardStep
  readonly source?: ImportWizardSource | null
}) {
  const { t } = useT()
  return (
    <header className="mb-6 min-w-0" data-wizard-step={step} data-wizard-source={source ?? ''}>
      <p className="text-ink-2 hidden text-sm break-words tabular-nums md:block">
        {stepOfLabel(t, step, source)}
      </p>
      <h2
        id={`${titleId}-step`}
        className="text-ink mt-1 text-lg font-semibold tracking-tight md:text-xl"
      >
        {title}
      </h2>
      {intro !== undefined && intro !== '' && (
        <p className="text-ink-2 mt-2 max-w-2xl text-sm leading-relaxed break-words">{intro}</p>
      )}
    </header>
  )
}

export function WizardFooter({
  onBack,
  onNext,
  onNextBlocked,
  nextLabel,
  nextSaving = false,
  nextSavingLabel,
  nextDisabled,
  nextReason,
  footerError,
  showBack,
  showNextKeycap = true,
  note,
}: {
  readonly onBack?: () => void
  readonly onNextBlocked?: () => void
  readonly onNext?: () => void
  /** Required when `onNext` is set; omit with `onNext` for a Back-only footer. */
  readonly nextLabel?: string
  /** Step save in flight — Volgende stays focusable with aria-busy (#201). */
  readonly nextSaving?: boolean
  readonly nextSavingLabel?: string
  readonly nextDisabled?: boolean
  readonly nextReason?: string | null
  /** Inline field-error copy directly under Volgende (#201). */
  readonly footerError?: string | null
  readonly showBack: boolean
  readonly showNextKeycap?: boolean
  /** Left-side status on the stopped import screens. */
  readonly note?: string | null
}) {
  const { t } = useT()
  const hydrated = useHydrated()
  const modKey = hydrated && isApple() ? '⌘' : 'Ctrl'
  const blocked = nextDisabled === true
  const saving = nextSaving === true
  const savingLabel = nextSavingLabel ?? t('wizard.nextSaving')
  const showNext = onNext !== undefined && nextLabel !== undefined && nextLabel !== ''
  const [spinnerDue, setSpinnerDue] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!saving) return undefined
    const timer = window.setTimeout(() => setSpinnerDue(true), 150)
    return () => {
      window.clearTimeout(timer)
      setSpinnerDue(false)
    }
  }, [saving])

  const displayLabel = saving ? savingLabel : nextLabel
  const showKeycap = showNextKeycap && !blocked && !saving
  const showPendingIndicator = saving && (spinnerDue || reducedMotion)
  return (
    <footer className="border-line bg-surface mt-8 flex flex-col gap-3 border-t pt-4 max-md:sticky max-md:bottom-16 max-md:z-20 max-md:-mx-4 max-md:px-4 max-md:pb-3 md:flex-row md:flex-wrap md:items-center">
      {showBack && onBack !== undefined && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full shrink-0 md:w-auto"
          onClick={onBack}
        >
          {t('wizard.back')}
          <Keycap className="ml-1 hidden md:inline-flex">Esc</Keycap>
        </Button>
      )}
      {note !== undefined && note !== null && note !== '' && (
        <p className="text-ink-2 min-w-0 flex-1 text-sm">{note}</p>
      )}
      {showNext && (
        <div className="flex min-w-0 flex-col gap-1 md:ml-auto md:items-end">
          {blocked && nextReason !== null && nextReason !== undefined && nextReason !== '' && (
            <p id="wizard-next-why" className="text-ink-muted max-w-sm text-sm md:text-right">
              {nextReason}
            </p>
          )}
          <Button
            type="button"
            className={cn(
              'relative min-h-11 w-full md:w-auto',
              blocked &&
                'border-[var(--input-border)] bg-[var(--neutral-bg)] text-[var(--ink-muted)] hover:bg-[var(--neutral-bg)]',
            )}
            // String 'true' — a boolean can serialise as aria-disabled="" and break checks.
            aria-disabled={blocked ? 'true' : undefined}
            aria-busy={saving ? 'true' : undefined}
            aria-describedby={
              blocked && nextReason
                ? 'wizard-next-why'
                : footerError !== null && footerError !== undefined && footerError !== ''
                  ? 'wizard-next-error'
                  : undefined
            }
            onClick={() => {
              if (blocked) {
                onNextBlocked?.()
                return
              }
              onNext?.()
            }}
            data-focus="next"
          >
            <span className="invisible inline-flex flex-col items-center gap-0" aria-hidden>
              <span className="inline-flex items-center">
                {nextLabel}
                {showNextKeycap ? (
                  <span className="ml-1 hidden items-center gap-0.5 md:inline-flex">
                    <Keycap>{modKey}</Keycap>
                    <Keycap>↵</Keycap>
                  </span>
                ) : null}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3.5 shrink-0" />
                {savingLabel}
              </span>
            </span>
            <span className="absolute inset-0 flex items-center justify-center gap-1.5 px-4">
              {showPendingIndicator ? (
                reducedMotion ? (
                  <Circle className="size-3.5 shrink-0 fill-current" aria-hidden />
                ) : (
                  <LoaderCircle
                    className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                )
              ) : null}
              <span>{displayLabel}</span>
              {showKeycap ? (
                <span className="ml-1 hidden items-center gap-0.5 md:inline-flex">
                  <Keycap>{modKey}</Keycap>
                  <Keycap>↵</Keycap>
                </span>
              ) : null}
            </span>
          </Button>
          {footerError !== null && footerError !== undefined && footerError !== '' && (
            <p
              id="wizard-next-error"
              role="alert"
              className="text-destructive max-w-sm text-sm md:text-right"
            >
              {footerError}
            </p>
          )}
        </div>
      )}
    </footer>
  )
}

export function WizardHints({
  items,
}: {
  readonly items: readonly { readonly keys: readonly string[]; readonly label: string }[]
}) {
  const hydrated = useHydrated()
  const modKey = hydrated && isApple() ? '⌘' : 'Ctrl'
  if (items.length === 0) return null
  return (
    <p className="text-ink-muted mt-4 hidden flex-wrap gap-x-4 gap-y-2 text-xs md:flex">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1">
          {item.keys.map((key) => (
            <Keycap key={key}>{key === '⌘' ? modKey : key}</Keycap>
          ))}
          <span>{item.label}</span>
        </span>
      ))}
    </p>
  )
}

export function WizardStatusToast({ message }: { readonly message: string | null }) {
  if (message === null || message === '') return null
  return (
    <p
      role="status"
      className="border-line bg-surface text-ink fixed right-4 bottom-20 z-50 rounded-[var(--radius-md)] border px-4 py-3 text-sm shadow-[var(--shadow-raised)] md:bottom-4"
      data-slot="wizard-toast"
    >
      {message}
    </p>
  )
}

export function AttentionBlock({
  title,
  children,
  actions,
  tone = 'attention',
  badge,
}: {
  readonly title: string
  readonly children?: ReactNode
  readonly actions?: ReactNode
  readonly badge?: ReactNode
  /** #99 dead ends use error (red); #92/#93 use attention (orange). Never yellow. */
  readonly tone?: 'attention' | 'error' | 'info'
}) {
  const toneClass =
    tone === 'error'
      ? 'border-destructive/50 bg-destructive/6 border-l-destructive'
      : tone === 'info'
        ? 'border-info/40 bg-info/6 border-l-info'
        : 'border-status-geen-btw/40 bg-status-geen-btw/8 border-l-status-geen-btw'
  return (
    <div
      className={cn(
        'rounded-[var(--radius-md)] border border-l-[3px] px-4 py-3 text-sm',
        toneClass,
      )}
      role="status"
    >
      {badge !== undefined && <div className="mb-2">{badge}</div>}
      <p className="font-medium text-foreground">{title}</p>
      {children !== undefined && (
        <div className="text-muted-foreground mt-1 space-y-1">{children}</div>
      )}
      {actions !== undefined && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">{actions}</div>
      )}
    </div>
  )
}
