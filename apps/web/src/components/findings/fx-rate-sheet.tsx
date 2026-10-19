/**
 * ECB / Aangepast rate step sheet (redesign slice 4 / #61).
 *
 * Ports the prototype Koers sheet: ECB daily rate pre-filled, editable field,
 * badge flips to Aangepast on edit, reset to ECB, live booking preview.
 * Amounts stay euro display strings (tabular-nums); yellow is never severity.
 */

import { RiBankLine, RiPencilLine, RiRefreshLine } from '@remixicon/react'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import { Keycap } from '~/components/ui/keycap'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet'
import { useT } from '~/i18n/provider'
import { cn } from '~/lib/utils'

export interface FxPreviewRow {
  readonly label: string
  /** Advanced-only account number shown beside the label. */
  readonly accountNumber?: string
  readonly amount: string
}

export interface FxRateSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly reference: string
  readonly supplier?: string
  readonly documentDateLabel?: string
  readonly currency: string
  readonly foreignAmountLabel: string
  readonly rate: string
  readonly ecbRate: string
  readonly source: 'ecb' | 'override'
  readonly ecbDate: string
  readonly loading?: boolean
  readonly error?: string | null
  readonly previewRows: readonly FxPreviewRow[]
  readonly calcLine: string
  /** Geavanceerd: show account numbers beside preview rows. */
  readonly advanced?: boolean
  readonly onRateChange: (rate: string) => void
  readonly onResetEcb?: () => void
  readonly onAccept: () => void
}

export function FxRateSheet({
  open,
  onOpenChange,
  reference,
  supplier,
  documentDateLabel,
  currency,
  foreignAmountLabel,
  rate,
  ecbRate,
  source,
  ecbDate,
  loading = false,
  error = null,
  previewRows,
  calcLine,
  advanced = false,
  onRateChange,
  onResetEcb,
  onAccept,
}: FxRateSheetProps) {
  const { t } = useT()
  const isEcb = source === 'ecb'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        closeLabel={t('findingCard.close')}
        className="w-full sm:max-w-[520px]"
        data-slot="fx-rate-sheet"
      >
        <SheetHeader className="border-b px-5 py-4">
          <SheetDescription className="text-xs">
            {t('importFindings.fx.eyebrow')}
          </SheetDescription>
          <SheetTitle className="text-lg leading-snug">
            {t('importFindings.fx.title', { reference })}
          </SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <dl className="bg-border mb-5 grid grid-cols-2 gap-px border text-sm">
            {(
              [
                [t('importFindings.fx.supplier'), supplier ?? '—'],
                [t('importFindings.fx.invoice'), reference],
                [t('importFindings.fx.date'), documentDateLabel ?? '—'],
                [t('importFindings.fx.amount'), foreignAmountLabel],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="bg-background px-3 py-2">
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="fx-rate-input" className="text-sm font-medium">
              {t('moneybird.fx.rateLabel')}
            </label>
            <Badge variant={isEcb ? 'outline' : 'attention'} data-fx="badge">
              {isEcb ? (
                <>
                  <RiBankLine className="size-3" aria-hidden />
                  {t('importFindings.fx.badgeEcb', { date: ecbDate })}
                </>
              ) : (
                <>
                  <RiPencilLine className="size-3" aria-hidden />
                  {t('importFindings.fx.badgeOverride', { date: ecbDate })}
                </>
              )}
            </Badge>
          </div>
          <p className="text-muted-foreground mb-2 text-xs">
            {t('importFindings.fx.rateHint', { currency })}
          </p>

          <div className="flex items-stretch">
            <span className="border-input bg-muted flex items-center border border-r-0 px-3 text-sm tabular-nums">
              {t('importFindings.fx.perUnit', { currency })}
            </span>
            <div className="relative flex-1">
              <input
                id="fx-rate-input"
                inputMode="decimal"
                autoComplete="off"
                disabled={loading}
                value={rate}
                onChange={(event) => onRateChange(event.target.value)}
                aria-describedby="fx-rate-note"
                className="border-input bg-background min-h-11 w-full border py-2 pr-9 pl-3 text-lg font-medium tabular-nums md:min-h-9 md:text-lg"
              />
              <RiPencilLine
                className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
                aria-hidden
              />
            </div>
            <span className="border-input bg-muted flex items-center border border-l-0 px-3 text-sm">
              EUR
            </span>
          </div>

          <p id="fx-rate-note" className="text-muted-foreground mt-2 text-xs">
            {loading
              ? t('moneybird.fx.loading')
              : isEcb
                ? t('importFindings.fx.ecbNote', { date: ecbDate })
                : t('importFindings.fx.overrideNote')}
          </p>

          {error !== null && error !== '' && (
            <p role="alert" className="text-destructive mt-2 text-sm">
              {error}
            </p>
          )}

          {!isEcb && onResetEcb !== undefined && ecbRate !== '' && (
            <button
              type="button"
              onClick={onResetEcb}
              className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-4 md:min-h-8"
            >
              <RiRefreshLine className="size-3.5" aria-hidden />
              {t('importFindings.fx.resetEcb', { rate: ecbRate })}
            </button>
          )}

          <section className="mt-6" aria-labelledby="fx-preview-heading">
            <h3 id="fx-preview-heading" className="mb-2 text-sm font-medium">
              {t('importFindings.fx.previewHeading')}
            </h3>
            <div className="border">
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {previewRows.map((row) => (
                    <tr key={row.label}>
                      <td className="px-3 py-2">
                        {row.label}
                        {advanced &&
                          row.accountNumber !== undefined &&
                          row.accountNumber !== '' && (
                            <span className="text-muted-foreground ml-1 font-mono text-xs">
                              {row.accountNumber}
                            </span>
                          )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p
                className={cn(
                  'border-t bg-muted px-3 py-2 text-xs tabular-nums',
                  'text-muted-foreground',
                )}
              >
                {calcLine}
              </p>
            </div>
          </section>
        </div>

        <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 md:min-h-9"
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel')}
            <Keycap className="ml-1">Esc</Keycap>
          </Button>
          <Button
            type="button"
            disabled={loading || rate.trim() === ''}
            className="min-h-11 md:min-h-9"
            onClick={onAccept}
          >
            {t('importFindings.fx.accept')}
            <Keycap className="ml-1">↵</Keycap>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
