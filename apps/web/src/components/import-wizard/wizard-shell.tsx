/**
 * Shared chrome for the import wizard: progress rail + Volgende/Terug footer.
 */

import { Check, ListChecks } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '~/components/ui/button'
import { Keycap } from '~/components/ui/keycap'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '~/components/ui/sheet'
import { useT } from '~/i18n/provider'
import {
  wizardStepKeysForSource,
  wizardStepsForSource,
  type ImportWizardSource,
  type ImportWizardStep,
} from '~/lib/import-wizard'
import { cn } from '~/lib/utils'

export function WizardProgressRail({
  step,
  source = null,
  onJump,
  sublines,
}: {
  readonly step: ImportWizardStep
  /** Exact Phase 2 omits later steps from the rail (#100 PM). */
  readonly source?: ImportWizardSource | null
  readonly onJump?: (step: ImportWizardStep) => void
  readonly sublines?: readonly (string | null | undefined)[]
}) {
  const { t } = useT()
  const steps = wizardStepsForSource(source)
  const keys = wizardStepKeysForSource(source)
  const found = steps.indexOf(step)
  // Past the Exact Phase 2 slice → show as the last visible step, not bron.
  const current = found >= 0 ? found : Math.max(0, steps.length - 1)
  const [open, setOpen] = useState(false)

  function renderItem(key: (typeof keys)[number], index: number, mobile: boolean) {
    const state = index < current ? 'done' : index === current ? 'current' : 'todo'
    const clickable = onJump !== undefined && index < current
    const id = steps[index]!
    const sub = sublines?.[index]
    const inner = (
      <>
        <StepGlyph state={state} n={index + 1} />
        <span className="min-w-0 flex-1 pt-0.5">
          <span
            className={cn(
              'block text-sm leading-tight whitespace-normal',
              state === 'current' && 'font-medium',
              state === 'todo' && 'text-muted-foreground',
            )}
          >
            {t(key)}
            {state === 'done' ? <span className="sr-only"> (klaar)</span> : null}
          </span>
          {sub !== undefined && sub !== null && sub !== '' ? (
            <span className="text-muted-foreground mt-0.5 block truncate text-xs tabular-nums">
              {sub}
            </span>
          ) : null}
        </span>
      </>
    )
    const cls = cn('flex items-start gap-3 px-2 py-1.5', mobile && 'min-h-11')
    if (state === 'todo' || !clickable) {
      return (
        <li key={key}>
          <span
            className={cls}
            aria-current={state === 'current' ? 'step' : undefined}
            aria-disabled={state === 'todo' ? 'true' : undefined}
          >
            {inner}
          </span>
        </li>
      )
    }
    return (
      <li key={key}>
        <button
          type="button"
          className={cn(cls, 'hover:bg-muted w-full text-left', state === 'current' && 'bg-muted')}
          aria-current={state === 'current' ? 'step' : undefined}
          onClick={() => {
            onJump?.(id)
            setOpen(false)
          }}
        >
          {inner}
        </button>
      </li>
    )
  }

  return (
    <>
      <div className="mb-5 md:hidden">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="tabular-nums">
            {t('wizard.stepOf', {
              step: String(current + 1),
              total: String(steps.length),
              label: t(keys[current]!),
            })}
          </span>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="ghost" className="-mr-3 px-3" aria-haspopup="dialog">
                <ListChecks className="size-4" aria-hidden />
                {t('wizard.steps')}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 sm:max-w-72" closeLabel={t('common.close')}>
              <SheetHeader>
                <SheetTitle>{t('wizard.steps')}</SheetTitle>
              </SheetHeader>
              <nav aria-label={t('wizard.steps')} className="mt-4">
                <ol className="space-y-0.5">
                  {keys.map((key, index) => renderItem(key, index, true))}
                </ol>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
        <div
          className="mt-1 grid gap-1"
          style={{ gridTemplateColumns: `repeat(${String(steps.length)}, minmax(0, 1fr))` }}
          aria-hidden="true"
        >
          {keys.map((key, index) => (
            <span
              key={key}
              className={cn(
                'h-1',
                index < current ? 'bg-foreground' : index === current ? 'bg-accent' : 'bg-border',
              )}
            />
          ))}
        </div>
      </div>

      <nav aria-label={t('wizard.steps')} className="mb-6 hidden md:block lg:mb-0">
        <ol className="space-y-0.5">{keys.map((key, index) => renderItem(key, index, false))}</ol>
      </nav>
    </>
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
        'flex size-6 shrink-0 items-center justify-center text-xs tabular-nums',
        state === 'done' && 'text-foreground',
        state === 'current' &&
          'border-foreground border border-b-accent border-b-[3px] font-semibold',
        state === 'todo' && 'border-border text-muted-foreground border',
      )}
    >
      {state === 'done' ? <Check className="size-4" aria-hidden /> : n}
    </span>
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
  const steps = wizardStepsForSource(source)
  const keys = wizardStepKeysForSource(source)
  const found = steps.indexOf(step)
  const index = found >= 0 ? found : Math.max(0, steps.length - 1)
  return (
    <header className="mb-6">
      <p className="text-muted-foreground hidden text-sm md:block">
        {t('wizard.stepOf', {
          step: String(index + 1),
          total: String(steps.length),
          label: t(keys[index]!),
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
  onNextBlocked,
  nextLabel,
  nextDisabled,
  nextReason,
  showBack,
  showNextKeycap = true,
}: {
  readonly onBack?: () => void
  readonly onNext?: () => void
  readonly onNextBlocked?: () => void
  /** Required when `onNext` is set; omit with `onNext` for a Back-only footer. */
  readonly nextLabel?: string
  readonly nextDisabled?: boolean
  readonly nextReason?: string | null
  readonly showBack: boolean
  readonly showNextKeycap?: boolean
}) {
  const { t } = useT()
  const blocked = nextDisabled === true
  const showNext = onNext !== undefined && nextLabel !== undefined && nextLabel !== ''
  return (
    <footer className="border-border mt-8 flex flex-wrap items-center gap-3 border-t pt-4">
      {showBack && onBack !== undefined && (
        <Button type="button" variant="ghost" className="min-h-11 md:min-h-9" onClick={onBack}>
          {t('wizard.back')}
          <Keycap className="ml-1 hidden md:inline-flex">Esc</Keycap>
        </Button>
      )}
      {showNext && (
        <div className="ml-auto flex flex-col items-end gap-1">
          {blocked && nextReason !== null && nextReason !== undefined && nextReason !== '' && (
            <p id="wizard-next-why" className="text-muted-foreground max-w-sm text-right text-xs">
              {nextReason}
            </p>
          )}
          <Button
            type="button"
            className={cn('min-h-11 md:min-h-9', blocked && 'opacity-50')}
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
              <Keycap className="ml-1 hidden md:inline-flex">↵</Keycap>
            )}
          </Button>
        </div>
      )}
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
    <div className={cn('border border-l-[3px] px-4 py-3 text-sm', toneClass)} role="status">
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
