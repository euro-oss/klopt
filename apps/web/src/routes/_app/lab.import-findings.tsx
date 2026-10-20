import { createFileRoute, notFound } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { normalizeFxRateInput } from '@klopt/core/moneybird-fx'
import { PageHeader } from '~/components/app-shell'
import { AccountVatSheet } from '~/components/findings/account-vat-sheet'
import { FxRateSheet } from '~/components/findings/fx-rate-sheet'
import { ImportFindingsScreen } from '~/components/findings/import-findings-screen'
import { ScrollTable, stickyFirstCol } from '~/components/ui/scroll-table'
import { NL_MKB_VAT_RULES } from '~/lib/import-findings'
import {
  applyTaxMappingSaveFailure,
  scrollTaxMappingViolationIntoView,
  type TaxMappingViolationView,
} from '~/lib/tax-mapping-save'
import { MoneybirdMappingReview } from '~/components/findings/moneybird-mapping-review'
import {
  EXACT_FIXTURE_SOURCES,
  FIXTURE_ACCOUNTS,
  MONEYBIRD_FIXTURE_RESOLVED,
  MONEYBIRD_FIXTURE_SOURCES,
  exactFixtureFindings,
  moneybirdFixtureFindings,
} from '~/lib/import-findings-fixtures'
import type { FindingsListItem } from '~/components/findings/finding-card'
import { formatFindingAmount } from '~/lib/finding-card'
import type { ResolvedFindingRow } from '~/lib/import-findings'
import { useAdvancedMode } from '~/lib/advanced-mode-context'
import { useHydrated } from '~/lib/hydration'
import { cn } from '~/lib/utils'
import { useT } from '~/i18n/provider'

/**
 * Import findings lab (redesign slice 4 / #61).
 *
 * Dev-only fixture surface for Playwright and PR screenshots — no live
 * Moneybird/Exact token. Lives under `_app` so screenshots capture the real
 * shell. Production builds 404.
 *
 * Query: `?source=moneybird|exact&state=open|empty|loading|error&advanced=1`
 */
export const Route = createFileRoute('/_app/lab/import-findings')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  validateSearch: (search: Record<string, unknown>) => ({
    source: search['source'] === 'exact' ? ('exact' as const) : ('moneybird' as const),
    state:
      search['state'] === 'empty' ||
      search['state'] === 'loading' ||
      search['state'] === 'error' ||
      search['state'] === 'open'
        ? search['state']
        : ('open' as const),
    sheet:
      search['sheet'] === 'account' ||
      search['sheet'] === 'tax' ||
      search['sheet'] === 'tax0' ||
      search['sheet'] === 'taxSales21' ||
      search['sheet'] === 'taxPurchase0' ||
      search['sheet'] === 'taxBad' ||
      search['sheet'] === 'taxEmpty' ||
      search['sheet'] === 'taxMapFail' ||
      search['sheet'] === 'fx' ||
      search['sheet'] === 'fxo'
        ? search['sheet']
        : undefined,
  }),
  component: ImportFindingsLab,
})

const FOREIGN_MINOR = 124_000n // GBP 1.240,00

