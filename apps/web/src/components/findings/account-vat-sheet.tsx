/**
 * Category + btw picker sheet (redesign slice 4 / #61).
 *
 * Ports the prototype guided fix: RGS-ranked combobox with “Beste match”, then
 * a three-way btw radio. Account numbers, RGS codes and btw codes stay
 * advanced-only. Mode `account` saves only the category; mode `tax` saves only
 * the VAT code (PM #69 — do not claim both when only one is persisted).
 */

import { RiAddLine, RiCheckLine, RiSearchLine } from '@remixicon/react'
import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import {
  rankAccountSuggestions,
  type RankableAccount,
  type RankedAccount,
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
import {
  suggestVatCode,
  vatOptionsFor,
  type ImportVatCode,
  type ImportVatRule,
} from '~/lib/import-findings'
import { cn } from '~/lib/utils'
import { useT } from '~/i18n/provider'
import type { MessageKey } from '~/i18n/nl'

const TOP_RANKED = 5

export interface AccountVatSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly sourceName: string
  readonly sourceDetail?: string
  readonly rgsCode?: string | null
  readonly sourceNumber?: string
  readonly accounts: readonly RankableAccount[]
  /** Entity chart tax rules — options come from `matchVatCodes`, not a hard-coded list. */
  readonly taxRules?: readonly ImportVatRule[]
  /** Prefill from Moneybird tax percentage when known (ignored when multiple matches). */
  readonly suggestedVat?: ImportVatCode | null
  /** Moneybird `tax_rate_type` for direction-safe VAT radios. */
  readonly taxRateType?: string | null
  /** Moneybird percentage text (`21`, `9`, …). */
  readonly percentage?: string | null
  /** Which steps to show and persist. */
  readonly mode?: 'account' | 'tax'
  /** Geavanceerd: show account numbers, RGS codes and btw codes. */
  readonly advanced?: boolean
  /** #42 fallback: jump to the MappingReview row under the sheet. */
  readonly onJumpToMapping?: () => void
  readonly onSave: (choice: {
    readonly accountNumber: string | null
    readonly accountName: string | null
    readonly vatCode: ImportVatCode | null
    readonly isNewAccount?: boolean
  }) => void
}

export function AccountVatSheet(props: AccountVatSheetProps) {
  // Remount the body whenever the sheet opens so picker state starts fresh
  // without a setState-in-effect reset (react-hooks/set-state-in-effect).
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <AccountVatSheetBody
          key={[
            props.sourceName,
            props.sourceNumber ?? '',
            props.mode ?? 'account',
            props.suggestedVat ?? '',
            props.taxRateType ?? '',
            props.percentage ?? '',
          ].join('|')}
          {...props}
        />
      ) : null}
    </Sheet>
  )
}

