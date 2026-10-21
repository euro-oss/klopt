import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { PageHeader } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
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
import type { MessageKey } from '~/i18n/nl'
import { useAdvancedMode } from '~/lib/advanced-mode-context'
import { todayInAmsterdam } from '~/lib/amsterdam-date'
import { taxCodeUnavailableFrom } from '~/lib/booking-tax-codes'
import { formatDate } from '~/lib/format'
import { formatRatePercent } from '~/lib/guided-invoice'
import { useHydrated } from '~/lib/hydration'
import { plainOfferLabel, plainVatLabel } from '~/lib/plain-vat-label'
import { may, MAY_MANAGE_TAX_CODES } from '~/lib/roles'
import { cn } from '~/lib/utils'
import { createTaxCodes, deactivateTaxCode, listTaxCodeOffers, listTaxCodes } from '~/server/sales'

/**
 * Btw-codes beheren — list the entity’s VAT codes and add missing standard ones.
 *
 * Insert-only from the fixed nl-mkb allowlist. Pairs (VERL9-*, ICV9*, INV9*)
 * arrive together. Rate / rubriek edits are never offered: a rate change is a
 * new row with a new valid_from. Unused codes may be ended with valid_to and
 * restored with valid_to null.
 *
 * Eigenaar / Accountant only (`tax-codes:manage`). A bookkeeper holds
 * `ledger:configure` and must not reach this screen.
 */
export const Route = createFileRoute('/_app/tax-codes')({
  loader: async ({ context }) => {
    const role = context.session.memberships[0]?.role ?? ''
    if (!may(MAY_MANAGE_TAX_CODES, role)) {
      return { role, taxCodes: null, offers: null, forbidden: true as const }
    }
    const [taxCodes, offers] = await Promise.all([listTaxCodes(), listTaxCodeOffers()])
    return { role, taxCodes, offers, forbidden: false as const }
  },
  component: TaxCodesPage,
})

type TaxCodeRow = {
  readonly id: string
  readonly code: string
  readonly description: string
  readonly rateBasisPoints: number
  readonly ratePercent: string
  readonly direction: string
  readonly baseRubriek: string | null
  readonly vatRubriek: string | null
  readonly scope: string
  readonly ublCategory: string
  readonly validFrom: string
  readonly validTo: string | null
  readonly inUse: boolean
  readonly correctionOnly: boolean
}

type OfferRow = {
  readonly key: string
  readonly codes: readonly string[]
  readonly descriptions: readonly string[]
  readonly ratePercent: string
  readonly direction: string
  readonly pair: boolean
  readonly correctionOnly: boolean
}

type PendingEnd = {
  readonly row: TaxCodeRow
  readonly endDate: string
}

/** Desktop table from `sm` up; stacked cards below — only one is mounted. */
function useWideLayout(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia('(min-width: 640px)')
      media.addEventListener('change', onChange)
      return () => {
        media.removeEventListener('change', onChange)
      }
    },
    () => window.matchMedia('(min-width: 640px)').matches,
    () => false,
  )
}

function TaxCodesPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const wideLayout = useWideLayout()
  const { t } = useT()
  const { advanced } = useAdvancedMode()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [pendingEnd, setPendingEnd] = useState<PendingEnd | null>(null)
  const key = useRef(crypto.randomUUID())
  const confirmActionRef = useRef<HTMLButtonElement>(null)
  const endTriggerRef = useRef<HTMLButtonElement | null>(null)
  const offerListId = useId()

  if (data.forbidden) {
    return (
      <>
        <PageHeader title={t('taxCodes.title')} description={t('taxCodes.intro')} />
        <p role="alert" className="text-muted-foreground max-w-xl text-sm">
          {t('taxCodes.forbidden')}
        </p>
      </>
    )
  }

  if (data.taxCodes === null || !data.taxCodes.ok) {
    return (
      <>
        <PageHeader title={t('taxCodes.title')} />
        <p role="alert" className="text-destructive text-sm">
          {data.taxCodes && !data.taxCodes.ok
            ? data.taxCodes.problem.detail
            : t('common.unknownError')}
        </p>
      </>
    )
  }

  const rows: readonly TaxCodeRow[] = data.taxCodes.data.taxCodes
  const offers: readonly OfferRow[] =
    data.offers !== null && data.offers.ok ? data.offers.data.offers : []

  function mapProblem(problem: {
    readonly code: string
    readonly detail: string
    readonly violations: readonly { readonly code: string }[]
  }): string {
    const violation = problem.violations[0]?.code
    if (violation === 'tax_code_exists' || problem.code === 'conflict') {
      if (problem.detail.includes('and') || problem.detail.includes('pair')) {
        return t('taxCodes.error.pairHalf')
      }
      return t('taxCodes.error.exists')
    }
    if (violation === 'tax_code_in_use') return t('taxCodes.error.inUse')
    if (violation === 'unknown_tax_code_offer' || problem.code === 'validation_failed') {
      return t('taxCodes.error.notAllowed')
    }
    if (problem.code === 'forbidden') return t('taxCodes.error.forbidden')
    return t('taxCodes.error.generic')
  }

  function badgeFor(row: { readonly code: string; readonly correctionOnly: boolean }) {
    if (!row.correctionOnly) return null
    const label =
      row.code === 'PRIV21' ? t('taxCodes.badge.privateUse') : t('taxCodes.badge.correctionOnly')
    return <Badge variant="info">{label}</Badge>
  }

  function scopeLabel(scope: string): string {
    const key = `taxCodes.scope.${scope}` as MessageKey
    const translated = t(key)
    return translated === key ? scope.replaceAll('_', ' ') : translated
  }

  function rateDisplay(ratePercent: string): string {
    return `${formatRatePercent(ratePercent)}%`
  }

  function unavailableLabel(validTo: string): string {
    return formatDate(taxCodeUnavailableFrom(validTo))
  }

  async function addSelected() {
    if (selected === null) return
    const offer = offers.find((row) => row.key === selected)
    setBusy(true)
    setError(null)
    const result = await createTaxCodes({
      data: { key: selected, idempotencyKey: key.current },
    })
    setBusy(false)
    if (!result.ok) {
      setError(mapProblem(result.problem))
      return
    }
    const label = offer ? plainOfferLabel(offer.codes, t, offer.descriptions[0]) : selected
    key.current = crypto.randomUUID()
    setSelected(null)
    setOpen(false)
    setNotice(t('taxCodes.notice.added', { label }))
    await router.invalidate()
  }

  async function confirmEnd() {
    if (pendingEnd === null) return
    const { row, endDate } = pendingEnd
    setBusy(true)
    setError(null)
    const result = await deactivateTaxCode({
      data: { taxCodeId: row.id, validTo: endDate, idempotencyKey: key.current },
    })
    setBusy(false)
    if (!result.ok) {
      setError(mapProblem(result.problem))
      setPendingEnd(null)
      return
    }
    key.current = crypto.randomUUID()
    const label = plainVatLabel(row.code, t, row.description)
    setPendingEnd(null)
    setNotice(t('taxCodes.notice.ended', { label, datum: unavailableLabel(endDate) }))
    await router.invalidate()
  }

  async function restoreCode(row: TaxCodeRow) {
    setBusy(true)
    setError(null)
    const result = await deactivateTaxCode({
      data: { taxCodeId: row.id, validTo: null, idempotencyKey: key.current },
    })
    setBusy(false)
    if (!result.ok) {
      setError(mapProblem(result.problem))
      return
    }
    key.current = crypto.randomUUID()
    const label = plainVatLabel(row.code, t, row.description)
    setNotice(t('taxCodes.notice.restored', { label }))
    await router.invalidate()
  }

  function onOfferKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (offers.length === 0) return
    const current = selected === null ? -1 : offers.findIndex((offer) => offer.key === selected)
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      const next = current < 0 ? 0 : (current + 1) % offers.length
      setSelected(offers[next]!.key)
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const next = current <= 0 ? offers.length - 1 : current - 1
      setSelected(offers[next]!.key)
      return
    }
    if (event.key === 'Enter' && selected !== null) {
      event.preventDefault()
      void addSelected()
    }
  }

  function rowAction(row: TaxCodeRow) {
    if (row.inUse) return null
    if (row.validTo !== null) {
      return (
        <div className="flex flex-col items-start gap-1">
          {!advanced ? (
            <span className="text-muted-foreground text-xs">
              {t('taxCodes.endedStatus', { datum: unavailableLabel(row.validTo) })}
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hydrated || busy}
            className="min-h-11 md:min-h-9"
            onClick={() => void restoreCode(row)}
          >
            {t('taxCodes.restore')}
          </Button>
        </div>
      )
    }
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!hydrated || busy}
        className="min-h-11 md:min-h-9"
        onClick={(event) => {
          setError(null)
          endTriggerRef.current = event.currentTarget
          setPendingEnd({ row, endDate: todayInAmsterdam() })
        }}
      >
        {t('taxCodes.deactivate')}
      </Button>
    )
  }

  const columns: Column<TaxCodeRow>[] = [
    {
      key: 'label',
      header: t('taxCodes.col.label'),
      cell: (row) => {
        const label = plainVatLabel(row.code, t, row.description)
        return (
          <span className="inline-flex flex-col gap-0.5">
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{label}</span>
              {badgeFor(row)}
            </span>
            <code className="text-muted-foreground text-xs tabular-nums">{row.code}</code>
          </span>
        )
      },
    },
    {
      key: 'rate',
      header: t('taxCodes.col.rate'),
      align: 'right',
      cell: (row) => <span className="tabular-nums">{rateDisplay(row.ratePercent)}</span>,
    },
    {
      key: 'direction',
      header: t('taxCodes.col.direction'),
      cell: (row) =>
        row.direction === 'output'
          ? t('taxCodes.direction.sales')
          : t('taxCodes.direction.purchase'),
    },
    ...(advanced
      ? ([
          {
            key: 'rubrieken',
            header: t('taxCodes.col.rubrieken'),
            cell: (row: TaxCodeRow) => {
              const parts = [row.baseRubriek, row.vatRubriek].filter(
                (value): value is string => value !== null && value !== '',
              )
              return parts.length === 0 ? '—' : parts.join(' / ')
            },
          },
          {
            key: 'valid',
            header: t('taxCodes.col.valid'),
            cell: (row: TaxCodeRow) => (
              <span className="tabular-nums text-sm">
                {formatDate(row.validFrom)}
                {row.validTo !== null ? ` – ${formatDate(row.validTo)}` : ''}
              </span>
            ),
          },
          {
            key: 'category',
            header: t('taxCodes.col.category'),
            cell: (row: TaxCodeRow) => (
              <span className="text-muted-foreground text-xs">
                {scopeLabel(row.scope)}
                {row.ublCategory !== '' ? ` · ${row.ublCategory}` : ''}
              </span>
            ),
          },
        ] as Column<TaxCodeRow>[])
      : []),
    {
      key: 'inUse',
      header: t('taxCodes.col.inUse'),
      cell: (row) =>
        row.inUse ? (
          <Badge variant="info">{t('taxCodes.inUse.yes')}</Badge>
        ) : (
          <span className="text-muted-foreground text-xs">{t('taxCodes.inUse.no')}</span>
        ),
    },
    {
      key: 'actions',
      header: t('taxCodes.col.actions'),
      cell: (row) => rowAction(row),
    },
  ]

  const checkedOfferIndex =
    selected === null ? -1 : offers.findIndex((offer) => offer.key === selected)

  const pendingLabel =
    pendingEnd === null ? '' : plainVatLabel(pendingEnd.row.code, t, pendingEnd.row.description)

  return (
    <>
      <PageHeader
        title={t('taxCodes.title')}
        description={t('taxCodes.intro')}
        actions={
          <Button
            type="button"
            disabled={!hydrated}
            onClick={() => {
              setError(null)
              setSelected(null)
              setOpen(true)
            }}
          >
            {t('taxCodes.add')}
          </Button>
        }
      />

      {/* Mounted before it has text so screen readers announce when it fills. */}
      <p
        role="status"
        aria-live="polite"
        className={cn('text-sm', notice === null ? 'sr-only' : 'border-border mb-4 border p-3')}
      >
        {notice ?? ''}
      </p>

      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-none border border-dashed p-6 text-sm">
          {t('taxCodes.empty')}
        </p>
      ) : wideLayout ? (
        <LedgerTable
          columns={columns}
          rows={[...rows]}
          rowKey={(row) => row.id}
          caption={t('taxCodes.caption')}
        />
      ) : (
        /* Below sm the sticky label column fills the viewport; stack instead. */
        <ul className="border-border divide-y border" aria-label={t('taxCodes.caption')}>
          {rows.map((row) => {
            const label = plainVatLabel(row.code, t, row.description)
            const rubrieken = [row.baseRubriek, row.vatRubriek].filter(
              (value): value is string => value !== null && value !== '',
            )
            return (
              <li key={row.id} className="flex flex-col gap-2 px-3 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{label}</span>
                    {badgeFor(row)}
                  </span>
                  <code className="text-muted-foreground text-xs tabular-nums">{row.code}</code>
                </div>
                <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>
                    {t('taxCodes.col.rate')}:{' '}
                    <span className="text-foreground tabular-nums">
                      {rateDisplay(row.ratePercent)}
                    </span>
                  </span>
                  <span>
                    {t('taxCodes.col.inUse')}:{' '}
                    {row.inUse ? t('taxCodes.inUse.yes') : t('taxCodes.inUse.no')}
                  </span>
                  {advanced ? (
                    <>
                      <span>
                        {t('taxCodes.col.rubrieken')}:{' '}
                        <span className="text-foreground">
                          {rubrieken.length === 0 ? '—' : rubrieken.join(' / ')}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {t('taxCodes.col.valid')}: {formatDate(row.validFrom)}
                        {row.validTo !== null ? ` – ${formatDate(row.validTo)}` : ''}
                      </span>
                    </>
                  ) : null}
                </div>
                <div>{rowAction(row)}</div>
              </li>
            )
          })}
        </ul>
      )}

      <Sheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setSelected(null)
        }}
      >
        <SheetContent side="right" closeLabel={t('common.cancel')}>
          <SheetHeader>
            <SheetTitle>{t('taxCodes.addTitle')}</SheetTitle>
            <SheetDescription>{t('taxCodes.addIntro')}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {offers.length === 0 ? (
              <p className="text-muted-foreground text-sm" role="status">
                {t('taxCodes.offersEmpty')}
              </p>
            ) : (
              <div
                id={offerListId}
                role="radiogroup"
                aria-label={t('taxCodes.addTitle')}
                className="flex flex-col divide-y border"
                onKeyDown={onOfferKeyDown}
              >
                {offers.map((offer, index) => {
                  const checked = selected === offer.key
                  const tabStop = checkedOfferIndex >= 0 ? index === checkedOfferIndex : index === 0
                  const label = plainOfferLabel(offer.codes, t, offer.descriptions[0])
                  return (
                    <button
                      key={offer.key}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      tabIndex={tabStop ? 0 : -1}
                      onClick={() => {
                        setSelected(offer.key)
                      }}
                      className={cn(
                        'min-h-11 px-3 py-2 text-left text-sm outline-none',
                        'focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring',
                        checked
                          ? 'bg-foreground text-background font-medium focus-visible:outline-background'
                          : 'hover:bg-muted',
                      )}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="block">{label}</span>
                        {offer.correctionOnly ? (
                          <Badge variant={checked ? 'outline' : 'info'}>
                            {offer.codes[0] === 'PRIV21'
                              ? t('taxCodes.badge.privateUse')
                              : t('taxCodes.badge.correctionOnly')}
                          </Badge>
                        ) : null}
                      </span>
                      {offer.pair ? (
                        <span
                          className={cn(
                            'mt-0.5 block text-xs',
                            checked ? 'opacity-70' : 'text-muted-foreground',
                          )}
                        >
                          {t('taxCodes.offer.addsPair')}
                        </span>
                      ) : null}
                      {advanced ? (
                        <span
                          className={cn(
                            'mt-0.5 block text-xs tabular-nums',
                            checked ? 'opacity-70' : 'text-muted-foreground',
                          )}
                        >
                          {offer.codes.join(' + ')} · {rateDisplay(offer.ratePercent)}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 md:min-h-9"
              onClick={() => setOpen(false)}
            >
              {t('common.cancel')}
              <Keycap className="ml-1 hidden md:inline-flex">Esc</Keycap>
            </Button>
            <Button
              type="button"
              className="min-h-11 md:min-h-9"
              disabled={busy || !hydrated || selected === null || offers.length === 0}
              onClick={() => void addSelected()}
            >
              {busy ? t('common.busy') : t('taxCodes.addConfirm')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={pendingEnd !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPendingEnd(null)
            // Controlled open (no Trigger) — restore focus to the row button.
            queueMicrotask(() => {
              endTriggerRef.current?.focus()
            })
          }
        }}
      >
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            confirmActionRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingEnd === null
                ? ''
                : t('taxCodes.deactivateTitle', {
                    label: pendingLabel,
                    code: pendingEnd.row.code,
                  })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingEnd === null
                ? ''
                : t('taxCodes.deactivateBody', {
                    datum: unavailableLabel(pendingEnd.endDate),
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t('common.cancel')}
              <span className="ml-1 hidden normal-case md:inline-flex">
                <Keycap>Esc</Keycap>
              </span>
            </AlertDialogCancel>
            <Button
              type="button"
              ref={confirmActionRef}
              disabled={busy || !hydrated}
              className="min-h-11 md:min-h-9"
              onClick={() => void confirmEnd()}
            >
              {busy ? t('common.busy') : t('taxCodes.deactivateConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
