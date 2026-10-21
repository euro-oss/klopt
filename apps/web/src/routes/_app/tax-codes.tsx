import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet'
import { useT } from '~/i18n/provider'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { may, MAY_MANAGE_TAX_CODES } from '~/lib/roles'
import { createTaxCodes, deactivateTaxCode, listTaxCodeOffers, listTaxCodes } from '~/server/sales'

/**
 * BTW-codes beheren — list the entity’s VAT codes and add missing standard ones.
 *
 * Insert-only from the fixed nl-mkb allowlist. Pairs (VERL9-*, ICV9*, INV9*)
 * arrive together. Rate / rubriek edits are never offered: a rate change is a
 * new row with a new valid_from. Unused codes may be closed with valid_to.
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

function TaxCodesPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const key = useRef(crypto.randomUUID())

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

  async function addSelected() {
    if (selected === null) return
    setBusy(true)
    setError(null)
    const result = await createTaxCodes({
      data: { key: selected, idempotencyKey: key.current },
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.problem.detail)
      return
    }
    key.current = crypto.randomUUID()
    setSelected(null)
    setOpen(false)
    await router.invalidate()
  }

  async function closeCode(row: TaxCodeRow) {
    if (row.inUse) return
    setBusy(true)
    setError(null)
    const today = new Date().toISOString().slice(0, 10)
    const result = await deactivateTaxCode({
      data: { taxCodeId: row.id, validTo: today, idempotencyKey: key.current },
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.problem.detail)
      return
    }
    key.current = crypto.randomUUID()
    await router.invalidate()
  }

  const columns: Column<TaxCodeRow>[] = [
    {
      key: 'code',
      header: t('taxCodes.col.code'),
      cell: (row) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <code className="text-sm font-medium">{row.code}</code>
          {row.correctionOnly ? (
            <Badge variant="attention">{t('taxCodes.badge.correctionOnly')}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'description',
      header: t('taxCodes.col.label'),
      cell: (row) => row.description,
    },
    {
      key: 'rate',
      header: t('taxCodes.col.rate'),
      align: 'right',
      cell: (row) => <span className="tabular-nums">{row.ratePercent}%</span>,
    },
    {
      key: 'direction',
      header: t('taxCodes.col.direction'),
      cell: (row) =>
        row.direction === 'output'
          ? t('taxCodes.direction.sales')
          : t('taxCodes.direction.purchase'),
    },
    {
      key: 'rubrieken',
      header: t('taxCodes.col.rubrieken'),
      cell: (row) => {
        const parts = [row.baseRubriek, row.vatRubriek].filter(
          (value): value is string => value !== null && value !== '',
        )
        return parts.length === 0 ? '—' : parts.join(' / ')
      },
    },
    {
      key: 'valid',
      header: t('taxCodes.col.valid'),
      cell: (row) => (
        <span className="tabular-nums text-sm">
          {formatDate(row.validFrom)}
          {row.validTo !== null ? ` – ${formatDate(row.validTo)}` : ''}
        </span>
      ),
    },
    {
      key: 'category',
      header: t('taxCodes.col.category'),
      cell: (row) => (
        <span className="text-muted-foreground text-xs tracking-wide uppercase">
          {row.scope.replaceAll('_', ' ')}
          {row.ublCategory !== '' ? ` · ${row.ublCategory}` : ''}
        </span>
      ),
    },
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
      cell: (row) =>
        row.inUse || row.validTo !== null ? null : (
          <button
            type="button"
            disabled={!hydrated || busy}
            onClick={() => void closeCode(row)}
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline disabled:opacity-50"
          >
            {t('taxCodes.deactivate')}
          </button>
        ),
    },
  ]

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

      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-none border border-dashed p-6 text-sm">
          {t('taxCodes.empty')}
        </p>
      ) : (
        <LedgerTable
          columns={columns}
          rows={[...rows]}
          rowKey={(row) => row.id}
          caption={t('taxCodes.caption')}
        />
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" closeLabel={t('common.cancel')}>
          <SheetHeader>
            <SheetTitle>{t('taxCodes.addTitle')}</SheetTitle>
            <SheetDescription>{t('taxCodes.addIntro')}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {offers.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('taxCodes.offersEmpty')}</p>
            ) : (
              <fieldset className="space-y-2">
                <legend className="sr-only">{t('taxCodes.addTitle')}</legend>
                {offers.map((offer) => {
                  const label = offer.pair
                    ? `${offer.codes.join(' + ')} — ${offer.descriptions[0] ?? offer.key}`
                    : `${offer.codes[0]} — ${offer.descriptions[0] ?? offer.key}`
                  return (
                    <label
                      key={offer.key}
                      className="border-border hover:bg-muted/40 flex cursor-pointer items-start gap-3 border p-3"
                    >
                      <input
                        type="radio"
                        name="tax-code-offer"
                        value={offer.key}
                        checked={selected === offer.key}
                        onChange={() => {
                          setSelected(offer.key)
                        }}
                        className="mt-1"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <code className="text-sm font-medium">{offer.codes.join(' + ')}</code>
                          {offer.pair ? (
                            <Badge variant="outline">{t('taxCodes.offer.pair')}</Badge>
                          ) : null}
                          {offer.correctionOnly ? (
                            <Badge variant="attention">{t('taxCodes.badge.correctionOnly')}</Badge>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground mt-0.5 block text-sm">
                          {offer.descriptions.join(' · ')}
                        </span>
                        <span className="text-muted-foreground mt-1 block text-xs tabular-nums">
                          {offer.ratePercent}% ·{' '}
                          {offer.direction === 'output'
                            ? t('taxCodes.direction.sales')
                            : t('taxCodes.direction.purchase')}
                        </span>
                        <span className="sr-only">{label}</span>
                      </span>
                    </label>
                  )
                })}
              </fieldset>
            )}
          </div>

          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={busy || !hydrated || selected === null || offers.length === 0}
              onClick={() => void addSelected()}
            >
              {busy ? t('common.busy') : t('taxCodes.addConfirm')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
