/**
 * Moneybird import mapping table — shared by the import-findings lab (and any
 * remaining mapping UI) so 422 inline errors share one path (#71 PM).
 */

import { Fragment } from 'react'
import { ScrollTable, stickyFirstCol } from '~/components/ui/scroll-table'
import { cn } from '~/lib/utils'
import type { TaxMappingViolationView } from '~/lib/tax-mapping-save'
import { useT } from '~/i18n/provider'

export interface MoneybirdAccountMappingRow {
  readonly moneybirdId: string
  readonly number: string
  readonly proposedNumber: string
  readonly name: string
  readonly rgsCode?: string | null
}

export interface MoneybirdTaxMappingRow {
  readonly moneybirdId: string
  readonly name: string
  readonly percentage: string
  readonly taxRateType?: string
  readonly proposedCode: string | null
  readonly mappedCode: string | null
  readonly used: boolean
}

export function MoneybirdMappingReview({
  accounts,
  taxRates,
  accountMappings,
  taxMappings,
  taxViolations,
  advanced,
  onAccountChange,
  onTaxChange,
  onSave,
  busy,
  hydrated,
  'data-slot': dataSlot,
}: {
  readonly accounts: readonly MoneybirdAccountMappingRow[]
  readonly taxRates: readonly MoneybirdTaxMappingRow[]
  readonly accountMappings: Readonly<Record<string, string>>
  readonly taxMappings: Readonly<Record<string, string>>
  readonly taxViolations: Readonly<Record<string, TaxMappingViolationView | string>>
  readonly advanced: boolean
  readonly onAccountChange: (id: string, value: string) => void
  readonly onTaxChange: (id: string, value: string) => void
  readonly onSave: () => void
  readonly busy: boolean
  readonly hydrated: boolean
  readonly 'data-slot'?: string
}) {
  const { t } = useT()
  const unmapped =
    accounts.filter((account) => (accountMappings[account.moneybirdId] ?? '').trim() === '')
      .length +
    taxRates.filter((rate) => rate.used && (taxMappings[rate.moneybirdId] ?? '').trim() === '')
      .length
  const sourceColumn = advanced ? t('moneybird.ledgerAccounts') : t('moneybird.moneybirdName')
  const accountColumn = advanced ? t('moneybird.kloptAccount') : t('moneybird.category')

  return (
    <div className="mt-6" {...(dataSlot !== undefined ? { 'data-slot': dataSlot } : {})}>
      <h3 className="mb-2 text-sm font-semibold">{t('moneybird.mapping')}</h3>
      <p className="text-muted-foreground mb-4 text-sm">
        {t('moneybird.mappingIntro')}
        {unmapped > 0 ? ` ${t('moneybird.unmappedCount', { count: String(unmapped) })}` : ''}
      </p>
      {accounts.length > 0 && (
        <ScrollTable className="mb-4">
          <table className={cn('w-full min-w-[32rem] text-sm', stickyFirstCol)}>
            <thead>
              <tr className="border-border border-b text-left">
                <th className="py-2 pr-4">{sourceColumn}</th>
                <th className="py-2">{accountColumn}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr
                  key={account.moneybirdId}
                  id={`moneybird-account-${account.moneybirdId}`}
                  className="border-border border-b"
                >
                  <td className="py-2 pr-4">
                    {advanced ? `${account.number} — ${account.name}` : account.name}
                    {advanced && account.rgsCode !== null && account.rgsCode !== undefined ? (
                      <span className="text-muted-foreground ml-2 text-xs tabular-nums">
                        {account.rgsCode}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2">
                    <input
                      value={accountMappings[account.moneybirdId] ?? account.proposedNumber}
                      onChange={(event) => onAccountChange(account.moneybirdId, event.target.value)}
                      disabled={!hydrated}
                      className="border-border w-32 rounded-none border px-2 py-1 tabular-nums"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      )}
      <ScrollTable className="mb-4">
        <table className={cn('w-full min-w-0 text-sm md:min-w-[28rem]', stickyFirstCol)}>
          <thead>
            <tr className="border-border border-b text-left">
              <th className="py-2 pr-4">{t('moneybird.taxRates')}</th>
              <th className="w-36 py-2 sm:w-40">{t('moneybird.kloptTax')}</th>
            </tr>
          </thead>
          <tbody>
            {taxRates.map((rate) => {
              const raw = taxViolations[rate.moneybirdId]
              const violationMessage =
                typeof raw === 'string' ? raw : raw !== undefined ? raw.message : undefined
              const errorId = `moneybird-tax-${rate.moneybirdId}-error`
              return (
                <Fragment key={rate.moneybirdId}>
                  <tr id={`moneybird-tax-${rate.moneybirdId}`} className="border-border border-b">
                    <td className="py-2 pr-4 tabular-nums">
                      {rate.name} ({rate.percentage}%)
                    </td>
                    <td className="py-2">
                      <input
                        value={
                          taxMappings[rate.moneybirdId] ??
                          rate.mappedCode ??
                          rate.proposedCode ??
                          ''
                        }
                        onChange={(event) => onTaxChange(rate.moneybirdId, event.target.value)}
                        disabled={!hydrated}
                        aria-describedby={violationMessage !== undefined ? errorId : undefined}
                        className="border-border w-32 max-w-full rounded-none border px-2 py-1 tabular-nums"
                      />
                    </td>
                  </tr>
                  {violationMessage !== undefined ? (
                    <tr className="border-border border-b">
                      <td colSpan={2} className="max-w-0 py-1 pb-2">
                        <p
                          id={errorId}
                          role="alert"
                          aria-invalid="true"
                          className="border-destructive text-destructive whitespace-normal break-words border-l-[3px] pl-2 text-xs"
                          data-slot="tax-mapping-violation"
                        >
                          {violationMessage}
                        </p>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </ScrollTable>
      <button
        type="button"
        disabled={busy || !hydrated}
        onClick={onSave}
        className="border-border rounded-none border px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {t('moneybird.saveMappings')}
      </button>
    </div>
  )
}
