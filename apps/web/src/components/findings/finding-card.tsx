/**
 * Finding with fix — shared UI for import and inbound findings (#41 Phase 1).
 *
 * Props contract is stable for Phase 2 visual reskin: see `docs/finding-card.md`
 * and `~/lib/finding-card`. Callers pass data + fix; this file owns chrome.
 */

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Link } from '@tanstack/react-router'
import { RiCheckboxBlankCircleLine, RiCheckLine, RiErrorWarningLine } from '@remixicon/react'
import { cn } from 'cn'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemHeader } from '~/components/ui/item'
import { Keycap, ShortcutFooter } from '~/components/ui/keycap'
import { findingMessage, findingWhy } from '~/i18n/labels'
import { useT } from '~/i18n/provider'
import type { MessageKey } from '~/i18n/nl'
import {
  detailForDisplay,
  explainOnlyFix,
  honestyClasses,
  oneClickMayApplyImmediately,
  resolveFindingKey,
  severityClasses,
  type FindingCardModel,
  type FindingData,
  type FindingFix,
  type FindingHonesty,
  type FindingSeverity,
} from '~/lib/finding-card'
import { BINDINGS_BY_ID, bindingChips, isTypingInto } from '~/lib/keyboard'

export type {
  FindingCardModel,
  FindingData,
  FindingFix,
  FindingHonesty,
  FindingSeverity,
} from '~/lib/finding-card'
export { explainOnlyFix, honestyFromReconciliation } from '~/lib/finding-card'

export interface FindingCardProps extends FindingCardModel {
  readonly selected?: boolean
  readonly fixOpen?: boolean
  readonly onFixOpenChange?: (open: boolean) => void
  readonly onSelect?: () => void
  readonly tabIndex?: number
  readonly id?: string
  readonly className?: string
  /** Geavanceerd: show technical `path` under the body (#57). */
  readonly showPath?: boolean
}

/**
 * One finding: explanation, why it matters, and a fix slot.
 *
 * Renders from `{ code, path, messageKey, detail }` via
 * `t('finding.' + messageKey, detail)`. Amounts in detail are euros.
 */
