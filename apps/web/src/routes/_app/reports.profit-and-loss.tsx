import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { useT } from '~/i18n/provider'
import { getProfitAndLoss } from '~/server/ledger'

const YEAR = String(new Date().getFullYear())

export const Route = createFileRoute('/_app/reports/profit-and-loss')({
  loader: async () => getProfitAndLoss({ data: { fiscalYear: YEAR } }),
  component: ProfitAndLoss,
})

interface Line {
  accountNumber: string
  accountName: string
  amount: string
}

function ProfitAndLoss() {
  const result = Route.useLoaderData()
  const { t } = useT()
  if (!result.ok) return <p className="text-destructive">{result.problem.detail}</p>
  const statement = result.data

  const section = (title: string, lines: Line[], total: string) => (
    <section>
      <h2 className="border-border mb-2 border-b pb-1 font-medium">{title}</h2>
      <table className="w-full text-sm">
        <tbody>
          {lines.map((line) => (
            <tr key={line.accountNumber}>
              <td className="py-1 font-mono text-xs">{line.accountNumber}</td>
              <td className="py-1">{line.accountName}</td>
              <td className="py-1 text-right">
                <Money amount={line.amount} />
              </td>
            </tr>
          ))}
          <tr className="border-border border-t font-medium">
            <td />
            <td className="py-1">{t('report.total')}</td>
            <td className="py-1 text-right">
              <Money amount={total} />
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  )

  return (
    <>
      <PageHeader
        title={t('profit.title')}
        description={t('profit.intro', {
          from: statement.fromDate,
          to: statement.toDate,
          currency: statement.currency,
        })}
      />

      <div className="max-w-2xl space-y-8">
        {section(t('profit.revenue'), statement.revenue.lines, statement.revenue.total)}
        {section(t('profit.expenses'), statement.expenses.lines, statement.expenses.total)}

        <div className="border-border flex justify-between border-t-2 pt-3 text-lg font-semibold">
          <span>{BigInt(statement.result) < 0n ? t('profit.loss') : t('profit.result')}</span>
          <Money amount={statement.result} />
        </div>
      </div>
    </>
  )
}
