/**
 * Shared chrome for the import wizard: six-step rail + Volgende/Terug footer.
 *
 * The rail maps the v2 export (Source → Import). Internal steps stay the
 * #105 machine; see `IMPORT_RAIL_IDS`.
 */

import type { ReactNode } from 'react'
import { Button } from '~/components/ui/button'
import { Keycap } from '~/components/ui/keycap'
import { Stepper } from '~/components/ui/stepper'
import { useT } from '~/i18n/provider'
import type { MessageKey } from '~/i18n/nl'
import {
  IMPORT_RAIL_IDS,
  railEntryStep,
  railIndex,
  type ImportRailId,
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

export function WizardProgressRail({
  step,
  onJump,
}: {
  readonly step: ImportWizardStep
  readonly onJump?: (step: ImportWizardStep) => void
}) {
  const { t } = useT()
  const current = railIndex(step)
  return (
    <Stepper
      aria-label={t('wizard.steps')}
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
  )
}

export function WizardStepHeader({
  titleId,
  title,
  intro,
  step,
}: {
  readonly titleId: string
  readonly title: string
  readonly intro?: string
  readonly step: ImportWizardStep
}) {
  return (
    <header className="mb-6 min-w-0" data-wizard-step={step}>
      <h2
        id={`${titleId}-step`}
        className="text-ink text-lg font-semibold tracking-tight md:text-xl"
      >
        {title}
      </h2>
      {intro !== undefined && intro !== '' && (
        <p className="text-ink-2 mt-2 max-w-2xl text-sm leading-relaxed">{intro}</p>
      )}
    </header>
  )
}

export function WizardFooter({
  onBack,
  onNext,
  onNextBlocked,
  nextLabel,
  nextDisabled,
  nextReason,
  showBack,
  showNextKeycap = true,
  note,
}: {
  readonly onBack?: () => void
  readonly onNext?: () => void
  readonly onNextBlocked?: () => void
  readonly nextLabel: string
  readonly nextDisabled?: boolean
  readonly nextReason?: string | null
  readonly showBack: boolean
  readonly showNextKeycap?: boolean
  /** Left-side status on the stopped import screens. */
  readonly note?: string | null
}) {
  const { t } = useT()
  const blocked = nextDisabled === true
  return (
    <footer className="border-line bg-surface mt-8 flex flex-col gap-3 border-t pt-4 max-md:sticky max-md:bottom-16 max-md:z-20 max-md:-mx-4 max-md:px-4 max-md:pb-3 md:flex-row md:flex-wrap md:items-center">
      {showBack && onBack !== undefined && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full md:w-auto"
          onClick={onBack}
        >
          {t('wizard.back')}
          <Keycap className="ml-1 hidden md:inline-flex">Esc</Keycap>
        </Button>
      )}
      {note !== undefined && note !== null && note !== '' && (
        <p className="text-ink-2 min-w-0 flex-1 text-sm">{note}</p>
      )}
      <div className="flex min-w-0 flex-col gap-1 md:ml-auto md:items-end">
        {blocked && nextReason !== null && nextReason !== undefined && nextReason !== '' && (
          <p id="wizard-next-why" className="text-ink-muted max-w-sm text-sm md:text-right">
            {nextReason}
          </p>
        )}
        {onNext !== undefined && (
          <Button
            type="button"
            className={cn(
              'min-h-11 w-full md:w-auto',
              blocked &&
                'border-[var(--input-border)] bg-[var(--neutral-bg)] text-[var(--ink-muted)] hover:bg-[var(--neutral-bg)]',
            )}
            // String 'true' — a boolean can serialise as aria-disabled="" and break checks.
            aria-disabled={blocked ? 'true' : undefined}
            aria-describedby={blocked && nextReason ? 'wizard-next-why' : undefined}
            onClick={() => {
              if (blocked) {
                onNextBlocked?.()
                return
              }
              onNext()
            }}
            data-focus="next"
          >
            {nextLabel}
            {showNextKeycap && !blocked && (
              <span className="ml-1 hidden items-center gap-0.5 md:inline-flex">
                <Keycap>⌘</Keycap>
                <Keycap>↵</Keycap>
              </span>
            )}
          </Button>
        )}
      </div>
    </footer>
  )
}

export function WizardHints({
  items,
}: {
  readonly items: readonly { readonly keys: readonly string[]; readonly label: string }[]
}) {
  if (items.length === 0) return null
  return (
    <p className="text-ink-muted mt-4 hidden flex-wrap gap-x-4 gap-y-2 text-xs md:flex">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1">
          {item.keys.map((key) => (
            <Keycap key={key}>{key}</Keycap>
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