export const FindingCard = forwardRef<HTMLDivElement, FindingCardProps>(function FindingCard(
  {
    code,
    path,
    messageKey,
    detail,
    message,
    severity,
    fix,
    honesty,
    selected = false,
    fixOpen = false,
    onFixOpenChange,
    onSelect,
    tabIndex = -1,
    id,
    className,
    showPath = false,
  },
  ref,
) {
  const { t, tag } = useT()
  const panelId = useId()
  const [confirming, setConfirming] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const classes = severityClasses(severity)
  const displayDetail = detailForDisplay(detail, tag)
  const explanation = findingMessage(t, { message, messageKey, detail: displayDetail })
  const why = findingWhy(t, messageKey, displayDetail) ?? t('findingCard.whyFallback')
  // Preview only while the fix panel is open — closing abandons confirm without
  // an effect that syncs the two bits of state.
  const showPreview = fixOpen && confirming

  useEffect(() => {
    if (showPreview) confirmRef.current?.focus()
  }, [showPreview])

  const openFix = (): void => {
    onFixOpenChange?.(true)
    if (fix.type === 'guided') {
      setConfirming(false)
      fix.onOpen()
      return
    }
    // oneClick with preview: first activation shows the preview (contract / #57).
    setConfirming(fix.type === 'oneClick' && fix.preview !== undefined)
  }

  const closeFix = (): void => {
    setConfirming(false)
    onFixOpenChange?.(false)
  }

  const activateOneClick = (): void => {
    if (fix.type !== 'oneClick') return
    if (!oneClickMayApplyImmediately(fix) && !showPreview) {
      setConfirming(true)
      return
    }
    void Promise.resolve(fix.onApply()).then(() => {
      setConfirming(false)
      onFixOpenChange?.(false)
    })
  }

  return (
    <Item
      ref={ref}
      id={id}
      role="listitem"
      variant="outline"
      size="sm"
      tabIndex={tabIndex}
      data-slot="finding-card"
      data-code={code}
      data-severity={severity}
      data-fix-type={fix.type}
      data-selected={selected ? 'true' : undefined}
      data-fix-open={fixOpen ? 'true' : undefined}
      data-honesty={honesty}
      aria-selected={selected}
      aria-expanded={fixOpen}
      aria-controls={fixOpen ? panelId : undefined}
      className={cn(
        // Prototype: 1px card + 4px severity bar; focus ring only on :focus-visible
        // so j/k/Tab show the cursor without a ring on load (#69 design review).
        'cursor-default border bg-card p-4 outline-none transition-colors md:p-5',
        'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        classes.border,
        classes.bar,
        selected && 'bg-muted/40',
        className,
      )}
      onFocus={() => {
        onSelect?.()
      }}
      onClick={() => {
        onSelect?.()
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        // Card-local: Enter opens; Escape closes when this card's fix is open.
        // List-level j/k lives on FindingsList so one handler owns the cursor.
        if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          if (showPreview && fix.type === 'oneClick') {
            event.preventDefault()
            event.stopPropagation()
            activateOneClick()
            return
          }
          if (!fixOpen) {
            event.preventDefault()
            event.stopPropagation()
            openFix()
          }
        }
        if (event.key === 'Escape' && fixOpen) {
          event.preventDefault()
          event.stopPropagation()
          closeFix()
        }
      }}
    >
      <ItemContent className="min-w-0 gap-2">
        <ItemHeader className="mb-2 flex-wrap gap-2">
          <Badge
            variant={severity === 'blocking' ? 'destructive' : 'outline'}
            className={severity === 'blocking' ? undefined : 'tracking-normal normal-case'}
          >
            {severity === 'blocking' && <RiErrorWarningLine className="size-3" aria-hidden />}
            {severity === 'blocking' ? t('findingCard.blocking') : t('findingCard.warning')}
          </Badge>
          <span className="text-muted-foreground text-xs">{fixTypeLabel(t, fix)}</span>
          <code className="text-muted-foreground ml-auto hidden text-[11px] tracking-normal normal-case sm:block">
            {code}
          </code>
        </ItemHeader>

        <ItemDescription
          className={cn('line-clamp-none text-[15px] leading-snug font-medium', classes.body)}
        >
          {explanation}
        </ItemDescription>

        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          <span className="font-medium text-foreground">{t('findingCard.whyItMatters')}: </span>
          {why}
        </p>

        {showPath && path !== null && path !== undefined && path !== '' && (
          <p className="text-muted-foreground text-[0.625rem] tabular">{path}</p>
        )}

        {honesty !== undefined && <FindingHonestyState honesty={honesty} compact />}

        {fixOpen && (
          <div
            id={panelId}
            data-slot="finding-fix"
            className={cn(
              'border-border mt-4 w-full border-t pt-3',
              showPreview && 'animate-in-fade border bg-muted p-4',
            )}
          >
            <FixPanel
              fix={fix}
              confirming={showPreview}
              confirmRef={confirmRef}
              onActivateOneClick={activateOneClick}
              onClose={closeFix}
              onStartConfirm={() => {
                setConfirming(true)
              }}
            />
          </div>
        )}

        {!fixOpen && fix.type === 'explainOnly' && (
          <div className="mt-4 flex flex-col items-start gap-2">
            <p className="text-muted-foreground text-sm">{t('findingCard.explainOnlyBody')}</p>
            <ExplainOnlyLink fix={fix} />
          </div>
        )}

        {!fixOpen && fix.type !== 'explainOnly' && (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              type="button"
              variant={fix.type === 'oneClick' ? 'outline' : 'default'}
              size="default"
              onClick={openFix}
              className="min-h-11 gap-2 md:min-h-9"
            >
              {fixActionLabel(t, fix)}
              {selected && <BindingKeycaps id="finding.openFix" />}
            </Button>
            {fix.type === 'oneClick' && fix.preview === undefined && (
              <span className="text-muted-foreground text-xs">{t('findingCard.oneClickSafe')}</span>
            )}
            {fix.type === 'oneClick' && fix.preview !== undefined && (
              <span className="text-muted-foreground text-xs">
                {t('findingCard.fixHint.preview')}
              </span>
            )}
            {fix.type === 'guided' && fix.steps !== undefined && fix.steps.length > 0 && (
              <span className="text-muted-foreground text-xs">{fix.steps.join(' → ')}</span>
            )}
          </div>
        )}
      </ItemContent>
    </Item>
  )
})

function BindingKeycaps({ id }: { id: string }) {
  const binding = BINDINGS_BY_ID.get(id)
  if (binding === undefined) return null
  return (
    <span className="hidden gap-0.5 md:inline-flex" aria-hidden>
      {bindingChips(binding).map((chip) => (
        <Keycap key={chip}>{chip}</Keycap>
      ))}
    </span>
  )
}

