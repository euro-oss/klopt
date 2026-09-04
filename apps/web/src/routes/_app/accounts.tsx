import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
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

const TYPE_LABEL: Record<string, string> = {
  asset: 'Activa',
  liability: 'Passiva',
  equity: 'Eigen vermogen',
  revenue: 'Opbrengsten',
  expense: 'Kosten',
}

function Accounts() {
  const { accounts, coverage } = Route.useLoaderData()

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
      header: 'Nummer',
      width: '6rem',
      cell: (row) => <span className="tabular font-mono">{row.number}</span>,
    },
    { key: 'name', header: 'Omschrijving', cell: (row) => row.name },
    {
      key: 'type',
      header: 'Soort',
      width: '9rem',
      cell: (row) => TYPE_LABEL[row.type] ?? row.type,
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
          <span className="bg-unreconciled/15 rounded px-1.5 py-0.5 text-xs">niet gekoppeld</span>
        ) : (
          <span className="font-mono text-xs">{row.rgsCode}</span>
        ),
    },
    {
      key: 'status',
      header: '',
      cell: (row) => {
        const problems = problemsByAccount.get(row.number) ?? []
        const worst = problems.find((problem) => problem.severity === 'error') ?? problems[0]
        if (row.isBlocked) return <span className="text-muted-foreground text-xs">geblokkeerd</span>
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
        title="Grootboekrekeningen"
        description={
          coverage.ok
            ? `${String(coverage.data.mappedCount)} van ${String(coverage.data.accountCount)} gekoppeld aan RGS ${coverage.data.version} (${coverage.data.variant}). ${String(coverage.data.mappedPercentage)}% van het saldo is rapporteerbaar.`
            : undefined
        }
      />
      <LedgerTable
        columns={columns}
        rows={accounts.data.accounts}
        rowKey={(row) => row.number}
        caption="Grootboekrekeningen met hun RGS-koppeling"
      />
    </>
  )
}
