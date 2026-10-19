import { createFileRoute, notFound } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { normalizeFxRateInput } from '@klopt/core/moneybird-fx'
import { PageHeader } from '~/components/app-shell'
import { AccountVatSheet } from '~/components/findings/account-vat-sheet'
import { FxRateSheet } from '~/components/findings/fx-rate-sheet'
import { ImportFindingsScreen } from '~/components/findings/import-findings-screen'
import { ScrollTable, stickyFirstCol } from '~/components/ui/scroll-table'
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
      search['sheet'] === 'account' || search['sheet'] === 'fx' || search['sheet'] === 'fxo'
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
  const [fxOpen, setFxOpen] = useState(sheet === 'fx' || sheet === 'fxo')
  const [fxRate, setFxRate] = useState(sheet === 'fxo' ? '1,1490' : '1,1531')
  const [fxSource, setFxSource] = useState<'ecb' | 'override'>(sheet === 'fxo' ? 'override' : 'ecb')
  const [resolved, setResolved] = useState<readonly ResolvedFindingRow[]>(
    source === 'moneybird' ? MONEYBIRD_FIXTURE_RESOLVED : [],
  )
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())

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
            mode="account"
            advanced={advanced}
            onSave={(choice) => {
              resolveById(
                'f1',
                `Kantoorartikelen → ${choice.accountName ?? choice.accountNumber ?? '—'}`,
              )
            }}
          />
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
