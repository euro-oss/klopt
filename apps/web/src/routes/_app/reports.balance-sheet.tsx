import { createFileRoute } from '@tanstack/react-router'
import { statementSectionLabel } from '~/i18n/labels'
import type { StatementSectionKey } from '@klopt/core'
import { PageHeader } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { useT } from '~/i18n/provider'
import { getBalanceSheet } from '~/server/ledger'

/**
 * The book year comes from the shell, not from the calendar.
 *
 * This used to be `new Date().getFullYear()`, which is the right answer for an
 * administration whose boekjaar starts in January and a wrong one — shown
 * without a word — for every other administration setup allows.
 */
export const Route = createFileRoute('/_app/reports/balance-sheet')({
  loader: async () => getBalanceSheet({ data: {} }),
  component: BalanceSheet,
})

interface Line {
  accountNumber: string
  accountName: string
  rgsCode: string | null
  amount: string
}

interface Section {
  key: StatementSectionKey
  title: string
  total: string
  lines: Line[]
}

function Side({ section, extra }: { section: Section; extra?: { label: string; amount: string } }) {
  const { t } = useT()
  return (
    <div>
      <h2 className="border-border mb-2 border-b pb-1 font-medium">
        {statementSectionLabel(t, section.key)}
      </h2>
      <table className="w-full text-sm">
        <tbody>
          {section.lines.map((line) => (
            <tr key={line.accountNumber}>
              <td className="py-1 font-mono text-xs">{line.accountNumber}</td>
              <td className="py-1">{line.accountName}</td>
              <td className="text-muted-foreground py-1 font-mono text-xs">{line.rgsCode ?? ''}</td>
              <td className="py-1 text-right">
                <Money amount={line.amount} />
              </td>
            </tr>
          ))}
          {extra !== undefined && (
            <tr>
              <td />
              <td className="py-1 italic">{extra.label}</td>
              <td />
              <td className="py-1 text-right">
                <Money amount={extra.amount} />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function BalanceSheet() {
  const result = Route.useLoaderData()
  const { t } = useT()
  if (!result.ok) return <p className="text-destructive">{result.problem.detail}</p>
  const sheet = result.data

  return (
    <>
      <PageHeader
        title={t('balance.title')}
        description={t('balance.intro', { date: sheet.asOf, currency: sheet.currency })}
      />

      <div className="grid gap-10 lg:grid-cols-2">
        <Side section={sheet.assets} />
        <div className="space-y-8">
          <Side section={sheet.liabilities} />
          <Side
            section={sheet.equity}
            // Before a year close the result sits here, unappropriated. That is
            // what a balance sheet at year end actually shows.
            extra={{ label: t('balance.result'), amount: sheet.resultForPeriod }}
          />
        </div>
      </div>

      <div className="border-border mt-8 grid gap-10 border-t pt-3 lg:grid-cols-2">
        <div className="flex justify-between font-medium">
          <span>{t('balance.totalAssets')}</span>
          <Money amount={sheet.totalAssets} />
        </div>
        <div className="flex justify-between font-medium">
          <span>{t('balance.totalLiabilities')}</span>
          <Money amount={sheet.totalLiabilitiesAndEquity} />
        </div>
      </div>

      {sheet.difference !== '0' && (
        <p className="text-destructive mt-4 text-sm">
          {t('balance.doesNotBalance')} <Money amount={sheet.difference} />
          {t('balance.doesNotBalanceBody')}
        </p>
      )}
    </>
  )
}