function ExplainOnlyLink({ fix }: { fix: Extract<FindingFix, { type: 'explainOnly' }> }) {
  if (fix.href === undefined || fix.linkLabel === undefined) return null
  const external = fix.href.startsWith('http://') || fix.href.startsWith('https://')
  if (external) {
    return (
      <a
        href={fix.href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm underline underline-offset-4"
      >
        {fix.linkLabel} ↗
      </a>
    )
  }
  return (
    <Link to={fix.href} className="text-sm underline underline-offset-4">
      {fix.linkLabel} ↗
    </Link>
  )
}

function fixActionLabel(
  t: (key: MessageKey, values?: Record<string, string>) => string,
  fix: FindingFix,
): string {
  if (fix.type === 'oneClick') return fix.label
  if (fix.type === 'guided') return fix.label
  return fix.linkLabel ?? t('findingCard.openExplain')
}

function fixTypeLabel(
  t: (key: MessageKey, values?: Record<string, string>) => string,
  fix: FindingFix,
): string {
  if (fix.type === 'oneClick') return t('findingCard.fixType.oneClick')
  if (fix.type === 'guided') {
    if (fix.steps !== undefined && fix.steps.length > 0) {
      return t('findingCard.guidedSteps', { count: String(fix.steps.length) })
    }
    return t('findingCard.fixType.guided')
  }
  return t('findingCard.fixType.explainOnly')
}

function FixPanel({
  fix,
  confirming,
  confirmRef,
  onActivateOneClick,
  onClose,
  onStartConfirm,
}: {
  fix: FindingFix
  confirming: boolean
  confirmRef: RefObject<HTMLButtonElement | null>
  onActivateOneClick: () => void
  onClose: () => void
  onStartConfirm: () => void
}) {
  const { t } = useT()

  if (fix.type === 'explainOnly') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">{t('findingCard.explainOnlyBody')}</p>
        <ExplainOnlyLink fix={fix} />
        <Button type="button" variant="ghost" size="xs" onClick={onClose}>
          {t('findingCard.close')}
        </Button>
      </div>
    )
  }

  if (fix.type === 'guided') {
    return (
      <div className="flex flex-col items-start gap-3">
        {fix.steps !== undefined && fix.steps.length > 0 && (
          <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
            {fix.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
        <p className="text-sm">{t('findingCard.guidedHint')}</p>
        <Button type="button" variant="ghost" size="xs" onClick={onClose}>
          {t('findingCard.close')}
        </Button>
      </div>
    )
  }

  // oneClick
  if (confirming && fix.preview !== undefined) {
    return (
      <div
        className="flex w-full flex-col items-start gap-3"
        role="group"
        aria-label={t('findingCard.preview')}
      >
        <p className="text-sm font-medium">{fix.preview.summary || t('findingCard.preview')}</p>
        {fix.preview.lines !== undefined && fix.preview.lines.length > 0 && (
          <dl className="mt-1 w-full space-y-1 text-sm">
            {fix.preview.lines.map((line) => (
              <div key={line.label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd className="tabular-nums">{line.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-muted-foreground text-xs">{t('findingCard.fixHint.preview')}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button
            ref={confirmRef}
            type="button"
            size="default"
            className="min-h-11 md:min-h-9"
            onClick={onActivateOneClick}
          >
            {t('findingCard.confirmFix')}
            <BindingKeycaps id="finding.openFix" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="default"
            className="min-h-11 md:min-h-9"
            onClick={onClose}
          >
            {t('common.cancel')}
            <BindingKeycaps id="finding.closeFix" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="xs"
        onClick={() => {
          if (fix.preview !== undefined) onStartConfirm()
          else onActivateOneClick()
        }}
      >
        {fix.label}
      </Button>
      <Button type="button" variant="ghost" size="xs" onClick={onClose}>
        {t('findingCard.close')}
      </Button>
    </div>
  )
}

/**
 * Unread / empty / reconciled — three claims that must not look the same.
 *
 * Yellow is never used here: honesty is not an error state.
 */
export function FindingHonestyState({
  honesty,
  compact = false,
  className,
}: {
  honesty: FindingHonesty
  compact?: boolean
  className?: string
}) {
  const { t } = useT()
  const classes = honestyClasses(honesty)
  const label =
    honesty === 'unread'
      ? t('findingCard.honesty.unread')
      : honesty === 'empty'
        ? t('findingCard.honesty.empty')
        : t('findingCard.honesty.reconciled')
  const hint =
    honesty === 'unread'
      ? t('findingCard.honesty.unreadHint')
      : honesty === 'empty'
        ? t('findingCard.honesty.emptyHint')
        : t('findingCard.honesty.reconciledHint')
  return (
    <div
      data-slot="finding-honesty"
      data-honesty={honesty}
      className={cn(
        'rounded-none border px-3 py-2',
        classes.border,
        compact ? 'text-xs' : 'text-sm',
        className,
      )}
      role="status"
    >
      <p className={cn('flex items-center gap-1.5 text-xs font-medium normal-case', classes.text)}>
        {honesty === 'reconciled' ? (
          <RiCheckLine className="size-3.5 shrink-0" aria-hidden />
        ) : honesty === 'empty' ? (
          <RiCheckboxBlankCircleLine className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <span
            className="inline-block size-3 shrink-0 border border-dashed border-current"
            aria-hidden
          />
        )}
        {label}
      </p>
      {!compact && <p className="text-muted-foreground mt-1 text-xs normal-case">{hint}</p>}
    </div>
  )
}

export interface FindingsListItem extends FindingCardModel {
  readonly id?: string
}

export interface FindingsListProps {
  readonly findings: readonly FindingsListItem[]
  readonly className?: string
  readonly empty?: ReactNode
  /** Print the findings keyboard strip under the list. */
  readonly showShortcuts?: boolean
  /** Geavanceerd: show technical paths on each card. */
  readonly showPath?: boolean
  readonly 'aria-label'?: string
}

/**
 * Keyboard-navigable list of findings.
 *
 * j/k move, Enter opens the fix, Escape closes the fix (then leaves). Binding
 * ids: `finding.next` / `finding.previous` / `finding.openFix` / `finding.closeFix`.
 */
export function FindingsList({
  findings,
  className,
  empty,
  showShortcuts = true,
  showPath = false,
  'aria-label': ariaLabel,
}: FindingsListProps) {
  const { t } = useT()
  const [cursor, setCursor] = useState(0)
  const [openFix, setOpenFix] = useState<number | null>(null)
  const cards = useRef<Array<HTMLElement | null>>([])
  // Clamp during render rather than in an effect: a list that shortens under
  // the cursor must not drag React through an extra render cycle to catch up.
  const safeCursor = findings.length === 0 ? 0 : Math.min(Math.max(cursor, 0), findings.length - 1)
  const safeOpenFix = openFix === null || openFix >= findings.length || openFix < 0 ? null : openFix

  const focusCard = (index: number): void => {
    setCursor(index)
    cards.current[index]?.focus()
  }

  if (findings.length === 0) {
    return empty === undefined ? null : <>{empty}</>
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <ItemGroup
        role="list"
        aria-label={ariaLabel ?? t('findingCard.listLabel')}
        data-slot="findings-list"
        className="gap-2"
        onKeyDown={(event) => {
          if (isTypingInto(event.target)) return
          const modified = event.metaKey || event.ctrlKey || event.altKey
          const resolution = resolveFindingKey(
            event.key,
            { index: safeCursor, count: findings.length, openFix: safeOpenFix },
            modified,
          )

          if (resolution.action === 'move') {
            event.preventDefault()
            event.stopPropagation()
            if (openFix !== null) setOpenFix(null)
            focusCard(resolution.index)
            return
          }
          if (resolution.action === 'openFix') {
            event.preventDefault()
            event.stopPropagation()
            setOpenFix(resolution.index)
            focusCard(resolution.index)
            const fix = findings[resolution.index]?.fix
            if (fix?.type === 'guided') fix.onOpen()
            return
          }
          if (resolution.action === 'closeFix') {
            event.preventDefault()
            event.stopPropagation()
            setOpenFix(null)
            cards.current[safeCursor]?.focus()
            return
          }
          if (resolution.action === 'leave') {
            event.preventDefault()
            event.stopPropagation()
            cards.current[safeCursor]?.blur()
          }
        }}
      >
        {findings.map((finding, index) => (
          <FindingCard
            key={finding.id ?? `${finding.code}-${String(index)}`}
            {...finding}
            ref={(element) => {
              cards.current[index] = element
            }}
            selected={index === safeCursor}
            fixOpen={safeOpenFix === index}
            showPath={showPath}
            tabIndex={index === safeCursor ? 0 : -1}
            onSelect={() => {
              setCursor(index)
            }}
            onFixOpenChange={(open) => {
              setOpenFix(open ? index : safeOpenFix === index ? null : safeOpenFix)
            }}
            id={`finding-${finding.code}-${String(index)}`}
          />
        ))}
      </ItemGroup>

      {showShortcuts && (
        <ShortcutFooter
          ids={['finding.next', 'finding.previous', 'finding.openFix', 'finding.closeFix']}
          labelOverrides={
            findings[safeCursor]?.fix.type === 'explainOnly'
              ? { 'finding.openFix': 'keys.findingOpenExplain' }
              : undefined
          }
        />
      )}
    </div>
  )
}

/** Adapt a wire finding + severity into a list item with explainOnly by default. */
export function asExplainOnlyFinding(
  finding: FindingData & { readonly severity?: FindingSeverity },
  severity: FindingSeverity = finding.severity ?? 'warning',
  fix?: FindingFix,
): FindingsListItem {
  return {
    code: finding.code,
    path: finding.path ?? null,
    messageKey: finding.messageKey,
    detail: finding.detail ?? {},
    message: finding.message,
    severity,
    fix: fix ?? explainOnlyFix(),
  }
}
