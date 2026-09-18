import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { getRgsCoverage, listAccounts } from '~/server/ledger'

export const Route = createFileRoute('/_app/accounts')({
  loader: async () => {
    const [accounts, coverage] = await Promise.all([listAccounts(), getRgsCoverage({ data: {} })])
    return { accounts, coverage }
  },
  component: Accounts,
})

interface AccountRow {
  number: string
  name: string
  type: string
  normalBalance: string
  rgsCode: string | null
  isBlocked: boolean
}

const TYPE_KEY: Record<string, MessageKey> = {
  asset: 'accounts.type.asset',
  liability: 'accounts.type.liability',
  equity: 'accounts.type.equity',
  revenue: 'accounts.type.revenue',
  expense: 'accounts.type.expense',
}

function Accounts() {
  const { accounts, coverage } = Route.useLoaderData()
  const { t } = useT()

  if (!accounts.ok) return <p className="text-destructive">{accounts.problem.detail}</p>

  const problemsByAccount = new Map<string, { severity: string; message: string }[]>()
  if (coverage.ok) {
    for (const problem of coverage.data.problems) {
      const list = problemsByAccount.get(problem.accountNumber) ?? []
      list.push(problem)
      problemsByAccount.set(problem.accountNumber, list)
    }
  }

  const columns: readonly Column<AccountRow>[] = [
    {
      key: 'number',
      header: t('accounts.number'),
      width: '6rem',
      cell: (row) => <span className="tabular">{row.number}</span>,
    },
    { key: 'name', header: t('accounts.description'), cell: (row) => row.name },
    {
      key: 'type',
      header: t('accounts.kind'),
      width: '9rem',
      cell: (row) => {
        const key = TYPE_KEY[row.type]
        return key === undefined ? row.type : t(key)
      },
    },
    {
      key: 'dc',
      header: 'D/C',
      width: '4rem',
      cell: (row) => (row.normalBalance === 'debit' ? 'D' : 'C'),
    },
    {
      key: 'rgs',
      header: 'RGS',
      width: '11rem',
      cell: (row) =>
        row.rgsCode === null ? (
          <span className="bg-unreconciled/15 rounded px-1.5 py-0.5 text-xs">
            {t('accounts.unmapped')}
          </span>
        ) : (
          <span className="tabular text-xs">{row.rgsCode}</span>
        ),
    },
    {
      key: 'status',
      header: '',
      cell: (row) => {
        const problems = problemsByAccount.get(row.number) ?? []
        const worst = problems.find((problem) => problem.severity === 'error') ?? problems[0]
        if (row.isBlocked)
          return <span className="text-muted-foreground text-xs">{t('accounts.blocked')}</span>
        if (worst === undefined) return null
        return (
          <span
            className={
              worst.severity === 'error'
                ? 'text-destructive text-xs'
                : 'text-muted-foreground text-xs'
            }
            title={worst.message}
          >
            {worst.message}
          </span>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        title={t('accounts.title')}
        description={
          coverage.ok
            ? t('accounts.intro', {
                mapped: String(coverage.data.mappedCount),
                total: String(coverage.data.accountCount),
                version: coverage.data.version,
                variant: coverage.data.variant,
                percentage: String(coverage.data.mappedPercentage),
              })
            : undefined
        }
      />
      <LedgerTable
        columns={columns}
        rows={accounts.data.accounts}
        rowKey={(row) => row.number}
        caption={t('accounts.caption')}
      />
    </>
  )
}
