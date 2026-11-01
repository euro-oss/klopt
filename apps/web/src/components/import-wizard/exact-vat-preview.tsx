/**
 * Exact read-only btw preview (#100 Phase 2 first slice).
 *
 * Shows how each Exact VAT code maps to a Klopt btw-code. Nothing is chosen
 * here — reverse-charge / EU / export codes stay unrecognised with an honest
 * lose-default note. No ledger writes.
 */

import { TriangleAlert } from 'lucide-react'
import type { ExactVatMappingRow, ExactVatMappingSummary } from '@klopt/core'
import { Badge } from '~/components/ui/badge'
import { ScrollTable, stickyFirstCol } from '~/components/ui/scroll-table'
import { useAdvancedMode } from '~/lib/advanced-mode-context'
import { useT } from '~/i18n/provider'
import { cn } from '~/lib/utils'

export function ExactVatPreview({
  summary,
  notImportedYet,
}: {
  readonly summary: ExactVatMappingSummary
  /** Banner: preview only — nothing written yet. */
  readonly notImportedYet?: boolean
}) {
  const { t } = useT()
  const { advanced } = useAdvancedMode()

  return (
    <div>
      {notImportedYet === true && (
        <p role="status" className="text-muted-foreground mb-4 text-sm">
          {t('wizard.exact.btw.notImportedYet')}
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{t('wizard.exact.btw.recognisedHeading')}</h3>
        <p className="text-muted-foreground text-sm tabular-nums">
          {t('wizard.exact.btw.recognisedCount', {
            recognised: String(summary.recognised),
            total: String(summary.codeCount),
          })}
        </p>
      </div>
      <ScrollTable>
        <table className={cn('w-full min-w-[28rem] text-left text-sm', stickyFirstCol)}>
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr>
              <th className="py-2 pr-3 pl-4 font-medium">{t('wizard.exact.btw.colExact')}</th>
              <th className="py-2 pr-4 font-medium">{t('wizard.exact.btw.colKlopt')}</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <ExactVatRow key={row.exactCode} row={row} advanced={advanced} />
            ))}
          </tbody>
        </table>
      </ScrollTable>
      <p className="text-muted-foreground mt-2 text-sm">{t('wizard.exact.btw.footnote')}</p>
    </div>
  )
}

function ExactVatRow({
  row,
  advanced,
}: {
  readonly row: ExactVatMappingRow
  readonly advanced: boolean
}) {
  const { t } = useT()
  const exactSub = advanced
    ? t('wizard.exact.btw.exactCode', { code: row.exactCode })
    : `${row.percentage}%`

  return (
    <tr className="border-border border-t align-top">
      <td className="py-2.5 pr-3 pl-4">
        <span className="block font-medium">{row.exactName}</span>
        <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">{exactSub}</span>
      </td>
      <td className="py-2.5 pr-4">
        {row.kloptCode !== null ? (
          <div>
            <span className="block font-medium">{row.kloptLabel ?? row.kloptCode}</span>
            {advanced && (
              <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">
                {row.kloptCode}
              </span>
            )}
            {row.codeMatch && (
              <Badge variant="outline" className="mt-1">
                {t('wizard.exact.btw.codeMatch')}
              </Badge>
            )}
          </div>
        ) : (
          <div>
            <span className="text-warning flex items-center gap-1.5">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              {t('wizard.exact.btw.unrecognised')}
            </span>
            {row.accountsLosingDefault.length > 0 && (
              <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">
                {row.accountsLosingDefault.length === 1
                  ? t('wizard.exact.btw.loseDefaultOne')
                  : t('wizard.exact.btw.loseDefaultMany', {
                      count: String(row.accountsLosingDefault.length),
                    })}
                {advanced
                  ? `: ${row.accountsLosingDefault.map((a) => `${a.number} ${a.name}`).join(', ')}`
                  : '.'}
              </span>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}