function AccountVatSheetBody({
  onOpenChange,
  sourceName,
  sourceDetail,
  rgsCode = null,
  sourceNumber = '',
  accounts,
  taxRules = [],
  suggestedVat = null,
  taxRateType = null,
  percentage = null,
  mode = 'account',
  advanced = false,
  onJumpToMapping,
  onSave,
}: AccountVatSheetProps) {
  const { t } = useT()
  const listId = useId()
  const vatOptions = useMemo(
    () => vatOptionsFor({ rules: taxRules, taxRateType, percentage }),
    [taxRules, taxRateType, percentage],
  )
  // Prefill only when exactly one match — never GEEN among five 0% sales codes.
  const uniqueSuggested = suggestVatCode({ rules: taxRules, taxRateType, percentage })
  const defaultVat =
    uniqueSuggested !== null
      ? uniqueSuggested
      : suggestedVat !== null &&
          vatOptions.length === 1 &&
          vatOptions.some((option) => option.code === suggestedVat)
        ? suggestedVat
        : null
  const emptyChart = accounts.length === 0
  const initialChosen = emptyChart
    ? null
    : (buildRankedList(accounts, {
        rgsCode,
        number: sourceNumber,
        name: sourceName,
      })[0]?.account.number ??
      accounts[0]?.number ??
      null)

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [chosenNumber, setChosenNumber] = useState<string | null>(initialChosen)
  const [newAccount, setNewAccount] = useState(emptyChart)
  const [vat, setVat] = useState<ImportVatCode | null>(defaultVat)

  const ranked = useMemo(
    () => buildRankedList(accounts, { rgsCode, number: sourceNumber, name: sourceName, query }),
    [accounts, rgsCode, sourceNumber, sourceName, query],
  )

  const chosen = newAccount
    ? null
    : (ranked.find((row) => row.account.number === chosenNumber)?.account ??
      accounts.find((account) => account.number === chosenNumber) ??
      null)
  const vatOption = vatOptions.find((option) => option.code === vat) ?? null
  const percentageLabel = (percentage ?? '').trim().replace(/\.0+$/, '') || '—'

  const canSave =
    mode === 'tax'
      ? vat !== null && vatOptions.length > 0
      : newAccount
        ? sourceNumber.trim() !== ''
        : chosen !== null

  const saveAccount = (account: RankableAccount): void => {
    onSave({
      accountNumber: account.number,
      accountName: account.name,
      vatCode: null,
    })
    onOpenChange(false)
  }

  const save = (): void => {
    if (!canSave) return
    if (mode === 'tax') {
      onSave({
        accountNumber: null,
        accountName: null,
        vatCode: vat,
      })
      onOpenChange(false)
      return
    }
    if (newAccount) {
      onSave({
        accountNumber: sourceNumber.trim(),
        accountName: sourceName,
        vatCode: null,
        isNewAccount: true,
      })
      onOpenChange(false)
      return
    }
    if (chosen === null) return
    saveAccount(chosen)
  }

  const vatLabel = (option: { readonly code: string; readonly description: string }): string => {
    const key = `importFindings.vat.${option.code}` as MessageKey
    const translated = t(key)
    // Unknown keys fall through as the key string — prefer the chart description.
    return translated === key || translated.startsWith('importFindings.vat.')
      ? option.description
      : translated
  }

  const onVatKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (vatOptions.length === 0) return
    const index = vatOptions.findIndex((option) => option.code === vat)
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      // No selection yet: ↓/→ picks the first; otherwise advance.
      const next = vatOptions[index < 0 ? 0 : (index + 1) % vatOptions.length]
      if (next !== undefined) setVat(next.code)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      const prev =
        vatOptions[
          index < 0 ? vatOptions.length - 1 : (index - 1 + vatOptions.length) % vatOptions.length
        ]
      if (prev !== undefined) setVat(prev.code)
    }
  }

  const eyebrow =
    mode === 'tax'
      ? t('importFindings.accountVat.eyebrowTax')
      : t('importFindings.accountVat.eyebrowAccount')
  const title =
    mode === 'tax'
      ? t('importFindings.accountVat.titleTax', { name: sourceName })
      : t('importFindings.accountVat.title', { name: sourceName })

  return (
    <SheetContent
      side="right"
      closeLabel={t('findingCard.close')}
      className="flex w-full flex-col sm:max-w-[520px]"
      data-slot="account-vat-sheet"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const target = event.target as HTMLElement
          if (target.tagName === 'INPUT' || target.getAttribute('role') === 'radio') {
            event.preventDefault()
            save()
          }
        }
      }}
    >
      <SheetHeader className="border-b px-5 py-4">
        <SheetDescription className="text-xs">{eyebrow}</SheetDescription>
        <SheetTitle className="text-lg leading-snug">{title}</SheetTitle>
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

        {mode === 'account' && (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label htmlFor="account-vat-query" className="text-sm font-medium">
                {t('importFindings.accountVat.stepCategory')}
              </label>
              <span className="text-muted-foreground text-xs">
                {advanced
                  ? t('importFindings.accountVat.rankedByRgs')
                  : t('importFindings.accountVat.rankedBestFirst')}
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
                  setNewAccount(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setActive((current) => Math.min(current + 1, Math.max(0, ranked.length - 1)))
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setActive((current) => Math.max(current - 1, 0))
                  } else if (event.key === 'Enter') {
                    const row = ranked[active]
                    if (row === undefined) return
                    // Commit the highlighted row and stop bubble — SheetContent's
                    // Enter handler would otherwise save() with the *previous* pick.
                    event.preventDefault()
                    event.stopPropagation()
                    setChosenNumber(row.account.number)
                    setNewAccount(false)
                    saveAccount(row.account)
                  }
                }}
                className="border-input bg-background min-h-11 w-full border py-2 pr-3 pl-9 text-base md:min-h-9 md:text-sm"
              />
            </div>

            <ul
              id={listId}
              role="listbox"
              aria-label={t('importFindings.accountVat.listLabel')}
              className="mt-1 max-h-64 divide-y overflow-y-auto border"
            >
              {ranked.length === 0 ? (
                <li className="text-muted-foreground px-3 py-3 text-sm">
                  {t('importFindings.accountVat.empty')}
                </li>
              ) : (
                ranked.map((row, index) => {
                  const selected = !newAccount && row.account.number === chosenNumber
                  const isActive = !newAccount && index === active
                  return (
                    <li
                      key={row.account.number}
                      id={`${listId}-${String(index)}`}
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => {
                        setChosenNumber(row.account.number)
                        setNewAccount(false)
                      }}
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
                        <span className="w-10 text-xs tabular-nums">{row.account.number}</span>
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
                          {advanced &&
                            row.account.rgsCode !== null &&
                            row.account.rgsCode !== '' && (
                              <>
                                {' · RGS '}
                                <span className="text-xs tracking-normal">
                                  {row.account.rgsCode}
                                </span>
                              </>
                            )}
                        </span>
                      </span>
                    </li>
                  )
                })
              )}
            </ul>

            <button
              type="button"
              onClick={() => {
                setNewAccount(true)
                setChosenNumber(null)
              }}
              className={cn(
                'mt-2 flex min-h-11 w-full items-center gap-2 border border-dashed px-3 py-2 text-sm',
                newAccount ? 'border-foreground bg-muted' : 'hover:bg-muted',
              )}
            >
              <RiAddLine className="size-4" aria-hidden />
              {sourceNumber.trim() !== ''
                ? t('importFindings.accountVat.useNewNumber', { number: sourceNumber })
                : t('importFindings.accountVat.newCategory')}
            </button>
          </>
        )}

        {mode === 'tax' && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">
              {t('importFindings.accountVat.stepVatOnly')}
            </legend>
            {vatOptions.length === 0 ? (
              <p className="text-muted-foreground border px-3 py-3 text-sm" role="status">
                {percentageLabel === '—'
                  ? t('importFindings.accountVat.vatUnknown')
                  : t('importFindings.accountVat.vatUnsupported', { rate: percentageLabel })}
              </p>
            ) : (
              <div
                role="radiogroup"
                className={cn(
                  'border',
                  vatOptions.length <= 3
                    ? 'grid'
                    : 'flex max-h-64 flex-col divide-y overflow-y-auto',
                )}
                style={
                  vatOptions.length <= 3
                    ? {
                        gridTemplateColumns: `repeat(${String(vatOptions.length)}, minmax(0, 1fr))`,
                      }
                    : undefined
                }
                onKeyDown={onVatKeyDown}
              >
                {vatOptions.map((option, index) => {
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
                        'min-h-11 px-3 text-left text-sm',
                        vatOptions.length <= 3 && index > 0 && 'border-l',
                        checked ? 'bg-foreground text-background font-medium' : 'hover:bg-muted',
                      )}
                    >
                      <span className="block">{vatLabel(option)}</span>
                      {advanced && <span className="block text-xs opacity-70">{option.code}</span>}
                    </button>
                  )
                })}
              </div>
            )}
            <p className="text-muted-foreground mt-1.5 text-xs">
              {percentage !== null && percentage !== '' && percentageLabel !== '—'
                ? t('importFindings.accountVat.vatHint', { rate: percentageLabel })
                : t('importFindings.accountVat.vatHintUnknown')}
            </p>
          </fieldset>
        )}

        {mode === 'account' && (chosen !== null || newAccount) && (
          <div className="border-accent bg-muted mt-6 border-l-[3px] px-4 py-3 text-sm">
            <p className="font-medium">{t('importFindings.accountVat.whatHappens')}</p>
            <p className="text-muted-foreground mt-1">
              {t('importFindings.accountVat.whatHappensAccount', {
                account: newAccount ? sourceName : (chosen?.name ?? sourceName),
              })}
            </p>
          </div>
        )}

        {mode === 'tax' && vatOption !== null && (
          <div className="border-accent bg-muted mt-6 border-l-[3px] px-4 py-3 text-sm">
            <p className="font-medium">{t('importFindings.accountVat.whatHappens')}</p>
            <p className="text-muted-foreground mt-1">
              {t('importFindings.accountVat.whatHappensTax', {
                vat: vatLabel(vatOption),
              })}
            </p>
          </div>
        )}
      </div>

      <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t px-5 py-3">
        {onJumpToMapping !== undefined && (
          <Button
            type="button"
            variant="ghost"
            className="mr-auto min-h-11 md:min-h-9"
            onClick={onJumpToMapping}
          >
            {t('importFindings.accountVat.jumpToMapping')}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 md:min-h-9"
          onClick={() => onOpenChange(false)}
        >
          {t('common.cancel')}
          <Keycap className="ml-1 hidden md:inline-flex">Esc</Keycap>
        </Button>
        <Button type="button" disabled={!canSave} className="min-h-11 md:min-h-9" onClick={save}>
          {t('common.save')}
          <Keycap className="ml-1 hidden md:inline-flex">↵</Keycap>
        </Button>
      </SheetFooter>
    </SheetContent>
  )
}

