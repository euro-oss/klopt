/**
 * Category + btw picker sheet (redesign slice 4 / #61).
 *
 * Ports the prototype guided fix: RGS-ranked combobox with “Beste match”, then
 * a three-way btw radio. Account numbers and btw codes stay advanced-only.
 */

import { RiCheckLine, RiSearchLine } from '@remixicon/react'
import { useEffect, useId, useMemo, useState } from 'react'
import {
  rankAccountSuggestions,
  type RankableAccount,
} from '@klopt/core/moneybird-account-ranker'
import { Button } from '~/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet'
import { Badge } from '~/components/ui/badge'
import { Keycap } from '~/components/ui/keycap'
import { IMPORT_VAT_OPTIONS, type ImportVatCode } from '~/lib/import-findings'
import { cn } from '~/lib/utils'
import { useT } from '~/i18n/provider'

export interface AccountVatSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly sourceName: string
  readonly sourceDetail?: string
  readonly rgsCode?: string | null
  readonly sourceNumber?: string
  readonly accounts: readonly RankableAccount[]
  /** Prefill from Moneybird tax percentage when known (`21`, `9`, …). */
  readonly suggestedVat?: ImportVatCode
  /** Geavanceerd: show account numbers and btw codes. */
  readonly advanced?: boolean
  readonly onSave: (choice: {
    readonly accountNumber: string
    readonly accountName: string
    readonly vatCode: ImportVatCode
  }) => void
}

