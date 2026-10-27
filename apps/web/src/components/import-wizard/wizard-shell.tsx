/**
 * Shared chrome for the import wizard: progress rail + Volgende/Terug footer.
 */

import { RiCheckLine } from '@remixicon/react'
import type { ReactNode } from 'react'
import { Button } from '~/components/ui/button'
import { Keycap } from '~/components/ui/keycap'
import { useT } from '~/i18n/provider'
import {
  IMPORT_WIZARD_STEP_COUNT,
  IMPORT_WIZARD_STEP_KEYS,
  stepIndex,
  type ImportWizardStep,
} from '~/lib/import-wizard'
import { cn } from '~/lib/utils'

export function WizardProgressRail({
  step,
  onJump,
}: {
  readonly step: ImportWizardStep
  readonly onJump?: (step: ImportWizardStep) => void
}) {
  const { t } = useT()
  const current = stepIndex(step)
  return (
    <ol
      className="border-border mb-6 hidden grid-cols-5 border md:grid lg:grid-cols-10"
      aria-label={t('wizard.steps')}
    >
      {IMPORT_WIZARD_STEP_KEYS.map((key, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'todo'
        const clickable = onJump !== undefined && index < current
        return (
          <li
            key={key}
            className={cn(
              'flex min-h-11 items-center gap-2 px-2 text-xs',
              index > 0 && 'border-border border-l',
              state === 'current'
                ? 'border-b-accent border-b-[3px] font-medium'
                : 'border-b-[3px] border-b-transparent',
              state === 'todo' && 'text-muted-foreground',
            )}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            {clickable ? (
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => {
                  const id = key.replace('wizard.step.', '') as ImportWizardStep
                  onJump(id)
                }}
              >
                <StepGlyph state={state} n={index + 1} />
                <span className="truncate">{t(key)}</span>
              </button>
            ) : (
              <>
                <StepGlyph state={state} n={index + 1} />
                <span className="truncate">{t(key)}</span>
              </>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function StepGlyph({
  state,
  n,
}: {
  readonly state: 'done' | 'current' | 'todo'
  readonly n: number
}) {
  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center text-[11px] tabular-nums',
        state === 'done' ? 'bg-foreground text-background' : 'border-border border',
      )}
    >
      {state === 'done' ? <RiCheckLine className="size-3" aria-hidden /> : n}
    </span>
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
  const { t } = useT()
  const index = stepIndex(step)
  return (
    <header className="mb-6">
      <p className="text-muted-foreground text-sm">
        {t('wizard.stepOf', {
          step: String(index + 1),
          total: String(IMPORT_WIZARD_STEP_COUNT),
          label: t(IMPORT_WIZARD_STEP_KEYS[index]!),
        })}
      </p>
      <h1 id={titleId} className="mt-1 text-2xl tracking-tight md:text-[28px]">
        {title}
      </h1>
      {intro !== undefined && intro !== '' && (
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">{intro}</p>
      )}
    </header>
  )
}

export function WizardFooter({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  nextReason,
  showBack,
  showNextKeycap = true,
}: {
  readonly onBack?: () => void
  readonly onNext?: () => void
  readonly nextLabel: string
  readonly nextDisabled?: boolean
  readonly nextReason?: string | null
  readonly showBack: boolean
  readonly showNextKeycap?: boolean
}) {
  const { t } = useT()
  return (
    <footer className="border-border mt-8 flex flex-wrap items-center gap-3 border-t pt-4">
      {showBack && onBack !== undefined && (
        <Button type="button" variant="ghost" className="min-h-11 md:min-h-9" onClick={onBack}>
          {t('wizard.back')}
          <Keycap className="ml-1 hidden md:inline-flex">Esc</Keycap>
        </Button>
      )}
      <div className="ml-auto flex flex-col items-end gap-1">
        {nextDisabled && nextReason !== null && nextReason !== undefined && nextReason !== '' && (
          <p id="wizard-next-why" className="text-muted-foreground max-w-sm text-right text-xs">
            {nextReason}
          </p>
        )}
        {onNext !== undefined && (
          <Button
            type="button"
            className="min-h-11 md:min-h-9"
            disabled={nextDisabled}
            aria-describedby={nextDisabled && nextReason ? 'wizard-next-why' : undefined}
            onClick={onNext}
            data-focus="next"
          >
            {nextLabel}
            {showNextKeycap && !nextDisabled && (
              <Keycap className="ml-1 hidden md:inline-flex">↵</Keycap>
            )}
          </Button>
        )}
      </div>
    </footer>
  )
}

export function WizardStatusToast({ message }: { readonly message: string | null }) {
  if (message === null || message === '') return null
  return (
    <p
      role="status"
      className="border-border bg-muted fixed right-4 bottom-4 z-50 border px-4 py-3 text-sm"
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
}: {
  readonly title: string
  readonly children?: ReactNode
  readonly actions?: ReactNode
  /** #99 dead ends use error (red); #92/#93 use attention (orange). Never yellow. */
  readonly tone?: 'attention' | 'error' | 'info'
}) {
  const toneClass =
    tone === 'error'
      ? 'border-destructive/50 bg-destructive/6 border-l-destructive'
      : tone === 'info'
        ? 'border-info/40 bg-info/6 border-l-info'
        : 'border-warning/40 bg-warning/8 border-l-warning'
  return (
    <div className={cn('border border-l-[3px] px-4 py-3 text-sm', toneClass)} role="status">
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