function buildRankedList(
  accounts: readonly RankableAccount[],
  query: {
    readonly rgsCode: string | null
    readonly number: string
    readonly name: string
    readonly query?: string
  },
): readonly RankedAccount[] {
  const typed = (query.query ?? '').trim()
  const matched = rankAccountSuggestions(accounts, query)
  if (typed !== '') return matched

  const seen = new Set(matched.map((row) => row.account.number))
  const rest: RankedAccount[] = accounts
    .filter((account) => !seen.has(account.number))
    .map((account) => ({
      account,
      rank: 99,
      reason: 'name_contains' as const,
    }))
  const combined = [...matched, ...rest]
  // Prototype: top ~5 until the user searches.
  return combined.slice(0, Math.max(TOP_RANKED, matched.length))
}

function reasonLabel(
  t: (
    key:
      | 'importFindings.accountVat.reason.rgs'
      | 'importFindings.accountVat.reason.number'
      | 'importFindings.accountVat.reason.name',
    values?: Record<string, string>,
  ) => string,
  reason: 'rgs' | 'number' | 'number_prefix' | 'name' | 'name_contains',
): string {
  if (reason === 'rgs') return t('importFindings.accountVat.reason.rgs')
  if (reason === 'number' || reason === 'number_prefix') {
    return t('importFindings.accountVat.reason.number')
  }
  return t('importFindings.accountVat.reason.name')
}