export function AccountVatSheet({
  open,
  onOpenChange,
  sourceName,
  sourceDetail,
  rgsCode = null,
  sourceNumber = '',
  accounts,
  suggestedVat = 'VH21',
  advanced = false,
  onSave,
}: AccountVatSheetProps) {
  const { t } = useT()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [chosenNumber, setChosenNumber] = useState<string | null>(null)
  const [vat, setVat] = useState<ImportVatCode>(suggestedVat)

  const ranked = useMemo(
    () =>
      rankAccountSuggestions(accounts, {
        rgsCode,
        number: sourceNumber,
        name: sourceName,
        query,
      }),
    [accounts, rgsCode, sourceNumber, sourceName, query],
  )

  // When the sheet opens, reset and prefer the top RGS match.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setVat(suggestedVat)
    const best = rankAccountSuggestions(accounts, {
      rgsCode,
      number: sourceNumber,
      name: sourceName,
    })[0]
    setChosenNumber(best?.account.number ?? accounts[0]?.number ?? null)
    setActive(0)
  }, [open, accounts, rgsCode, sourceNumber, sourceName, suggestedVat])

  const chosen =
    ranked.find((row) => row.account.number === chosenNumber)?.account ??
    accounts.find((account) => account.number === chosenNumber) ??
    null
  const vatOption = IMPORT_VAT_OPTIONS.find((option) => option.code === vat) ?? IMPORT_VAT_OPTIONS[0]

  const save = (): void => {
    if (chosen === null) return
    onSave({
      accountNumber: chosen.number,
      accountName: chosen.name,
      vatCode: vat,
    })
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        closeLabel={t('findingCard.close')}
        className="w-full sm:max-w-[520px]"
        data-slot="account-vat-sheet"
      >
        <SheetHeader className="border-b px-5 py-4">
          <SheetDescription className="text-xs">
            {t('importFindings.accountVat.eyebrow')}
          </SheetDescription>
          <SheetTitle className="text-lg leading-snug">
            {t('importFindings.accountVat.title', { name: sourceName })}
          </SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="bg-muted mb-5 border px-4 py-3 text-sm">
            <p className="text-muted-foreground text-xs">
              {t('importFindings.accountVat.fromSource')}
            </p>
            <p className="mt-0.5 font-medium">{sourceName}</p>
            {sourceDetail !== undefined && sourceDetail !== '' && (
              <p className="text-muted-foreground tabular-nums">{sourceDetail}</p>
            )}
          </div>

          <div className="mb-1 flex items-baseline justify-between gap-2">
            <label htmlFor="account-vat-query" className="text-sm font-medium">
              {t('importFindings.accountVat.stepCategory')}
            </label>
            <span className="text-muted-foreground text-xs">
              {t('importFindings.accountVat.rankedByRgs')}
            </span>
          </div>

          <div className="relative">
            <RiSearchLine
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <input
              id="account-vat-query"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={
                ranked[active] !== undefined ? `${listId}-${String(active)}` : undefined
              }
              autoComplete="off"
              placeholder={
                advanced
                  ? t('importFindings.accountVat.searchAdvanced')
                  : t('importFindings.accountVat.search')
              }
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActive((current) => Math.min(current + 1, Math.max(0, ranked.length - 1)))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActive((current) => Math.max(current - 1, 0))
                } else if (event.key === 'Enter' && ranked[active] !== undefined) {
                  event.preventDefault()
                  setChosenNumber(ranked[active]!.account.number)
                }
              }}
              className="border-input bg-background min-h-11 w-full border py-2 pr-3 pl-9 text-sm md:min-h-9"
            />
          </div>

          <ul
            id={listId}
            role="listbox"
            aria-label={t('importFindings.accountVat.listLabel')}
            className="mt-1 divide-y border"
          >
            {ranked.length === 0 ? (
              <li className="text-muted-foreground px-3 py-3 text-sm">
                {t('importFindings.accountVat.empty')}
              </li>
            ) : (
              ranked.map((row, index) => {
                const selected = row.account.number === chosenNumber
                const isActive = index === active
                return (
                  <li
                    key={row.account.number}
                    id={`${listId}-${String(index)}`}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => setChosenNumber(row.account.number)}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2',
                      isActive && 'bg-accent text-accent-foreground',
                      !isActive && 'hover:bg-muted',
                    )}
                  >
                    <span className="flex size-4 items-center justify-center">
                      {selected ? <RiCheckLine className="size-4" aria-hidden /> : null}
                    </span>
                    {advanced && (
                      <span className="w-10 font-mono text-xs tabular-nums">
                        {row.account.number}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {row.account.name}
                        {index === 0 && row.reason === 'rgs' && (
                          <Badge
                            variant={isActive ? 'outline' : 'success'}
                            className={isActive ? 'border-accent-foreground/40' : undefined}
                          >
                            {t('importFindings.accountVat.bestMatch')}
                          </Badge>
                        )}
                      </span>
                      <span
                        className={cn(
                          'block text-xs',
                          isActive ? 'text-accent-foreground/75' : 'text-muted-foreground',
                        )}
                      >
                        {reasonLabel(t, row.reason)}
                        {row.account.rgsCode !== null && row.account.rgsCode !== '' && (
                          <>
                            {' · RGS '}
                            <span className="font-mono">{row.account.rgsCode}</span>
                          </>
                        )}
                      </span>
                    </span>
                  </li>
                )
              })
            )}
          </ul>

          <fieldset className="mt-6">
            <legend className="mb-2 text-sm font-medium">
              {t('importFindings.accountVat.stepVat')}
            </legend>
            <div role="radiogroup" className="grid grid-cols-3 border">
              {IMPORT_VAT_OPTIONS.map((option, index) => {
                const checked = option.code === vat
                return (
                  <button
                    key={option.code}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    tabIndex={checked ? 0 : -1}
                    onClick={() => setVat(option.code)}
                    className={cn(
                      'min-h-11 px-2 text-sm',
                      index > 0 && 'border-l',
                      checked
                        ? 'bg-foreground text-background font-medium'
                        : 'hover:bg-muted',
                    )}
                  >
                    {t(`importFindings.vat.${option.code}`)}
                    {advanced && (
                      <span className="font-mono text-xs opacity-70"> {option.code}</span>
                    )}
                  </button>
                )
              })}
            </div>
            <p className="text-muted-foreground mt-1.5 text-xs">
              {t('importFindings.accountVat.vatHint')}
            </p>
          </fieldset>

          {chosen !== null && (
            <div className="border-accent bg-muted mt-6 border-l-[3px] px-4 py-3 text-sm">
              <p className="font-medium">{t('importFindings.accountVat.whatHappens')}</p>
              <p className="text-muted-foreground mt-1">
                {t('importFindings.accountVat.whatHappensBody', {
                  account: chosen.name,
                  vat: t(`importFindings.vat.${vatOption.code}`),
                })}
              </p>
            </div>
          )}
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
            disabled={chosen === null}
            className="min-h-11 md:min-h-9"
            onClick={save}
          >
            {t('common.save')}
            <Keycap className="ml-1">↵</Keycap>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function reasonLabel(
  t: (key: 'importFindings.accountVat.reason.rgs' | 'importFindings.accountVat.reason.number' | 'importFindings.accountVat.reason.name', values?: Record<string, string>) => string,
  reason: 'rgs' | 'number' | 'number_prefix' | 'name' | 'name_contains',
): string {
  if (reason === 'rgs') return t('importFindings.accountVat.reason.rgs')
  if (reason === 'number' || reason === 'number_prefix') {
    return t('importFindings.accountVat.reason.number')
  }
  return t('importFindings.accountVat.reason.name')
}