function ImportFindingsLab() {
  const { source, state, sheet } = Route.useSearch()
  const { t } = useT()
  const hydrated = useHydrated()
  const { advanced, setAdvanced, saving: advancedSaving } = useAdvancedMode()
  const [accountOpen, setAccountOpen] = useState(sheet === 'account')
  const [taxOpen, setTaxOpen] = useState(sheet === 'tax')
  const [taxZeroOpen, setTaxZeroOpen] = useState(sheet === 'tax0')
  const [taxSales21Open, setTaxSales21Open] = useState(sheet === 'taxSales21')
  const [taxPurchase0Open, setTaxPurchase0Open] = useState(sheet === 'taxPurchase0')
  const [taxBadOpen, setTaxBadOpen] = useState(sheet === 'taxBad')
  const [taxEmptyOpen, setTaxEmptyOpen] = useState(sheet === 'taxEmpty')
  const [fxOpen, setFxOpen] = useState(sheet === 'fx' || sheet === 'fxo')
  const [fxRate, setFxRate] = useState(sheet === 'fxo' ? '1,1490' : '1,1531')
  const [fxSource, setFxSource] = useState<'ecb' | 'override'>(sheet === 'fxo' ? 'override' : 'ecb')
  const [resolved, setResolved] = useState<readonly ResolvedFindingRow[]>(
    source === 'moneybird' ? MONEYBIRD_FIXTURE_RESOLVED : [],
  )
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  // Lab uses the same MoneybirdMappingReview + applyTaxMappingSaveFailure as /moneybird.
  const [mapTax, setMapTax] = useState<Record<string, string>>({ '21': 'H21' })
  const [mapViolations, setMapViolations] = useState<
    Readonly<Record<string, TaxMappingViolationView>>
  >({})
  const [mapBusy, setMapBusy] = useState(false)
  const showMapFail = sheet === 'taxMapFail'
  const noopJumpToMapping = () => undefined

  const findings = useMemo((): readonly FindingsListItem[] => {
    if (state === 'empty' || state === 'loading' || state === 'error') return []
    const base =
      source === 'exact'
        ? exactFixtureFindings()
        : moneybirdFixtureFindings({
            onMapAccount: () => setAccountOpen(true),
            onOpenFx: () => setFxOpen(true),
            onConfirmYear: () => resolveById('f4', 'Boekjaar begint in januari'),
            onApplyTax: () => resolveById('f3', 'Laag tarief → 9% btw'),
          })
    return base.filter((finding) => !dismissed.has(finding.id ?? finding.code))
  }, [source, state, dismissed])

  function resolveById(id: string, result: string): void {
    const finding = (source === 'exact' ? exactFixtureFindings() : moneybirdFixtureFindings()).find(
      (row) => row.id === id,
    )
    if (finding === undefined) return
    setDismissed((current) => new Set([...current, id]))
    setResolved((current) => [
      {
        id,
        code: finding.code,
        title: finding.message,
        result,
      },
      ...current,
    ])
  }

  const normalized = normalizeFxRateInput(fxRate)
  const eurMinor =
    normalized === null ? 0n : BigInt(Math.round(Number(FOREIGN_MINOR) * Number(normalized)))
  const eurPreview = formatFindingAmount(eurMinor, 'EUR')
  const ecbInverse = (1 / 1.1531).toFixed(4).replace('.', ',')

  return (
    <>
      <PageHeader
        title={source === 'exact' ? 'Exact Online' : 'Moneybird'}
        description={
          source === 'exact'
            ? t('importFindings.allClearBody')
            : 'Proefimport van Voorbeeld BV · gelezen vandaag. Er is nog niets geboekt.'
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={advanced}
            disabled={!hydrated}
            aria-busy={advancedSaving || undefined}
            data-testid="lab-advanced"
            onChange={(event) => {
              void setAdvanced(event.target.checked)
            }}
            className="border-border size-4 rounded-none"
          />
          Geavanceerd
        </label>
      </div>

      <ImportFindingsScreen
        subtitle={
          source === 'exact'
            ? t('importFindings.allClearBody')
            : 'Proefimport van Voorbeeld BV · gelezen vandaag. Er is nog niets geboekt.'
        }
        connected
        hasPreview={state !== 'loading'}
        loading={state === 'loading'}
        hydrated={hydrated}
        error={state === 'error' ? 'Moneybird weigerde de verbinding (HTTP 401).' : null}
        findings={findings}
        sources={
          state === 'loading' || state === 'error'
            ? []
            : source === 'exact'
              ? EXACT_FIXTURE_SOURCES
              : MONEYBIRD_FIXTURE_SOURCES.map((cell) =>
                  cell.honesty === 'unread' ? { ...cell, onReread: () => undefined } : cell,
                )
        }
        resolved={state === 'empty' ? [] : resolved}
        onReread={() => undefined}
        onImport={() => undefined}
        advanced={advanced}
        {...(source === 'moneybird'
          ? {
              emptySummary:
                'Er houdt niets de import meer tegen. We zetten 680 boekingen over. 4 concepten en 1 bon uit 2025 blijven achter.',
            }
          : {})}
      />

      {source === 'moneybird' && state === 'open' && (
        <ScrollTable className="mt-8">
          <table className={cn('w-full min-w-[36rem] text-sm', stickyFirstCol)}>
            <thead>
              <tr className="border-border border-b text-left">
                <th className="py-2 pr-4">Moneybird</th>
                <th className="py-2">Klopt-categorie</th>
                <th className="py-2 text-right tabular-nums">Boekingen</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Kantoorartikelen', 'Kantoorkosten', '38'],
                ['Verzendkosten', 'Verzendkosten', '12'],
                ['Shipton Mill', 'Crediteuren', '1'],
              ].map(([from, to, count]) => (
                <tr key={from} className="border-border border-b">
                  <td className="py-2 pr-4">{from}</td>
                  <td className="py-2">{to}</td>
                  <td className="py-2 text-right tabular-nums">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      )}

      {source === 'moneybird' && (
        <>
          <AccountVatSheet
            open={accountOpen}
            onOpenChange={setAccountOpen}
            sourceName="Kantoorartikelen"
            sourceDetail="38 boekingen · € 2.914,60 in 2026"
            rgsCode="WBedKanKan"
            sourceNumber="4510"
            accounts={FIXTURE_ACCOUNTS}
            taxRules={NL_MKB_VAT_RULES}
            mode="account"
            advanced={advanced}
            onSave={(choice) => {
              resolveById(
                'f1',
                `Kantoorartikelen → ${choice.accountName ?? choice.accountNumber ?? '—'}`,
              )
            }}
          />
          {/* Purchase 21% → VH21 primary; VERL-ONTV / ICV21 / INV23 under other. */}
          <AccountVatSheet
            open={taxOpen}
            onOpenChange={setTaxOpen}
            sourceName="Hoog tarief inkoop"
            sourceDetail="21%"
            accounts={FIXTURE_ACCOUNTS}
            taxRules={NL_MKB_VAT_RULES}
            mode="tax"
            taxRateType="purchase_invoice"
            percentage="21"
            suggestedVat="VH21"
            advanced={advanced}
            onSave={(choice) => {
              resolveById('f3', `Hoog tarief → ${choice.vatCode ?? '—'}`)
            }}
          />
          {/* Sales 21% → H21 only; no input codes with toggle open. */}
          <AccountVatSheet
            open={taxSales21Open}
            onOpenChange={setTaxSales21Open}
            sourceName="Hoog tarief verkoop"
            sourceDetail="21%"
            accounts={FIXTURE_ACCOUNTS}
            taxRules={NL_MKB_VAT_RULES}
            mode="tax"
            taxRateType="sales_invoice"
            percentage="21"
            suggestedVat="H21"
            advanced={advanced}
            onSave={(choice) => {
              resolveById('f3', `Verkoop 21% → ${choice.vatCode ?? '—'}`)
            }}
          />
          {/* Sales 0% → VERL/GEEN/NUL/ICP/ICPD, nothing pre-selected. */}
          <AccountVatSheet
            open={taxZeroOpen}
            onOpenChange={setTaxZeroOpen}
            sourceName="Verlegd / ICP / export"
            sourceDetail="0%"
            accounts={FIXTURE_ACCOUNTS}
            taxRules={NL_MKB_VAT_RULES}
            mode="tax"
            taxRateType="sales_invoice"
            percentage="0"
            advanced={advanced}
            onSave={(choice) => {
              resolveById('f3', `0% → ${choice.vatCode ?? '—'}`)
            }}
          />
          {/* Purchase 0% → VGEEN as other, nothing pre-selected. */}
          <AccountVatSheet
            open={taxPurchase0Open}
            onOpenChange={setTaxPurchase0Open}
            sourceName="Inkoop zonder btw"
            sourceDetail="0%"
            accounts={FIXTURE_ACCOUNTS}
            taxRules={NL_MKB_VAT_RULES}
            mode="tax"
            taxRateType="purchase_invoice"
            percentage="0"
            advanced={advanced}
            onJumpToMapping={noopJumpToMapping}
            onSave={(choice) => {
              resolveById('f3', `Inkoop 0% → ${choice.vatCode ?? '—'}`)
            }}
          />
          {/* Unsupported purchase rate → honest empty status (12% inkoop). */}
          <AccountVatSheet
            open={taxBadOpen}
            onOpenChange={setTaxBadOpen}
            sourceName="Odd rate"
            sourceDetail="12%"
            accounts={FIXTURE_ACCOUNTS}
            taxRules={NL_MKB_VAT_RULES}
            mode="tax"
            taxRateType="purchase_invoice"
            percentage="12"
            advanced={advanced}
            onJumpToMapping={noopJumpToMapping}
            onSave={() => undefined}
          />
          {/* Empty / unknown rate → vatUnknown status, no duplicate hint. */}
          <AccountVatSheet
            open={taxEmptyOpen}
            onOpenChange={setTaxEmptyOpen}
            sourceName="Onbekend tarief"
            sourceDetail="—"
            accounts={FIXTURE_ACCOUNTS}
            taxRules={NL_MKB_VAT_RULES}
            mode="tax"
            taxRateType="purchase_invoice"
            percentage=""
            advanced={advanced}
            onJumpToMapping={noopJumpToMapping}
            onSave={() => undefined}
          />
          {showMapFail && (
            <MoneybirdMappingReview
              data-slot="lab-tax-map-fail"
              accounts={[]}
              taxRates={[
                {
                  moneybirdId: '21',
                  name: 'Hoog tarief verkoop',
                  percentage: '21',
                  taxRateType: 'sales_invoice',
                  proposedCode: 'H21',
                  mappedCode: 'H21',
                  used: true,
                },
              ]}
              accountMappings={{}}
              taxMappings={mapTax}
              taxViolations={mapViolations}
              advanced={advanced}
              onAccountChange={() => undefined}
              onTaxChange={(id, value) => {
                setMapViolations((current) => {
                  if (current[id] === undefined) return current
                  const next = { ...current }
                  delete next[id]
                  return next
                })
                setMapTax((current) => ({ ...current, [id]: value }))
              }}
              onSave={() => {
                setMapBusy(true)
                const previous = { '21': 'H21' }
                const attempted = { ...mapTax }
                // Same shape as saveMappings 422 — finding.moneybird.incompatible_tax_rate.
                const applied = applyTaxMappingSaveFailure({
                  previous,
                  attempted,
                  violations: [
                    {
                      path: 'taxRates.21',
                      code: 'incompatible_tax_rate',
                      messageKey: 'moneybird.incompatible_tax_rate',
                      message:
                        'Tax rate Hoog tarief verkoop (21%) cannot map to VH21: direction or rate does not match the chart.',
                      detail: {
                        name: 'Hoog tarief verkoop',
                        percentage: '21%',
                        mappedCode: attempted['21'] ?? 'VH21',
                      },
                    },
                  ],
                  t,
                })
                setMapViolations(applied.taxViolations)
                setMapTax(applied.taxMappings)
                const first = applied.rejectedIds[0]
                if (first !== undefined) scrollTaxMappingViolationIntoView(first)
                setMapBusy(false)
              }}
              busy={mapBusy}
              hydrated={hydrated}
            />
          )}
          <FxRateSheet
            open={fxOpen}
            onOpenChange={setFxOpen}
            reference="INV-20931"
            supplier="Shipton Mill Ltd"
            documentDateLabel="16 oktober 2026"
            currency="GBP"
            foreignAmountLabel="GBP 1.240,00"
            rate={fxRate}
            ecbRate="1,1531"
            source={fxSource}
            ecbDate="2026-10-16"
            ecbInverse={ecbInverse}
            advanced={advanced}
            previewRows={[
              {
                label: 'Inkoop grondstoffen',
                accountNumber: '7000',
                amount: eurPreview,
                debit: eurPreview,
                credit: '—',
              },
              {
                label: 'Te betalen aan Shipton Mill',
                accountNumber: '1600',
                amount: eurPreview,
                debit: '—',
                credit: eurPreview,
              },
            ]}
            calcLine={`GBP 1.240,00 × ${fxRate} = ${eurPreview}`}
            onRateChange={(value) => {
              setFxRate(value)
              setFxSource(value === '1,1531' || value === '1.1531' ? 'ecb' : 'override')
            }}
            onResetEcb={() => {
              setFxRate('1,1531')
              setFxSource('ecb')
            }}
            onAccept={() => {
              setFxOpen(false)
              resolveById(
                'f2',
                `Koers ${fxRate} (${fxSource === 'ecb' ? 'ECB' : 'Aangepast'} · 2026-10-16)`,
              )
            }}
          />
        </>
      )}
    </>
  )
}
